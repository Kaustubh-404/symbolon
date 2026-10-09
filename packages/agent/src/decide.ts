import Anthropic from "@anthropic-ai/sdk";
import type { Hex } from "viem";
import { SYSTEM_PROMPT } from "./prompt.js";
import { makeTools, type DecisionInput, type ToolContext } from "./tools.js";

/** Default: the cheapest current model. Override with SYMBOLON_MODEL (e.g. claude-sonnet-5-5, claude-opus-5-5). */
export const MODEL = process.env.SYMBOLON_MODEL ?? "claude-haiku-4-5";

/**
 * Request settings differ by model generation: Haiku 4.5 takes a fixed thinking budget and rejects `effort`;
 * the 5.x models take adaptive thinking + effort and support server-side refusal fallback.
 */
function modelParams(model: string) {
  if (model.startsWith("claude-haiku-4-5")) {
    return { thinking: { type: "enabled" as const, budget_tokens: 4000 } };
  }
  return {
    thinking: { type: "adaptive" as const },
    output_config: { effort: "medium" as const },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}

export type RunOutcome = {
  decisions: Map<Hex, DecisionInput>;
  /** bills the model did not decide; code escalated them to a human */
  defaulted: Hex[];
  summary: string;
  model: string;
  usage: { input: number; output: number; iterations: number };
  stopReason: string | null;
};

/**
 * One decision run. The model investigates with read-only tools and records proposals with submit_decision.
 * Nothing here signs a transaction: execution happens afterwards, in code, through the contract.
 */
export async function decide(client: Anthropic, ctx: Omit<ToolContext, "decisions">): Promise<RunOutcome> {
  const decisions = new Map<Hex, DecisionInput>();
  const tools = makeTools({ ...ctx, decisions });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    ...modelParams(MODEL),
    tools,
    max_iterations: 80,
    messages: [{ role: "user", content: `Today is ${ctx.today}. Review the open bills and decide each one.` }],
  });

  let iterations = 0;
  let input = 0;
  let output = 0;
  let last: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    iterations++;
    input += message.usage.input_tokens;
    output += message.usage.output_tokens;
    last = message;
  }

  // Code, not the model, decides what happens to anything the model left undecided: a human looks at it.
  const defaulted: Hex[] = [];
  for (const b of ctx.bills) {
    if (decisions.has(b.obligationId)) continue;
    defaulted.push(b.obligationId);
    decisions.set(b.obligationId, {
      obligationId: b.obligationId,
      action: "escalate",
      payDate: null,
      fundingSource: "none",
      rationale: `The agent produced no decision for ${b.name} (stop reason: ${last?.stop_reason ?? "none"}). Escalated by default so a human reviews it.`,
      alternatives: [{ action: "pay", why_not: "no reviewed decision exists" }],
      concerns: ["agent did not decide"],
    });
  }

  const summary =
    last?.content
      .filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? "";

  return {
    decisions,
    defaulted,
    summary,
    model: last?.model ?? MODEL,
    usage: { input, output, iterations },
    stopReason: last?.stop_reason ?? null,
  };
}
