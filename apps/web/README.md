# Symbolon web

The public site for Symbolon: live figures, every obligation's timeline, every refusal the contract has mined, and
the deployed addresses and parameters. Everything is read at request time from Arc Testnet (chain 5042002) and the
Arcscan (Blockscout) API. No environment variables, keys or database are needed.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter web dev      # http://localhost:3000
pnpm --filter web build    # production build
pnpm --filter web start    # serve the build
```

Node >= 20.18. Deploys to Vercel as-is (set the project root to `apps/web`; pnpm workspace is detected).

## Pages and JSON

| Path | What it shows |
|---|---|
| `/` | Live stats strip, the two halves, arc-escrow vs Symbolon |
| `/obligations` | Every `ObligationRegistered` event with live `getObligation` state |
| `/obligations/[id]` | Timeline (payee set → registered → witnessed → decided → cosigned → released / refused) and the live `check(id)` dry run |
| `/refusals` | Every reverted transaction sent to the contract, decoded into the named custom error and a sentence |
| `/contracts` | Addresses, live role matrix (`hasRole`), live parameters |
| `/api/stats`, `/api/obligations`, `/api/refusals` | The same data as JSON. Amounts carry `raw` (6-decimal base units) and `usdc` |

```bash
curl -s localhost:3000/api/stats
```

## Rules the code follows

- **Unknown is never 0.** A failed read renders `unavailable (RPC error)` / `unavailable (explorer API error)`, and the
  JSON gives `{ "value": null, "unavailable": "<reason>" }`.
- **Logs in chunks.** `eth_getLogs` on Arc is capped near 10,000 blocks, so events are read in `MAX_LOG_RANGE`
  chunks from the deploy block. Throttling (429) backs off and retries the same range; only a genuine range error
  splits it. The index is incremental and kept in process memory.
- **Lagging RPC backends.** The newest 64 blocks are re-read on every sync and never committed, so a backend that
  is behind cannot make the index skip events.
- **Order by block number**, then log index; never by timestamp.
- **USDC via its ERC-20 view** (6 decimals), never `eth_getBalance`. Logs from the EIP-7708 system emitter are
  ignored.
- **Caching.** Chain and explorer snapshots are reused for 15 s per server instance (failures are not cached); API
  responses send `s-maxage=15`.
- **Refusals come from the explorer.** A reverted transaction emits no logs, so the Blockscout v2 API is the index.
  Revert data is decoded with `decodeRefusal` from `@symbolon/sdk`; Blockscout's own decoding is the fallback.

## Layout

```
src/lib/        config, chain client, log indexer (logs.ts), explorer refusals (refusals.ts),
                contract reads (reads.ts), obligations + stats, Loaded<T> (value or reason)
src/components/ Hash (shortened, copy on click, full value in title), Val/Unknown, Badge, page chrome
src/app/        pages and API route handlers
```
