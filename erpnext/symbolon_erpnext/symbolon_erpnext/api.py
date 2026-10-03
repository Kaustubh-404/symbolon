"""Whitelisted API. The form buttons call exactly these; so can the agent or any script, with the same permissions.

    GET/POST /api/method/symbolon_erpnext.api.dry_run   {doctype, name}
    POST     /api/method/symbolon_erpnext.api.sync      {doctype, name}
"""

from __future__ import annotations

import frappe
from frappe import _

from . import service


def _check(doctype: str, name: str, ptype: str):
	if doctype not in service.SUPPORTED:
		frappe.throw(_("Symbolon does not register {0} documents").format(doctype))
	doc = frappe.get_doc(doctype, name)
	doc.check_permission(ptype)
	return doc


@frappe.whitelist()
def dry_run(doctype: str, name: str) -> dict:
	"""The exact on-chain call sync() WOULD make (id, docHash, payeeId, amount, window, calldata), an eth_call
	simulation of it from the approver address (the per-row `created` it would return, or the named refusal), and
	the contract's `check(id)` for each row. Signs nothing, sends nothing."""
	_check(doctype, name, "read")
	return service.dry_run(doctype, name)


@frappe.whitelist(methods=["POST"])
def sync(doctype: str, name: str) -> dict:
	"""Register now. Returns {created, tx, ...}; per-row `created` for Payroll Entry / Payment Order.
	created=false with a tx means the obligation already existed with identical terms (idempotent re-sync)."""
	doc = _check(doctype, name, "submit")
	if doc.docstatus != 1:
		frappe.throw(_("Submit the document first: only approved (submitted) documents are registered on-chain."))
	return service.register(doctype, name)


@frappe.whitelist()
def check(doctype: str, name: str) -> dict:
	"""Read-only: on-chain obligation + check(id) for a registered document."""
	doc = _check(doctype, name, "read")
	oid = doc.get("symbolon_obligation_id")
	if not oid:
		from .ids import obligation_id

		oid = obligation_id(doctype, name)
	sym = service.contract()
	return {"id": oid, "obligation": sym.get_obligation(oid), "check": sym.check(oid)}


@frappe.whitelist(methods=["POST"])
def poll_now() -> dict:
	"""Run the write-back once (System Manager)."""
	frappe.only_for("System Manager")
	from .tasks import poll_once

	return poll_once()
