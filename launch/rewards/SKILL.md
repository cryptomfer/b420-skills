---
name: b420-launch-rewards
version: 1.0.0
description: "Launch a B420 holder-rewards token as an AI agent: POST https://b420.io/api/launch/rewards mines a salt bound to your sending wallet, then one B420RewardsFactory.launch call (payable). holdersBps (1 to 10000) of the creator half is paid to holders as dividends in the paired asset (native ETH or an ERC-20 such as a tokenized stock); optional dev buy; creator fee recipient. Covers the ERC-20 approval step, the gas rule for ETH dev buys (max(estimate + 600k, estimate x 1.3), or 4.5M), every factory revert, and the creator calls raiseHoldersBps and transferCreator. AGENT RULES: SEND FROM THE WALLET THE SALT WAS MINED FOR, SEND PREP.VALUE EXACTLY, APPROVE THE EXACT DEV BUY. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers. Classic B20 launches are launch/classic/."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
rewards_factory: 0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31
rewards_hook: 0x2d04aCae52491E882dd6D606F3A8160945fA2aeC
rewards_ledger: 0x8e95B431B70094B66836074B01c380A4935B7d49
---

# B420 Holder-Rewards Launch: Skill for AI Agents

A holder-rewards token is a fixed-supply ERC-20 that **pays its holders automatically, in
the asset it trades against**, on **Base (chainId 8453)**: native ETH for an ETH pair, NVDAc
for an NVDAc pair, and so on. **One `B420RewardsFactory.launch` transaction deploys the
token at an address ending in `b420`, registers its creator and holders gauge in the ledger,
has the rewards hook create the Uniswap v4 pool and lock the whole supply (minus a 0.001
dead floor) in one position forever, and runs your optional dev buy.** The factory, the
hook, the ledger and the token have no owner and no setting: every rule below is fixed at
deployment.

`POST /api/launch/rewards` validates your inputs, prices the pair, mines the salt **for
your sending wallet** (the CREATE2 address commits to `keccak256(abi.encode(sender, salt))`),
checks the prediction against the factory, simulates the exact launch and answers with
`LaunchParams` as JSON. Your wallet approves the dev buy when the pair is an ERC-20, then
sends `launch`.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../../SKILL.md). The launch agent rules, the name check and the confirm call live in the [launch router](../SKILL.md).

> **The salt is bound to the sender.** A prepare only works from the `sender` it was mined
> for: from any other wallet `launch` reverts `BadVanity(address)` (`0x32476710`). Never
> hand a prepare to another wallet, never reuse one; prepare again instead.

> **Open to every wallet since 2026-10-04.** A prepare that answers `503 { code: "closed" }`
> means the launch form was closed again; stop and report it.

## Agent rules

1. **`sender` is the wallet that signs `launch`.** Pass the signer's address (the examples
   do). `creator` (the fee recipient, which also receives the dev buy tokens) may be another
   wallet; it defaults to `sender`.
2. **Send `prep.value` exactly.** Native ETH pair: `value` = `devBuy` (0 without a dev buy).
   ERC-20 pair: `value` = 0, the factory pulls the dev buy. Anything else reverts
   `BadValue()` (`0x0bba69fb`).
3. **Restore `params.supply` and `params.devBuy` to bigints** before encoding; every other
   field is already in viem's shape.
4. **Approve the exact dev buy when `prep.approval` is present,** to the factory, and
   simulate the approval and the launch as one bundle. Without the approval the dev buy's
   `transferFrom` reverts the whole launch. Check the server's figure before approving: an
   `approval.amount` other than `params.devBuy`, or an `approval.token` other than
   `params.pairedAsset`, is not this launch's approval (the example stops on either).
5. **Gas: ETH pair with a dev buy, max(estimate + 600,000, estimate x 1.3), or 4,500,000;
   every other launch estimate x 1.2, or 2,600,000.** An ETH-pair dev buy runs the hook's
   B420 buyback inside the swap with a 1,000,000 gas budget; a limit that cuts it short
   reverts the launch (`InsufficientGas()`, `0x1c26714c`).
6. **An ETH-pair `creator` must accept ETH.** The creator slot is paid with a plain call;
   a contract that refuses ETH can never claim it (the prepare warns about it).

## The economics: enforced onchain

The rewards hook takes **1% of the paired leg of every swap**, buy or sell, rounded up
(`FEE_BPS` 100); the pool's own LP fee is 0. Each fee splits by the hook's constants, read on
chain: `CREATOR_HALF_BPS` 5000, `TREASURY_BPS` 2000, `B420_LEG_BPS` 1500, `STOCK_LEG_BPS` 1500.

| Share of the 1% fee | Recipient | Asset | Where it waits |
|-------|-----------|-------|-------|
| **50% x (1 - holdersBps / 10000)** | **The creator**: ledger slot 0 (CREATOR), credited to `creatorOf(token)` at that moment | Paired asset | B420RewardsLedger |
| **50% x holdersBps / 10000** | **Holders**, pro rata to eligible balances | Paired asset | The token itself (`claimDividend`) |
| 20% (plus rounding dust) | Strategic Reserve `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` (slot 1, TREASURY) | Paired asset | Ledger |
| 15% (stock leg) | FeeCollector v2 `0x22F005aa2b90E06C642C7462388b9d212D6344d8` (slot 2, COLLECTOR), earmarked for registry stock buys | Paired asset | Ledger |
| 15% (B420 leg) | ETH pair: B420 bought inside each swap and sent to StakingB69 `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309`. B420 pair: StakingB69 in kind (slot 3, STAKING). Any other pair: FeeCollector v2 (slot 2) | B420 or the paired asset | Hook or ledger |

Example: `holdersBps` 5000 pays holders 25% of every fee (0.25% of each trade's paired leg)
and the creator 25%; `holdersBps` 10000 sends the whole creator half to holders.

- **Holders.** The token credits every eligible balance in proportion, exactly, with no
  snapshot and no poster. The PoolManager, the hook, the ledger, the collector and the token
  are not eligible; the dead address earns and is never paid. A buyer earns nothing of its
  own buy and a seller nothing of its own sell. Holders claim with `claimDividend()`
  ([`../../claim/SKILL.md`](../../claim/SKILL.md)).
- **Ledger slots** are paid by anyone to their fixed recipient (`claimFor(token, slot)`);
  the treasury, collector and staking recipients are ledger immutables. `MAX_HOLDERS_BPS`
  10000; `STAKING_NOTIFY_GAS` 300000.
- **Launch delay.** The pool trades from `LAUNCH_BLOCK_DELAY` (2) blocks after the launch
  block; the factory's dev buy is the only exception.

## 1. Prepare: POST /api/launch/rewards

Run the name check of the [launch router](../SKILL.md#1-status-and-name-check) with
`GET /api/launch/rewards?name=&symbol=` first, then:

```js
const body = {
  sender: "0xYourSigningWallet",    // required: the wallet that sends launch (the salt is mined for it)
  name: "My Token",                 // required, 1 to 48 characters
  symbol: "MYT",                    // required, 1 to 12 characters, uppercased
  holdersBps: 5000,                 // required integer, 1..10000: bps of the creator half paid to holders
  supply: "1000000000",             // whole tokens as digits, 1 to 999999999999999; default 1,000,000,000
  pairedTokenAddress: "0xb20000000000000000000078ee7ce2fE4908108C", // ERC-20 pair (NVDAc here); omit, "" or WETH = native ETH
  devBuy: "0.001",                  // optional, in units of the paired asset; at most 50 ETH of value
  creator: "0xFeeRecipient",        // optional fee recipient (also gets the dev buy tokens); default sender
  image: "ipfs://…",                // optional ipfs:// or https URL
  description: "…",                 // optional, at most 500 characters
  website: "https://…", twitter: "@handle", telegram: "https://t.me/…", discord: "https://discord.gg/…", // optional
};
const res = await fetch("https://b420.io/api/launch/rewards", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const prep = await res.json();
```

| Response field | Meaning |
|---|---|
| `success`, `kind` | `true`, `"rewards"` |
| `chainId`, `factory` | `8453`, B420RewardsFactory `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31` (lowercase) |
| `sender` | The wallet the salt was mined for: must be the signer |
| `params` | `{ name, symbol, supply, pairedAsset, holdersBps, creator, salt, startingTick, devBuy }`; `supply` and `devBuy` are decimal strings, `pairedAsset` is `0x0` for native ETH |
| `value` | The exact wei to send (decimal string) |
| `predictedAddress` | The token's address (ends in `b420`), checked against `predictToken(params, sender)` |
| `paired` | `{ address, symbol, decimals }` |
| `approval` | Only for an ERC-20 pair with a dev buy and a short allowance: `{ token, spender, amount, allowance, balance }` |
| `warnings` | For example a contract fee recipient on an ETH pair, or metadata that could not be saved |

| Status | `code` | Cause | Do |
|---|---|---|---|
| 200 | | Prepared and simulated | Section 2 or 3 |
| 400 | `invalid` | A field the message names; quote refused (no price, under $5,000 of liquidity outside the governed quotes); dev buy above 50 ETH of value; `The dev buy is X and this wallet holds Y`; `This launch would fail on chain and was not sent: <reason>` | Fix that input, prepare again |
| 409 | `duplicate` | Name and ticker taken (database or factory) | Pick another name or ticker |
| 429 | | More than 12 prepares per minute from your IP | Wait a minute |
| 500 | | The factory predicts another address for the salt | Prepare again |
| 502 | | Base could not be read | Retry in a minute |
| 503 | `busy` | The salt search ran out of time (40 s) | Prepare again |
| 503 | `closed` | Rewards launches closed to this sender | Stop |

Each successful prepare writes a draft row (insert-only, keyed by `predictedAddress`) with the
image, description and links; the confirm call and the worker copy it to the token page once
the launch is mined, and unconfirmed drafts are pruned after 7 days. The token itself stores
only its name and symbol onchain.

## 2. Approve the paired asset (ERC-20 pairs with a dev buy)

The factory pulls the dev buy from `sender` with `transferFrom`. When `prep.approval` is
present, approve exactly `approval.amount` to the factory (the server then simulated the
launch without the dev buy, which mints at the same address):

```js
// pub, wallet, account, params and the viem imports as in section 3
import { gasFor } from "../../examples/lib/b420.mjs";
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
if (prep.approval) {
  // the exact dev buy, in the paired asset, to the factory: anything else is not this launch's approval
  if (BigInt(prep.approval.amount) !== params.devBuy || getAddress(prep.approval.token) !== getAddress(params.pairedAsset)) throw new Error("approval differs from the dev buy: do not send");
  const approve = { address: prep.approval.token, abi: ERC20_ABI, functionName: "approve",
                    args: [prep.factory, params.devBuy], account };
  // Gas: the approvals table of trade/SKILL.md (a tokenized stock is a B20: the stockApprove rule).
  const gas = gasFor("stockApprove", await pub.estimateContractGas(approve).catch(() => null));
  await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...approve, gas }) });
}
```

Simulate the approval and the launch together before sending either (`eth_simulateV1`, as
the example does). A node one block behind may still read the old allowance right after the
approval lands: if the launch simulation then reverts `ERC20InsufficientAllowance` or the
B20 `InsufficientAllowance`, wait one block and simulate again.

## 3. Simulate and send launch

```js
import { createPublicClient, createWalletClient, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REWARDS_FACTORY_ABI = parseAbi([
  "struct LaunchParams { string name; string symbol; uint256 supply; address pairedAsset; uint16 holdersBps; address creator; bytes32 salt; int24 startingTick; uint256 devBuy; }",
  "function launch(LaunchParams p) payable returns (address token, bytes32 poolId)",
  "function predictToken(LaunchParams p, address sender) view returns (address)",
  "error BadValue()",
  "error BadVanity(address predicted)",
  "error NameTaken(address existing)",
  "error DevBuyFailed()",
  "error InsufficientGas()",
]);

const account = privateKeyToAccount(process.env.PRIVATE_KEY);   // from env only, never printed
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const wallet = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });
if (prep.sender.toLowerCase() !== account.address.toLowerCase()) throw new Error("salt mined for another wallet");

const params = { ...prep.params, supply: BigInt(prep.params.supply), devBuy: BigInt(prep.params.devBuy) };
const value = BigInt(prep.value);
const call = { address: prep.factory, abi: REWARDS_FACTORY_ABI, functionName: "launch", args: [params], account, value };

const { result: [token] } = await pub.simulateContract(call);    // token = prep.predictedAddress
const ethDevBuy = params.pairedAsset === "0x0000000000000000000000000000000000000000" && params.devBuy > 0n;
let est = null;
try { est = await pub.estimateContractGas(call); } catch {}
const gas = est === null
  ? (ethDevBuy ? 4_500_000n : 2_600_000n)
  : ethDevBuy
    ? (est + 600_000n > (est * 13n) / 10n ? est + 600_000n : (est * 13n) / 10n)
    : (est * 12n) / 10n;
const hash = await wallet.writeContract({ ...call, gas });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
```

Bankr, CDP, Safe or a relayer: submit `{ to: prep.factory, data, value, gas, chainId: 8453 }`
per step as described in the [root router](../../SKILL.md); the example prints exactly that
with `--print`.

Measured with [`../examples/launch-rewards.mjs`](../examples/launch-rewards.mjs):

- Simulated on Base mainnet, 2026-10-05: ETH pair, `holdersBps` 5000, no dev buy ok, gas 1,887,697.
- Simulated on Base mainnet, 2026-10-05: ETH pair, `holdersBps` 10000, 0.001 ETH dev buy (value 0.001 ETH) ok, gas 2,874,292 (rule limit 3,736,580).
- Simulated on Base mainnet, 2026-10-05: NVDAc pair, `holdersBps` 7500, 0.0005 NVDAc dev buy as one bundle: approve ok, gas 45,939; launch ok, gas 2,210,086.
- Simulated on Base mainnet, 2026-10-05: NVDAc pair, `holdersBps` 5000, 0.0005 NVDAc dev buy, the server's `approval` (amount 50000, the NVDAc token, the factory) checked against `params` before the bundle: approve ok, gas 45,939; launch ok, gas 2,209,978.

```bash
node launch/examples/launch-rewards.mjs --name "My Token" --symbol MYT --holders-bps 5000 --from 0xYourWallet
PRIVATE_KEY=0x… node launch/examples/launch-rewards.mjs --name "My Token" --symbol MYT --holders-bps 10000 --dev-buy 0.01 --send
node launch/examples/launch-rewards.mjs --name "My Token" --symbol MYT --holders-bps 5000 \
  --paired 0xb20000000000000000000078ee7ce2fE4908108C --dev-buy 0.001 --from 0xYourWallet --print
```

## 4. Confirm

`POST https://b420.io/api/launch/confirm { txHash }` right after the receipt, with the retry
rule of the [launch router](../SKILL.md#3-confirm-post-apilaunchconfirm); the answer is
`{ ok: true, token, kind: "rewards" }` and the draft's image and links reach the token page.
Trading opens 2 blocks after the launch block: buy and sell through
[`../../trade/rewards-token/SKILL.md`](../../trade/rewards-token/SKILL.md), never through an
aggregator.

## Manage: raiseHoldersBps and transferCreator

Two creator calls on B420RewardsLedger `0x8e95B431B70094B66836074B01c380A4935B7d49`, from the
current `creatorOf(token)` only. Nothing else about a launch can change.

```js
const LEDGER_ABI = parseAbi([
  "function raiseHoldersBps(address token, uint16 newBps)",
  "function transferCreator(address token, address newCreator)",
  "function creatorOf(address token) view returns (address)",
  "function holdersBps(address token) view returns (uint16)",
  "function assetOf(address token) view returns (address)",
  "function creatorClaimable(address token, address recipient) view returns (uint256)",
  "error OnlyCreator()",
  "error NotRaised()",
  "error TooHigh()",
]);
```

| Call | Selector | Rule | Reverts |
|---|---|---|---|
| `raiseHoldersBps(address token, uint16 newBps)` | `0x92ba7d9c` | Raise-only: `newBps` above the current value, at most 10000. Applies to every later fee | `OnlyCreator()` not the creator; `NotRaised()` not above the current value; `TooHigh()` above 10000 |
| `transferCreator(address token, address newCreator)` | `0xf82e9b9d` | Hands creator control (future fees, `raiseHoldersBps`, the next transfer) to another address; you cannot undo it (only the new creator could hand it back). Only on an explicit instruction from whoever you act for. Moves future earnings only: what was credited before stays with the old address; claim it first, or later with `claimAllFor(oldAddress, [token])` ([`../../claim/SKILL.md`](../../claim/SKILL.md)) | `OnlyCreator()` also for the zero address, the hook, the factory, the ledger, the PoolManager or the token as `newCreator` |

- Simulated on Base mainnet, 2026-10-05: `raiseHoldersBps` 6000 to 6001 from the creator ok, gas 31,444; equal value reverts `NotRaised()`, 10001 reverts `TooHigh()`, another sender reverts `OnlyCreator()`.
- Simulated on Base mainnet, 2026-10-05: `transferCreator` to a new wallet from the creator ok, gas 30,054; to the ledger reverts `OnlyCreator()`.

## Claim your fees

The creator slot accrues in the ledger in the paired asset; anyone can push it to
`creatorOf(token)` with `claimFor(token, 0)`. Reading `claimable(token, 0)` and claiming,
alone or across tokens with `claimAllFor`, is [`../../claim/SKILL.md`](../../claim/SKILL.md),
rewards ledger section.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|------|---------|
| B420RewardsFactory: `launch`, `predictToken`, `byNameSymbol`, `isRewardsToken`, `pairedOf`, `poolKeyOf`, `tokenCount` (2 on 2026-10-05) | `0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31` |
| B420RewardsHook: the 1% fee, the pool, the locked position, the ETH-pair B420 buyback | `0x2d04aCae52491E882dd6D606F3A8160945fA2aeC` |
| B420RewardsLedger: creator, treasury, collector, staking slots; `raiseHoldersBps`, `transferCreator` | `0x8e95B431B70094B66836074B01c380A4935B7d49` |
| B420RewardsRouter (trading, see trade/rewards-token) | `0x383156D66BdA2369c6eE061C66aa3D32E38cec72` |
| Uniswap v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Strategic Reserve (TREASURY slot) | `0xA3320DCaFAa124173fdf7BD18EcD85abBA325590` |
| FeeCollector v2 (COLLECTOR slot; not eligible for dividends) | `0x22F005aa2b90E06C642C7462388b9d212D6344d8` |
| StakingB69 (STAKING slot, B420 buyback destination) | `0x82E6b3CEE079432F31D64855ed3DD5faCA71d309` |
| NVDAc, example ERC-20 pair (8 dec) | `0xb20000000000000000000078ee7ce2fE4908108C` |
| Live rewards tokens: RWT3U6F (ETH pair, holdersBps 6000), RWS8222 (NVDAc pair, holdersBps 10000) | `0x550F0Dc867c6BD39c2a09874109b62414081b420`, `0x4E0fDAcc7d20C8Ce25B46bB584b5d20bc29db420` |

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `BadVanity(address)` | `0x32476710` | Sent from a wallet other than `prep.sender`, or an edited name, symbol, supply or pair | Prepare again with `sender` = your signing wallet; send the params unchanged |
| `BadValue()` | `0x0bba69fb` | ETH pair `value` not equal to `devBuy`, or ETH sent with an ERC-20 pair | Send `prep.value` exactly |
| `NameTaken(address)` | `0xedf7405f` | Exact (name, symbol) already launched by this factory | Pick another name or ticker |
| `EmptyName()` | `0x2ef13105` | Empty name or symbol | Pass both |
| `BadHoldersBps()` | `0x05916844` | `holdersBps` 0 or above 10000 | 1 to 10000 |
| `BadSupply()` | `0xec4ebdaf` | Supply not a whole number of tokens from 1 to 999,999,999,999,999 | Fix `supply` and prepare again |
| `BadPairedAsset()` | `0x4f2f8a54` | The paired address has no code | Pass a token contract, or omit it for native ETH |
| `BadTick()` | `0xbad690b4` | Edited `startingTick` (not a multiple of 200, or out of range) | Send the prepared params unchanged |
| `BadCreator(address)` | `0x00281bd9` | `creator` is the hook, ledger, PoolManager, factory or the token | Use a wallet you control |
| `DevBuyFailed()` | `0xfcb842e1` | The dev buy swap filled nothing or not the full amount | Lower the dev buy, prepare again |
| `InsufficientGas()` | `0x1c26714c` | ETH-pair dev buy sent with a gas limit that cuts the 1M-gas buyback | Use the ETH dev buy gas rule (agent rule 5) |
| `ERC20InsufficientAllowance(address,uint256,uint256)` | `0xfb8f41b2` | ERC-20 pair dev buy without the approval | Approve `approval.amount` to the factory first |
| `InsufficientAllowance(address,uint256,uint256)` | `0x192b9e4e` | Same, on a B20 paired asset (tokenized stocks) | Approve first; wait a block after it lands |
| `InsufficientBalance(address,uint256,uint256)` | `0xdb42144d` | B20 paired asset balance below the dev buy | Lower the dev buy |
| `OnlyCreator()` | `0x47bc7cc8` | Ledger call from a wallet that is not `creatorOf(token)`, or a forbidden `newCreator` | Send from the creator; pick a wallet |
| `NotRaised()` | `0x9d9d48c1` | `raiseHoldersBps` not above the current value | Pass a higher value |
| `TooHigh()` | `0xf2034b4e` | `raiseHoldersBps` above 10000 | At most 10000 |
| API 409 `duplicate` | n/a | Name and ticker taken | Pick another name or ticker |
| API 503 `closed` / `busy` | n/a | Launch form closed / salt search timed out | Stop / prepare again |

## What this is NOT

- Not a classic B20: no LP locker, no creator slice on a locker, no airdrop, no holder
  distributor; that is [`../classic/SKILL.md`](../classic/SKILL.md).
- Not reversible: `holdersBps` only goes up, and the split constants never change.
- Not an index: index creation is closed to the public.
- Not tradeable through an aggregator or the Universal Router: use the rewards router
  ([`../../trade/rewards-token/SKILL.md`](../../trade/rewards-token/SKILL.md)).

## Related skills

- [`../SKILL.md`](../SKILL.md): launch agent rules, status and name check, POST /api/launch/confirm
- [`../classic/SKILL.md`](../classic/SKILL.md): classic B20 launch on factory v2
- [`../../trade/rewards-token/SKILL.md`](../../trade/rewards-token/SKILL.md): buy and sell rewards tokens, the ETH-pair gas rule
- [`../../claim/SKILL.md`](../../claim/SKILL.md): claimDividend, ledger claimFor and claimAllFor
- [`../../keeper/SKILL.md`](../../keeper/SKILL.md): hook flush, claimDividendFor batches, ledger slots for others
- [`../../SKILL.md`](../../SKILL.md): signer modes, money rules, address book

## License

CC0.
