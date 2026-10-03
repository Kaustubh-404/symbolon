"""Pure tests: no Frappe site needed.  Run: cd erpnext/symbolon_erpnext && python -m pytest

Goldens: tests/golden/goldens.json is produced by tests/golden/gen_goldens.mjs from packages/sdk/src/ids.ts (the TS
reference). The cast values below were produced with `cast keccak` / `cast calldata` (Foundry)."""

import json
import unittest
from datetime import date
from pathlib import Path

from symbolon_erpnext.ids import (
	SymbolonValueError,
	canonical_json,
	checksum_address,
	decimal_str,
	end_of_day_utc,
	hash_record,
	obligation_id,
	payee_id,
	require_usd,
	start_of_day_utc,
	to_usdc6,
	window,
)

GOLDEN = Path(__file__).parent / "golden"


class TestIdsMatchCast(unittest.TestCase):
	def test_obligation_id_smoke_matches_cast(self):
		# cast keccak "Purchase Invoice:ACC-PINV-SMOKE-0001"
		self.assertEqual(
			obligation_id("Purchase Invoice", "ACC-PINV-SMOKE-0001"),
			"0x34e4b5eab3451713981cb4f60dd79a244690088c740ae9ac3b815f22cbc2a68c",
		)

	def test_payee_ids_match_cast(self):
		# cast keccak "Supplier:ACME-001" / "Employee:HR-EMP-00001"
		self.assertEqual(payee_id("Supplier", "ACME-001"), "0xa11b374793949d0ea6b7f6f15bf22f460bf04379d29eec0c234987041e1bbf3d")
		self.assertEqual(payee_id("Employee", "HR-EMP-00001"), "0x5a2d3584e0ab123873a5e548b7fb64be96304cb54eecc2731c9258c26b7917e5")


class TestGoldensFromTypeScript(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.docs = json.loads((GOLDEN / "documents.json").read_text())
		cls.gold = json.loads((GOLDEN / "goldens.json").read_text())

	def test_canonical_json_byte_identical(self):
		for doc, g in zip(self.docs, self.gold["documents"], strict=True):
			self.assertEqual(canonical_json(doc), g["canonical"])

	def test_hash_record_matches_ts(self):
		for doc, g in zip(self.docs, self.gold["documents"], strict=True):
			self.assertEqual(hash_record(doc), g["hash"])

	def test_ids_match_ts(self):
		for g in self.gold["obligation_ids"]:
			self.assertEqual(obligation_id(g["doctype"], g["name"]), g["id"])
		for g in self.gold["payee_ids"]:
			self.assertEqual(payee_id(g["kind"], g["id"]), g["payee_id"])

	def test_key_order_is_utf16_not_codepoint(self):
		# JS sorts "😀" (surrogates 0xD83D..) before "Ａ" (0xFF21); Python's default sort would not.
		c = canonical_json({"Ａ": 1, "\U0001f600": 2})
		self.assertTrue(c.startswith('{"\U0001f600"'))

	def test_input_key_order_irrelevant(self):
		self.assertEqual(hash_record({"b": 1, "a": [{"y": 1, "x": 2}]}), hash_record({"a": [{"x": 2, "y": 1}], "b": 1}))


class TestCanonicalJsonRefusals(unittest.TestCase):
	def test_rejects_floats(self):
		with self.assertRaises(TypeError):
			canonical_json({"amount": 1.5})

	def test_rejects_unsafe_ints(self):
		with self.assertRaises(TypeError):
			canonical_json({"n": 2**53})

	def test_rejects_non_string_keys(self):
		with self.assertRaises(TypeError):
			canonical_json({1: "x"})


class TestAmounts(unittest.TestCase):
	def test_usdc6(self):
		self.assertEqual(to_usdc6("1250.00"), 1_250_000_000)
		self.assertEqual(to_usdc6(0.1), 100_000)  # float via str(): 0.1 -> "0.1", no binary noise
		self.assertEqual(to_usdc6("0.000001"), 1)
		self.assertEqual(to_usdc6(4210.5), 4_210_500_000)

	def test_refusals(self):
		for bad in ("0", "-1", "0.0000001", "abc", "NaN"):
			with self.assertRaises(SymbolonValueError, msg=bad):
				to_usdc6(bad)

	def test_currency(self):
		require_usd("USD", doc_label="x")
		with self.assertRaises(SymbolonValueError) as cm:
			require_usd("EUR", doc_label="Purchase Invoice X")
		self.assertIn("only registers documents whose currency is USD", str(cm.exception))

	def test_decimal_str(self):
		self.assertEqual(decimal_str(10.0), "10")
		self.assertEqual(decimal_str("2.500"), "2.5")
		self.assertEqual(decimal_str(None), "0")


class TestWindow(unittest.TestCase):
	def test_utc_bounds(self):
		self.assertEqual(start_of_day_utc("2026-10-01"), 1790812800)  # date -u -d 2026-10-01 +%s
		self.assertEqual(end_of_day_utc(date(2026, 10, 31)), 1793491199)
		self.assertEqual(window("2026-10-01", "2026-10-01"), (1790812800, 1790812800 + 86399))

	def test_inverted_window_refused(self):
		with self.assertRaises(SymbolonValueError):
			window("2026-10-02", "2026-10-01")


class TestAddress(unittest.TestCase):
	def test_checksums_lowercase(self):
		self.assertEqual(
			checksum_address("0x06eadbfad046f2784f6e894e153958e03ebf2eb9"), "0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9"
		)

	def test_rejects_bad_checksum_and_junk(self):
		for bad in ("0x06eADbFAd046F2784F6e894e153958E03EBf2EB9", "0x1234", "hello", "0x" + "0" * 40):
			with self.assertRaises(SymbolonValueError, msg=bad):
				checksum_address(bad)


if __name__ == "__main__":
	unittest.main()
