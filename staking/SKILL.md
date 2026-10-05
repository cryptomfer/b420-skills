---
name: b420-staking
version: 1.0.0
description: "Stake B420 to earn tokenized stocks (the 10 registry stocks such as NVDAc, AAPLc, TSLAc) or stake B69 to earn B420, as an AI agent, on Base. Covers stake, requestUnstake (48h unbonding; a new request restarts the clock for the whole unbonding balance), withdraw, cancelUnstake, exit, getReward for all or one reward token, the position reads (earned(account, token)), the pool addresses, every revert, and the exit-only path for legacy dividend vault stakers. Rewards come from B420 platform fees routed by the FeeCollectors; APR is variable. AGENT RULES: READ EARNED FOR EVERY REWARD TOKEN, UNSTAKE IN ONE REQUEST, APPROVE THE EXACT AMOUNT, NEVER STAKE INTO A DIVIDEND VAULT. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers. Buying B420 or B69 is trade/aggregator/; the FeeCollector runs are keeper/."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
staking_b420: 0xC411bA66d1819054f67cDE26424cd876DB703E79
staking_b69: 0x82E6b3CEE079432F31D64855ed3DD5faCA71d309
b420_token: 0xB200000000000000000000231d6C1F1CE455ba32
b69_token: 0xB2000000000000000000007594Fe5aCD56DF3937
---

# B420 Staking: Skill for AI Agents

Two staking pools run on **Base (chainId 8453)**, both `B420MultiStaking` with the same ABI:
**stake B420 and earn the registry tokenized stocks, or stake B69 and earn B420.** Rewards are
bought with B420 platform fees and pushed into the pools; each one **folds into the pool the
moment it arrives (no emission schedule) and stays claimable at any time**, while unstaking
goes through a 48-hour unbonding. There is no receipt token and no auto-compounding.

Every action is a transaction your own wallet signs. The pools' owner can never move staked
principal or the rewards of a registered reward token; `withdraw()` pays `msg.sender` only.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../SKILL.md).

> **APR is variable.** It follows platform volume divided by the amount staked; never present
> a live rate as fixed or promised. The site's 30-day figure is in `GET /api/rewards/stats`
> ([`../market-data/SKILL.md`](../market-data/SKILL.md)).

> **Buying B420 or B69 first?** Swap through [`../trade/aggregator/SKILL.md`](../trade/aggregator/SKILL.md),
> then come back here. Staking carries no fee of its own.

## The two pools

| Pool | You stake | You earn | Address | Unbonding |
|---|---|---|---|---|
| StakingB420 | B420 `0xB200000000000000000000231d6C1F1CE455ba32` (18 dec, supply 69) | The 10 registry stocks (8 dec), in `rewardTokens()` order: METAc, NVDAc, AAPLc, GOOGLc, AMZNc, MSFTc, SPCXc, TSLAc, MSTRc, SNDKc | `0xC411bA66d1819054f67cDE26424cd876DB703E79` | 172,800 s (48 h) |
| StakingB69 | B69 `0xB2000000000000000000007594Fe5aCD56DF3937` (18 dec, supply 420) | B420 (18 dec) | `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309` | 172,800 s (48 h) |

On 2026-10-05: 2.1425 B420 staked by 6 wallets (30-day APR about 9.5%) and 26.658 B69 staked
by 6 wallets (30-day APR about 0.15%). Both numbers move; read them live.

## Where the rewards come from

- **FeeCollector v2** `0x22F005aa2b90E06C642C7462388b9d212D6344d8` takes the protocol half of
  every classic launch since 2026-10-04, the stock leg of every rewards launch and, on pairs
  other than ETH and B420, their B420 leg.
  It splits each asset's income 40% to the Strategic Reserve (in kind), 30% B420 leg (bought
  into B420, pushed to StakingB69) and 30% stock leg (bought into registry stocks, pushed to
  StakingB420).
- **FeeCollector v1** `0xB9366B662b610F730a50408Db17E550d64F06F44` takes the protocol half of the
  earlier launches: its WETH converts 20% to ops, 25% into B420 (StakingB69) and 55% into
  stocks (StakingB420); B420 and registry stocks are forwarded in kind.
- **Rewards launches**: an ETH pair buys B420 with its B420 leg inside every swap and pushes it
  to StakingB69; a B420 pair sends its B420 leg to StakingB69 through the ledger's STAKING slot.

The collectors' conversions (`swapAndFund`) and in-kind pushes (`forward`) are permissionless
keeper calls: [`../keeper/SKILL.md`](../keeper/SKILL.md). A reward arriving while nobody is
staked parks and folds at the next stake action.

## Agent rules

1. **Read `earned(account, token)` for every `rewardTokens()` entry before saying nothing is
   earned.** StakingB420 pays ten tokens; one balance check, or a WETH check, misses the
   rest. The example prints all of them.
2. **Unstake everything you mean to in one `requestUnstake`.** Each request sets
   `unbondingUnlockAt = now + 172800` for the WHOLE unbonding balance, so a second request
   restarts the 48 h clock for what was already unbonding. `exit()` requests too.
3. **Withdraw only after `unbondingUnlockAt`, in chain time.** Before it, `withdraw()` reverts
   `CooldownNotElapsed()` (`0xa22b745e`); with nothing unbonding, `NothingUnbonding()`
   (`0x262b9d74`). Unbonding tokens earn nothing; rewards earned before stay claimable.
4. **No position read is needed to stake or claim.** The writes stand alone; reads are for
   display and for the guards above. The public RPC throttles bursts: batch reads through
   multicall.
5. **Approve the exact amount you stake,** on the staking token, to the pool. `stake` pulls it
   with `transferFrom`; a short allowance reverts with the B20 `InsufficientAllowance`
   (`0x192b9e4e`). B420 and B69 are B20 tokens: their approval takes the B20 gas rule of the
   [approvals table](../trade/SKILL.md#approvals-the-single-copy).
6. **No admin can move your stake.** Read in `B420MultiStaking.sol`: principal leaves only
   through `withdraw()`, paid to `msg.sender`; `rescueToken` refuses the staking token and
   every registered reward token; the manager (FeeCollector v1) can only register new reward
   tokens. One carve-out: a reward token the owner retires with `removeReward` becomes
   rescuable, while what each staker had snapshotted stays claimable with `getReward(token)`.
7. **Never stake into a dividend vault.** Vaults are closed; their stakers exit only
   (section "Legacy dividend vaults").

## 1. Stake

Two transactions, or one bundle to simulate: `approve(pool, amount)` on the staking token,
then `stake(amount)` on the pool. Earning starts in the same block.

```js
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const STAKING_ABI = parseAbi([
  "function stake(uint256 amount)",
  "function requestUnstake(uint256 amount)",
  "function withdraw()",
  "function cancelUnstake()",
  "function exit()",
  "function getReward()",
  "function getReward(address token)",
  "function earned(address account, address token) view returns (uint256)",
  "function rewardTokens() view returns (address[])",
  "function stakedBalance(address account) view returns (uint256)",
  "function unbondingAmount(address account) view returns (uint256)",
  "function unbondingUnlockAt(address account) view returns (uint256)",
  "function cooldownPeriod() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "error ZeroAmount()",
  "error InsufficientStake()",
  "error NothingUnbonding()",
  "error CooldownNotElapsed()",
]);
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

const STAKING_B420 = "0xC411bA66d1819054f67cDE26424cd876DB703E79";
const B420 = "0xB200000000000000000000231d6C1F1CE455ba32";
const account = privateKeyToAccount(process.env.PRIVATE_KEY);   // from env only, never printed
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const wallet = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });

const amount = parseUnits("0.5", 18);
const a = { address: B420, abi: ERC20_ABI, functionName: "approve", args: [STAKING_B420, amount], account };
let gas = 150_000n;
try { gas = ((await pub.estimateContractGas(a)) * 15n) / 10n; } catch {}
await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...a, gas }) });
await pub.simulateContract({ address: STAKING_B420, abi: STAKING_ABI, functionName: "stake", args: [amount], account });
await wallet.writeContract({ address: STAKING_B420, abi: STAKING_ABI, functionName: "stake", args: [amount] });
```

- Simulated on Base mainnet, 2026-10-05: approve 0.01 B420 + stake on StakingB420 as one bundle ok, gas 45,975 + 312,546.
- Simulated on Base mainnet, 2026-10-05: approve 0.01 B69 + stake on StakingB69 as one bundle ok, gas 45,975 + 118,575.

## 2. Claim rewards

This is the one place staking claims are documented; [`../claim/SKILL.md`](../claim/SKILL.md)
links here. No cooldown: claim any time, staked or unbonding.

| Call | Pays | When a reward token's transfer fails (paused, blocklisted stock) |
|---|---|---|
| `getReward()` | Every reward token with a non-zero `earned` | Skipped: `RewardSkipped(account, token)` is emitted, the amount stays claimable; the others pay |
| `getReward(address token)` | One token | Reverts, surfacing the failure. Also the recovery path for a retired reward token |

```js
await wallet.writeContract({ address: STAKING_B420, abi: STAKING_ABI, functionName: "getReward", args: [] });
await wallet.writeContract({ address: STAKING_B420, abi: STAKING_ABI, functionName: "getReward",
  args: ["0xb20000000000000000000078ee7ce2fE4908108C"] });   // NVDAc only
```

- Simulated on Base mainnet, 2026-10-05: `getReward()` on StakingB420 paying 4 stocks ok, gas 451,425.
- Simulated on Base mainnet, 2026-10-05: `getReward(NVDAc)` on StakingB420 ok, gas 117,449.
- Simulated on Base mainnet, 2026-10-05: `getReward()` on StakingB69 (B420) ok, gas 119,058.

## 3. Unstake

1. `requestUnstake(amount)`: the amount stops earning at once and unlocks 172,800 s later.
2. Wait until `unbondingUnlockAt(account)` (chain time).
3. `withdraw()`: the whole unbonding balance back to your wallet.

Changed your mind: `cancelUnstake()` puts the whole unbonding balance back to work and clears
the clock. Leaving: `exit()` = `getReward()` + `requestUnstake(everything staked)`, in one
transaction; you still wait, then `withdraw()`.

- Simulated on Base mainnet, 2026-10-05: `requestUnstake` on StakingB420 ok, gas 350,558 (part) and 352,023 (all).
- Simulated on Base mainnet, 2026-10-05: `requestUnstake(all)` on StakingB69 ok, gas 131,461.
- Simulated on Base mainnet, 2026-10-05: `withdraw()` of an unlocked unbonding balance on StakingB69 ok, gas 81,806.
- Simulated on Base mainnet, 2026-10-05: `cancelUnstake()` on StakingB69 ok, gas 94,700; on StakingB420 after a request in the same bundle ok, gas 206,584.
- Simulated on Base mainnet, 2026-10-05: `exit()` on StakingB420 ok, gas 560,842; on StakingB69 ok, gas about 184,800 (`--print` limit 221,723).
- Simulated on Base mainnet, 2026-10-05: `withdraw()` right after a request reverts `CooldownNotElapsed()`; with nothing unbonding, `NothingUnbonding()`; `stake(0)` reverts `ZeroAmount()`; `requestUnstake` above the stake reverts `InsufficientStake()`.

```bash
node staking/examples/stake.mjs b420 --from 0xYou                     # position
node staking/examples/stake.mjs b420 stake 0.5 --from 0xYou           # simulate approve + stake
PRIVATE_KEY=0x… node staking/examples/stake.mjs b69 unstake all --send
node staking/examples/stake.mjs b420 withdraw --from 0xYou             # refused with the unlock time if early
node staking/examples/stake.mjs b420 claim --token 0xb20000000000000000000078ee7ce2fE4908108C --from 0xYou --print
```

## Read a position

```js
const me = account.address;
const tokens = await pub.readContract({ address: STAKING_B420, abi: STAKING_ABI, functionName: "rewardTokens" });
const r = await pub.multicall({
  allowFailure: false,
  contracts: [
    { address: STAKING_B420, abi: STAKING_ABI, functionName: "stakedBalance", args: [me] },
    { address: STAKING_B420, abi: STAKING_ABI, functionName: "unbondingAmount", args: [me] },
    { address: STAKING_B420, abi: STAKING_ABI, functionName: "unbondingUnlockAt", args: [me] },
    ...tokens.map((t) => ({ address: STAKING_B420, abi: STAKING_ABI, functionName: "earned", args: [me, t] })),
  ],
});
const [staked, unbonding, unlockAt, ...earned] = r;   // earned[i] belongs to tokens[i] (stocks: 8 decimals)
```

The example's default action prints the same, with symbols, the wallet balance, the share of
the pool and whether the unbonding balance is withdrawable now. The site's portfolio view of
a wallet (staking included) is [`../market-data/SKILL.md`](../market-data/SKILL.md).

## Calls

| Function | Selector | Target | Notes |
|---|---|---|---|
| `approve(address spender, uint256 amount)` | `0x095ea7b3` | **stakingToken** (B420 or B69) | `spender` = the pool, the exact amount |
| `stake(uint256 amount)` | `0xa694fc3a` | pool | Needs the approval; `amount` > 0 |
| `requestUnstake(uint256 amount)` | `0x23095721` | pool | Stops earning now; restarts the clock for the whole unbonding balance |
| `withdraw()` | `0x3ccfd60b` | pool | All unbonding, to `msg.sender`, once unlocked |
| `cancelUnstake()` | `0x4ab17969` | pool | Re-stakes all unbonding, clears the clock |
| `exit()` | `0xe9fad8ee` | pool | `getReward()` then `requestUnstake(staked)` |
| `getReward()` | `0x3d18b912` | pool | Every reward token, skipping a failing one |
| `getReward(address token)` | `0xc00007b0` | pool | One reward token, reverts if its transfer fails |

Raw calldata for any signer: `cast calldata "stake(uint256)" 500000000000000000` (send to the
pool), or viem `encodeFunctionData({ abi: STAKING_ABI, functionName: "stake", args: [amount] })`.

## Views

| Function | Selector | Returns |
|---|---|---|
| `earned(address account, address token)` | `0x211dc32d` | Rewards of `token` claimable now (8 decimals for stocks, 18 for B420) |
| `rewardTokens()` | `0xc2b18aa0` | `address[]` of registered reward tokens (at most 10) |
| `stakedBalance(address account)` | `0x60217267` | Staked and earning |
| `unbondingAmount(address account)` | `0xa3779d9d` | Unbonding, not earning |
| `unbondingUnlockAt(address account)` | `0xde3c0ba4` | Unix seconds when `withdraw()` opens; 0 with nothing unbonding |
| `cooldownPeriod()` | `0x04646a49` | 172800 |
| `totalStaked()` | `0x817b1cd2` | Pool total staked |
| `totalUnbonding()` | `0x350fd0be` | Pool total unbonding |
| `stakingToken()` | `0x72f702f3` | B420 or B69 |
| `isRewardToken(address token)` | `0xb5fd73f8` | Registered reward token |

## Gas

Measured on Base mainnet on 2026-10-05 (simulation), with the limit the examples set
(estimate x 1.2; approvals by the [approvals table](../trade/SKILL.md#approvals-the-single-copy)):

| Call | StakingB420 (10 reward tokens) | StakingB69 (1 reward token) |
|---|---|---|
| `approve` (B20) | 45,975 (limit 68,963) | 45,975 (limit 68,963) |
| `stake` | 312,546 | 118,575 |
| `requestUnstake` | 350,558 to 352,023 | 131,461 |
| `getReward()` | 451,425 (4 stocks paid) | 119,058 |
| `getReward(token)` | 117,449 | n/a |
| `withdraw()` | about 82,000 (same path, no reward loop) | 81,806 |
| `cancelUnstake()` | 206,584 | 94,700 |
| `exit()` | 560,842 | about 184,800 |

StakingB420 loops every reward token in each stake action, so its numbers grow with the list
(capped at 10). Gas is paid in ETH; keep a little ETH on Base.

## Legacy dividend vaults (closed: exit only)

Dividend vaults were per-launch pools (stake the launched token, earn its paired tokenized
stock), made by the legacy vault factory `0xA0e85c7e3866c3bdC20CC2BEe78E04fdF214583A`, whose
`paused()` reads true. 11 vaults exist; on 2026-10-05 one holds a stake. A vault's `stake`
still works onchain, but the product is closed and its `PRECISION` of 1e18 parks small stock
amounts it can never fold, which is why creation was paused. **Never stake into a vault.**

- **Find a vault:** the `dividendVault` field of `GET https://b420.io/api/launches?creator=0x…`
  rows, or onchain `vaultFor(address meme)` and `allVaults()` on the vault factory.
- **Allowed calls** (same selectors as the pools): `requestUnstake(uint256)`, `withdraw()`,
  `cancelUnstake()`, `getReward()`. The vault's `getReward()` takes no token and is strict: it
  reverts `RewardTransferFailed()` (`0x78ecf410`) when the stock's transfer fails, nothing
  lost. `exit()` (claim, skipping a frozen stock, then unbond everything) is exit-only too.
- **Views:** `earned(address account)` (`0x008cc262`), `rewardClaimable(address account)`
  (`0xe8c33f63`, includes stock still waiting in the fee locker), `stakingToken()`,
  `rewardToken()`, `stakedBalance`, `unbondingAmount`, `unbondingUnlockAt`, `cooldownPeriod`
  (172800).

```js
const VAULT_ABI = parseAbi([
  "function requestUnstake(uint256 amount)",
  "function withdraw()",
  "function cancelUnstake()",
  "function getReward()",
  "function exit()",
  "function earned(address account) view returns (uint256)",
  "function rewardClaimable(address account) view returns (uint256)",
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function stakedBalance(address account) view returns (uint256)",
  "function unbondingAmount(address account) view returns (uint256)",
  "function unbondingUnlockAt(address account) view returns (uint256)",
  "error NothingUnbonding()",
  "error CooldownNotElapsed()",
  "error RewardTransferFailed()",
]);
```

- Simulated on Base mainnet, 2026-10-05: vault position read ok (the only staker holds the whole stake; `rewardClaimable` 0, the parked stock sits below the fold threshold).
- Simulated on Base mainnet, 2026-10-05: vault `requestUnstake(all)` from its staker ok, gas 142,183; `stake` and `exit` are refused by the example before any call.

```bash
node staking/examples/stake.mjs vault:0x297A304167F6dc057c300fabE58b772c6DB0d22d --from 0xYou
node staking/examples/stake.mjs vault:0x297A304167F6dc057c300fabE58b772c6DB0d22d unstake all --from 0xYou
```

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|------|---------|
| StakingB420: stake B420, earn the registry stocks | `0xC411bA66d1819054f67cDE26424cd876DB703E79` |
| StakingB69: stake B69, earn B420 | `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309` |
| B420 (staking token of StakingB420, reward of StakingB69; B20, 18 dec) | `0xB200000000000000000000231d6C1F1CE455ba32` |
| B69 (staking token of StakingB69; B20, 18 dec) | `0xB2000000000000000000007594Fe5aCD56DF3937` |
| B420StockRegistry (`allStocks()`: the reward stocks, 8 dec) | `0x5E4643c2F48c14e09f209CAe5A51455211e10c1E` |
| FeeCollector v2 (funds both pools) | `0x22F005aa2b90E06C642C7462388b9d212D6344d8` |
| FeeCollector v1 (funds both pools; the pools' `manager`) | `0xB9366B662b610F730a50408Db17E550d64F06F44` |
| protocolAdmin (owner of both pools) | `0xa1aB6Eb729c08B774798418b95D9C00D6Ec73527` |
| Legacy vault factory (paused; `vaultFor`, `allVaults`) | `0xA0e85c7e3866c3bdC20CC2BEe78E04fdF214583A` |

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `ZeroAmount()` | `0x1f2a2005` | `stake(0)` or `requestUnstake(0)` | Pass an amount above 0 |
| `InsufficientStake()` | `0xf1bc94d2` | `requestUnstake` above `stakedBalance` | Read `stakedBalance`, request at most that |
| `NothingUnbonding()` | `0x262b9d74` | `withdraw()` or `cancelUnstake()` with nothing unbonding | `requestUnstake` first |
| `CooldownNotElapsed()` | `0xa22b745e` | `withdraw()` before `unbondingUnlockAt` | Wait until that time, then withdraw |
| `InsufficientAllowance(address,uint256,uint256)` | `0x192b9e4e` | `stake` without an approval of the staking token (B20) | Approve the exact amount to the pool |
| `InsufficientBalance(address,uint256,uint256)` | `0xdb42144d` | Staking more than the wallet holds | Read the balance; buy first ([`../trade/aggregator/SKILL.md`](../trade/aggregator/SKILL.md)) |
| `NotRewardToken()` | `0x804543b5` | `notifyRewardAmount` or `donate` with a token that is not registered | Not an agent call: only funders notify |
| `RewardTransferFailed()` | `0x78ecf410` | Vault `getReward()` while its stock cannot transfer | Retry later; the reward stays accrued |
| A stock's own revert on `getReward(token)` | n/a | That stock is paused or blocklisted by its issuer | Use `getReward()`, which skips it; retry the token later |

## What this is NOT

- Not a dividend-vault deposit: vaults are closed; exit only.
- Not liquid staking: no receipt token, nothing to trade while staked or unbonding.
- Not rewards-token dividends: holding a holder-rewards token pays without staking
  ([`../claim/SKILL.md`](../claim/SKILL.md)).
- Not a fixed yield: rewards depend on platform volume; APR is variable.
- Not an owner path: `addReward`, `removeReward`, `setManager`, `rescueToken` are owner calls;
  never call them.

## Related skills

- [`../SKILL.md`](../SKILL.md): root router, signer modes, money rules, address book
- [`../trade/aggregator/SKILL.md`](../trade/aggregator/SKILL.md): buy B420 or B69 before staking
- [`../claim/SKILL.md`](../claim/SKILL.md): every other claim of a wallet, and wallet-wide discovery
- [`../keeper/SKILL.md`](../keeper/SKILL.md): FeeCollector `swapAndFund` and `forward`, which fund the pools
- [`../market-data/SKILL.md`](../market-data/SKILL.md): `/api/rewards/stats` (APR, stakers), portfolio

## License

CC0.
