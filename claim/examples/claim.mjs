#!/usr/bin/env node
/**
 * B420 claims: list and claim every reward one wallet has on B420 (Base), from every source.
 *
 *   npm ci        (once, at the repo root)
 *   node claim/examples/claim.mjs 0xWallet                              # scan: every non-zero claimable, read only
 *   node claim/examples/claim.mjs 0xWallet all                          # simulate every claim, from the wallet itself
 *   node claim/examples/claim.mjs 0xWallet creator-fees --from 0xAny    # simulate the permissionless claims from another address
 *   node claim/examples/claim.mjs 0xWallet index --token 0xIndex --print     # simulate, then raw tx JSON per step
 *   PRIVATE_KEY=0x... node claim/examples/claim.mjs 0xWallet all --send       # re-simulate and broadcast
 *
 * Actions: scan (default) | all | staking | dividends | ledger | index | creator-fees | distributor | airdrop
 *          dividends = holder-rewards token dividends; ledger = rewards ledger creator balances;
 *          index = index holder ETH dividends and index ledger balances. --token keeps one token's claims.
 * Signer: PRIVATE_KEY (viem) or BANKR_API_KEY + BANKR_WALLET (Bankr /wallet/submit, raw calldata); none =
 *         simulate from the wallet (or --from) and print. Own-only claims (staking getReward, claimDividend)
 *         need the wallet itself as signer; every other claim may be sent by anyone and still pays the wallet.
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, RPC_URL, FROM.
 * Exit: 0 ok, 1 failure or a simulated revert, 2 usage.
 */
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
  tokenMeta,
  usage,
} from "../../examples/lib/b420.mjs";

const USAGE = `usage: node claim/examples/claim.mjs <wallet> [scan|all|staking|dividends|ledger|index|creator-fees|distributor|airdrop]
         [--token 0x..] [--from 0x..] [--send|--print] [--json]`;
const KINDS = ["staking", "dividends", "ledger", "index", "creator-fees", "distributor", "airdrop"];

// ── ABIs (b420-factory/src; each fragment is the one the SKILL.md section shows) ──
const STAKING_ABI = parseAbi([
  "function rewardTokens() view returns (address[])",
  "function earned(address account, address token) view returns (uint256)",
  "function getReward()",
  "function getReward(address token)",
]);
const REWARDS_FACTORY_ABI = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokenAt(uint256 i) view returns (address)",
]);
const REWARDS_TOKEN_ABI = parseAbi([
  "function rewardAsset() view returns (address)",
  "function dividendOf(address account) view returns (uint256)",
  "function withdrawnDividends(address account) view returns (uint256)",
  "function claimDividend() returns (uint256 amount)",
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
  "error EthTransferFailed()",
  "error InsufficientGas()",
]);
const REWARDS_LEDGER_ABI = parseAbi([
  "function creatorOf(address token) view returns (address)",
  "function creatorClaimable(address token, address recipient) view returns (uint256)",
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
]);
const INDEX_TOKEN_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function dividendOf(address account) view returns (uint256)",
  "function claimDividend() returns (uint256 amount)",
  "function claimDividendFor(address[] accounts) returns (uint256 paid, uint256 skipped)",
  "error EthTransferFailed()",
  "error InsufficientGas()",
]);
const INDEX_LEDGER_ABI = parseAbi([
  "function claimable(address index, address recipient, address currency) view returns (uint256)",
  "function claim(address index, address currency) returns (uint256 amount)",
  "function claimFor(address index, address recipient, address currency) returns (uint256 amount)",
  "function claimAllFor(address recipient, address[] indexes) returns (uint256 eth)",
  "error NothingToClaim()",
  "error EthTransferFailed()",
]);
const FEE_LOCKER_ABI = parseAbi([
  "function availableFees(address feeOwner, address token) view returns (uint256)",
  "function claim(address feeOwner, address token)",
  "error NoFeesToClaim()",
]);
const DISTRIBUTOR_FACTORY_ABI = parseAbi(["function distributorFor(address token) view returns (address)"]);
// Distributor factories, current first. The previous generation (deployed before the book's factory)
// still serves the distributors it created, with the same root poster: both are checked.
const DISTRIBUTOR_FACTORIES = [ADDR.distributorFactory, ADDR.distributorFactoryPrevious];
const DISTRIBUTOR_ABI = parseAbi([
  "function claimed(address currency, address account) view returns (uint256)",
  "function claim(address currency, address account, uint256 cumulativeAmount, bytes32[] proof)",
  "error UnknownCurrency()",
  "error InvalidProof()",
  "error NothingToClaim()",
  "error ExceedsPosted()",
]);
const AIRDROP_ABI = parseAbi([
  "function airdrops(address token) view returns (address admin, bytes32 merkleRoot, uint256 totalSupply, uint256 totalClaimed, uint256 lockupEndTime, uint256 vestingEndTime, uint256 adminClaimTime, bool adminClaimed)",
  "function amountAvailableToClaim(address token, address recipient, uint256 allocatedAmount) view returns (uint256)",
  "function claim(address token, address recipient, uint256 allocatedAmount, bytes32[] proof)",
  "error AirdropNotCreated()",
  "error AdminClaimed()",
  "error AirdropNotUnlocked()",
  "error ZeroClaim()",
  "error TotalMaxClaimed()",
  "error InvalidProof()",
  "error UserMaxClaimed()",
  "error ZeroToClaim()",
]);

const read = (address, abi, functionName, args = []) => publicClient.readContract({ address, abi, functionName, args });
const tryRead = (address, abi, functionName, args = []) => read(address, abi, functionName, args).catch(() => null);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const ZERO_ROOT = `0x${"0".repeat(64)}`;
const notes = [];
const coverage = {};
/** One retry for a per-launch API read; the caller counts what still fails as not scanned. */
async function apiTwice(path) {
  try {
    return await api(path);
  } catch {
    return api(path);
  }
}

// ── Arguments and signer ──
const { _, flags } = parseArgs();
if (flags.help) usage(USAGE);
const [walletArg, actionArg = "scan"] = _;
if (!walletArg || !isAddress(walletArg, { strict: false })) usage(USAGE);
const wallet = getAddress(walletArg);
const action = String(actionArg).toLowerCase();
if (action !== "scan" && action !== "all" && !KINDS.includes(action)) usage(`Unknown action "${actionArg}".\n${USAGE}`);
if (flags.token !== undefined && !isAddress(String(flags.token), { strict: false })) usage(`--token must be an address, got ${flags.token}`);
const tokenFilter = flags.token ? getAddress(String(flags.token)) : null;
// No key and no --from: claims simulate from the wallet itself (own-only claims need it).
if (!process.env.PRIVATE_KEY && !process.env.BANKR_API_KEY && flags.from === undefined && !process.env.FROM) flags.from = wallet;
const kinds = action === "scan" || action === "all" ? KINDS : [action];

// ── Discovery: one wallet, every source ──
// Staking (the recipe lives in staking/SKILL.md): earned(wallet, token) per reward token, both pools.
async function scanStaking() {
  const rows = [];
  const pools = [
    ["StakingB420", ADDR.stakingB420],
    ["StakingB69", ADDR.stakingB69],
  ];
  let n = 0;
  for (const [name, pool] of pools) {
    const tokens = await read(pool, STAKING_ABI, "rewardTokens");
    n += tokens.length;
    const earned = await Promise.all(tokens.map((t) => read(pool, STAKING_ABI, "earned", [wallet, t])));
    tokens.forEach((t, i) => {
      if (earned[i] > 0n) rows.push({ kind: "staking", source: pool, sourceName: name, currency: t, amount: earned[i], call: "getReward()", sender: "wallet only" });
    });
  }
  coverage.staking = `2 pools, ${n} reward tokens`;
  return rows;
}

// ── 1. Holder-rewards token dividends ── (every token of B420RewardsFactory)
let rewardsTokens = null;
async function listRewardsTokens() {
  if (rewardsTokens) return rewardsTokens;
  const n = await read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "tokenCount");
  rewardsTokens = await Promise.all(Array.from({ length: Number(n) }, (_x, i) => read(ADDR.rewardsFactory, REWARDS_FACTORY_ABI, "tokenAt", [BigInt(i)])));
  return rewardsTokens;
}
async function scanDividends() {
  const tokens = await listRewardsTokens();
  const rows = [];
  await Promise.all(
    tokens.map(async (t) => {
      const [owed, asset] = await Promise.all([read(t, REWARDS_TOKEN_ABI, "dividendOf", [wallet]), read(t, REWARDS_TOKEN_ABI, "rewardAsset")]);
      if (owed > 0n) rows.push({ kind: "dividends", source: t, currency: asset, amount: owed, call: "claimDividend() / claimDividendFor([wallet])", sender: "wallet, or anyone with claimDividendFor" });
    }),
  );
  coverage.dividends = `${tokens.length} rewards tokens`;
  return rows;
}

// ── 2. Rewards ledger: creator slot (and a previous creator's leftover) ──
async function scanLedger() {
  const tokens = await listRewardsTokens();
  const rows = [];
  await Promise.all(
    tokens.map(async (t) => {
      const [owed, asset, creator] = await Promise.all([
        read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "creatorClaimable", [t, wallet]),
        read(t, REWARDS_TOKEN_ABI, "rewardAsset"),
        read(ADDR.rewardsLedger, REWARDS_LEDGER_ABI, "creatorOf", [t]),
      ]);
      if (owed > 0n) {
        const current = same(creator, wallet);
        rows.push({ kind: "ledger", source: t, currency: asset, amount: owed, call: current ? "claimAllFor(wallet, [token]) (or claimFor(token, 0))" : "claimAllFor(wallet, [token]) (previous creator)", sender: "anyone" });
      }
    }),
  );
  coverage.ledger = `${tokens.length} rewards tokens`;
  return rows;
}

// ── 3. Index holder dividends ── and ── 4. Index ledger (creator) ── (every INDEX_STACKS factory)
async function scanIndex() {
  const rows = [];
  let n = 0;
  for (const stack of INDEX_STACKS) {
    const count = await read(stack.factory, INDEX_FACTORY_ABI, "indexCount");
    const indexes = await Promise.all(Array.from({ length: Number(count) }, (_x, i) => read(stack.factory, INDEX_FACTORY_ABI, "indexAt", [BigInt(i)])));
    n += indexes.length;
    await Promise.all(
      indexes.map(async (ix) => {
        const [div, eth, shares] = await Promise.all([
          read(ix, INDEX_TOKEN_ABI, "dividendOf", [wallet]),
          read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [ix, wallet, ZERO]),
          read(stack.ledger, INDEX_LEDGER_ABI, "claimable", [ix, wallet, ix]),
        ]);
        if (div > 0n) rows.push({ kind: "index", sub: "dividend", stack, source: ix, currency: ZERO, amount: div, call: "claimDividend() / claimDividendFor([wallet])", sender: "wallet, or anyone with claimDividendFor" });
        if (eth > 0n) rows.push({ kind: "index", sub: "ledger", stack, source: ix, currency: ZERO, amount: eth, call: "claimAllFor(wallet, [index]) on the index ledger", sender: "anyone" });
        if (shares > 0n) rows.push({ kind: "index", sub: "ledger", stack, source: ix, currency: ix, amount: shares, call: "claimAllFor(wallet, [index]) on the index ledger", sender: "anyone" });
      }),
    );
  }
  coverage.index = `${INDEX_STACKS.length} stack(s) (${INDEX_STACKS.map((s) => s.id).join(", ")}), ${n} indexes`;
  return rows;
}

// Classic launches from the API (the launches feed caps at 200 rows; a classic launch has a locker).
let classicLaunches = null;
async function listClassicLaunches() {
  if (classicLaunches) return classicLaunches;
  const rows = await api("/launches?limit=200");
  if (!Array.isArray(rows)) throw new Error("GET /api/launches did not return a list");
  if (rows.length >= 200) notes.push("GET /api/launches returned its 200-row cap: launches beyond it were not scanned.");
  classicLaunches = rows.filter((r) => r.locker).map((r) => ({ token: getAddress(r.token), symbol: r.symbol || r.token.slice(0, 8), paired: getAddress(r.pairedToken || ADDR.weth), creator: r.creator }));
  return classicLaunches;
}

// ── 5. Classic launch creator fees (ClankerFeeLocker) ──
// availableFees is per (fee owner, currency), summed over every launch that pays that owner in that
// currency: read every currency any classic launch trades in (the token and its quote), once each.
async function scanCreatorFees() {
  const launches = await listClassicLaunches();
  const byCurrency = new Map();
  for (const l of launches) {
    for (const c of [l.token, l.paired]) {
      const k = c.toLowerCase();
      if (!byCurrency.has(k)) byCurrency.set(k, { currency: c, launches: [] });
      if (same(l.creator, wallet)) byCurrency.get(k).launches.push(l.symbol); // the wallet's own launches in that currency, for display
    }
  }
  const list = [...byCurrency.values()];
  const amounts = await Promise.all(list.map((x) => read(ADDR.feeLocker, FEE_LOCKER_ABI, "availableFees", [wallet, x.currency])));
  const rows = [];
  list.forEach((x, i) => {
    if (amounts[i] > 0n) rows.push({ kind: "creator-fees", source: ADDR.feeLocker, currency: x.currency, launches: x.launches.length ? [...new Set(x.launches)] : null, amount: amounts[i], call: "claim(wallet, currency) on the fee locker", sender: "anyone" });
  });
  coverage["creator-fees"] = `${launches.length} classic launches, ${list.length} currencies`;
  return rows;
}

// ── 6. Classic holder distributor (merkle) ──
async function scanDistributor() {
  const res = await api("/distributors");
  const live = (res?.rows || []).filter((r) => r.address);
  const rows = [];
  const failed = [];
  for (const d of live) {
    const token = getAddress(d.token);
    const known = await Promise.all(DISTRIBUTOR_FACTORIES.map((f) => read(f, DISTRIBUTOR_FACTORY_ABI, "distributorFor", [token])));
    const onchain = known.find((a) => same(a, d.address));
    if (!onchain) {
      notes.push(`distributor of ${d.symbol || token}: ${d.address} is not the distributor any known factory records for the launch; skipped.`);
      continue;
    }
    let leaves = [];
    try {
      leaves = (await apiTwice(`/distributor/${token.toLowerCase()}/claim/${wallet.toLowerCase()}`)).leaves || [];
    } catch (e) {
      failed.push(`${d.symbol || token} (${e.message})`);
      continue;
    }
    for (const leaf of leaves) {
      const currency = getAddress(leaf.currency);
      const cumulative = BigInt(leaf.cumulativeAmount);
      const claimed = await read(onchain, DISTRIBUTOR_ABI, "claimed", [currency, wallet]);
      if (cumulative > claimed) rows.push({ kind: "distributor", source: onchain, launch: token, launchSymbol: d.symbol, currency, amount: cumulative - claimed, cumulative, proof: leaf.proof, call: "claim(currency, wallet, cumulativeAmount, proof) on the distributor", sender: "anyone" });
    }
  }
  // A distributor whose claim list could not be read is not scanned: the kind is reported NOT SCANNED
  // (exit 1) while the claims found on the others are kept.
  coverage.distributor = failed.length ? `NOT SCANNED (${failed.length} of ${live.length} distributors failed: ${failed.join(", ")})` : `${live.length} distributors`;
  return rows;
}

// ── 7. Airdrop allocations ──
async function scanAirdrop() {
  const launches = await listClassicLaunches();
  const failed = [];
  // airdrops(token) is a mapping read (zeros when a launch has none): a failure here is an unread source, never "no airdrop".
  const drops = await Promise.all(launches.map((l) => read(ADDR.airdrop, AIRDROP_ABI, "airdrops", [l.token]).catch((e) => (failed.push(`${l.symbol} (${String(e.shortMessage || e.message).split("\n")[0]})`), null))));
  const rows = [];
  let live = 0;
  for (let i = 0; i < launches.length; i++) {
    const a = drops[i];
    if (!a || a[1] === ZERO_ROOT) continue;
    live++;
    const l = launches[i];
    let leaf = null;
    try {
      leaf = (await apiTwice(`/airdrop/${l.token.toLowerCase()}?account=${wallet.toLowerCase()}`)).claim;
    } catch (e) {
      failed.push(`${l.symbol} (${e.message})`);
      continue;
    }
    if (!leaf) continue;
    const allocated = BigInt(leaf.amount);
    const now = await tryRead(ADDR.airdrop, AIRDROP_ABI, "amountAvailableToClaim", [l.token, wallet, allocated]);
    if (now === null) {
      notes.push(`airdrop of ${l.symbol}: amountAvailableToClaim reverted (admin swept it, or none).`);
      continue;
    }
    const lockupEnd = Number(a[4]);
    if (now === 0n && lockupEnd * 1000 > Date.now()) notes.push(`airdrop of ${l.symbol}: allocation ${allocated} locked until ${new Date(lockupEnd * 1000).toISOString()}.`);
    if (now > 0n) rows.push({ kind: "airdrop", source: ADDR.airdrop, launch: l.token, launchSymbol: l.symbol, currency: l.token, amount: now, allocated, proof: leaf.proof, call: "claim(token, wallet, allocatedAmount, proof) on the airdrop extension", sender: "anyone" });
  }
  coverage.airdrop = failed.length ? `NOT SCANNED (${failed.length} of ${launches.length} classic launches failed: ${failed.join(", ")})` : `${launches.length} classic launches, ${live} with an airdrop`;
  return rows;
}

const SCANNERS = { staking: scanStaking, dividends: scanDividends, ledger: scanLedger, index: scanIndex, "creator-fees": scanCreatorFees, distributor: scanDistributor, airdrop: scanAirdrop };

async function main() {
  let rows = [];
  for (const k of kinds) {
    // One retry per source; a source that still cannot be read is reported, never read as "nothing to claim".
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        rows.push(...(await SCANNERS[k]()));
        break;
      } catch (e) {
        if (attempt === 2) coverage[k] = `NOT SCANNED (${String(e.shortMessage || e.message).split("\n")[0]})`;
      }
    }
  }
  const unscanned = Object.entries(coverage).filter(([, v]) => String(v).startsWith("NOT SCANNED"));
  if (tokenFilter) rows = rows.filter((r) => [r.source, r.currency, r.launch].some((a) => a && same(a, tokenFilter)));

  // symbols and decimals for display
  for (const r of rows) {
    const m = await tokenMeta(r.currency);
    r.symbol = m.symbol;
    r.decimals = m.decimals;
    if (!r.sourceName) r.sourceName = r.launchSymbol || (r.kind === "creator-fees" ? "ClankerFeeLocker" : (await tokenMeta(r.source).catch(() => ({ symbol: r.source }))).symbol);
  }

  // ── Scan output ──
  if (action === "scan") {
    const list = rows.map((r) => ({
      kind: r.sub ? `${r.kind}-${r.sub}` : r.kind,
      token: `${r.sourceName} ${r.source}`,
      currency: r.currency,
      amount: `${fromUnits(r.amount, r.decimals, 8)} ${r.symbol}`,
      raw: r.amount,
      call: r.call,
      sender: r.sender,
      ...(r.launches ? { launches: r.launches.join(" ") } : {}),
    }));
    if (flags.json) out({ wallet, claimable: list, coverage, notes }, flags);
    else {
      console.log(`wallet ${wallet} on Base (chainId 8453)`);
      if (!list.length) console.log("nothing claimable in the sources below");
      for (const x of list) console.log(`- ${x.kind}: ${x.amount} from ${x.token}${x.launches ? ` (own launches in this currency: ${x.launches})` : ""}\n    call ${x.call}; sent by ${x.sender}`);
      console.log("sources scanned:");
      for (const [k, v] of Object.entries(coverage)) console.log(`  ${k}: ${v}`);
      for (const n of notes) console.log(`note: ${n}`);
    }
    return exit(unscanned.length ? 1 : 0);
  }

  // ── Steps (one per non-zero claim) ──
  const signer = getSigner(flags);
  const sender = signer.address;
  const own = same(sender, wallet);
  // stdout carries only the result (JSON with --json, raw transactions with --print); notes go to stderr then
  const log = (line) => (flags.json || flags.print ? process.stderr : process.stdout).write(`${line}\n`);
  const steps = [];
  let ownOnlySkipped = 0;

  const stakingPools = [...new Set(rows.filter((r) => r.kind === "staking").map((r) => r.source))];
  for (const pool of stakingPools) {
    const name = rows.find((r) => r.source === pool).sourceName;
    if (!own) {
      log(`skipped ${name} getReward(): it pays msg.sender only, so it must be sent by ${wallet} (recipe: staking/SKILL.md).`);
      ownOnlySkipped++;
      continue;
    }
    const one = tokenFilter && rows.some((r) => r.source === pool && same(r.currency, tokenFilter));
    steps.push(one ? { label: `${name} getReward(${tokenFilter}) (recipe: staking/SKILL.md)`, to: pool, abi: STAKING_ABI, functionName: "getReward", args: [tokenFilter] } : { label: `${name} getReward() (recipe: staking/SKILL.md)`, to: pool, abi: STAKING_ABI, functionName: "getReward", args: [] });
  }
  for (const r of rows.filter((x) => x.kind === "dividends" || (x.kind === "index" && x.sub === "dividend"))) {
    const abi = r.kind === "dividends" ? REWARDS_TOKEN_ABI : INDEX_TOKEN_ABI;
    const what = `${fromUnits(r.amount, r.decimals, 8)} ${r.symbol} dividend of ${r.sourceName}`;
    steps.push(own ? { label: `claimDividend(): ${what}`, to: r.source, abi, functionName: "claimDividend", args: [] } : { label: `claimDividendFor([${wallet}]): ${what}`, to: r.source, abi, functionName: "claimDividendFor", args: [[wallet]] });
  }
  const ledgerTokens = rows.filter((r) => r.kind === "ledger").map((r) => r.source);
  if (ledgerTokens.length) steps.push({ label: `rewards ledger claimAllFor(${wallet}, ${ledgerTokens.length} token(s))`, to: ADDR.rewardsLedger, abi: REWARDS_LEDGER_ABI, functionName: "claimAllFor", args: [wallet, ledgerTokens] });
  for (const stack of INDEX_STACKS) {
    const ix = [...new Set(rows.filter((r) => r.kind === "index" && r.sub === "ledger" && r.stack === stack).map((r) => r.source))];
    if (ix.length) steps.push({ label: `index ledger ${stack.id} claimAllFor(${wallet}, ${ix.length} index(es))`, to: stack.ledger, abi: INDEX_LEDGER_ABI, functionName: "claimAllFor", args: [wallet, ix] });
  }
  for (const r of rows.filter((x) => x.kind === "creator-fees")) {
    steps.push({ label: `fee locker claim(${wallet}, ${r.symbol}): ${fromUnits(r.amount, r.decimals, 8)} ${r.symbol}`, to: ADDR.feeLocker, abi: FEE_LOCKER_ABI, functionName: "claim", args: [wallet, r.currency] });
  }
  for (const r of rows.filter((x) => x.kind === "distributor")) {
    steps.push({ label: `distributor of ${r.launchSymbol} claim: ${fromUnits(r.amount, r.decimals, 8)} ${r.symbol}`, to: r.source, abi: DISTRIBUTOR_ABI, functionName: "claim", args: [r.currency, wallet, r.cumulative, r.proof] });
  }
  for (const r of rows.filter((x) => x.kind === "airdrop")) {
    steps.push({ label: `airdrop of ${r.launchSymbol} claim: ${fromUnits(r.amount, r.decimals, 8)} ${r.symbol}`, to: ADDR.airdrop, abi: AIRDROP_ABI, functionName: "claim", args: [r.launch, wallet, r.allocated, r.proof] });
  }

  for (const [k, v] of unscanned) log(`warning: ${k} ${v}`);
  if (!steps.length) {
    for (const [k, v] of Object.entries(coverage)) log(`  ${k}: ${v}`);
    for (const n of notes) log(`note: ${n}`);
    if (unscanned.length) fail("a source could not be read; nothing built. Retry, or set RPC_URL.");
    if (ownOnlySkipped) fail(`nothing this signer may send for ${wallet}: the claims above are own-only; sign them with that wallet.`);
    log(`nothing to claim for ${wallet} in: ${kinds.join(", ")}${tokenFilter ? ` (token ${tokenFilter})` : ""}`);
    return exit(0);
  }
  for (const n of notes) log(`note: ${n}`);

  // ── Simulate / send / print ──
  await runSteps(steps, flags);
  if (unscanned.length) fail(`not every source was read (${unscanned.map(([k]) => k).join(", ")}): run again before concluding there is nothing else to claim.`);
}

main().catch((e) => fail(errorLine(e)));
