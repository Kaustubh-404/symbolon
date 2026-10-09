"""Seed the books for our own company (Symbolon Labs): a USDC bank account, the Symbolon settings, a service item and
suppliers with wallets. Idempotent; safe to re-run.

    bench --site <site> execute symbolon_erpnext.demo_seed.run --kwargs '{"payees": {"TEAM-01": "0x..."}}'
"""

import frappe

SUPPLIER_GROUP = "Services"
ITEM = "Contract Work"


def _company():
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", pluck="name")[0]


def _usdc_account(company: str) -> str:
	abbr = frappe.db.get_value("Company", company, "abbr")
	name = f"USDC (Arc) - {abbr}"
	if not frappe.db.exists("Account", name):
		parent = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 1}, "name") or frappe.db.get_value(
			"Account", {"company": company, "account_name": "Bank Accounts"}, "name"
		)
		frappe.get_doc(
			{
				"doctype": "Account",
				"account_name": "USDC (Arc)",
				"company": company,
				"parent_account": parent,
				"account_type": "Bank",
				"account_currency": "USD",
			}
		).insert(ignore_permissions=True)
	return name


def run(payees: dict | None = None, start_block: int | None = None):
	company = _company()
	account = _usdc_account(company)

	mop = frappe.get_doc("Mode of Payment", "USDC (Arc)")
	if not any(a.company == company for a in mop.accounts):
		mop.append("accounts", {"company": company, "default_account": account})
		mop.save(ignore_permissions=True)

	s = frappe.get_single("Symbolon Settings")
	s.enabled = 1
	s.usdc_account = account
	if start_block:
		s.start_block = start_block
	s.save(ignore_permissions=True)

	if not frappe.db.exists("Supplier Group", SUPPLIER_GROUP):
		frappe.get_doc({"doctype": "Supplier Group", "supplier_group_name": SUPPLIER_GROUP, "parent_supplier_group": "All Supplier Groups"}).insert(
			ignore_permissions=True
		)
	if not frappe.db.exists("Item", ITEM):
		frappe.get_doc(
			{"doctype": "Item", "item_code": ITEM, "item_name": ITEM, "item_group": "Services", "is_stock_item": 0, "stock_uom": "Nos"}
		).insert(ignore_permissions=True)

	for supplier, wallet in (payees or {}).items():
		if frappe.db.exists("Supplier", supplier):
			doc = frappe.get_doc("Supplier", supplier)
		else:
			doc = frappe.get_doc({"doctype": "Supplier", "supplier_name": supplier, "supplier_group": SUPPLIER_GROUP, "supplier_type": "Individual"})
		doc.default_currency = "USD"
		doc.symbolon_wallet = wallet
		doc.save(ignore_permissions=True) if doc.name else doc.insert(ignore_permissions=True)

	frappe.db.commit()
	return {"company": company, "usdc_account": account, "suppliers": sorted((payees or {}).keys())}
