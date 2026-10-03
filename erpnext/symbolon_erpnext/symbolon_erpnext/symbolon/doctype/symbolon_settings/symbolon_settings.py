import frappe
from frappe import _
from frappe.model.document import Document


class SymbolonSettings(Document):
	def validate(self):
		from symbolon_erpnext.ids import SymbolonValueError, checksum_address

		try:
			if self.contract_address:
				self.contract_address = checksum_address(self.contract_address)
			if self.approver_address:
				self.approver_address = checksum_address(self.approver_address)
		except SymbolonValueError as e:
			frappe.throw(str(e))
		key = self.get_password("approver_private_key", raise_exception=False) if self.approver_private_key else None
		if key and "*" not in key:
			from eth_account import Account

			try:
				self.approver_address = Account.from_key(key.strip()).address
			except Exception:
				frappe.throw(_("Approver Private Key is not a valid secp256k1 private key"))
		if self.rpc_urls:
			bad = [u for u in self.rpc_urls.splitlines() if u.strip() and not u.strip().startswith(("https://", "http://"))]
			if bad:
				frappe.throw(_("Not an http(s) URL: {0}").format(", ".join(bad)))


@frappe.whitelist()
def test_connection():
	"""Settings form button: chain id, head block, approver role, contract params. Read-only."""
	frappe.only_for("System Manager")
	from symbolon_erpnext import service

	sym = service.contract()
	appr = service.approver_address()
	return {
		"chain_id": sym.rpc.chain_id,
		"head_block": sym.rpc.block_number(),
		"contract": sym.address,
		"approver": appr,
		"approver_has_APPROVER_role": sym.has_role("APPROVER", appr),
		"approver_key_configured": bool(service.approver_key()),
	}
