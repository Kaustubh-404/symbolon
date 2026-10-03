# Local ERPNext v15 + Symbolon (Docker)

`compose.yml` is adapted from frappe_docker's `pwd.yml`. It contains:

- MariaDB 10.6 and two Redis instances;
- a configurator and a `create-site` step;
- the backend, nginx frontend, websocket, two workers and the scheduler.

The image is built from [`Dockerfile`](Dockerfile): `ghcr.io/frappe/hrms:version-15` (frappe + erpnext + hrms +
payments) plus `pip install -e symbolon_erpnext` (which pulls in web3). The app source is also bind-mounted over the
baked copy, so Python edits only need a restart.

## Run

```bash
cd erpnext/docker
# optional, for live sends only; never commit it:  export SYMBOLON_APPROVER_PRIVATE_KEY=0x...
docker compose up -d --build
docker compose logs -f create-site      # first run: new-site + install erpnext, hrms, symbolon_erpnext (~5-10 min)
```

- URL: **http://localhost:8090** (bound to 127.0.0.1)
- Site: `symbolon.localhost`
- Login: **Administrator / admin**
- MariaDB root password: `admin` (local dev only)

To use plain ERPNext without HRMS: `ERPNEXT_BASE_IMAGE=frappe/erpnext:v15 docker compose up -d --build`. Payroll
fields and flows are then skipped automatically.

After editing Python: `docker compose restart backend queue-short queue-long scheduler`.

After changing fixtures or doctypes: `docker compose run --rm create-site` (this runs `migrate` on an existing site).

Configure the site (Symbolon Settings → Enabled, USDC Account), then:

```bash
docker compose exec backend bench --site symbolon.localhost execute symbolon_erpnext.tasks.poll_once
docker compose exec backend bench --site symbolon.localhost run-tests --app symbolon_erpnext   # pure tests run here too
```

Teardown, including data: `docker compose down -v`.

## What happened when this was built (2026-10-03)

**The instance was not brought up. The root filesystem ran out of space.**

- `/dev/nvme0n1p6` is 134 GB. It reached 129 GB used, 0 bytes available.
- Pulling `frappe/erpnext:v15` (3.68 GB unpacked), `mariadb:10.6` and `ghcr.io/frappe/hrms:version-15` (4.66 GB)
  filled it. `docker compose build` then failed with ENOSPC.
- The other containers already running on this machine (Postgres `keycard-db`, MySQL `flare-idx-db`, Redis) share
  that disk. So the images pulled for this task (`frappe/erpnext:v15`, `ghcr.io/frappe/hrms:version-15`,
  `mariadb:10.6`, `redis:6.2-alpine`) were removed again, which restored about 3 GB free.
- One ERPNext image alone needs more than 3 GB, and the site and database need more on top.
- Nothing else on the machine was touched. Build cache, other images, volumes and `~/.cache` (5 GB) were left alone.

**To run it:** free at least **8 GB** on `/`. Then the two commands above are all that is needed.

What was checked inside the `frappe/erpnext:v15` image before it was removed:

- versions: frappe 15.121.2, erpnext 15.121.6, Python 3.11.16, pydantic 2.12.5, requests 2.33.1. These are
  compatible with web3 7.x's requirements **[I]**.
- APIs the app relies on:
  - `Payment Order` + `Payment Order Reference` (`reference_doctype`, `reference_name`, `payment_request`, `supplier`,
    `amount`);
  - `frappe.utils.synchronization.filelock`;
  - `frappe.enqueue(job_id=, deduplicate=)`;
  - `get_payment_entry(dt, dn, party_amount, bank_account, …, reference_date=)`.

The HRMS image's `apps/` was confirmed as `erpnext, frappe, hrms, payments` (hrms 15.64.2).
