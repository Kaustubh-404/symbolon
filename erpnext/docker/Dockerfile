# ERPNext v15 (+ HRMS when BASE is the hrms image) with the Symbolon app baked in.
# Build context is erpnext/ (the parent of this folder).
ARG BASE=ghcr.io/frappe/hrms:version-15
FROM ${BASE}
USER frappe
WORKDIR /home/frappe/frappe-bench
COPY --chown=frappe:frappe symbolon_erpnext apps/symbolon_erpnext
RUN ./env/bin/pip install --no-cache-dir -e apps/symbolon_erpnext \
 && ./env/bin/python -c "import web3, symbolon_erpnext; print('web3', web3.__version__)" \
 && (grep -qx symbolon_erpnext sites/apps.txt || echo symbolon_erpnext >> sites/apps.txt)
