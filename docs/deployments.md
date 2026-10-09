# Deployments

## Arc Testnet (5042002)

| Contract / role | Address |
|---|---|
| Symbolon (verified) | [`0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9`](https://explorer.testnet.arc.io/address/0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9) |
| USDC (ERC-20 view) | `0x3600000000000000000000000000000000000000` |
| ADMIN | `0xD91D467DCe9dC26e4969EbbfD8690BF8bB9aCB6C` |
| APPROVER | `0x64C5B8fbC01bA4466ec95b4C3b74EFa34922D710` |
| AGENT | `0x91c9F1CF76de4160f498CCa639e592dC370e7B0E` |
| WITNESS | `0x1efb1Ce2e120CcB99A31fDf40f41CBd7BEd233E6` |
| COSIGNER | `0x9a91c4a72E561e57192A06dac22F2b5e44e87BCa` |
| GUARDIAN | `0x3902e4Ae19d7547b7f08c71C0aed5E6D34a3f1a4` |
| Mint deposit (surplus only goes here) | `0x31BF03fCb95D37e7322D8047F04b2f6436a92B63` (Circle Mint sandbox, chain ARC) |

**Parameters at deploy (2026-10-03):**

| Parameter | Value |
|---|---|
| Cosign threshold | 1,000 USDC |
| Period cap | 10,000 USDC per 86,400 s |
| Payee cooldown | 86,400 s |
| Grace | 259,200 s |

Machine-readable: `contracts/deployments/5042002.json`.

## Smoke run (2026-10-03)

| Step | Tx |
|---|---|
| setPayee `Supplier:TEST-VENDOR-01` | `0x308e28435115d16300261e868bb0cbdee53b5fb7a536bbc25a971a35e60516b8` |
| registerObligation `Purchase Invoice:ACC-PINV-SMOKE-0001`, 1 USDC | `0xf3a77a6472bf6da89c0f0481a3fd116ea4e937e7ab68b68df89dac0a735ed759` |
| fund vault, 2 USDC | `0xed9c9b330cf1c207e3fa4e53371df259f053e66838394e58af99367f3ed75b77` |
| attestWitness | `0xec6bf3f2037fec5db358ef836b1190358a6b7c12eebcbf74ab0534b0b96f1ab6` |
| commitDecision (Pay) | `0x92ea00d21c45f140358f58e0f1f492d2003cd114098c5ee1defaee3d24697b65` |
| **release, refused on-chain: `PayeeChangedRecently`** | [`0xca8b3d1e533b76ca578157d7040da0c7beb1f753cde45d0129f647330c8121eb`](https://explorer.testnet.arc.io/tx/0xca8b3d1e533b76ca578157d7040da0c7beb1f753cde45d0129f647330c8121eb) |

## Parameters now (changed 2026-10-09)

`setParams` tx `0x98b04512f46e44c7d117fa8330e8d31694d99a72a8f238b7bb3ab92cc4603791`:
- co-sign threshold **25 USDC** (was 1,000);
- period cap **500 USDC per day** (was 10,000);
- payee cooldown 24 h and grace 3 days, both unchanged.

The threshold was lowered so a co-sign refusal can be demonstrated with our small sandbox balance, and because $25 is a
realistic limit for a three-person company.

A second AGENT key, used only by the website's `/break-it` buttons: `0x03e8a71bb26684dC0A947E22b7B7aB27e43d0BaA`
(grant tx `0x4b8d8355a7876e337b46285e860004a040578a4d788d8af80b74352912e58ccc`). It holds about 1 test USDC of gas.

## Live services

| What | Where |
|---|---|
| Website (Vercel) | https://symbolon-dusky.vercel.app (`/try`, `/break-it`, `/obligations`, `/refusals`, `/api/*`) |
| ERPNext (our company's books) | https://erp.172-198-60-108.sslip.io (judge login: see README) |
| Trial service (behind `/try`) | https://api.172-198-60-108.sslip.io/health |
| Server | Azure D2as_v4 (2 vCPU, 8 GB), India South Central, Ubuntu 24.04, ufw 22/80/443, unattended-upgrades |

HTTPS is Caddy with Let's Encrypt for `sslip.io` hostnames:

```
erp.172-198-60-108.sslip.io { encode gzip
  reverse_proxy localhost:8090 }
api.172-198-60-108.sslip.io { reverse_proxy 127.0.0.1:8787 }
```

systemd units (each runs `scripts/services.sh`, which gives each service only its own key):

```
symbolon-witness.service   ExecStart=…/scripts/services.sh witness       Restart=always
symbolon-trial.service     ExecStart=…/scripts/services.sh trial         Restart=always
symbolon-agent.service     ExecStart=…/scripts/services.sh agent --once  (Type=oneshot)
symbolon-agent.timer       OnUnitActiveSec=6h
```

## First end-to-end payment (2026-10-09)

ERPNext `ACC-PINV-2026-00002`, $3.75, due the next day:
1. Submitted in ERPNext; registered on-chain by the app.
2. The agent (Haiku 4.5) decided to pay.
3. Circle Mint paid the treasury; the treasury forwarded $3.75 into the vault.
4. The witness attested: `0x743fa250eba5dac03b2967df6f561b39bed4d1034d5e55039adabcd9fd5ff45b`.
5. **Released:** `0xed0277edfa28a96cec9d709587160e6870cda30d6e1d9aa7df3f85b054d0119e`.
6. ERPNext booked Payment Entry `ACC-PAY-2026-00001` and marked the invoice Paid.

## /break-it fixtures (2026-10-09)

Seeded by `scripts/seed-break-it.sh`:
- Funding: Circle Mint → treasury `0x48d55a489be828e7bc09589845eb8bbcc53ca7a8388dba9dc0baa5c86204439b`, then
  treasury → vault (31.10 USDC) `0xee26f6f4b1fc2d1370e0f50ea3cb07c617afbc93df94647457841b5ffb4ec995`.
- The retry fixture's one real payment: `0x0ca5dddabe873ddcf41fdd1f6f611357aef847e3eb53a5206f259e590465713a`.
