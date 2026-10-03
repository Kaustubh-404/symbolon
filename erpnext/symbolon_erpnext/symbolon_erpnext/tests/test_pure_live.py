"""Read-only checks against the live contract on Arc Testnet. Opt-in: SYMBOLON_LIVE=1 python -m pytest -k live.
Never signs or sends anything."""

import os
import unittest

from symbolon_erpnext import chain as C
from symbolon_erpnext.documents import purchase_invoice_registration
from symbolon_erpnext.ids import obligation_id, payee_id

LIVE = os.environ.get("SYMBOLON_LIVE") == "1"


@unittest.skipUnless(LIVE, "set SYMBOLON_LIVE=1 to run read-only calls against Arc Testnet")
class TestLiveReadOnly(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.sym = C.Symbolon(C.Rpc(C.DEFAULT_RPCS, C.ARC_TESTNET_CHAIN_ID), C.DEFAULT_CONTRACT)

	def test_check_smoke_obligation(self):
		oid = obligation_id("Purchase Invoice", "ACC-PINV-SMOKE-0001")
		ob = self.sym.get_obligation(oid)
		chk = self.sym.check(oid)
		print("\nsmoke obligation:", ob["status"], "check:", chk["refusal"]["name"] if chk["refusal"] else "releasable")
		self.assertIn(ob["status"], C.STATUS)
		if ob["status"] == "None":
			self.assertEqual(chk["refusal"]["name"], "NotRegistered")

	def test_approver_role(self):
		self.assertTrue(self.sym.has_role("APPROVER", C.DEFAULT_APPROVER))
		self.assertFalse(self.sym.has_role("AGENT", C.DEFAULT_APPROVER))

	def test_simulate_register_from_approver(self):
		pi = {"name": "ACC-PINV-DRYRUN-TEST-0001", "company": "X", "supplier": "NO-SUCH-SUPPLIER-XYZ", "posting_date": "2026-10-01",
		      "due_date": "2026-10-31", "currency": "USD", "grand_total": 1.0, "items": []}
		r = purchase_invoice_registration(pi)
		sim = self.sym.simulate("registerObligation", r.args(), C.DEFAULT_APPROVER)
		print("\nsimulate unknown payee:", sim["refusal"])
		self.assertFalse(sim["ok"])
		self.assertEqual(sim["refusal"]["name"], "UnknownPayee")
		self.assertEqual(self.sym.payee(payee_id("Supplier", "NO-SUCH-SUPPLIER-XYZ"))["wallet"], None)

	def test_simulate_from_non_approver_is_refused(self):
		sim = self.sym.simulate("cancel", [obligation_id("Purchase Invoice", "x")], "0x000000000000000000000000000000000000dEaD")
		self.assertEqual(sim["refusal"]["name"], "NotAuthorized")

	def test_events_scan_chunked(self):
		head = self.sym.rpc.block_number()
		evs = self.sym.events(C.DEFAULT_START_BLOCK, min(head, C.DEFAULT_START_BLOCK + 20_000), names=("ObligationRegistered", "PayeeSet", "Released", "Cancelled", "Expired"))
		print("\nevents in first 20k blocks:", [(e["event"], e["blockNumber"]) for e in evs][:10])
		self.assertEqual(evs, sorted(evs, key=lambda e: (e["blockNumber"], e["logIndex"])))
