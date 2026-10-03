import frappe
from frappe.model.document import Document


class SymbolonIntent(Document):
	"""One row per on-chain intent ("register:<id>", "cancel:<id>", "setPayee:<payeeId>:<wallet>:<version>",
	"registerBatch:<doctype>:<name>:<chunk>"). Written before signing; never deleted by the app."""

	def on_trash(self):
		if self.status in ("Signing", "Sent", "Stuck"):
			frappe.throw("An open intent holds a nonce. Resolve it (retry the document's sync) before deleting.")
