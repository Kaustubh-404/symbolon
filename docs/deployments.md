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

**Parameters:**

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
