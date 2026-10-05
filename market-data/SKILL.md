---
name: b420-market-data
version: 1.0.0
description: Read B420 market and portfolio data as an AI agent with no auth (GET https://b420.io/api/...); token lists and prices, tokenized stocks, launches, index NAV, holder-rewards stats and staking APR, buybacks, OHLC and trades by pool, holders, leaderboard, profiles, and a wallet portfolio with staked balances and claimable rewards. Canonical home of the public read catalog, cache hints and the list of app-internal endpoints agents cannot use. Use the chain, not the API, for any number a transaction depends on. Trading is trade/, claiming is claim/.
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
staking_b420: 0xC411bA66d1819054f67cDE26424cd876DB703E79
staking_b69: 0x82E6b3CEE079432F31D64855ed3DD5faCA71d309
---

# B420 Market Data: Skill for AI Agents

Everything b420.io shows is readable by an agent with a plain **`GET https://b420.io/api/...`, no
key, no login, JSON out**: the screener, tokenized stocks, launches, holder-rewards tokens, index
NAV, staking APR, buybacks, the Strategic Reserve, holders, candles, trades, profiles, the
leaderboard and a wallet portfolio. All of it is about **Base (chainId 8453)**.

This file is the single catalog of those endpoints: what each returns (top-level fields, read from
live answers on 2026-10-05) and how long the edge caches it. Write-prep endpoints (swap and
launch prepares) are documented in their leaves; the endpoints that need a b420.io login are
listed at the end so you know to leave them alone.

> **Read first:** signer modes, money rules, fee policy and the address book live in the
> [root router](../SKILL.md).

> **Numbers you act on come from the chain.** API answers are cached snapshots from indexers and
> GeckoTerminal. Quotes come from the trade leaves (Quoter or POST /api/swap, right before
> sending); balances, allowances and claimable amounts come from `eth_call`.

> **Rate limits.** Each route has an edge cache window (the Cache column). Polling faster returns
> the same body; poll at most once per window and prefer one list endpoint over many detail calls.

## Agent rules

1. **Use the API for discovery, the chain for amounts.** API values can be up to 300 s old and come
   from indexers. A transaction built on a stale API number fails onchain with
   `TooLittleReceived(received, minimum)` or the B20 error
   `InsufficientBalance(account, balance, needed)`; the trade and claim leaves read the chain right
   before sending.
2. **Never poll faster than the cache window.** The edge serves the same body for the whole window
   (Cache column); faster polling only spends your budget. `/api/portfolio/<wallet>?fresh=1`
   bypasses the cache once, right after your own trade or claim.
3. **Privy endpoints are not for agents.** They need a b420.io login session and answer
   `401 {"error":"missing token"}` without one. Do not try to obtain or replay a session.
4. **APR is variable.** `pools[].apr.pct` in `/api/rewards/stats` is a trailing figure
   (`basis: "30d"`) from rewards actually paid. Report it as "about X% over the last 30 days",
   never as a fixed or promised rate.
5. **API addresses are lowercase.** Checksum with viem `getAddress` before comparing or printing.

## Endpoint catalog

Base URL `https://b420.io/api`. Every endpoint below is a GET that answered `200` without auth on
2026-10-05. Cache is the edge window (`s-maxage`) set by the route; the response header you see
shows only `public` (or `no-store`). Amount fields ending in `Raw` or `Wei` are base-unit decimal
strings; `units`, `priceUsd`, `valueUsd` and similar are JSON numbers for display.

### Markets

| Endpoint | Returns (top-level fields) | Cache |
|---|---|---|
| `/api/tokens` | `tokens[]` (address, symbol, name, priceUsd, change5m, change1h, change6h, change24h, vol1h, vol24h, liqUsd, mcap, buys24, sells24, buyers24, sellers24, pairAddress, dexId, variant, stock, logo, pairedStock, pairedMeme, pairedAddr, wrapped, spark), `source`, `cached`: the screener | 20 s |
| `/api/b20s?q=&limit=` | `success`, `tokens[]` (address, variant, name, symbol, block), `total`, `progress` (scan of every B20 on Base); limit default 3000, max 5000 | 15 s |
| `/api/stocks` | `stocks[]` (address, symbol, decimals, usdcPool), `count`, `updatedAt`: the 10 registry stocks | 300 s |
| `/api/cbstocks` | `assets[]` (address, symbol, ticker, name, liqUsd, logo), `count`, `decimals` (8), `minLiqUsd`, `updatedAt`: Coinbase wrapped stocks with liquidity | 300 s |
| `/api/st0x` | `assets[]` (address, symbol, ticker, name, liqUsd, logo), `count`, `minLiqUsd`, `updatedAt`: ST0x tokenized stocks | 300 s |
| `/api/launch-stocks` | `assets[]` (address, symbol, ticker, name, issuer, issuerLabel, decimals, liqUsd, logo), `count`, `minLiqUsd`, `updatedAt`: stocks a launch can pair with | 300 s |
| `/api/launches?limit=&creator=` | Array of launch rows: token, creator, tokenAdmin, name, symbol, image, pairedToken, pairedSymbol, supply, startingTick, poolId, locker, dividendVault, dividendBps, block, txHash, launchedAt, curve, curvePhase, graduationThreshold, curveRaised, rewards (`holdersBps`), creatorProfile; limit default 50, max 200 | 30 s |
| `/api/stats` | `success`, `launches` (count) | 60 s |
| `/api/verified` | `tokens[]` (addresses with the verified badge) | 60 s |
| `/api/szn?wallet=` | `config` (season rules, allocation, dates), `board[]` (rank, wallet, points, profile), `total`, `you` (with `wallet`: rank, points, wallets, categories): the airdrop season | 60 s |
| `/api/dex`, `/api/dex/latest-block`, `/api/dex/asset?id=`, `/api/dex/pair?id=`, `/api/dex/events?fromBlock=&toBlock=` | The GeckoTerminal / DEX Screener adapter for the index pools: `name`, `chainId`, `endpoints`, `conventions`, `contracts`, `pairs[]`; `block` (blockNumber, blockTimestamp); `asset`; `pair`; `events[]` | 300 s, 1 s, 60 s, 86400 s, 86400 s |

### A token

| Endpoint | Returns (top-level fields) | Cache |
|---|---|---|
| `/api/token/[address]` | `success`, `info` (priceUsd, change*, vol24h, liqUsd, mcap, fdv, pairAddress, dexId, quoteSymbol, stock, tx, vol, holders, description, websites, socials), `gtPool`, `curve`, `curvePhase`, `totalSupply`, `totalSupplyRaw`, `decimals`, `supplySource`, `launch` (the launch row, or null), `b420`, `creator`, `deployedAt`; plus `rewards` on a holder-rewards token or `index` on an index (see [below](#which-market-is-a-token-on)); `400 unknown token` for a non-token | 10 s |
| `/api/token/[address]/holders?limit=&sort=` | Array: profile, amount, decimals, valueUsd, unrealizedUsd, realizedUsd, costRemainingUsd, thesis, unknownBasisAmount, firstBuyAt, lastTradeAt, tradeCount, avgCostUsd, avgEntryMcap; `sort` = value, pnl, entry or recent; limit default 100, max 200; no wallet addresses | 20 s |
| `/api/token/[address]/links` | `success`, `found`, `creator`, `links`, `effective` (image, website, twitter, telegram, discord), `overridden`, `logo`, `linksUpdatedAt` (writes need a login) | none |
| `/api/token/[address]/social-trades?limit=&side=` | `success`, `trades[]`, `closedCount`; limit default 40, max 100 | 20 s |
| `/api/token/[address]/theses?limit=` | Array of public theses (writes need a login) | 20 s |
| `/api/security/[address]` | `success`, `security` (adminStatus, freezable, policyBound, boundScopes, paused, totalSupply, supplyCap, roles), `memos` | none |
| `/api/ohlc/[pool]?tf=&limit=&before=` | `candles` (`[timeMs, open, high, low, close, volumeUsd]`), `venue`, `tf`, `limit`, `before`, `oldest`, `newest`, `hasMore`, `source`; `pool` is the token's `gtPool`; tf 1m, 5m, 15m, 1h, 4h, 1D (default 5m); limit default 200, max 1000; `before` in unix seconds | 15 s (600 s with `before`) |
| `/api/trades/[pool]` | `trades[]` (ts, kind, priceUsd, amountToken, volumeUsd, tx, wallet); GeckoTerminal upstream, answers `502 {"trades":[]}` while it is down | 8 s |
| `/api/prices?items=addr:pool,...` | `success`, `prices` (address to priceUsd, change24h); up to 30 `token:gtPool` pairs; `success:false` with empty `prices` when the upstream fails | 5 s |
| `/api/quote-price?address=` | `success`, `usd`: USD price of a quote asset (GeckoTerminal, DexScreener fallback) | 30 s |
| `/api/position/[wallet]/[token]` | `user`, `position` (units, avgCostUsd, investedUsd, unknownBasisUnits, currentValueUsd, realizedUsd), `trades[]`, `thesis`, `private` | 20 s |

### Holder rewards and staking

| Endpoint | Returns (top-level fields) | Cache |
|---|---|---|
| `/api/rewards` | `live`, `pools[]` (address, stakingToken, totalStaked, rewardTokens), `collectors[]` (version, address, current, weth, eth, lastFundAt, permissionless, keeperOnly, params, pending), `collector` (the current one) | 30 s |
| `/api/rewards/stats` | `success`, `ready`, `cursorBlock`, `startBlock`, `pending[]`, `ledgerTokens`, `ledgerStaking`, `collectors`, `v2`, `history[]`, `pools[]` (pool, stakingToken, stakedUsd, `apr` {pct, windowDays, basis, reason}, totalStaked, stakerCount, stakers[], rewards[]) | 60 s |
| `/api/rewards-launch/[address]` | `enabled`, `launch` (token, paired, poolId, poolKey, tokenIs0, launchBlock, tradingFromBlock, reserves, creator, holdersBps, holders, slots, contracts), `updatedAt` | 15 s |
| `/api/rewards-launch/[address]/holders` | `holders[]` (wallet, raw, pct), `count`, `top10Pct`, `supplyRaw`, `complete`, `syncing`; with `?wallets=1`: `wallets[]`, `formerCount`, `owed[]`, `owedTotalRaw`, `undistributedRaw`, `pendingRaw`, `eligibleSupplyRaw` | 15 s |
| `/api/rewards-launch/[address]/ohlc?tf=` | Same candle shape as `/api/ohlc`, plus `syncing` | 10 s (1m) to 300 s (1D) |
| `/api/rewards-launch/[address]/trades?limit=` | `trades[]` (ts, kind, priceUsd, amountToken, volumeUsd, tx, wallet, spotUsd), `venue`, `syncing` | 5 s |
| `/api/buybacks` | `success`, `builtAt`, `headBlock`, `scan`, `prices`, `totals`, `sources[]`, `recent[]`, `indexPot`, `indexVolume[]`, `collectors[]` (nextBuy, wethWaiting, minWethForFund, belowMinimum, readyAt, lastFundAt) | 20 s |
| `/api/reserve` | `address`, `totalUsd`, `holdings[]` (symbol, address, kind, balance, priceUsd, usd), `b420`, `b69` (balance, pctOfSupply), `updatedAt`: the Strategic Reserve | 60 s |
| `/api/vault/[address]/stats` | Legacy dividend vault (closed to new stakes): `success`, `ready`, `vault`, `token`, `cooldownSeconds`, `staking`, `reward`, `totalStaked`, `stakedUsd`, `apr`, `stakerCount`, `stakers[]`, `received`, `distributed`, `claimed`, `unclaimed`, `pending`, `history`; `404` for an address that is not a vault | 60 s |

### Indexes

| Endpoint | Returns (top-level fields) | Cache |
|---|---|---|
| `/api/indexes` | `enabled`, `indexes[]` (address, name, symbol, creator, tokens, weightsBps, balances, outstanding, outstandingShares, navUsd, navPerShareUsd, holdersBps, createdAt, feeBps, poolId, empty, unpriced, constituents, activity, change), `count`, `updatedAt` | 300 s |
| `/api/index/[address]` | `enabled`, `index` (the fields above plus feeSplit, poolKey, routes, routeLabels, creationTx), `updatedAt` | 300 s |
| `/api/index/[address]/holders` | `holders[]` (wallet, balance, shares, pct, valueUsd, isCreator, profile), `count`, `top10Pct`, `outstanding`, `outstandingShares`, `navPerShareUsd`, `complete`, `syncing`; with `?wallets=1`: `wallets[]`, `formerCount`, `owed[]` (wallet, wei), `owedTotalWei`, `undistributedWei`, `eligibleSupplyRaw` | 15 s |
| `/api/index/[address]/ohlc?tf=` | NAV candles, same shape as `/api/ohlc` | 10 s (1m) to 300 s (1D) |
| `/api/index/[address]/trades?limit=` | `trades[]` (ts, kind, priceUsd, amountToken, volumeUsd, tx, wallet), `venue` | 5 s |
| `/api/index/routes?token=&stack=` | `token`, `symbol`, `name`, `decimals`, `priceUsd`, `logo`, `best`, `candidates[]`, `rejected[]`, `complete`: the constituent route finder of index creation, which is closed; informational only | 120 s |

### Classic launch extras

| Endpoint | Returns (top-level fields) | Cache |
|---|---|---|
| `/api/distributors` | `success`, `rows[]` (token, address, paired, optInBlock, holderCount, lastRootAt, symbol, name, image, imageOverride, paidUsd) | 60 s |
| `/api/distributor/[token]` | `success`, `found`, `address`, `pending`, `optedIn`, `routedAtLaunch`, `predicted`, `creator`, `locker`, `paired`, `holderCount`, `lastEpoch`, `lastRootAt`, `currencies[]`, `ledger`, `roots[]` | 60 s |
| `/api/distributor/[token]/claim/[address]` | `success`, `leaves[]` (one holder's proofs; used by [`../claim/SKILL.md`](../claim/SKILL.md)) | 30 s |
| `/api/distributor/[token]/claim/all?offset=` | `success`, `entries[]` (currency, account, cumulativeAmount, proof), `more`, `nextOffset`, `epoch` (used by [`../keeper/SKILL.md`](../keeper/SKILL.md)) | 30 s |
| `/api/airdrop/[token]?account=` | `success`, `found`; when found, the airdrop shape (root, total, recipients, lockup, vesting) and, with `account`, that wallet's allocation and merkle proof (used by [`../claim/SKILL.md`](../claim/SKILL.md)) | 60 s |

### Wallets and people

| Endpoint | Returns (top-level fields) | Cache |
|---|---|---|
| `/api/portfolio/[address]?fresh=1` | `success`, `degraded`, `eth`, `holdings[]`, `totalUsd`, `history24h`, `claimable[]` ([section below](#a-wallet-portfolio)) | 20 s; none when degraded or `fresh=1` |
| `/api/portfolio/[address]/activity` | `success`, `events[]` (hash, ts, kind, legs, valueUsd), `pnl` (per token: symbol, realizedUsd, costRemainingUsd, unitsRemaining, unknownBasisUnits, boughtUsd, soldUsd, approx) | 60 s |
| `/api/profile/[usernameOr0x]` | `profile` (username, displayName, avatarUrl, bio, twitterHandle, twitterVerified, primaryWallet, createdAt), `claimed`, `address`, `wallets[]`, `positionsPublic`, `positions[]`, `pnl` (all, d30, d7, d1), `stats`, `social`, `launches[]`, `activity[]`, `history[]`, `closed[]`, `theses[]`; `404` for an unknown username | 15 s |
| `/api/profile/[username]/follows?dir=` | Array: username, displayName, avatarUrl, twitterVerified (`dir=followers` for the other direction) | 15 s |
| `/api/profile/search?q=` | Array: username, displayName, avatarUrl, twitterHandle, twitterVerified | 10 s |
| `/api/leaderboard?window=&limit=&offset=` | Array: rank, profile, realizedUsd, unrealizedUsd, totalUsd, portfolioUsd; window = all (default), 30d, 7d or 24h; limit max 50 | 30 s |

### Not in this catalog

| Endpoint | Why |
|---|---|
| `/api/live` | Server-Sent Events hub for browsers; it re-broadcasts the cached routes above, so poll those instead |
| `/api/curve/[token]/ohlc`, `/api/curve/[token]/trades` | Curve launches are closed and no token is on a curve ([root gates](../SKILL.md#never-do-canonical-gates)) |
| `/api/og/*` | Share images (PNG), not data |
| `/api/bridge/quote`, `/api/stripe-onramp` | Card onramp helpers of the site (ETH mainnet to Base, Stripe), not B420 actions |
| `/api/pin-image` | The site launch form's image pinning; launch leaves take an image URL |
| `/api/airdrop/snapshot/[id]` | Status of a holder snapshot that only a logged-in creator can start |

## A wallet portfolio

`GET /api/portfolio/<wallet>` values every B20, rewards token and index the wallet holds:

| Field | Meaning |
|---|---|
| `eth` | `{ units, priceUsd, value }` for native ETH |
| `holdings[]` | address, symbol, name, decimals, `units` (wallet plus staked), `stakedUnits` (staked units the indexer counts, or a legacy vault stake), priceUsd, change24h, `value` (USD), logo, `stock`, variant, pairedStock, pairedMeme, `kind` (`token` or `index`); index rows add constituents, `dividendEth`, `dividendUsd`, avgCostUsd, investedUsd, realizedUsd, unrealizedUsd; rewards-token and index rows add `rewards` |
| `holdings[].rewards` | `{ asset, symbol, decimals, unclaimed, claimed, unclaimedUsd }`: dividends claimable now (`asset` 0x0 = native ETH); not part of `value` or `totalUsd` |
| `totalUsd` | ETH plus holdings (staked units included, claimable rewards excluded) |
| `history24h` | 25 points: the portfolio at each of the last 24 hourly closes, then now |
| `claimable[]` | `{ address, symbol, logo, kind, rewards }` for rewards tokens and indexes the wallet no longer holds but can still claim on |
| `degraded` | `true` when a data source failed: either the holdings union came back empty while a source errored (data unavailable, not an empty wallet) or ETH could not be priced. Retry with `?fresh=1` after a few seconds; never conclude "empty wallet" from a degraded answer |

The API does not list staking rewards, creator fees, ledger slots, distributor or airdrop claims;
those are onchain reads in [`../staking/SKILL.md`](../staking/SKILL.md) and
[`../claim/SKILL.md`](../claim/SKILL.md).

[`examples/portfolio.mjs`](examples/portfolio.mjs) prints the whole picture in one command:

```bash
npm ci                                                 # once, at the repo root
node market-data/examples/portfolio.mjs 0xYourWallet
node market-data/examples/portfolio.mjs <username>     # a b420.io username
node market-data/examples/portfolio.mjs 0xYourWallet --json
```

1. **Resolve the wallet.** An address is used as is; a username goes through
   `GET /api/profile/<username>` (`profile.primaryWallet`, other `wallets[]` are listed).
2. **API portfolio.** `GET /api/portfolio/<wallet>` (with `--fresh`, `?fresh=1`).
3. **Staking positions from the chain.** One multicall on StakingB420
   `0xC411bA66d1819054f67cDE26424cd876DB703E79` and StakingB69
   `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309`: `stakedBalance`, `unbondingAmount`,
   `unbondingUnlockAt`, `rewardTokens()`, then `earned(account, token)` for each reward token,
   with symbol and decimals.
4. **Report.** ETH, holdings sorted by value, staked and unbonding with the unlock time, then a
   claimable summary (staking rewards, dividends on held tokens, dividends on tokens no longer
   held) and the command that scans every other claim:
   `node claim/examples/claim.mjs <wallet> scan` ([`../claim/SKILL.md`](../claim/SKILL.md)).

```ts
const STAKING_ABI = parseAbi([
  "function stakingToken() view returns (address)",
  "function stakedBalance(address account) view returns (uint256)",
  "function unbondingAmount(address account) view returns (uint256)",
  "function unbondingUnlockAt(address account) view returns (uint256)",
  "function rewardTokens() view returns (address[])",
  "function earned(address account, address token) view returns (uint256)",
]);
```

Ran on Base mainnet, 2026-10-05: a StakingB420 staker (0.2 B420 staked, four stocks earned), a
rewards-token creator (an index dividend in ETH claimable) and a fresh empty wallet (API answered
`degraded: true`, onchain positions zero); all three printed cleanly. Read-only, no gas.

## Which market is a token on

`GET /api/token/<address>` says which kind of market a token trades on:

| The answer has | The token is | Trade it with |
|---|---|---|
| `index` (non-null) | A B420 index; `gtPool` is null, `info.priceUsd` is NAV per share | [`../trade/index/SKILL.md`](../trade/index/SKILL.md) |
| `rewards` (non-null) | A holder-rewards token; `rewards.poolKey`, `rewards.paired`, `rewards.tradingFromBlock` | [`../trade/rewards-token/SKILL.md`](../trade/rewards-token/SKILL.md) |
| `launch` with `locker` set | A classic B420 launch; `launch.pairedToken` is the quote (WETH or another token) | [`../trade/classic/SKILL.md`](../trade/classic/SKILL.md) |
| `curve` (non-null) | A curve launch: closed, none exist today | nothing ([root gates](../SKILL.md#never-do-canonical-gates)) |
| `launch` null | Not launched on B420: B420, B69, tokenized stocks (`info.stock`), other B20s | [`../trade/aggregator/SKILL.md`](../trade/aggregator/SKILL.md) |

`gtPool` is the GeckoTerminal pool id that `/api/ohlc/[pool]`, `/api/trades/[pool]` and
`/api/prices` take. The authoritative picker reads the chain (`isIndex`, `isRewardsToken`, the LP
locker's `tokenRewards`) and lives in [`../trade/SKILL.md`](../trade/SKILL.md).

## Write-prep endpoints (documented in their leaf)

| Endpoint | Leaf |
|---|---|
| `POST /api/swap` | [`../trade/aggregator/SKILL.md`](../trade/aggregator/SKILL.md) |
| `POST /api/launch` | [`../launch/classic/SKILL.md`](../launch/classic/SKILL.md) |
| `POST /api/launch/rewards` | [`../launch/rewards/SKILL.md`](../launch/rewards/SKILL.md) |
| `POST /api/launch/confirm` | [`../launch/SKILL.md`](../launch/SKILL.md) |
| `GET /api/launch` (status, name check), `GET /api/launch/rewards?name=&symbol=` | [`../launch/SKILL.md`](../launch/SKILL.md) |

## App-internal endpoints (Privy login, not usable by agents)

These need a b420.io login session (a Privy access token) and answer `401` without one. They back
the site's own UI; no skill uses them.

| Endpoint | What it does on the site |
|---|---|
| `POST /api/swap-event` | Records a swap made in the browser |
| `POST /api/profile`, `/api/profile/alerts`, `/api/profile/email`, `/api/profile/follow`; `GET /api/profile/me` | Profile edits, alert switches, email, follows, the logged-in profile |
| `POST /api/thesis`, `/api/thesis/like` | Writing and liking theses |
| `POST /api/referral` | Binding a referral |
| `POST /api/distributor/[token]/enable` | Opting a launch into a holder distributor |
| `POST /api/push/subscribe` | Web push subscription |
| `POST /api/terms/accept` | Terms acceptance |
| `GET`, `POST /api/notifications` | The notification inbox |
| `POST /api/airdrop/snapshot` | Starting a holder snapshot for a launch airdrop |
| `POST`, `PATCH /api/token/[address]/links` | Editing a token's image and links |
| `POST /api/verified` | Granting the verified badge (admin) |

## Errors you might hit

| Code | Means | What to do |
|---|---|---|
| `400` | Bad input: not an address, `unknown token`, a missing parameter | Fix the path or query; addresses are 0x plus 40 hex characters |
| `401` | A Privy-only endpoint (`{"error":"missing token"}`) | Not for agents; use the public endpoints above |
| `404` | Unknown username, a vault or snapshot that does not exist | Check the identifier; an unknown wallet address answers `200` with empty data, not `404` |
| `429` | Too many requests (rate limits on the POST prepare routes) | Wait and retry once after the cache window; never loop |
| `502` | The upstream (GeckoTerminal, the chain) did not answer; `/api/trades` returns `{"trades":[]}` | Retry after the cache window; for amounts read the chain instead |
| `503` | A backing service is unavailable (`no database`, `staking not configured`, `buybacks unavailable`) | Retry later; read the same facts onchain if you need them now |

## What this is NOT

- Not a source of executable quotes: prices here are display values. Trade quotes come from
  [`../trade/SKILL.md`](../trade/SKILL.md) (Quoter, POST /api/swap) right before sending.
- Not a claim tool: it shows what is claimable on rewards tokens and indexes; every claim call is
  in [`../claim/SKILL.md`](../claim/SKILL.md).
- Not a way to edit profiles, theses or token links: those need a b420.io login.
- Not a guarantee: APR, dividends and holder counts are trailing, cached figures.

## Related skills

- [`../SKILL.md`](../SKILL.md): root router, address book, money rules
- [`../trade/SKILL.md`](../trade/SKILL.md): trade any token, path picker
- [`../staking/SKILL.md`](../staking/SKILL.md): stake, unstake, claim staking rewards
- [`../claim/SKILL.md`](../claim/SKILL.md): every claim for one wallet
- [`../launch/SKILL.md`](../launch/SKILL.md): launch status and name check

## License

CC0.
