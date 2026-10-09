import frappe


def before_install():
	"""Symbolon Settings links its default to the "USDC (Arc)" Mode of Payment, and installing a Single doctype
	validates that link before fixtures load. Create the Mode of Payment first; the fixture then just syncs it."""
	if not frappe.db.exists("Mode of Payment", "USDC (Arc)"):
		frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": "USDC (Arc)", "type": "Bank", "enabled": 1}).insert(
			ignore_permissions=True
		)


def after_install():
	after_migrate()


def after_migrate():
	"""HRMS custom fields only when HRMS's doctypes exist; fixtures cannot be conditional."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	from .custom_fields import HRMS

	present = {dt: fields for dt, fields in HRMS.items() if frappe.db.exists("DocType", dt)}
	if present:
		create_custom_fields(present, ignore_validate=True, update=True)
