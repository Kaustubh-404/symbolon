"""Frappe glue: settings, the Symbolon Intent journal, and the registration / cancel / setPayee paths.

Every write path (form button, doc_event, background job, REST call) funnels through the functions here, so the
agent, the UI and the API all use the same code. Each returns a per-row idempotency signal (`created`).
"""

from __future__ import annotations

import json
import os

import frappe
from frappe import _

from . import chain as C
from .documents import Registration, purchase_invoice_registration, salary_slip_registration
from .ids import SymbolonValueError, canonical_json, checksum_address, keccak_text, payee_id, sha256_hex
from .refusals import format_refusal

SETTINGS = "Symbolon Settings"
INTENT = "Symbolon Intent"
SUPPORTED = ("Purchase Invoice", "Salary Slip", "Payroll Entry", "Payment Order")


# ─────────────────────────────────────────────────────────────── settings


def settings():
	return frappe.get_cached_doc(SETTINGS)


def approver_key() -> str | None:
	"""site_config `symbolon_approver_private_key` > env SYMBOLON_APPROVER_PRIVATE_KEY > the Password field."""
	k = frappe.conf.get("symbolon_approver_private_key") or os.environ.get("SYMBOLON_APPROVER_PRIVATE_KEY")
	if not k:
		k = settings().get_password("approver_private_key", raise_exception=False)
	return (k or "").strip() or None


def approver_address() -> str:
	k = approver_key()
	if k:
		from eth_account import Account

		return Account.from_key(k).address
	return checksum_address(settings().approver_address or C.DEFAULT_APPROVER)


def rpc() -> C.Rpc:
	s = settings()
	urls = [u for u in (s.rpc_urls or "").replace(",", "\n").splitlines() if u.strip()] or C.DEFAULT_RPCS
	return C.Rpc(urls, int(s.chain_id or C.ARC_TESTNET_CHAIN_ID))


def contract() -> C.Symbolon:
	return C.Symbolon(rpc(), settings().contract_address or C.DEFAULT_CONTRACT)


def explorer_tx(h: str | None) -> str | None:
	if not h:
		return None
	return f"{(settings().explorer_url or C.DEFAULT_EXPLORER).rstrip('/')}/tx/{h}"


# ─────────────────────────────────────────────────────────────── journal (Symbolon Intent)


class FrappeJournal:
	"""Write-ahead nonce journal. Every put() is committed immediately so it survives a crash mid-send."""

	def __init__(self, reference_doctype: str | None = None, reference_name: str | None = None):
		self.ref = (reference_doctype, reference_name)

	def _to_intent(self, d) -> C.Intent:
		return C.Intent(
			key=d.name,
			from_address=d.from_address,
			to_address=d.to_address,
			calldata=d.calldata,
			nonce=int(d.nonce),
			gas=int(d.gas or 0),
			max_fee_per_gas=int(d.max_fee_per_gas or 0),
			max_priority_fee_per_gas=int(d.max_priority_fee_per_gas or 0),
			hashes=json.loads(d.hashes or "[]"),
			status=d.status,
			block_number=int(d.block_number) if d.block_number else None,
			mined_hash=d.mined_hash or None,
			error=d.error or None,
		)

	def get(self, key):
		if not frappe.db.exists(INTENT, key):
			return None
		return self._to_intent(frappe.get_doc(INTENT, key))

	def put(self, i: C.Intent):
		values = {
			"from_address": i.from_address,
			"to_address": i.to_address,
			"calldata": i.calldata,
			"nonce": i.nonce,
			"gas": str(i.gas),
			"max_fee_per_gas": str(i.max_fee_per_gas),
			"max_priority_fee_per_gas": str(i.max_priority_fee_per_gas),
			"hashes": json.dumps(i.hashes),
			"status": i.status,
			"block_number": i.block_number or 0,  # Int columns are NOT NULL in Frappe; 0 reads back as "not mined"
			"mined_hash": i.mined_hash,
			"error": i.error,
		}
		if frappe.db.exists(INTENT, i.key):
			frappe.db.set_value(INTENT, i.key, values, update_modified=True)
		else:
			doc = frappe.get_doc(
				{"doctype": INTENT, "intent_key": i.key, "reference_doctype": self.ref[0], "reference_name": self.ref[1], **values}
			)
			doc.insert(ignore_permissions=True)
		frappe.db.commit()  # nosemgrep: durability is the point of a write-ahead journal

	def open_for(self, address):
		rows = frappe.get_all(INTENT, filters={"from_address": address, "status": ["in", ["Signing", "Sent", "Stuck"]]}, pluck="name")
		return [self.get(n) for n in rows]


def sender(reference_doctype=None, reference_name=None) -> C.NonceSafeSender:
	key = approver_key()
	if not key:
		frappe.throw(
			_("No approver key configured. Set site_config <code>symbolon_approver_private_key</code>, env "
			  "<code>SYMBOLON_APPROVER_PRIVATE_KEY</code>, or the Password field in Symbolon Settings."),
			title=_("Symbolon not configured"),
		)
	s = settings()
	return C.NonceSafeSender(rpc(), key, int(s.chain_id or C.ARC_TESTNET_CHAIN_ID), FrappeJournal(reference_doctype, reference_name))


def _send_locked(snd: C.NonceSafeSender, key: str, to: str, data: str) -> C.SendResult:
	"""One signer, one nonce sequence: serialise sends from this site across workers."""
	from frappe.utils.synchronization import filelock

	with filelock(f"symbolon_sender_{snd.address.lower()}", timeout=120):
		return snd.send(key, to, data)


# ─────────────────────────────────────────────────────────────── document -> registration


def attachment_sha256(doctype: str, name: str) -> str | None:
	"""sha256 of the earliest-attached PDF on the document (stable: later attachments do not change docHash)."""
	files = frappe.get_all(
		"File",
		filters={"attached_to_doctype": doctype, "attached_to_name": name, "is_folder": 0},
		fields=["name", "file_name", "file_url", "creation"],
		order_by="creation asc, name asc",
	)
	for f in files:
		if (f.file_name or f.file_url or "").lower().endswith(".pdf"):
			content = frappe.get_doc("File", f.name).get_content()
			if isinstance(content, str):
				content = content.encode()
			return sha256_hex(content)
	return None


def registrations_for(doctype: str, name: str) -> tuple[list[Registration], list[dict]]:
	"""(registrations, refused rows). Single docs give one row; Payroll Entry / Payment Order give one per slip/invoice."""
	s = settings()
	if doctype == "Purchase Invoice":
		pi = frappe.get_doc(doctype, name)
		return [purchase_invoice_registration(pi, attachment_sha256(doctype, name))], []
	if doctype == "Salary Slip":
		return [salary_slip_registration(frappe.get_doc(doctype, name), int(s.payroll_due_days or 5))], []
	if doctype in ("Payroll Entry", "Payment Order"):
		regs, refused = [], []
		for dt, dn in _children(doctype, name):
			try:
				regs.extend(registrations_for(dt, dn)[0])
			except SymbolonValueError as e:
				refused.append({"doctype": dt, "name": dn, "refusal": str(e)})
		return regs, refused
	raise SymbolonValueError(f"Symbolon does not register {doctype} documents (supported: {', '.join(SUPPORTED)})")


def _children(doctype, name) -> list[tuple[str, str]]:
	if doctype == "Payroll Entry":
		slips = frappe.get_all("Salary Slip", filters={"payroll_entry": name, "docstatus": 1}, pluck="name", order_by="name asc")
		return [("Salary Slip", n) for n in slips]
	# Payment Order: each reference that points at a Purchase Invoice registers THAT invoice's obligation (same id,
	# same terms), so ordering a payment for an already-registered invoice is a no-op (created=false), never a second bill.
	po = frappe.get_doc("Payment Order", name)
	out = []
	for r in po.get("references") or []:
		dt, dn = r.get("reference_doctype"), r.get("reference_name")
		if dt == "Payment Request" and dn:
			dt, dn = frappe.db.get_value("Payment Request", dn, ["reference_doctype", "reference_name"]) or (None, None)
		if dt == "Purchase Invoice" and dn and (dt, dn) not in out:
			out.append((dt, dn))
	return out


# ─────────────────────────────────────────────────────────────── dry run


def dry_run(doctype: str, name: str) -> dict:
	s = settings()
	sym = contract()
	appr = approver_address()
	try:
		regs, refused = registrations_for(doctype, name)
	except SymbolonValueError as e:
		return {"doctype": doctype, "name": name, "would_send": False, "refusal": str(e)}
	if not regs:
		return {"doctype": doctype, "name": name, "would_send": False, "refused_rows": refused, "refusal": "nothing to register"}
	batch = doctype in ("Payroll Entry", "Payment Order")
	if batch:
		fn, args = "registerBatch", [[r.row() for r in regs]]
	else:
		fn, args = "registerObligation", regs[0].args()
	rows = []
	for r in regs:
		p = sym.payee(r.payee_id)
		erp_wallet = _erp_wallet(r.payee_kind, r.payee_ident)
		rows.append({
			**r.as_dict(),
			"canonical_json": canonical_json(r.record),
			"payee_wallet_in_erpnext": erp_wallet,
			"payee_on_chain": p,
			"obligation_on_chain": sym.get_obligation(r.obligation_id),
			"check": sym.check(r.obligation_id),
		})
	sim = sym.simulate(fn, args, appr)
	if sim["ok"]:
		created = sim["result"] if batch else [sim["result"]]
		for row, c in zip(rows, created):
			row["would_create"] = bool(c)
	return {
		"doctype": doctype,
		"name": name,
		"would_send": True,
		"chain_id": int(s.chain_id or C.ARC_TESTNET_CHAIN_ID),
		"contract": sym.address,
		"from": appr,
		"function": fn,
		"calldata": C.encode_call(fn, args),
		"simulation": sim,
		"rows": rows,
		"refused_rows": refused,
		"note": "Nothing was signed or sent. `simulation` is an eth_call of the exact calldata from the approver address.",
	}


def _erp_wallet(kind, ident):
	if kind not in ("Supplier", "Employee"):
		return None
	return frappe.db.get_value(kind, ident, "symbolon_wallet")


# ─────────────────────────────────────────────────────────────── register


def _mark(doctype, name, **values):
	values = {f"symbolon_{k}": v for k, v in values.items()}
	frappe.db.set_value(doctype, name, values, update_modified=False)


def _refuse(doctype, name, msg):
	_mark(doctype, name, status="Refused", last_refusal=msg)
	frappe.db.commit()


def register(doctype: str, name: str) -> dict:
	"""Register the document's obligation(s) on-chain. Idempotent: returns created=false for rows already registered."""
	try:
		regs, refused = registrations_for(doctype, name)
	except SymbolonValueError as e:
		_refuse(doctype, name, str(e))
		return {"created": False, "tx": None, "refusal": str(e)}
	for r in refused:
		_refuse(r["doctype"], r["name"], r["refusal"])
	if not regs:
		return {"created": False, "tx": None, "rows": [], "refused_rows": refused}
	if doctype in ("Payroll Entry", "Payment Order"):
		return _register_batch(doctype, name, regs, refused)
	return _register_one(regs[0])


def _register_one(r: Registration) -> dict:
	sym = contract()
	_mark(r.doctype, r.name, obligation_id=r.obligation_id, doc_hash=r.doc_hash)
	snd = sender(r.doctype, r.name)
	data = C.encode_call("registerObligation", r.args())
	try:
		res = _send_locked(snd, f"register:{r.obligation_id}", sym.address, data)
	except C.Reverted as e:
		msg = format_refusal(e.refusal)
		_refuse(r.doctype, r.name, msg)
		return {"created": False, "tx": None, "refusal": e.refusal}
	created = any(ev["event"] == "ObligationRegistered" and ev["args"]["id"].lower() == r.obligation_id.lower()
	              for ev in C.receipt_events(res.receipt))
	if res.status != "Mined":
		_refuse(r.doctype, r.name, f"registration tx {res.hash} reverted")
		return {"created": False, "tx": res.hash, "status": res.status}
	_mark(r.doctype, r.name, status="Registered", register_tx=res.hash, last_refusal=None)
	frappe.db.commit()
	return {"created": created, "tx": res.hash, "explorer": explorer_tx(res.hash), "deduplicated": res.deduplicated,
	        "id": r.obligation_id, "docHash": r.doc_hash}


def _register_batch(doctype, name, regs: list[Registration], refused: list[dict]) -> dict:
	sym = contract()
	size = int(settings().batch_size or 50)
	out_rows, txs = [], []
	for r in regs:
		_mark(r.doctype, r.name, obligation_id=r.obligation_id, doc_hash=r.doc_hash)
	for i in range(0, len(regs), size):
		chunk = regs[i : i + size]
		rows = [r.row() for r in chunk]
		data = C.encode_call("registerBatch", [rows])
		chunk_key = keccak_text(",".join(r.obligation_id for r in chunk))[2:34]
		try:
			res = _send_locked(sender(doctype, name), f"registerBatch:{doctype}:{name}:{chunk_key}", sym.address, data)
		except C.Reverted as e:
			msg = format_refusal(e.refusal)
			for r in chunk:
				_refuse(r.doctype, r.name, f"batch refused: {msg}")
				out_rows.append({"doctype": r.doctype, "name": r.name, "id": r.obligation_id, "created": False, "refusal": msg})
			continue
		txs.append(res.hash)
		created_ids = {ev["args"]["id"].lower() for ev in C.receipt_events(res.receipt) if ev["event"] == "ObligationRegistered"}
		for r in chunk:
			c = r.obligation_id.lower() in created_ids
			if res.status == "Mined":
				_mark(r.doctype, r.name, status="Registered", register_tx=res.hash, last_refusal=None,
				      **({"created": 1 if c else 0} if r.doctype == "Salary Slip" else {}))
			out_rows.append({"doctype": r.doctype, "name": r.name, "id": r.obligation_id, "created": c, "tx": res.hash})
		frappe.db.commit()
	result = {"created": any(r.get("created") for r in out_rows), "tx": txs[-1] if txs else None, "txs": txs,
	          "rows": out_rows, "refused_rows": refused}
	meta = frappe.get_meta(doctype)
	if meta.has_field("symbolon_sync_result"):
		all_ok = bool(out_rows) and not refused and all(not r.get("refusal") for r in out_rows)
		vals = {"symbolon_sync_result": json.dumps(result, indent=1)}
		if all_ok:
			vals.update({"symbolon_status": "Registered", "symbolon_register_tx": result["tx"], "symbolon_last_refusal": None})
		else:
			bad = [f"{r['name']}: {r.get('refusal')}" for r in out_rows if r.get("refusal")]
			bad += [f"{r['name']}: {r['refusal']}" for r in refused]
			vals.update({"symbolon_status": "Refused" if not txs else "Registered", "symbolon_last_refusal": "\n".join(bad)[:1000]})
			if txs:
				vals["symbolon_register_tx"] = txs[-1]
		frappe.db.set_value(doctype, name, vals, update_modified=False)
		frappe.db.commit()
	return result


# ─────────────────────────────────────────────────────────────── cancel / payee


def cancel(doctype: str, name: str) -> dict:
	oid = frappe.db.get_value(doctype, name, "symbolon_obligation_id")
	if not oid:
		return {"cancelled": False, "reason": "never registered"}
	sym = contract()
	ob = sym.get_obligation(oid)
	if ob["status"] != "Registered":
		return {"cancelled": False, "reason": f"on-chain status is {ob['status']}"}
	try:
		res = _send_locked(sender(doctype, name), f"cancel:{oid}", sym.address, C.encode_call("cancel", [oid]))
	except C.Reverted as e:
		msg = format_refusal(e.refusal)
		_mark(doctype, name, last_refusal=f"cancel refused: {msg}")
		frappe.db.commit()
		return {"cancelled": False, "refusal": e.refusal}
	if res.status == "Mined":
		_mark(doctype, name, status="Cancelled")
		frappe.db.commit()
	return {"cancelled": res.status == "Mined", "tx": res.hash, "explorer": explorer_tx(res.hash)}


def set_payee(kind: str, ident: str, wallet: str, version: str) -> dict:
	"""setPayee(payeeId, wallet). Starts the on-chain cooldown (24h on the deployed contract)."""
	wallet = checksum_address(wallet)
	pid = payee_id(kind, ident)
	sym = contract()
	current = sym.payee(pid)
	if current["wallet"] and current["wallet"].lower() == wallet.lower():
		return {"changed": False, "reason": "wallet already set on-chain", "payee": current}
	try:
		res = _send_locked(sender(kind, ident), f"setPayee:{pid}:{wallet}:{version}", sym.address,
		                   C.encode_call("setPayee", [pid, wallet]))
	except C.Reverted as e:
		frappe.log_error(f"setPayee {kind}:{ident} refused: {format_refusal(e.refusal)}", "Symbolon")
		return {"changed": False, "refusal": e.refusal}
	return {"changed": res.status == "Mined", "tx": res.hash, "explorer": explorer_tx(res.hash), "payee": sym.payee(pid)}
