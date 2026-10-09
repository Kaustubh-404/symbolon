app_name = "symbolon_erpnext"
app_title = "Symbolon"
app_publisher = "Symbolon"
app_description = "Register approved ERPNext bills and payroll as obligations on Symbolon (USDC on Arc), with dry run and per-row idempotency"
app_email = "symbolon@example.invalid"
app_license = "apache-2.0"
required_apps = ["erpnext"]

# Core custom fields + the "USDC (Arc)" Mode of Payment. HRMS fields are created in after_migrate (see install.py).
fixtures = [
	{"dt": "Custom Field", "filters": [["module", "=", "Symbolon"]]},
	{"dt": "Mode of Payment", "filters": [["name", "=", "USDC (Arc)"]]},
]

before_install = "symbolon_erpnext.install.before_install"
after_install = "symbolon_erpnext.install.after_install"
after_migrate = "symbolon_erpnext.install.after_migrate"

doctype_js = {
	"Purchase Invoice": "public/js/symbolon_form.js",
	"Payroll Entry": "public/js/symbolon_form.js",
	"Salary Slip": "public/js/symbolon_form.js",
	"Payment Order": "public/js/symbolon_form.js",
	"Supplier": "public/js/symbolon_payee.js",
	"Employee": "public/js/symbolon_payee.js",
}

doc_events = {
	"Supplier": {
		"validate": "symbolon_erpnext.events.validate_wallet",
		"on_update": "symbolon_erpnext.events.on_payee_update",
	},
	"Employee": {
		"validate": "symbolon_erpnext.events.validate_wallet",
		"on_update": "symbolon_erpnext.events.on_payee_update",
	},
	"Purchase Invoice": {
		"on_submit": "symbolon_erpnext.events.on_submit_register",
		"on_cancel": "symbolon_erpnext.events.on_cancel",
	},
	# HRMS (v15 payroll lives in the hrms app). Harmless when HRMS is not installed.
	"Salary Slip": {
		"on_submit": "symbolon_erpnext.events.on_submit_register",
		"on_cancel": "symbolon_erpnext.events.on_cancel",
	},
	"Payment Order": {
		"on_submit": "symbolon_erpnext.events.on_payment_order_submit",
	},
}

scheduler_events = {
	"cron": {
		"* * * * *": ["symbolon_erpnext.tasks.poll"],
	},
}
