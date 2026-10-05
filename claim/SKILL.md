---
name: b420-claim
version: 1.0.0
description: "Find and claim every kind of B420 reward for a wallet as an AI agent: staking rewards (both pools, every reward token), holder-rewards token dividends (paid in the paired asset), rewards ledger creator slots, index holder ETH dividends and index ledger balances, classic launch creator fees in the ClankerFeeLocker (both assets), classic holder-distributor merkle claims, and airdrop allocations with lockup and vesting. Canonical home of every claim call, its discovery read and who may send it. NEVER conclude nothing to claim from a single currency or a single source. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers. Staking calls are the b420-staking skill; paying every holder at once and the protocol's ledger slots are the b420-keeper skill."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
rewards_factory: 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
rewards_ledger: 0x8e95B431B70094B66836074B01c380A4935B7d49
index_factory_v3: 0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF
index_factory_v4: 0xD408a52ff4871097A89977Ca9fc48dF0D4243293
index_ledger_v3: 0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6
fee_locker: 0x20835181fD6F4e62AA8d630A89b0e5c8676808C6
lp_locker_v2: 0x351C934d698eB3c0683066D2fbD6CE7215573Bc4
distributor_factory: 0x049B3Ee15c41163458073072e9573BF0fb88D5d4
distributor_factory_previous: 0x6c8DB32e7b49743c56505718f6f5CBADd18705B6
airdrop_extension: 0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2
staking_b420: 0xC411bA66d1819054f67cDE26424cd876DB703E79
staking_b69: 0x82E6b3CEE079432F31D64855ed3DD5faCA71d309
---

# B420 Claims: Skill for AI Agents

One wallet, every source, one table. **Everything a wallet can claim on B420 sits in one of eight
places, and each place has one discovery read and one call.** This skill lists all eight, how to
find what is owed, who may send each claim and who gets paid. Every claim is a contract call on
**Base (chainId 8453)** that you send from your own wallet; nothing goes through B420's servers
except the reads that serve merkle proofs.

[`examples/claim.mjs`](./examples/claim.mjs) does the whole pass: `scan` prints every non-zero
claimable of a wallet across all eight sources and says which sources it read; `all` (or one kind)
builds one transaction per claim, simulates them on Base and sends them only with `--send`.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../SKILL.md).

> **Most claims pay a fixed recipient.** Who may send a claim and who is paid are separate
> questions. Only staking `getReward` and the tokens' own `claimDividend()` pay `msg.sender`;
> every other call names its recipient (or pays the slot's fixed one), so anyone may send it,
> pays the gas, and the funds still go to the owner. Claims carry no frontend fee.

> **Batch payouts to every holder are keeper work.** `claimDividendFor` over a whole holder list,
> `claimMany` over a distributor's leaves, and the rewards ledger's treasury, collector and
> staking slots are in [`../keeper/SKILL.md`](../keeper/SKILL.md). This skill claims for one wallet.

## Agent rules

1. **Scan every source, both currencies, every reward token.** A wallet's rewards are spread over
   two staking pools (11 reward tokens), every rewards token and the rewards ledger, every index
   and its ledger (ETH and shares), the fee locker (one balance per currency) and every
   distributor and airdrop. A zero in one place says nothing about the others: **NEVER conclude
   "nothing to claim" from one currency or one source.** `claim.mjs` prints the sources it read; a
   source it could not read, even in part (one distributor's claim list, one launch's airdrop),
   is printed `NOT SCANNED` with what failed, and the script exits 1. Claims found on the parts
   it did read are still listed.
2. **Read the claimable right before sending.** An empty claim reverts or burns gas:
   `claimFor` / `claim` revert `NothingToClaim()` (`0x969bf728`), the fee locker reverts
   `NoFeesToClaim()` (`0x846d8c5c`), the airdrop reverts `ZeroToClaim()` (`0x0001549d`), while
   `claimAllFor`, `claimDividend()` and `getReward()` succeed and pay nothing.
3. **Capture the figure before claiming.** Every claimable read returns 0 the moment the claim
   lands. If you report an amount, take it from the read (or the simulation's return value)
   before you send.
4. **Own-only claims are sent by the owner.** `getReward` and `claimDividend()` pay the caller's
   own balance; sent from another wallet they pay that wallet (usually nothing). To pay a wallet
   you do not control, use `claimDividendFor([wallet])` or the `...For` ledger calls.
5. **Merkle leaves come from the API and are checked onchain.** Distributor leaves
   (`GET /api/distributor/[token]/claim/[wallet]`) and airdrop leaves
   (`GET /api/airdrop/[token]?account=`) are stored by the B420 worker. Check the distributor
   address with `distributorFor(token)` on a distributor factory, and the amount with
   `claimed(currency, account)` or `amountAvailableToClaim(token, account, allocated)`, before
   sending. A stale or foreign leaf reverts `InvalidProof()` (`0x09bde339`).

## What can a wallet claim

| Reward | Discovery read | Call | Who may send | Paid to, in | Section |
|---|---|---|---|---|---|
| Staking rewards (StakingB420: 10 tokenized stocks; StakingB69: B420) | `earned(wallet, token)` for each `rewardTokens()` | `getReward()` (all tokens) or `getReward(token)` | the staker only | the staker, in each reward token | [`../staking/SKILL.md`](../staking/SKILL.md#2-claim-rewards) section 2 |
| Holder-rewards token dividend | `token.dividendOf(wallet)` | `token.claimDividend()` or `token.claimDividendFor([wallet])` | holder; anyone with the `For` call | the holder, in the paired asset (`rewardAsset()`: ETH or an ERC-20 such as NVDAc) | [1](#1-holder-rewards-token-dividends) |
| Rewards ledger creator balance | `ledger.creatorClaimable(token, wallet)` | `claimFor(token, 0)` (current creator) or `claimAllFor(wallet, tokens)` (any creator, past or current) | anyone | the creator address it was credited to, in the paired asset | [2](#2-rewards-ledger-creator-slot-and-a-previous-creators-leftover) |
| Index holder dividend | `index.dividendOf(wallet)` | `index.claimDividend()` or `index.claimDividendFor([wallet])` | holder; anyone with the `For` call | the holder, in ETH | [3](#3-index-holder-dividends) |
| Index ledger (creator, ops) | `ledger.claimable(index, wallet, 0x0)` and `ledger.claimable(index, wallet, index)` | `claim(index, currency)`, `claimFor(index, wallet, currency)` or `claimAllFor(wallet, indexes)` | wallet; anyone with the `For` calls | the wallet, in ETH and in index shares | [4](#4-index-ledger-creator) |
| Classic launch creator fees | `feeLocker.availableFees(wallet, currency)` for the launch token and its quote | `feeLocker.claim(wallet, currency)` | anyone | the fee owner (the slice recipient), in that currency (WETH stays WETH) | [5](#5-classic-launch-creator-fees-clankerfeelocker) |
| Classic holder distributor | API leaf, then `claimed(currency, wallet)` | `distributor.claim(currency, wallet, cumulativeAmount, proof)` | anyone | the leaf's account, in the launch token or its quote | [6](#6-classic-holder-distributor-merkle) |
| Airdrop allocation | API leaf, then `amountAvailableToClaim(token, wallet, allocated)` | `airdrop.claim(token, wallet, allocatedAmount, proof)` | anyone | the leaf's account, in the launch token | [7](#7-airdrop-allocations) |

Gas used on Base mainnet (2026-10-05): `getReward()` 116,553 (StakingB69) to 399,556 (StakingB420,
four reward tokens owed), `getReward(token)` 100,289; `claimDividend()` 32,017 (nothing owed) to
67,629; `claimDividendFor([wallet])` 38,043 (nothing owed) to 138,580; index ledger `claimAllFor`
79,361 for two indexes; fee locker `claim` 66,966 to 69,494; distributor `claim` 84,446 to
137,437. Send `estimate x 1.2` (the shared library's `default` rule); never hardcode a limit.

## Discovery: one wallet, every source

**Hint, not proof: `GET /api/portfolio/[wallet]`.** Its `holdings[].rewards` carries the unclaimed
dividend of every rewards token and index the wallet holds, and `claimable[]` the ones it no
longer holds but can still claim on (a dividend survives a full exit). It covers only those two
sources: staking, both ledgers, the fee locker, distributors and airdrops are not in it. Field
details: [`../market-data/SKILL.md`](../market-data/SKILL.md#a-wallet-portfolio).

**The full enumeration, onchain:**

| Source | Enumerate | Read per item |
|---|---|---|
| Staking | StakingB420 and StakingB69, `rewardTokens()` on each | `earned(wallet, token)` |
| Rewards tokens | `rewardsFactory.tokenCount()`, `tokenAt(i)` (2 today) | `dividendOf(wallet)`, `rewardAsset()`; `ledger.creatorClaimable(token, wallet)` |
| Indexes | every stack in `INDEX_STACKS`: `factory.indexCount()`, `indexAt(i)` (v3: 2 today; the v4 stack joins the list when it is live) | `dividendOf(wallet)`; the stack ledger's `claimable(index, wallet, 0x0)` and `claimable(index, wallet, index)` |
| Fee locker | every currency a classic launch trades in: `GET /api/launches?limit=200` rows with `locker` set give `token` and `pairedToken` (null means WETH) | `availableFees(wallet, currency)`, once per distinct currency |
| Distributors | `GET /api/distributors` rows with an `address`; the address must equal `distributorFor(token)` on the current or the previous distributor factory | `GET /api/distributor/[token]/claim/[wallet]`, then `claimed(currency, wallet)` per leaf |
| Airdrops | `airdrops(token)` on the airdrop extension for each classic launch (a non-zero `merkleRoot` means one exists) | `GET /api/airdrop/[token]?account=wallet`, then `amountAvailableToClaim` |

The fee locker keeps **one balance per (fee owner, currency)**, summed over every launch that pays
that owner in that currency: two WETH-paired launches by the same creator show the same WETH
figure, and one `claim(wallet, WETH)` pays both. Read each distinct currency once.

```bash
npm ci                                                        # once, at the repo root
node claim/examples/claim.mjs 0xWallet                        # scan: rows of kind, token, amount, call, who may send
node claim/examples/claim.mjs 0xWallet all                    # simulate every claim from the wallet itself
node claim/examples/claim.mjs 0xWallet creator-fees --from 0xAnyAddress   # permissionless claims, simulated from another sender
node claim/examples/claim.mjs 0xWallet index --token 0xIndex --print      # raw tx JSON per step (CDP, Safe, relayers)
PRIVATE_KEY=0x... node claim/examples/claim.mjs 0xWallet all --send       # the key must be the wallet for own-only claims
```

Kinds: `staking | dividends | ledger | index | creator-fees | distributor | airdrop`. With a
signer other than the wallet, the script drops own-only claims (`getReward`) with the reason and
uses `claimDividendFor([wallet])` for dividends; every other claim is built unchanged.

Simulated on Base mainnet, 2026-10-05: scan of a classic creator found 4 kinds (a StakingB69 reward, a MEOW dividend, creator fees in its launch's quote token, two distributor leaves), all 7 kinds read, gas n/a (reads).
Simulated on Base mainnet, 2026-10-05: scan of the rewards-token and index creator (also the only holder of both rewards tokens) found index ledger balances in ETH and shares, a COIN5 dividend and a JACKET distributor leaf, and no rewards-token dividend or rewards ledger balance, gas n/a (reads).
Simulated on Base mainnet, 2026-10-05: scan of a WETH-pair classic creator found one WETH fee locker balance (a single figure for all its WETH-paired launches); scan of the largest StakingB420 staker found nothing owed in any source, gas n/a (reads).
Simulated on Base mainnet, 2026-10-05: `all` for the classic creator built 5 steps, all ok: `getReward()` 101,880, `claimDividend()` 47,933, fee locker `claim` 66,966, distributor `claim` 132,990 and 84,446.
Simulated on Base mainnet, 2026-10-05: `all` for a wallet staked in both pools built 5 steps, all ok: StakingB420 `getReward()` 304,240, StakingB69 `getReward()` 133,653, MEOW `claimDividend()` 50,591, distributor `claim` 133,698 (current factory) and 84,431 (previous factory).
Simulated on Base mainnet, 2026-10-05: `all` for the classic creator, simulated from another address, skipped `getReward()` with the reason and built `claimDividendFor([wallet])` instead of `claimDividend()`: 4 steps ok, gas 138,580, 66,966, 132,990, 84,446.

## 1. Holder-rewards token dividends

A B420RewardsToken credits the holders' part of every trading fee (`holdersBps` of the creator
half) to every eligible holder in proportion to the balance, with magnified-dividend accounting:
no snapshot, no merkle root, no poster. It pays in `rewardAsset()`: `0x0` is native ETH (RWT3U6F),
anything else is that ERC-20 (RWS8222 pays NVDAc, 8 decimals). A holder that sold everything keeps
what it earned. A sell's holders' part is parked in the hook (`pendingHolders(poolId)`) until the
pool's next clean swap or a flush ([`../keeper/SKILL.md`](../keeper/SKILL.md) section 3); it is
not in `dividendOf` until then.

```ts
const REWARDS_TOKEN_ABI = parseAbi([
  "function rewardAsset() view returns (address)",
  "function dividendOf(address account) view returns (uint256)",
  "function withdrawnDividends(address account) view returns (uint256)",
  "function claimDividend() returns (uint256 amount)",
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
]);
// enumerate: rewardsFactory.tokenCount() / tokenAt(i) on 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
```

- **Discovery:** `dividendOf(wallet)`, in the asset's decimals. `withdrawnDividends(wallet)` is what
  it already took.
- **`claimDividend()`**: sent by the holder, pays `msg.sender` with all the gas the caller forwards,
  returns 0 without reverting when nothing is owed. An ETH payout to a caller that refuses ETH
  reverts `EthTransferFailed()`.
- **`claimDividendFor([wallet])`**: anyone, pays each listed account its own dividend. Each payee gets
  a fixed budget (`PUSH_GAS` 50,000 for ETH, `TOKEN_PUSH_GAS` 100,000 for an ERC-20); a payee that
  refuses or needs more is skipped (`DividendPushFailed`, its dividend stays) and must call
  `claimDividend()` itself. Returns `(paid, skipped)`.
- **Gas:** `estimate x 1.2`.

Simulated on Base mainnet, 2026-10-05: no holder of RWT3U6F or RWS8222 had a dividend (`owed` empty on both payout lists); `claimDividend()` from the RWT3U6F holder ok, returned 0, gas 32,017.
Simulated on Base mainnet, 2026-10-05: `claimDividendFor([holder])` from another address ok, returned (paid 0, skipped 1), gas 38,043 on RWT3U6F (ETH) and 38,055 on RWS8222 (NVDAc).

## 2. Rewards ledger: creator slot (and a previous creator's leftover)

The B420RewardsLedger holds every slice of a rewards token's fees that is not paid to holders, in
the token's paired asset. Slot 0 is the creator: the creator half minus the holders' part. The
balance is **keyed by the address it was credited to**, so `transferCreator` moves only future
earnings; what an earlier creator earned stays claimable for that address. Slots 1 to 3
(treasury, collector, staking) are paid to fixed protocol recipients: keeper section 7.

```ts
const REWARDS_LEDGER_ABI = parseAbi([
  "function creatorOf(address token) view returns (address)",
  "function claimable(address token, uint8 slot) view returns (uint256)",          // slot 0: the current creator's balance
  "function creatorClaimable(address token, address recipient) view returns (uint256)",
  "function claimFor(address token, uint8 slot) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] tokens) returns (uint256 eth)",
]);
// ledger: 0x8e95B431B70094B66836074B01c380A4935B7d49
```

- **Discovery:** `creatorClaimable(token, wallet)` for every rewards token, whether or not the
  wallet is `creatorOf(token)` today.
- **`claimFor(token, 0)`**: anyone; pays `creatorOf(token)` only; reverts `NothingToClaim()` when 0.
- **`claimAllFor(wallet, tokens)`**: anyone; pays the wallet's creator balance on every listed
  token (current or previous creator), one ETH transfer for all ETH-paired tokens; no revert when
  nothing is owed, so filter the list with `creatorClaimable` first.
- **Gas:** `estimate x 1.2`. A creator that refuses ETH makes the call revert `EthTransferFailed()`.

Simulated on Base mainnet, 2026-10-05: no creator balance on either rewards token (RWS8222 routes the whole creator half to holders; RWT3U6F's creator balance was 0): `claimFor(RWT3U6F, 0)` reverts `NothingToClaim()`, gas n/a.
Simulated on Base mainnet, 2026-10-05: `claimAllFor(creator, [RWT3U6F, RWS8222])` ok, returned 0, gas 33,304 (an empty `claimAllFor` only burns gas); `claimFor(RWT3U6F, 4)` reverts `BadSlot()`.

## 3. Index holder dividends

A B420IndexToken credits the holders' part of the index fee to every eligible holder in **ETH**,
with the same magnified-dividend accounting. On the v3 stack the hook credits holders during each
trade; the v4 stack parks a sell's part (`pendingHolders(index)` on its hook) until the next clean
trade or a flush. A holder that sold everything keeps what it earned.

```ts
const INDEX_TOKEN_ABI = parseAbi([
  "function dividendOf(address account) view returns (uint256)",
  "function claimDividend() returns (uint256 amount)",
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
]);
// enumerate: for each INDEX_STACKS entry, factory.indexCount() / indexAt(i) (v3 factory 0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF)
```

- **Discovery:** `dividendOf(wallet)` (wei).
- **`claimDividend()`**: the holder; pays `msg.sender`, all forwarded gas; reverts
  `EthTransferFailed()` if the caller refuses ETH.
- **`claimDividendFor([wallet])`**: anyone; `PUSH_GAS` 50,000 per payee; a refusing payee is skipped.
- **Gas:** `estimate x 1.2`.

Simulated on Base mainnet, 2026-10-05: `claimDividend()` from a MEOW holder ok, returned 570,638,556,400,583 wei, gas 47,933; from the COIN5 holder ok, gas 67,629.
Simulated on Base mainnet, 2026-10-05: `claimDividendFor([that MEOW holder])` from another address ok, returned (paid 570,638,556,400,583, skipped 0), gas 138,580.

## 4. Index ledger (creator)

The stack's ledger (B420IndexFeeSplitter, the factory's `splitter()`) records the creator's part
of every index fee (50% minus what the creator routes to holders) and the ops part (20%). A buy
credits ETH; a sell credits **index shares**, delivered when the hook flushes (until then they sit
in `pendingCreatorFee(index)` on the hook: keeper section 3). Currency `0x0` is ETH, the index
address is its shares.

```ts
const INDEX_LEDGER_ABI = parseAbi([
  "function claimable(address index, address recipient, address currency) view returns (uint256)",
  "function claim(address index, address currency) returns (uint256 amount)",
  "function claimFor(address index, address recipient, address currency) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] indexes) returns (uint256 eth)",
]);
// v3 ledger: 0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6 (a v4 stack has its own ledger: iterate INDEX_STACKS)
```

- **Discovery:** `claimable(index, wallet, 0x0)` and `claimable(index, wallet, index)`, on the
  ledger of the stack that lists the index.
- **`claim(index, currency)`**: pays the caller's own balance; reverts `NothingToClaim()` when 0.
- **`claimFor(index, wallet, currency)`**: anyone; pays the wallet; reverts `NothingToClaim()` when 0.
- **`claimAllFor(wallet, indexes)`**: anyone; both currencies of every listed index, ETH summed in
  one transfer; no revert when empty.
- **Gas:** `estimate x 1.2` (about 40,000 for ETH, 94,000 for shares).

Simulated on Base mainnet, 2026-10-05: the creator's `claimAllFor(creator, [MEOW, COIN5])` (2 wei of MEOW shares, 1 wei of ETH) ok, gas 79,361 from the creator and 81,861 from another address.
Simulated on Base mainnet, 2026-10-05: `claimFor(MEOW, ops, 0x0)` ok, gas 39,693; `claimFor(MEOW, ops, MEOW)` (shares) ok, gas 93,736.

## 5. Classic launch creator fees (ClankerFeeLocker)

A classic launch's pool fees accrue to the LP locker's position. After swaps (once the pool's MEV
module window, at most 120 s after launch, has passed) the hook has the locker collect them; the
locker splits them by the slices' `rewardBps` and credits each recipient in the ClankerFeeLocker.
Fees not collected yet sit in the position: `collectRewards(token)` moves them
([`../keeper/SKILL.md`](../keeper/SKILL.md) section 4).

- **The fee owner** is the creator slice's recipient: `tokenRewards(token).rewardRecipients[i]` on
  the launch's locker (the launches row's `locker`: v2 `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4`,
  or v1 `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` for factory v1 launches). After
  `updateRewardRecipient` (slice management: [`../launch/classic/SKILL.md`](../launch/classic/SKILL.md)),
  what already accrued stays with the old recipient.
- **Both currencies.** `feePreferences(token, i)`: `0` Both pays the slice in kind in the launch token
  and the quote; `1` Paired sells the token side and pays only the quote. Read both anyway.
- **WETH, not ETH.** A WETH-paired launch's fees are WETH (an ERC-20); unwrap yourself if needed.
- **Routed to holders?** If the creator slice's recipient is the launch's distributor, those fees
  are the holders' (section 6), not the creator's.

```ts
const FEE_LOCKER_ABI = parseAbi([
  "function availableFees(address feeOwner, address token) view returns (uint256)",
  "function claim(address feeOwner, address token)",
]);
const LOCKER_ABI = parseAbi([
  "function tokenRewards(address token) view returns ((address token, (address,address,uint24,int24,address) poolKey, uint256 positionId, uint256 numPositions, uint16[] rewardBps, address[] rewardAdmins, address[] rewardRecipients))",
  "function feePreferences(address token, uint256 index) view returns (uint8)",
]);
// fee locker: 0x20835181fD6F4e62AA8d630A89b0e5c8676808C6
```

- **Discovery:** `availableFees(wallet, currency)` once per distinct currency (see Discovery).
- **`claim(feeOwner, currency)`**: anyone; always pays `feeOwner` the whole balance of that
  currency; reverts `NoFeesToClaim()` when it is 0.
- **Gas:** `estimate x 1.2` (66,966 used for an ERC-20 quote).

Simulated on Base mainnet, 2026-10-05: `claim(creator, WETH)` ok, gas 69,494, identical from the creator and from another address; `claim` of a balance in an ERC-20 quote ok, gas 66,966.
Simulated on Base mainnet, 2026-10-05: `claim(owner with nothing, WETH)` reverts `NoFeesToClaim()`, gas n/a.

## 6. Classic holder distributor (merkle)

A classic launch that shares its creator half with holders pays that slice to a
B420FeeDistributor (one beacon proxy per launch). Anyone moves the fees from the fee locker into it
with `sync()` (keeper section 5); the B420 worker posts a **cumulative** merkle root per currency;
a holder claims the difference between its cumulative leaf and what it already took.

- **Find it:** `GET /api/distributors` (rows with an `address`, its launch `token` and `paired`),
  then check `distributorFor(token)` on the current factory
  `0x049B3Ee15c41163458073072e9573BF0fb88D5d4` or the previous one
  `0x6c8DB32e7b49743c56505718f6f5CBADd18705B6` (its distributors, CUCK and JERK among them, still
  pay). Never call a factory's `create()`.
- **The leaf:** `GET /api/distributor/[token]/claim/[wallet]` returns
  `{ success, leaves: [{ currency, cumulativeAmount, proof, epoch }] }`, one leaf per currency.
  Leaf hash: `keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))))`.

```ts
const DISTRIBUTOR_ABI = parseAbi([
  "function claimed(address currency, address account) view returns (uint256)",
  "function claimable(address currency, address account, uint256 cumulativeAmount) view returns (uint256)",
  "function claim(address currency, address account, uint256 cumulativeAmount, bytes32[] proof)",
]);
const DISTRIBUTOR_FACTORY_ABI = parseAbi(["function distributorFor(address token) view returns (address)"]);
```

- **Discovery:** owed = `cumulativeAmount - claimed(currency, wallet)`; skip when 0.
- **`claim(currency, wallet, cumulativeAmount, proof)`**: anyone; pays only `wallet`.
- **Gas:** `estimate x 1.2`.

Simulated on Base mainnet, 2026-10-05: `claim` on the JACKET distributor (NVDAc leaf) ok, gas 132,990 from the holder and 137,437 from another address; on the CUCK distributor of the previous factory (METAc leaf) ok, gas 84,446.

## 7. Airdrop allocations

A classic launch may lock part of its supply in the airdrop extension (ClankerAirdropV2) against a
merkle root: a lockup of at least 1 day (`MIN_LOCKUP_DURATION`), then linear vesting until
`vestingEndTime`. From `adminClaimTime` (vesting end plus 14 days, `CLAIM_EXPIRATION_INTERVAL`) the
airdrop's admin may sweep what nobody claimed; after that every claim reverts `AdminClaimed()`.
Claim before the window closes.

```ts
const AIRDROP_ABI = parseAbi([
  "function airdrops(address token) view returns (address admin, bytes32 merkleRoot, uint256 totalSupply, uint256 totalClaimed, uint256 lockupEndTime, uint256 vestingEndTime, uint256 adminClaimTime, bool adminClaimed)",
  "function amountAvailableToClaim(address token, address recipient, uint256 allocatedAmount) view returns (uint256)",
  "function claim(address token, address recipient, uint256 allocatedAmount, bytes32[] proof)",
]);
// airdrop extension v2: 0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2
```

- **Discovery:** `airdrops(token).merkleRoot != 0`, then `GET /api/airdrop/[token]?account=wallet`:
  `found: false` means no airdrop on that launch, `claim: null` means the wallet is not in the
  tree, else `claim: { account, amount, proof }` (`amount` is the allocation). Then
  `amountAvailableToClaim(token, wallet, amount)`: 0 during the lockup, the vested unclaimed part
  after it.
- **`claim(token, wallet, allocatedAmount, proof)`**: anyone; pays `wallet` the vested unclaimed part.
- **Gas:** `estimate x 1.2`.

Simulated on Base mainnet, 2026-10-05: no live airdrop (`airdrops(token).merkleRoot` is zero on all 45 classic launches); reads and encoding only: `amountAvailableToClaim` and `claim` on a launch without an airdrop both revert `AirdropNotCreated()`, gas n/a.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|---|---|
| StakingB420 (stake B420, earn 10 tokenized stocks, 8 dec) | `0xC411bA66d1819054f67cDE26424cd876DB703E79` |
| StakingB69 (stake B69, earn B420, 18 dec) | `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309` |
| B420RewardsFactory (enumerate rewards tokens) | `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31` |
| B420RewardsLedger (creator slot) | `0x8e95B431B70094B66836074B01c380A4935B7d49` |
| Index v3 factory (enumerate indexes) | `0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF` |
| Index v4 factory (enumerate indexes) | `0xD408a52ff4871097A89977Ca9fc48dF0D4243293` |
| Index v3 ledger (`splitter()`) | `0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6` |
| ClankerFeeLocker (creator fees, claim here) | `0x20835181fD6F4e62AA8d630A89b0e5c8676808C6` |
| LP locker v2 (slice table, factory v2 launches) | `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` |
| LP locker v1 (slice table, factory v1 launches) | `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` |
| Distributor factory (current) | `0x049B3Ee15c41163458073072e9573BF0fb88D5d4` |
| Distributor factory (previous generation, its distributors still pay) | `0x6c8DB32e7b49743c56505718f6f5CBADd18705B6` |
| Airdrop extension v2 | `0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2` |

Rewards tokens and indexes are their own contracts: enumerate them, never hardcode the list.

## Errors you might hit

### Rewards token and index token (`claimDividend`, `claimDividendFor`)

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `EthTransferFailed()` | `0x6d963f88` | `claimDividend()` paid ETH to a caller that refuses it | Claim from a wallet that accepts ETH, or have anyone call `claimDividendFor([wallet])` |
| `InsufficientGas()` | `0x1c26714c` | `claimDividendFor`: the gas left could not give the next payee its full push budget | Raise the gas limit to the estimate x 1.25, or list fewer payees |
| `SafeERC20FailedOperation(address)` | `0x5274afe7` | ERC-20 pair: the asset refused the transfer (a paused or blocklisting issuer) | Retry later; nothing was paid and the dividend stays |
| `ReentrancyGuardReentrantCall()` | `0x3ee5aeb5` | The payee called back into the token | Claim from a plain wallet |

### Rewards ledger (`claimFor`, `claimAllFor`)

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `NothingToClaim()` | `0x969bf728` | `claimFor` on a slot whose balance is 0 | Read `claimable(token, slot)` first; skip it |
| `BadSlot()` | `0x10370eb3` | Slot above 3 | Use 0 creator, 1 treasury, 2 collector, 3 staking |
| `EthTransferFailed()` | `0x6d963f88` | ETH-paired token: the creator address refuses ETH | The creator receives on a wallet that accepts ETH; `transferCreator` moves only future earnings |
| `InsufficientGas()` | `0x1c26714c` | Slot 3 (staking) sent with less than about 555,000 gas left | Gas limit at least 700,000 (keeper section 7) |
| `CollectorPull(uint256,uint256)` | `0xb44acf18` | Slot 2: the collector pulled a different amount than owed | Nothing was paid; leave it and report it |
| `SafeERC20FailedOperation(address)` | `0x5274afe7` | ERC-20 pair: the paired asset refused the transfer (a paused or blocklisting issuer) | Retry later; the balance stays |

### Index ledger (`claim`, `claimFor`, `claimAllFor`)

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `NothingToClaim()` | `0x969bf728` | `claim` or `claimFor` on a zero balance for that currency | Read both currencies with `claimable`; claim the non-zero one, or use `claimAllFor` |
| `EthTransferFailed()` | `0x6d963f88` | The recipient refuses ETH | Claim the shares alone (`claimFor(index, wallet, index)`); the ETH stays claimable for that address |

### ClankerFeeLocker

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `NoFeesToClaim()` | `0x846d8c5c` | `availableFees(feeOwner, token)` is 0 for that currency | Read both currencies of the launch; fees not collected yet need `collectRewards(token)` (keeper section 4) |
| `SafeERC20FailedOperation(address)` | `0x5274afe7` | The currency refused the transfer (a paused or blocklisting token) | Retry later; the balance stays in the locker |

### Holder distributor

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `UnknownCurrency()` | `0x62bf7c2c` | The currency is neither the launch token nor its quote | Use the leaf's own `currency` |
| `InvalidProof()` | `0x09bde339` | The leaf is not under the current root (a newer root was posted, or the leaf belongs to another distributor) | Re-read the leaf from the API right before sending |
| `NothingToClaim()` | `0x969bf728` | `cumulativeAmount <= claimed(currency, account)` | Already claimed up to this root; wait for the next root |
| `ExceedsPosted()` | `0xec40079b` | The payout would pass the root's posted total | Do not retry; report it (a bad root) |

### Airdrop extension

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `AirdropNotCreated()` | `0x830e2f44` | No airdrop on that token (also from `amountAvailableToClaim`) | Check `airdrops(token).merkleRoot` first |
| `AdminClaimed()` | `0x0e85809b` | The admin swept the remainder after `adminClaimTime` | Nothing left to claim |
| `AirdropNotUnlocked()` | `0xb8d22dea` | Before `lockupEndTime` | Wait for the lockup to end |
| `ZeroClaim()` | `0x47e789c2` | `allocatedAmount` is 0 | Use the leaf's `amount` |
| `TotalMaxClaimed()` | `0xed78e047` | The whole airdrop is claimed | Nothing left |
| `InvalidProof()` | `0x09bde339` | Wrong `allocatedAmount`, recipient or proof | Use the API leaf unchanged, with its own `account` |
| `UserMaxClaimed()` | `0x5ce73c66` | This allocation is fully claimed | Done |
| `ZeroToClaim()` | `0x0001549d` | Nothing vested since the last claim | Claim later in the vesting window |

### API answers

| Answer | Cause | Fix |
|---|---|---|
| `leaves: []` from `/api/distributor/[token]/claim/[wallet]` | No leaf for that wallet under the last root (not a holder then, or no root yet) | Not owed on this distributor now; check again after the next root |
| `found: false` / `claim: null` from `/api/airdrop/[token]` | No airdrop on the launch / the wallet is not in its tree | Nothing to claim there |
| `503` `social layer not configured`, or `500` | The API's database is unavailable | Retry; never read it as "nothing to claim" |
| `400` `bad address` | A malformed address in the path | Pass a 0x address of 40 hex characters |
| 200 rows from `/api/launches` | The feed caps at 200 rows | Launches past the cap are not listed; say so |

## What this is NOT

- Not batch payouts: paying every holder of a rewards token or an index, `claimMany` over a
  distributor, and the treasury, collector and staking ledger slots are
  [`../keeper/SKILL.md`](../keeper/SKILL.md).
- Not staking: stake, unstake, withdraw and the `getReward` recipe live in
  [`../staking/SKILL.md`](../staking/SKILL.md).
- Not legacy dividend vault claims: existing vault stakers exit through the legacy section of
  [`../staking/SKILL.md`](../staking/SKILL.md).
- Not a way to change who is paid: `updateRewardRecipient`, `updateFeePreference`,
  `raiseHoldersBps` and `transferCreator` are in [`../launch/classic/SKILL.md`](../launch/classic/SKILL.md)
  and [`../launch/rewards/SKILL.md`](../launch/rewards/SKILL.md).
- Not curve launch fees: curve launches are closed ([root router](../SKILL.md#never-do-canonical-gates)).

## Related skills

- [`../SKILL.md`](../SKILL.md): root router, signer modes, money rules, address book
- [`../staking/SKILL.md`](../staking/SKILL.md): StakingB420 and StakingB69, including `getReward`
- [`../keeper/SKILL.md`](../keeper/SKILL.md): pay every holder, flush hooks, collect pool fees, sync distributors, protocol ledger slots
- [`../market-data/SKILL.md`](../market-data/SKILL.md): `GET /api/portfolio/[wallet]` and the other public reads
- [`../launch/classic/SKILL.md`](../launch/classic/SKILL.md): creator slice management of classic launches
- [`../launch/rewards/SKILL.md`](../launch/rewards/SKILL.md): `raiseHoldersBps` and `transferCreator` on rewards tokens

## License

CC0.
