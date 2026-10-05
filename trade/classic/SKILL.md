---
name: b420-trade-classic
version: 1.0.0
description: "Buy or sell a token launched on the B420 Factory (classic B20 launch on a Uniswap v4 pool behind the B420 hook) as an AI agent: WETH-paired pools through the Universal Router (WRAP_ETH, V4_SWAP, PAY_PORTION, SWEEP; Permit2 on sells), pools paired with any other quote through B420HopRouter (an aggregator leg plus the v4 pool, atomically). Pool key read from the LP locker, quotes from the v4 Quoter, 2-block launch delay. Aggregators return no route for these pools, so this leaf is the only path. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
universal_router: 0x6fF5693b99212Da76ad316178A184AB56D299b43
permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3
v4_quoter: 0x0d5e0F971ED27FBfF6c2837bf31316121532048D
hop_router: 0x82C2B0c34f843A5724497ce809ae96a6eeb03721
lp_locker_v2: 0x351C934d698eB3c0683066D2fbD6CE7215573Bc4
lp_locker_v1: 0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3
hook: 0x13810528fcF203CD05b96e8eB978D9855F01A8Cc
pool_manager: 0x498581fF718922c3f8e6A244956aF099B2652b2b
---

# B420 Classic Launch Trade: Skill for AI Agents

Every token launched on the B420 Factory trades in **one Uniswap v4 pool on Base (chainId 8453),
behind a B420 hook that aggregators have not vetted**, so they answer `route not found` and this
leaf is the only way in or out. A pool paired with WETH trades in **one Universal Router
transaction** (ETH in, the token out, or back). A pool paired with anything else (B420, a
tokenized stock, an ST0x token) trades through **B420HopRouter, which runs an aggregator leg
between ETH and the quote and the v4 pool between the quote and the token, atomically, in one
transaction**.

The pool key is never guessed: the LP locker stores it. Quotes come from the v4 Quoter, which
simulates the swap through the hook.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../../SKILL.md).

> **Path check first.** This leaf is for tokens where `tokenRewards(token).token` is set on LP
> locker v2 or v1 ([path picker](../SKILL.md#pick-the-path-the-single-copy)). Approvals,
> slippage and deadline defaults and the 2-block launch delay are in the [trade router](../SKILL.md).

## Agent rules

1. **Pool key from the locker, never built by hand.** Three hooks served classic launches over
   time and the fee field carries the dynamic-fee flag (`8388608`); a key that differs in any
   field is another pool, empty or nonexistent (`PoolNotInitialized`, or a zero quote).
2. **Quote right before building.** The minimum output goes into the calldata (the `SWEEP`
   minimum, or the hop router's `minTokenOut` and leg minimums); a quote from a minute ago is
   not a minimum.
3. **Onchain `Permit2.approve` with a short expiry, for the trade's amount.** The site signs a
   `PERMIT2_PERMIT` (command `0x0a`, a 30-day permit) inside the swap; an agent sends
   `Permit2.approve(token, UniversalRouter, amountIn, now + 1800)` instead, which needs no typed
   signature and expires on its own.
4. **Respect the 2-block launch delay.** The first two blocks after a launch revert `PoolLocked()`
   ([trade router](../SKILL.md#the-2-block-launch-delay)).
5. **Fee entries exactly as the site.** `PAY_PORTION` of 100 bips to the Strategic Reserve before
   the `SWEEP`; the hop router's fee rides on its aggregator leg. Never another recipient, never
   other numbers ([fees](../../SKILL.md#fees-canonical)).

## 1. Read the pool key

```ts
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL || "https://mainnet.base.org") });
const LOCKER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct TokenRewardInfo { address token; PoolKey poolKey; uint256 positionId; uint256 numPositions; uint16[] rewardBps; address[] rewardAdmins; address[] rewardRecipients; }",
  "function tokenRewards(address token) view returns (TokenRewardInfo)",
]);
const LOCKERS = ["0x351C934d698eB3c0683066D2fbD6CE7215573Bc4", "0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3"]; // v2, then v1

let key = null;
for (const locker of LOCKERS) {
  const info = await client.readContract({ address: locker, abi: LOCKER_ABI, functionName: "tokenRewards", args: [token] });
  if (info.token !== "0x0000000000000000000000000000000000000000") { key = info.poolKey; break; }
}
if (!key) throw new Error("not a classic B420 launch: run the path picker");
const quote = key.currency0.toLowerCase() === token.toLowerCase() ? key.currency1 : key.currency0; // WETH: 3a and 3b; anything else: 4
```

ADA `0xb200000000000000000000686F75BdEb7183b420`, read on 2026-10-05: `currency0` WETH,
`currency1` ADA, `fee` 8388608, `tickSpacing` 200, `hooks` `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc`.

| Launched | Hook in the key | Locker |
|---|---|---|
| Factory v2, since 2026-09-20 | `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc` (live hook) | v2 |
| Factory v2, 2026-09-17 to 09-20 | `0x0c97593B847beb32341dA5AFb8cbe242F4f168Cc` (retired, keeps serving its pools) | v2 |
| Factory v1 | `0xf95E48163F68C20B14A4e82525DCCC4BdbaAa8cC` | v1 |

Every B20 address sorts above WETH (`0x42...`), so on a WETH pair the token is `currency1`; the
code computes the direction from the key all the same.

## 2. Quote

```ts
const QUOTER = "0x0d5e0F971ED27FBfF6c2837bf31316121532048D";
const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  "error NotEnoughLiquidity(bytes32 poolId)",
  "error UnexpectedRevertBytes(bytes revertData)",
]);
// buying spends the other currency for the token: zeroForOne exactly when the token is currency1
async function quoteV4(key, buying, amountIn) {
  const t = token.toLowerCase();
  const zeroForOne = buying ? key.currency1.toLowerCase() === t : key.currency0.toLowerCase() === t;
  const { result } = await client.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }] });
  if (result[0] === 0n) throw new Error("zero quote: no trade");
  return result[0]; // after the pool's own fee, before PAY_PORTION
}
const quoted = await quoteV4(key, true, amountIn);
const minOut = (quoted * (10000n - slippageBps)) / 10000n; // slippage default: trade router table
```

The Quoter (selector `0xaa9d21cb`) is nonpayable and reverts internally; `simulateContract` (an
`eth_call`) returns `(amountOut, gasEstimate)` and moves nothing. A reverted quote is no trade.

## 3a. Buy with ETH (WETH pair)

`execute(bytes commands, bytes[] inputs, uint256 deadline)` (selector `0x3593564c`) on the
Universal Router, `value = amountIn`.

| # | Command | Byte | Input | Effect |
|---|---|---|---|---|
| 1 | `WRAP_ETH` | `0x0b` | `(ADDRESS_THIS, amountIn)` | The ETH sent becomes the router's WETH |
| 2 | `V4_SWAP` | `0x10` | `(actions, params)` | The three actions below |
| 3 | `PAY_PORTION` | `0x06` | `(token, Strategic Reserve, 100)` | 100 bips of the router's token balance to `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |
| 4 | `SWEEP` | `0x04` | `(token, MSG_SENDER, minOut * 9900 / 10000)` | The rest to you; reverts `InsufficientToken()` below the minimum (the slippage check) |

| Action | Byte | Params |
|---|---|---|
| `SWAP_EXACT_IN_SINGLE` | `0x06` | `(poolKey, zeroForOne, amountIn, amountOutMinimum 0, hookData 0x)` |
| `SETTLE` | `0x0b` | `(WETH, 0, false)`: the open delta, paid from the router's WETH |
| `TAKE` | `0x0e` | `(token, ADDRESS_THIS, 0)`: the whole output parked in the router for steps 3 and 4 |

`MSG_SENDER` is `0x0000000000000000000000000000000000000001` and `ADDRESS_THIS`
`0x0000000000000000000000000000000000000002` (Universal Router recipient sentinels).

```ts
import { encodeAbiParameters, encodeFunctionData, encodePacked } from "viem";

const UR = "0x6fF5693b99212Da76ad316178A184AB56D299b43";
const WETH = "0x4200000000000000000000000000000000000006";
const TREASURY = "0xA3320DCaFAa124173fdf7BD18EcD85abBA325590";
const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const UR_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const enc = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values);
const SWAP_PARAMS = [{ type: "tuple", components: [
  { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" },
] }];

const swap = encodeAbiParameters(SWAP_PARAMS, [{ poolKey: key, zeroForOne: true, amountIn, amountOutMinimum: 0n, hookData: "0x" }]);
const v4 = enc(["bytes", "bytes[]"], [
  encodePacked(["uint8", "uint8", "uint8"], [0x06, 0x0b, 0x0e]),
  [swap, enc(["address", "uint256", "bool"], [WETH, 0n, false]), enc(["address", "address", "uint256"], [token, ADDRESS_THIS, 0n])],
]);
const commands = encodePacked(["uint8", "uint8", "uint8", "uint8"], [0x0b, 0x10, 0x06, 0x04]); // zeroForOne true above: on a WETH pair the token is currency1
const inputs = [
  enc(["address", "uint256"], [ADDRESS_THIS, amountIn]),
  v4,
  enc(["address", "address", "uint256"], [token, TREASURY, 100n]),
  enc(["address", "address", "uint256"], [token, MSG_SENDER, (minOut * 9900n) / 10000n]),
];
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
const tx = { to: UR, data: encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: [commands, inputs, deadline] }), value: amountIn };
```

- Simulated on Base mainnet, 2026-10-05: buy ADA with 0.001 ETH, 744,469.90 ADA quoted before `PAY_PORTION`, `SWEEP` minimum 692,803.69 ADA at the auto 600 bps, gas 603,912.

## 3b. Sell for ETH (WETH pair)

Three transactions the first time, one afterwards while the Permit2 allowance lasts:

1. `token.approve(Permit2, amountIn)` (skip when the allowance covers it).
2. `Permit2.approve(token, UniversalRouter, uint160(amountIn), uint48(now + 1800))` (skip while
   `Permit2.allowance(you, token, UniversalRouter)` returns at least `amountIn` and an expiration in
   the future).
3. `execute` with the commands below, `value = 0`.

```ts
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PERMIT2_ABI = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
```

| # | Command | Byte | Input | Effect |
|---|---|---|---|---|
| 1 | `V4_SWAP` | `0x10` | actions `SWAP_EXACT_IN_SINGLE` (`zeroForOne` = token is `currency0`, `amountIn`, min 0), `SETTLE_ALL` `0x0c` `(token, amountIn)`, `TAKE` `(WETH, ADDRESS_THIS, 0)` | You pay the token through Permit2; the WETH stays in the router |
| 2 | `UNWRAP_WETH` | `0x0c` | `(ADDRESS_THIS, minOut)` | WETH to ETH in the router; reverts `InsufficientETH()` below `minOut` |
| 3 | `PAY_PORTION` | `0x06` | `(0x0000000000000000000000000000000000000000, Strategic Reserve, 100)` | 100 bips of the router's ETH (the zero address is native ETH here) |
| 4 | `SWEEP` | `0x04` | `(0x0000000000000000000000000000000000000000, MSG_SENDER, minOut * 9900 / 10000)` | The rest of the ETH to you |

- Simulated on Base mainnet, 2026-10-05: sell 100 GAMBLE (a classic launch on a WETH pair, retired v2 hook) from the Strategic Reserve, approve Permit2 + `Permit2.approve` + `execute` bundle, gas 45,939, 47,518 and 500,099.
- Simulated on Base mainnet, 2026-10-05: buy ADA with 0.001 ETH then sell 500,000 ADA in one bundle (no B420 wallet holds ADA, and its pool holds no WETH to buy a sale back until someone buys: a sale alone quotes `NotEnoughLiquidity`), gas 603,912 (buy), 45,570 (approve Permit2), 47,530 (`Permit2.approve`), 558,020 (sell).

## 4. Pools paired with another quote: B420HopRouter

A launch paired with B420, a tokenized stock or any other token has no WETH pool. B420HopRouter
`0x82C2B0c34f843A5724497ce809ae96a6eeb03721` does both hops in one transaction: an allowlisted
aggregator leg (Kyber, 0x AllowanceHolder or the Universal Router) between ETH and the quote,
paid to the hop router itself, then the token's own pool through the Universal Router. Every leg
is measured by balance and checked against its minimum, so a short leg reverts the whole trade.
The fee rides on the aggregator leg (its `amountOut` is net); the leg comes from
`POST /api/swap` ([`../aggregator/SKILL.md`](../aggregator/SKILL.md)) with **`sender` and
`recipient` both set to the hop router**.

```ts
const HOP_ROUTER = "0x82C2B0c34f843A5724497ce809ae96a6eeb03721";
const HOP_ROUTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct Leg { address router; bytes call; uint256 minOut; }",
  "function buyWithETH(address token, address quote, PoolKey key, Leg first, uint256 minTokenOut, address recipient, uint256 deadline) payable returns (uint256 tokenOut)",
  "function sellForETH(address token, address quote, PoolKey key, uint256 tokenIn, uint256 minQuoteOut, Leg last, uint256 sellAmount, address recipient, uint256 deadline) returns (uint256 ethOut)",
]);
const slip = (x) => (x * (10000n - slippageBps)) / 10000n;
const legFor = (tokenIn, tokenOut, amountIn) =>
  fetch("https://b420.io/api/swap", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenIn, tokenOut, amountIn: amountIn.toString(), sender: HOP_ROUTER, recipient: HOP_ROUTER, slippageBps: Number(slippageBps) }) }).then((r) => r.json());

// BUY (selector 0xa1f61e95), value = amountIn
const first = await legFor("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", quote, amountIn); // ETH -> quote
const tokenOut = await quoteV4(key, true, BigInt(first.amountOut));                           // section 2 on the pool
const buyArgs = [token, quote, key, { router: first.routerAddress, call: first.data, minOut: slip(BigInt(first.amountOut)) }, slip(tokenOut), me, BigInt(Math.floor(Date.now() / 1000) + 180)];

// SELL (selector 0xda915c20): approve(HOP_ROUTER, tokenIn) on the token first
const quoteOut = await quoteV4(key, false, tokenIn);       // the pool pays this much quote
const sellAmount = slip(quoteOut);                          // what the last leg is built to sell
const last = await legFor(quote, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", sellAmount);     // quote -> ETH
const sellArgs = [token, quote, key, tokenIn, sellAmount, { router: last.routerAddress, call: last.data, minOut: slip(BigInt(last.amountOut)) }, sellAmount, me, BigInt(Math.floor(Date.now() / 1000) + 180)];
```

On a sell, quote the pool pays above `sellAmount` goes to the recipient in the quote token. The
deadline is 180 seconds, as on b420.io: the legs embed aggregator quotes. `sellForETHWithPermit`
(a Permit2 signature transfer) also exists; agents use the plain approval.

- Simulated on Base mainnet, 2026-10-05: buy WHALE (a factory v1 launch paired with B420) with 0.001 ETH, leg 0.002117 to 0.002125 B420 via 0x, 73.3M to 73.6M WHALE quoted over two runs, gas 1,127,076 to 1,285,312.
- Simulated on Base mainnet, 2026-10-05: sell 50,000 WHALE from the Strategic Reserve, approve + `sellForETH` bundle, leg via 0x, gas 46,011 (approve) and 1,141,138 to 1,297,698 (sell).
- Simulated on Base mainnet, 2026-10-05: buy GCAT (a factory v2 launch paired with GOOGLc, live hook) with 0.001 ETH, leg 0.007842 to 0.007843 GOOGLc via Kyber, about 769,200 GCAT quoted, gas 966,270 to 979,382.

## Gas

Send **estimate x 1.2** (the example's `urSwap` rule). Measured on Base mainnet, 2026-10-05:
Universal Router buys 603,912 to 631,634, sells 500,099 to 558,020; B420HopRouter 966,270 to
1,297,698; approve 45,570 to 46,011; `Permit2.approve` 47,518 to 47,530. The rule's 800,000
fallback (no estimate) is below what a hop router trade uses: never send a hop trade without an
estimate.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|---|---|
| Universal Router (`execute`, WETH pairs) | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |
| Permit2 (approve it on the token; `approve` it to the Universal Router) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| V4 Quoter (`quoteExactInputSingle`) | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| Uniswap v4 PoolManager (holds every pool) | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| B420HopRouter (`buyWithETH`, `sellForETH`; approve it on a sell) | `0x82C2B0c34f843A5724497ce809ae96a6eeb03721` |
| LP locker v2 (`tokenRewards(token).poolKey`) | `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` |
| LP locker v1 (`tokenRewards(token).poolKey`, factory v1 launches) | `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` |
| Live classic hook | `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc` |
| Retired v2 hook | `0x0c97593B847beb32341dA5AFb8cbe242F4f168Cc` |
| v1 hook | `0xf95E48163F68C20B14A4e82525DCCC4BdbaAa8cC` |
| MEV block delay (`poolUnlockTime(poolId)`, `blockDelay()` = 2) | `0x0028D5788aa5526Ab38920576c93A46048b09CD1` |
| WETH (18 decimals) | `0x4200000000000000000000000000000000000006` |
| Strategic Reserve (`PAY_PORTION` recipient) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |
| Hop legs: Kyber, 0x AllowanceHolder (`allowedRouters` true, with the Universal Router) | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`, `0x0000000000001fF3684f28c67538d4D072C22734` |

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `InsufficientToken()` | `0x675cae38` | Buy: the `SWEEP` found less than its minimum, the price moved past your slippage | Quote again and rebuild; do not just widen slippage |
| `InsufficientETH()` | `0x6a12f104` | Sell: `UNWRAP_WETH` found less WETH than `minOut` | Quote again and rebuild |
| `TransactionDeadlinePassed()` | `0x5bf6f916` | The `execute` deadline passed before inclusion | Rebuild with a fresh quote and deadline |
| `AllowanceExpired(uint256)` | `0xd81b2f2e` | Sell: no Permit2 allowance to the Universal Router, or it expired (`AllowanceExpired(0)` when never set) | Send `Permit2.approve(token, UniversalRouter, amountIn, now + 1800)` |
| `InsufficientAllowance(uint256)` | `0xf96fb071` | Sell: the Permit2 allowance is below `amountIn` | `Permit2.approve` for the amount |
| `InsufficientAllowance(address,uint256,uint256)` | `0x192b9e4e` | The B20 token was not approved to Permit2 (UR sell) or to the hop router (hop sell) | Add the approval |
| `PoolLocked()` | `0x2e136745` | Inside the 2-block launch delay (from the MEV module, wrapped in `WrappedError` `0x90bfb865`) | Wait for `poolUnlockTime`, quote again |
| `NotEnoughLiquidity(bytes32)` | `0x7a5ed734` | The Quoter cannot fill the input: the pool has too little of the other side | Trade less, or do not trade |
| `V4TooLittleReceived(uint256,uint256)` | `0x8b063d73` | Hop router: the pool hop paid less than `minTokenOut` / `minQuoteOut` (checked by the Universal Router inside the hop router) | Quote again; rebuild the legs |
| `RouterNotAllowed(address)` | `0xc665406f` | Hop router: the leg's router is not allowlisted | Build the leg from `POST /api/swap`; it returns Kyber or 0x AllowanceHolder |
| `Expired()` | `0x203d82d8` | Hop router: the 180-second deadline passed | Request new legs, rebuild |
| `InvalidPool()` | `0x2083cd40` | Hop router: the key does not hold `(token, quote)` | Pass the locker's key and its other currency as `quote` |
| `LegFailed()` | `0x5c4730dc` | Hop router: the aggregator call reverted (a stale leg, or a leg built for another sender) | Request the leg again with `sender` and `recipient` = the hop router |
| `InsufficientOut(uint256,uint256)` | `0xf447a239` | Hop router: the first leg paid less quote than `first.minOut`, the pool paid less than `sellAmount`, or the last leg less ETH than `last.minOut` | Quote both legs again |
| `EthSendFailed()` | `0x98248e64` | Hop sell: the recipient refused the ETH | Use a recipient that accepts ETH |
| `ZeroAddress()` | `0xd92e233d` | Hop router: `recipient` is the zero address | Pass your wallet |

Simulated on Base mainnet, 2026-10-05, as expected reverts: a `SWEEP` minimum above the output
(`InsufficientToken()`), a past deadline (`TransactionDeadlinePassed()`), a sale with no Permit2
allowance (`AllowanceExpired(0)`), a hop buy with `minTokenOut` above the output
(`V4TooLittleReceived`), a leg router outside the allowlist (`RouterNotAllowed`), and a key that
does not hold the pair (`InvalidPool()`).

## What this is NOT

- Not for B420, B69 or tokenized stocks themselves: [`../aggregator/SKILL.md`](../aggregator/SKILL.md).
- Not for rewards or index tokens, whose pools are not in a locker: [`../rewards-token/SKILL.md`](../rewards-token/SKILL.md),
  [`../index/SKILL.md`](../index/SKILL.md).
- Not curve trading (closed) and not claiming creator fees: [`../../claim/SKILL.md`](../../claim/SKILL.md).
- Not exact output, not multi-hop through other v4 pools (b420.io also quotes a WETH to quote to
  token route through public v4 pools; this leaf uses the hop router for every non-WETH quote).

## Related skills

- [`../SKILL.md`](../SKILL.md): trade router; path picker, approvals, slippage defaults, launch delay
- [`../aggregator/SKILL.md`](../aggregator/SKILL.md): POST /api/swap, the source of the hop router's legs
- [`../../launch/classic/SKILL.md`](../../launch/classic/SKILL.md): launch a classic B20 (the dev buy inside the launch skips the delay)
- [`../../claim/SKILL.md`](../../claim/SKILL.md): creator fees and holder distributor claims of a classic launch
- [`../../keeper/SKILL.md`](../../keeper/SKILL.md): `collectRewards` on the LP locker, permissionless

## License

CC0.
