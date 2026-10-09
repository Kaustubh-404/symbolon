# Running Symbolon for your own business

Symbolon is self-hosted today. There is no sign-up. You run four pieces, each holding only its own key. This is
the exact path we used for our own company, Symbolon Labs, on 2026-10-09.

| Piece | Holds | Runs |
|---|---|---|
| `Symbolon.sol` | your USDC, while a bill is being paid | Arc |
| ERPNext + `symbolon_erpnext` | the **APPROVER** key; registers bills that people approve | your server |
| Witness | the **WITNESS** key; confirms funding against Circle Mint and the chain | your server |
| Agent | the **AGENT** key (+ a treasury key that only forwards exact bill amounts) | your server |

A **COSIGNER** (a person, not a service) signs anything above your threshold. The contract refuses to let one address
hold two of AGENT / APPROVER / WITNESS / COSIGNER.

## 1. Keys and the contract (≈10 min)

You need [Arc Foundry](https://github.com/circlefin/arc-foundry/releases), because stock forge can give false passes on Arc.

```bash
git clone --recursive https://github.com/Kaustubh-404/symbolon && cd symbolon
mkdir -p .secrets && chmod 700 .secrets
for r in admin approver agent witness cosigner guardian; do cast wallet new --json | jq -c --arg r $r '.[0]+{role:$r}'; done > .secrets/testnet-roles.jsonl
# fund each address with a little testnet USDC for gas: https://faucet.circle.com (Arc Testnet)
```

Fill `.secrets/testnet.env` (see `contracts/script/Deploy.s.sol` for every variable). The parameters are yours to
choose:
- `COSIGN_THRESHOLD`: the amount above which a person must sign;
- `PERIOD_CAP` / `PERIOD_LENGTH`: e.g. $500 per day;
- `PAYEE_COOLDOWN`: how long a new or changed wallet waits before it can be paid;
- `GRACE`.

```bash
cd contracts && set -a && . ../.secrets/testnet.env && set +a
forge script script/Deploy.s.sol --rpc-url https://rpc.drpc.testnet.arc.io --broadcast --with-gas-price 30gwei --priority-gas-price 1gwei --slow
cd .. && node scripts/export-abi.mjs
```

On Arc, always pay **≥ 2× the base fee** (20 gwei). An under-priced transaction is accepted and never mines, and it
blocks every later transaction from that key (see `docs/platform-notes.md`).

## 2. ERPNext with the Symbolon app (≈20 min)

On a server with **≥ 8 GB RAM** and Docker:

```bash
cd erpnext/docker && docker compose -f compose.yml up -d --build     # ERPNext v15 + HRMS + symbolon_erpnext
docker exec symbolon-erpnext-backend-1 bench --site symbolon.localhost set-admin-password '<strong password>'
docker exec symbolon-erpnext-backend-1 bench --site symbolon.localhost set-config symbolon_approver_private_key '<APPROVER key>'
```

Then:
1. Run ERPNext's setup wizard (a USD company).
2. In **Symbolon Settings**, set the contract address and USDC account.
3. Give each Supplier or Employee a `symbolon_wallet`.

`demo_seed.run` does all three for a demo company. Put HTTPS in front of it (we use Caddy; see
`docs/deployments.md`).

From now on, **submitting** a Purchase Invoice, Payment Order or Payroll Entry registers it on-chain. A scheduler job
books a Payment Entry when the contract releases it.

## 3. Circle Mint (≈10 min)

1. Create a Mint account. We used the sandbox at app-sandbox.circle.com; production Mint requires KYB.
2. Register your **treasury wallet** (an ordinary EOA) as a recipient on chain `ARC`, and approve it in the console.
   Mint pays out native USDC, which a contract without a payable `receive()` cannot accept. That's why funding goes
   Mint → treasury → vault, and the witness checks both hops.
3. Put these in `.secrets/`:
   - `.secrets/mint.env`: `CIRCLE_MINT_KEY`, `MINT_TREASURY_RECIPIENT_ID`
   - `.secrets/treasury.env`: `TREASURY_PK`

## 4. The witness and the agent (≈5 min)

Add these to `.secrets/`:
- `.secrets/agent.env`: `ANTHROPIC_API_KEY`
- `.secrets/erpnext.env`: `ERPNEXT_URL`, `ERPNEXT_TOKEN`, an API key:secret for a user that can read Purchase Invoices.

```bash
pnpm install
scripts/services.sh agent --once --decide-only   # see the agent's decisions without touching the chain
scripts/services.sh witness                       # long-running
scripts/services.sh agent --once                  # decide and execute
```

We run the witness and the trial service under systemd, and the agent on a 6-hourly timer. The unit files are in
`docs/deployments.md`.

The model defaults to `claude-haiku-4-5`. Set `SYMBOLON_MODEL` (e.g. `claude-sonnet-5-5`) for stronger judgement.

## What you are trusting

- **The contract** enforces approval, witness, payee snapshot, cooldown, co-sign, cap, window and idempotency. Read
  `contracts/src/Symbolon.sol` and run `forge test`.
- **The witness** is independent of the *agent* (a separate key the contract keeps apart), but not of whoever runs it.
  Circle does not sign its API responses.
- **The agent's model** can be wrong or fooled. That is the point of the design: its output is an input, and the
  contract is the release condition.
