"""The record builders reproduce the golden documents (so the TS goldens cover what ERPNext actually hashes)."""

import json
import unittest
from pathlib import Path

from symbolon_erpnext.documents import purchase_invoice_registration, salary_slip_registration
from symbolon_erpnext.ids import SymbolonValueError

GOLDEN = Path(__file__).parent / "golden"

PI = {
	"name": "ACC-PINV-SMOKE-0001",
	"company": "Symbolon Demo Co",
	"supplier": "ACME-001",
	"bill_no": "INV-7781",
	"bill_date": "2026-09-28",
	"posting_date": "2026-10-01",
	"due_date": "2026-10-31",
	"currency": "USD",
	"grand_total": 1250.0,
	"rounded_total": 1250.0,
	"disable_rounded_total": 0,
	"total_advance": 0,
	"write_off_amount": 0,
	"outstanding_amount": 1250.0,  # mutable: must NOT be hashed
	"status": "Unpaid",  # mutable: must NOT be hashed
	"items": [
		{"idx": 1, "item_code": "CONSULTING", "qty": 10.0, "rate": 100.0, "amount": 1000.0},
		{"idx": 2, "item_code": "TRAVEL", "qty": 1.0, "rate": 250.0, "amount": 250.0},
	],
}
SHA = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

SS = {
	"name": "Sal Slip/HR-EMP-00001/00001",
	"company": "Symbolon Demo Co",
	"employee": "HR-EMP-00001",
	"payroll_entry": "HR-PRUN-2026-00001",
	"start_date": "2026-09-01",
	"end_date": "2026-09-30",
	"posting_date": "2026-09-30",
	"currency": "USD",
	"net_pay": 4210.5,
	"earnings": [{"salary_component": "Basic", "amount": 5000.0}],
	"deductions": [{"salary_component": "Income Tax", "amount": 789.5}],
}


class TestBuilders(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.docs = json.loads((GOLDEN / "documents.json").read_text())
		cls.gold = json.loads((GOLDEN / "goldens.json").read_text())

	def test_purchase_invoice_record_and_hash(self):
		r = purchase_invoice_registration(PI, SHA)
		self.assertEqual(r.record, self.docs[0])
		self.assertEqual(r.doc_hash, self.gold["documents"][0]["hash"])
		self.assertEqual(r.obligation_id, "0x34e4b5eab3451713981cb4f60dd79a244690088c740ae9ac3b815f22cbc2a68c")
		self.assertEqual(r.payee_id, "0xa11b374793949d0ea6b7f6f15bf22f460bf04379d29eec0c234987041e1bbf3d")
		self.assertEqual((r.amount, r.not_before, r.due_by), (1_250_000_000, 1790812800, 1793491199))

	def test_salary_slip_record_and_hash(self):
		r = salary_slip_registration(SS, due_days=5)
		self.assertEqual(r.record, self.docs[1])
		self.assertEqual(r.doc_hash, self.gold["documents"][1]["hash"])
		self.assertEqual(r.amount, 4_210_500_000)

	def test_mutable_fields_do_not_change_hash(self):
		a = purchase_invoice_registration(PI, SHA).doc_hash
		b = purchase_invoice_registration({**PI, "outstanding_amount": 0, "status": "Paid", "modified": "x"}, SHA).doc_hash
		self.assertEqual(a, b)

	def test_attachment_changes_hash(self):
		self.assertNotEqual(purchase_invoice_registration(PI, SHA).doc_hash, purchase_invoice_registration(PI, None).doc_hash)
		self.assertNotIn("attachment_sha256", purchase_invoice_registration(PI, None).record)

	def test_payable_uses_rounded_total_less_advance(self):
		r = purchase_invoice_registration({**PI, "grand_total": 1249.6, "rounded_total": 1250, "total_advance": 200})
		self.assertEqual(r.amount, 1_050_000_000)
		r = purchase_invoice_registration({**PI, "grand_total": 1249.6, "rounded_total": 1250, "disable_rounded_total": 1})
		self.assertEqual(r.amount, 1_249_600_000)

	def test_not_before_override(self):
		r = purchase_invoice_registration({**PI, "symbolon_not_before": "2026-10-15"})
		self.assertEqual(r.not_before, 1792022400)

	def test_refusals(self):
		cases = [
			({**PI, "currency": "EUR"}, "currency is USD"),
			({**PI, "is_return": 1}, "return"),
			({**PI, "is_paid": 1}, "Is Paid"),
			({**PI, "due_date": "2026-09-01"}, "before"),
			({**PI, "grand_total": 0, "rounded_total": 0}, "greater than zero"),
		]
		for doc, needle in cases:
			with self.assertRaises(SymbolonValueError) as cm:
				purchase_invoice_registration(doc)
			self.assertIn(needle, str(cm.exception))

	def test_args_shape(self):
		r = purchase_invoice_registration(PI, SHA)
		self.assertEqual(r.args()[3:], [1_250_000_000, 1790812800, 1793491199])
		self.assertEqual(r.row(), tuple(r.args()))


if __name__ == "__main__":
	unittest.main()
