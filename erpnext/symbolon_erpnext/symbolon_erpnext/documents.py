"""ERPNext document -> the exact record whose keccak is registered on-chain as `docHash`.

Pure: works on a Frappe Document or a plain dict (tests). The field lists below ARE the spec; README.md copies them.
Only fields that cannot change after submit are hashed (no status, outstanding_amount, modified, symbolon_* ...),
so re-syncing the same submitted document always yields the same docHash and the contract answers `created=false`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from .ids import (
	SymbolonValueError,
	date_str,
	decimal_str,
	hash_record,
	obligation_id,
	payee_id,
	require_usd,
	to_usdc6,
	to_usdc6_str_signed,
	window,
	_as_date,
)

PI_SCHEMA = "erpnext-v15/purchase-invoice/1"
SS_SCHEMA = "erpnext-v15/salary-slip/1"


def _g(doc, key, default=None):
	v = doc.get(key) if hasattr(doc, "get") else getattr(doc, key, default)
	return default if v is None else v


def _rows(doc, key):
	return list(_g(doc, key, []) or [])


@dataclass
class Registration:
	doctype: str
	name: str
	obligation_id: str
	doc_hash: str
	payee_kind: str
	payee_ident: str
	payee_id: str
	amount: int  # USDC base units (6 dp)
	not_before: int
	due_by: int
	record: dict

	def args(self) -> list:
		"""registerObligation(id, docHash, payeeId, amount, notBefore, dueBy)."""
		return [self.obligation_id, self.doc_hash, self.payee_id, self.amount, self.not_before, self.due_by]

	def row(self) -> tuple:
		"""One Registration struct for registerBatch."""
		return tuple(self.args())

	def as_dict(self) -> dict:
		return {
			"doctype": self.doctype,
			"name": self.name,
			"id": self.obligation_id,
			"docHash": self.doc_hash,
			"payee": f"{self.payee_kind}:{self.payee_ident}",
			"payeeId": self.payee_id,
			"amount": str(self.amount),
			"amount_usd": f"{self.amount / 10**6:.6f}",
			"notBefore": self.not_before,
			"dueBy": self.due_by,
			"record": self.record,
		}


def _finish(doctype, name, kind, ident, amount, nb, db, record) -> Registration:
	return Registration(
		doctype=doctype,
		name=name,
		obligation_id=obligation_id(doctype, name),
		doc_hash=hash_record(record),
		payee_kind=kind,
		payee_ident=ident,
		payee_id=payee_id(kind, ident),
		amount=amount,
		not_before=nb,
		due_by=db,
		record=record,
	)


# ─────────────────────────────────────────────────────────────── Purchase Invoice


def purchase_invoice_payable(pi):
	"""What the invoice asks to be paid, fixed at submit: rounded (or grand) total less advances and write-off."""
	from decimal import Decimal

	use_rounded = not int(_g(pi, "disable_rounded_total", 0) or 0) and _g(pi, "rounded_total")
	base = Decimal(str(_g(pi, "rounded_total") if use_rounded else _g(pi, "grand_total", 0)))
	less = Decimal(str(_g(pi, "total_advance", 0) or 0)) + Decimal(str(_g(pi, "write_off_amount", 0) or 0))
	return base - less


def purchase_invoice_registration(pi, attachment_sha256: str | None = None) -> Registration:
	name = _g(pi, "name")
	label = f"Purchase Invoice {name}"
	if int(_g(pi, "is_return", 0) or 0):
		raise SymbolonValueError(f"{label} is a return (debit note); there is nothing to pay.")
	if int(_g(pi, "is_paid", 0) or 0):
		raise SymbolonValueError(f"{label} is marked 'Is Paid' at posting; it was paid outside Symbolon.")
	require_usd(_g(pi, "currency"), doc_label=label)
	supplier = _g(pi, "supplier")
	if not supplier:
		raise SymbolonValueError(f"{label} has no supplier.")
	amount = to_usdc6(purchase_invoice_payable(pi), what=f"{label} payable amount")
	posting = _g(pi, "posting_date")
	not_before_date = _g(pi, "symbolon_not_before") or posting
	due = _g(pi, "due_date") or posting
	nb, db = window(not_before_date, due)
	record = {
		"symbolon_schema": PI_SCHEMA,
		"doctype": "Purchase Invoice",
		"name": name,
		"company": _g(pi, "company"),
		"supplier": supplier,
		"payee_id": f"Supplier:{supplier}",
		"bill_no": _g(pi, "bill_no") or None,
		"bill_date": date_str(_g(pi, "bill_date")),
		"posting_date": date_str(posting),
		"due_date": date_str(due),
		"currency": "USD",
		"amount_usdc6": str(amount),
		"not_before": nb,
		"due_by": db,
		"items": [
			{
				"idx": int(_g(it, "idx", 0)),
				"item_code": _g(it, "item_code") or None,
				"qty": decimal_str(_g(it, "qty", 0)),
				"amount_usdc6": to_usdc6_str_signed(_g(it, "amount", 0)),
			}
			for it in _rows(pi, "items")
		],
	}
	if attachment_sha256:
		record["attachment_sha256"] = attachment_sha256
	return _finish("Purchase Invoice", name, "Supplier", supplier, amount, nb, db, record)


# ─────────────────────────────────────────────────────────────── Salary Slip


def salary_slip_registration(ss, due_days: int = 5) -> Registration:
	name = _g(ss, "name")
	label = f"Salary Slip {name}"
	require_usd(_g(ss, "currency"), doc_label=label)
	employee = _g(ss, "employee")
	if not employee:
		raise SymbolonValueError(f"{label} has no employee.")
	amount = to_usdc6(_g(ss, "net_pay", 0), what=f"{label} net pay")
	posting = _g(ss, "posting_date") or _g(ss, "end_date")
	nb, db = window(posting, _as_date(posting) + timedelta(days=int(due_days)))
	record = {
		"symbolon_schema": SS_SCHEMA,
		"doctype": "Salary Slip",
		"name": name,
		"company": _g(ss, "company"),
		"employee": employee,
		"payee_id": f"Employee:{employee}",
		"payroll_entry": _g(ss, "payroll_entry") or None,
		"start_date": date_str(_g(ss, "start_date")),
		"end_date": date_str(_g(ss, "end_date")),
		"posting_date": date_str(posting),
		"currency": "USD",
		"amount_usdc6": str(amount),
		"not_before": nb,
		"due_by": db,
		"earnings": [
			{"salary_component": _g(r, "salary_component"), "amount_usdc6": to_usdc6_str_signed(_g(r, "amount", 0))}
			for r in _rows(ss, "earnings")
		],
		"deductions": [
			{"salary_component": _g(r, "salary_component"), "amount_usdc6": to_usdc6_str_signed(_g(r, "amount", 0))}
			for r in _rows(ss, "deductions")
		],
	}
	return _finish("Salary Slip", name, "Employee", employee, amount, nb, db, record)
