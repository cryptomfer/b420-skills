---
name: b420
version: 1.0.1
description: Router for every B420 skill (b420.io, a DEX and launchpad on Base), as an AI agent; trade B20s, tokenized stocks, classic launches, holder-rewards tokens and index tokens; launch a classic B20 or a holder-rewards token; stake B420 or B69; claim every kind of reward; read market and portfolio data; run the permissionless keeper calls. Router skill; pick the intention, then follow the leaf. Canonical home of the signer modes (viem / private key, Bankr /wallet/submit, printed raw calldata for CDP, Safe and relayers), the money rules, the fee policy, the address book and the list of closed products an agent never touches.
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453), B420 is Base-only
examples_lib: examples/lib/b420.mjs
---

# B420: Skills for AI Agents (Router)

[B420](https://b420.io) is a DEX and launchpad on **Base (chainId 8453)**: B20 tokens, Coinbase
tokenized stocks, classic B20 launches, holder-rewards tokens, index tokens, and two staking
pools. **Every action in these skills is one raw transaction your own wallet signs, simulated on
Base mainnet before it is sent.** B420 never holds your keys.

This file routes you to the right leaf and holds the foundations every leaf links back to: signer
modes and broadcasting, money rules, the fee policy, the closed products, the address book, the
chain table and the shared example library. **Leaves do not restate these sections; they link
here.**

> **Read before any write:** the [money rules](#money-rules-canonical) and the
> [never-do list](#never-do-canonical-gates). Both apply to every leaf.

## I want | Read

| I want | Read |
|---|---|
| Buy or sell any token (path picker, approvals, slippage) | [`trade/SKILL.md`](trade/SKILL.md) |
| Trade B420, B69 or a tokenized stock (or any other B20) | [`trade/aggregator/SKILL.md`](trade/aggregator/SKILL.md) |
| Trade a token launched on B420 (classic launch) | [`trade/classic/SKILL.md`](trade/classic/SKILL.md) |
| Trade a holder-rewards token | [`trade/rewards-token/SKILL.md`](trade/rewards-token/SKILL.md) |
| Trade an index token | [`trade/index/SKILL.md`](trade/index/SKILL.md) |
| Launch a token (which kind, status, name check) | [`launch/SKILL.md`](launch/SKILL.md) |
| Launch a classic B20 | [`launch/classic/SKILL.md`](launch/classic/SKILL.md) |
| Launch a holder-rewards token | [`launch/rewards/SKILL.md`](launch/rewards/SKILL.md) |
| Stake, unstake, claim staking rewards (B420 or B69) | [`staking/SKILL.md`](staking/SKILL.md) |
| Claim anything else, or find what a wallet can claim | [`claim/SKILL.md`](claim/SKILL.md) |
| Leave a legacy dividend vault | [`staking/SKILL.md`](staking/SKILL.md) (legacy section) |
| Fund staking, flush hooks, pay all holders (permissionless) | [`keeper/SKILL.md`](keeper/SKILL.md) |
| Prices, holders, APR, a wallet portfolio | [`market-data/SKILL.md`](market-data/SKILL.md) |

## All skills

| Skill name | Folder | Covers |
|---|---|---|
| `b420` | [`./`](SKILL.md) | This router: signer modes, money rules, fees, gates, address book, chain, shared library |
| `b420-market-data` | [`market-data/`](market-data/SKILL.md) | Every public GET endpoint, cache hints, a wallet portfolio, the Privy-only list |
| `b420-trade` | [`trade/`](trade/SKILL.md) | Trade router: path picker, approvals table, slippage and deadline defaults, the 2-block launch delay |
| `b420-trade-aggregator` | [`trade/aggregator/`](trade/aggregator/SKILL.md) | POST /api/swap for B420, B69, tokenized stocks and other B20s |
| `b420-trade-classic` | [`trade/classic/`](trade/classic/SKILL.md) | Classic launches: Universal Router v4 (WETH pair), B420HopRouter (any other quote) |
| `b420-trade-rewards-token` | [`trade/rewards-token/`](trade/rewards-token/SKILL.md) | B420RewardsRouter buy and sell, the ETH-pair gas rule |
| `b420-trade-index` | [`trade/index/`](trade/index/SKILL.md) | B420IndexRouter buy and sell, Quoter-only pricing, the index stacks |
| `b420-launch` | [`launch/`](launch/SKILL.md) | Launch router: classic vs rewards, launch agent rules, status and name check, POST /api/launch/confirm |
| `b420-launch-classic` | [`launch/classic/`](launch/classic/SKILL.md) | POST /api/launch and factory v2 `deployToken`, options, creator slice management |
| `b420-launch-rewards` | [`launch/rewards/`](launch/rewards/SKILL.md) | POST /api/launch/rewards and `B420RewardsFactory.launch`, holders share, creator transfer |
| `b420-staking` | [`staking/`](staking/SKILL.md) | StakingB420 and StakingB69: stake, unstake (48h), withdraw, cancel, exit, getReward; legacy vault exit |
| `b420-claim` | [`claim/`](claim/SKILL.md) | Every claim for one wallet and wallet-wide discovery |
| `b420-keeper` | [`keeper/`](keeper/SKILL.md) | Permissionless maintenance: fee collectors, hook flushes, LP fees, distributors, dividend batches, ledger slots |

## Chain

| `chain` slug | chainId | gas coin you pay in | public RPC |
|---|---|---|---|
| `base` | 8453 | ETH | `https://mainnet.base.org` |

Explorer: [basescan.org](https://basescan.org). The public RPC rate-limits bursts (code `-32016`
"over rate limit"). Without `RPC_URL` the shared library falls back to
`https://base-rpc.publicnode.com` (it also serves `eth_simulateV1`) and retries with backoff; set
`RPC_URL` to your own Base node (Alchemy, Infura, QuickNode or similar) for anything beyond a few
calls. B420 exists only on Base.

## Signer modes and broadcasting (canonical)

Every write in every leaf is a **raw transaction `{ to, data, value, gas }` on chainId 8453**: the
calldata the leaf (or the b420.io prepare endpoint) hands you, signed by your wallet. Launches are
calls to a factory, not contract deployments, so any signer can send them.

- **Always** send that raw transaction: viem `sendTransaction`, CDP `sendTransaction`, a Safe
  transaction, a relayer, or Bankr `POST https://api.bankr.bot/wallet/submit`.
- **Never** use a wallet-SDK convenience helper (CDP `deployContract`, `deployToken`, a "swap"
  helper) or a natural-language prompt (`bankr prompt "buy ..."`): they rebuild the call, guess
  the route and drop the fee entries, the gas margin and the exact `value`. B420 calldata is long;
  a prompt cannot carry it.

| Mode | Env | How the examples send |
|---|---|---|
| Private key (viem) | `PRIVATE_KEY` | `walletClient.sendTransaction({ to, data, value, gas, type: "eip1559" })` with the explicit gas from the leaf's rule |
| Bankr (HTTP-only wallet) | `BANKR_API_KEY` + `BANKR_WALLET` | `POST https://api.bankr.bot/wallet/submit`, body below |
| Print (CDP, Safe, relayers, hardware) | none, plus `--from 0x...` to simulate | `--print` simulates every step, then prints one JSON line per step: `{"to","data","value","gas","chainId":8453}` (decimal strings) |

Bankr body (decimal strings for `value` and `gas`, never hex):

```json
{
  "transaction": { "to": "0x...", "data": "0x...", "value": "1000000000000000", "gas": "1556403", "type": 2, "chainId": 8453 },
  "waitForConfirmation": true
}
```

with headers `X-API-Key: $BANKR_API_KEY` and `Content-Type: application/json`. The response
carries `transactionHash`; wait for the receipt on Base before the next step.

**Bankr config gotchas** (the single copy in this repo; each one answers `403`):

1. **"Disable arbitrary contract calls"** must be **off** ([bankr.bot/security](https://bankr.bot/security)); it is on by default for new accounts.
2. **`walletApiEnabled`** must be **true** on the account.
3. **`readOnly`** must be **false** on the API key.
4. **`allowedRecipients`** must not exclude the B420 contracts; Bankr cannot read recipients out of calldata, so clear the list or add every contract in the [address book](#address-book-base-mainnet-chainid-8453) you call.
5. `value` and `gas` are **decimal strings**, `chainId` is `8453`. Hex strings or a missing gas get the call rejected or under-gassed.

**Key handling.** `PRIVATE_KEY` and `BANKR_API_KEY` come from the environment only. Never pass them
as CLI arguments, never print or log them, never include them in an error message or a commit.
The shared library keeps the viem account in module scope and never returns the key as a string.
Use a dedicated agent wallet funded with what the task needs.

## Money rules (canonical)

1. **Quote right before sending.** Prices, pool state and dev-buy quotes move every block. Leaves
   re-quote inside the same run; an old quote or an old launch prepare is stale.
2. **Simulate every step from the sending address.** Each example simulates the whole flow (approve
   then act, as one `eth_simulateV1` bundle) before anything is sent, and `--send` re-simulates
   each step right before broadcasting it. A revert means nothing is sent; so does an RPC that
   cannot run the bundle when a flow has more than one step.
3. **Send exactly the `value` a prepare or quote returns.** Launch prepares return the exact wei;
   router buys on ETH pairs send `value == amountIn`. Any other value reverts (`BadValue()`,
   `ExtensionMsgValueMismatch()`).
4. **Approve exact amounts.** The shared `approvalStep` approves exactly what the next step spends,
   and nothing when the allowance already covers it.
5. **Never resend after a timeout before checking.** Look up the receipt on Basescan, your nonce,
   and for a launch the predicted token address (status endpoint in
   [`launch/SKILL.md`](launch/SKILL.md)). A slow answer is not a failed transaction. The examples
   stop with "do not resend" when a receipt is late, when Bankr does not answer within 240 s or
   drops the connection, and when Bankr answers without a transaction hash (a 4xx is a refusal
   before broadcast).
6. **No blind retries.** A revert names its cause (`decodeRevert` prints the Solidity error); fix
   the cause, re-quote, re-simulate.
7. **APR and dividends are variable.** They follow trading volume and the amount staked; never
   present a live rate as fixed or guaranteed.
8. **Keep ETH for gas.** Every step pays Base gas in ETH; the library checks the balance before
   each send (`Not enough ETH on Base: you have X, this needs Y plus gas.`).

Slippage and deadline defaults live in [`trade/SKILL.md`](trade/SKILL.md).

## Fees (canonical)

Agent trades carry the same 1% frontend fee as trades on b420.io, to the same recipient, the
Strategic Reserve `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` (b420-site `lib/fees.ts`:
`SWAP_FEE_BPS` 100). This is on top of each pool's own LP or hook fee.

| Path | How it is applied |
|---|---|
| POST /api/swap (aggregator) | Server-side, on the input currency; the returned `amountOut` is already net |
| Classic launch, WETH pair (Universal Router) | `PAY_PORTION` 100 bps to the Strategic Reserve before the final `SWEEP` |
| Classic launch, other quote (B420HopRouter) | On the aggregator leg (POST /api/swap) |
| Rewards token and index token routers | The `fees` argument: `[(Strategic Reserve, 100)]` (lib `feeEntries()`) |
| Launches, staking, claims, keeper calls | No frontend fee |

POST /api/swap and the hop router leg built from it always carry 100 bps to the Strategic Reserve,
as on b420.io; the request has no fee or referral field. b420.io also has a referral split
(`[(referrer, 23), (Strategic Reserve, 67)]`) for a referrer bound to a logged-in profile through
`POST /api/referral`; an agent can neither bind nor verify one, so agent trades never use it and
`feeEntries()` always returns the single entry above.

## Never do (canonical gates)

Leaves never offer these; an agent asked to do one says it is closed and stops.

| Never | Why, and the onchain state that proves it |
|---|---|
| Curve launches or curve trading | `launchEnabled()` on the curve factory `0xb81c8fa0dB013f141edD056d1b920B7b0d2bC0a5` returns `false`; no token is on a curve (no curve rows in `/api/launches` or `/api/tokens`) |
| Stake into a legacy dividend vault | The vault factory `0xA0e85c7e3866c3bdC20CC2BEe78E04fdF214583A` answers `paused() == true`; existing stakers only exit ([`staking/SKILL.md`](staking/SKILL.md)) |
| Launch on factory v1 | `deprecated()` is `true` on `0x760AFca74b37B7D8a5a2b062eCB9DBDC3f0018fE`; `deployToken` reverts `Deprecated()` (`0xc73b9d7c`) |
| Create an index | Closed to the public: the site gate `NEXT_PUBLIC_B420_INDEX_LAUNCH_OPEN` is unset; no skill calls `createIndex` |
| Call distributor factory `create()` | The indexer trusts only `predict()` addresses; enabling a distributor is a logged-in site action |
| Call any owner or admin function | `setDeprecated`, `setKeeperOnly`, `setKeeper`, `setParams`, `setFundParams`, `setPermissionlessFunding`, `setMinForward`, stock registry edits, `setManager`, `setPaused`, `rescueToken`, any `set*`; they revert for anyone but the owner, and an agent never tries |
| Route rewards or index tokens through the Universal Router or an aggregator | No fee entries and, on ETH pairs, no gas margin; use [`trade/rewards-token/SKILL.md`](trade/rewards-token/SKILL.md) and [`trade/index/SKILL.md`](trade/index/SKILL.md) |
| Reuse a launch prepare | A classic prepare is single-use and its dev-buy quote goes stale; a rewards prepare's salt is bound to the sender |
| Call a Privy-authed endpoint | `/api/swap-event`, `/api/profile` writes, `/api/thesis` writes, `/api/referral`, `/api/distributor/*/enable`, `/api/push`, `/api/terms`, `/api/notifications`, `/api/airdrop/snapshot` (list in [`market-data/SKILL.md`](market-data/SKILL.md)) |

## Address book (Base mainnet, chainId 8453)

Every address below has code on Base (checked with `eth_getCode` on 2026-10-05; the Strategic
Reserve and protocolAdmin are EOAs). At run time prefer the addresses the API and the factories
return (`GET /api/launch` returns the live factory, `rewardsFactory.ledger()`, the index factory's
`splitter()`) over this table.

| Role | Address | Notes |
|---|---|---|
| B420Factory v2 (live) | `0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575` | `deployToken`; `feeCollector()` = FeeCollector v2 |
| B420Factory v1 (deprecated) | `0x760AFca74b37B7D8a5a2b062eCB9DBDC3f0018fE` | `deployToken` reverts `Deprecated()` |
| Live classic hook | `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc` | In the pool key of classic launches since 2026-09-20 |
| Retired v2 hook (2026-09-17 to 09-20) | `0x0c97593B847beb32341dA5AFb8cbe242F4f168Cc` | Launches of that window keep it |
| v1 hook | `0xf95E48163F68C20B14A4e82525DCCC4BdbaAa8cC` | Factory v1 launches |
| LP locker v2 | `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` | `tokenRewards(token)` holds the exact pool key |
| LP locker v1 | `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` | Factory v1 launches |
| ClankerFeeLocker | `0x20835181fD6F4e62AA8d630A89b0e5c8676808C6` | `availableFees`, `claim` (creator fees) |
| MEV block delay | `0x0028D5788aa5526Ab38920576c93A46048b09CD1` | `blockDelay()` = 2: pools revert `PoolLocked()` for 2 blocks after launch |
| Distributor factory | `0x049B3Ee15c41163458073072e9573BF0fb88D5d4` | Read `predict()` only; never `create()` |
| Distributor factory (previous generation) | `0x6c8DB32e7b49743c56505718f6f5CBADd18705B6` | Its distributors still pay holders (claims in [`claim/SKILL.md`](claim/SKILL.md)); never `create()` |
| Distributor extension | `0x79e3103B568eEF64c376cE3fCF0196342f56108D` | Launch extension: deploys the holder fee distributor inside a launch that shares its creator half with holders |
| Airdrop extension v2 | `0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2` | Launch airdrops, claim with a proof |
| B420HopRouter | `0x82C2B0c34f843A5724497ce809ae96a6eeb03721` | Classic launches on a non-WETH quote |
| Kyber router (hop leg) | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `allowedRouters` on the hop router |
| 0x AllowanceHolder (hop leg) | `0x0000000000001fF3684f28c67538d4D072C22734` | `allowedRouters` on the hop router |
| FeeCollector v1 | `0xB9366B662b610F730a50408Db17E550d64F06F44` | Launches before 2026-10-04; permissionless `forward`, `swapAndFund` |
| FeeCollector v2 | `0x22F005aa2b90E06C642C7462388b9d212D6344d8` | Current collector; permissionless `forward`, `swapAndFund` |
| B420StockRegistry | `0x5E4643c2F48c14e09f209CAe5A51455211e10c1E` | `allStocks()`, `stockCount()` = 10 |
| StakingB420 | `0xC411bA66d1819054f67cDE26424cd876DB703E79` | Stake B420, earn the 10 registry stocks; cooldown 172800 s |
| StakingB69 | `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309` | Stake B69, earn B420; cooldown 172800 s |
| B420RewardsFactory | `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31` | `launch`, `isRewardsToken`, `poolKeyOf`, `pairedOf` |
| B420RewardsHook | `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC` | Hook of every rewards pool |
| B420RewardsLedger | `0x8e95B431B70094B66836074B01c380A4935B7d49` | Creator, treasury, collector and staking slots |
| B420RewardsRouter | `0x383156D66BdA2369c6eE061C66aa3D32E38cec72` | `buy`, `sell` with fee entries |
| Index v3 factory | `0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF` | `isIndex`, `splitter()`; creation closed |
| Index v4 factory | `0xD408a52ff4871097A89977Ca9fc48dF0D4243293` | `isIndex`, `splitter()`; creation closed to agents |
| Index v3 hook | `0x5C654E637B6bC597A655DaB90867296d5Ae76888` | Hook of every v3 index pool |
| Index v3 ledger | `0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6` | The factory's `splitter()`: creator and holder ETH |
| Index v3 router | `0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4` | `buy`, `sell` with fee entries |
| Index v4 hook | `0x3A9721075D9f183648029058549A65C684D16888` | Hook of every v4 index pool (multi-hop constituent routes) |
| Index v4 ledger | `0x1B66965006fbaa476fc22B8432cc232b6148E958` | The v4 factory's `splitter()`: creator and holder ETH |
| Index v4 router | `0x7B519742705e71313E982dA1cC89c05C076DA4AB` | `buy`, `sell` with fee entries |
| Uniswap v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | |
| Universal Router | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | Classic WETH-pair trades |
| V4 Quoter | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` | Quotes for every v4 path |
| StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | Pool state reads |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Universal Router sells |
| Strategic Reserve (EOA) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` | Frontend fee recipient |
| protocolAdmin (EOA) | `0xa1aB6Eb729c08B774798418b95D9C00D6Ec73527` | Owner of the protocol contracts; nothing for agents |
| Legacy vault factory (paused) | `0xA0e85c7e3866c3bdC20CC2BEe78E04fdF214583A` | `paused()` = true |
| Curve factory (closed) | `0xb81c8fa0dB013f141edD056d1b920B7b0d2bC0a5` | `launchEnabled()` = false; listed only to verify the gate |
| WETH | `0x4200000000000000000000000000000000000006` | 18 decimals |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 decimals |

Live tokens:

| Token | Address | Decimals | Kind, how to trade |
|---|---|---|---|
| B420 | `0xB200000000000000000000231d6C1F1CE455ba32` | 18 | B20, supply 69; aggregator |
| B69 | `0xB2000000000000000000007594Fe5aCD56DF3937` | 18 | B20, supply 420; aggregator |
| NVDAc | `0xb20000000000000000000078ee7ce2fE4908108C` | 8 | Registry stock; aggregator |
| AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` | 8 | Registry stock; aggregator |
| GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` | 8 | Registry stock; aggregator |
| METAc | `0xb2000000000000000000008bC8786B856E61707C` | 8 | Registry stock; aggregator |
| AMZNc | `0xb200000000000000000000d9192b6B456483C2E8` | 8 | Registry stock; aggregator |
| MSFTc | `0xB200000000000000000000Ab99cFa739E253872B` | 8 | Registry stock; aggregator |
| TSLAc | `0xb2000000000000000000001e800a7f5189430cD0` | 8 | Registry stock; aggregator |
| MSTRc | `0xb2000000000000000000004884b426556b92883d` | 8 | Registry stock; aggregator |
| SPCXc | `0xb2000000000000000000007b9fcbd005511aCBd5` | 8 | Registry stock; aggregator |
| SNDKc | `0xb200000000000000000000397293Cb8cda9a10c5` | 8 | Registry stock; aggregator |
| RWT3U6F | `0x550F0Dc867c6BD39c2a09874109b62414081b420` | 18 | Rewards token, ETH pair, holdersBps 6000; rewards router |
| RWS8222 | `0x4E0fDAcc7d20C8Ce25B46bB584b5d20bc29db420` | 18 | Rewards token, NVDAc pair, holdersBps 10000; rewards router |
| MEOW | `0xd29327FC1933bC6391d225A71bc1612A6Ed4b420` | 18 | Index (v3), holdersBps 5000; index router |
| COIN5 | `0x7013546C860e527c1af0E6F809F95AAAe27cB420` | 18 | Index (v3), holdersBps 5000; index router |
| OG | `0x30261039E77Af71C7E69CDb571335E9e3214B420` | 18 | Index (v4) OG Memes Index: TOSHI, TYBG, CHAD, DICKBUTT, mfercoin; holdersBps 5000; index router v4 |
| ADA (sample classic launch) | `0xb200000000000000000000686f75bdeb7183b420` | 18 | Classic launch, WETH pair; Universal Router |

The registry rows follow `allStocks()` order (fund-minimum arrays use this order).
`StakingB420.rewardTokens()` lists the same ten in another order, METAc first; read it, never
assume the order. More stocks: `GET /api/stocks`, `/api/cbstocks`, `/api/st0x` in
[`market-data/SKILL.md`](market-data/SKILL.md).

## Shared example library

[`examples/lib/b420.mjs`](examples/lib/b420.mjs) is the one helper module every example imports
(`import { ... } from "../../examples/lib/b420.mjs"` from `<area>/examples/`). Install once at the
repo root:

```bash
npm ci               # the only dependency is viem, pinned in package-lock.json
```

| Export | What it is |
|---|---|
| `CHAIN_ID`, `RPC`, `RPC_FALLBACK`, `API` | 8453; `RPC_URL` or `https://mainnet.base.org`; `https://base-rpc.publicnode.com` (used only without `RPC_URL`); `B420_API` or `https://b420.io/api` |
| `ETH`, `ZERO` | `0xEeee...EEeE` (native ETH for POST /api/swap); `0x0000...0000` (native ETH in v4 pool keys, routers, ledgers) |
| `ADDR`, `INDEX_STACKS` | The address book above (checksummed); index stacks to iterate (v3 and v4) |
| `FEE_BPS` | 100 |
| `ERC20_ABI`, `COMMON_ERRORS_ABI` | viem `parseAbi` arrays; the second names B20, B420 and Uniswap errors |
| `publicClient` | viem client on Base with multicall batching and rate-limit retries |
| `parseArgs`, `fail`, `usage`, `exit`, `out`, `basescan`, `shortAddr` | CLI parsing, exit 1 / exit 2 / any code (call `exit`, not `process.exit`: Node 24 on Windows can abort with 127 when `process.exit` runs right after a network request), JSON or readable output, explorer links. `fail` redacts `RPC_URL` from every message |
| `errorLine(e)` | One line for an unexpected error (viem's `shortMessage`, never the request URL); every script ends with `main().catch((e) => fail(errorLine(e)))`, and the library prints anything uncaught the same way |
| `getSigner(flags)` | `{ mode: 'bankr' \| 'key' \| 'none', address }` in that order of precedence |
| `toUnits`, `fromUnits` | Decimal string to bigint with the token's decimals, and back |
| `api(path, { method, body })` | b420.io API client; non-2xx throws `Error("<status> <error>")` with `.status`, `.body` |
| `tokenMeta(address)` | `{ address, symbol, decimals }`, cached; ETH and ZERO give ETH, 18 |
| `feeEntries()` | Fee entries `[(Strategic Reserve, 100)]` for the Universal Router and the rewards and index routers (see [Fees](#fees-canonical)) |
| `approvalStep({ token, owner, spender, amount })` | An exact-amount `approve` step, or `null` when the allowance covers it |
| `gasFor(rule, estimate)` | Gas limit per rule: `default`, `urSwap`, `stockApprove`, `rewardsEthTrade`, `rewardsErc20Trade`, `indexTrade`, `classicLaunch`, `rewardsLaunch`, `rewardsLaunchEthDevBuy`, `ledgerStakingSlot`, `batchPay` |
| `decodeRevert(err, abis)` | `"Name(arg, ...)"` from any revert |
| `simulateSteps(steps, from)` | One step: `simulateContract` plus `estimateGas`; several: one `eth_simulateV1` bundle |
| `sendSteps`, `printSteps`, `runSteps` | Broadcast, print raw JSON, or the standard simulate / `--send` / `--print` ending (`--send` simulates the whole flow before step 1 goes out) |

Library self-test, 2026-10-05, from a B420 holder on Base mainnet: an `approve` + `stake(1 B420)`
bundle on StakingB420 simulated through `eth_simulateV1` (approve 45,987 gas, stake 312,558 gas),
`stake(0)` decoded as `ZeroAmount()`, and a stake without approval decoded as the B20 error
`InsufficientAllowance(spender, 0, needed)`.

Env vars:

| Var | Meaning |
|---|---|
| `PRIVATE_KEY` | Agent wallet key, 32-byte hex (never printed) |
| `BANKR_API_KEY` | Bankr API key (never printed) |
| `BANKR_WALLET` | Your Bankr wallet address (required with `BANKR_API_KEY`) |
| `RPC_URL` | Your own Base RPC (recommended); redacted from every error the examples print |
| `B420_API` | API base override (default `https://b420.io/api`) |
| `FROM` | Default `--from` for simulation without a key |

Common CLI flags (every example):

| Flag | Effect |
|---|---|
| (no action) | Read state only |
| `<action>` | Simulate every step from the signer, or from `--from` when no key is set, and print the calls |
| `--from 0x...` | Simulate as this address (no key needed) |
| `--send` | Simulate the whole flow, then re-simulate and broadcast each step in turn (needs `PRIVATE_KEY`, or `BANKR_API_KEY` + `BANKR_WALLET`) |
| `--print` | Simulate, then print one raw transaction JSON line per step |
| `--json` | Machine-readable output |

Exit codes: `0` ok, `1` failure or a simulation revert, `2` usage error.

## About @b420/sdk and b420.io/docs

The `@b420/sdk` package (0.1.0) and the API reference at b420.io/docs predate factory v2, the
holder-rewards stack and the index stack: they name factory v1, which reverts `Deprecated()`,
still describe dividend vaults, which are closed, and do not cover the rewards router, the index
router, the hop router or distributor claims. The flows in this repo use the REST API plus viem
directly and do not depend on either.

## Related skills

- [`market-data/SKILL.md`](market-data/SKILL.md): public read catalog and wallet portfolio
- [`trade/SKILL.md`](trade/SKILL.md): trade router and path picker
- [`launch/SKILL.md`](launch/SKILL.md): launch router
- [`staking/SKILL.md`](staking/SKILL.md): StakingB420 and StakingB69
- [`claim/SKILL.md`](claim/SKILL.md): every claim for one wallet
- [`keeper/SKILL.md`](keeper/SKILL.md): permissionless maintenance calls

## License

CC0.
