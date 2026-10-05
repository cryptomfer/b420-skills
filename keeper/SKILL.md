---
name: b420-keeper
version: 1.0.0
description: "Run the permissionless B420 maintenance calls as an AI agent: FeeCollector v1 and v2 forward and swapAndFund (fund the staking pools with B420 and tokenized stocks), rewards hook and index hook flush, LP locker collectRewards for classic launches, holder distributor sync and claimMany, paying every holder of a rewards or index token with claimDividendFor in sized batches (150 payees on ETH pairs, 80 on ERC-20 pairs, gas estimate x 1.25 capped at 16M), and ledger claims on behalf of the fixed recipients. Anyone may call these, nothing depends on them, the caller pays gas and receives nothing. NEVER call an owner or admin function. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers. One wallet's own claims are the b420-claim skill; staking is the b420-staking skill."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
fee_collector_v1: 0xB9366B662b610F730a50408Db17E550d64F06F44
fee_collector_v2: 0x22F005aa2b90E06C642C7462388b9d212D6344d8
stock_registry: 0x5E4643c2F48c14e09f209CAe5A51455211e10c1E
rewards_factory: 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
rewards_hook: 0x2d04aCae52491E882dd6D606F3A8160945fA2aeC
rewards_ledger: 0x8e95B431B70094B66836074B01c380A4935B7d49
index_factory_v3: 0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF
index_factory_v4: 0xD408a52ff4871097A89977Ca9fc48dF0D4243293
index_hook_v3: 0x5C654E637B6bC597A655DaB90867296d5Ae76888
index_ledger_v3: 0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6
index_hook_v4: 0x3A9721075D9f183648029058549A65C684D16888
index_ledger_v4: 0x1B66965006fbaa476fc22B8432cc232b6148E958
lp_locker_v2: 0x351C934d698eB3c0683066D2fbD6CE7215573Bc4
lp_locker_v1: 0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3
fee_locker: 0x20835181fD6F4e62AA8d630A89b0e5c8676808C6
distributor_factory: 0x049B3Ee15c41163458073072e9573BF0fb88D5d4
distributor_factory_previous: 0x6c8DB32e7b49743c56505718f6f5CBADd18705B6
---

# B420 Keeper: Skill for AI Agents

B420's fee machinery runs by itself during trades, and a few public calls let anyone move it
along between trades: convert the protocol's fees into staking rewards, credit holder fees that
wait in a hook, pull pool fees into the fee locker, sync a holder distributor, pay every holder of
a token in one transaction, or push a ledger slot to its fixed recipient. **Every call here is
permissionless, nothing depends on it, the caller pays the gas and receives nothing.** All of
them run on **Base (chainId 8453)**.

[`examples/keeper.mjs`](./examples/keeper.mjs) reads what is pending (`status`), builds one call,
simulates it on Base and sends it only with `--send`. It refuses to build a call the reads show
has nothing to do.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../SKILL.md).

> **Never an owner or admin function.** The collectors, the stock registry, the lockers and the
> distributor factories also expose `setKeeperOnly`, `setKeeper`, `setParams`, `setFundParams`,
> `setPermissionlessFunding`, `setMinForward`, `setRegistry`, `setStakings`, `setTreasury`,
> `setOps`, `setWethUsdcPool`, `setB420PoolKey`, `setManager`, `setPaused`, `setRootPoster`,
> `rescueToken`, `withdrawETH`, `withdrawERC20`, registry edits and the distributor factory's
> `create()`. Self-call legs (`buyB420Tranche`, `buyStockTranche`, `sellToWeth`, `intakeOf`,
> `pushInKind`, the hooks' `buybackLeg`) revert `OnlySelf()` for anyone else, and
> `creditFromLedger` is the rewards ledger's own intake. None of them is a keeper call; an agent
> never sends one ([root router](../SKILL.md#never-do-canonical-gates)).

> **You receive nothing.** No call here pays its caller. Send one only when `status` shows pending
> work and the simulation succeeds; the funds always go to the stakers, the holders, the creator,
> the Strategic Reserve, the ops wallet or the collector. Keeper calls carry no frontend fee.

## Agent rules

1. **Read the gate first.** `keeperOnly()` must be `false` (else both `swapAndFund` variants revert
   `NotKeeper()`, `0xf512b278`) and `permissionlessFundingEnabled()` must be `true` for the
   no-argument `swapAndFund()` (else `FundingDisabled()`, `0x978a151c`: pass minimums instead).
   Both collectors read `false` / `true` on 2026-10-05; read them again before every run.
2. **Read readiness, then simulate.** Check `minWethForFund`, the cooldown (`fundCooldown` on v1,
   the per-leg `legCooldown` on v2) and the `collectors[]` block of `GET /api/buybacks`
   (`belowMinimum`, `readyAt`, `stockBucketsToSell`). A run that cannot start reverts
   `TooSoon()` (`0x6fed7d85`) or `BelowThreshold()` (`0xae274200`).
3. **Skip on a simulated revert; never send to try.** The simulation is the answer. `--send`
   re-simulates each step and stops before broadcasting one that reverts.
4. **Skip calls with nothing to do.** `flush`, `sync`, `collectRewards` and `claimAllFor` succeed
   while moving nothing, and the gas is still spent. `keeper.mjs` reads the pending amounts and
   builds no `flush`, `sync`, `claimAllFor` or `pay-holders` call when they are zero;
   `collectRewards` has no cheap pending read, so call it only when a claim, a `forward` or a `sync`
   needs the pool's fees.
5. **Size batches by the rules.** `claimDividendFor`: at most 150 payees on an ETH pair and 80 on an
   ERC-20 pair, gas `estimate x 1.25` capped at 16,000,000 (library rule `batchPay`), and a batch
   whose estimate is above 12,000,000 split in two. `claimMany`: one API page (at most 300 leaves)
   or less per transaction, same gas rule.
6. **Respect the gas the operator allows.** If the operator set a per-transaction or a daily gas
   budget, stay under it: drop to smaller batches, or skip. FeeCollector v2 legs each need their
   whole `legGas` budget (2,000,000 today) or the call reverts `InsufficientGas()`; the estimate
   already includes that headroom, so never cut a v2 limit below the estimate.

## Status: what needs doing

```bash
npm ci                                          # once, at the repo root
node keeper/examples/keeper.mjs                 # status, read only: collectors, hooks, ledgers, distributors, payouts, then a todo list
node keeper/examples/keeper.mjs status --json
```

`GET /api/buybacks` `collectors[]`, one entry per collector:

| Field | Meaning |
|---|---|
| `version`, `address` | 1 or 2, the collector |
| `nextBuy`, `nextBuyUsd` | Wei of WETH the next run would spend on B420 (tranche cap applied) |
| `stockBucketsToSell` | v2: listed stocks whose B420 bucket the run sells into WETH first (0 on v1) |
| `wethWaiting` | WETH at the collector and in its fee locker balance |
| `minWethForFund`, `belowMinimum` | The run minimum, and whether the WETH legs are below it today |
| `readyAt` | Unix seconds when the cooldown allows the next B420 buy (0: now) |
| `lastFundAt` | Last run that executed a leg |

The same response's `indexPot` reports the index hook's buyback pot (`pending`, `min`,
`maxPerTrade`, `status`); it is spent during index trades, never by a keeper call.
`GET /api/rewards` `collectors[]` adds the collectors' `params`, `permissionless`, `keeperOnly` and,
per asset, `pending` (v2: `newIncome`, `b420Leg`, `stockLeg`).

Onchain, what `status` reads:

| Pending work | Read | Action |
|---|---|---|
| Fees in a collector | `pendingOf(token)` (fee locker balance plus held) on each collector, for WETH, B420, every registry stock and every classic launch currency; v2 `reservedOf(asset)` is already earmarked | `forward` (section 2), `fund` (section 1) |
| Parked rewards-token holder fees | rewards hook `pendingHolders(poolIdOf(token))` | `flush` (section 3) |
| Index fee shares and sold shares not burned | index hook `pendingCreatorFee(index)`, `pendingOpsFee(index)`, index `claimedBurn()`; v4 hooks also `pendingHolders(index)` | `flush` (section 3) |
| Distributor fees still in the fee locker | `availableFees(distributor, token)` and `(distributor, paired)`, for `allDistributors()` of both factories | `sync` (section 5) |
| Holders owed a dividend | `owed` of the payout lists (section 6) | `pay-holders` (section 6) |
| Ledger slots | rewards ledger `claimable(token, 1..3)`; index ledger `claimable(index, ops, 0x0 / index)` | `ledger` (section 7) |

Simulated on Base mainnet, 2026-10-05: `status` read both collectors (gates false / true; v1 holds 0.00000077 WETH in its fee locker plus METAc and six launch residues; v2 holds 0.00000056 WETH and 888 raw NVDAc, all earmarked), both rewards pools (nothing parked), both indexes (nothing pending; MEOW 4 and COIN5 1 holders owed), 6 live distributors (nothing unsynced) and listed 16 todo items, gas n/a (reads).

## 1. Fund the staking pools: swapAndFund

**FeeCollector v1** (launches before 2026-10-04) converts WETH only: 20% of the WETH that arrived
since the last run goes to the ops wallet, then 25/80 of the rest buys B420 (capped at
`maxB420TrancheWeth`) for StakingB69 and 55/80 buys the registry stocks in equal parts for
StakingB420. It claims its WETH from the fee locker first. Live `params()`: `minWethForFund` 1 wei,
`maxB420TrancheWeth` 0.05 WETH, `fundCooldown` 0 s, `maxDeviationBps` 500.

**FeeCollector v2** (launches since 2026-10-04, and the rewards ledger's collector slot) splits
every asset's new income 40% Strategic Reserve in kind, 30% B420 leg (StakingB69), 30% stock leg
(StakingB420). A run claims and splits WETH, B420 and every listed stock, pushes the in-kind legs,
sells B420's stock bucket and each stock's B420 bucket into WETH, then (once the two WETH buckets
reach `minWethForFund`) buys B420 and the stocks. Each trading leg moves one capped tranche and
then waits its own `legCooldown`; every v3 or Slipstream hop must sit within `maxDeviationBps` of
its 30-minute TWAP. Live `params()`: `minWethForFund` 0.001 WETH, `maxB420TrancheWeth` 0.03 WETH,
`maxB420SellTranche` 0.075 B420, `maxStockTrancheWeth` 0.03 WETH, `maxStockSellTranche` 100000000
(1 stock unit at 8 decimals), `legCooldown` 3600 s, `maxDeviationBps` 500, `legGas` 2000000.

```ts
const COLLECTOR_V1_ABI = parseAbi([
  "function swapAndFund()",                                                   // every minimum 0
  "function swapAndFund(uint256 minB420Out, uint256[] minStockOuts)",         // minStockOuts in allStocks() order
  "function params() view returns (uint256 minWethForFund, uint256 maxB420TrancheWeth, uint256 fundCooldown, uint256 maxDeviationBps)",
  "function keeperOnly() view returns (bool)",
  "function permissionlessFundingEnabled() view returns (bool)",
  "function lastFundAt() view returns (uint256)",
]);
const COLLECTOR_V2_ABI = parseAbi([
  "struct FundMins { uint256 b420Out; uint256[] stockOut; uint256 wethFromB420; uint256[] wethFromStock; }",
  "struct FundReport { uint256 b420Bought; uint256[] stockBought; uint256 wethFromB420; uint256[] wethFromStock; }",
  "function swapAndFund() returns (FundReport)",
  "function swapAndFund(FundMins mins) returns (FundReport)",
  "function params() view returns (uint256 minWethForFund, uint256 maxB420TrancheWeth, uint256 maxB420SellTranche, uint256 maxStockTrancheWeth, uint256 maxStockSellTranche, uint256 legCooldown, uint256 maxDeviationBps, uint256 legGas)",
  "function keeperOnly() view returns (bool)",
  "function permissionlessFundingEnabled() view returns (bool)",
  "function lastFundAt() view returns (uint256)",
]);
const REGISTRY_ABI = parseAbi(["function allStocks() view returns (address[])"]);  // the order every minimum array follows
```

- **Minimum arrays follow `registry.allStocks()` order** (NVDAc, AAPLc, GOOGLc, METAc, AMZNc, MSFTc,
  TSLAc, MSTRc, SPCXc, SNDKc today), not StakingB420's `rewardTokens()` order, with exactly
  `stockCount()` entries, else `LengthMismatch()`.
- **What the no-argument variant protects.** Every minimum is 0, so only the spot-deviation floor
  applies to each leg: received must be at least the spot-priced output times
  `(10000 - maxDeviationBps) / 10000`, priced at the pool's current price. It bounds the
  collector's own price impact, not a pool someone moved before the call; on v2 the TWAP floor and
  the 0.03 WETH tranche cap limit what a sandwich can take.
- **The minimums overload.** v2's `swapAndFund()` returns its `FundReport` in an `eth_call`: those are
  the run's expected outputs. Take a share of each (for example 99%) as `FundMins` and send the
  overload, ideally through a private mempool. With `keeper.mjs`, write the minimums (base units,
  decimal strings) to a JSON file and pass `--mins <file>`:
  v1 `{ "minB420Out": "0", "minStockOuts": ["0", ... 10 entries] }`;
  v2 `{ "b420Out": "0", "stockOut": [10 entries], "wethFromB420": "0", "wethFromStock": [10 entries] }`.
- **A successful run can skip legs.** A leg below its minimum, outside the deviation or TWAP floor,
  or refused by its pool is skipped (`LegSkipped` event) and keeps its amount for the next run.
  Read the `FundReport` (v2) or the `Funded` event.
- **When it reverts:** v1 `TooSoon()` inside `fundCooldown`, `BelowThreshold()` with less WETH than
  `minWethForFund`; v2 `TooSoon()` when every leg that has something to trade is still cooling down,
  `BelowThreshold()` when no leg could be attempted at all. Both: `NotKeeper()`, `FundingDisabled()`,
  `LengthMismatch()`; v2 also `InsufficientGas()` with a gas limit that cannot give each leg its
  `legGas`.
- **Gas:** `estimate x 1.2`; the v2 estimate already includes every leg's 2,000,000 budget.

```bash
node keeper/examples/keeper.mjs fund --collector v2 --from 0xAnyAddress       # simulate swapAndFund() and print the FundReport
node keeper/examples/keeper.mjs fund --collector v1 --mins mins-v1.json --from 0xAnyAddress
PRIVATE_KEY=0x... node keeper/examples/keeper.mjs fund --collector v2 --send
```

Simulated on Base mainnet, 2026-10-05: v1 `swapAndFund()` ok, gas 4,359,477; v1 `swapAndFund(0, [10 zeros])` ok, gas 4,215,942; with 3 entries it reverts `LengthMismatch()`.
Simulated on Base mainnet, 2026-10-05: v2 `swapAndFund()` ok, gas 2,673,421; FundReport: NVDAc's B420 bucket sold for 383,083,259,437 wei of WETH, no buy (the WETH buckets were below the 0.001 WETH minimum); `swapAndFund(FundMins of zeros)` ok, gas 2,688,935; with 3 entries per array it reverts `LengthMismatch()`.

## 2. Forward a fee token: forward(token)

`forward(token)` claims the collector's balance of `token` from the fee locker and routes it without
a swap. Which collector: the one a launch's protocol slice pays
(`tokenRewards(token).rewardRecipients` on its LP locker): v1 for launches before 2026-10-04, v2
since.

| Collector | B420 | Registry stock | WETH | Anything else (launch tokens, meme quotes, USDC) |
|---|---|---|---|---|
| v1 | All to StakingB69 | All to StakingB420 (registered first if new; if its reward list is full, to the Strategic Reserve in kind) | Reverts `WethNotForwardable()`: use `swapAndFund` | All to the Strategic Reserve in kind |
| v2 | 40% Reserve, 30% pushed to StakingB69, 30% kept for the stock leg | 40% Reserve, 30% pushed to StakingB420, 30% kept for the B420 leg | Claimed and split; the WETH legs wait for `swapAndFund` (`0x0` means native ETH) | All to the Strategic Reserve in kind |

```ts
const COLLECTOR_ABI = parseAbi([
  "function forward(address token)",
  "function pendingOf(address token) view returns (uint256)",   // fee locker balance plus held
  "function reservedOf(address asset) view returns (uint256)",  // v2 only: already earmarked to a leg
]);
```

- **Discovery:** `pendingOf(token)` on the collector (v2: minus `reservedOf(token)` is new income).
  `status` lists every currency with a balance.
- **Gas:** `estimate x 1.2`. A v2 push runs inside its `legGas` budget, so a stock forward uses about
  2.2M; a v1 forward 120,000 to 170,000.

Simulated on Base mainnet, 2026-10-05: v1 `forward(METAc)` ok, gas 170,314; v1 `forward(DAMN)` (a launch token residue, to the Strategic Reserve) ok, gas 121,616; v1 `forward(WETH)` reverts `WethNotForwardable()`.
Simulated on Base mainnet, 2026-10-05: v2 `forward(NVDAc)` ok, gas 2,203,664; v2 `forward(WETH)` ok, gas 44,863.

## 3. Release parked holder fees: flush

**Rewards hook.** A sell's holders' part (and a buy's when the swap was not clean) is parked in the
hook as `pendingHolders(poolId)` and credited at the pool's next clean swap.
`flush(poolKeyOf(token))` credits it now, except what the same transaction parked. Anyone, any time.

**Index hook.** `flush(index)` opens its own PoolManager unlock: it redeems the claims earlier sells
left, burns the sold shares (`claimedBurn()` on the index), and delivers the creator's and ops' fee
shares to the index ledger (`pendingCreatorFee`, `pendingOpsFee`). The v3 hook credits holders
during each trade, so it parks no holder ETH; a v4 hook also releases `pendingHolders(index)`.
Neither flush runs the index B420 buyback: `pendingBuyback()` is spent during index trades once it
reaches 0.002 ETH (at most 0.5 ETH per trade on v3).

```ts
const REWARDS_HOOK_ABI = parseAbi([
  "function flush((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key)",
  "function poolIdOf(address token) view returns (bytes32)",
  "function pendingHolders(bytes32 poolId) view returns (uint256)",
]);
const REWARDS_FACTORY_ABI = parseAbi([
  "function isRewardsToken(address) view returns (bool)",
  "function poolKeyOf(address token) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))",
]);
const INDEX_HOOK_ABI = parseAbi([
  "function flush(address index)",
  "function pendingCreatorFee(address index) view returns (uint256)",
  "function pendingOpsFee(address index) view returns (uint256)",
  "function pendingBuyback() view returns (uint256)",
]);
// the index hook of each stack is INDEX_STACKS[i].hook; isIndex(token) on its factory says which stack
```

- **Which hook:** `rewardsFactory.isRewardsToken(token)`, else `isIndex(token)` on each
  `INDEX_STACKS` factory. `keeper.mjs flush <token>` detects it.
- **Gas:** `estimate x 1.2` (about 35,000 to 41,000 when nothing moves).

Simulated on Base mainnet, 2026-10-05: rewards hook `flush` on RWT3U6F ok, gas 34,479, and on RWS8222 ok, gas 34,600, both with nothing parked (they moved nothing).
Simulated on Base mainnet, 2026-10-05: index hook `flush` on MEOW and COIN5 ok, gas 40,681 each, nothing pending; an unknown pool key reverts `UnknownPool()`, a non-index reverts `UnknownIndex()`.

## 4. Pull classic pool fees into the fee locker: collectRewards(token)

A classic launch's fees accrue to the LP locker's position. `collectRewards(token)` collects them,
sells the side a slice converts (FeeIn `1` Paired), and credits every slice recipient in the fee
locker: the creator, the protocol's collector, the holder distributor. The hook already triggers it
after swaps; call it before a creator claims ([`../claim/SKILL.md`](../claim/SKILL.md) section 5),
before `forward` or before `sync`.

```ts
const LOCKER_ABI = parseAbi([
  "function tokenRewards(address token) view returns ((address token, (address,address,uint24,int24,address) poolKey, uint256 positionId, uint256 numPositions, uint16[] rewardBps, address[] rewardAdmins, address[] rewardRecipients))",
  "function collectRewards(address token)",
]);
```

- **Which locker:** the launches row's `locker`, or the one whose `tokenRewards(token).token` equals
  the token: v2 `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` for factory v2 launches, v1
  `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` for factory v1 launches.
- **Young pools:** while the pool's MEV module is active (`MAX_MEV_MODULE_DELAY`, 120 s on the live
  hooks) the locker returns without collecting, and the call still succeeds.
- **Gas:** `estimate x 1.2` (150,000 to 480,000, more when a slice converts).

Simulated on Base mainnet, 2026-10-05: `collectRewards(ADA)` on locker v2 ok, gas 145,647; on a v2 launch whose slices convert ok, gas 474,803; `collectRewards(DAMN)` on locker v1 ok, gas 444,626; on a token that is not a launch it reverts with empty data.

## 5. Holder distributor: sync and claimMany

`sync()` pulls the distributor's balances of the launch token and its quote out of the fee locker
(skipping a currency whose transfer fails) and never reverts; the B420 worker then posts the next
cumulative root. `claimMany(claims)` pays a list of leaves, each to its own account, and skips
entries that cannot settle (returns `paid`, `skipped`).

```ts
const DISTRIBUTOR_ABI = parseAbi([
  "struct BatchClaim { address currency; address account; uint256 cumulativeAmount; bytes32[] proof; }",
  "function token() view returns (address)",
  "function pairedToken() view returns (address)",
  "function sync()",
  "function claimed(address currency, address account) view returns (uint256)",
  "function claimMany(BatchClaim[] claims) returns (uint256 paid, uint256 skipped)",
]);
const DISTRIBUTOR_FACTORY_ABI = parseAbi([
  "function distributorFor(address token) view returns (address)",
  "function allDistributors() view returns (address[])",
]);
const FEE_LOCKER_ABI = parseAbi(["function availableFees(address feeOwner, address token) view returns (uint256)"]);
```

- **Find it:** `distributorFor(token)` on the current factory
  `0x049B3Ee15c41163458073072e9573BF0fb88D5d4`, then on the previous one
  `0x6c8DB32e7b49743c56505718f6f5CBADd18705B6`. Never call `create()`.
- **Sync when:** `availableFees(distributor, token) + availableFees(distributor, pairedToken) > 0`.
  Run `collectRewards(token)` first if the pool holds uncollected fees.
- **Pay everyone:** pages from `GET /api/distributor/[token]/claim/all?offset=N` (`entries`, `more`,
  `nextOffset`, at most 300 per page); keep the entries with `cumulativeAmount > claimed(currency, account)`;
  send `claimMany` per page or smaller. The per-holder call is in
  [`../claim/SKILL.md`](../claim/SKILL.md) section 6.
- **Gas:** `estimate x 1.25` capped at 16,000,000 (about 38,000 per leaf measured).

Simulated on Base mainnet, 2026-10-05: `sync()` on the TEST and CUCK distributors ok, gas 92,838 and 84,428, with nothing in the fee locker (moved nothing; `keeper.mjs` now builds nothing in that case).
Simulated on Base mainnet, 2026-10-05: `claimMany` of the 23 open CUCK leaves (previous factory) ok, returned (paid 23, skipped 0), gas 881,751; of the 3 open TEST leaves ok, gas 271,881.

## 6. Pay every holder of a rewards or index token: claimDividendFor

`token.claimDividendFor(accounts)` pays each listed account its own dividend (rewards token: the
paired asset; index: ETH). It skips accounts with nothing owed and accounts that refuse the
payment (`DividendPushFailed`, the dividend stays), and returns `(paid, skipped)`. Each payee gets a
fixed budget, `PUSH_GAS` 50,000 for ETH and `TOKEN_PUSH_GAS` 100,000 for an ERC-20; with less gas
left for the next payee the call reverts `InsufficientGas()`.

```ts
const DIVIDEND_ABI = parseAbi([
  "function dividendOf(address account) view returns (uint256)",
  "function rewardAsset() view returns (address)",   // rewards tokens: 0x0 = ETH pair (batch 150), else ERC-20 pair (batch 80)
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
]);
```

| Payee list | Fields |
|---|---|
| `GET /api/rewards-launch/[token]/holders?wallets=1` | `wallets` (holders, then former holders), `count`, `formerCount`, `owed: [{ wallet, raw }]`, `owedTotalRaw`, `decimals`, `undistributedRaw`, `pendingRaw` (parked in the hook), `eligibleSupplyRaw`, `complete`, `syncing`, `updatedAt` |
| `GET /api/index/[index]/holders?wallets=1` | `wallets`, `count`, `formerCount`, `owed: [{ wallet, wei }]`, `owedTotalWei`, `undistributedWei`, `eligibleSupplyRaw`, `complete`, `syncing`, `updatedAt`; `parkedWei` only for v4-stack indexes (none live yet) |

Both answers carry `stale: true` only when a build could not complete and the last complete
answer is served instead (no-store); `owed` is absent when the dividend read failed. Fields read
on 2026-10-05 from RWT3U6F and MEOW.

- **Build:** take `owed`, re-read `dividendOf` onchain right before sending and drop zeros, then cut
  batches of 150 (ETH) or 80 (ERC-20 asset). `--batch n` lowers the size.
- **Gas:** `estimate x 1.25`, capped at 16,000,000; a batch whose estimate is above 12,000,000 is
  split in two and checked again (`keeper.mjs` does this).
- A holder whose payment was skipped claims its own with `claimDividend()`
  ([`../claim/SKILL.md`](../claim/SKILL.md) sections 1 and 3).

```bash
node keeper/examples/keeper.mjs pay-holders 0xRewardsTokenOrIndex --from 0xAnyAddress
node keeper/examples/keeper.mjs pay-holders 0xClassicToken --from 0xAnyAddress        # distributor claimMany pages
node keeper/examples/keeper.mjs pay-holders 0xIndex --batch 50 --print                # raw tx JSON per batch
```

Simulated on Base mainnet, 2026-10-05: MEOW, 4 holders owed: `claimDividendFor` ok, returned (paid 1,083,598,071,672,849 wei, skipped 0), gas 230,524; with `--batch 2` two transactions (gas limits 200,033 and 118,817); COIN5, 1 holder: ok, gas 138,580.
Simulated on Base mainnet, 2026-10-05: RWT3U6F and RWS8222 had no holder owed (`owed` empty, no transaction built); `claimDividendFor([holder])` with nothing owed ok, returned (paid 0, skipped 1), gas 38,043.

## 7. Ledger claims on behalf of fixed recipients

The call recipe is in [`../claim/SKILL.md`](../claim/SKILL.md) (rewards ledger: section 2; index
ledger: section 4). This section adds who, when, gas and batching for the protocol's recipients.

| Ledger, slot | Fixed recipient | What it holds |
|---|---|---|
| Rewards ledger slot 1 | Strategic Reserve `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` (`treasury()`) | 20% of every rewards-token fee, in the paired asset |
| Rewards ledger slot 2 | FeeCollector v2 (`collector()`) | The stock leg (15%) and, on pairs other than ETH and B420, the B420 leg (15%), paid through `creditFromLedger` so both stay earmarked |
| Rewards ledger slot 3 | StakingB69 (`stakingB69()`) | The B420 leg of B420-paired tokens, in kind (`notifyRewardAmount`, falling back to the collector's B420 bucket) |
| Index ledger, ops | `ops()` (`0xAB676e28Da431c166207F33C72ABC954229225e5` on v3) | 20% of every index fee, ETH and index shares |
| Index ledger, creator | `creatorOf(index)` | The creator's part; normally claimed by the creator ([`../claim/SKILL.md`](../claim/SKILL.md) section 4) |

```ts
const REWARDS_LEDGER_ABI = parseAbi([
  "function claimable(address token, uint8 slot) view returns (uint256)",
  "function claimFor(address token, uint8 slot) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] tokens) returns (uint256 eth)",
]);
const INDEX_LEDGER_ABI = parseAbi([
  "function ops() view returns (address)",
  "function claimable(address index, address recipient, address currency) view returns (uint256)",
  "function claimFor(address index, address recipient, address currency) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] indexes) returns (uint256 eth)",
]);
```

- **When:** whenever `claimable` is non-zero; nothing depends on it. `claimFor` reverts
  `NothingToClaim()` on an empty slot.
- **Batching:** `claimAllFor(recipient, tokens)` with the treasury, the collector or StakingB69 as
  recipient pays that slot for every listed token in one transaction (and any creator balance that
  address holds); filter out zero tokens first, since an empty `claimAllFor` succeeds and burns gas.
- **Gas:** `estimate x 1.2`, and **at least 700,000 for slot 3** (and for a `claimAllFor` to StakingB69):
  the staking payout needs `STAKING_NOTIFY_GAS` (300,000) plus its reserve, about 555,000 left at
  that point, or it reverts `InsufficientGas()` (library rule `ledgerStakingSlot`).

```bash
node keeper/examples/keeper.mjs ledger 0xRewardsToken --slot 1 --from 0xAnyAddress      # 0 creator, 1 treasury, 2 collector, 3 staking
node keeper/examples/keeper.mjs ledger 0xIndex --slot 1 --from 0xAnyAddress             # index: 0 creator, 1 ops
node keeper/examples/keeper.mjs ledger 0xRecipient --all 0xT1,0xT2 --from 0xAnyAddress  # claimAllFor, rewards tokens and indexes
```

Simulated on Base mainnet, 2026-10-05: RWS8222 slot 1 (100 raw NVDAc to the Strategic Reserve) ok, gas 104,068; slot 2 (148 raw to FeeCollector v2) ok, gas 166,151; slot 3 reverts `NothingToClaim()` (no B420-paired rewards token exists); RWT3U6F slots 1, 2 and 3 revert `NothingToClaim()`.
Simulated on Base mainnet, 2026-10-05: `claimAllFor(Strategic Reserve, [RWS8222])` ok, gas 107,301 (RWT3U6F filtered out at 0); `claimAllFor(FeeCollector v2, [RWS8222])` ok, gas 169,177.
Simulated on Base mainnet, 2026-10-05: index ledger `claimFor(MEOW, ops, ETH)` ok, gas 39,693; `claimFor(MEOW, ops, shares)` ok, gas 93,736; `claimAllFor(ops, [MEOW, COIN5])` ok, gas 193,518; `claimFor(COIN5, creator, ETH)` ok, gas 39,693.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|---|---|
| FeeCollector v1 (launches before 2026-10-04) | `0xB9366B662b610F730a50408Db17E550d64F06F44` |
| FeeCollector v2 (current collector, rewards ledger slot 2) | `0x22F005aa2b90E06C642C7462388b9d212D6344d8` |
| B420StockRegistry (`allStocks()` order for minimums) | `0x5E4643c2F48c14e09f209CAe5A51455211e10c1E` |
| ClankerFeeLocker (balances the collectors and distributors claim) | `0x20835181fD6F4e62AA8d630A89b0e5c8676808C6` |
| B420RewardsFactory (`isRewardsToken`, `poolKeyOf`) | `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31` |
| B420RewardsHook (`flush(PoolKey)`) | `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC` |
| B420RewardsLedger (slots 1 to 3) | `0x8e95B431B70094B66836074B01c380A4935B7d49` |
| Index v3 factory (`isIndex`) | `0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF` |
| Index v4 factory (`isIndex`) | `0xD408a52ff4871097A89977Ca9fc48dF0D4243293` |
| Index v3 hook (`flush(index)`) | `0x5C654E637B6bC597A655DaB90867296d5Ae76888` |
| Index v3 ledger (`splitter()`, ops and creator) | `0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6` |
| Index v4 hook (`flush(index)`, `pendingHolders(index)`) | `0x3A9721075D9f183648029058549A65C684D16888` |
| Index v4 ledger (`splitter()`, ops and creator) | `0x1B66965006fbaa476fc22B8432cc232b6148E958` |
| LP locker v2 (`collectRewards`, factory v2 launches) | `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` |
| LP locker v1 (`collectRewards`, factory v1 launches) | `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` |
| Distributor factory (current) | `0x049B3Ee15c41163458073072e9573BF0fb88D5d4` |
| Distributor factory (previous generation, its distributors still pay) | `0x6c8DB32e7b49743c56505718f6f5CBADd18705B6` |
| StakingB420 (receives stocks) | `0xC411bA66d1819054f67cDE26424cd876DB703E79` |
| StakingB69 (receives B420) | `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309` |
| Strategic Reserve (EOA, treasury share) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |

The v4 index stack (live since 2026-10-05) is in `INDEX_STACKS`: the same calls apply to its hook
and ledger.

## Errors you might hit

### FeeCollector v1 and v2

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `TooSoon()` | `0x6fed7d85` | v1: inside `fundCooldown`; v2: every leg with something to trade is cooling down (`legCooldown`) | Wait for `readyAt`; do not resend |
| `BelowThreshold()` | `0xae274200` | v1: WETH below `minWethForFund`; v2: no leg could be attempted | Nothing to fund now; check `status` later |
| `NotKeeper()` | `0xf512b278` | `keeperOnly()` is true and the sender is not allowlisted | Do not call; only allowlisted keepers may fund |
| `FundingDisabled()` | `0x978a151c` | `permissionlessFundingEnabled()` is false | Send the minimums overload (`--mins`) |
| `LengthMismatch()` | `0xff633a38` | A minimum array does not have `stockCount()` entries | One entry per `allStocks()` stock, in that order |
| `InsufficientGas()` | `0x1c26714c` | v2: the gas limit cannot give the next leg its `legGas` | Use the estimate x 1.2; never trim it |
| `WethNotForwardable()` | `0x9d4c4700` | v1 `forward(WETH)` | Fund WETH with `swapAndFund` |
| `NotConfigured()` | `0xd311bc39` | v1 wiring missing; v2 `convertDelisted` on a stock that is listed or unknown | Not a keeper case on the live collectors; stop |

### Hooks

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `UnknownPool()` | `0xf7139e33` | Rewards hook `flush` with a key that is not a rewards pool | Use `rewardsFactory.poolKeyOf(token)` unchanged |
| `OpenDeltas()` | `0xe8527d1d` | Rewards hook `flush` called inside a PoolManager unlock with open deltas | Call it as its own transaction |
| `UnknownIndex()` | `0xfd502cce` | Index hook `flush` on a token the hook does not serve | Use the hook of the stack whose factory says `isIndex(token)` |
| `Reentrant()` | `0xed3ba6a6` | A flush re-entered the hook | Call it as its own transaction |

### Ledgers

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `NothingToClaim()` | `0x969bf728` | `claimFor` on an empty slot or currency | Read `claimable` first; skip it |
| `BadSlot()` | `0x10370eb3` | Rewards ledger slot above 3 | 0 creator, 1 treasury, 2 collector, 3 staking |
| `InsufficientGas()` | `0x1c26714c` | Slot 3 (or `claimAllFor` to StakingB69) with less than about 555,000 gas left | Gas limit at least 700,000 |
| `CollectorPull(uint256,uint256)` | `0xb44acf18` | Slot 2: the collector pulled a different amount than owed | Nothing was paid; stop and report |
| `EthTransferFailed()` | `0x6d963f88` | An ETH recipient refused the payment | Stop; the balance stays for a later claim |

### Dividend batches, lockers, distributors

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `InsufficientGas()` | `0x1c26714c` | `claimDividendFor`: too little gas left to give the next payee its push budget | Estimate x 1.25 (cap 16M), or a smaller batch |
| empty revert | none | `collectRewards` on a token the locker does not hold | Use the locker whose `tokenRewards(token).token` is the token |
| `ReentrancyGuardReentrantCall()` | `0x3ee5aeb5` | A payee or token called back into the contract | Drop that entry and rebuild the batch |

`claimMany` and `sync` do not revert on a bad entry or a failing currency: read `(paid, skipped)` and
the events.

## What this is NOT

- Not an admin console: no owner or admin function, no parameter change, no keeper allowlist edit,
  no rescue ([root router](../SKILL.md#never-do-canonical-gates)).
- Not distributor creation: a factory's `create()` is never called; enabling a distributor is a
  logged-in site action.
- Not curve maintenance: curve launches are closed.
- Not index creation: closed to the public.
- Not one wallet's own claims: staking `getReward`, a holder's `claimDividend`, a creator's fees and
  merkle claims for one wallet are in [`../claim/SKILL.md`](../claim/SKILL.md) and
  [`../staking/SKILL.md`](../staking/SKILL.md).

## Related skills

- [`../SKILL.md`](../SKILL.md): root router, signer modes, money rules, address book, never-do list
- [`../claim/SKILL.md`](../claim/SKILL.md): the claim calls the ledger section reuses, and every claim for one wallet
- [`../staking/SKILL.md`](../staking/SKILL.md): the two staking pools this skill funds
- [`../market-data/SKILL.md`](../market-data/SKILL.md): `/api/buybacks`, `/api/rewards` and the other public reads
- [`../launch/classic/SKILL.md`](../launch/classic/SKILL.md): classic launches, their slices and fee preferences
- [`../launch/rewards/SKILL.md`](../launch/rewards/SKILL.md): rewards launches and their ledger

## License

CC0.
