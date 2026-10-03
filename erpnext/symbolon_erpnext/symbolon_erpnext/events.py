"""doc_events. Handlers never block the user's submit on the chain: they validate, then enqueue the same
service functions the buttons and the API call (`service.register`, `service.cancel`, `service.set_payee`)."""

from __future__ import annotations

import frappe
from frappe import _

from .ids import SymbolonValueError, checksum_address

PAYEE_WARNING = _(
	"Payments to this {0} pause for 24h. This is the bank-details-change defence: Symbolon's contract refuses to "
	"pay a payee whose wallet changed recently (<b>PayeeChangedRecently</b>), so a fraudulent \"our bank details "
	"have changed\" email has a day to be noticed before any money can move."
)


def _enabled() -> bool:
	try:
		return bool(frappe.db.get_single_value("Symbolon Settings", "enabled"))
	except Exception:  # noqa: BLE001 (settings table missing during install)
		return False


def _enqueue(method: str, job_id: str, **kwargs):
	frappe.enqueue(
		method,
		queue="short",
		job_id=job_id,
		deduplicate=True,
		enqueue_after_commit=True,
		**kwargs,
	)


# ─────────────────────────────────────────────────────────────── payee wallets


def validate_wallet(doc, method=None):
	"""Supplier / Employee validate: checksum the wallet and warn loudly when it changes."""
	if doc.get("symbolon_wallet"):
		try:
			doc.symbolon_wallet = checksum_address(doc.symbolon_wallet)
		except SymbolonValueError as e:
			frappe.throw(str(e), title=_("Invalid USDC wallet"))
	if not doc.is_new() and doc.has_value_changed("symbolon_wallet") and doc.get("symbolon_wallet"):
		frappe.msgprint(PAYEE_WARNING.format(_(doc.doctype).lower()), title=_("Wallet changed"), indicator="orange")


def on_payee_update(doc, method=None):
	if not doc.get("symbolon_wallet") or not doc.has_value_changed("symbolon_wallet"):
		return
	if not _enabled():
		return
	version = str(int(frappe.utils.get_datetime(doc.modified).timestamp()))
	_enqueue(
		"symbolon_erpnext.events.set_payee_job",
		job_id=f"symbolon-setPayee-{doc.doctype}-{doc.name}-{version}",
		kind=doc.doctype,
		ident=doc.name,
		wallet=doc.symbolon_wallet,
		version=version,
	)


def set_payee_job(kind, ident, wallet, version):
	from . import service

	return service.set_payee(kind, ident, wallet, version)


# ─────────────────────────────────────────────────────────────── purchase invoice / salary slip


def on_submit_register(doc, method=None):
	from . import service

	# refuse early and visibly (currency, return, paid...), without blocking the ERPNext submit itself
	try:
		service.registrations_for(doc.doctype, doc.name)
	except SymbolonValueError as e:
		doc.db_set({"symbolon_status": "Refused", "symbolon_last_refusal": str(e)}, update_modified=False)
		frappe.msgprint(str(e), title=_("Not sent to Symbolon"), indicator="orange")
		return
	if not _enabled():
		return
	if doc.doctype == "Salary Slip" and doc.get("payroll_entry"):
		# one registerBatch per Payroll Entry, after all of its slips are submitted (job is deduplicated)
		_enqueue("symbolon_erpnext.events.register_job", job_id=f"symbolon-register-Payroll Entry-{doc.payroll_entry}",
		         doctype="Payroll Entry", name=doc.payroll_entry)
		return
	_enqueue("symbolon_erpnext.events.register_job", job_id=f"symbolon-register-{doc.doctype}-{doc.name}",
	         doctype=doc.doctype, name=doc.name)


def on_cancel(doc, method=None):
	if not doc.get("symbolon_obligation_id") or doc.get("symbolon_status") != "Registered" or not _enabled():
		return
	_enqueue("symbolon_erpnext.events.cancel_job", job_id=f"symbolon-cancel-{doc.doctype}-{doc.name}",
	         doctype=doc.doctype, name=doc.name)


def on_payment_order_submit(doc, method=None):
	if _enabled():
		_enqueue("symbolon_erpnext.events.register_job", job_id=f"symbolon-register-{doc.doctype}-{doc.name}",
		         doctype=doc.doctype, name=doc.name)


def register_job(doctype, name):
	from . import service

	return service.register(doctype, name)


def cancel_job(doctype, name):
	from . import service

	return service.cancel(doctype, name)
