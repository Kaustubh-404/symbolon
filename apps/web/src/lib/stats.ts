import { getEvents } from "./logs";
import { getRefusals } from "./refusals";
import { getVaultState, type VaultState } from "./reads";
import { attempt, EXPLORER_ERROR, map, type Loaded } from "./loaded";

export type Stats = VaultState & {
  head: Loaded<bigint>;
  obligationsRegistered: Loaded<number>;
  refusalsMined: Loaded<number>;
};

export async function getStats(): Promise<Stats> {
  const [events, refusals, vault] = await Promise.all([
    attempt(getEvents),
    attempt(getRefusals, EXPLORER_ERROR),
    getVaultState(),
  ]);
  return {
    head: map(events, (e) => e.head),
    obligationsRegistered: map(events, (e) => new Set(e.events.filter((x) => x.name === "ObligationRegistered").map((x) => String(x.args.id).toLowerCase())).size),
    refusalsMined: map(refusals, (r) => r.refusals.length),
    ...vault,
  };
}
