---
name: b420-trade-aggregator
version: 1.0.0
description: "Swap B420, B69, tokenized stocks (NVDAc, AAPLc, TSLAc and the rest of the registry, Coinbase wrapped, ST0x) and other Base tokens with a market as an AI agent through POST https://b420.io/api/swap: one call returns the router, the calldata and a net amountOut (0x first, Kyber when 0x refuses a stock). Approve the returned router on sells, send ETH value on buys. Not for classic launches, rewards tokens or index tokens (aggregators cannot route their hooked pools); those are sibling leaves under trade/. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
kyber_router: 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5
zero_ex_allowance_holder: 0x0000000000001fF3684f28c67538d4D072C22734
---

# B420 Aggregator Swap: Skill for AI Agents

`POST https://b420.io/api/swap` turns one request into a ready transaction on **Base (chainId
8453)**: **the response carries the router to call, the exact calldata and the output you will
receive, already net of the fee**. b420.io asks 0x (AllowanceHolder) first and falls through to
KyberSwap when 0x has no liquidity or refuses the pair, which is the case for tokenized stocks.
Your wallet signs and sends; b420.io never touches funds or keys.

This is the path for B420, B69, the registry stocks (NVDAc, AAPLc, GOOGLc, METAc, AMZNc, MSFTc,
TSLAc, MSTRc, SPCXc, SNDKc), ST0x tokens (`wtCOIN`, `wtTSM` and the rest of `GET /api/st0x`) and
any other Base token with a market. It is **not** the path for a classic launch, a rewards token or
an index token: run the [path picker](../SKILL.md#pick-the-path-the-single-copy) first.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../../SKILL.md).

> **Path check first.** The aggregator answers `route not found` for index tokens and classic
> launches, and it does quote some rewards tokens through a route that is refused all the same
> ([trade router](../SKILL.md) rule 2). Only tokens the picker sends here belong here.

## Agent rules

1. **`sender` is the address that sends the transaction.** 0x builds the call for that taker and
   Kyber for that sender; a route built for another address fails or pays someone else. A plain
   swap leaves `recipient` out (it defaults to `sender`); only B420HopRouter legs set it
   ([`../classic/SKILL.md`](../classic/SKILL.md) 4).
2. **Request the route right before sending.** The calldata embeds a quote and a minimum output at
   your `slippageBps`; an old route reverts on price movement or expiry. Request, approve if
   needed, simulate, send, in one run.
3. **Approve exactly `routerAddress`, for exactly `amountIn`.** The router depends on the source
   of that response (0x AllowanceHolder or Kyber); an approval to the other one does nothing.
4. **`amountOut` is net.** The fee is taken inside the route; never subtract it again, never add a
   fee entry of your own.
5. **Amounts are in the token's decimals.** Registry stocks have 8 decimals, B420, B69 and ETH 18,
   USDC 6. `amountIn` is a wei string of the input token.

## 1. Request the route

| Body field | Type | Meaning |
|---|---|---|
| `tokenIn` | address | Token you pay; native ETH is `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |
| `tokenOut` | address | Token you receive; native ETH as above |
| `amountIn` | string | Positive integer, raw units of `tokenIn` |
| `sender` | address | The wallet that will send the transaction |
| `recipient` | address, optional | Who receives `tokenOut`; defaults to `sender` |
| `slippageBps` | number, optional | 5 to 2000, default 100; clamped to that range |

| Response field | Meaning |
|---|---|
| `success` | `true` |
| `routerAddress` | The contract to call and, on a sell, to approve (0x AllowanceHolder `0x0000000000001fF3684f28c67538d4D072C22734`, or Kyber `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`); may come back lowercase, checksum it |
| `data` | Calldata for `routerAddress` |
| `amountOut` | Expected output, raw units of `tokenOut`, net of the fee |
| `gas` | The aggregator's own gas figure (string), or `null`; estimate it yourself |
| `priceImpact` | Kyber's figure when it gives one, else `null` |
| `feeBps` | `100` |
| `source` | `"0x"` on a 0x route; absent on a Kyber route |

```bash
curl -s -X POST https://b420.io/api/swap -H 'content-type: application/json' -d '{
  "tokenIn": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "tokenOut": "0xB200000000000000000000231d6C1F1CE455ba32",
  "amountIn": "1000000000000000",
  "sender": "0xYourAgentWallet",
  "slippageBps": 100
}'
# -> {"success":true,"routerAddress":"0x0000000000001ff3684f28c67538d4d072c22734","data":"0x2213bc0b...","amountOut":"2117...","gas":"...","priceImpact":null,"feeBps":100,"source":"0x"}
```

```ts
import { getAddress, parseUnits } from "viem";

const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const me = "0xYourAgentWallet";
const amountIn = parseUnits("0.001", 18); // ETH has 18 decimals; a registry stock 8, USDC 6

const res = await fetch("https://b420.io/api/swap", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tokenIn: ETH, tokenOut: "0xB200000000000000000000231d6C1F1CE455ba32", amountIn: amountIn.toString(), sender: me, slippageBps: 100 }),
});
const route = await res.json();
if (!res.ok || route.success !== true) throw new Error(`no route: ${route.error}`); // 400 bad body, 502 no route
const router = getAddress(route.routerAddress);
```

## 2. Approve (sells and token-paid buys)

When `tokenIn` is not ETH, approve `router` (the `routerAddress` of the response you are about to
send) for exactly `amountIn`, then send the swap. The [approvals table](../SKILL.md#approvals-the-single-copy)
has the gas rule (B20 tokens: `stockApprove`).

```ts
import { parseAbi } from "viem";
const ERC20_ABI = parseAbi(["function allowance(address owner, address spender) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"]);
// allowance(me, router) < amountIn  ->  send approve(router, amountIn) on tokenIn first
```

## 3. Send

```ts
const tx = { to: router, data: route.data, value: tokenIn === ETH ? amountIn : 0n }; // ETH value only on a buy with ETH
// simulate from `me` (eth_call + eth_estimateGas), then send with gas = estimate x 1.2
```

Bankr gets the same fields as decimal strings (`value`, `gas`), `chainId: 8453`
([signer modes](../../SKILL.md#signer-modes-and-broadcasting-canonical)). With the example script:

```bash
node trade/examples/trade.mjs 0xB200000000000000000000231d6C1F1CE455ba32 buy 0.001 --from 0xYourAgentWallet
node trade/examples/trade.mjs 0xB200000000000000000000231d6C1F1CE455ba32 sell 0.001 --receive 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --from 0xYourAgentWallet
node trade/examples/trade.mjs 0xB2000000000000000000007594Fe5aCD56DF3937 buy 0.0005 --pay 0xB200000000000000000000231d6C1F1CE455ba32 --from 0xYourAgentWallet
```

Recorded with the example script, from the Strategic Reserve (a B420 protocol wallet) unless the
line names another wallet:

- Simulated on Base mainnet, 2026-10-05: buy B420 with 0.001 ETH, route via 0x (AllowanceHolder), 0.002117 to 0.002125 B420 net over two runs, gas 599,301 to 759,825 (the 0x route varies).
- Simulated on Base mainnet, 2026-10-05: buy NVDAc with 0.001 ETH, route via Kyber (0x refused the stock), 0.011423 to 0.011426 NVDAc net, gas 283,939 to 284,927.
- Simulated on Base mainnet, 2026-10-05: sell 0.001 B420 for ETH, approve + swap bundle via 0x, 0.00045 to 0.000452 ETH net, gas 45,915 (approve) and 578,889 to 735,485 (swap).
- Simulated on Base mainnet, 2026-10-05: sell 0.001 B420 for USDC (`--receive`), approve + swap bundle via 0x, 1.225002 to 1.229754 USDC net, gas 45,915 (approve) and 723,578 (swap).
- Simulated on Base mainnet, 2026-10-05: buy B69 paying 0.0005 B420 (`--pay`), approve + swap bundle via 0x, 0.029278 B69 net, gas 45,915 (approve) and 492,999 (swap).
- Simulated on Base mainnet, 2026-10-05: buy NVDAc paying 0.0005 B420 (`--pay`) from a B420 holder's wallet, approve + swap bundle via Kyber (0x refuses the stock), 0.002601 NVDAc net, gas 45,987 (approve) and 822,385 (swap).
- Simulated on Base mainnet, 2026-10-05: sell 0.001 NVDAc for ETH from protocolAdmin, approve + swap bundle via Kyber, 0.000085 ETH net, gas 45,951 (approve) and 295,175 (swap).

The Strategic Reserve is the `feeReceiver` that `/api/swap` passes to Kyber, and Kyber refuses a
fee-on-input route whose sender is its own fee receiver: the same NVDAc sale from the Strategic
Reserve reverts `Error("sender != recipient")`. No other wallet hits this; never use the Strategic
Reserve as `--from` to record a Kyber sale.

Also checked, 2026-10-05: B69 routes via 0x; the ST0x token `wtTSM` routes via Kyber.

## Gas

The aggregator's `gas` field is the aggregator's own figure; estimate the transaction from your
wallet and send **estimate x 1.2** (the example's `urSwap` rule, 800,000 if no estimate exists).
Measured on Base mainnet, 2026-10-05: 283,939 to 284,927 for a Kyber stock buy with ETH, 295,175
for a Kyber stock sale, 822,385 for a Kyber route from B420 to a stock, 492,999 to 759,825 for 0x
routes that touch B420 or B69. An approval costs about 46,000.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|---|---|
| 0x AllowanceHolder (call and approve when `source` is `"0x"`) | `0x0000000000001fF3684f28c67538d4D072C22734` |
| Kyber MetaAggregationRouterV2 (call and approve when `source` is absent) | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| B420 (B20, 18 decimals) | `0xB200000000000000000000231d6C1F1CE455ba32` |
| B69 (B20, 18 decimals) | `0xB2000000000000000000007594Fe5aCD56DF3937` |
| B420StockRegistry (`allStocks()`: the 10 registry stocks, 8 decimals) | `0x5E4643c2F48c14e09f209CAe5A51455211e10c1E` |
| USDC (6 decimals) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Strategic Reserve (receives the fee inside the route; nothing to call) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |

Stock lists with liquidity: `GET /api/stocks`, `/api/cbstocks`, `/api/st0x`
([`../../market-data/SKILL.md`](../../market-data/SKILL.md)).

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| HTTP 400 `tokenIn/tokenOut must be addresses.` | | A field is not a 0x address | Send checksummed or lowercase addresses; native ETH is `0xEeee...EEeE` |
| HTTP 400 `amountIn must be a positive wei amount.` | | `amountIn` is 0, negative, a decimal or a number with a dot | Send the raw integer as a string |
| HTTP 400 `sender must be the connected wallet.` | | `sender` missing or not an address | Pass the sending wallet |
| HTTP 502 `route not found` | | No aggregator market for the pair: a classic launch, an index token, a dead pool | Run the [path picker](../SKILL.md#pick-the-path-the-single-copy); use the leaf it names |
| HTTP 502 `Route build failed.` / `Aggregator unavailable, try again.` | | Kyber refused to build or did not answer | Request again; no transaction exists yet |
| `Error("sender != recipient")` | `0x08c379a0` | Kyber refuses a fee-on-input route whose sender is its own fee receiver, the Strategic Reserve `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590`; never seen from any other wallet | Send from another wallet |
| `InsufficientAllowance(address,uint256,uint256)` | `0x192b9e4e` | A B20 `tokenIn` (B420, B69, a stock) was not approved to `routerAddress` | Approve the router named in the response, for `amountIn` |
| `InsufficientBalance(address,uint256,uint256)` | `0xdb42144d` | The wallet holds less B20 `tokenIn` than `amountIn` | Request a route for at most the balance |
| A revert inside the router with the aggregator's own reason (a min-out check) | | Price moved past `slippageBps` between request and inclusion | Request a new route right before sending; raise `slippageBps` only if whoever you act for accepts it |

## What this is NOT

- Not for classic launches, rewards tokens or index tokens: [`../SKILL.md`](../SKILL.md) picks
  their leaf.
- Not a quote-only price feed: for prices read [`../../market-data/SKILL.md`](../../market-data/SKILL.md);
  `/api/swap` builds a transaction for one sender.
- Not a way to set your own fee or recipient: the route carries the b420.io fee, server-side.

## Related skills

- [`../SKILL.md`](../SKILL.md): trade router, path picker, approvals table, slippage defaults
- [`../classic/SKILL.md`](../classic/SKILL.md): classic launches; its hop router uses this API for its ETH leg
- [`../rewards-token/SKILL.md`](../rewards-token/SKILL.md): holder-rewards tokens
- [`../index/SKILL.md`](../index/SKILL.md): index tokens
- [`../../staking/SKILL.md`](../../staking/SKILL.md): stake the B420 or B69 you bought

## License

CC0.
