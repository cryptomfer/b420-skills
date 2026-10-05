#!/usr/bin/env node
/**
 * B420 wallet report: ETH, holdings by value, staked and unbonding B420 / B69 with the unlock time,
 * staking rewards earned, and what the wallet can claim. Read-only: no signer, nothing is sent.
 *
 *   npm ci        (once, at the repo root)
 *   node market-data/examples/portfolio.mjs 0xYourWallet
 *   node market-data/examples/portfolio.mjs <username>           # a b420.io username
 *   node market-data/examples/portfolio.mjs 0xYourWallet --json   # machine output
 *   node market-data/examples/portfolio.mjs 0xYourWallet --fresh  # skip the API cache (right after a trade or claim)
 *
 * Actions: none (read only).
 * Signer: none needed; no transaction is built.
 * Sources: GET https://b420.io/api/profile/<username> (username to wallet), GET /api/portfolio/<wallet>,
 *          one multicall on StakingB420 0xC411bA66d1819054f67cDE26424cd876DB703E79 and
 *          StakingB69 0x82E6b3CEE079432F31D64855ed3DD5faCA71d309 (positions read from the chain).
 * Env: RPC_URL (your own Base node; the public one rate-limits), B420_API (API base override).
 *      PRIVATE_KEY and BANKR_API_KEY are not read by this script (never printed).
 */
import { getAddress, isAddress, parseAbi } from "viem";
import { ADDR, api, fail, fromUnits, out, parseArgs, publicClient, tokenMeta, usage } from "../../examples/lib/b420.mjs";

const USAGE = `usage: node market-data/examples/portfolio.mjs <address|username> [--fresh] [--json]
  Prints ETH, holdings sorted by value, StakingB420 / StakingB69 positions (staked, unbonding,
  unlock time, earned) and claimable rewards. Read-only.`;

const STAKING_ABI = parseAbi([
  "function stakingToken() view returns (address)",
  "function stakedBalance(address account) view returns (uint256)",
  "function unbondingAmount(address account) view returns (uint256)",
  "function unbondingUnlockAt(address account) view returns (uint256)",
  "function rewardTokens() view returns (address[])",
  "function earned(address account, address token) view returns (uint256)",
]);
const POOLS = [
  { name: "StakingB420", address: ADDR.stakingB420 },
  { name: "StakingB69", address: ADDR.stakingB69 },
];

const { _, flags } = parseArgs(process.argv.slice(2), { booleans: ["fresh"] });
if (flags.help || _.length !== 1) usage(USAGE);
const target = _[0];

// ── 1. Resolve the wallet (an address, or a b420.io username) ──
let wallet;
let username = null;
let otherWallets = [];
if (isAddress(target, { strict: false })) {
  wallet = getAddress(target);
} else {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(target)) usage(`"${target}" is neither an address nor a username.\n${USAGE}`);
  let p;
  try {
    p = await api(`/profile/${encodeURIComponent(target)}`);
  } catch (e) {
    fail(e.status === 404 ? `No b420.io profile named "${target}".` : `Profile lookup failed: ${e.message}`);
  }
  const primary = p?.profile?.primaryWallet || p?.address || p?.wallets?.[0];
  if (!primary || !isAddress(primary, { strict: false })) fail(`Profile "${target}" has no wallet on record.`);
  wallet = getAddress(primary);
  username = p.profile?.username || target;
  otherWallets = (p.wallets || []).filter((w) => isAddress(w, { strict: false }) && w.toLowerCase() !== wallet.toLowerCase()).map((w) => getAddress(w));
}

// ── 2. API portfolio (holdings valued live, rewards on held tokens, claimable after an exit) ──
let pf = null;
let apiError = null;
try {
  pf = await api(`/portfolio/${wallet}${flags.fresh ? "?fresh=1" : ""}`);
} catch (e) {
  apiError = e.message;
}

// ── 3. Staking positions, read from the chain (one multicall per round) ──
let staking = null;
let chainError = null;
try {
  const base = await publicClient.multicall({
    allowFailure: false,
    contracts: POOLS.flatMap((p) => [
      { address: p.address, abi: STAKING_ABI, functionName: "stakingToken" },
      { address: p.address, abi: STAKING_ABI, functionName: "stakedBalance", args: [wallet] },
      { address: p.address, abi: STAKING_ABI, functionName: "unbondingAmount", args: [wallet] },
      { address: p.address, abi: STAKING_ABI, functionName: "unbondingUnlockAt", args: [wallet] },
      { address: p.address, abi: STAKING_ABI, functionName: "rewardTokens" },
    ]),
  });
  const rows = POOLS.map((p, i) => {
    const [stakingToken, staked, unbonding, unlockAt, rewardTokens] = base.slice(i * 5, i * 5 + 5);
    return { ...p, stakingToken, staked, unbonding, unlockAt, rewardTokens };
  });
  const earnedCalls = rows.flatMap((r) => r.rewardTokens.map((t) => ({ address: r.address, abi: STAKING_ABI, functionName: "earned", args: [wallet, t] })));
  const earned = await publicClient.multicall({ allowFailure: false, contracts: earnedCalls });
  const metas = new Map();
  for (const a of new Set(rows.flatMap((r) => [r.stakingToken, ...r.rewardTokens]))) metas.set(a.toLowerCase(), await tokenMeta(a));
  const now = Math.floor(Date.now() / 1000);
  let k = 0;
  staking = rows.map((r) => {
    const sm = metas.get(r.stakingToken.toLowerCase());
    const rewards = r.rewardTokens.map((t) => {
      const m = metas.get(t.toLowerCase());
      const raw = earned[k++];
      return { token: m.address, symbol: m.symbol, decimals: m.decimals, raw, amount: fromUnits(raw, m.decimals, m.decimals) };
    });
    const unlock = Number(r.unlockAt);
    return {
      pool: r.name,
      address: r.address,
      stakingToken: sm.address,
      symbol: sm.symbol,
      staked: fromUnits(r.staked, sm.decimals, 8),
      stakedRaw: r.staked,
      unbonding: fromUnits(r.unbonding, sm.decimals, 8),
      unbondingRaw: r.unbonding,
      unlockAt: r.unbonding > 0n && unlock > 0 ? new Date(unlock * 1000).toISOString() : null,
      withdrawable: r.unbonding > 0n && unlock > 0 && unlock <= now,
      earned: rewards.filter((x) => x.raw > 0n),
    };
  });
} catch (e) {
  chainError = [e.shortMessage || e.message, e.details].filter(Boolean).join(": ");
}

if (!pf && !staking) fail(`Nothing could be read. API: ${apiError}. Chain: ${chainError}`);

// ── 4. Report ──
const holdings = (pf?.holdings || []).slice().sort((a, b) => (b.value || 0) - (a.value || 0));
const withRewards = holdings.filter((h) => h.rewards && h.rewards.unclaimed > 0);
const afterExit = (pf?.claimable || []).filter((c) => c.rewards && c.rewards.unclaimed > 0);
const stakingRewards = (staking || []).flatMap((s) => s.earned.map((e) => ({ pool: s.pool, ...e })));

const usd = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "no price";
  if (v === 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const units = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  if (Math.abs(v) < 1e-6) return v.toExponential(3).replace(/\.?0+e/, "e");
  if (Math.abs(v) < 1) return v.toPrecision(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
};

if (flags.json) {
  out(
    {
      wallet,
      username,
      otherWallets,
      api: pf ? { degraded: pf.degraded, eth: pf.eth, totalUsd: pf.totalUsd, holdings, claimable: pf.claimable } : { error: apiError },
      staking: staking ?? { error: chainError },
    },
    flags,
  );
} else {
  const L = [];
  L.push(`wallet ${wallet}${username ? ` (${username})` : ""}`);
  if (otherWallets.length) L.push(`  other wallets on the profile: ${otherWallets.join(", ")}`);

  if (pf) {
    if (pf.degraded) L.push("  note: the API answered degraded (a data source was down); holdings may be incomplete, retry with --fresh in a few seconds");
    L.push(`ETH ${units(pf.eth?.units ?? 0)} (${usd(pf.eth?.value)})`);
    L.push(`holdings: ${holdings.length}, total ${usd(pf.totalUsd)} (ETH and staked units included; claimable rewards excluded)`);
    for (const h of holdings) {
      const staked = h.stakedUnits > 0 ? `, staked ${units(h.stakedUnits)}` : "";
      const rw = h.rewards && h.rewards.unclaimed > 0 ? `, claimable ${units(h.rewards.unclaimed)} ${h.rewards.symbol}` : "";
      L.push(`  ${h.symbol.padEnd(10)} ${units(h.units)}${staked}  ${usd(h.value)}  [${h.kind}${h.stock ? ", stock" : ""}] ${h.address}${rw}`);
    }
  } else {
    L.push(`API portfolio unavailable (${apiError}); staking below is read from the chain.`);
  }

  if (staking) {
    L.push("staking (read from the chain):");
    for (const s of staking) {
      const unb = s.unbondingRaw > 0n ? `, unbonding ${s.unbonding} ${s.symbol} ${s.withdrawable ? "(withdrawable now)" : `(unlocks ${s.unlockAt})`}` : "";
      L.push(`  ${s.pool} ${s.address}: staked ${s.staked} ${s.symbol}${unb}`);
      L.push(`    earned: ${s.earned.length ? s.earned.map((e) => `${e.amount} ${e.symbol}`).join(", ") : "nothing yet"}`);
    }
  } else {
    L.push(`staking positions unavailable (${chainError}); set RPC_URL to your own Base node.`);
  }

  L.push("claimable:");
  const sr = !staking ? "unavailable (chain read failed)" : stakingRewards.length ? stakingRewards.map((e) => `${e.amount} ${e.symbol} (${e.pool})`).join(", ") : "none";
  L.push(`  staking rewards: ${sr}`);
  if (pf) {
    L.push(`  dividends on held tokens: ${withRewards.length ? withRewards.map((h) => `${units(h.rewards.unclaimed)} ${h.rewards.symbol} on ${h.symbol}`).join(", ") : "none"}`);
    L.push(`  dividends on tokens no longer held: ${afterExit.length ? afterExit.map((c) => `${units(c.rewards.unclaimed)} ${c.rewards.symbol} on ${c.symbol}`).join(", ") : "none"}`);
  }
  L.push("  creator fees, ledger slots, distributor and airdrop claims are not in this report; scan them all with:");
  L.push(`  node claim/examples/claim.mjs ${wallet} scan`);
  process.stdout.write(`${L.join("\n")}\n`);
}
