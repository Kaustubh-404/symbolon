"""Pure identifiers, hashes and unit conversions. No Frappe import: unit-testable without a site.

Everything here must agree byte for byte with packages/sdk/src/ids.ts (the TypeScript reference). The golden test
in tests/test_ids.py replays goldens produced by that file.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation

from eth_utils import keccak

USDC_DECIMALS = 6
_USDC_SCALE = Decimal(10) ** USDC_DECIMALS
_MAX_SAFE_INTEGER = 2**53 - 1  # JS Number.MAX_SAFE_INTEGER: JSON.stringify cannot represent more exactly
_UINT128_MAX = 2**128 - 1
_UINT64_MAX = 2**64 - 1


class SymbolonValueError(ValueError):
	"""A document cannot be expressed on-chain (wrong currency, bad amount, bad window...). Message is user-facing."""


def _hex(b: bytes) -> str:
	return "0x" + b.hex()


def keccak_text(text: str) -> str:
	return _hex(keccak(text.encode("utf-8")))


def obligation_id(doctype: str, name: str) -> str:
	"""keccak256(utf8(f"{doctype}:{name}")); same as `cast keccak "Purchase Invoice:ACC-PINV-..."`."""
	return keccak_text(f"{doctype}:{name}")


def payee_id(kind: str, ident: str) -> str:
	"""keccak256(utf8(f"{kind}:{id}")), e.g. ("Supplier", "ACME-001"), ("Employee", "HR-EMP-00001")."""
	return keccak_text(f"{kind}:{ident}")


# ─────────────────────────────────────────────────────────────── canonical JSON


def _utf16_key(s: str) -> bytes:
	# JS Array.prototype.sort() compares UTF-16 code units; Python compares code points. They differ when a key
	# mixes astral characters (surrogate pairs, 0xD800-) with BMP characters >= 0xE000. Big-endian UTF-16 bytes
	# compare exactly like JS code units.
	return s.encode("utf-16-be", "surrogatepass")


def _sort_keys(v):
	if isinstance(v, dict):
		for k in v:
			if not isinstance(k, str):
				raise TypeError(f"canonical JSON keys must be strings, got {type(k).__name__}")
		return {k: _sort_keys(v[k]) for k in sorted(v, key=_utf16_key)}
	if isinstance(v, list | tuple):
		return [_sort_keys(x) for x in v]
	if isinstance(v, bool) or v is None or isinstance(v, str):
		return v
	if isinstance(v, int):
		if abs(v) > _MAX_SAFE_INTEGER:
			raise TypeError(f"integer {v} exceeds JS safe range; encode it as a decimal string")
		return v
	if isinstance(v, float):
		# Python and JS print some floats differently (1.0 vs 1, 1e21...). Money is never a float here.
		raise TypeError("floats are not allowed in canonical JSON; encode amounts as integer strings")
	raise TypeError(f"unsupported type in canonical JSON: {type(v).__name__}")


def canonical_json(value) -> str:
	"""Keys sorted recursively, no whitespace: the same bytes as JS `JSON.stringify(sortKeys(value))`."""
	return json.dumps(_sort_keys(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def hash_record(record) -> str:
	"""keccak256 of the canonical JSON (utf-8). Matches `hashRecord` in packages/sdk/src/ids.ts."""
	return _hex(keccak(canonical_json(record).encode("utf-8")))


def sha256_hex(raw: bytes) -> str:
	return _hex(hashlib.sha256(raw).digest())


# ─────────────────────────────────────────────────────────────── amounts


def to_usdc6(value, *, what: str = "amount") -> int:
	"""Decimal dollars -> integer USDC base units (6 decimals). Refuses negatives, zero and sub-micro precision."""
	try:
		d = Decimal(str(value))
	except (InvalidOperation, ValueError) as e:
		raise SymbolonValueError(f"{what} {value!r} is not a number") from e
	if not d.is_finite():
		raise SymbolonValueError(f"{what} {value!r} is not finite")
	scaled = d * _USDC_SCALE
	if scaled != scaled.to_integral_value():
		raise SymbolonValueError(f"{what} {value} has more than {USDC_DECIMALS} decimal places")
	n = int(scaled)
	if n <= 0:
		raise SymbolonValueError(f"{what} must be greater than zero (got {value})")
	if n > _UINT128_MAX:
		raise SymbolonValueError(f"{what} {value} does not fit in uint128")
	return n


def usdc6_to_decimal(n: int) -> Decimal:
	return Decimal(int(n)) / _USDC_SCALE


def to_usdc6_str(value, *, what: str = "amount") -> str:
	"""For hashed documents: integer base units as a decimal string (no floats in canonical JSON)."""
	return str(to_usdc6(value, what=what))


def to_usdc6_str_signed(value) -> str:
	"""Like to_usdc6_str but allows zero/negative (e.g. a deduction row), still exact to 6 dp."""
	d = Decimal(str(value or 0))
	scaled = d * _USDC_SCALE
	if scaled != scaled.to_integral_value():
		raise SymbolonValueError(f"value {value} has more than {USDC_DECIMALS} decimal places")
	return str(int(scaled))


def decimal_str(value) -> str:
	"""Quantities as normalised decimal strings: 10.000 -> "10", 2.50 -> "2.5"."""
	d = Decimal(str(value or 0))
	if d == d.to_integral_value():
		return str(d.quantize(Decimal(1)))
	return format(d.normalize(), "f")


def require_usd(currency: str | None, *, doc_label: str) -> None:
	if (currency or "").upper() != "USD":
		raise SymbolonValueError(
			f"{doc_label} is in {currency or 'no currency'}. Symbolon pays in USDC and only registers documents "
			"whose currency is USD. Convert the document to USD (or pay it outside Symbolon)."
		)


# ─────────────────────────────────────────────────────────────── windows


def _as_date(v) -> date:
	if isinstance(v, datetime):
		return v.date()
	if isinstance(v, date):
		return v
	if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.strip()):
		return date.fromisoformat(v.strip())
	raise SymbolonValueError(f"not a date: {v!r}")


def date_str(v) -> str | None:
	return None if v in (None, "") else _as_date(v).isoformat()


def start_of_day_utc(v) -> int:
	"""00:00:00 UTC of the given date, as unix seconds (notBefore)."""
	return int(datetime.combine(_as_date(v), time(0, 0, 0), tzinfo=timezone.utc).timestamp())


def end_of_day_utc(v) -> int:
	"""23:59:59 UTC of the given date, as unix seconds (dueBy)."""
	return int(datetime.combine(_as_date(v), time(23, 59, 59), tzinfo=timezone.utc).timestamp())


def window(not_before_date, due_date) -> tuple[int, int]:
	nb = start_of_day_utc(not_before_date)
	db = end_of_day_utc(due_date)
	if db < nb:
		raise SymbolonValueError(f"due date {date_str(due_date)} is before the pay-from date {date_str(not_before_date)}")
	if db > _UINT64_MAX:
		raise SymbolonValueError("due date out of range")
	return nb, db


# ─────────────────────────────────────────────────────────────── addresses


def checksum_address(addr: str) -> str:
	"""Validate a 0x address and return its EIP-55 checksum form. Refuses the zero address and bad checksums."""
	from eth_utils import is_hex_address, to_checksum_address

	a = (addr or "").strip()
	if not is_hex_address(a):
		raise SymbolonValueError(f"{addr!r} is not a 0x-prefixed 20-byte hex address")
	cs = to_checksum_address(a)
	# mixed-case input must already be a valid checksum; all-lower / all-upper input is accepted and checksummed
	body = a[2:]
	if body != body.lower() and body != body.upper() and a != cs:
		raise SymbolonValueError(f"{addr} has an invalid EIP-55 checksum (did you mistype it?)")
	if int(a, 16) == 0:
		raise SymbolonValueError("the zero address cannot receive payments")
	return cs
