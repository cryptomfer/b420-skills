---
name: b420-launch
version: 1.0.0
description: "Launch a token on B420 (Base) as an AI agent, in one transaction from your own wallet: a classic B20 on the B420 Factory (Uniswap v4 pool, liquidity locked, creator fee slice, optional dev buy, optional holder distributor and airdrop) or a holder-rewards token (part of the creator half paid to holders as dividends in the paired asset). Router skill; pick the kind, then follow the leaf. Canonical home of the launch agent rules (ONE LAUNCH PER NAME AND TICKER, PREPARE RIGHT BEFORE SENDING, SEND THE EXACT VALUE, NEVER RESEND ON A TIMEOUT WITHOUT CHECKING), the name check and POST /api/launch/confirm. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers. Trading the new token is trade/; claiming its fees is claim/."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
factory_v2: 0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575
rewards_factory: 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
---

# B420 Launch: Router

B420 launches two kinds of token on **Base (chainId 8453)**, and both follow the same
shape: b420.io prepares the exact transaction (`POST`), your own wallet signs and pays the
gas, and **one transaction mints the token, creates its Uniswap v4 pool, locks the
liquidity and wires the fee split, atomically**. Every token address ends in `b420`; the
server mines the salt for it. Nothing about a launch needs a login.

This file routes you to the right leaf and holds what both leaves share: the launch agent
rules, the status and name check, and the confirm call. **Both leaves link back here for
those instead of restating them.**

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../SKILL.md).

> **Curve launches are closed.** The bonding-curve factory's `launchEnabled()` reads false
> and no token trades on a curve. There is no curve path in this repo.

> **b420.io/docs and @b420/sdk launch samples target factory v1, which is deprecated.**
> Factory v1 `0x760AFca74b37B7D8a5a2b062eCB9DBDC3f0018fE` reverts every `deployToken` with
> `Deprecated()` (`0xc73b9d7c`). The SDK's `parseB420Config` also leaves
> `extensionConfigs[].msgValue` as a string and `deployPrepared` sends no value, so a dev
> buy launch fails through it. Use the leaves here (REST plus viem); they target factory v2
> `0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575` and the rewards factory.

## Pick the kind

| | Classic B20 | Holder-rewards token |
|---|---|---|
| Token | B20 (Base's native token standard, minted through the chain precompile), 18 decimals, no admin | ERC-20 `B420RewardsToken`, 18 decimals, no owner, pays dividends itself |
| Call | B420Factory v2 `deployToken(DeploymentConfig)` payable, `0xf8d04011` | B420RewardsFactory `launch(LaunchParams)` payable, `0x1379dda9` |
| Pool and hook | Uniswap v4 with the static-fee hook `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc`: 1% LP fee on every swap; liquidity in one position locked forever in LP locker v2 | Uniswap v4 with the rewards hook `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC`: LP fee 0, the hook takes 1% of the paired leg of every swap; supply minus a 0.001-token dead floor in one hook-owned position, locked forever |
| Fee split (enforced onchain) | Of the LP fee: **50% creator slice**, 50% FeeCollector v2 (`B420_CREATOR_BPS` = `B420_PROTOCOL_BPS` = 5000 in the factory) | Of the 1% fee: **creator half 50%** (`holdersBps` of it to holders), treasury 20%, B420 leg 15%, stock leg 15% (hook constants) |
| What the creator earns | 50% of LP fees, in both pool currencies or the quote alone, claimed from the ClankerFeeLocker | The creator half minus the holders' part, in the paired asset, claimed from B420RewardsLedger |
| What holders earn | Nothing by default; with `shareWithHolders` the whole creator slice goes to a holder distributor (merkle claims) | `holdersBps / 10000` of the creator half, in the paired asset, credited to every eligible holder (`claimDividend`) |
| Paired assets | WETH (default) or any ERC-20 or B20 with a price; outside the governed quotes a market of at least $5,000 | Native ETH (default) or any ERC-20 with a price; same $5,000 floor outside the governed quotes |
| Dev buy | Optional, in ETH (at most 50), run inside `deployToken` by a dev-buy extension; tokens to your wallet | Optional, in paired units (at most 50 ETH of value), run inside `launch`; ERC-20 pairs approve first; tokens to the creator |
| Extras | Holder distributor (created inside the launch), list airdrop of 0.01% to 90% of supply with lockup and vesting | None |
| Creator controls after launch | `updateFeePreference`, `updateRewardRecipient` on LP locker v2 | `raiseHoldersBps` (raise-only), `transferCreator` on the ledger |
| Leaf | [`classic/SKILL.md`](classic/SKILL.md) | [`rewards/SKILL.md`](rewards/SKILL.md) |

| I want | Read |
|---|---|
| A plain token, my fees in both currencies, liquidity locked | [`classic/SKILL.md`](classic/SKILL.md) |
| A token whose holders are paid in ETH or a tokenized stock on every trade | [`rewards/SKILL.md`](rewards/SKILL.md) |
| All my creator fees to my holders, in the quote | [`classic/SKILL.md`](classic/SKILL.md) with `shareWithHolders` |
| Part of the supply airdropped to a list | [`classic/SKILL.md`](classic/SKILL.md) with `airdrop` |
| Trade a token after launch | [`../trade/SKILL.md`](../trade/SKILL.md) |

## Agent rules (every launch)

1. **Check the name first: one launch per (name, ticker).** Run the name check in
   section 1 before preparing. A pair that exists (case-insensitive, whitespace collapsed)
   is refused by both prepares with `409 { code: "duplicate", existing }`, and the rewards
   factory also refuses an exact pair onchain with `NameTaken(address)` (`0xedf7405f`).
   Pick another name or ticker; never strip or pad characters to slip past the check.
2. **Prepare right before sending, and never reuse a prepare.** A classic dev buy carries
   a first-hop quote that goes stale (the launch then reverts on its minimum out), an
   airdrop prepare writes its merkle tree for the predicted address, and a rewards salt is
   mined for one sender (`BadVanity(address)`, `0x32476710`, from any other wallet).
   One prepare, one send; anything changed means a new prepare.
3. **Send exactly `value` from the prepare, as wei.** Classic: the factory reverts
   `ExtensionMsgValueMismatch()` (`0xbc9b8348`) unless `msg.value` equals the sum of
   `extensionConfigs[].msgValue`. Rewards: native ETH pair `value` = `devBuy`, ERC-20 pair
   `value` = 0, otherwise `BadValue()` (`0x0bba69fb`). Never round, never add a cushion.
4. **Simulate the exact transaction from the sending wallet before signing.** The server
   simulates with a faked ETH balance; your simulation catches the real balance, the
   allowance and a stale quote. The examples do this on every run.
5. **Never resend on a timeout before checking.** A slow receipt is not a failure. Check,
   in order: the receipt of your hash, `eth_getCode` at `predictedAddress` (code means the
   token exists), then `GET https://b420.io/api/launches?creator=<your wallet>`. A fresh
   prepare after a launch that did land mints a second token if the duplicate check has
   not seen the first one yet.
6. **Trading opens 2 blocks after the launch block.** Both pool kinds revert `PoolLocked()`
   (`0x2e136745`) before that; the in-launch dev buy is the only exception. The delay and
   the trade paths are in [`../trade/SKILL.md`](../trade/SKILL.md).

## 1. Status and name check

```bash
curl https://b420.io/api/launch
# {"paused":false,"live":true,"factory":"0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575",
#  "predictedSuffix":"b420","openingValuationUsd":3630.98}
```

| Field | Meaning | Do |
|---|---|---|
| `paused` | The site-wide launch switch | `true`: stop, launches are paused |
| `live` | The factory suite is configured | `false`: stop |
| `factory` | The live classic factory | Must equal `factory_v2` above; anything else, stop |
| `predictedSuffix` | Every token address ends in it | `b420` |
| `openingValuationUsd` | Opening fully diluted valuation of every launch (the degen preset, the same at any supply) | Informational, about $3,600 |

Name check, classic and rewards alike (no auth, no rate limit on the classic route):

```bash
curl "https://b420.io/api/launch?name=My%20Token&symbol=MYT"
# {"taken":false}
# {"taken":true,"existing":{"token":"0x…b420","name":"My Token","symbol":"MYT","launchedAt":"…"},"error":"A token named …"}
```

For a rewards launch use `GET https://b420.io/api/launch/rewards?name=&symbol=`: same
answer, plus the rewards factory's own `byNameSymbol` rule (exact bytes), which also covers
a launch the database has not indexed yet (60 GET per minute per IP).

Preview a quote before a classic launch: `GET https://b420.io/api/launch?quote=0x…` returns
`{ ok, address, name, symbol, logo, governed, deep, decimals, priceUsd, liquidityUsd }` or
`{ ok: false, error }`, the same check the prepare runs.

## 2. Prepare and send

- **Classic B20:** [`classic/SKILL.md`](classic/SKILL.md) sections 1 to 3 (`POST /api/launch`,
  restore the bigints, simulate and send `deployToken`). Script:
  [`examples/launch-classic.mjs`](examples/launch-classic.mjs).
- **Holder-rewards token:** [`rewards/SKILL.md`](rewards/SKILL.md) sections 1 to 3
  (`POST /api/launch/rewards`, approve the paired asset when asked, simulate and send
  `launch`). Script: [`examples/launch-rewards.mjs`](examples/launch-rewards.mjs).

## 3. Confirm: POST /api/launch/confirm

Right after the receipt, tell b420.io about the launch so the token page, the launch feed
and the duplicate check know it in the same second (otherwise the worker indexes it in
about 2 minutes):

```bash
curl -X POST https://b420.io/api/launch/confirm -H 'content-type: application/json' \
  -d '{"txHash":"0x…"}'
```

| Status | Body | Do |
|---|---|---|
| 200 | classic `{ ok: true, token, routed, distributor, pending }`; rewards `{ ok: true, token, kind: "rewards" }` | Done. Token page: `https://b420.io/terminal/<token>` |
| 404 | `{ ok: false, error: "receipt not found yet" }` | The public node lags; retry every 6 s, up to 10 times |
| 400 | `"bad tx hash"`, `"transaction reverted"` or `"not a B420 launch"` | Do not retry; read the receipt |
| 429 | `"too many requests"` (12 per minute per IP) | Wait a minute |
| 502, 503 | Chain or database unreachable | Skip it: the worker indexes the launch anyway |

The route trusts nothing but the hash: it fetches the receipt itself and records only a
`TokenCreated` from factory v2 or a `RewardsTokenCreated` from the rewards factory. For a
rewards launch it also attaches the image and links the prepare stored as a draft. `routed`
is true when the classic creator slice pays a holder distributor; `distributor` is its
address and `pending` true while that contract does not exist yet.

## After launch

- **Trade it** (2 blocks after the launch block): classic launches through
  [`../trade/classic/SKILL.md`](../trade/classic/SKILL.md), rewards tokens through
  [`../trade/rewards-token/SKILL.md`](../trade/rewards-token/SKILL.md).
- **Claim your fees:** [`../claim/SKILL.md`](../claim/SKILL.md) (classic creator fees in the
  ClankerFeeLocker; rewards creator slot in the ledger).
- **Manage:** the classic creator slice in
  [`classic/SKILL.md`](classic/SKILL.md#manage-your-creator-slice); `raiseHoldersBps` and
  `transferCreator` in [`rewards/SKILL.md`](rewards/SKILL.md#manage-raiseholdersbps-and-transfercreator).

## What this is NOT

- Not a curve launch: the curve factory is closed (`launchEnabled()` false).
- Not a dividend-vault launch: the vault factory is paused and no new vault can be made.
  Existing vault stakers exit through [`../staking/SKILL.md`](../staking/SKILL.md).
- Not index creation: it is closed to the public; trading existing indexes is
  [`../trade/index/SKILL.md`](../trade/index/SKILL.md).
- Not gasless: you sign and pay the gas, a few cents on Base. There is no sponsored route.
- Not metadata editing after launch: the token page's edit form needs a b420.io login.
- Not the SDK: `@b420/sdk` and b420.io/docs carry factory v1 launch samples; do not copy them.

## Related skills

- [`../SKILL.md`](../SKILL.md): root router, signer modes, money rules, fee policy, address book
- [`classic/SKILL.md`](classic/SKILL.md): classic B20 launch on factory v2, options, creator slice management
- [`rewards/SKILL.md`](rewards/SKILL.md): holder-rewards launch, approval step, ledger creator calls
- [`../trade/SKILL.md`](../trade/SKILL.md): path picker, the 2-block launch delay, approvals
- [`../claim/SKILL.md`](../claim/SKILL.md): claim creator fees, dividends, distributor and airdrop allocations
- [`../market-data/SKILL.md`](../market-data/SKILL.md): `/api/launches`, `/api/token`, every public GET

## License

CC0.
