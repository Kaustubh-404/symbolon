# symbolon_erpnext: the ERPNext half of Symbolon

A Frappe app for **ERPNext v15**. It turns approved ERPNext documents into obligations on the Symbolon contract
(USDC on Arc Testnet, chain `5042002`, contract
[`0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9`](https://explorer.testnet.arc.io/address/0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9)).
It also writes releases back into the books as Payment Entries.

The essay's point 5 asks us to *"Route agent writes through the code the UI already uses. Return an idempotency
signal per row and support a dry run."* This app does that as follows:

| Requirement | Where |
|---|---|
| Same code path for UI, agent and API | The form buttons, `doc_events`, background jobs and the REST API all call `service.register / cancel / set_payee` |
| Idempotency signal per row | `registerObligation` returns `created`, and `registerBatch` returns `bool[] created`. Re-syncing identical terms gives `created=false`; changed terms give a `ConflictingRegistration` refusal. Payroll stores one flag per Salary Slip (`symbolon_created`) plus a JSON result on the Payroll Entry |
| Dry run | `symbolon_erpnext.api.dry_run(doctype, name)` returns the exact call (id, docHash, payeeId, amount, window, calldata). It runs an `eth_call` simulation from the approver address, which yields the per-row `created` it *would* return or the named refusal, and it returns `check(id)`. Nothing is signed |

Claims are tagged **[V]** verified (run in this repo), **[I]** inferred, or **[U]** unverified.

---

## Status

| | |
|---|---|
| Python ids / canonical JSON / docHash match the TypeScript SDK (`packages/sdk/src/ids.ts`) byte for byte, on 3 golden documents including unicode, escapes and UTF-16 key ordering | **[V]** `tests/test_pure_ids.py` |
| `obligationId("Purchase Invoice","ACC-PINV-SMOKE-0001")` = `0x34e4b5eab3451713981cb4f60dd79a244690088c740ae9ac3b815f22cbc2a68c` = `cast keccak "Purchase Invoice:ACC-PINV-SMOKE-0001"` | **[V]** |
| `registerObligation` / `registerBatch` calldata = `cast calldata` output; `Released` topic = `cast keccak` | **[V]** `tests/test_pure_chain.py` |
| Nonce-safe sender: journals before signing, never takes a new nonce on retry, replaces at the same nonce with at least +25% fees, refuses a reused key with different calldata, and refuses when an orphaned journal entry holds the next nonce | **[V]** against a fake RPC that models Arc's under-priced-tx wedge |
| Read-only calls to the live contract: `check()`, `getObligation()`, `payees()`, `hasRole()`, an `eth_call` simulation from the approver, and a chunked `eth_getLogs` scan | **[V]** `SYMBOLON_LIVE=1` tests. The smoke obligation is `Registered` and `check` returns `PayeeChangedRecently` |
| Install into a running ERPNext site, doc_events, buttons, scheduler write-back, Payment Entry creation | **[U]** Not exercised: the local Docker instance could not start (the disk was full, see [`docker/README.md`](docker/README.md)). The code targets the v15 APIs found in the `frappe/erpnext:v15` image (frappe 15.121.2, erpnext 15.121.6), e.g. `get_payment_entry(..., reference_date=)`, `filelock`, `enqueue(job_id=, deduplicate=)` |
| Sending a real transaction from the app | **[U]** No approver key was available, and the tests never send |

---

## Install on a hosted ERPNext v15

Requirements: ERPNext v15, Python 3.10+. `web3>=6.20,<8` is installed from `pyproject.toml`.

**Self-hosted bench**

```bash
cd ~/frappe-bench
bench get-app /path/to/symbolon/erpnext/symbolon_erpnext      # or a git URL of a repo containing only this folder
bench --site erp.example.com install-app symbolon_erpnext
bench --site erp.example.com migrate                           # syncs fixtures; creates HRMS fields if HRMS is installed
bench restart
```

**Frappe Cloud.** Frappe Cloud installs apps from a git repo whose root is the app. Publish `erpnext/symbolon_erpnext/`
as its own repo (e.g. `git subtree split --prefix erpnext/symbolon_erpnext`), add it under *Apps → Add App*, then
install it on the site. **[I]**

**Docker (frappe_docker).** Build a custom image with the app baked in. [`docker/Dockerfile`](docker/Dockerfile) does
this on top of `ghcr.io/frappe/hrms:version-15` (frappe + erpnext + hrms + payments) or `frappe/erpnext:v15`.

Payroll (Payroll Entry, Salary Slip) lives in the **HRMS** app in v15. Without HRMS, the Purchase Invoice, Payment
Order and Supplier flows still work. Purchase Invoice, Payment Order, Supplier and Employee custom fields ship as
**fixtures**. HRMS fields are created in `after_migrate`, and only when HRMS is installed, because a fixture for a
missing doctype would break `bench migrate`.

## Configure

1. **Symbolon Settings** (Single):

   | Field | Default | Meaning |
   |---|---|---|
   | Enabled | off | Turns on auto-register on submit, cancel on cancel, `setPayee` on wallet change, and the per-minute write-back |
   | Chain ID | `5042002` | Every RPC is checked against it; a wrong-chain RPC is skipped |
   | Contract Address | `0x06eA…2Eb9` | |
   | RPC URLs | `https://rpc.drpc.testnet.arc.io`, `https://rpc.testnet.arc.io`, `https://rpc.blockdaemon.testnet.arc.io` | Tried in order. Reads fail over; a signed raw tx is safe to resend through any of them |
   | Explorer URL | `https://explorer.testnet.arc.io` | |
   | Start Block / Last Processed Block | `65291963` (deploy block) | Write-back cursor |
   | Approver Private Key | — | **Password** field. Prefer site_config or env (below) |
   | Approver Address | derived | Without a key, dry runs simulate from it (default: the deployed approver `0x64C5…D710`) |
   | USDC Account | — | Bank-type, USD account representing the vault. Used as *Paid From* on write-back Payment Entries |
   | Mode of Payment | `USDC (Arc)` | Created by fixture |
   | Salary Due Days | 5 | `dueBy` for a Salary Slip = posting date + N days |
   | registerBatch Rows Per Tx | 50 | |

   Use **Test connection** to see the chain id, head block, and whether the approver holds `APPROVER`.

2. **Approver key.** Never put it in a file that could be committed. Precedence:
   1. `site_config.json` → `symbolon_approver_private_key`:
      `bench --site erp.example.com set-config symbolon_approver_private_key 0x…`.
      `sites/` is not part of the app repo, but check your backups.
   2. Environment variable `SYMBOLON_APPROVER_PRIVATE_KEY` in the web, worker and scheduler processes. The compose
      file passes it through from the shell.
   3. The Password field. It is encrypted at rest with the site's `encryption_key`.

   The key must hold **APPROVER** on the contract. The contract refuses to let one key be both AGENT and APPROVER
   (`RoleConflict`).

3. Put a **USDC Wallet (Arc)** on each Supplier and Employee that should be paid. On save, the app checksums the
   address (EIP-55; it rejects bad checksums and the zero address) and enqueues `setPayee`. It also shows a warning:
   *"Payments to this supplier pause for 24h — this is the bank-details-change defence."*

## What happens when

| Event | Action |
|---|---|
| Purchase Invoice **submit** | Validates synchronously. If it is not USD, is a return, or is *Is Paid*, it is marked **Refused** with the reason and the user sees a message; the ERPNext submit itself is never blocked. Otherwise `registerObligation` is enqueued after commit, deduplicated by job id |
| Purchase Invoice **cancel** | If **Registered**, `cancel(id)` is enqueued (only when on-chain status is still `Registered`) |
| Supplier / Employee **wallet change** | `setPayee(payeeId, wallet)`, which starts the 86400 s cooldown. Intent key `setPayee:<payeeId>:<wallet>:<modified-ts>`, so A→B→A is three intents |
| Salary Slips **submitted** by a Payroll Entry | One `registerBatch` per Payroll Entry, in chunks of `batch_size`, with one obligation per slip (doctype `Salary Slip`, payee `Employee:<employee>`, amount = `net_pay`). Per-row `created` comes from the receipt's `ObligationRegistered` logs and is stored on each slip; the full per-row result goes on the Payroll Entry |
| Payment Order **submit** | Each reference that resolves to a Purchase Invoice (directly or through its Payment Request) registers *that invoice's* obligation in one `registerBatch`. An invoice that is already registered comes back `created=false`, never as a second bill |
| Every minute (`cron * * * * *`) | Scans `Released / Cancelled / Expired` from `last_processed_block+1` in chunks of ≤ 9,000 blocks (eth_getLogs caps near 10k), at most 90k blocks per run, ordered by (block, logIndex). **Released** on a Purchase Invoice creates and submits a Payment Entry through ERPNext's own `get_payment_entry` (the code behind *Create → Payment*), with `reference_no` = release tx hash and mode `USDC (Arc)`. It is idempotent on the tx hash: if a non-cancelled Payment Entry with that `reference_no` exists, nothing is created. If the invoice has no outstanding amount (paid by hand), it creates nothing and flags a possible double payment. A failing event stops the cursor so it is retried, never skipped |

Salary Slip releases are written back as status + release tx only. Payroll accounting stays with HRMS's own
*Make Bank Entry*, to avoid double-booking. **[I]**

## API (the buttons call exactly this)

```bash
# What would be sent, simulated from the approver address. Signs nothing.
curl -s -H "Authorization: token $KEY:$SECRET" \
  "https://erp.example.com/api/method/symbolon_erpnext.api.dry_run?doctype=Purchase%20Invoice&name=ACC-PINV-2026-00001"

# Register now (needs submit permission on the document). Returns {created, tx, ...}; rows[] for batches.
curl -s -X POST -H "Authorization: token $KEY:$SECRET" \
  -d doctype="Payroll Entry" -d name="HR-PRUN-2026-00001" \
  https://erp.example.com/api/method/symbolon_erpnext.api.sync
```

`dry_run` returns `function`, `calldata`, `from`, `simulation` (`{ok, result, refusal}`), and per row: `id`,
`docHash`, `payee`, `payeeId`, `amount`, `notBefore`, `dueBy`, the hashed `record`, its `canonical_json`, the payee
wallet in ERPNext vs on-chain (with `cooldownEnds`), the on-chain obligation, `check` (`{raw, releasable, refusal}`),
and `would_create`. Refusals are decoded into the contract's named errors with a plain-English sentence (port of
`packages/sdk/src/refusals.ts`).

Form buttons: **Symbolon: Dry run** (any saved document) and **Symbolon: Register now** (submitted documents) on
Purchase Invoice, Salary Slip, Payroll Entry and Payment Order.

---

## Identifiers and the exact document that is hashed

Ids match `packages/sdk/src/ids.ts`:

- `obligationId = keccak256(utf8("<doctype>:<name>"))`, e.g. `Purchase Invoice:ACC-PINV-2026-00001`,
  `Salary Slip:Sal Slip/HR-EMP-00001/00001`.
- `payeeId = keccak256(utf8("<kind>:<id>"))`, e.g. `Supplier:ACME-001`, `Employee:HR-EMP-00001`.
- `docHash = keccak256(utf8(canonicalJson(record)))`. Canonical JSON = JS `JSON.stringify` of the record with keys
  sorted recursively and no whitespace. Python reproduces JS exactly:
  - `ensure_ascii=False`, separators `,` and `:`.
  - Keys are sorted by **UTF-16 code units** as JS `.sort()` does (e.g. `"😀"` sorts before `"Ａ"`).
  - **Floats are refused.** Every money value is an integer string in USDC base units.
  - Integers above 2^53−1 are refused.

**Amounts:** USDC has 6 decimals, so `amount = dollars × 10^6`, exact. More than 6 decimal places, zero or negative
is refused. The **document currency must be USD**; anything else is refused with *"…only registers documents whose
currency is USD…"*.

**Window:** `notBefore` = 00:00:00 UTC of the start date, and `dueBy` = 23:59:59 UTC of the due date.

### Purchase Invoice (`symbolon_schema: "erpnext-v15/purchase-invoice/1"`)

| Key | Source |
|---|---|
| `symbolon_schema` | constant |
| `doctype` | `"Purchase Invoice"` |
| `name` | `name` |
| `company` | `company` |
| `supplier` | `supplier` |
| `payee_id` | `"Supplier:<supplier>"` (the preimage, not the hash) |
| `bill_no` | `bill_no` or `null` |
| `bill_date` | `bill_date` (`YYYY-MM-DD`) or `null` |
| `posting_date` | `posting_date` |
| `due_date` | `due_date`, else `posting_date` |
| `currency` | `"USD"` (anything else is refused) |
| `amount_usdc6` | payable = (`rounded_total`, or `grand_total` if rounding is disabled or empty) − `total_advance` − `write_off_amount`, as a 6-dp integer string |
| `not_before` | 00:00 UTC of `symbolon_not_before` (custom field *Pay No Earlier Than*), else `posting_date` |
| `due_by` | 23:59:59 UTC of `due_date` |
| `items[]` | per row: `idx`, `item_code` (or `null`), `qty` (normalised decimal string, `"10"`, `"2.5"`), `amount_usdc6` |
| `attachment_sha256` | **only if** a PDF is attached: `0x` + sha256 of the **earliest-attached** `.pdf` File's bytes. A later attachment does not change the hash |

### Salary Slip (`symbolon_schema: "erpnext-v15/salary-slip/1"`)

| Key | Source |
|---|---|
| `symbolon_schema`, `doctype` (`"Salary Slip"`), `name`, `company`, `employee` | as named |
| `payee_id` | `"Employee:<employee>"` |
| `payroll_entry` | `payroll_entry` or `null` |
| `start_date`, `end_date`, `posting_date` | dates (`posting_date` falls back to `end_date`) |
| `currency` | `"USD"` |
| `amount_usdc6` | `net_pay` |
| `not_before` / `due_by` | 00:00 UTC of `posting_date` / 23:59:59 UTC of `posting_date + Salary Due Days` |
| `earnings[]`, `deductions[]` | `salary_component`, `amount_usdc6` |

Deliberately **not** hashed, because they change after submit: `status`, `outstanding_amount`, `modified`, `docstatus`,
all `symbolon_*` tracking fields, item `rate` (which can carry more than 6 decimals). Re-syncing a submitted document
therefore always gives the same docHash. A real change after approval surfaces as `ConflictingRegistration`, which is
the correct, loud outcome.

---

## Transactions on Arc (chain.py)

- **Fees:** `maxFeePerGas = max(2 × baseFee, 30 gwei)` (base clamped to Arc's 20 gwei floor), priority 1 gwei. An
  under-priced tx with an explicit gas limit is accepted by Arc's RPC, never mines, and holds the nonce
  (`docs/platform-notes.md`, test 4b).
- **Nonce journal (`Symbolon Intent`, keyed by intent key):**
  - Keys: `register:<id>`, `cancel:<id>`, `setPayee:<payeeId>:<wallet>:<ts>`,
    `registerBatch:<doctype>:<name>:<chunk>`.
  - The row is committed **before signing**. Each signed hash is committed **before broadcasting** it.
  - A retry of a journaled intent never takes a new nonce. It checks receipts of every journaled hash. If none has
    mined and the nonce is still free, it re-signs **the same calldata at the same nonce** with +25% fees (up to 2
    replacements per call), then reports `Stuck`.
  - A reused key with different calldata is refused (`IntentConflict`).
  - If an orphaned `Signing` row holds the next nonce, new intents are refused (`NonceHeld`) until that intent is
    retried.
  - If the nonce was consumed by an unjournaled tx, the intent is marked `Failed` loudly. The sender never guesses.
  - Sends from one key are serialised with a site file lock.
- **Simulate first:** gas estimation runs before any nonce is taken. A refusal (e.g. `UnknownPayee`,
  `ConflictingRegistration`, `NotAuthorized`) costs nothing, is decoded, and lands in `symbolon_last_refusal`.
- **web3.py** 6.20–7.x. Tested with 7.16.0. Calldata and log decoding go through `eth_abi` directly, so they do not
  depend on web3's changing contract API.
- The ABI is copied from `contracts/out/Symbolon.sol/Symbolon.json` to `symbolon_erpnext/abi.json`. Refresh it after
  a contract change:
  `python3 -c "import json;json.dump(json.load(open('contracts/out/Symbolon.sol/Symbolon.json'))['abi'],open('erpnext/symbolon_erpnext/symbolon_erpnext/abi.json','w'),indent=1)"`

---

## frappe/erpnext#54768

ERPNext issue **#54768, "Stablecoin Batch Payout Integration for Payroll & Payment Orders"**, asks for batch
stablecoin payouts from Payroll Entry and Payment Order. This app is a concrete answer, with one difference in
design: ERPNext does not hold a hot wallet that pays.

- A Payroll Entry becomes one `registerBatch` with **one obligation per Salary Slip** and a per-row `created` flag.
- A Payment Order becomes a `registerBatch` of the invoices it pays.

The approver registers obligations; the payout itself (`release`) only happens on-chain when the document half and an
independent witness half fit. The payout comes back into ERPNext as a Payment Entry keyed by the release tx hash.

---

## Tests

```bash
cd erpnext/symbolon_erpnext
python -m venv .venv && .venv/bin/pip install "web3>=6.20,<8" pytest
.venv/bin/python -m pytest -q                       # 46 pure tests, no site, no network
SYMBOLON_LIVE=1 .venv/bin/python -m pytest -q -k Live   # + 5 read-only calls to the live contract (never sends)
```

Regenerate the cross-language goldens from the TypeScript SDK (Node ≥ 22.18 strips TS types natively; it resolves
`viem` from `packages/sdk/node_modules`):

```bash
node symbolon_erpnext/tests/golden/gen_goldens.mjs   # writes tests/golden/goldens.json from packages/sdk/src/ids.ts
```

`tests/golden/documents.json` holds three documents:

1. a Purchase Invoice record, which the Python builder must reproduce from a fake ERPNext doc;
2. a Salary Slip record (same);
3. an adversarial object with unicode, escapes, control chars, an astral key vs a fullwidth key, nested arrays,
   `null`/booleans and 2^53−1.

## Layout

```
erpnext/
  README.md                         this file
  docker/                           compose + Dockerfile + how the local instance is (meant to be) run
  symbolon_erpnext/                 the Frappe app (bench get-app this folder)
    pyproject.toml                  flit; depends on web3
    symbolon_erpnext/
      hooks.py                      fixtures, doc_events, doctype_js, cron write-back
      ids.py                        ids, canonical JSON, docHash, amounts, windows, addresses (pure)
      documents.py                  ERPNext doc -> hashed record (pure; the spec above)
      chain.py                      RPC fallback, ABI encode/decode, log scan, NonceSafeSender (pure)
      refusals.py                   named-error decoding (pure)
      service.py                    Frappe glue: settings, Symbolon Intent journal, register/cancel/setPayee, dry run
      api.py                        whitelisted dry_run / sync / check / poll_now
      events.py                     doc_events -> enqueue service calls
      tasks.py                      per-minute write-back (Released -> Payment Entry)
      install.py, custom_fields.py  HRMS fields in after_migrate
      fixtures/                     Custom Fields (core doctypes), Mode of Payment "USDC (Arc)"
      symbolon/doctype/             Symbolon Settings (Single), Symbolon Intent (journal)
      public/js/                    form buttons, wallet-change warning
      abi.json                      copied from contracts/out
      tests/                        pure + opt-in live read-only tests, goldens
```
