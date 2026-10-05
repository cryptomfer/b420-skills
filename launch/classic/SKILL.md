---
name: b420-launch-classic
version: 1.0.0
description: "Launch a classic B20 on the B420 Factory v2 as an AI agent: POST https://b420.io/api/launch returns the mined config, the predicted address and the exact value, then one deployToken call (payable) from your wallet. Custom supply, any quote with enough liquidity (WETH by default, B420 or a tokenized stock), creator fees in both assets or the quote only, optional dev buy, shareWithHolders (creator slice to a holder distributor), list-based airdrop with lockup and vesting. Covers restoring the config bigints, gas, the creator slice management calls and every factory revert. Factory v1 is deprecated. AGENT RULES: REWARDRECIPIENT IS YOUR SIGNING WALLET, RESTORE EVERY BIGINT, SEND PREP.VALUE EXACTLY, AIRDROPS FROM A LIST ONLY. Works with any signer: viem / private key, Bankr /wallet/submit, or printed raw calldata for CDP, Safe and relayers. Holder-rewards launches are launch/rewards/."
homepage: https://b420.io
api_base: https://b420.io/api
chain: base (8453)
factory_v2: 0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575
lp_locker_v2: 0x351C934d698eB3c0683066D2fbD6CE7215573Bc4
hook: 0x13810528fcF203CD05b96e8eB978D9855F01A8Cc
fee_locker: 0x20835181fD6F4e62AA8d630A89b0e5c8676808C6
mev_module: 0x0028D5788aa5526Ab38920576c93A46048b09CD1
distributor_factory: 0x049B3Ee15c41163458073072e9573BF0fb88D5d4
distributor_extension: 0x79e3103B568eEF64c376cE3fCF0196342f56108D
airdrop_extension: 0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2
---

# B420 Classic Launch: Skill for AI Agents

Launch a **B20** (Base's native token standard, minted through the chain precompile) on
the B420 Factory v2 on **Base (chainId 8453)**. **One `deployToken` transaction mints the
token at an address ending in `b420`, creates its Uniswap v4 pool behind the static-fee
hook, locks all the liquidity forever in LP locker v2 and wires the 50/50 fee split that
the factory enforces.** b420.io does the work that needs care: `POST /api/launch` resolves
the quote's price, mines the vanity salt, builds the full `DeploymentConfig` (bigints as
strings), simulates the exact transaction and answers with the predicted address and the
exact `value`. Your wallet restores three bigints and sends it.

The token has no admin (`tokenConfig.tokenAdmin` is always the zero address, which the
salt is mined for) and a fixed supply. You keep one thing: the creator fee slice, which you
receive and administer.

> **Read first:** signer modes, money rules, fee policy and the address book live in the [root router](../../SKILL.md). The launch agent rules, the name check and the confirm call live in the [launch router](../SKILL.md).

> **Factory v1 is deprecated.** `0x760AFca74b37B7D8a5a2b062eCB9DBDC3f0018fE` reverts every
> `deployToken` with `Deprecated()` (`0xc73b9d7c`). Take the factory from the prepare
> response, assert it equals factory v2 `0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575`, and
> never copy a launch sample from b420.io/docs or `@b420/sdk`.

> **The prepare is single-use.** A dev buy quote goes stale within a minute or two and an
> airdrop prepare writes its merkle tree against the predicted address. Prepare, simulate,
> send, in one pass; anything changed means a new prepare.

## Agent rules

1. **`rewardRecipient` is your signing wallet.** It becomes the creator slice's recipient
   AND its admin (`rewardAdmins[0]`), the dev buy recipient and the airdrop admin. Another
   address hands all four away; with `shareWithHolders` the slice goes to the distributor
   instead (section "Options in depth").
2. **Restore every bigint before encoding.** The JSON carries `tokenConfig.originatingChainId`,
   `tokenConfig.supply` and every `extensionConfigs[].msgValue` as strings. A string
   `msgValue` fails viem's encoder; the stale SDK leaves it as a string, which is why its
   dev buy launches fail.
3. **Send `prep.value` exactly.** It is the sum of `extensionConfigs[].msgValue` (0 without
   a dev buy); anything else reverts `ExtensionMsgValueMismatch()` (`0xbc9b8348`). Check the
   sum yourself before signing.
4. **Gas: estimate x 1.5 from a real Base node, or 3,000,000 when the estimate fails.**
   `deployToken` mints through the B20 precompile (code `0xef`), which third-party wallet
   simulators cannot run: without an explicit limit they substitute their own failed
   estimate and refuse.
5. **Quote: governed, or checked first.** WETH, USDC, B420 and the 10 registry stocks skip
   the depth floor. Any other quote needs a market of at least $5,000: `GET /api/launch-stocks`
   lists the eligible non-registry tokenized stocks, `GET /api/launch?quote=0x…` checks any
   address (400 from the prepare otherwise).
6. **Airdrops from a list only.** `source: "snapshot"` needs a snapshot id from
   `/api/airdrop/snapshot`, which needs a b420.io login. An airdrop prepare writes rows;
   run it once, right before sending.

## The economics: enforced onchain

Every swap pays the pool's 1% LP fee into the locked position; LP locker v2 collects it
(the live hook hands each swap's fee over in `afterSwap`) and splits it by `rewardBps`:

| Share | Recipient | Asset |
|-------|-----------|-------|
| **50%** | **You**: slice 0, recipient and admin `rewardRecipient`, or the holder distributor with `shareWithHolders` | Both pool currencies in kind (`creatorFeeIn: "both"`, FeeIn 0), or the quote alone (`"quote"`, FeeIn 1: the locker sells the token side into the pool at each collection) |
| **50%** | FeeCollector v2 `0x22F005aa2b90E06C642C7462388b9d212D6344d8` (last slice, admin protocolAdmin `0xa1aB6Eb729c08B774798418b95D9C00D6Ec73527`) | Both currencies in kind (FeeIn 0, enforced) |

FeeCollector v2 splits each asset's income 40% to the Strategic Reserve (in kind), 30% bought
into B420 for StakingB69 stakers and 30% bought into registry stocks for StakingB420 stakers
([`../../staking/SKILL.md`](../../staking/SKILL.md); the permissionless run is
[`../../keeper/SKILL.md`](../../keeper/SKILL.md)).

The factory checks the split on every `deployToken` (`_checkB420Split`): the last slice must
be 5000 bps paid to `feeCollector()`, administered by `protocolAdmin()`, in FeeIn Both; the
creator slices must sum to 5000 bps and none may be FeeIn Clanker (2). Anything else reverts
`B420InvalidProtocolSplit()` (`0xef679a7d`), and a token address not ending in `b420`
reverts `B420VanitySuffixRequired()` (`0x661492fd`). Nobody can launch a B420 token with a
different split, and a launch carries no fee of its own: `value` funds the dev buy and
nothing else.

## 1. Prepare: POST /api/launch

Run the name check of the [launch router](../SKILL.md#1-status-and-name-check) first, then:

```js
const body = {
  name: "My Token",                 // required, at most 48 characters (longer is cut)
  symbol: "MYT",                    // required, at most 12 characters, uppercased (longer is cut)
  rewardRecipient: "0xYourWallet",  // required: your signing wallet (agent rule 1)
  supply: "1000000000",             // whole tokens as digits, 1 to 999999999999999; default 1,000,000,000
  pairedTokenAddress: "0x4200000000000000000000000000000000000006", // quote; default WETH
  creatorFeeIn: "both",             // "both" (default) or "quote"
  devBuyEth: "0.01",                // optional first buy in ETH, above 0, at most 50
  shareWithHolders: true,           // optional: creator slice to a holder distributor, permanently
  airdrop: {                        // optional, list only (agent rule 6)
    bps: 500,                       // 1..9000: 0.01% to 90% of the supply
    lockupDays: 7,                  // at least 1
    vestingDays: 30,                // at least 0
    source: "list",
    list: "0xAlice,2\n0xBob\n0xCarol,1.5", // one recipient per line, optional weight
  },
  image: "ipfs://…",                // optional, an https or ipfs URL you host; written into the token
  description: "…",                 // optional, at most 500 characters, written into the token metadata
  website: "https://…",             // optional https URL (at most 200 characters; anything else is dropped)
  twitter: "@handle",               // optional handle or URL, stored as https://x.com/handle
  telegram: "https://t.me/…",       // optional https URL
  discord: "https://discord.gg/…",  // optional https URL
};
const res = await fetch("https://b420.io/api/launch", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const prep = await res.json();
```

| Response field | Meaning |
|---|---|
| `success` | `true` on 200 |
| `factory` | The factory to call: factory v2, `0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575` |
| `chainId` | `8453` |
| `config` | The full `DeploymentConfig` (`tokenConfig`, `poolConfig`, `lockerConfig`, `mevModuleConfig`, `extensionConfigs`), bigints as strings |
| `predictedAddress` | Where the token mints (ends in `b420`) |
| `startingTick` | The pool's opening tick |
| `value` | The exact wei to send (decimal string) |
| `devBuy` | With a dev buy: `{ amountWei, venue, expectedPairedOut }` |
| `holdersDistributor` | With `shareWithHolders`: the distributor address paid by the creator slice |
| `airdrop` | With an airdrop: `{ bps, recipients, total, merkleRoot, lockupSeconds, vestingSeconds }` |
| `warnings` | Non-blocking notes, for example no image |

| Status | Cause | Do |
|---|---|---|
| 200 | Prepared and simulated by the server | Section 2 |
| 400 | A validation message, a quote refused (no price, under $5,000, decimals above 18), no dev buy venue, or `This launch would fail on chain and was not sent: <reason>` | Fix the input the message names, prepare again |
| 409 | `{ code: "duplicate", existing: { token, name, symbol, launchedAt } }` | Pick another name or ticker |
| 502 | The distributor address could not be read | Retry in a minute |
| 503 | Launches paused, factory not configured, or an extension not configured | Stop; read `GET /api/launch` |

The server builds a fixed layout: the degen liquidity preset (about $3,600 opening valuation
at any supply), the 1%/1% static fee, one position `[startingTick, 887200]` holding the whole
pool supply, `rewardBps [5000, 5000]`, `rewardAdmins [you, protocolAdmin]`,
`rewardRecipients [you, FeeCollector v2]`, the MEV block delay module (2 blocks) and, in this
order, the airdrop, dev buy and distributor extensions you asked for.

## 2. Restore the bigints

```js
const c = prep.config;
const config = {
  ...c,
  tokenConfig: {
    ...c.tokenConfig,
    originatingChainId: BigInt(c.tokenConfig.originatingChainId),
    supply: BigInt(c.tokenConfig.supply),
  },
  extensionConfigs: c.extensionConfigs.map((e) => ({ ...e, msgValue: BigInt(e.msgValue) })),
};
const value = BigInt(prep.value);
const sum = config.extensionConfigs.reduce((s, e) => s + e.msgValue, 0n);
if (sum !== value) throw new Error("value differs from the extensions' msgValue sum: do not send");
if (prep.factory.toLowerCase() !== "0x0b5e30e8d5fdd6257f4eb293dfc3121b0207f575") throw new Error("not factory v2");
```

Also check that `config.lockerConfig.rewardRecipients[0]` and `rewardAdmins[0]` are your
wallet (or `prep.holdersDistributor`). Every other field is already in viem's shape.

## 3. Simulate and send deployToken

```js
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const FACTORY_ABI = parseAbi([
  "struct TokenConfig { address tokenAdmin; string name; string symbol; bytes32 salt; string image; string metadata; string context; uint256 originatingChainId; uint256 supply; }",
  "struct PoolConfig { address hook; address pairedToken; int24 tickIfToken0IsClanker; int24 tickSpacing; bytes poolData; }",
  "struct LockerConfig { address locker; address[] rewardAdmins; address[] rewardRecipients; uint16[] rewardBps; int24[] tickLower; int24[] tickUpper; uint16[] positionBps; bytes lockerData; }",
  "struct MevModuleConfig { address mevModule; bytes mevModuleData; }",
  "struct ExtensionConfig { address extension; uint256 msgValue; uint16 extensionBps; bytes extensionData; }",
  "struct DeploymentConfig { TokenConfig tokenConfig; PoolConfig poolConfig; LockerConfig lockerConfig; MevModuleConfig mevModuleConfig; ExtensionConfig[] extensionConfigs; }",
  "function deployToken(DeploymentConfig deploymentConfig) payable returns (address tokenAddress)",
  "function deprecated() view returns (bool)",
  "error B420InvalidProtocolSplit()",
  "error B420VanitySuffixRequired()",
  "error Deprecated()",
  "error ExtensionMsgValueMismatch()",
  "error InvalidSupply()",
]);

const account = privateKeyToAccount(process.env.PRIVATE_KEY);   // from env only, never printed
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const wallet = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });
const call = { address: prep.factory, abi: FACTORY_ABI, functionName: "deployToken", args: [config], account, value };

const { result } = await pub.simulateContract(call);              // result: the token, = predictedAddress
let gas = 3_000_000n;                                             // fallback when the estimate fails
try { gas = ((await pub.estimateContractGas(call)) * 15n) / 10n; } catch {}
const hash = await wallet.writeContract({ ...call, gas });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
```

Bankr, CDP, Safe or a relayer: encode the same call (`encodeFunctionData`) and submit
`{ to: prep.factory, data, value, gas, chainId: 8453 }` as described in the
[root router](../../SKILL.md); the example prints exactly that with `--print`.

Measured with [`../examples/launch-classic.mjs`](../examples/launch-classic.mjs) and the
same prepares:

- Simulated on Base mainnet, 2026-10-05: plain WETH launch (1,000,000,000 supply) ok, gas 1,362,083.
- Simulated on Base mainnet, 2026-10-05: WETH launch with a 0.001 ETH dev buy (value 0.001 ETH) ok, gas 1,958,077.
- Simulated on Base mainnet, 2026-10-05: `shareWithHolders` with `creatorFeeIn: "quote"` (distributor created in the launch) ok, gas 1,779,192.
- Simulated on Base mainnet, 2026-10-05: B420 quote, 420,000 supply, `--print` raw transaction ok, gas about 1,361,900 (limit 2,042,864).

```bash
node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --from 0xYourWallet          # prepare + simulate
PRIVATE_KEY=0x… node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --dev-buy 0.01 --send
node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --from 0xYourWallet --print  # raw tx JSON
```

## 4. Confirm

`POST https://b420.io/api/launch/confirm { txHash }` right after the receipt, with the
retry rule of the [launch router](../SKILL.md#3-confirm-post-apilaunchconfirm). The token
page is `https://b420.io/terminal/<token>`. The pool trades from 2 blocks after the launch
block ([`../../trade/SKILL.md`](../../trade/SKILL.md)).

## Options in depth

**`pairedTokenAddress` (the quote).** WETH by default. Any contract with 0 to 18 decimals and
a live price can be the quote; the server prices it, shifts the starting tick so the opening
valuation stays about $3,600, and refuses a non-governed quote whose deepest market holds
under $5,000. Governed (no floor): WETH, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
B420 `0xB200000000000000000000231d6C1F1CE455ba32` and the registry stocks
(`allStocks()` on B420StockRegistry). Other tokenized stocks: `GET /api/launch-stocks`
returns `{ assets: [{ address, symbol, ticker, name, issuer, decimals, liqUsd }], minLiqUsd }`
(Coinbase stocks 8 decimals, ST0x 18). A non-WETH quote is traded through the hop router
([`../../trade/classic/SKILL.md`](../../trade/classic/SKILL.md)).

**`creatorFeeIn`.** `"both"` (default) pays your 50% in kind in both pool currencies;
`"quote"` pays it in the quote alone (FeeIn Paired): at each collection the locker sells the
token-side fee into the launch pool, with no slippage bound, so a sandwich can take part of
that one collection's token-side fee. Changeable later with `updateFeePreference`. With
`shareWithHolders` it sets the holders' currency instead.

**`devBuyEth`.** Your first buy, inside the launch transaction, before the MEV module arms:
no 2-block wait and no sniper ahead of you. Above 0 and at most 50 ETH (more is refused:
buy from the token page instead). On a WETH pair the dev-buy v4 extension
`0xa7F7493169121e9773BC0fb6C6B140b15E625ac3` swaps the ETH straight into the new pool. On
any other quote the server first quotes Uniswap v3, Uniswap v4 and the 0x and Kyber
aggregators for ETH to the quote and picks the best first hop (`devBuy.venue`), bounded at
95% of its quote: extension v3 `0xcd55479Ca4618337E8FC89d6A34db27EaC588f4B`, v4, or the
aggregator dev buy `0x044f974b7e793124029C0c27eedbfb749e1e1e0B`; then it buys your token in
the new pool. The tokens go to `rewardRecipient`; the buy is a swap in the new pool, so the
pool's 1% LP fee applies to it. `value` equals the dev buy amount. A first-hop quote that
moved reverts the whole launch: prepare again.

**`supply`.** Whole tokens, 1 to 999,999,999,999,999, default 1,000,000,000; the factory
mints exactly that (18 decimals) and seeds the pool with it minus any airdrop share. The
starting tick is log-shifted from the supply so the opening valuation is the same at any
supply.

**`shareWithHolders`.** The creator slice's recipient AND admin become
`B420FeeDistributorFactory.predict(token, quote)` (`prep.holdersDistributor`), and the
distributor extension `0x79e3103B568eEF64c376cE3fCF0196342f56108D` creates that contract inside
`deployToken`; the extension reverts `NotRoutedToDistributor(address)` (`0xc6673d9b`) unless
the slice pays the predicted address as recipient and admin. This is permanent: the
distributor has no code that calls the locker, so nobody (you, the platform) can redirect
the slice again. Holders claim through the distributor
([`../../claim/SKILL.md`](../../claim/SKILL.md)); syncing it is a keeper action
([`../../keeper/SKILL.md`](../../keeper/SKILL.md)). Never call the distributor factory's
`create()` yourself.

**`airdrop`.** `bps` (1 to 9000) of the supply goes to the airdrop extension v2
`0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2` at mint, released against a merkle root the
server builds from your list: claims open after `lockupDays` (at least 1, the extension
refuses less with `AirdropLockupDurationTooShort()`), vest linearly over `vestingDays`, and
14 days after lockup plus vesting the admin (`rewardRecipient`) can take back what nobody
claimed. List format, exactly as the route parses it: one recipient per line, `address` or
`address,weight` (separator comma, semicolon, tab or spaces), lines starting with `#` or
`//` skipped, duplicates summed, the zero address and `0x000000000000000000000000000000000000dEaD` refused. Weights are
proportions: the pot (`supply x bps / 10000`) is split by weight, a line without one
weighs 1, and the rounding remainder goes to the largest entry. The server writes the tree
against `predictedAddress` and serves the proofs to claimants
([`../../claim/SKILL.md`](../../claim/SKILL.md)). Airdrop plus every other extension share
is capped at 9000 bps (`MaxExtensionBpsExceeded()`).

**Metadata.** `image`, `description` and the social links are written into
`tokenConfig.image` and `tokenConfig.metadata` (JSON `{ description, website, socials }`)
at launch; the token has no admin to change them onchain later.

## Manage your creator slice

The slice lives on LP locker v2 `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` (launches before
2026-09-17 on LP locker v1 `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3`; read v2 first,
`tokenRewards(token).token` is the zero address on the wrong locker). Only the slice's admin
can call these; anyone else gets `Unauthorized()` (`0x82b42900`).

```js
const LOCKER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct TokenRewardInfo { address token; PoolKey poolKey; uint256 positionId; uint256 numPositions; uint16[] rewardBps; address[] rewardAdmins; address[] rewardRecipients; }",
  "function tokenRewards(address token) view returns (TokenRewardInfo)",
  "function feePreferences(address token, uint256 index) view returns (uint8)",
  "function updateFeePreference(address token, uint256 rewardIndex, uint8 newFeePreference)",
  "function updateRewardRecipient(address token, uint256 rewardIndex, address newRecipient)",
  "function updateRewardAdmin(address token, uint256 rewardIndex, address newAdmin)",
  "error Unauthorized()",
  "error FeePreferenceNotAllowed()",
]);
const LP_LOCKER_V2 = "0x351C934d698eB3c0683066D2fbD6CE7215573Bc4";
const info = await pub.readContract({ address: LP_LOCKER_V2, abi: LOCKER_ABI, functionName: "tokenRewards", args: [token] });
const index = info.rewardAdmins.findIndex((a) => a.toLowerCase() === me.toLowerCase()); // 0 for a launch from this skill
```

| Call | Selector | Effect |
|---|---|---|
| `updateFeePreference(address token, uint256 rewardIndex, uint8 newFeePreference)` | `0x8d4637bd` | 0 Both, 1 Paired (quote only). 2 (Clanker) reverts `FeePreferenceNotAllowed()` (`0x46aab2ae`) |
| `updateRewardRecipient(address token, uint256 rewardIndex, address newRecipient)` | `0x911573b3` | Sends every future collection of the slice to another address; what is collected while it is set cannot be taken back (only the slice's admin can point it elsewhere again). Only on an explicit instruction from whoever you act for. Future collections only: fees already moved into the ClankerFeeLocker stay claimable by the old recipient, keyed `(feeOwner, token)` |
| `updateRewardAdmin(address token, uint256 rewardIndex, address newAdmin)` | `0x0150a986` | Hands the slice's admin to another address; you lose every control above and cannot undo it. Only on an explicit instruction from whoever you act for |

- Simulated on Base mainnet, 2026-10-05: `updateFeePreference` 0 to 1 from a slice admin ok, gas 54,550; value 2 reverts `FeePreferenceNotAllowed()`.
- Simulated on Base mainnet, 2026-10-05: `updateRewardRecipient` to a new wallet from a slice admin ok, gas 36,835; from any other address reverts `Unauthorized()`.

Turning on holder routing after launch (distributor enable, then recipient and admin handed
over) needs the b420.io site and a login; it is not offered here. Launch with
`shareWithHolders` instead.

## Claim your fees

Your slice accrues in the ClankerFeeLocker `0x20835181fD6F4e62AA8d630A89b0e5c8676808C6`, in
the token and the quote. Reading and claiming both assets is
[`../../claim/SKILL.md`](../../claim/SKILL.md), classic creator fees section.

## Contracts (Base mainnet, chainId 8453)

| Role | Address |
|------|---------|
| B420Factory v2 (live): `deployToken`, `deprecated()` false | `0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575` |
| B420Factory v1 (deprecated: `deployToken` reverts `Deprecated()`) | `0x760AFca74b37B7D8a5a2b062eCB9DBDC3f0018fE` |
| Static-fee hook (1% LP fee, fee claim in `afterSwap`) | `0x13810528fcF203CD05b96e8eB978D9855F01A8Cc` |
| LP locker v2: `tokenRewards`, `feePreferences`, slice updates | `0x351C934d698eB3c0683066D2fbD6CE7215573Bc4` |
| LP locker v1 (launches before 2026-09-17) | `0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3` |
| ClankerFeeLocker (creator fees wait here) | `0x20835181fD6F4e62AA8d630A89b0e5c8676808C6` |
| MEV block delay module (`blockDelay()` 2) | `0x0028D5788aa5526Ab38920576c93A46048b09CD1` |
| Fee distributor factory (`predict(token, quote)`; never call `create()`) | `0x049B3Ee15c41163458073072e9573BF0fb88D5d4` |
| Distributor extension (creates the distributor in the launch) | `0x79e3103B568eEF64c376cE3fCF0196342f56108D` |
| Airdrop extension v2 | `0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2` |
| Dev buy v4 extension (WETH pairs, v4 first hop) | `0xa7F7493169121e9773BC0fb6C6B140b15E625ac3` |
| Dev buy v3 extension (v3 first hop) | `0xcd55479Ca4618337E8FC89d6A34db27EaC588f4B` |
| Aggregator dev buy extension (0x or Kyber first hop) | `0x044f974b7e793124029C0c27eedbfb749e1e1e0B` |
| FeeCollector v2 (protocol slice of every new launch) | `0x22F005aa2b90E06C642C7462388b9d212D6344d8` |
| protocolAdmin (admin of the protocol slice) | `0xa1aB6Eb729c08B774798418b95D9C00D6Ec73527` |
| WETH (default quote, 18 dec) | `0x4200000000000000000000000000000000000006` |

## Errors you might hit

| Error | Selector | Cause | Fix |
|---|---|---|---|
| `Deprecated()` | `0xc73b9d7c` | `deployToken` on factory v1 (or v2 closed by its owner) | Send to factory v2; if v2 reads `deprecated()` true, stop |
| `ExtensionMsgValueMismatch()` | `0xbc9b8348` | `value` differs from the sum of `msgValue` | Send `prep.value` exactly, restored as a bigint |
| `B420InvalidProtocolSplit()` | `0xef679a7d` | A hand-edited `lockerConfig` (split, recipient, admin or FeeIn) | Send the prepared config unchanged |
| `B420VanitySuffixRequired()` | `0x661492fd` | Edited `salt`, `tokenAdmin`, name or factory | Send the prepared config unchanged, to `prep.factory` |
| `OnlyOriginatingChain()` | `0xc0112c87` | `originatingChainId` not 8453, or sent on another chain | Send on Base with the restored config |
| `InvalidSupply()` | `0x15ae6727` | Supply out of 1e18 to 1e36 base units, or nothing left for the pool | Prepare again with a valid `supply` |
| `MaxExtensionBpsExceeded()` | `0x4505155c` | Extension supply shares above 9000 bps | Lower `airdrop.bps` |
| `ExtensionNotEnabled()` | `0x5c9e702e` | An extension the factory does not enable | Use the prepared config |
| `AirdropLockupDurationTooShort()` | `0x8a5ab644` | Lockup under 1 day | `lockupDays` at least 1 |
| `InvalidAirdropPercentage()` | `0x52abc7c3` | Airdrop bps 0 or out of range | `airdrop.bps` from 1 to 9000 |
| `NotRoutedToDistributor(address)` | `0xc6673d9b` | Distributor extension without the slice paying the predicted distributor | Send the prepared `shareWithHolders` config unchanged |
| `DistributorNotCreated(address)` | `0x1f85eb62` | The distributor could not be created at the predicted address | Prepare again |
| `InvalidMsgValue()` | `0x1841b4e1` | ETH sent to an extension that takes none | Send the prepared config unchanged |
| `InvalidEthDevBuyPercentage()` | `0x1f832079` | Dev buy extension given a supply share | Send the prepared config unchanged |
| `InsufficientPairedOut(uint256,uint256)` | `0x5b6e9a1c` | The aggregator first hop moved below its minimum | Prepare again and send at once |
| `FirstHopFailed()` | `0x8019f616` | The aggregator first hop reverted (stale route) | Prepare again |
| `RouterNotAllowed(address)` | `0xc665406f` | First-hop router not allowlisted on the aggregator dev buy | Prepare again; never edit the route |
| `FeePreferenceNotAllowed()` | `0x46aab2ae` | `updateFeePreference(…, 2)` | Use 0 (Both) or 1 (Paired) |
| `Unauthorized()` | `0x82b42900` | Slice update from an address that is not that slice's admin | Send from `rewardAdmins[index]` |
| API 409 `duplicate` | n/a | Name and ticker already launched on B420 | Pick another name or ticker |
| API 400 `This launch would fail on chain…` | n/a | The server's own simulation reverted | Read the reason, fix the input, prepare again |
| API 400 quote refused | n/a | No price, under $5,000 of liquidity, or more than 18 decimals | Pick a governed quote or one from `/api/launch-stocks` |
| API 503 | n/a | Launches paused or an extension not configured | Stop; read `GET /api/launch` |

## What this is NOT

- Not factory v1, not the SDK's `launchWithDividend`, not a dividend vault: all closed.
- Not a holder-rewards token: holders paid automatically on every trade is
  [`../rewards/SKILL.md`](../rewards/SKILL.md).
- Not a snapshot airdrop: that needs a b420.io login to take the snapshot.
- Not a way to change the split: 50/50 is a factory constant.
- Not post-launch holder routing: that needs the site and a login.

## Related skills

- [`../SKILL.md`](../SKILL.md): launch agent rules, status and name check, POST /api/launch/confirm
- [`../rewards/SKILL.md`](../rewards/SKILL.md): holder-rewards launch on B420RewardsFactory
- [`../../trade/classic/SKILL.md`](../../trade/classic/SKILL.md): trade a classic launch (Universal Router v4, hop router)
- [`../../claim/SKILL.md`](../../claim/SKILL.md): claim creator fees, distributor and airdrop allocations
- [`../../keeper/SKILL.md`](../../keeper/SKILL.md): collectRewards, distributor sync, FeeCollector runs
- [`../../SKILL.md`](../../SKILL.md): signer modes, money rules, address book

## License

CC0.
