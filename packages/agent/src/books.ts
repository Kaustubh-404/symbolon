import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import { obligationId, payeeId } from "@symbolon/sdk";

/**
 * What the agent knows about a bill from the system of record. Everything here except the ids, amount and
 * dates is UNTRUSTED TEXT: memos and remarks are written by counterparties and may contain instructions.
 */
export type Bill = {
  obligationId: Hex;
  payeeId: Hex;
  doctype: string; // "Purchase Invoice" | "Salary Slip" | ...
  name: string; // ERP document name
  party: string; // supplier / employee id
  partyName: string;
  amountUsd: string; // decimal string, USD
  postingDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  /** early-payment discount from the payment terms, if any */
  discount?: { percent: number; untilDate: string };
  /** free text from the document: remarks, memo, extracted attachment text. Untrusted. */
  untrustedText: string;
};

export interface Books {
  /** submitted, unpaid bills */
  openBills(): Promise<Bill[]>;
}

/** Fixture-backed books for the baseline harness and local runs. */
export class FileBooks implements Books {
  constructor(private path: string) {}
  async openBills(): Promise<Bill[]> {
    const rows = JSON.parse(readFileSync(this.path, "utf8")) as Omit<Bill, "obligationId" | "payeeId">[];
    return rows.map((r) => ({
      ...r,
      obligationId: obligationId(r.doctype, r.name),
      payeeId: payeeId(r.doctype === "Salary Slip" ? "Employee" : "Supplier", r.party),
    }));
  }
}

/**
 * ERPNext over its REST API (token auth: `token <api_key>:<api_secret>`). Reads submitted, outstanding
 * Purchase Invoices. Field names are ERPNext v15's; payment_schedule rows carry early-payment discounts.
 */
export class ErpNextBooks implements Books {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, { headers: { Authorization: `token ${this.token}` } });
    if (!r.ok) throw new Error(`ERPNext ${path} → ${r.status}`);
    return ((await r.json()) as { data: T }).data;
  }

  async openBills(): Promise<Bill[]> {
    const filters = encodeURIComponent(JSON.stringify([["docstatus", "=", 1], ["outstanding_amount", ">", 0], ["currency", "=", "USD"]]));
    const list = await this.get<{ name: string }[]>(`/api/resource/Purchase Invoice?filters=${filters}&limit_page_length=500`);
    const bills: Bill[] = [];
    for (const { name } of list) {
      const d = await this.get<{
        name: string;
        supplier: string;
        supplier_name: string;
        outstanding_amount: number;
        posting_date: string;
        due_date: string;
        remarks?: string;
        bill_no?: string;
        payment_schedule?: { discount?: number; discount_type?: string; discount_date?: string }[];
      }>(`/api/resource/Purchase Invoice/${encodeURIComponent(name)}`);
      const ps = d.payment_schedule?.find((p) => p.discount && p.discount_type === "Percentage" && p.discount_date);
      bills.push({
        obligationId: obligationId("Purchase Invoice", d.name),
        payeeId: payeeId("Supplier", d.supplier),
        doctype: "Purchase Invoice",
        name: d.name,
        party: d.supplier,
        partyName: d.supplier_name,
        amountUsd: d.outstanding_amount.toFixed(2),
        postingDate: d.posting_date,
        dueDate: d.due_date,
        discount: ps ? { percent: ps.discount!, untilDate: ps.discount_date! } : undefined,
        untrustedText: [d.bill_no && `Supplier invoice no: ${d.bill_no}`, d.remarks].filter(Boolean).join("\n"),
      });
    }
    return bills;
  }
}
