# B420: Skills for AI Agents

This repo is the source of truth for how AI agents use [B420](https://b420.io), a DEX and
launchpad on **Base (chainId 8453)**: trade B20 tokens, tokenized stocks, B420 launches,
holder-rewards tokens and index tokens; launch a token; stake B420 or B69; claim every kind of
reward; read market and portfolio data; run the permissionless keeper calls. Each skill is a
focused `SKILL.md` an agent installs into its runtime, and every runnable example **simulates on
Base mainnet before anything is sent**. Your wallet signs every transaction; B420 never holds your
keys.

## Skills index

| Skill | What it does |
|---|---|
| [`./`](./SKILL.md) (`b420`) | **Router and foundations**: pick the intention, follow the leaf. Signer modes (private key, Bankr `/wallet/submit`, printed raw calldata for CDP, Safe and relayers), money rules, fee policy, closed products, the full address book, the shared example library. |
| [`market-data/`](./market-data) | Read everything b420.io shows with plain GETs and no auth: screener, tokenized stocks, launches, index NAV, holder-rewards stats, staking APR, buybacks, candles, trades, holders, profiles, leaderboard, and a wallet portfolio with staked balances and claimable rewards. |
| [`trade/`](./trade) | Buy or sell any token on B420: detects the market onchain (index, rewards token, classic launch, everything else) and routes to the leaf. Path picker, approvals, slippage and deadline defaults, the 2-block launch delay. |
| [`trade/aggregator/`](./trade/aggregator) | B420, B69, tokenized stocks (registry, Coinbase wrapped, ST0x) and other Base tokens with a market through `POST /api/swap`: one call returns the router, the calldata and a net `amountOut` (0x first, Kyber when 0x refuses a stock). |
| [`trade/classic/`](./trade/classic) | Tokens launched on the B420 Factory: WETH-paired pools through the Universal Router (Permit2 on sells), pools on any other quote through B420HopRouter (an aggregator leg plus the v4 pool, atomically). Pool key from the LP locker, quotes from the v4 Quoter. |
| [`trade/rewards-token/`](./trade/rewards-token) | Holder-rewards tokens through B420RewardsRouter: ETH pairs send value equal to `amountIn`, ERC-20 pairs (for example NVDAc) approve the router first; ETH-pair trades use gas = max(estimate + 400k, 1.4M). Holding the token earns dividends in the paired asset. |
| [`trade/index/`](./trade/index) | Index tokens (onchain baskets of up to 10 tokens, such as MEOW, COIN5 or OG) through B420IndexRouter: buy shares with ETH, sell for ETH, exact input only, quotes only from the v4 Quoter; first buy on an empty index at least 0.0005 ETH net. v3 and v4 stacks live. Holders earn ETH dividends. |
| [`launch/`](./launch) | Launch router: classic B20 vs holder-rewards token, the launch agent rules (one launch per name and ticker, prepare right before sending, send the exact value, never resend on a timeout without checking), the name check and `POST /api/launch/confirm`. |
| [`launch/classic/`](./launch/classic) | A classic B20 on B420 Factory v2: `POST /api/launch`, then one `deployToken` call. Custom supply, any quote with enough liquidity (WETH by default, B420 or a tokenized stock), creator fees in both assets or the quote only, optional dev buy, holder distributor, list-based airdrop, creator slice management. |
| [`launch/rewards/`](./launch/rewards) | A holder-rewards token: `POST /api/launch/rewards`, then one `B420RewardsFactory.launch` call. Holders share 1 to 10000 bps of the creator half as dividends in the paired asset; `raiseHoldersBps`, `transferCreator`. |
| [`staking/`](./staking) | Stake B420 to earn the 10 registry stocks, or B69 to earn B420: stake, request unstake (48h unbonding; a new request restarts the clock for the whole balance), withdraw, cancel, exit, claim all or one reward token, position reads; the exit-only path for legacy dividend vault stakers. APR is variable. |
| [`claim/`](./claim) | Find and claim every reward for a wallet: staking rewards (both pools, every reward token), rewards-token dividends (in the paired asset), rewards ledger creator slots, index ETH dividends and ledger balances, classic creator fees in the fee locker (both assets), holder-distributor merkle claims, airdrop allocations with lockup and vesting. |
| [`keeper/`](./keeper) | Permissionless maintenance anyone may run (the caller pays gas and receives nothing): FeeCollector v1 and v2 `forward` and `swapAndFund`, rewards and index hook flushes, LP locker `collectRewards`, distributor sync and `claimMany`, paying every holder of a rewards or index token with `claimDividendFor` in sized batches, ledger claims on behalf of the fixed recipients. |

## Install

### As an agent skill (Claude Code, Codex, Gemini CLI)

```bash
git clone https://github.com/cryptomfer/b420-skills.git ~/.claude/skills/b420
cd ~/.claude/skills/b420 && npm ci           # viem, for the example scripts
```

Or per project:

```bash
cd your-agent-project
mkdir -p .claude/skills && cd .claude/skills
git clone https://github.com/cryptomfer/b420-skills.git b420
cd b420 && npm ci
```

Your agent runtime discovers the skills on its next load. Each `SKILL.md` is an activation entry
point; the root [`SKILL.md`](./SKILL.md) routes to the rest.

### As reference docs

Every `SKILL.md` is plain Markdown with the endpoints, ABIs (viem `parseAbi`), addresses and revert
tables. Nothing in the API contracts is agent-specific: a human with the same wallet can make the
same calls.

## Prerequisites

1. **A wallet on Base with ETH for gas.** A viem private key, a [Bankr](https://bankr.bot) wallet
   (HTTP-only), Coinbase CDP, a Safe or any relayer. Bankr needs raw calldata enabled; the config
   gotchas are in the [root router](./SKILL.md#signer-modes-and-broadcasting-canonical).
2. **Node 18+** and `npm ci` at the repo root for the examples. The only dependency is
   [viem](https://viem.sh), pinned to an exact version; `package-lock.json` is committed and
   `npm ci` installs exactly that tree.
3. **Your own Base RPC** (recommended): set `RPC_URL`. Without it the examples use
   `https://mainnet.base.org` with a public fallback, which rate-limits bursts.

No API key and no account: b420.io reads are public, and every write is a transaction your wallet
signs.

## How you broadcast: always raw calldata

Every onchain action (trade, launch, stake, claim, keeper call) is **one raw transaction
`{ to, data, value, gas }` on chainId 8453** that your wallet signs and sends:

- **Always** send that raw transaction: viem `sendTransaction`, CDP `sendTransaction`, a Safe
  transaction, a relayer, or Bankr `POST https://api.bankr.bot/wallet/submit`.
- **Never** use a wallet-SDK convenience helper or a natural-language prompt ("buy 0.01 ETH of
  ..."): they rebuild the call and drop the exact value, the gas margin and the router arguments.
- **Launches are calls, not deployments**: the factory deploys the token, so any signer can send
  them.

Details, Bankr body and key handling: [root router](./SKILL.md#signer-modes-and-broadcasting-canonical).

## Example CLI

One shared helper, [`examples/lib/b420.mjs`](./examples/lib/b420.mjs), and one script per area:

```bash
npm ci                                        # once, at the repo root
node market-data/examples/portfolio.mjs <address|username> [--fresh] [--json]
node trade/examples/trade.mjs <token> [buy|sell] [amount|all] [--pay <token>] [--receive <token>] [--slippage <bps>] [--from 0x..] [--send|--print] [--json]
node launch/examples/launch-classic.mjs --name <n> --symbol <s> [--supply <whole>] [--paired <addr>] [--fee-in both|quote] [--dev-buy <eth>] [--share-with-holders] [--airdrop-list <file> --airdrop-bps <n> --lockup-days <n> --vesting-days <n>] [--image <url>] [--from 0x..] [--send|--print] [--json]
node launch/examples/launch-rewards.mjs --name <n> --symbol <s> --holders-bps <1..10000> [--supply <whole>] [--paired <addr>] [--dev-buy <amount>] [--creator 0x..] [--from 0x..] [--send|--print] [--json]
node staking/examples/stake.mjs <b420|b69|vault:0x..> [position|stake|unstake|withdraw|cancel|exit|claim] [amount|all] [--token <rewardToken>] [--from 0x..] [--send|--print] [--json]
node claim/examples/claim.mjs <wallet> [scan|all|staking|dividends|ledger|index|creator-fees|distributor|airdrop] [--token 0x..] [--from 0x..] [--send|--print] [--json]
node keeper/examples/keeper.mjs [status|fund|forward|flush|collect|sync|pay-holders|ledger] [target] [--collector v1|v2] [--slot 0..3] [--batch <n>] [--from 0x..] [--send|--print] [--json]
```

Every script follows the same contract:

| You pass | What happens |
|---|---|
| no action | Reads state only |
| an action | Simulates every step (approve then act, as one bundle) from your signer, or from `--from 0x...` with no key, and prints the exact calls |
| `--send` | Simulates the whole flow, then re-simulates each step right before broadcasting it; needs `PRIVATE_KEY`, or `BANKR_API_KEY` + `BANKR_WALLET` |
| `--print` | Simulates, then prints one raw transaction JSON line per step for CDP, Safe or relayers |
| `--json` | Machine-readable output |

Exit codes: `0` ok, `1` failure or a simulation revert, `2` usage error.

## Safety

- **Nothing is sent without `--send`.** Every action is simulated against Base mainnet first, and
  a revert prints the Solidity error name instead of sending.
- **Keys stay in the environment.** `PRIVATE_KEY` and `BANKR_API_KEY` are read from env only and
  never printed, logged or put in an error message; error output also redacts `RPC_URL`, which
  can carry a provider key. Use a dedicated agent wallet.
- **Pinned dependency.** The scripts sign transactions, so viem is pinned to the version they were
  verified with (2.57.3) and the lockfile is committed: install and update with `npm ci`.
- **Money rules apply to every write**: quote right before sending, simulate from the sending
  address, send the exact value, approve exact amounts, never resend after a timeout without
  checking the receipt. The full list is in the [root router](./SKILL.md#money-rules-canonical).
- **Closed products stay closed.** Curve launches, staking into legacy dividend vaults, index
  creation, admin functions and login-only endpoints are never offered
  ([list and onchain proof](./SKILL.md#never-do-canonical-gates)).
- **Costs.** Gas in ETH on Base. Trades carry the same frontend fee as b420.io
  ([fee policy](./SKILL.md#fees-canonical)); launches, staking and claims carry none.

## Public API base

```
https://b420.io/api
```

Every public GET endpoint, its fields and its cache window are in
[`market-data/SKILL.md`](./market-data/SKILL.md). The `@b420/sdk` package and the b420.io/docs page
predate factory v2 and the rewards and index stacks; these skills use the REST API plus viem
directly.

## Not covered

- Curve launches and curve trading (closed onchain: `launchEnabled()` is false).
- New stakes into legacy dividend vaults (vault factory paused; existing stakers can exit).
- Index creation (closed to the public).
- Distributor factory `create()`, any owner or admin function, and endpoints that need a b420.io
  login.
- Chains other than Base.

## Updates

```bash
cd ~/.claude/skills/b420   # or wherever you cloned
git pull --ff-only && npm ci
```

If you integrate B420 from an agent and something is missing or wrong, open an issue or a pull
request against the relevant `SKILL.md`.

## License

Skills are CC0. Copy, fork, embed, build commercial agents around them. No attribution required.
