---
name: b420-trade
version: 1.0.0
description: "Buy or sell any token on B420 (Base) as an AI agent: B420, B69, tokenized stocks (Coinbase wrapped 8-decimal and ST0x), other B20s, classic B420 launches, holder-rewards tokens and index tokens. Router skill; detect the market onchain (index, rewards token, classic launch, everything else) and follow the leaf. Canonical home of the path picker, the approvals table, slippage and deadline defaults and the 2-block launch delay. Every path quotes first and simulates before sending. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
rewards_factory: 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
index_factory_v3: 0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF
index_factory_v4: 0xD408a52ff4871097A89977Ca9fc48dF0D4243293
lp_locker_v2: 0x351C934d698eB3c0683066D2fbD6CE7215573Bc4
lp_locker_v1: 0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3
v4_quoter: 0x0d5e0F971ED27FBfF6c2837bf31316121532048D
---

# B420 Trade: Router

Every token on B420 trades on **Base (chainId 8453)** through exactly one of four paths, and
**the path is a fact of the chain, read in one multicall, never a choice**: an index token
trades only through B420IndexRouter, a holder-rewards token only through B420RewardsRouter, a
classic launch only through its own Uniswap v4 pool (the Universal Router on a WETH pair,
B420HopRouter on any other quote), and everything else (B420, B69, tokenized stocks, other B20s)
through `POST https://b420.io/api/swap`. Each leaf quotes, builds the exact calldata and
simulates it from your wallet before anything is sent.

This file routes you to the right leaf and holds what the four leaves share: the path picker,
the approvals table, the slippage and deadline defaults and the 2-block launch delay. **The
leaves link back here for those instead of restating them.**

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../SKILL.md).

> **Curve trading is closed.** The curve factory's `launchEnabled()` reads false and no token is
> on a curve; there is no curve path in this repo.

> **Rewards and index tokens never go through the Universal Router or an aggregator.** Those
> routes carry no fee entries and, on ETH pairs, no gas margin for the hook's buyback; the
> [never-do list](../SKILL.md#never-do-canonical-gates) closes them. Their routers are the only
> path.

## Agent rules (every trade)

1. **Detect the path onchain, every time.** Run the checks below; never infer the kind from the
   address. Every B420 launch, rewards token and index ends in `b420`, so a suffix proves nothing.
2. **A failed detection read stops the trade.** It never falls through to the next path. The
   aggregator is not a safe default: it answers `route not found` for index tokens and classic
   launches, but Kyber does return a route for a rewards token (checked on RWT3U6F,
   2026-10-05), and that route has neither the router's fee entries nor the gas margin the
   hook's in-swap buyback needs (`InsufficientGas()`).
3. **Never trade with a zero minimum.** `minOut = quote * (10000 - slippageBps) / 10000`; a quote
   of 0, a reverted quote or a missing quote means no trade (the Quoter's `NotEnoughLiquidity`,
   or a 502 `route not found` from the API).
4. **Exact input only.** Every router here takes an input amount and a minimum output; the index
   hook reverts exact output (`ExactOutputNotSupported()`).
5. **Proceeds go to the sender.** `recipient` is the trading wallet in every example; never a
   third party you were not asked to pay.

## Pick the path (the single copy)

1. For each index stack, oldest first (v3 today; v4 is appended to `INDEX_STACKS` when it is
   deployed): `isIndex(token)` on the stack's factory. True: **index**.
2. `isRewardsToken(token)` on B420RewardsFactory `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31`.
   True: **rewards token**.
3. `tokenRewards(token)` on LP locker v2 `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4`, then LP
   locker v1 `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3`. `.token != 0x0`: **classic launch**,
   and `.poolKey` is its exact pool key. The quote is the key's other currency: WETH means the
   Universal Router, anything else B420HopRouter.
4. Anything else: **aggregator** (`POST /api/swap`). Aggregators answer `route not found` for
   classic hooked pools: a classic launch always takes step 3.

| Check | Result | Path | Leaf |
|---|---|---|---|
| `indexFactory.isIndex(t)` on any stack | true | B420IndexRouter of that stack | [`index/SKILL.md`](index/SKILL.md) |
| `rewardsFactory.isRewardsToken(t)` | true | B420RewardsRouter `0x383156D66BdA2369c6eE061C66aa3D32E38cec72` | [`rewards-token/SKILL.md`](rewards-token/SKILL.md) |
| `lockerV2.tokenRewards(t).token`, else `lockerV1` | not `0x0`, quote is WETH | Universal Router `0x6fF5693b99212Da76ad316178A184AB56D299b43` | [`classic/SKILL.md`](classic/SKILL.md) 3a and 3b |
| same | not `0x0`, any other quote | B420HopRouter `0x82C2B0c34f843A5724497ce809ae96a6eeb03721` | [`classic/SKILL.md`](classic/SKILL.md) 4 |
| none of the above | | `POST /api/swap` (0x AllowanceHolder, or Kyber when 0x refuses) | [`aggregator/SKILL.md`](aggregator/SKILL.md) |

All of it in one multicall (viem):

```ts
import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL || "https://mainnet.base.org"), batch: { multicall: true } });

const PICK_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct TokenRewardInfo { address token; PoolKey poolKey; uint256 positionId; uint256 numPositions; uint16[] rewardBps; address[] rewardAdmins; address[] rewardRecipients; }",
  "function isIndex(address token) view returns (bool)",
  "function isRewardsToken(address token) view returns (bool)",
  "function tokenRewards(address token) view returns (TokenRewardInfo)",
]);
const INDEX_FACTORIES = ["0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF", "0xD408a52ff4871097A89977Ca9fc48dF0D4243293"]; // v3, v4
const REWARDS_FACTORY = "0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31";
const LOCKERS = ["0x351C934d698eB3c0683066D2fbD6CE7215573Bc4", "0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3"]; // v2, then v1
const WETH = "0x4200000000000000000000000000000000000006";
const ZERO = "0x0000000000000000000000000000000000000000";

export async function pickPath(token) {
  const r = await client.multicall({
    allowFailure: false, // a failed read throws: never fall through to a cheaper guess
    contracts: [
      ...INDEX_FACTORIES.map((address) => ({ address, abi: PICK_ABI, functionName: "isIndex", args: [token] })),
      { address: REWARDS_FACTORY, abi: PICK_ABI, functionName: "isRewardsToken", args: [token] },
      ...LOCKERS.map((address) => ({ address, abi: PICK_ABI, functionName: "tokenRewards", args: [token] })),
    ],
  });
  const n = INDEX_FACTORIES.length;
  const i = r.slice(0, n).findIndex(Boolean);
  if (i >= 0) return { path: "index", factory: INDEX_FACTORIES[i] };
  if (r[n]) return { path: "rewards" };
  for (const info of r.slice(n + 1)) {
    if (info.token === ZERO) continue;
    const key = info.poolKey;
    const quote = getAddress(key.currency0) === getAddress(token) ? key.currency1 : key.currency0;
    return { path: getAddress(quote) === WETH ? "classic-weth" : "classic-hop", key, quote };
  }
  return { path: "aggregator" };
}
```

Checked on Base mainnet, 2026-10-05: MEOW and COIN5 answer `isIndex` true; RWT3U6F and RWS8222
answer `isRewardsToken` true; ADA `0xb200000000000000000000686F75BdEb7183b420` has
`lockerV2.tokenRewards(ADA).poolKey` = (WETH, ADA, fee `8388608` = `0x800000` the dynamic-fee
flag, tickSpacing 200, hook `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc`); B420 is in no locker
(aggregator).

## I want | Read

| I want | Read |
|---|---|
| Buy or sell B420, B69, a tokenized stock or any other B20 with a market | [`aggregator/SKILL.md`](aggregator/SKILL.md) |
| Pay with a token instead of ETH, or receive one (USDC, B420) | [`aggregator/SKILL.md`](aggregator/SKILL.md) (`--pay`, `--receive`) |
| Buy or sell a token launched on the B420 Factory, WETH pair | [`classic/SKILL.md`](classic/SKILL.md) 3a and 3b |
| Buy or sell a launch paired with B420, a stock or any other token | [`classic/SKILL.md`](classic/SKILL.md) 4 |
| Buy or sell a holder-rewards token | [`rewards-token/SKILL.md`](rewards-token/SKILL.md) |
| Buy or sell an index token (MEOW, COIN5) | [`index/SKILL.md`](index/SKILL.md) |
| Claim the dividends a rewards or index token pays its holders | [`../claim/SKILL.md`](../claim/SKILL.md) |
| Prices, holders, a wallet's positions | [`../market-data/SKILL.md`](../market-data/SKILL.md) |
| Launch a token | [`../launch/SKILL.md`](../launch/SKILL.md) |

## Approvals (the single copy)

Approve **exactly** the amount the next step spends ([money rule 4](../SKILL.md#money-rules-canonical));
b420.io approves `maxUint256`, agents do not. The shared `approvalStep` returns nothing when the
allowance already covers the amount.

| Path | Buy | Sell | Spender | Notes |
|---|---|---|---|---|
| Aggregator | None with ETH. With `--pay`: approve `amountIn` of the pay token | Approve `amountIn` of the token | The `routerAddress` of **that** response: 0x AllowanceHolder `0x0000000000001fF3684f28c67538d4D072C22734` or Kyber `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | The source varies per request; approve the address the response names, after you have it |
| Classic, WETH pair | None (the ETH is `value`) | 1. `token.approve(Permit2, amountIn)`. 2. `Permit2.approve(token, UniversalRouter, uint160(amountIn), uint48(now + 1800))` | Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`, then the Universal Router through Permit2 | Skip step 2 while `Permit2.allowance(owner, token, router)` returns an amount of at least `amountIn` and an expiration in the future. b420.io signs a `PERMIT2_PERMIT` (command `0x0a`) inside the swap instead of step 2 |
| Classic, other quote | None | `token.approve(hopRouter, tokenIn)` | B420HopRouter `0x82C2B0c34f843A5724497ce809ae96a6eeb03721` | The hop router approves the aggregator leg itself, for exactly `sellAmount`, and resets it to 0 |
| Rewards token, ETH pair | None (`value == amountIn`) | `token.approve(rewardsRouter, amountIn)` | B420RewardsRouter `0x383156D66BdA2369c6eE061C66aa3D32E38cec72` | |
| Rewards token, ERC-20 pair | `paired.approve(rewardsRouter, amountIn)`: the whole `amountIn`, because the router also pulls the fee entries from you | `token.approve(rewardsRouter, amountIn)` | B420RewardsRouter | A tokenized stock (8 decimals) is the usual paired asset |
| Index | None (the ETH is `value`) | `index.approve(indexRouter, shares)` | The B420IndexRouter of the index's stack (v3: `0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4`) | No Permit2 |

Gas of an approval: a B20 (B420, B69, tokenized stocks, classic launches; the address is `0xb2`
followed by twenty zeros) takes the `stockApprove` rule, estimate x 1.5 or 150,000 when the
estimate fails, as b420.io sets it; any other token takes estimate x 1.2. Measured on Base
mainnet, 2026-10-05: 45,570 to 46,383 gas for an approve, 47,518 for `Permit2.approve`.

## Slippage, deadlines and quotes

| Path | Quote source | Default slippage | Deadline |
|---|---|---|---|
| Aggregator | `amountOut` of `POST /api/swap`, already net of the fee | 100 bps (`slippageBps`, server range 5 to 2000) | Inside the aggregator's calldata; request the route right before sending |
| Classic, WETH pair | V4 Quoter `quoteExactInputSingle` on the locker's pool key | b420.io "auto" from pool liquidity (`liqUsd` of `GET /api/tokens?q=<token>`): 100 bps from $100,000, 300 from $20,000, 600 below, 300 when unknown | 20 minutes (`execute` deadline) |
| Classic, other quote | The aggregator leg's `amountOut`, then the Quoter on the pool | The same auto value, applied to both legs | 180 seconds (`deadline` of the hop router) |
| Rewards token | V4 Quoter on the rewards pool key, with the router's fee applied where the router applies it | 300 bps | 20 minutes |
| Index | V4 Quoter on the index pool key, the only valid price (the pool holds no liquidity; never read `slot0`) | 200 bps | 20 minutes |

`minOut = quote * (10000 - slippageBps) / 10000` on every path. A higher slippage than the
default is a decision for whoever you act for, never a retry reflex after a revert. The example
accepts `--slippage` from 5 to 2000 bps on every path and builds nothing when a minimum (or the
amount left after the fee entries) rounds to 0.

## The 2-block launch delay

Classic and rewards pools revert `PoolLocked()` for **2 blocks after the launch block**; the dev
buy inside the launch transaction is the only exception. Index pools have no delay. Two Base
blocks are about 4 seconds, so this only bites a trade sent right after a launch.

| Pool | Read | Trades from |
|---|---|---|
| Classic launch | `poolUnlockTime(poolId)` on the MEV module `0x0028D5788aa5526Ab38920576c93A46048b09CD1` (`blockDelay()` = 2), with `poolId = keccak256(abi.encode(poolKey))` | `block.number >= poolUnlockTime` |
| Rewards token | `GET /api/rewards-launch/<token>`: `launch.tradingFromBlock`. Onchain: `poolIdOf(token)` then `poolOf(id).launchBlock` on the rewards hook `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC`, plus `LAUNCH_BLOCK_DELAY()` (2) | `block.number >= tradingFromBlock` |

```ts
const MEV_ABI = parseAbi(["function poolUnlockTime(bytes32 poolId) view returns (uint256)"]);
const REWARDS_HOOK_ABI = parseAbi([
  "struct LaunchPool { address token; uint64 launchBlock; bool tokenIs0; uint8 kind; address paired; }",
  "function poolIdOf(address token) view returns (bytes32)",
  "function poolOf(bytes32 id) view returns (LaunchPool)",
  "function LAUNCH_BLOCK_DELAY() view returns (uint256)",
]);
```

Checked on Base mainnet, 2026-10-05: ADA trades from block 52,047,044 (MEV module); RWT3U6F
launched at block 52,160,712 and trades from 52,160,714 (the API and the hook agree). A trade in
the window reverts `PoolLocked()` (`0x2e136745`): wait for the block, quote again, send again.

## The example

[`examples/trade.mjs`](examples/trade.mjs) runs the path picker, the leaf's quote and build, and
the shared simulate / send / print ending ([shared library](../SKILL.md#shared-example-library)).

```bash
npm ci                                                                   # once, at the repo root
node trade/examples/trade.mjs <token>                                    # read only: path, pool key, paired asset, 0.001 ETH reference quote
node trade/examples/trade.mjs <token> buy 0.001 --from 0xYourWallet      # simulate every step, no key needed
PRIVATE_KEY=0x... node trade/examples/trade.mjs <token> sell all         # simulate from the signer
PRIVATE_KEY=0x... node trade/examples/trade.mjs <token> sell all --send  # re-simulate, then broadcast step by step
BANKR_API_KEY=... BANKR_WALLET=0x... node trade/examples/trade.mjs <token> buy 0.001 --send
node trade/examples/trade.mjs <token> buy 0.001 --from 0xYourWallet --print   # raw tx JSON per step for CDP, Safe, relayers
```

| Argument | Meaning |
|---|---|
| `buy <amount>` | ETH to spend. Aggregator path with `--pay <token>`: an amount of that token. ERC-20-paired rewards token: an amount of the paired asset (the router takes only that asset) |
| `sell <amount\|all>` | Token amount, or the whole balance. Proceeds in ETH; with `--receive <token>` on the aggregator path, in that token; on an ERC-20-paired rewards token, in the paired asset |
| `--slippage <bps>` | Overrides the default of the path (table above); 5 to 2000 |
| `--json` | One plan line (path, quote, minimum, fee entries), then the simulation result line |

| Path | Steps the script builds and simulates | Results |
|---|---|---|
| Aggregator | [approve the response's router], the router call | [`aggregator/SKILL.md`](aggregator/SKILL.md) |
| Classic, WETH pair | buy: `execute`; sell: approve Permit2, `Permit2.approve`, `execute` | [`classic/SKILL.md`](classic/SKILL.md) |
| Classic, other quote | buy: `buyWithETH`; sell: approve the hop router, `sellForETH` | [`classic/SKILL.md`](classic/SKILL.md) |
| Rewards token | [approve the router], `buy` or `sell` | [`rewards-token/SKILL.md`](rewards-token/SKILL.md) |
| Index | buy: `buy`; sell: [approve the router], `sell` | [`index/SKILL.md`](index/SKILL.md) |

A trade in a locked pool stops before any call with `PoolLocked: this pool trades from block N`;
a first buy too small for an empty index stops with `FirstBuyTooSmall`. With `--print`, steps
after an approval are simulated in one `eth_simulateV1` bundle and their gas limit is derived
from the gas used there; send the approval, then run again for a standalone estimate of the
trade (`--send` does this on its own).

## Errors common to every path

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `PoolLocked()` | `0x2e136745` | Within 2 blocks of the launch block (classic: the MEV module, re-thrown in `WrappedError`; rewards: the hook) | Wait until the block in the table above, quote again, send again |
| `WrappedError(address,bytes4,bytes,bytes)` | `0x90bfb865` | The PoolManager re-throws a hook revert; the hook's own error is in `reason` (`decodeRevert` unwraps it) | Act on the inner error |
| `UnexpectedRevertBytes(bytes)` | `0x6190b2b0` | A quote reverted inside the swap; the bytes carry the cause (`PoolLocked`, `FirstBuyTooSmall`, a constituent route) | Act on the inner error; never trade without a quote |
| `NotEnoughLiquidity(bytes32)` | `0x7a5ed734` | The Quoter could not fill the whole input: the pool has too little of the other side (a classic pool nobody has bought into cannot take a sale) | Trade a smaller amount, or do not trade |
| `InsufficientBalance(address,uint256,uint256)` | `0xdb42144d` | A B20 token (B420, B69, stocks, classic launches) has less than the amount | Sell at most the balance (`sell all`) |
| `InsufficientAllowance(address,uint256,uint256)` | `0x192b9e4e` | A B20 token's allowance to the spender is short | Add the approval from the table above |
| `ERC20InsufficientAllowance(address,uint256,uint256)` | `0xfb8f41b2` | Same for an OpenZeppelin ERC-20 (rewards tokens, index tokens) | Add the approval |
| `ERC20InsufficientBalance(address,uint256,uint256)` | `0xe450d38c` | Same as the B20 balance error, for an OpenZeppelin ERC-20 | Sell at most the balance |
| RPC code `-32016` "over rate limit" | | The public Base RPC throttles bursts | Set `RPC_URL` to your own Base node; nothing was sent |

Path-specific errors are in each leaf.

## What this is NOT

- Not curve trading: closed, no token is on a curve.
- Not limit orders, stop orders or perpetuals: every trade here is an immediate exact-input swap.
- Not `mintInKind` / `redeemInKind` on index tokens (deposit or withdraw the basket itself, 1%
  fee): they exist onchain and are not covered.
- Not cross-chain: B420 is Base-only.
- Not a way around the fee entries or the gas rules: every path carries the same fee as b420.io
  ([fees](../SKILL.md#fees-canonical)).

## Related skills

- [`../SKILL.md`](../SKILL.md): root router; signer modes, money rules, fees, gates, address book
- [`aggregator/SKILL.md`](aggregator/SKILL.md): POST /api/swap for B420, B69, tokenized stocks and other B20s
- [`classic/SKILL.md`](classic/SKILL.md): classic launches through the Universal Router or B420HopRouter
- [`rewards-token/SKILL.md`](rewards-token/SKILL.md): holder-rewards tokens through B420RewardsRouter
- [`index/SKILL.md`](index/SKILL.md): index tokens through B420IndexRouter
- [`../market-data/SKILL.md`](../market-data/SKILL.md): prices, pools, holders and portfolios before a trade
- [`../claim/SKILL.md`](../claim/SKILL.md): dividends that rewards and index tokens pay their holders

## License

CC0.
