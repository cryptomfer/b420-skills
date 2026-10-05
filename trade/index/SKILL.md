---
name: b420-trade-index
version: 1.0.0
description: "Buy or sell a B420 index token (an onchain basket of up to 10 tokens, for example MEOW, COIN5 or OG) as an AI agent through B420IndexRouter: buy shares with ETH, sell shares for ETH, exact input only, quotes only from the v4 Quoter simulation (the pool holds no liquidity; never read slot0), first buy on an empty index at least 0.0005 ETH net. v3 stack (MEOW, COIN5) and v4 stack (OG and every new index) live. Index holders earn ETH dividends (b420-claim skill). Creating an index is not offered to agents. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
index_factory_v3: 0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF
index_factory_v4: 0xD408a52ff4871097A89977Ca9fc48dF0D4243293
index_router_v3: 0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4
index_hook_v3: 0x5C654E637B6bC597A655DaB90867296d5Ae76888
index_router_v4: 0x7B519742705e71313E982dA1cC89c05C076DA4AB
index_hook_v4: 0x3A9721075D9f183648029058549A65C684D16888
v4_quoter: 0x0d5e0F971ED27FBfF6c2837bf31316121532048D
---

# B420 Index Trade: Skill for AI Agents

A B420 index token is an **onchain basket of up to 10 tokens on Base (chainId 8453)**: MEOW holds
four tokens at 25% each, COIN5 five tokenized stocks at 20% each. Its Uniswap v4 pool (native ETH,
the index, fee 0, tick spacing 60, the index hook) **holds no liquidity**: on every swap the hook
buys or sells the constituents in their own pools and mints or burns shares, so the price never
sits in the pool and **the only valid quote is the v4 Quoter's simulation of the swap**.
B420IndexRouter buys shares with ETH in one transaction and sells them for ETH after a plain
`approve` of the router, no Permit2.

The index takes its own fee inside the swap (`feeBps()`, 100 = 1% on MEOW and COIN5), split
between holders (ETH dividends), the creator, a B420 buyback and operations. Claiming the
dividends is [`../../claim/SKILL.md`](../../claim/SKILL.md).

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../../SKILL.md).

> **Two index stacks are live.** v3 holds MEOW and COIN5; v4 (multi-hop constituent routes,
> its own factory, hook, router and ledger) holds OG Memes Index ($OG) and every index created
> from now on. Token, router and ledger ABIs are the same on both. Always trade an index through
> the router of **its own** stack ([stacks table](#stacks), `INDEX_STACKS` in the shared library).

> **Creating an index is not offered to agents.** `createIndex` is closed to the public on
> b420.io ([never-do list](../../SKILL.md#never-do-canonical-gates)); this leaf only trades
> existing indexes.

## Agent rules

1. **Find the index's stack first, then use that stack's router.** `isIndex(token)` on each stack's
   factory; a router of another stack answers `NotIndex(token)`.
2. **Quote only with the Quoter.** Never read `slot0`, liquidity or a pool price for an index: the
   pool is empty by design. The Quoter runs the hook and every constituent leg exactly as the
   trade will.
3. **Fee entries from `feeEntries()`: one entry, `(Strategic Reserve, 100)`, as on b420.io**
   ([fees](../../SKILL.md#fees-canonical)). The router accepts at most 2 entries, at most 100 bps
   in total; the fee is cut from `msg.value` on a buy and from the ETH output on a sale
   (`TooManyFees()`, `BadFee()`, `FeeTooHigh(totalBps)` otherwise).
4. **Exact input only.** Buy with an ETH amount, sell a share amount; the hook reverts exact
   output (`ExactOutputNotSupported()`).
5. **First buy on an empty index: at least 0.0005 ETH reaches the basket.** That is after the
   router's fee entries and the index's own fee: with a 1% entry and `feeBps` 100, send at least
   0.000511 ETH, or the hook reverts `FirstBuyTooSmall()`.
6. **Send `estimate * 1.25` gas, and always estimate.** Gas grows with the number of constituents;
   a fixed guess is too low for the larger baskets ([Gas](#gas)).

## Stacks

| Stack | Factory | Router | Hook | Ledger | Status |
|---|---|---|---|---|---|
| v3 | `0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF` | `0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4` | `0x5C654E637B6bC597A655DaB90867296d5Ae76888` | `0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6` (the factory's `splitter()`) | Live; MEOW and COIN5 |
| v4 | `0xD408a52ff4871097A89977Ca9fc48dF0D4243293` | `0x7B519742705e71313E982dA1cC89c05C076DA4AB` | `0x3A9721075D9f183648029058549A65C684D16888` | `0x1B66965006fbaa476fc22B8432cc232b6148E958` (the factory's `splitter()`) | Live since 2026-10-05; OG and new indexes; same router ABI, `MIN_FIRST_BUY` and fee rules |

## 1. Confirm it is an index and read NAV

```ts
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL || "https://mainnet.base.org") });
const STACKS = [{ id: "v3", factory: "0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF", router: "0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4", hook: "0x5C654E637B6bC597A655DaB90867296d5Ae76888" },
  { id: "v4", factory: "0xD408a52ff4871097A89977Ca9fc48dF0D4243293", router: "0x7B519742705e71313E982dA1cC89c05C076DA4AB", hook: "0x3A9721075D9f183648029058549A65C684D16888" }];
const FACTORY_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function isIndex(address token) view returns (bool)",
  "function poolKeyOf(address index) view returns (PoolKey)",
]);
const INDEX_ABI = parseAbi([
  "function constituents() view returns (address[] tokens, uint16[] weightsBps)",
  "function basket() view returns (address[] tokens, uint256[] balances)",
  "function totalSupply() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

let stack = null;
for (const s of STACKS) if (await client.readContract({ address: s.factory, abi: FACTORY_ABI, functionName: "isIndex", args: [index] })) { stack = s; break; }
if (!stack) throw new Error("not a B420 index: run the path picker");
const key = await client.readContract({ address: stack.factory, abi: FACTORY_ABI, functionName: "poolKeyOf", args: [index] });
// MEOW, 2026-10-05: (0x0000000000000000000000000000000000000000, MEOW, 0, 60, 0x5C654E637B6bC597A655DaB90867296d5Ae76888)
```

NAV, basket balances, holders and dividends in USD: `GET /api/indexes` (every index: tokens,
weights, balances, outstanding shares, `navUsd`) and `GET /api/index/<address>`
([`../../market-data/SKILL.md`](../../market-data/SKILL.md)). NAV is a reference; the trade price
is the Quoter's.

## 2. Quote

```ts
const QUOTER = "0x0d5e0F971ED27FBfF6c2837bf31316121532048D";
const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  "error UnexpectedRevertBytes(bytes revertData)",
]);
const fees = [{ recipient: "0xA3320DCaFAa124173fdf7BD18EcD85abBA325590", bps: 100 }]; // feeEntries()
const feeOf = (base) => fees.reduce((s, f) => s + (base * BigInt(f.bps)) / 10000n, 0n);
const quote = async (buying, amountIn) =>
  (await client.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne: buying, exactAmount: amountIn, hookData: "0x" }] })).result[0]; // ETH is currency0: buying is zeroForOne

const shares = await quote(true, value - feeOf(value));   // buy: the router cuts the fee from msg.value first
const gross = await quote(false, sharesIn);                // sell: the fee comes off the ETH output
const ethOut = gross - feeOf(gross);
const minOut = (x) => (x * (10000n - 200n)) / 10000n;      // 200 bps default, trade router table
```

The quote already includes the index fee and every constituent leg's own fee and price impact. A
reverted quote (a dead constituent route, `FirstBuyTooSmall`) arrives as
`UnexpectedRevertBytes(bytes)` with the cause inside: no quote, no trade.

## 3. Buy

`buy(address index, uint256 minShares, address recipient, (address recipient, uint16 bps)[] fees, uint256 deadline)`
payable, selector `0xed192a47`, `value` = the ETH you spend (fee included).

```ts
const ROUTER_ABI = parseAbi([
  "struct FeeTake { address recipient; uint16 bps; }",
  "function buy(address index, uint256 minShares, address recipient, FeeTake[] fees, uint256 deadline) payable returns (uint256 shares)",
  "function sell(address index, uint256 shares, uint256 minEthOut, address recipient, FeeTake[] fees, uint256 deadline) returns (uint256 ethOut)",
]);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes
const buyTx = { to: stack.router, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [index, minOut(shares), me, fees, deadline] }), value };
```

First buy of an empty index (`totalSupply() == 0`): the hook mints 1,000 shares per ETH that
reaches the basket and requires `MIN_FIRST_BUY` (0.0005 ETH) of it, measured after the router's
fee entries and the index's `feeBps`. MEOW and COIN5 already have holders; no live index is
empty, so this rule was checked against the contract and not simulated.

- Simulated on Base mainnet, 2026-10-05: buy MEOW with 0.001 ETH, 0.9133 to 0.9177 MEOW quoted over several runs, gas 1,104,383 to 1,104,449 (limit up to 1,380,562).
- Simulated on Base mainnet, 2026-10-05: buy COIN5 with 0.001 ETH, 0.9968 to 0.9987 COIN5 quoted, gas 2,535,847 to 2,567,407 (limit up to 3,209,259).

## 4. Sell

1. `index.approve(router, shares)` when the allowance is short (a plain ERC-20 approve, no Permit2).
2. `sell(address index, uint256 shares, uint256 minEthOut, address recipient, (address recipient, uint16 bps)[] fees, uint256 deadline)`,
   selector `0x4df845bc`, `value = 0`. `minEthOut` is what you receive after the fee entries.

```ts
const sellTx = { to: stack.router, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [index, sharesIn, minOut(ethOut), me, fees, deadline] }), value: 0n };
```

- Simulated on Base mainnet, 2026-10-05: sell 1 MEOW from a MEOW holder, approve + sell bundle, 0.001032 to 0.001034 ETH after the fee entries, gas 46,383 (approve) and 900,331 to 900,363 (sell, gas used in the bundle); a later run selling 0.01 MEOW from another holder, gas 46,371 and 892,622.
- Simulated on Base mainnet, 2026-10-05: sell 0.1 COIN5 from a B420 protocol wallet that had approved the router, 0.000096 ETH after the fee entries, gas 2,118,559 to 2,123,254 (limit up to 2,654,068).

With the example script:

```bash
node trade/examples/trade.mjs 0xd29327FC1933bC6391d225A71bc1612A6Ed4b420 buy 0.001 --from 0xYourAgentWallet
node trade/examples/trade.mjs 0x7013546C860e527c1af0E6F809F95AAAe27cB420 sell all --from 0xYourAgentWallet
```

## Gas

Send **`estimate * 1.25`** (the shared library's `indexTrade` rule). The hook trades every
constituent inside the swap, so gas grows with the basket: measured on Base mainnet, 2026-10-05,
1,104,383 to 1,104,449 to buy MEOW (4 tokens), 2,535,847 to 2,567,407 to buy COIN5 (5 stocks),
about 900,000 to sell MEOW, about 2,120,000 to sell COIN5. The rule's 2,600,000 fallback (no
estimate) is below what a COIN5 buy needs with its margin (up to 3,209,259): never send an index trade without an estimate. The router
reverts `InsufficientGas()` before a fee payment rather than skip it, so a short limit fails
cleanly.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|---|---|
| Index v3 router (`buy`, `sell`; approve it on sells) | `0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4` |
| Index v3 factory (`isIndex`, `poolKeyOf`, `indexCount`, `indexAt`) | `0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF` |
| Index v4 factory (same views) | `0xD408a52ff4871097A89977Ca9fc48dF0D4243293` |
| Index v4 router | `0x7B519742705e71313E982dA1cC89c05C076DA4AB` |
| Index v3 hook (`MIN_FIRST_BUY()` = 0.0005 ETH, `INDEX_TICK_SPACING()` = 60) | `0x5C654E637B6bC597A655DaB90867296d5Ae76888` |
| Index v3 ledger (creator and operations ETH; claims are in the claim skill) | `0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6` |
| Index v4 hook (same views as v3, plus `pendingHolders(index)`) | `0x3A9721075D9f183648029058549A65C684D16888` |
| Index v4 ledger (the v4 factory's `splitter()`) | `0x1B66965006fbaa476fc22B8432cc232b6148E958` |
| V4 Quoter (the only price source) | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| Uniswap v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| MEOW (index, 18 decimals) | `0xd29327FC1933bC6391d225A71bc1612A6Ed4b420` |
| COIN5 (index, 18 decimals) | `0x7013546C860e527c1af0E6F809F95AAAe27cB420` |
| Strategic Reserve (the fee entry; last entry) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |

Router constants read on 2026-10-05: `MAX_FEE_BPS` 100, `MAX_FEE_ENTRIES` 2, `FEE_PUSH_GAS`
50,000. No owner, no pause, nothing held between transactions.

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `TooLittleReceived(uint256,uint256)` | `0x4e86d23a` | Shares (buy) or ETH after the fee (sell) below your minimum | Quote again right before building |
| `NotIndex(address)` | `0xd92422bb` | The token is not an index of this router's stack | Find the stack with `isIndex`; use its router |
| `Expired(uint256)` | `0xf80dbaea` | `block.timestamp > deadline` | Rebuild with a fresh quote and deadline |
| `ZeroAmount()` | `0x1f2a2005` | `msg.value` (buy) or `shares` (sell) is 0 | Trade a positive amount |
| `BadRecipient()` | `0x67a2cc26` | `recipient` is zero or the router | Pass your wallet |
| `TooManyFees()` | `0xf1bf84c5` | More than 2 fee entries | Use `feeEntries()` |
| `BadFee()` | `0x917f1a53` | An entry with `bps` 0 or a zero or router recipient | Use `feeEntries()` |
| `FeeTooHigh(uint256)` | `0x7b931420` | Entries total more than 100 bps | Use `feeEntries()` |
| `InsufficientGas()` | `0x1c26714c` | The limit could not cover a fee payment's budget | Send `estimate * 1.25` |
| `EthTransferFailed(address)` | `0x09b62ba1` | Your recipient refused ETH (sale proceeds or a buy refund) | Use a recipient that accepts ETH |
| `AmountTooLarge()` | `0x06250401` | Amount above `int128` | Trade less |
| `UnexpectedDelta()` | `0x29a70758` | The router's PoolManager books did not close | Report it; do not retry blindly |
| `FirstBuyTooSmall()` | `0xae0f6505` | Hook: the first buy of an empty index puts less than 0.0005 ETH into the basket | Send at least 0.000511 ETH (1% entry, `feeBps` 100) |
| `ExactOutputNotSupported()` | `0x21b865b3` | Hook: an exact-output swap (only through a hand-built call) | Use the router (exact input) |
| `PartialFill()` | `0xd964f528` | Hook: a constituent's pool could not fill its leg | Trade less; read the index's routes on b420.io |
| `ZeroShares()` | `0x9811e0c7` | Index token: the trade mints or burns zero shares (dust) | Trade a larger amount |
| `Empty()` | `0x3db2a12a` | Index token: a constituent leg returned nothing | Trade a larger amount, or do not trade |
| `ERC20InsufficientAllowance(address,uint256,uint256)` | `0xfb8f41b2` | Sell without enough allowance to the router | `index.approve(router, shares)` first |
| `ERC20InsufficientBalance(address,uint256,uint256)` | `0xe450d38c` | Selling more shares than you hold | Sell at most the balance |
| `UnexpectedRevertBytes(bytes)` | `0x6190b2b0` | A quote reverted inside the hook | Act on the inner error |

Simulated on Base mainnet, 2026-10-05, as expected reverts: `minShares` above the output
(`TooLittleReceived`), a classic launch passed as the index (`NotIndex`), and a sale with no
allowance (`ERC20InsufficientAllowance(router, 0, amount)`).

## What this is NOT

- Not index creation: closed to agents.
- Not `mintInKind` / `redeemInKind` (deposit or withdraw the basket tokens themselves, 1% fee):
  they exist on the index token and are not covered here.
- Not claiming index dividends or ledger ETH: [`../../claim/SKILL.md`](../../claim/SKILL.md).
- Not the Universal Router, Permit2 or an aggregator: closed for index tokens (aggregators have no
  route for them anyway).

## Related skills

- [`../SKILL.md`](../SKILL.md): trade router; path picker, approvals, slippage defaults
- [`../../claim/SKILL.md`](../../claim/SKILL.md): index dividends (`claimDividend`) and ledger claims
- [`../../keeper/SKILL.md`](../../keeper/SKILL.md): flush the index hook, pay every holder (`claimDividendFor`)
- [`../../market-data/SKILL.md`](../../market-data/SKILL.md): `/api/indexes`, `/api/index/<address>` NAV, basket and holders

## License

CC0.
