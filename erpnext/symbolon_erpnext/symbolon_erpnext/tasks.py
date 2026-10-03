"""Write-back: read Released / Cancelled / Expired from Arc and reflect them in ERPNext.

Runs every minute (hooks.scheduler_events cron "* * * * *"). Scans from `last_processed_block + 1` in chunks of at
most 9,000 blocks (eth_getLogs caps near 10k), processes events in (block, logIndex) order, and only then advances
`last_processed_block`. Every effect is idempotent on the release tx hash, so a crash and rescan never creates a
second Payment Entry.
"""

from __future__ import annotations

from datetime import datetime, timezone

import frappe
from frappe.utils import flt

from . import chain as C
from . import service

MAX_BLOCKS_PER_RUN = 90_000  # 10 chunks; a long-idle site catches up over a few minutes
TRACKED = ("Purchase Invoice", "Salary Slip")


def poll():
	from frappe.utils.synchronization import LockTimeoutError, filelock

	s = service.settings()
	if not s.enabled:
		return
	try:
		with filelock("symbolon_poll", timeout=1):
			return poll_once()
	except LockTimeoutError:
		return  # previous run still going


def poll_once() -> dict:
	s = service.settings()
	sym = service.contract()
	head = sym.rpc.block_number()
	start = int(s.last_processed_block or 0) + 1 if s.last_processed_block else int(s.start_block or C.DEFAULT_START_BLOCK)
	end = min(head, start + MAX_BLOCKS_PER_RUN - 1)
	if end < start:
		return {"from": start, "to": end, "events": 0}
	events = sym.events(start, end)
	done = []
	for ev in events:
		done.append(apply_event(ev, sym))
	frappe.db.set_single_value("Symbolon Settings", "last_processed_block", end)
	frappe.db.commit()
	return {"from": start, "to": end, "events": len(events), "applied": done}


def _find(oid: str):
	for dt in TRACKED:
		if not frappe.db.table_exists(dt) or not frappe.get_meta(dt).has_field("symbolon_obligation_id"):
			continue
		name = frappe.db.get_value(dt, {"symbolon_obligation_id": oid}, "name")
		if name:
			return dt, name
	return None, None


def apply_event(ev: dict, sym: C.Symbolon | None = None) -> dict:
	oid = ev["args"]["id"]
	dt, dn = _find(oid)
	out = {"event": ev["event"], "id": oid, "tx": ev["transactionHash"], "doctype": dt, "name": dn}
	if not dt:
		return {**out, "skipped": "no ERPNext document with this obligation id"}
	if ev["event"] == "Released":
		vals = {"symbolon_status": "Released", "symbolon_release_tx": ev["transactionHash"]}
		frappe.db.set_value(dt, dn, vals, update_modified=False)
		frappe.db.commit()
		if dt == "Purchase Invoice":
			try:
				out["payment_entry"] = make_payment_entry(dn, ev, sym)
			except Exception as e:
				# Loud, and never skipped: last_processed_block does not advance, so the next run retries this event.
				frappe.db.rollback()
				frappe.db.set_value(dt, dn, "symbolon_last_refusal",
				                    f"Write-back of release {ev['transactionHash']} failed: {e}"[:1000], update_modified=False)
				frappe.db.commit()
				raise
	elif ev["event"] in ("Cancelled", "Expired"):
		frappe.db.set_value(dt, dn, "symbolon_status", ev["event"], update_modified=False)
	frappe.db.commit()
	return out


def make_payment_entry(pi_name: str, ev: dict, sym: C.Symbolon | None = None) -> str | None:
	"""Create + submit a Payment Entry for a release, via ERPNext's own get_payment_entry (the 'Make > Payment'
	button's code). Idempotent: one Payment Entry per release tx hash, ever."""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	tx = ev["transactionHash"]
	existing = frappe.db.get_value("Payment Entry", {"reference_no": tx, "docstatus": ["<", 2]}, "name")
	if existing:
		return existing
	s = service.settings()
	amount = flt(int(ev["args"]["amount"]) / 10**6, 6)
	pi = frappe.get_doc("Purchase Invoice", pi_name)
	if pi.docstatus != 1 or flt(pi.outstanding_amount) <= 0:
		msg = (f"Released on-chain in {tx} but Purchase Invoice {pi_name} has no outstanding amount in ERPNext "
		       f"(docstatus {pi.docstatus}, outstanding {pi.outstanding_amount}). Reconcile manually: this may be a double payment.")
		frappe.db.set_value("Purchase Invoice", pi_name, "symbolon_last_refusal", msg, update_modified=False)
		frappe.log_error(msg, "Symbolon write-back")
		return None
	ts = (sym or service.contract()).rpc.block_timestamp(ev["blockNumber"])
	ref_date = datetime.fromtimestamp(ts, tz=timezone.utc).date()
	pe = get_payment_entry("Purchase Invoice", pi_name, party_amount=amount, bank_account=s.usdc_account or None,
	                       reference_date=ref_date)
	pe.mode_of_payment = s.mode_of_payment or "USDC (Arc)"
	pe.reference_no = tx
	pe.reference_date = ref_date
	pe.posting_date = ref_date
	pe.remarks = (f"Paid in USDC on Arc by Symbolon. Release tx {tx}, block {ev['blockNumber']}, obligation "
	              f"{ev['args']['id']}, payee wallet {ev['args']['payee']}. {service.explorer_tx(tx)}")
	pe.flags.ignore_permissions = True
	pe.insert()
	pe.submit()
	return pe.name
