// Supplier / Employee: warn BEFORE save that changing the USDC wallet pauses payments for 24h on-chain.
(() => {
	window.__symbolon = window.__symbolon || {};
	if (window.__symbolon.payee) return;
	window.__symbolon.payee = true;

	const handlers = {
		symbolon_wallet(frm) {
			if (frm.is_new() || !frm.doc.symbolon_wallet) return;
			frappe.msgprint({
				title: __("Changing the USDC wallet"),
				indicator: "orange",
				message: __(
					"Payments to this {0} pause for 24h — this is the bank-details-change defence. " +
						"After you save, Symbolon calls setPayee on Arc, and the contract refuses any release to this payee " +
						"until the cooldown ends (PayeeChangedRecently). Verify the change out-of-band (call the payee on a known number).",
					[__(frm.doctype).toLowerCase()]
				),
			});
		},
	};
	frappe.ui.form.on("Supplier", handlers);
	frappe.ui.form.on("Employee", handlers);
})();
