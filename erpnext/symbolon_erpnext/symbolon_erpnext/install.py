import frappe


def after_install():
	after_migrate()


def after_migrate():
	"""HRMS custom fields only when HRMS's doctypes exist; fixtures cannot be conditional."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	from .custom_fields import HRMS

	present = {dt: fields for dt, fields in HRMS.items() if frappe.db.exists("DocType", dt)}
	if present:
		create_custom_fields(present, ignore_validate=True, update=True)
