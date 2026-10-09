import type { Metadata } from "next";
import Link from "next/link";
import { PageHead, Section } from "@/components/Page";
import { TryForm } from "./TryForm";

export const metadata: Metadata = { title: "Try it yourself" };

export default function TryPage() {
  return (
    <>
      <PageHead kicker="Try it yourself" title="Send a bill through the real pipeline">
        <p>
          Your bill is created in our company&apos;s ERPNext, exactly as an accountant would create it. ERPNext registers it on Arc, the agent
          (Claude) decides whether to pay it, Circle Mint funds it, an independent witness confirms the money arrived, and the contract either pays
          it or refuses. Every step is a real transaction you can open on the explorer.
        </p>
        <p className="mt-2">
          Want to see it refuse instead? Try to trick it in the note, or press the buttons on <Link href="/break-it">/break-it</Link>.
        </p>
      </PageHead>
      <Section title="Your bill">
        <TryForm />
      </Section>
    </>
  );
}
