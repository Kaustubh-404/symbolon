#!/usr/bin/env bash
# Seeds the /break-it fixtures: demo obligations frozen in a state the contract must refuse. Each /break-it button
# sends a REAL release() for one of them with a dedicated demo AGENT key, so every press is a mined refusal.
# Funding is real: one Circle Mint sandbox transfer into the vault, attested by the WITNESS key.
# Usage: scripts/seed-break-it.sh   (reads keys from .secrets/, writes apps/web/src/lib/break-it.json)
set -euo pipefail
cd "$(dirname "$0")/.."
R=${R:-https://rpc.drpc.testnet.arc.io}
S=$(jq -r .symbolon contracts/deployments/5042002.json)
key() { jq -r --arg r "$1" 'select(.role==$r).private_key' .secrets/testnet-roles.jsonl; }
set -a; . .secrets/mint.env; set +a
tx() { local pk=$1; shift; for i in 1 2 3; do out=$(cast send "$S" "$@" --private-key "$pk" --rpc-url "$R" --gas-price 30gwei --priority-gas-price 1gwei --json 2>/dev/null) && { jq -r .transactionHash <<<"$out"; return; }; sleep 3; done; echo "FAILED: $*" >&2; exit 1; }
id() { cast keccak "Demo:$1"; }
NOW=$(date +%s); DUE=$((NOW + 365*86400))
VENDOR=$(cast keccak "Supplier:TEST-VENDOR-01")   # wallet set 2026-10-03, cooldown long past
SWAP=$(cast keccak "Supplier:DEMO-SWAP")

# 1. Fund the vault from Circle Mint, in two hops. Measured 2026-10-09: Mint sandbox transfers on ARC to a CONTRACT
#    address fail with errorCode "blockchain_error"; to an EOA they complete in ~10s. So Mint pays the treasury EOA,
#    and the treasury forwards the exact amount into the vault. The witness checks both hops.
#    Total: 0.10 (retry) + 0.90 (short) + 30.00 (cosign) + 0.10 (swap) = 31.10
TREASURY_PK=$(jq -r '.[0].private_key' ../.spike-wallet.json)
TREASURY=$(cast wallet address --private-key "$TREASURY_PK")
RID=$(curl -sS https://api-sandbox.circle.com/v1/businessAccount/wallets/addresses/recipient -H "Authorization: Bearer $CIRCLE_MINT_KEY" | jq -r --arg a "$(tr A-F a-f <<<"$TREASURY")" '.data[] | select(.address==$a and .status=="active") | .id')
T=$(curl -sS -X POST https://api-sandbox.circle.com/v1/businessAccount/transfers -H "Authorization: Bearer $CIRCLE_MINT_KEY" -H "Content-Type: application/json" \
  -d "{\"idempotencyKey\":\"$(python3 -c 'import uuid;print(uuid.uuid5(uuid.NAMESPACE_URL,"symbolon-breakit-funding-v2"))')\",\"destination\":{\"type\":\"verified_blockchain\",\"addressId\":\"$RID\"},\"amount\":{\"currency\":\"USD\",\"amount\":\"31.10\"}}")
TID=$(jq -r .data.id <<<"$T"); echo "mint transfer $TID -> treasury $TREASURY"
for i in $(seq 1 30); do RAW=$(curl -sS https://api-sandbox.circle.com/v1/businessAccount/transfers/$TID -H "Authorization: Bearer $CIRCLE_MINT_KEY"); MTX=$(jq -r '.data.transactionHash // empty' <<<"$RAW"); [ -n "$MTX" ] && break; sleep 5; done
[ -n "$MTX" ] || { echo "no mint tx: $RAW"; exit 1; }
cast receipt "$MTX" --rpc-url "$R" >/dev/null; echo "hop 1 (Circle -> treasury) $MTX"
FTX=$(cast send 0x3600000000000000000000000000000000000000 'transfer(address,uint256)' "$S" 31100000 --private-key "$TREASURY_PK" --rpc-url "$R" --gas-price 30gwei --priority-gas-price 1gwei --json | jq -r .transactionHash)
echo "hop 2 (treasury -> vault) $FTX"
DIGEST=$(printf '%s' "$RAW" | sha256sum | cut -d' ' -f1)

reg() { tx "$(key approver)" 'registerObligation(bytes32,bytes32,bytes32,uint128,uint64,uint64)' "$1" "$(cast keccak "doc:$2")" "$3" "$4" "$NOW" "$DUE"; }
wit() { tx "$(key witness)" 'attestWitness(bytes32,uint128,bytes32,bytes32)' "$1" "$2" "$FTX" "0x$DIGEST"; }
dec() { tx "$(key agent)" 'commitDecision(bytes32,uint8,bytes32)' "$1" "$2" "$(cast keccak "demo-decision:$1:$2")"; }

# retry: paid once for real; every press afterwards is a retry → AlreadySettled
reg "$(id RETRY)" RETRY "$VENDOR" 100000; wit "$(id RETRY)" 100000; dec "$(id RETRY)" 1; sleep 2
PAID=$(tx "$(key agent)" 'release(bytes32)' "$(id RETRY)"); echo "retry fixture paid once: $PAID"
# phantom: decided Pay, nobody independent saw money arrive → WitnessMissing
reg "$(id PHANTOM)" PHANTOM "$VENDOR" 100000; dec "$(id PHANTOM)" 1
# short: bill $1.00, witness saw $0.90 → WitnessMismatch
reg "$(id SHORT)" SHORT "$VENDOR" 1000000; wit "$(id SHORT)" 900000; dec "$(id SHORT)" 1
# cosign: $30 is over the $25 threshold and no human signed → NeedsCosign
reg "$(id COSIGN)" COSIGN "$VENDOR" 30000000; wit "$(id COSIGN)" 30000000; dec "$(id COSIGN)" 1
# hold: the agent decided Hold → DecisionNotPay
reg "$(id HOLD)" HOLD "$VENDOR" 100000; dec "$(id HOLD)" 2
# swap: "our bank details have changed" — wallet swapped after approval → PayeeMismatch
tx "$(key approver)" 'setPayee(bytes32,address)' "$SWAP" 0x676e9EacD4feB3322295ab5E399d7c316e26013b >/dev/null
reg "$(id BANK-DETAILS-CHANGED)" SWAP "$SWAP" 100000; wit "$(id BANK-DETAILS-CHANGED)" 100000; dec "$(id BANK-DETAILS-CHANGED)" 1
tx "$(key approver)" 'setPayee(bytes32,address)' "$SWAP" 0x000000000000000000000000000000000000bEEF >/dev/null

jq -n --arg retry "$(id RETRY)" --arg phantom "$(id PHANTOM)" --arg short "$(id SHORT)" --arg cosign "$(id COSIGN)" \
  --arg hold "$(id HOLD)" --arg swap "$(id BANK-DETAILS-CHANGED)" --arg ghost "$(id NEVER-APPROVED)" \
  --arg ftx "$FTX" --arg mtx "$MTX" --arg tid "$TID" --arg paid "$PAID" \
  '{fundingTx:$ftx, mintTx:$mtx, mintTransferId:$tid, retryFirstPayment:$paid, fixtures:{retry:$retry, phantom:$phantom, short:$short, cosign:$cosign, hold:$hold, swap:$swap, ghost:$ghost}}' \
  > apps/web/src/lib/break-it.json
echo "--- dry runs"; for k in retry phantom short cosign hold swap ghost; do i=$(jq -r ".fixtures.$k" apps/web/src/lib/break-it.json); echo "$k $(cast call "$S" 'check(bytes32)(bytes)' "$i" --rpc-url "$R" | cut -c1-10)"; done
