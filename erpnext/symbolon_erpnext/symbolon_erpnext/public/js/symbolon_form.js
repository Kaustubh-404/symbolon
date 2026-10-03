// Symbolon buttons on Purchase Invoice, Salary Slip, Payroll Entry, Payment Order.
// Both buttons call the same whitelisted methods an agent or script would: symbolon_erpnext.api.dry_run / sync.
(() => {
	window.__symbolon = window.__symbolon || {};
	if (window.__symbolon.form) return;
	window.__symbolon.form = true;

	const esc = (s) => frappe.utils.escape_html(String(s ?? ""));
	const tx = (h) => (h ? `<a href="https://explorer.testnet.arc.io/tx/${esc(h)}" target="_blank">${esc(h.slice(0, 10))}…</a>` : "");
	const usd = (a) => `$${(Number(a) / 1e6).toFixed(2)}`;
	const when = (t) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z");
	const refusal = (r) => (r ? `<b>${esc(r.name)}</b>: ${esc(r.human)}` : "");

	function show_dry_run(r) {
		let html = "";
		if (!r.would_send) {
			html = `<p class="text-danger"><b>Would not send.</b> ${esc(r.refusal)}</p>`;
		} else {
			const sim = r.simulation || {};
			html += `<p>Would call <code>${esc(r.function)}</code> on <code>${esc(r.contract)}</code> (chain ${esc(r.chain_id)}) from <code>${esc(r.from)}</code>.</p>`;
			html += sim.ok
				? `<p class="text-success">Simulation (eth_call): succeeds.</p>`
				: `<p class="text-danger">Simulation (eth_call) refused: ${refusal(sim.refusal)}</p>`;
			html += `<table class="table table-bordered table-sm"><tr><th>Document</th><th>Payee</th><th>Amount</th><th>Window (UTC)</th><th>Would create</th><th>On-chain</th><th>check(id)</th></tr>`;
			for (const row of r.rows) {
				html += `<tr><td>${esc(row.name)}<br><small><code>${esc(row.id)}</code></small></td>
					<td>${esc(row.payee)}<br><small>ERP: <code>${esc(row.payee_wallet_in_erpnext || "none")}</code><br>chain: <code>${esc((row.payee_on_chain || {}).wallet || "none")}</code></small></td>
					<td>${usd(row.amount)}</td><td><small>${when(row.notBefore)}<br>→ ${when(row.dueBy)}</small></td>
					<td>${row.would_create === undefined ? "–" : row.would_create ? "yes" : "no (already registered, same terms)"}</td>
					<td>${esc((row.obligation_on_chain || {}).status)}</td>
					<td>${row.check.releasable ? "releasable" : refusal(row.check.refusal)}</td></tr>`;
			}
			html += `</table>`;
			for (const x of r.refused_rows || []) html += `<p class="text-warning">Skipped ${esc(x.name)}: ${esc(x.refusal)}</p>`;
			html += `<p><small>${esc(r.note)}</small></p>`;
		}
		html += `<details><summary>Full dry run (JSON)</summary><pre style="max-height:400px;overflow:auto">${esc(JSON.stringify(r, null, 2))}</pre></details>`;
		frappe.msgprint({ title: __("Symbolon: Dry run"), message: html, wide: true });
	}

	function setup(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Symbolon: Dry run"), () =>
			frappe.call({
				method: "symbolon_erpnext.api.dry_run",
				args: { doctype: frm.doctype, name: frm.docname },
				freeze: true,
				freeze_message: __("Simulating on Arc…"),
			}).then((r) => show_dry_run(r.message))
		);
		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(__("Symbolon: Register now"), () =>
				frappe.confirm(__("Register this on-chain now? Re-registering identical terms is a no-op (created=false)."), () =>
					frappe.call({
						method: "symbolon_erpnext.api.sync",
						type: "POST",
						args: { doctype: frm.doctype, name: frm.docname },
						freeze: true,
						freeze_message: __("Sending to Arc…"),
					}).then((r) => {
						const m = r.message || {};
						let html = m.refusal
							? `<p class="text-danger">Refused: ${typeof m.refusal === "string" ? esc(m.refusal) : refusal(m.refusal)}</p>`
							: `<p>created: <b>${m.created}</b> ${m.tx ? "· tx " + tx(m.tx) : ""}</p>`;
						for (const row of m.rows || []) html += `<div>${esc(row.name)}: created=${row.created} ${row.refusal ? esc(row.refusal) : ""}</div>`;
						frappe.msgprint({ title: __("Symbolon: Register now"), message: html, wide: true });
						frm.reload_doc();
					})
				)
			);
		}
		const st = frm.doc.symbolon_status;
		if (st && st !== "Not Sent") {
			const color = { Registered: "blue", Released: "green", Refused: "red", Cancelled: "grey", Expired: "orange" }[st] || "grey";
			frm.dashboard.add_indicator(__("Symbolon: {0}", [st]), color);
		}
		if (frm.doc.symbolon_last_refusal && st === "Refused") {
			frm.dashboard.set_headline_alert(`<span class="text-danger">Symbolon: ${esc(frm.doc.symbolon_last_refusal)}</span>`);
		}
	}

	for (const dt of ["Purchase Invoice", "Salary Slip", "Payroll Entry", "Payment Order"]) {
		frappe.ui.form.on(dt, { refresh: setup });
	}
})();
