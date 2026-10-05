---
name: b420-trade-rewards-token
version: 1.0.0
description: "Buy or sell a B420 holder-rewards token as an AI agent through B420RewardsRouter (buy and sell with fee entries and a deadline): ETH pairs send value equal to amountIn, ERC-20 pairs (for example NVDAc) approve the router first. GAS RULE: ETH-pair trades send gas = max(estimate + 400k, 1.4M); the afterSwap holder accounting needs the margin. Holding the token earns dividends in the paired asset (claiming is the b420-claim skill). Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
rewards_router: 0x383156D66BdA2369c6eE061C66aa3D32E38cec72
rewards_factory: 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
rewards_hook: 0x2d04aCae52491E882dd6D606F3A8160945fA2aeC
v4_quoter: 0x0d5e0F971ED27FBfF6c2837bf31316121532048D
---

# B420 Rewards Token Trade: Skill for AI Agents

A holder-rewards token (`B420RewardsToken`, ERC-20, 18 decimals) trades in one Uniswap v4 pool
on **Base (chainId 8453)** against its paired asset, native ETH or an ERC-20 such as NVDAc,
behind B420RewardsHook. The hook takes 1% of the paired leg of every swap and credits part of it
to holders, so **every holder earns the paired asset on every trade** (the buyer earns nothing of
its own buy). **B420RewardsRouter buys and sells in one transaction each, with no Permit2**: an
ETH-pair buy is one transaction with `value == amountIn`; an ERC-20-pair buy, or a first sale, is
an exact `approve` of the router plus the trade.

Claiming the dividends a held token pays is [`../../claim/SKILL.md`](../../claim/SKILL.md).

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../../SKILL.md).

> **Gas rule: ETH-pair trades send `gas = max(estimate + 400,000, 1,400,000)`.** The hook buys
> B420 inside every ETH-pair swap with a 1,000,000 gas budget (`BUYBACK_GAS`), and a limit that
> cuts that leg short reverts the whole swap with `InsufficientGas()`. The single copy of the
> rule is [Gas](#gas-the-single-copy-of-the-rewards-gas-rule).

> **Only this router.** The Universal Router and aggregators are closed to rewards tokens
> ([never-do list](../../SKILL.md#never-do-canonical-gates)), even where Kyber returns a route.

## Agent rules

1. **Trade only through B420RewardsRouter `0x383156D66BdA2369c6eE061C66aa3D32E38cec72`.** It
   checks `isRewardsToken` itself (`NotRewardsToken(token)` otherwise) and carries the fee
   entries; no other route carries both the entries and the gas rule.
2. **Pay exactly as the pair requires.** ETH pair: `value == amountIn`. ERC-20 pair: `value == 0`
   and `paired.approve(router, amountIn)` first, the whole `amountIn`, because the router pulls
   the swapped part and the fee entries from you. A wrong `value` reverts `BadValue()`.
3. **Apply the gas rule on every ETH-pair trade.** Never send the wallet's default limit or a bare
   estimate.
4. **Fee entries from `feeEntries()`: one entry, `(Strategic Reserve, 100)`, as on b420.io**
   ([fees](../../SKILL.md#fees-canonical)). The router accepts at most 2 entries, each with a
   nonzero `bps` and a real recipient, at most 100 bps in total (`TooManyFees()`, `BadFee()`,
   `FeeTooHigh(totalBps)` otherwise). An entry that refuses its payment passes it to the next
   one, and the last one's refusal returns to you.
5. **Quote with the fee where the router takes it.** Buy: the router takes the fee off `amountIn`
   before the swap, so quote `amountIn - fee`. Sell: the fee comes off the swap's output, so
   `minOut` is on `gross - fee`.
6. **Wait out the 2-block launch delay** after a launch ([trade router](../SKILL.md#the-2-block-launch-delay)).

## 1. Read the pool key and paired asset

```ts
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL || "https://mainnet.base.org") });
const REWARDS_FACTORY = "0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31";
const FACTORY_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function isRewardsToken(address token) view returns (bool)",
  "function pairedOf(address token) view returns (address)",
  "function poolKeyOf(address token) view returns (PoolKey)",
]);
const [paired, key] = await Promise.all([
  client.readContract({ address: REWARDS_FACTORY, abi: FACTORY_ABI, functionName: "pairedOf", args: [token] }),
  client.readContract({ address: REWARDS_FACTORY, abi: FACTORY_ABI, functionName: "poolKeyOf", args: [token] }),
]);
const ethPair = paired === "0x0000000000000000000000000000000000000000";
```

The key is the two currencies sorted (native ETH, the zero address, is always `currency0`), fee
0, tick spacing 200, hooks = the rewards hook. The router answers the same `poolKeyOf(token)`.

| Token | Paired | Pool key read on 2026-10-05 |
|---|---|---|
| RWT3U6F `0x550F0Dc867c6BD39c2a09874109b62414081b420` | ETH | (ETH `0x0`, RWT3U6F, 0, 200, `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC`) |
| RWS8222 `0x4E0fDAcc7d20C8Ce25B46bB584b5d20bc29db420` | NVDAc (8 decimals) | (RWS8222, NVDAc `0xb20000000000000000000078ee7ce2fE4908108C`, 0, 200, the rewards hook) |

All rewards tokens: `tokenCount()` / `tokenAt(i)` on the factory, or the rows of
`GET /api/launches` that carry a `rewards` field ([`../../market-data/SKILL.md`](../../market-data/SKILL.md)).

## 2. Quote (fee-aware)

```ts
const QUOTER = "0x0d5e0F971ED27FBfF6c2837bf31316121532048D";
const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const fees = [{ recipient: "0xA3320DCaFAa124173fdf7BD18EcD85abBA325590", bps: 100 }]; // feeEntries(): the Strategic Reserve, 100 bps
const feeOf = (base) => fees.reduce((s, f) => s + (base * BigInt(f.bps)) / 10000n, 0n); // the router's floor per entry

async function quote(buying, amountIn) {
  // as the router computes it: zeroForOne = isBuy == (currency1 == token)
  const zeroForOne = buying === (key.currency1.toLowerCase() === token.toLowerCase());
  const { result } = await client.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }] });
  return result[0]; // the hook's 1% (and on an ETH pair the in-swap B420 buyback) already inside
}
const tokensOut = await quote(true, amountIn - feeOf(amountIn));   // buy
const gross = await quote(false, tokensIn);                         // sell
const pairedOut = gross - feeOf(gross);
const minOut = (x) => (x * (10000n - 300n)) / 10000n;               // 300 bps default, trade router table
```

## 3. Buy

`buy(address token, uint256 amountIn, uint256 minOut, address recipient, (address recipient, uint16 bps)[] fees, uint256 deadline)`
payable, selector `0xb9be1680`. `amountIn` is in the paired asset's units (ETH 18 decimals, NVDAc 8).

```ts
const ROUTER = "0x383156D66BdA2369c6eE061C66aa3D32E38cec72";
const ROUTER_ABI = parseAbi([
  "struct FeeTake { address recipient; uint16 bps; }",
  "function buy(address token, uint256 amountIn, uint256 minOut, address recipient, FeeTake[] fees, uint256 deadline) payable returns (uint256 out)",
  "function sell(address token, uint256 amountIn, uint256 minOut, address recipient, FeeTake[] fees, uint256 deadline) returns (uint256 out)",
]);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
// ERC-20 pair only: approve(ROUTER, amountIn) on the paired asset first (stockApprove gas for a stock)
const buyTx = {
  to: ROUTER,
  data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [token, amountIn, minOut(tokensOut), me, fees, deadline] }),
  value: ethPair ? amountIn : 0n,
};
```

- Simulated on Base mainnet, 2026-10-05: buy RWT3U6F (ETH pair) with 0.0005 ETH, 368,564.17 RWT3U6F quoted, estimate 996,835 to 1,153,975 over two runs, limit 1,400,000 to 1,553,975 by the gas rule.
- Simulated on Base mainnet, 2026-10-05: buy RWS8222 (NVDAc pair) with 0.001 NVDAc from a wallet that had approved the router, 63,830.53 RWS8222 quoted, estimate 390,703, limit 507,914.
- Simulated on Base mainnet, 2026-10-05: NVDAc approve + buy bundle with 0.0005 NVDAc from the Strategic Reserve, gas 45,939 (approve) and 280,055 (buy, gas used in the bundle).

## 4. Sell

`sell(address token, uint256 amountIn, uint256 minOut, address recipient, (address recipient, uint16 bps)[] fees, uint256 deadline)`,
selector `0x4df845bc`, `value = 0`. Approve the router on the token for `amountIn` first. The
proceeds arrive in the paired asset (ETH, or the ERC-20); `minOut` is what you receive after the
fee entries.

```ts
// approve(ROUTER, tokensIn) on the rewards token first when the allowance is short
const sellTx = {
  to: ROUTER,
  data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [token, tokensIn, minOut(pairedOut), me, fees, deadline] }),
  value: 0n,
};
```

- Simulated on Base mainnet, 2026-10-05: sell 10,000 RWT3U6F (ETH pair) from a B420 protocol wallet that had approved the router, 0.000013 ETH after the fee entries, estimate 970,136 to 1,125,596, limit 1,400,000 to 1,525,596.

With the example script:

```bash
node trade/examples/trade.mjs 0x550F0Dc867c6BD39c2a09874109b62414081b420 buy 0.0005 --from 0xYourAgentWallet   # ETH pair
node trade/examples/trade.mjs 0x4E0fDAcc7d20C8Ce25B46bB584b5d20bc29db420 buy 0.001 --from 0xYourAgentWallet    # 0.001 NVDAc
node trade/examples/trade.mjs 0x550F0Dc867c6BD39c2a09874109b62414081b420 sell all --from 0xYourAgentWallet
```

## Gas (the single copy of the rewards gas rule)

| Trade | Gas limit to send | When the estimate fails | Why |
|---|---|---|---|
| ETH pair, buy or sell | `max(estimate + 400,000, 1,400,000)` | 1,800,000 | The hook's B420 buyback runs inside the swap with a 1,000,000 budget; a limit that cuts it short reverts the swap (`InsufficientGas()`), so a limit tuned to the estimate alone is unsafe |
| ERC-20 pair, buy or sell | `estimate * 1.3` | 700,000 | No buyback leg; the router reserves 100,000 gas (`FEE_TOKEN_PUSH_GAS`) plus a margin before each ERC-20 fee transfer |

Same numbers as b420.io (`REWARDS_ETH_GAS_*`). The shared library's gas rules `rewardsEthTrade`
and `rewardsErc20Trade` implement them. Approvals, a tokenized stock's included, take the gas
rule of the [approvals table](../SKILL.md#approvals-the-single-copy). Measured on Base mainnet,
2026-10-05: ETH-pair buy 996,835 to 1,153,975, ETH-pair sell 970,136 to 1,125,596, ERC-20-pair
buy 390,703. The ETH-pair estimate moves with the state of the B420 pool the buyback trades in.

A limit printed (`--print`) for a trade that follows an approval in the same run comes from the
bundle's gas used, which sits below a standalone estimate on this router (it checks
`gasleft()` against its reserve before each fee payment); send the approval, then run again to
print the trade with its own estimate. `--send` re-estimates each step on its own.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|---|---|
| B420RewardsRouter (`buy`, `sell`; approve it on sells and ERC-20-pair buys) | `0x383156D66BdA2369c6eE061C66aa3D32E38cec72` |
| B420RewardsFactory (`isRewardsToken`, `pairedOf`, `poolKeyOf`, `tokenCount`, `tokenAt`) | `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31` |
| B420RewardsHook (`poolIdOf`, `poolOf`, `LAUNCH_BLOCK_DELAY()` = 2, `BUYBACK_GAS()` = 1,000,000) | `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC` |
| V4 Quoter (`quoteExactInputSingle`) | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| Uniswap v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| NVDAc (paired asset of RWS8222, 8 decimals) | `0xb20000000000000000000078ee7ce2fE4908108C` |
| Strategic Reserve (the fee entry; last entry) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |

Router constants read on 2026-10-05: `MAX_FEE_BPS` 100, `MAX_FEE_ENTRIES` 2, `FEE_PUSH_GAS`
50,000, `FEE_TOKEN_PUSH_GAS` 100,000. The router has no owner and holds nothing between
transactions.

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `BadValue()` | `0x0bba69fb` | ETH pair with `value != amountIn`, or ERC-20 pair with `value != 0` | Send `value = amountIn` on an ETH pair, 0 on an ERC-20 pair |
| `TooLittleReceived(uint256,uint256)` | `0x4e86d23a` | The output (after the fee on a sell) is below `minOut` | Quote again right before building; widen slippage only if whoever you act for accepts it |
| `Expired(uint256)` | `0xf80dbaea` | `block.timestamp > deadline` | Rebuild with a fresh quote and deadline |
| `NotRewardsToken(address)` | `0xebdf1e56` | The token is not from the rewards factory | Run the [path picker](../SKILL.md#pick-the-path-the-single-copy) |
| `BadRecipient()` | `0x67a2cc26` | `recipient` is zero or the router | Pass your wallet |
| `ZeroAmount()` | `0x1f2a2005` | `amountIn` is 0 | Trade a positive amount |
| `TooManyFees()` | `0xf1bf84c5` | More than 2 fee entries | Use `feeEntries()` |
| `BadFee()` | `0x917f1a53` | An entry with `bps` 0 or a zero or router recipient | Use `feeEntries()` |
| `FeeTooHigh(uint256)` | `0x7b931420` | Entries total more than 100 bps | Use `feeEntries()` (100) |
| `InsufficientGas()` | `0x1c26714c` | The limit could not cover a fee payment's budget, or (from the hook) the in-swap B420 buyback was cut short | Apply the [gas rule](#gas-the-single-copy-of-the-rewards-gas-rule) |
| `AmountTooLarge()` | `0x06250401` | `amountIn` above `int128` | Trade a smaller amount |
| `EthTransferFailed(address)` | `0x09b62ba1` | Your recipient refused ETH (a sale's proceeds, or a buy's refund) | Use a recipient that accepts ETH |
| `UnexpectedDelta()` | `0x29a70758` | A fee-on-transfer paired asset or a short settle left the router's books open | Not tradable through this router |
| `ERC20InsufficientAllowance(address,uint256,uint256)` | `0xfb8f41b2` | Sell (or ERC-20 buy) without enough allowance to the router | `approve(router, amountIn)` first |
| `InsufficientAllowance(address,uint256,uint256)` | `0x192b9e4e` | Same for a B20 paired asset (a tokenized stock) | Approve the stock to the router |
| `PoolLocked()` | `0x2e136745` | Hook: inside the 2-block launch delay | Wait for `tradingFromBlock` |
| `PartialFill()` | `0xd964f528` | Hook: the swap could not fill the whole amount (price range end) | Trade less |
| `UnknownPool()` | `0xf7139e33` | Hook: a key that is not a rewards pool (only through a hand-built key) | Use `poolKeyOf(token)` |
| `WrappedError(address,bytes4,bytes,bytes)` | `0x90bfb865` | A hook error re-thrown by the PoolManager | `decodeRevert` unwraps it; act on the inner error |

Simulated on Base mainnet, 2026-10-05, as expected reverts: `value` 1 wei below `amountIn`
(`BadValue()`), `minOut` above the output (`TooLittleReceived`), a 101 bps entry
(`FeeTooHigh(101)`), a past deadline (`Expired`), a classic launch passed as the token
(`NotRewardsToken`), and a sale with no allowance (`ERC20InsufficientAllowance(router, 0, amount)`).

## What this is NOT

- Not claiming dividends or ledger slots: [`../../claim/SKILL.md`](../../claim/SKILL.md).
- Not launching a rewards token: [`../../launch/rewards/SKILL.md`](../../launch/rewards/SKILL.md).
- Not the Universal Router, Permit2 or an aggregator: closed for these tokens.
- Not exact output: the router is exact input only.

## Related skills

- [`../SKILL.md`](../SKILL.md): trade router; path picker, approvals, slippage defaults, launch delay
- [`../../claim/SKILL.md`](../../claim/SKILL.md): `claimDividend` and the ledger slots of a rewards token
- [`../../launch/rewards/SKILL.md`](../../launch/rewards/SKILL.md): launch a holder-rewards token
- [`../../keeper/SKILL.md`](../../keeper/SKILL.md): flush the rewards hook, pay every holder (`claimDividendFor`)
- [`../../market-data/SKILL.md`](../../market-data/SKILL.md): `/api/rewards-launch/<token>` pool, holders and `tradingFromBlock`

## License

CC0.
