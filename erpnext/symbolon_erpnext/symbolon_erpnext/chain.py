"""Arc access from Python: RPC fallback, Symbolon contract reads, log scanning, and a nonce-safe sender.

No Frappe import here. The Frappe-backed journal lives in `service.py`; tests use `MemoryJournal` and a fake RPC.

Arc facts this module encodes (measured, see docs/platform-notes.md in the monorepo):
  * The minimum base fee is 20 gwei. A tx priced under the base fee that skips gas estimation is ACCEPTED by the RPC,
    returns a hash, never mines and holds its nonce. Every later tx from that key stalls behind it.
    => fees: maxFeePerGas = max(2 x baseFee, 30 gwei), priority 1 gwei.
    => recovery: only ever replace at the SAME nonce with +25% fees; never take a fresh nonce for the same intent.
  * eth_getLogs is capped near 10,000 blocks => scan in chunks of at most 9,000.
  * Public RPCs sit behind load balancers at different heights and reset connections under load => fail over.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable, Iterable, Protocol

from eth_abi import decode as abi_decode
from eth_utils import keccak, to_checksum_address

from .refusals import abi as load_abi
from .refusals import decode_refusal, to_bytes

GWEI = 10**9
MIN_BASE_FEE_WEI = 20 * GWEI
FEE_FLOOR = 30 * GWEI
PRIORITY_FEE = 1 * GWEI
MAX_LOG_RANGE = 9_000
ARC_TESTNET_CHAIN_ID = 5042002
DEFAULT_RPCS = [
	"https://rpc.drpc.testnet.arc.io",
	"https://rpc.testnet.arc.io",
	"https://rpc.blockdaemon.testnet.arc.io",
]
DEFAULT_CONTRACT = "0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9"
DEFAULT_APPROVER = "0x64C5B8fbC01bA4466ec95b4C3b74EFa34922D710"  # contracts/deployments/5042002.json
DEFAULT_START_BLOCK = 65291963  # deployBlock of the contract above
DEFAULT_EXPLORER = "https://explorer.testnet.arc.io"
STATUS = ["None", "Registered", "Released", "Cancelled", "Expired"]
ACTION = ["None", "Pay", "Hold", "Escalate"]


# ─────────────────────────────────────────────────────────────── fees (pure)


def fee_policy(base_fee: int | None) -> tuple[int, int]:
	"""(maxFeePerGas, maxPriorityFeePerGas): never under Arc's floor, always headroom for a base-fee rise."""
	base = max(int(base_fee or 0), MIN_BASE_FEE_WEI)
	return max(2 * base, FEE_FLOOR), PRIORITY_FEE


def bump_fees(prev_max: int, prev_prio: int, base_fee: int | None) -> tuple[int, int]:
	"""Same-nonce replacement: +25% on both fields (nodes require >= +10%), and never below a fresh quote."""
	fresh_max, _ = fee_policy(base_fee)
	bumped_max = int(prev_max) * 125 // 100 + 1
	bumped_prio = int(prev_prio) * 125 // 100 + 1
	return max(bumped_max, fresh_max), bumped_prio


# ─────────────────────────────────────────────────────────────── RPC with fallback


class ChainError(Exception):
	pass


class Reverted(ChainError):
	"""A call or gas estimate reverted with Symbolon revert data (decoded in .refusal)."""

	def __init__(self, data: bytes, message: str = ""):
		self.data = data
		self.refusal = decode_refusal(data)
		super().__init__(self.refusal["name"] + ": " + self.refusal["human"] if self.refusal else (message or "reverted"))


_TRANSIENT_HINTS = ("timeout", "timed out", "rate", "limit", "unavailable", "header not found", "-32012", "502", "503", "504", "connection")


def _is_transient(e: Exception) -> bool:
	import requests

	if isinstance(e, requests.exceptions.RequestException | OSError | TimeoutError):
		return True
	return any(h in str(e).lower() for h in _TRANSIENT_HINTS)


def _revert_data(e: Exception) -> bytes | None:
	"""Pull raw revert bytes out of whatever exception web3 v6/v7 raised."""
	for attr in ("data",):
		d = getattr(e, attr, None)
		if isinstance(d, dict):
			d = d.get("data")
		if isinstance(d, bytes | bytearray) and d:
			return bytes(d)
		if isinstance(d, str) and d.startswith("0x") and len(d) >= 10:
			try:
				return to_bytes(d)
			except ValueError:
				pass
	# RPC error dict carried in args: {'code': 3, 'message': 'execution reverted', 'data': '0x...'}
	for a in getattr(e, "args", ()):
		if isinstance(a, dict) and isinstance(a.get("data"), str) and a["data"].startswith("0x") and len(a["data"]) >= 10:
			return to_bytes(a["data"])
	return None


class Rpc:
	"""A list of Web3 instances tried in order. Reads fail over; a signed raw tx is safe to resend anywhere."""

	def __init__(self, urls: Iterable[str], chain_id: int, timeout: int = 15):
		from web3 import Web3

		self.urls = [u.strip() for u in urls if u and u.strip()]
		if not self.urls:
			raise ChainError("no RPC URLs configured")
		self.chain_id = int(chain_id)
		self._w3 = [Web3(Web3.HTTPProvider(u, request_kwargs={"timeout": timeout})) for u in self.urls]
		self._verified: set[int] = set()

	def run(self, fn: Callable, what: str = "rpc"):
		last: Exception | None = None
		for i, w3 in enumerate(self._w3):
			try:
				if i not in self._verified:
					cid = int(w3.eth.chain_id)
					if cid != self.chain_id:
						raise ChainError(f"{self.urls[i]} is chain {cid}, expected {self.chain_id}")
					self._verified.add(i)
				return fn(w3)
			except Reverted:
				raise
			except ChainError as e:
				last = e
				continue
			except Exception as e:  # noqa: BLE001
				data = _revert_data(e)
				if data:
					raise Reverted(data, str(e)) from e
				if not _is_transient(e):
					raise
				last = e
				continue
		raise ChainError(f"{what}: all RPCs failed ({last})")

	# minimal eth surface used by the sender (also what tests fake)
	def nonce(self, address: str, tag: str) -> int:
		return int(self.run(lambda w3: w3.eth.get_transaction_count(address, tag), "nonce"))

	def base_fee(self) -> int:
		return int(self.run(lambda w3: w3.eth.get_block("latest").get("baseFeePerGas") or MIN_BASE_FEE_WEI, "base fee"))

	def estimate_gas(self, tx: dict) -> int:
		return int(self.run(lambda w3: w3.eth.estimate_gas(tx), "estimate gas"))

	def send_raw(self, raw: bytes) -> str:
		def go(w3):
			try:
				return "0x" + bytes(w3.eth.send_raw_transaction(raw)).hex()
			except Exception as e:  # noqa: BLE001
				if "already known" in str(e).lower():
					return None  # this exact signed tx is already in the pool: success
				raise

		return self.run(go, "send raw tx")

	def receipt(self, tx_hash: str) -> dict | None:
		def go(w3):
			from web3.exceptions import TransactionNotFound

			try:
				r = w3.eth.get_transaction_receipt(tx_hash)
			except TransactionNotFound:
				return None
			return dict(r) if r else None

		return self.run(go, "receipt")

	def block_number(self) -> int:
		return int(self.run(lambda w3: w3.eth.block_number, "block number"))

	def block_timestamp(self, number: int) -> int:
		return int(self.run(lambda w3: w3.eth.get_block(number)["timestamp"], "block"))

	def get_logs(self, params: dict) -> list:
		return list(self.run(lambda w3: w3.eth.get_logs(params), "get logs"))

	def call(self, tx: dict) -> bytes:
		return bytes(self.run(lambda w3: w3.eth.call(tx), "eth_call"))


# ─────────────────────────────────────────────────────────────── contract surface


def _type_str(inp: dict) -> str:
	t = inp["type"]
	if t.startswith("tuple"):
		return "(" + ",".join(_type_str(c) for c in inp["components"]) + ")" + t[5:]
	return t


def _abi_item(kind: str, name: str) -> dict:
	for it in load_abi():
		if it.get("type") == kind and it.get("name") == name:
			return it
	raise KeyError(f"{kind} {name} not in ABI")


def selector(fn_name: str) -> bytes:
	it = _abi_item("function", fn_name)
	return keccak(text=f"{fn_name}({','.join(_type_str(i) for i in it['inputs'])})")[:4]


def encode_call(fn_name: str, args: list) -> str:
	from eth_abi import encode

	it = _abi_item("function", fn_name)
	types = [_type_str(i) for i in it["inputs"]]
	return "0x" + (selector(fn_name) + encode(types, [_norm_arg(a) for a in args])).hex()


def decode_output(fn_name: str, data: bytes):
	it = _abi_item("function", fn_name)
	types = [_type_str(o) for o in it["outputs"]]
	out = abi_decode(types, data)
	return out[0] if len(out) == 1 else out


def _norm_arg(a):
	if isinstance(a, str) and a.startswith("0x") and len(a) == 66:
		return bytes.fromhex(a[2:])
	if isinstance(a, list | tuple):
		return type(a)(_norm_arg(x) for x in a) if isinstance(a, tuple) else [_norm_arg(x) for x in a]
	return a


def event_topic(name: str) -> str:
	it = _abi_item("event", name)
	return "0x" + keccak(text=f"{name}({','.join(_type_str(i) for i in it['inputs'])})").hex()


def decode_log(log: dict) -> dict | None:
	"""Decode one Symbolon log (Released / Cancelled / Expired / ObligationRegistered / PayeeSet)."""
	topics = ["0x" + bytes(t).hex() if not isinstance(t, str) else t for t in log["topics"]]
	if not topics:
		return None
	for name in ("Released", "Cancelled", "Expired", "ObligationRegistered", "PayeeSet"):
		if topics[0].lower() != event_topic(name):
			continue
		it = _abi_item("event", name)
		indexed = [i for i in it["inputs"] if i["indexed"]]
		plain = [i for i in it["inputs"] if not i["indexed"]]
		args = {}
		for inp, t in zip(indexed, topics[1:]):
			raw = to_bytes(t)
			args[inp["name"]] = (
				to_checksum_address("0x" + raw[-20:].hex()) if inp["type"] == "address" else "0x" + raw.hex()
			)
		vals = abi_decode([_type_str(i) for i in plain], to_bytes(log["data"])) if plain else []
		for inp, v in zip(plain, vals):
			args[inp["name"]] = "0x" + v.hex() if isinstance(v, bytes) else (to_checksum_address(v) if inp["type"] == "address" else v)
		txh = log["transactionHash"]
		return {
			"event": name,
			"args": args,
			"blockNumber": int(log["blockNumber"]),
			"logIndex": int(log["logIndex"]),
			"transactionHash": txh if isinstance(txh, str) else "0x" + bytes(txh).hex(),
		}
	return None


def chunk_ranges(start: int, end: int, size: int = MAX_LOG_RANGE) -> list[tuple[int, int]]:
	"""Inclusive [from, to] ranges of at most `size` blocks covering start..end."""
	if size < 1 or size > MAX_LOG_RANGE:
		raise ValueError(f"chunk size must be 1..{MAX_LOG_RANGE}")
	out, a = [], start
	while a <= end:
		b = min(a + size - 1, end)
		out.append((a, b))
		a = b + 1
	return out


class Symbolon:
	def __init__(self, rpc: Rpc, address: str):
		self.rpc = rpc
		self.address = to_checksum_address(address)

	def _call(self, fn: str, args: list, sender: str | None = None):
		tx = {"to": self.address, "data": encode_call(fn, args)}
		if sender:
			tx["from"] = to_checksum_address(sender)
		return decode_output(fn, self.rpc.call(tx))

	def check(self, oid: str) -> dict:
		raw = self._call("check", [oid])
		r = decode_refusal(raw)
		return {"raw": "0x" + bytes(raw).hex(), "releasable": r is None, "refusal": r}

	def get_obligation(self, oid: str) -> dict:
		o = self._call("getObligation", [oid])
		keys = [c["name"] for c in _abi_item("function", "getObligation")["outputs"][0]["components"]]
		d = dict(zip(keys, o))
		out = {}
		for k, v in d.items():
			out[k] = "0x" + v.hex() if isinstance(v, bytes) else (str(v) if isinstance(v, int) and not isinstance(v, bool) and v > 2**53 else v)
		out["status"] = STATUS[int(d["status"])]
		out["action"] = ACTION[int(d["action"])]
		return out

	def payee(self, pid: str) -> dict:
		wallet, changed_at = self._call("payees", [pid])
		cooldown = int(self._call("payeeCooldown", []))
		return {
			"wallet": None if int(wallet, 16) == 0 else to_checksum_address(wallet),
			"changedAt": int(changed_at),
			"cooldownEnds": int(changed_at) + cooldown if int(changed_at) else None,
			"cooldownSeconds": cooldown,
		}

	def has_role(self, role_name: str, account: str) -> bool:
		role = keccak(text=role_name)
		return bool(self._call("hasRole", [role, to_checksum_address(account)]))

	def simulate(self, fn: str, args: list, sender: str) -> dict:
		"""eth_call the write from the approver's address: the exact result or refusal, without sending."""
		try:
			return {"ok": True, "result": _plain(self._call(fn, args, sender)), "refusal": None}
		except Reverted as e:
			return {"ok": False, "result": None, "refusal": e.refusal}

	def events(self, from_block: int, to_block: int, names=("Released", "Cancelled", "Expired")) -> list[dict]:
		topics = [[event_topic(n) for n in names]]
		out = []
		for a, b in chunk_ranges(from_block, to_block):
			logs = self.rpc.get_logs({"address": self.address, "fromBlock": a, "toBlock": b, "topics": topics})
			out.extend(x for x in (decode_log(dict(lg)) for lg in logs) if x)
		out.sort(key=lambda e: (e["blockNumber"], e["logIndex"]))
		return out


def _plain(v):
	if isinstance(v, bytes):
		return "0x" + v.hex()
	if isinstance(v, list | tuple):
		return [_plain(x) for x in v]
	return v


def receipt_events(receipt: dict) -> list[dict]:
	out = []
	for lg in receipt.get("logs") or []:
		d = decode_log(dict(lg))
		if d:
			out.append(d)
	return out


# ─────────────────────────────────────────────────────────────── nonce-safe sender


class IntentConflict(ChainError):
	pass


class NonceHeld(ChainError):
	pass


class StuckTransaction(ChainError):
	pass


@dataclass
class Intent:
	key: str
	from_address: str
	to_address: str
	calldata: str
	nonce: int
	gas: int
	max_fee_per_gas: int
	max_priority_fee_per_gas: int
	hashes: list[str] = field(default_factory=list)
	status: str = "Signing"  # Signing | Sent | Mined | Reverted | Stuck | Failed
	block_number: int | None = None
	mined_hash: str | None = None
	error: str | None = None
	created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

	def to_json(self) -> str:
		return json.dumps(asdict(self))


class Journal(Protocol):
	def get(self, key: str) -> Intent | None: ...
	def put(self, intent: Intent) -> None: ...  # MUST be durable (committed) when it returns
	def open_for(self, address: str) -> list[Intent]: ...  # Signing/Sent/Stuck intents from this address


class MemoryJournal:
	def __init__(self):
		self.m: dict[str, Intent] = {}
		self.writes: list[tuple[str, str, int]] = []  # (key, status, n_hashes): lets tests assert write-ahead order

	def get(self, key):
		e = self.m.get(key)
		return Intent(**json.loads(e.to_json())) if e else None

	def put(self, intent):
		self.m[intent.key] = Intent(**json.loads(intent.to_json()))
		self.writes.append((intent.key, intent.status, len(intent.hashes)))

	def open_for(self, address):
		return [e for e in self.m.values() if e.from_address.lower() == address.lower() and e.status in ("Signing", "Sent", "Stuck")]


@dataclass
class SendResult:
	key: str
	hash: str
	receipt: dict
	deduplicated: bool  # True: the intent was already journaled; nothing new was signed for a fresh nonce
	replacements: int
	status: str


class NonceSafeSender:
	"""The only way this app puts a transaction on Arc.

	1. Every send has an intent key derived from business data ("register:<obligationId>").
	2. Journal BEFORE signing, and record each signed hash BEFORE broadcasting it.
	3. A journaled intent never gets a new nonce: we look up receipts of its hashes; if none mined and the nonce is
	   still free we re-broadcast at the SAME nonce with +25% fees.
	"""

	def __init__(self, eth, private_key: str, chain_id: int, journal: Journal, *, receipt_timeout: float = 45.0,
	             poll_interval: float = 1.0, max_replacements: int = 2, sleep=time.sleep, clock=time.monotonic):
		from eth_account import Account

		self.eth = eth
		self.account = Account.from_key(private_key)
		self.chain_id = int(chain_id)
		self.journal = journal
		self.receipt_timeout = receipt_timeout
		self.poll_interval = poll_interval
		self.max_replacements = max_replacements
		self._sleep = sleep
		self._clock = clock

	@property
	def address(self) -> str:
		return self.account.address

	def send(self, key: str, to: str, data: str, gas: int | None = None) -> SendResult:
		to = to_checksum_address(to)
		existing = self.journal.get(key)
		if existing:
			if existing.to_address.lower() != to.lower() or existing.calldata.lower() != data.lower():
				raise IntentConflict(
					f"intent {key} is journaled with different calldata; refusing to sign something else under the same key"
				)
			return self._resume(existing)

		# Simulate first: a refusal costs nothing and consumes no nonce. Reverted propagates with the decoded error.
		if gas is None:
			gas = self.eth.estimate_gas({"from": self.address, "to": to, "data": data}) * 12 // 10 + 10_000
		pending = self.eth.nonce(self.address, "pending")
		for other in self.journal.open_for(self.address):
			if other.nonce >= pending:
				raise NonceHeld(
					f"nonce {other.nonce} is held by intent {other.key} ({other.status}) which the node does not see as "
					f"pending. Retry that intent first (it will replace at the same nonce); refusing to take a new nonce."
				)
		max_fee, prio = fee_policy(self.eth.base_fee())
		intent = Intent(key=key, from_address=self.address, to_address=to, calldata=data, nonce=pending, gas=int(gas),
		                max_fee_per_gas=max_fee, max_priority_fee_per_gas=prio)
		self.journal.put(intent)  # write-ahead: the intent exists before any signature does
		self._broadcast(intent, max_fee, prio)
		return self._await(intent, deduplicated=False)

	def _resume(self, intent: Intent) -> SendResult:
		if intent.status in ("Mined", "Reverted") and intent.mined_hash:
			r = self.eth.receipt(intent.mined_hash)
			if r:
				return SendResult(intent.key, intent.mined_hash, r, True, len(intent.hashes) - 1, intent.status)
		for h in reversed(intent.hashes):
			r = self.eth.receipt(h)
			if r:
				return self._finish(intent, h, r, deduplicated=True)
		latest = self.eth.nonce(self.address, "latest")
		if latest > intent.nonce:
			intent.status = "Failed"
			intent.error = f"nonce {intent.nonce} was consumed by a transaction not in this journal"
			self.journal.put(intent)
			raise ChainError(f"intent {intent.key}: {intent.error}; refusing to guess")
		base = self.eth.base_fee()
		if intent.hashes:
			max_fee, prio = bump_fees(intent.max_fee_per_gas, intent.max_priority_fee_per_gas, base)
		else:
			max_fee, prio = fee_policy(base)
		self._broadcast(intent, max_fee, prio)
		return self._await(intent, deduplicated=True)

	def _sign(self, intent: Intent, max_fee: int, prio: int):
		tx = {
			"type": 2,
			"chainId": self.chain_id,
			"nonce": intent.nonce,
			"to": intent.to_address,
			"data": intent.calldata,
			"value": 0,
			"gas": intent.gas,
			"maxFeePerGas": max_fee,
			"maxPriorityFeePerGas": prio,
		}
		signed = self.account.sign_transaction(tx)
		raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
		return bytes(raw), "0x" + bytes(signed.hash).hex()

	def _broadcast(self, intent: Intent, max_fee: int, prio: int) -> str:
		raw, h = self._sign(intent, max_fee, prio)
		intent.hashes.append(h)
		intent.max_fee_per_gas, intent.max_priority_fee_per_gas = max_fee, prio
		intent.status = "Sent"
		self.journal.put(intent)  # the hash is journaled before it can exist anywhere else
		self.eth.send_raw(raw)
		return h

	def _await(self, intent: Intent, deduplicated: bool) -> SendResult:
		replacements = 0
		while True:
			deadline = self._clock() + self.receipt_timeout
			while self._clock() < deadline:
				for h in reversed(intent.hashes):
					r = self.eth.receipt(h)
					if r:
						return self._finish(intent, h, r, deduplicated, replacements)
				self._sleep(self.poll_interval)
			if replacements >= self.max_replacements:
				intent.status = "Stuck"
				intent.error = f"no receipt after {replacements + 1} broadcasts at nonce {intent.nonce}"
				self.journal.put(intent)
				raise StuckTransaction(f"intent {intent.key}: {intent.error}. Retrying will replace at the same nonce.")
			if self.eth.nonce(self.address, "latest") > intent.nonce:
				# the nonce is used: one of our hashes mined (a lagging RPC may not have the receipt yet), or an
				# unjournaled tx took it. Never re-sign here; look once more, then hand back to the caller.
				for h in reversed(intent.hashes):
					r = self.eth.receipt(h)
					if r:
						return self._finish(intent, h, r, deduplicated, replacements)
				intent.status = "Stuck"
				intent.error = f"nonce {intent.nonce} is used but no receipt for our hashes yet"
				self.journal.put(intent)
				raise StuckTransaction(f"intent {intent.key}: {intent.error}. Retry later; it will not re-sign.")
			max_fee, prio = bump_fees(intent.max_fee_per_gas, intent.max_priority_fee_per_gas, self.eth.base_fee())
			self._broadcast(intent, max_fee, prio)
			replacements += 1

	def _finish(self, intent: Intent, h: str, r: dict, deduplicated: bool, replacements: int | None = None) -> SendResult:
		ok = int(r.get("status", 0)) == 1
		intent.status = "Mined" if ok else "Reverted"
		intent.mined_hash = h
		intent.block_number = int(r.get("blockNumber") or 0)
		self.journal.put(intent)
		reps = len(intent.hashes) - 1 if replacements is None else replacements
		return SendResult(intent.key, h, r, deduplicated, reps, intent.status)
