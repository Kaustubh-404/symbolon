"""Custom fields. Core ERPNext doctypes ship as fixtures (fixtures/custom_field.json, generated from CORE);
HRMS doctypes (Payroll Entry, Salary Slip) are created in after_migrate only when HRMS is installed, because a
fixture for a missing doctype would break `bench migrate` on sites without HRMS."""

CORE = {
 "Supplier": [
  {
   "fieldname": "symbolon_section",
   "fieldtype": "Section Break",
   "label": "Symbolon (USDC on Arc)"
  },
  {
   "fieldname": "symbolon_wallet",
   "fieldtype": "Data",
   "label": "USDC Wallet (Arc)",
   "length": 42,
   "description": "0x address that receives USDC on Arc. Changing it pauses payments to this supplier for 24h on-chain (payee cooldown): the bank-details-change defence.",
   "insert_after": "symbolon_section"
  }
 ],
 "Employee": [
  {
   "fieldname": "symbolon_section",
   "fieldtype": "Section Break",
   "label": "Symbolon (USDC on Arc)"
  },
  {
   "fieldname": "symbolon_wallet",
   "fieldtype": "Data",
   "label": "USDC Wallet (Arc)",
   "length": 42,
   "description": "0x address that receives salary in USDC on Arc. Changing it pauses payments to this employee for 24h on-chain.",
   "insert_after": "symbolon_section"
  }
 ],
 "Purchase Invoice": [
  {
   "fieldname": "symbolon_section",
   "fieldtype": "Section Break",
   "label": "Symbolon (USDC on Arc)",
   "collapsible": 1
  },
  {
   "fieldname": "symbolon_status",
   "fieldtype": "Select",
   "label": "Symbolon Status",
   "options": "Not Sent\nRegistered\nReleased\nRefused\nCancelled\nExpired",
   "default": "Not Sent",
   "in_standard_filter": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_section"
  },
  {
   "fieldname": "symbolon_obligation_id",
   "fieldtype": "Data",
   "label": "Obligation ID",
   "search_index": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_status"
  },
  {
   "fieldname": "symbolon_doc_hash",
   "fieldtype": "Data",
   "label": "Document Hash (docHash)",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_obligation_id"
  },
  {
   "fieldname": "symbolon_column",
   "fieldtype": "Column Break",
   "insert_after": "symbolon_doc_hash"
  },
  {
   "fieldname": "symbolon_register_tx",
   "fieldtype": "Data",
   "label": "Register Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_column"
  },
  {
   "fieldname": "symbolon_release_tx",
   "fieldtype": "Data",
   "label": "Release Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_register_tx"
  },
  {
   "fieldname": "symbolon_last_refusal",
   "fieldtype": "Small Text",
   "label": "Last Refusal",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_release_tx"
  },
  {
   "fieldname": "symbolon_not_before",
   "fieldtype": "Date",
   "label": "Pay No Earlier Than",
   "no_copy": 1,
   "print_hide": 1,
   "description": "Optional. Becomes notBefore on-chain (00:00 UTC). Defaults to the posting date. Hashed into docHash.",
   "insert_after": "symbolon_last_refusal"
  }
 ],
 "Payment Order": [
  {
   "fieldname": "symbolon_section",
   "fieldtype": "Section Break",
   "label": "Symbolon (USDC on Arc)",
   "collapsible": 1
  },
  {
   "fieldname": "symbolon_status",
   "fieldtype": "Select",
   "label": "Symbolon Status",
   "options": "Not Sent\nRegistered\nReleased\nRefused\nCancelled\nExpired",
   "default": "Not Sent",
   "in_standard_filter": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_section"
  },
  {
   "fieldname": "symbolon_obligation_id",
   "fieldtype": "Data",
   "label": "Obligation ID",
   "search_index": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_status"
  },
  {
   "fieldname": "symbolon_doc_hash",
   "fieldtype": "Data",
   "label": "Document Hash (docHash)",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_obligation_id"
  },
  {
   "fieldname": "symbolon_column",
   "fieldtype": "Column Break",
   "insert_after": "symbolon_doc_hash"
  },
  {
   "fieldname": "symbolon_register_tx",
   "fieldtype": "Data",
   "label": "Register Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_column"
  },
  {
   "fieldname": "symbolon_release_tx",
   "fieldtype": "Data",
   "label": "Release Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_register_tx"
  },
  {
   "fieldname": "symbolon_last_refusal",
   "fieldtype": "Small Text",
   "label": "Last Refusal",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_release_tx"
  },
  {
   "fieldname": "symbolon_sync_result",
   "fieldtype": "Code",
   "label": "Symbolon Sync Result (per row)",
   "options": "JSON",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_last_refusal"
  }
 ]
}

HRMS = {
 "Payroll Entry": [
  {
   "fieldname": "symbolon_section",
   "fieldtype": "Section Break",
   "label": "Symbolon (USDC on Arc)",
   "collapsible": 1
  },
  {
   "fieldname": "symbolon_status",
   "fieldtype": "Select",
   "label": "Symbolon Status",
   "options": "Not Sent\nRegistered\nReleased\nRefused\nCancelled\nExpired",
   "default": "Not Sent",
   "in_standard_filter": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_section"
  },
  {
   "fieldname": "symbolon_obligation_id",
   "fieldtype": "Data",
   "label": "Obligation ID",
   "search_index": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_status"
  },
  {
   "fieldname": "symbolon_doc_hash",
   "fieldtype": "Data",
   "label": "Document Hash (docHash)",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_obligation_id"
  },
  {
   "fieldname": "symbolon_column",
   "fieldtype": "Column Break",
   "insert_after": "symbolon_doc_hash"
  },
  {
   "fieldname": "symbolon_register_tx",
   "fieldtype": "Data",
   "label": "Register Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_column"
  },
  {
   "fieldname": "symbolon_release_tx",
   "fieldtype": "Data",
   "label": "Release Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_register_tx"
  },
  {
   "fieldname": "symbolon_last_refusal",
   "fieldtype": "Small Text",
   "label": "Last Refusal",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_release_tx"
  },
  {
   "fieldname": "symbolon_sync_result",
   "fieldtype": "Code",
   "label": "Symbolon Sync Result (per row)",
   "options": "JSON",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_last_refusal"
  }
 ],
 "Salary Slip": [
  {
   "fieldname": "symbolon_section",
   "fieldtype": "Section Break",
   "label": "Symbolon (USDC on Arc)",
   "collapsible": 1
  },
  {
   "fieldname": "symbolon_status",
   "fieldtype": "Select",
   "label": "Symbolon Status",
   "options": "Not Sent\nRegistered\nReleased\nRefused\nCancelled\nExpired",
   "default": "Not Sent",
   "in_standard_filter": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_section"
  },
  {
   "fieldname": "symbolon_obligation_id",
   "fieldtype": "Data",
   "label": "Obligation ID",
   "search_index": 1,
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_status"
  },
  {
   "fieldname": "symbolon_doc_hash",
   "fieldtype": "Data",
   "label": "Document Hash (docHash)",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_obligation_id"
  },
  {
   "fieldname": "symbolon_column",
   "fieldtype": "Column Break",
   "insert_after": "symbolon_doc_hash"
  },
  {
   "fieldname": "symbolon_register_tx",
   "fieldtype": "Data",
   "label": "Register Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_column"
  },
  {
   "fieldname": "symbolon_release_tx",
   "fieldtype": "Data",
   "label": "Release Tx",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_register_tx"
  },
  {
   "fieldname": "symbolon_last_refusal",
   "fieldtype": "Small Text",
   "label": "Last Refusal",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_release_tx"
  },
  {
   "fieldname": "symbolon_created",
   "fieldtype": "Check",
   "label": "Created by Symbolon Sync",
   "read_only": 1,
   "allow_on_submit": 1,
   "no_copy": 1,
   "print_hide": 1,
   "insert_after": "symbolon_last_refusal"
  }
 ]
}
