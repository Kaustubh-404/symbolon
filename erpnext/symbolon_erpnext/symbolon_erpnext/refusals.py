"""Decode Symbolon's named custom errors into a sentence a non-crypto reader understands.

Port of packages/sdk/src/refusals.ts. Pure (no Frappe); needs eth_abi / eth_utils (installed with web3).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from eth_abi import decode as abi_decode
from eth_utils import keccak

ABI_PATH = Path(__file__).with_name("abi.json")
STATUS = ["none", "registered", "released", "cancelled", "expired"]
ACTION = ["none", "pay", "hold", "escalate"]


@lru_cache(maxsize=1)
def abi() -> list:
	return json.loads(ABI_PATH.read_text())


def _type_str(inp: dict) -> str:
	t = inp["type"]
	if t.startswith("tuple"):
		inner = ",".join(_type_str(c) for c in inp["components"])
		return f"({inner}){t[5:]}"
	return t


@lru_cache(maxsize=1)
def _errors() -> dict[bytes, dict]:
	out = {}
	for item in abi():
		if item.get("type") != "error":
			continue
		types = [_type_str(i) for i in item.get("inputs", [])]
		sig = f"{item['name']}({','.join(types)})"
		out[keccak(text=sig)[:4]] = {"name": item["name"], "types": types}
	return out


def _usd(v) -> str:
	return f"${(Decimal(int(v)) / Decimal(10**6)).normalize():f}"


def _when(v) -> str:
	return datetime.fromtimestamp(int(v), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _status(v) -> str:
	i = int(v)
	return STATUS[i] if 0 <= i < len(STATUS) else "settled"


HUMAN = {
	"NotRegistered": lambda a: "No approved bill with this id exists. The agent cannot pay what a human did not approve.",
	"AlreadySettled": lambda a: f"This bill is already {_status(a[1])}. A retry cannot pay it twice.",
	"NoDecisionCommitted": lambda a: "The agent has not committed a decision for this bill yet.",
	"DecisionNotPay": lambda a: f'The agent\'s committed decision is "{ACTION[int(a[1])]}", not "pay".',
	"DecisionSameBlock": lambda a: "The decision must be committed at least one block before the payment.",
	"WitnessMissing": lambda a: "No independent witness has confirmed the money for this bill arrived.",
	"WitnessMismatch": lambda a: f"The witness saw {_usd(a[1])} arrive, but the bill is for {_usd(a[2])}.",
	"AlreadyWitnessed": lambda a: "This bill already has a witness attestation.",
	"Unfunded": lambda a: f"The vault holds {_usd(a[0])}; reserving this bill would need {_usd(a[1])}.",
	"TooEarly": lambda a: f"This bill may not be paid before {_when(a[1])}.",
	"PastDue": lambda a: f"The window to pay this bill closed at {_when(a[1])}.",
	"NotYetExpirable": lambda a: f"This bill can only be expired after {_when(a[1])}.",
	"PayeeMismatch": lambda a: f"The payee's wallet changed after the bill was approved ({a[1]} -> {a[2]}).",
	"PayeeChangedRecently": lambda a: (
		f"This payee's wallet was changed recently. Payments resume at {_when(a[1])}, giving a human time to notice."
	),
	"NeedsCosign": lambda a: (
		f"Bills above {_usd(a[2])}, or ones the agent escalates, need a human co-signature (this one is {_usd(a[1])})."
	),
	"OverPeriodCap": lambda a: f"Paying this would bring today's total to {_usd(a[0])}, over the {_usd(a[1])} cap.",
	"RedeemExceedsSurplus": lambda a: f"Only {_usd(a[1])} is unreserved; the agent tried to redeem {_usd(a[0])}.",
	"ConflictingRegistration": lambda a: (
		"A bill with this id is already registered with different terms. The document changed after it was "
		"approved on-chain; cancel and amend it instead of editing it."
	),
	"NotAuthorized": lambda a: f"{a[1]} does not hold the role this action needs (the approver key is not an APPROVER).",
	"RoleConflict": lambda a: f"{a[2]} already holds a conflicting role. The agent can never also approve, witness or cosign.",
	"Paused": lambda a: "A guardian has paused all payments.",
	"ZeroAmount": lambda a: "Amount must be greater than zero.",
	"InvalidWindow": lambda a: "The pay window ends before it starts.",
	"UnknownPayee": lambda a: (
		"This payee has no wallet on-chain yet. Set the wallet on the Supplier/Employee first "
		"(that starts the 24h payee cooldown)."
	),
	"ZeroAddress": lambda a: "Address must not be zero.",
	"TransferFailed": lambda a: "The USDC transfer failed.",
}


def _jsonable(v):
	if isinstance(v, bytes):
		return "0x" + v.hex()
	if isinstance(v, list | tuple):
		return [_jsonable(x) for x in v]
	if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2**53:
		return str(v)
	return v


def to_bytes(data) -> bytes:
	if data is None:
		return b""
	if isinstance(data, bytes | bytearray):
		return bytes(data)
	s = str(data)
	if s.startswith("0x") or s.startswith("0X"):
		s = s[2:]
	return bytes.fromhex(s)


def decode_refusal(data) -> dict | None:
	"""Revert data (bytes or 0x-hex) -> {name, args, human, raw}. Empty data -> None (no refusal)."""
	raw = to_bytes(data)
	if not raw:
		return None
	err = _errors().get(raw[:4])
	if not err:
		return {"name": "Unknown", "args": ["0x" + raw.hex()], "human": f"Unrecognised revert data 0x{raw[:4].hex()}", "raw": "0x" + raw.hex()}
	args = list(abi_decode(err["types"], raw[4:])) if err["types"] else []
	fn = HUMAN.get(err["name"])
	return {
		"name": err["name"],
		"args": _jsonable(args),
		"human": fn(args) if fn else err["name"],
		"raw": "0x" + raw.hex(),
	}


def format_refusal(r: dict | None) -> str:
	return "" if not r else f"{r['name']}: {r['human']}"
