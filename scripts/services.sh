#!/usr/bin/env bash
# Run Symbolon's long-lived services from .secrets/ (never committed).
#   scripts/services.sh witness            # the witness loop
#   scripts/services.sh agent [--once] [--decide-only]
# Each service gets only its own key: the agent never sees the witness or approver key, and vice versa.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEC="$ROOT/.secrets"
key() { jq -r --arg r "$1" 'select(.role==$r).private_key' "$SEC/testnet-roles.jsonl"; }
set -a
. "$SEC/mint.env"
[ -f "$SEC/erpnext.env" ] && . "$SEC/erpnext.env"
set +a
export CHAIN_ID=5042002
export CLAIMS_DIR="$ROOT/.data/claims"
export TREASURY_ADDRESS="${TREASURY_ADDRESS:-0x676e9EacD4feB3322295ab5E399d7c316e26013b}"
mkdir -p "$CLAIMS_DIR"

case "${1:-}" in
  witness)
    export WITNESS_PK="$(key witness)" WITNESS_DATA_DIR="$ROOT/.data/witness" WITNESS_INTERVAL_MS="${WITNESS_INTERVAL_MS:-8000}"
    unset ERPNEXT_TOKEN ERPNEXT_ADMIN_PASSWORD
    cd "$ROOT/packages/witness" && exec npx tsx src/run.ts
    ;;
  agent)
    shift
    set -a; . "$SEC/agent.env"; set +a
    export AGENT_PK="$(key agent)" AGENT_DATA_DIR="$ROOT/.data/agent"
    # treasury key: forwards exactly a bill's amount from the Mint-funded treasury EOA into the vault
    export TREASURY_PK="${TREASURY_PK:-$(jq -r '.[0].private_key' "$ROOT/../.spike-wallet.json" 2>/dev/null || true)}"
    unset ERPNEXT_ADMIN_PASSWORD
    cd "$ROOT/packages/agent" && exec npx tsx src/run.ts "$@"
    ;;
  *) echo "usage: $0 witness | agent [--once] [--decide-only]"; exit 1 ;;
esac
