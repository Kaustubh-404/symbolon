# Platform notes: Arc Testnet + Circle Mint sandbox (measured 2026-10-01)

Wallet `0x676e9EacD4feB3322295ab5E399d7c316e26013b`, funded from faucet.circle.com with 20 USDC.

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Faucet balance, 18 vs 6 decimals | native `20000000000000000000` = `balanceOf` `20000000` ×10¹² | block 64986238 |
| 2 | ERC-20 USDC transfer, maxFee 30 gwei | ✅ status 1; **effective price 21 gwei** (20 base + 1 tip) | `0xf41a715791d7d62701beb5a951e37b7f44a9541b76b3cefa270d8303f4a65967` |
| 3 | Native value transfer | ✅ **EIP-7708 confirmed:** a `Transfer` log emitted by `0xffff…fffe`. Subgraph double-count hazard is real. | `0x921d042c52941a1359e66d9fe5f514ba1345d26314dc4f13a5a5ea0bca231f51` |
| 4a | maxFee 10 gwei **with** gas estimation | Rejected loudly: `-32000 max fee per gas less than block base fee` | — |
| 4b | maxFee 10 gwei, **explicit gas limit** (no estimation) | 🔴 **The RPC accepts it and returns a hash. It never mines: no receipt and no error, pending for more than 60s. It holds the nonce:** latest=3, pending=4. Every later tx from the wallet stalls behind it. | `0x2ef95ef4f823b26b2bd51279558f2ce8f4e6b45fdd66855d161ac96071b7238d` |
| 4c | Same-nonce replacement at 30 gwei | ✅ cleared it; the stuck tx is gone from the pool | `0xa61af5a17d3636c01a938c66ff8386ce94a0ab7e2fac2cc0c4b6182f4c724d59` |
| 5 | **Mint inbound:** 1 USDC from the spike wallet to the Mint sandbox ARC deposit address `0x31bf03fcb95d37e7322d8047f04b2f6436a92b63` | ✅ **Circle swept it 10 blocks (~5s) later** to Circle's sandbox omnibus `0x4E42177AB52202Ced872A5EF661dfc4794bB37bF` (sweep `0x49b7f433937b911703d0cc97a537da814731b257eecfa632512313bfced8ea32`). The sandbox watches Arc Testnet. | `0xc176a28f09a79e33c8f3a4859aad28629099e01cc73da02cfca079503d515be8` |
| 6 | **Mint outbound:** sandbox transfer of 5 USDC to the spike wallet on ARC | ✅ **Delivered 4s after the API call**, from the omnibus `0x4E42…37bF`, while the API still said `pending` | `0x9660be15a4459a6226b6e5b712cc766a67e90e98d2c8b5849e758f3d70762215` |
| 7 | **Primary issuance on-chain:** Circle minter `0x14e4A404B2bc39793B5e0AE258dfd7Fa178C5a68` calls `USDC.mint(0x4E42…37bF, 100.000000)` at 18:12:05Z, ~60s after our $100.00 mock wire. It is a `Transfer` from `0x0`. Attribution to *our* wire is **I**: the omnibus is shared, and other mints on it are $50, $123 and $50,000. | `0xe6c1182540fe0a96f08f0841cca9d1f99d69d30d0a0c0ac82ad01ca530a73b5f` |

## Design consequences

- **Day-killer #1 is worse than "vanishes."** An under-priced tx that skips estimation is a **nonce wedge**. The agent's
  signer must:
  - always set maxFee ≥ 2× base fee;
  - treat "hash but no receipt after N blocks" as `Stuck`, not `Failed`;
  - recover only by **same-nonce replacement**, never by a new nonce;
  - never fire a fresh tx after a timeout. A retry at a new nonce queues *behind* the stuck one, and when both land you
    have paid twice.

  That last point is the double-pay-on-retry path from the host's essay, reproduced on our own chain. It goes into the
  baseline harness as a fault class.
- The deposit address is per-account and per-chain, so the witness can match inbound funding by tx hash.

## 🟢 G1 ANSWERED — YES (2026-10-01)

The Circle Mint sandbox settles `chain: ARC` on **Arc Testnet 5042002**, in both directions, without KYB:

- **Inbound:** the deposit was detected and swept in about 5s.
- **Outbound:** the transfer landed in about 4s.
- **Issuance:** a mock wire becomes a real on-chain `USDC.mint` from a Circle minter key.

Primary issuance (supply goes up, `Transfer` from `0x0`) is visible on Arc and is distinct from Gateway's
burn-and-re-mint.

**Witness design consequences**

- The Mint API status **lags the chain** (`pending` after delivery). The witness must confirm on-chain, not trust the
  API status.
- Issuance lands in a **shared omnibus**, so a single mint cannot be attributed to our wire on-chain alone. The witness
  pairs:
  - the Mint API record (amount, time, our account),
  - the Circle-key `mint` event, and
  - the omnibus → payee transfer by tx hash.

  The "does not prove" section says so.
