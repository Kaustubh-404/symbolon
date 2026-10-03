# Symbolon

**Nothing pays until the halves fit.**

A *symbolon* was an object broken in two, with each party keeping a half; a deal was real only when the halves fit
back together. Symbolon is a treasury agent for a business that keeps its books in ERPNext. It pays vendors,
contractors and staff in USDC on [Arc](https://arc.io). The agent decides **whether, when and how** to pay each bill.
A contract on Arc refuses to move a cent unless two halves fit:

| Half | What it is | Who produces it | Can the agent forge it? |
|---|---|---|---|
| **The document** | The approved bill from the system of record: its hash, payee, amount and pay window | A human approver, through ERPNext's own approval flow | **No.** The contract rejects the agent's key for this role (`RoleConflict`) |
| **The witness** | Evidence that the money for *this* bill really arrived, read from Circle Mint's ledger and the chain | A separate witness service holding its own key | **No.** Same rule |

The agent's decision is committed as a hash **before** money moves. It is an input to the release, never the release
condition.

> Built for the [Tameion Agents Hackathon](https://tameion.thecanteenapp.com) (Canteen × Circle × Arc).
> Repository created 2026-10-03; nothing in it predates the event.

---

## Status: what works today

| | |
|---|---|
| `Symbolon.sol` on Arc Testnet (verified) | [`0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9`](https://explorer.testnet.arc.io/address/0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9) |
| First on-chain refusal | [`0xca8b3d1e…21eb`](https://explorer.testnet.arc.io/tx/0xca8b3d1e533b76ca578157d7040da0c7beb1f753cde45d0129f647330c8121eb): the agent tried to pay a payee whose wallet was set minutes earlier and got `PayeeChangedRecently` |
| Contract tests | **60 passing** under [Arc Foundry](https://github.com/circlefin/arc-foundry): 46 unit/fuzz + 7 invariants × 2 suites, 256 runs × depth 64. 97% of invariant runs reach real payments (920 releases, 4,238 refusals), so the invariants are not passing vacuously |
| Circle Mint sandbox → Arc Testnet | Proven both ways, with a mock wire turning into an on-chain `USDC.mint`. See [`docs/platform-notes.md`](docs/platform-notes.md) |

The agent, witness service, ERPNext app and web app are in progress. This table only lists what you can check now.

---

## Why this design

Canteen's essay [*Agents and Ledgers*](https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html)
criticises Circle's own escrow sample, [`circlefin/arc-escrow`](https://github.com/circlefin/arc-escrow):

- **It releases funds on two fields of the model's JSON.** `app/api/contracts/validate-work/route.ts:206-207` releases
  when `valid && confidence === "HIGH"`.
- **Its `releaseTimestamp` is never read.** It is set at `RefundProtocol.sol:101`, but `withdraw()` never checks it.
- **The chain is not an independent witness.** *"A chain is a shared record, so reconciling against it proves
  consistency and not independence."*

Symbolon inverts each point:

| arc-escrow | Symbolon |
|---|---|
| Model output **is** the release condition | Model output is a committed hash, **an input**. Release needs the document and the witness to fit |
| `releaseTimestamp` stored, never read | `notBefore` / `dueBy` enforced: `TooEarly`, `PastDue` |
| Reconciles against the chain it writes | The witness half comes from **Circle Mint's ledger**, a record the payer doesn't write |
| A retry can pay twice | `AlreadySettled`, and a dry run (`check`) that returns the exact revert `release` would produce |

### The essay's six-point checklist

| # | Essay | Where it lives |
|---|---|---|
| 1 | Start from a ledger where the entry points at a document | `docHash` on every obligation, registered from ERPNext |
| 2 | Turn on the controls that already exist | Payee-change cooldown (`PayeeChangedRecently`) and a payee snapshot (`PayeeMismatch`) |
| 3 | Put a witness in front of every write path | `attestWitness`: a separate key; it cannot reserve money the vault doesn't hold (`Unfunded`) |
| 4 | Make repair loud, or make it refuse | 20 named custom errors; refusals are mined, decoded on the explorer and indexed |
| 5 | Route agent writes through the code the UI already uses; return an idempotency signal per row; support a dry run | `registerBatch` returns `bool[] created`; `check(id)`; the ERPNext app calls the same server methods as the UI |
| 6 | Keep the model's output as an input, never as the release condition | `commitDecision` happens at least one block before `release`, and is never sufficient on its own |

---

## The contract, in one screen

`contracts/src/Symbolon.sol`. Roles: `ADMIN`, `APPROVER`, `AGENT`, `WITNESS`, `COSIGNER`, `GUARDIAN`.
**The agent can never also hold approver, witness, cosigner or admin.** The contract enforces this, not convention.

```
approver  setPayee(payeeId, wallet)                 → starts a cooldown on that payee
approver  registerObligation(id, docHash, payeeId, amount, notBefore, dueBy)   → idempotent per id
witness   attestWitness(id, amount, fundingRef, witnessDigest)                 → reserved against real balance
agent     commitDecision(id, Pay|Hold|Escalate, decisionHash)
cosigner  cosign(id)                                → required above threshold, or when the agent escalates
agent     release(id)                               → pays the registered payee the registered amount, or refuses
anyone    check(id)                                 → the exact refusal release(id) would produce now
anyone    expire(id)                                → after dueBy + grace, frees the reservation
agent     redeemSurplus(amount, decisionHash)       → unreserved surplus, and only to the Circle Mint deposit address
guardian  setPaused(true)                           → only the admin can unpause
```

**Refusals:**
`NotRegistered` · `AlreadySettled` · `NoDecisionCommitted` · `DecisionNotPay` · `DecisionSameBlock` · `WitnessMissing` ·
`WitnessMismatch` · `AlreadyWitnessed` · `Unfunded` · `TooEarly` · `PastDue` · `PayeeMismatch` · `PayeeChangedRecently` ·
`NeedsCosign` · `OverPeriodCap` · `RedeemExceedsSurplus` · `ConflictingRegistration` · `RoleConflict` · `NotAuthorized` ·
`Paused`

### Invariants (`contracts/test/invariant/`)

Each is a claim this README makes. If one breaks, the claim is false.

- **No obligation is paid more than once,** under retry storms of up to 4 parallel attempts.
- **Every payment goes to the wallet snapshotted from the document, for the document's amount,** with both halves
  present.
- **`reserved ≤ vault balance`:** the witness cannot reserve phantom money.
- **Conservation:** funded = vault + paid + redeemed. Nothing else leaves.
- **Surplus only ever reaches the Circle Mint deposit address.**
- **The reservation equals the witnessed amounts of open obligations.**
- **The period cap holds.**

---

## Verify it yourself

```bash
git clone --recursive https://github.com/Kaustubh-404/symbolon && cd symbolon/contracts
# Arc Foundry (stock forge can give false passes on Arc): https://github.com/circlefin/arc-foundry/releases
forge test                          # 60 tests

S=0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9
R=https://rpc.testnet.arc.io
cast call $S 'check(bytes32)(bytes)' $(cast keccak "Purchase Invoice:ACC-PINV-SMOKE-0001") --rpc-url $R
# → PayeeChangedRecently(...) until the cooldown ends, then empty bytes (releasable)
```

## What this does not prove (yet)

- **The witness is not independent of the team.** It is a separate key and process from the agent, and it reads
  Circle's ledger, but Circle does not sign the API response. A TLS-notarised proof of the Circle API response would
  remove this caveat; we will report whether it is feasible on Arc.
- **Circle Mint sandbox issues no real dollars.** Production Mint requires KYB.
- **The deployed testnet roles are all team-held keys.** Separation of duties is enforced on-chain between *keys*, not
  between people.

## Repository layout

```
contracts/   Foundry project: Symbolon.sol, tests, deploy script, deployments/<chainId>.json
docs/        platform notes (Arc + Circle findings, with tx hashes), deployments
apps/        web app (in progress)
packages/    agent, witness service, pre-payment check API (in progress)
erpnext/     Frappe app for ERPNext v15 (in progress)
bench/       baseline harness (in progress)
```

## License

Apache-2.0
