#!/usr/bin/env node
/**
 * B420 keeper: the permissionless maintenance calls, read first, simulated, sent only with --send.
 * Anyone may call them, nothing depends on them, the caller pays gas and receives nothing.
 *
 *   npm ci        (once, at the repo root)
 *   node keeper/examples/keeper.mjs                                        # status: what needs doing, read only
 *   node keeper/examples/keeper.mjs fund --collector v2 --from 0xAny       # simulate swapAndFund() from any address
 *   node keeper/examples/keeper.mjs fund --collector v2 --mins mins.json --from 0xAny   # the caller-minimum overload
 *   node keeper/examples/keeper.mjs forward 0xToken --collector v1 --from 0xAny
 *   node keeper/examples/keeper.mjs flush 0xRewardsTokenOrIndex --from 0xAny
 *   node keeper/examples/keeper.mjs collect 0xClassicToken --from 0xAny
 *   node keeper/examples/keeper.mjs sync 0xClassicToken --from 0xAny
 *   node keeper/examples/keeper.mjs pay-holders 0xToken --batch 50 --from 0xAny --print
 *   node keeper/examples/keeper.mjs ledger 0xRewardsToken --slot 3 --from 0xAny
 *   node keeper/examples/keeper.mjs ledger 0xRecipient --all 0xT1,0xT2 --from 0xAny
 *   PRIVATE_KEY=0x... node keeper/examples/keeper.mjs fund --send             # re-simulate and broadcast
 *
 * Actions: status (default) | fund | forward | flush | collect | sync | pay-holders | ledger
 *          fund [--collector v1|v2] [--mins <file.json>]; forward <token> [--collector v1|v2];
 *          flush <rewardsToken|index>; collect <classicToken>; sync <classicToken>;
 *          pay-holders <rewardsToken|index|classicToken> [--batch n]; ledger <token|index> --slot n;
 *          ledger <recipient> --all <t1,t2,...>. The collector defaults to v2.
 * Signer: PRIVATE_KEY (viem) or BANKR_API_KEY + BANKR_WALLET (Bankr /wallet/submit, raw calldata); none =
 *         simulate from --from and print. No owner or admin function is ever built here.
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, RPC_URL, FROM.
 * Exit: 0 ok (or nothing to do), 1 failure or a simulated revert, 2 usage.
 */
import { readFileSync } from "node:fs";
import { getAddress, isAddress, parseAbi } from "viem";
import {
  ADDR,
  INDEX_STACKS,
  ZERO,
  api,
  errorLine,
  exit,
  fail,
  fromUnits,
  getSigner,
  out,
  parseArgs,
  publicClient,
  runSteps,
  simulateSteps,
  tokenMeta,
  usage,
} from "../../examples/lib/b420.mjs";

const USAGE = `usage: node keeper/examples/keeper.mjs [status|fund|forward|flush|collect|sync|pay-holders|ledger] [target]
         [--collector v1|v2] [--mins <file.json>] [--slot 0..3] [--all t1,t2,...] [--batch <n>]
         [--from 0x..] [--send|--print] [--json]`;
const ACTIONS = ["status", "fund", "forward", "flush", "collect", "sync", "pay-holders", "ledger"];

// ── ABIs (b420-factory/src; each fragment is the one the SKILL.md section shows) ──
const REGISTRY_ABI = parseAbi(["function allStocks() view returns (address[])"]);
const COLLECTOR_V1_ABI = parseAbi([
  "function forward(address token)",
  "function swapAndFund()",
  "function swapAndFund(uint256 minB420Out, uint256[] minStockOuts)",
  "function params() view returns (uint256 minWethForFund, uint256 maxB420TrancheWeth, uint256 fundCooldown, uint256 maxDeviationBps)",
  "function keeperOnly() view returns (bool)",
  "function isKeeper(address) view returns (bool)",
  "function permissionlessFundingEnabled() view returns (bool)",
  "function lastFundAt() view returns (uint256)",
  "function carriedForConversion() view returns (uint256)",
  "function wethBalance() view returns (uint256)",
  "function pendingOf(address token) view returns (uint256)",
  "error WethNotForwardable()",
  "error NotConfigured()",
  "error TooSoon()",
  "error BelowThreshold()",
  "error LengthMismatch()",
  "error NotKeeper()",
  "error FundingDisabled()",
]);
const COLLECTOR_V2_ABI = parseAbi([
  "struct FundMins { uint256 b420Out; uint256[] stockOut; uint256 wethFromB420; uint256[] wethFromStock; }",
  "struct FundReport { uint256 b420Bought; uint256[] stockBought; uint256 wethFromB420; uint256[] wethFromStock; }",
  "function forward(address token)",
  "function swapAndFund() returns (FundReport)",
  "function swapAndFund(FundMins mins) returns (FundReport)",
  "function params() view returns (uint256 minWethForFund, uint256 maxB420TrancheWeth, uint256 maxB420SellTranche, uint256 maxStockTrancheWeth, uint256 maxStockSellTranche, uint256 legCooldown, uint256 maxDeviationBps, uint256 legGas)",
  "function keeperOnly() view returns (bool)",
  "function isKeeper(address) view returns (bool)",
  "function permissionlessFundingEnabled() view returns (bool)",
  "function lastFundAt() view returns (uint256)",
  "function wethBalance() view returns (uint256)",
  "function pendingOf(address token) view returns (uint256)",
  "function reservedOf(address asset) view returns (uint256)",
  "error TooSoon()",
  "error BelowThreshold()",
  "error LengthMismatch()",
  "error NotKeeper()",
  "error FundingDisabled()",
  "error InsufficientGas()",
  "error NotConfigured()",
]);
const FEE_LOCKER_ABI = parseAbi(["function availableFees(address feeOwner, address token) view returns (uint256)"]);
const REWARDS_FACTORY_ABI = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokenAt(uint256 i) view returns (address)",
  "function isRewardsToken(address) view returns (bool)",
  "function poolKeyOf(address token) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))",
]);
const REWARDS_HOOK_ABI = parseAbi([
  "function flush((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key)",
  "function poolIdOf(address token) view returns (bytes32)",
  "function pendingHolders(bytes32 poolId) view returns (uint256)",
  "error UnknownPool()",
  "error OpenDeltas()",
  "error Reentrant()",
]);
const REWARDS_TOKEN_ABI = parseAbi([
  "function rewardAsset() view returns (address)",
  "function dividendOf(address account) view returns (uint256)",
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
  "error InsufficientGas()",
]);
const REWARDS_LEDGER_ABI = parseAbi([
  "function claimable(address token, uint8 slot) view returns (uint256)",
  "function creatorOf(address token) view returns (address)",
  "function creatorClaimable(address token, address recipient) view returns (uint256)",
  "function treasuryClaimable(address token) view returns (uint256)",
  "function collectorClaimable(address token) view returns (uint256 stockLeg, uint256 b420Leg)",
  "function stakingClaimable(address token) view returns (uint256)",
  "function treasury() view returns (address)",
  "function collector() view returns (address)",
  "function stakingB69() view returns (address)",
  "function claimFor(address token, uint8 slot) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] tokens) returns (uint256 eth)",
  "error BadSlot()",
  "error NothingToClaim()",
  "error EthTransferFailed()",
  "error InsufficientGas()",
  "error CollectorPull(uint256 expected, uint256 pulled)",
]);
const INDEX_FACTORY_ABI = parseAbi([
  "function indexCount() view returns (uint256)",
  "function indexAt(uint256 i) view returns (address)",
  "function isIndex(address) view returns (bool)",
]);
const INDEX_HOOK_ABI = parseAbi([
  "function flush(address index)",
  "function pendingBuyback() view returns (uint256)",
  "function BUYBACK_MIN() view returns (uint256)",
  "function pendingCreatorFee(address index) view returns (uint256)",
  "function pendingOpsFee(address index) view returns (uint256)",
  "function pendingHolders(address index) view returns (uint256)",
  "error UnknownIndex()",
  "error Reentrant()",
]);
const INDEX_TOKEN_ABI = parseAbi([
  "function dividendOf(address account) view returns (uint256)",
  "function claimedBurn() view returns (uint256)",
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
  "error InsufficientGas()",
]);
const INDEX_LEDGER_ABI = parseAbi([
  "function claimable(address index, address recipient, address currency) view returns (uint256)",
  "function creatorOf(address index) view returns (address)",
  "function ops() view returns (address)",
  "function claimFor(address index, address recipient, address currency) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] indexes) returns (uint256 eth)",
  "error NothingToClaim()",
  "error EthTransferFailed()",
]);
const LOCKER_ABI = parseAbi([
  "function tokenRewards(address token) view returns ((address token, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 positionId, uint256 numPositions, uint16[] rewardBps, address[] rewardAdmins, address[] rewardRecipients))",
  "function collectRewards(address token)",
]);
const DISTRIBUTOR_FACTORY_ABI = parseAbi([
  "function distributorFor(address token) view returns (address)",
  "function allDistributors() view returns (address[])",
]);
// Distributor factories, current first. The previous generation still serves the distributors it created.
const DISTRIBUTOR_FACTORIES = [ADDR.distributorFactory, ADDR.distributorFactoryPrevious];
const DISTRIBUTOR_ABI = parseAbi([
  "struct BatchClaim { address currency; address account; uint256 cumulativeAmount; bytes32[] proof; }",
  "function token() view returns (address)",
  "function pairedToken() view returns (address)",
  "function claimed(address currency, address account) view returns (uint256)",
  "function sync()",
  "function claimMany(BatchClaim[] claims) returns (uint256 paid, uint256 skipped)",
]);

const read = (address, abi, functionName, args = []) => publicClient.readContract({ address, abi, functionName, args });
const tryRead = (address, abi, functionName, args = []) => read(address, abi, functionName, args).catch(() => null);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const nowSec = () => Math.floor(Date.now() / 1000);
const asAddr = (v, what) => {
  if (!v || !isAddress(String(v), { strict: false })) usage(`${what} must be an address, got ${v ?? "nothing"}.\n${USAGE}`);
  return getAddress(String(v));
};

const { _, flags } = parseArgs();
if (flags.help) usage(USAGE);
const action = String(_[0] || "status").toLowerCase();
if (!ACTIONS.includes(action)) usage(`Unknown action "${_[0]}".\n${USAGE}`);
// stdout carries only the result (JSON with --json, raw transactions with --print); notes go to stderr then
const log = (line) => (flags.json || flags.print ? process.stderr : process.stdout).write(`${line}\n`);
const COLLECTORS = {
  v1: { id: "v1", address: ADDR.feeCollectorV1, abi: COLLECTOR_V1_ABI },
  v2: { id: "v2", address: ADDR.feeCollectorV2, abi: COLLECTOR_V2_ABI },
};
const collectorOf = () => {
  const v = String(flags.collector || "v2").toLowerCase();
  if (!COLLECTORS[v]) usage(`--collector must be v1 or v2, got ${flags.collector}`);
  return COLLECTORS[v];
};
/** tokenMeta, or a placeholder for an address that is not an ERC-20 (never fails a status read). */
const meta = (token) => tokenMeta(token).catch(() => ({ address: token, symbol: `${String(token).slice(0, 8)}...`, decimals: 18 }));
const amt = async (raw, token) => {
  const m = await meta(token);
  return `${fromUnits(raw, m.decimals, 8)} ${m.symbol}`;
};

async function rewardsTokens() {
  const n = await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "tokenCount");
  return Promise.all(Array.from({ length: Number(n) }, (_x, i) => read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "tokenAt", [BigInt(i)])));
}
async function indexesOf(stack) {
  const n = await read(stack.factory, INDEX_FACTORY_ABI, "indexCount");
  return Promise.all(Array.from({ length: Number(n) }, (_x, i) => read(stack.factory, INDEX_FACTORY_ABI, "indexAt", [BigInt(i)])));
}
async function stackOfIndex(t) {
  for (const stack of INDEX_STACKS) if (await tryRead(stack.factory, INDEX_FACTORY_ABI, "isIndex", [t])) return stack;
  return null;
}
async function distributorOf(token) {
  for (const f of DISTRIBUTOR_FACTORIES) {
    const d = await read(f, DISTRIBUTOR_FACTORY_ABI, "distributorFor", [token]);
    if (!same(d, ZERO)) return d;
  }
  return null;
}

// ── Status: what needs doing ──
async function status() {
  const stocks = await read(ADDR.stockRegistry, REGISTRY_ABI, "allStocks");
  const assets = [ADDR.weth, ADDR.b420, ...stocks];
  const todo = [];
  const collectors = [];
  // the collectors' fee locker balances in every currency a classic launch trades in, plus the registry assets
  let currencies = assets;
  try {
    const launches = (await api("/launches?limit=200")).filter((r) => r.locker);
    const set = new Map(assets.map((a) => [a.toLowerCase(), a]));
    for (const l of launches) for (const c of [l.token, l.pairedToken || ADDR.weth]) set.set(c.toLowerCase(), getAddress(c));
    currencies = [...set.values()];
  } catch (e) {
    log(`warning: GET /api/launches failed (${e.message}): launch residues not listed.`);
  }
  let readiness = [];
  try {
    readiness = (await api("/buybacks")).collectors || [];
  } catch (e) {
    log(`warning: GET /api/buybacks failed (${e.message}): readiness read from the chain only.`);
  }
  for (const c of [COLLECTORS.v1, COLLECTORS.v2]) {
    const v2 = c.id === "v2";
    const [params, keeperOnly, permissionless, lastFundAt, wethBalance] = await Promise.all(["params", "keeperOnly", "permissionlessFundingEnabled", "lastFundAt", "wethBalance"].map((f) => read(c.address, c.abi, f)));
    const pend = await Promise.all(currencies.map((a) => read(c.address, c.abi, "pendingOf", [a])));
    const reserved = v2 ? await Promise.all(currencies.map((a) => read(c.address, c.abi, "reservedOf", [a]))) : null;
    const pending = [];
    for (let i = 0; i < currencies.length; i++) {
      if (pend[i] === 0n) continue;
      const m = await meta(currencies[i]);
      pending.push({ token: currencies[i], symbol: m.symbol, pendingOf: fromUnits(pend[i], m.decimals, 8), ...(v2 ? { reservedOf: fromUnits(reserved[i], m.decimals, 8) } : {}) });
      if (!same(currencies[i], ADDR.weth)) todo.push(`forward ${currencies[i]} --collector ${c.id}   (${m.symbol} pendingOf ${fromUnits(pend[i], m.decimals, 8)})`);
    }
    const r = readiness.find((x) => same(x.address, c.address)) || null;
    const p = v2
      ? { minWethForFund: params[0], maxB420TrancheWeth: params[1], maxB420SellTranche: params[2], maxStockTrancheWeth: params[3], maxStockSellTranche: params[4], legCooldown: params[5], maxDeviationBps: params[6], legGas: params[7] }
      : { minWethForFund: params[0], maxB420TrancheWeth: params[1], fundCooldown: params[2], maxDeviationBps: params[3] };
    const lockerWeth = await read(ADDR.feeLocker, FEE_LOCKER_ABI, "availableFees", [c.address, ADDR.weth]);
    const ready = v2 ? r && (!r.belowMinimum || r.stockBucketsToSell > 0) && (r.readyAt ?? 0) <= nowSec() : wethBalance + lockerWeth >= params[0] && Number(lastFundAt + params[2]) <= nowSec();
    if (!keeperOnly && permissionless && ready) todo.push(`fund --collector ${c.id}   (simulate first: legs may still skip)`);
    collectors.push({ version: c.id, address: c.address, keeperOnly, permissionlessFundingEnabled: permissionless, lastFundAt, wethBalance, wethInFeeLocker: lockerWeth, params: p, pending, readiness: r });
  }

  // rewards hook: parked holder parts per pool; rewards ledger slots 1 to 3
  const rewards = [];
  for (const t of await rewardsTokens()) {
    const pid = await read(ADDR.rewardsHook, REWARDS_HOOK_ABI, "poolIdOf", [t]);
    const [parked, s1, s2, s3, asset] = await Promise.all([
      read(ADDR.rewardsHook, REWARDS_HOOK_ABI, "pendingHolders", [pid]),
      read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "claimable", [t, 1]),
      read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "claimable", [t, 2]),
      read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "claimable", [t, 3]),
      read(t, REWARDS_TOKEN_ABI, "rewardAsset"),
    ]);
    const m = await meta(asset);
    const sym = (await meta(t)).symbol;
    if (parked > 0n) todo.push(`flush ${t}   (${sym} parked holder parts ${fromUnits(parked, m.decimals, 8)} ${m.symbol})`);
    [s1, s2, s3].forEach((v, i) => {
      if (v > 0n) todo.push(`ledger ${t} --slot ${i + 1}   (${sym} slot ${i + 1}: ${fromUnits(v, m.decimals, 8)} ${m.symbol})`);
    });
    let owed = null;
    try {
      const w = await api(`/rewards-launch/${t.toLowerCase()}/holders?wallets=1`);
      owed = { wallets: (w.owed || []).length, total: fromUnits(w.owedTotalRaw || "0", m.decimals, 8) };
      if (owed.wallets > 0) todo.push(`pay-holders ${t}   (${sym}: ${owed.wallets} holder(s) owed ${owed.total} ${m.symbol})`);
    } catch (e) {
      log(`warning: payout list of ${sym} unavailable (${e.message}).`);
    }
    rewards.push({ token: t, symbol: sym, asset: m.symbol, parkedHolders: fromUnits(parked, m.decimals, 8), ledgerSlots: { treasury: fromUnits(s1, m.decimals, 8), collector: fromUnits(s2, m.decimals, 8), staking: fromUnits(s3, m.decimals, 8) }, owedHolders: owed });
  }

  // index hooks and ledgers
  const indexes = [];
  for (const stack of INDEX_STACKS) {
    const [pendingBuyback, buybackMin] = await Promise.all([read(stack.hook, INDEX_HOOK_ABI, "pendingBuyback"), tryRead(stack.hook, INDEX_HOOK_ABI, "BUYBACK_MIN")]);
    const ops = await read(stack.ledger, INDEX_LEDGER_ABI, "ops");
    const list = [];
    for (const ix of await indexesOf(stack)) {
      const [cf, of, burn, parked, opsEth, opsShares] = await Promise.all([
        read(stack.hook, INDEX_HOOK_ABI, "pendingCreatorFee", [ix]),
        read(stack.hook, INDEX_HOOK_ABI, "pendingOpsFee", [ix]),
        read(ix, INDEX_TOKEN_ABI, "claimedBurn"),
        tryRead(stack.hook, INDEX_HOOK_ABI, "pendingHolders", [ix]), // v4 hooks only
        read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [ix, ops, ZERO]),
        read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [ix, ops, ix]),
      ]);
      const sym = (await meta(ix)).symbol;
      if (cf + of + burn > 0n || (parked ?? 0n) > 0n) todo.push(`flush ${ix}   (${sym}: pending fee shares ${fromUnits(cf + of, 18, 8)}, sold shares to burn ${fromUnits(burn, 18, 8)}${parked ? `, parked holder ETH ${fromUnits(parked, 18, 8)}` : ""})`);
      if (opsEth + opsShares > 0n) todo.push(`ledger ${ix} --slot 1   (${sym} ops: ${fromUnits(opsEth, 18, 8)} ETH, ${fromUnits(opsShares, 18, 8)} ${sym})`);
      let owed = null;
      try {
        const w = await api(`/index/${ix.toLowerCase()}/holders?wallets=1`);
        owed = { wallets: (w.owed || []).length, totalEth: fromUnits(w.owedTotalWei || "0", 18, 8) };
        if (owed.wallets > 0) todo.push(`pay-holders ${ix}   (${sym}: ${owed.wallets} holder(s) owed ${owed.totalEth} ETH)`);
      } catch (e) {
        log(`warning: payout list of ${sym} unavailable (${e.message}).`);
      }
      list.push({ index: ix, symbol: sym, pendingCreatorFeeShares: fromUnits(cf, 18, 8), pendingOpsFeeShares: fromUnits(of, 18, 8), claimedBurnShares: fromUnits(burn, 18, 8), parkedHoldersEth: parked === null ? "n/a (v3 hook)" : fromUnits(parked, 18, 8), opsClaimable: `${fromUnits(opsEth, 18, 8)} ETH + ${fromUnits(opsShares, 18, 8)} ${sym}`, owedHolders: owed });
    }
    indexes.push({ stack: stack.id, hook: stack.hook, pendingBuybackEth: fromUnits(pendingBuyback, 18, 8), buybackMinEth: buybackMin === null ? null : fromUnits(buybackMin, 18, 8), indexes: list });
  }

  // distributors (both factory generations): fees still in the fee locker
  const distributors = [];
  for (const f of DISTRIBUTOR_FACTORIES) {
    for (const d of await read(f, DISTRIBUTOR_FACTORY_ABI, "allDistributors")) {
      const [token, paired] = await Promise.all([read(d, DISTRIBUTOR_ABI, "token"), read(d, DISTRIBUTOR_ABI, "pairedToken")]);
      if (same(token, "0x000000000000000000000000000000000000dEaD")) continue; // an uninitialised clone: serves no launch
      const [a, b] = await Promise.all([read(ADDR.feeLocker, FEE_LOCKER_ABI, "availableFees", [d, token]), read(ADDR.feeLocker, FEE_LOCKER_ABI, "availableFees", [d, paired])]);
      const sym = (await meta(token)).symbol;
      if (a + b > 0n) todo.push(`sync ${token}   (${sym} distributor: ${await amt(a, token)} + ${await amt(b, paired)} in the fee locker)`);
      distributors.push({ token, symbol: sym, distributor: d, factory: f, unsynced: `${await amt(a, token)} + ${await amt(b, paired)}` });
    }
  }
  if (flags.json) out({ collectors, rewards, indexes, distributors, todo }, flags);
  else {
    out({ collectors, rewards, indexes, distributors }, flags);
    console.log(todo.length ? "todo (each one: simulate, send only if it does not revert):" : "todo: nothing pending");
    for (const t of todo) console.log(`  node keeper/examples/keeper.mjs ${t}`);
  }
}

async function main() {
  if (action === "status") {
    await status();
    return exit(0);
  }

  // Every action below simulates from the signer, or --from with no key (lib rule).
  const signer = getSigner(flags);
  const target = _[1];
  const steps = [];

  // ── 1. Fund the staking pools: swapAndFund ──
  if (action === "fund") {
    const c = collectorOf();
    const [keeperOnly, permissionless, params, lastFundAt, wethBalance] = await Promise.all(["keeperOnly", "permissionlessFundingEnabled", "params", "lastFundAt", "wethBalance"].map((f) => read(c.address, c.abi, f)));
    if (keeperOnly && !(signer.address && (await read(c.address, c.abi, "isKeeper", [signer.address])))) fail(`${c.id} keeperOnly() is true and the sender is not an allowlisted keeper: swapAndFund reverts NotKeeper. Do not call it.`);
    log(`collector ${c.id} ${c.address}: keeperOnly ${keeperOnly}, permissionlessFundingEnabled ${permissionless}, wethBalance ${fromUnits(wethBalance, 18, 8)} WETH, lastFundAt ${lastFundAt}, minWethForFund ${fromUnits(params[0], 18, 8)} WETH`);
    if (flags.mins) {
      const stocks = await read(ADDR.stockRegistry, REGISTRY_ABI, "allStocks");
      let m;
      try {
        m = JSON.parse(readFileSync(String(flags.mins), "utf8"));
      } catch (e) {
        usage(`--mins: cannot read ${flags.mins} as JSON (${e.message})`);
      }
      const arr = (v, name) => {
        if (!Array.isArray(v) || v.length !== stocks.length) usage(`--mins ${name} must have ${stocks.length} entries, in registry allStocks() order.`);
        return v.map((x) => BigInt(x));
      };
      if (c.id === "v1") steps.push({ label: `v1 swapAndFund(minB420Out, minStockOuts[${stocks.length}])`, to: c.address, abi: c.abi, functionName: "swapAndFund", args: [BigInt(m.minB420Out ?? 0), arr(m.minStockOuts, "minStockOuts")] });
      else steps.push({ label: `v2 swapAndFund(FundMins)`, to: c.address, abi: c.abi, functionName: "swapAndFund", args: [{ b420Out: BigInt(m.b420Out ?? 0), stockOut: arr(m.stockOut, "stockOut"), wethFromB420: BigInt(m.wethFromB420 ?? 0), wethFromStock: arr(m.wethFromStock, "wethFromStock") }] });
    } else {
      if (!permissionless) fail(`${c.id} permissionlessFundingEnabled() is false: swapAndFund() reverts FundingDisabled. Pass --mins <file.json> (see keeper/SKILL.md section 1).`);
      steps.push({ label: `${c.id} swapAndFund() (every minimum 0)`, to: c.address, abi: c.abi, functionName: "swapAndFund", args: [] });
    }
  }

  // ── 2. Forward a fee token: forward(token) ──
  if (action === "forward") {
    const c = collectorOf();
    const token = asAddr(target, "forward <token>");
    const pend = await read(c.address, c.abi, "pendingOf", [token]);
    log(`collector ${c.id} ${c.address}: pendingOf(${token}) = ${await amt(pend, token)}`);
    steps.push({ label: `${c.id} forward(${token})`, to: c.address, abi: c.abi, functionName: "forward", args: [token] });
  }

  // ── 3. Release parked holder fees: flush ──
  if (action === "flush") {
    const t = asAddr(target, "flush <rewardsToken|index>");
    if (await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "isRewardsToken", [t])) {
      const key = await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "poolKeyOf", [t]);
      const pid = await read(ADDR.rewardsHook, REWARDS_HOOK_ABI, "poolIdOf", [t]);
      const parked = await read(ADDR.rewardsHook, REWARDS_HOOK_ABI, "pendingHolders", [pid]);
      log(`rewards hook ${ADDR.rewardsHook}: pendingHolders(${pid}) = ${await amt(parked, key.currency0 === t ? key.currency1 : key.currency0)}`);
      if (parked === 0n) {
        log("nothing parked: flush would succeed and move nothing (gas only). No transaction built.");
        return exit(0);
      }
      steps.push({ label: `rewards hook flush(poolKeyOf(${t}))`, to: ADDR.rewardsHook, abi: REWARDS_HOOK_ABI, functionName: "flush", args: [key] });
    } else {
      const stack = await stackOfIndex(t);
      if (!stack) fail(`${t} is neither a rewards token (rewardsFactory.isRewardsToken) nor an index of any INDEX_STACKS factory.`);
      const [cf, of, parked, burn] = await Promise.all([read(stack.hook, INDEX_HOOK_ABI, "pendingCreatorFee", [t]), read(stack.hook, INDEX_HOOK_ABI, "pendingOpsFee", [t]), tryRead(stack.hook, INDEX_HOOK_ABI, "pendingHolders", [t]), read(t, INDEX_TOKEN_ABI, "claimedBurn")]);
      log(`index hook ${stack.id} ${stack.hook}: pendingCreatorFee ${fromUnits(cf, 18, 8)}, pendingOpsFee ${fromUnits(of, 18, 8)} shares, claimedBurn ${fromUnits(burn, 18, 8)} shares${parked === null ? "" : `, pendingHolders ${fromUnits(parked, 18, 8)} ETH`}`);
      if (cf + of + burn + (parked ?? 0n) === 0n) {
        log("nothing pending: flush would succeed and move nothing (gas only). No transaction built.");
        return exit(0);
      }
      steps.push({ label: `index hook ${stack.id} flush(${t})`, to: stack.hook, abi: INDEX_HOOK_ABI, functionName: "flush", args: [t] });
    }
  }

  // ── 4. Pull classic pool fees into the fee locker: collectRewards(token) ──
  if (action === "collect") {
    const t = asAddr(target, "collect <classicToken>");
    let locker = null;
    for (const l of [ADDR.lockerV2, ADDR.lockerV1]) {
      const info = await tryRead(l, LOCKER_ABI, "tokenRewards", [t]);
      if (info && same(info.token, t)) {
        locker = l;
        break;
      }
    }
    if (!locker) fail(`${t} has no slice table in LP locker v2 or v1: not a classic B420 launch.`);
    steps.push({ label: `LP locker ${same(locker, ADDR.lockerV2) ? "v2" : "v1"} collectRewards(${t})`, to: locker, abi: LOCKER_ABI, functionName: "collectRewards", args: [t] });
  }

  // ── 5. Holder distributor: sync and claimMany ──
  async function distributorPayees(t, d) {
    const entries = [];
    for (let offset = 0, more = true; more; ) {
      const page = await api(`/distributor/${t.toLowerCase()}/claim/all?offset=${offset}`);
      entries.push(...(page.entries || []));
      more = !!page.more;
      offset = page.nextOffset ?? offset + (page.entries || []).length;
    }
    const claimed = await Promise.all(entries.map((e) => read(d, DISTRIBUTOR_ABI, "claimed", [getAddress(e.currency), getAddress(e.account)])));
    return entries
      .map((e, i) => ({ currency: getAddress(e.currency), account: getAddress(e.account), cumulativeAmount: BigInt(e.cumulativeAmount), proof: e.proof, owed: BigInt(e.cumulativeAmount) - claimed[i] }))
      .filter((e) => e.owed > 0n);
  }
  if (action === "sync") {
    const t = asAddr(target, "sync <classicToken>");
    const d = await distributorOf(t);
    if (!d) fail(`no distributor for ${t} in either distributor factory generation.`);
    const [token, paired] = await Promise.all([read(d, DISTRIBUTOR_ABI, "token"), read(d, DISTRIBUTOR_ABI, "pairedToken")]);
    const [a, b] = await Promise.all([read(ADDR.feeLocker, FEE_LOCKER_ABI, "availableFees", [d, token]), read(ADDR.feeLocker, FEE_LOCKER_ABI, "availableFees", [d, paired])]);
    log(`distributor ${d}: in the fee locker ${await amt(a, token)} + ${await amt(b, paired)}`);
    if (a + b === 0n) {
      log("nothing waiting in the fee locker: sync would succeed and move nothing (gas only). No transaction built.");
      return exit(0);
    }
    steps.push({ label: `distributor sync() for ${t}`, to: d, abi: DISTRIBUTOR_ABI, functionName: "sync", args: [] });
  }

  // ── 6. Pay every holder of a rewards or index token: claimDividendFor ──
  const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_x, i) => list.slice(i * n, i * n + n));
  if (action === "pay-holders") {
    const t = asAddr(target, "pay-holders <rewardsToken|index|classicToken>");
    const want = flags.batch !== undefined ? Number(flags.batch) : null;
    if (want !== null && (!Number.isInteger(want) || want < 1)) usage("--batch must be a whole number >= 1");
    if (await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "isRewardsToken", [t])) {
      const asset = await read(t, REWARDS_TOKEN_ABI, "rewardAsset");
      const cap = same(asset, ZERO) ? 150 : 80;
      const w = await api(`/rewards-launch/${t.toLowerCase()}/holders?wallets=1`);
      if (!w.owed) fail(`the payout list of ${t} came back without owed rows (${w.error || "read failed"}); retry.`);
      const listed = w.owed.map((r) => getAddress(r.wallet));
      const now = await Promise.all(listed.map((a) => read(t, REWARDS_TOKEN_ABI, "dividendOf", [a])));
      const payees = listed.filter((_a, i) => now[i] > 0n);
      log(`${t}: ${payees.length} holder(s) owed now (API listed ${listed.length}), paid in ${(await meta(asset)).symbol}, batch ${Math.min(want ?? cap, cap)}`);
      for (const b of chunk(payees, Math.min(want ?? cap, cap))) steps.push({ label: `claimDividendFor(${b.length} holders) on ${t}`, to: t, abi: REWARDS_TOKEN_ABI, functionName: "claimDividendFor", args: [b], gasRule: "batchPay", payees: b });
    } else if (await stackOfIndex(t)) {
      const w = await api(`/index/${t.toLowerCase()}/holders?wallets=1`);
      if (!w.owed) fail(`the payout list of ${t} came back without owed rows (${w.error || "read failed"}); retry.`);
      const listed = w.owed.map((r) => getAddress(r.wallet));
      const now = await Promise.all(listed.map((a) => read(t, INDEX_TOKEN_ABI, "dividendOf", [a])));
      const payees = listed.filter((_a, i) => now[i] > 0n);
      log(`${t}: ${payees.length} holder(s) owed now (API listed ${listed.length}), paid in ETH, batch ${Math.min(want ?? 150, 150)}`);
      for (const b of chunk(payees, Math.min(want ?? 150, 150))) steps.push({ label: `claimDividendFor(${b.length} holders) on ${t}`, to: t, abi: INDEX_TOKEN_ABI, functionName: "claimDividendFor", args: [b], gasRule: "batchPay", payees: b });
    } else {
      const d = await distributorOf(t);
      if (!d) fail(`${t} is not a rewards token, not an index, and has no holder distributor.`);
      const payees = await distributorPayees(t, d);
      log(`${t}: distributor ${d}, ${payees.length} leaf(s) with an unclaimed amount`);
      for (const b of chunk(payees, want ?? 150)) steps.push({ label: `distributor claimMany(${b.length} leaves) for ${t}`, to: d, abi: DISTRIBUTOR_ABI, functionName: "claimMany", args: [b.map(({ currency, account, cumulativeAmount, proof }) => ({ currency, account, cumulativeAmount, proof }))], gasRule: "batchPay", payees: b });
    }
    if (!steps.length) {
      log("nothing owed: no transaction to build.");
      return exit(0);
    }
    // A batch whose estimate is above 12M gas is split in two (and checked again).
    if (signer.address) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const [sim] = await simulateSteps([s], signer.address);
        if (sim.ok && sim.gasUsed > 12_000_000n && s.payees.length > 1) {
          const half = Math.ceil(s.payees.length / 2);
          const mk = (p) => ({ ...s, label: s.label.replace(/\(\d+ /, `(${p.length} `), args: [s.functionName === "claimMany" ? p.map(({ currency, account, cumulativeAmount, proof }) => ({ currency, account, cumulativeAmount, proof })) : p], payees: p });
          steps.splice(i, 1, mk(s.payees.slice(0, half)), mk(s.payees.slice(half)));
          i--;
        }
      }
    }
  }

  // ── 7. Ledger claims on behalf of fixed recipients ──
  if (action === "ledger") {
    const t = asAddr(target, "ledger <token|index|recipient>");
    if (flags.all !== undefined) {
      // the shared parser treats --all as a boolean flag, so the list arrives as the next positional (or --all=...)
      const list = String(flags.all === true ? _[2] || "" : flags.all).split(",").filter(Boolean).map((x) => asAddr(x.trim(), "--all entry"));
      if (!list.length) usage("--all needs a comma-separated list of rewards tokens and/or indexes.");
      const recipient = t;
      const [treasury, collector, stakingB69] = await Promise.all(["treasury", "collector", "stakingB69"].map((f) => read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, f)));
      const rTokens = [];
      const byStack = new Map();
      for (const x of list) {
        if (await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "isRewardsToken", [x])) {
          let owed = await read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "creatorClaimable", [x, recipient]);
          if (same(recipient, treasury)) owed += await read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "treasuryClaimable", [x]);
          if (same(recipient, collector)) owed += (await read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "collectorClaimable", [x])).reduce((s, v) => s + v, 0n);
          if (same(recipient, stakingB69)) owed += await read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "stakingClaimable", [x]);
          if (owed > 0n) rTokens.push(x);
          else log(`skip ${x}: nothing owed to ${recipient} in the rewards ledger`);
          continue;
        }
        const stack = await stackOfIndex(x);
        if (!stack) fail(`${x} is neither a rewards token nor an index.`);
        const [e, s] = await Promise.all([read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [x, recipient, ZERO]), read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [x, recipient, x])]);
        if (e + s > 0n) byStack.set(stack, [...(byStack.get(stack) || []), x]);
        else log(`skip ${x}: nothing owed to ${recipient} in the ${stack.id} index ledger`);
      }
      if (rTokens.length) steps.push({ label: `rewards ledger claimAllFor(${recipient}, ${rTokens.length} token(s))`, to: ADDR.rewardsLedger, abi: REWARDS_LEDGER_ABI, functionName: "claimAllFor", args: [recipient, rTokens], gasRule: same(recipient, stakingB69) ? "ledgerStakingSlot" : "default" });
      for (const [stack, ixs] of byStack) steps.push({ label: `index ledger ${stack.id} claimAllFor(${recipient}, ${ixs.length} index(es))`, to: stack.ledger, abi: INDEX_LEDGER_ABI, functionName: "claimAllFor", args: [recipient, ixs] });
      if (!steps.length) {
        log("nothing owed to that recipient on those tokens: claimAllFor would only burn gas.");
        return exit(0);
      }
    } else {
      if (flags.slot === undefined) usage(`ledger <token|index> needs --slot n (rewards token: 0 creator, 1 treasury, 2 collector, 3 staking; index: 0 creator, 1 ops), or <recipient> --all t1,t2.\n${USAGE}`);
      const slot = Number(flags.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > 3) usage("--slot must be 0, 1, 2 or 3");
      if (await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "isRewardsToken", [t])) {
        const names = ["creator", "treasury", "collector", "staking"];
        const owed = await read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "claimable", [t, slot]);
        log(`rewards ledger ${ADDR.rewardsLedger}: claimable(${t}, ${slot} ${names[slot]}) = ${owed}${owed === 0n ? " (claimFor reverts NothingToClaim)" : ""}`);
        steps.push({ label: `rewards ledger claimFor(${t}, ${slot}) (${names[slot]})`, to: ADDR.rewardsLedger, abi: REWARDS_LEDGER_ABI, functionName: "claimFor", args: [t, slot], gasRule: slot === 3 ? "ledgerStakingSlot" : "default" });
      } else {
        const stack = await stackOfIndex(t);
        if (!stack) fail(`${t} is neither a rewards token nor an index.`);
        if (slot > 1) usage("an index ledger has two fixed recipients: --slot 0 (creator) or --slot 1 (ops).");
        const recipient = slot === 0 ? await read(stack.ledger, INDEX_LEDGER_ABI, "creatorOf", [t]) : await read(stack.ledger, INDEX_LEDGER_ABI, "ops");
        const [e, s] = await Promise.all([read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [t, recipient, ZERO]), read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [t, recipient, t])]);
        log(`index ledger ${stack.id} ${stack.ledger}: ${slot === 0 ? "creator" : "ops"} ${recipient} claimable ${fromUnits(e, 18, 18)} ETH, ${fromUnits(s, 18, 18)} shares`);
        if (e > 0n || s === 0n) steps.push({ label: `index ledger claimFor(${t}, ${recipient}, ETH)`, to: stack.ledger, abi: INDEX_LEDGER_ABI, functionName: "claimFor", args: [t, recipient, ZERO] });
        if (s > 0n) steps.push({ label: `index ledger claimFor(${t}, ${recipient}, shares)`, to: stack.ledger, abi: INDEX_LEDGER_ABI, functionName: "claimFor", args: [t, recipient, t] });
      }
    }
  }

  // ── Simulate / send / print ──
  const res = await runSteps(steps, flags);
  if (res.mode === "simulate" && !flags.json) {
    for (const [i, s] of res.sims.entries()) {
      if (s.result === undefined) continue;
      const r = s.result;
      if (Array.isArray(r) && r.length === 2 && typeof r[0] === "bigint") log(`${i + 1}: returned paid ${r[0]}, skipped ${r[1]}`);
      else if (r && typeof r === "object" && "b420Bought" in r) log(`${i + 1}: FundReport b420Bought ${r.b420Bought}, stockBought [${r.stockBought.join(", ")}], wethFromB420 ${r.wethFromB420}, wethFromStock [${r.wethFromStock.join(", ")}] (base units, registry order)`);
    }
  }
}

main().catch((e) => fail(errorLine(e)));
