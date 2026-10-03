frappe.ui.form.on("Symbolon Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Test connection"), () =>
			frappe.call("symbolon_erpnext.symbolon.doctype.symbolon_settings.symbolon_settings.test_connection").then((r) =>
				frappe.msgprint({ title: __("Symbolon"), message: `<pre>${JSON.stringify(r.message, null, 2)}</pre>`, wide: true })
			)
		);
		frm.add_custom_button(__("Run write-back now"), () =>
			frappe.call({ method: "symbolon_erpnext.api.poll_now", type: "POST" }).then((r) =>
				frappe.msgprint({ title: __("Write-back"), message: `<pre>${JSON.stringify(r.message, null, 2)}</pre>`, wide: true })
			)
		);
	},
});
