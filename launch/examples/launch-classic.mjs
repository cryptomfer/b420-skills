#!/usr/bin/env node
/**
 * B420 classic launch: POST https://b420.io/api/launch prepares a B20 on the B420 Factory v2, then one deployToken
 * call (payable) from your wallet. Single copy of the recipe: launch/classic/SKILL.md.
 *
 *   npm ci        (once, at the repo root)
 *   node launch/examples/launch-classic.mjs                                                     # launch status only
 *   node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --from 0x...          # prepare + simulate, nothing sent
 *   PRIVATE_KEY=0x... node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --dev-buy 0.01 --send
 *   BANKR_API_KEY=... BANKR_WALLET=0x... node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --send
 *   node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --from 0x... --print   # raw tx JSON (CDP, Safe, relayers)
 *   node launch/examples/launch-classic.mjs --name "My Token" --symbol MYT --from 0x... --body-only  # the POST body, no request
 *
 * Actions: no --name/--symbol = GET /api/launch status only. With --name and --symbol: name check, POST /api/launch
 *          (rewardRecipient = the signer or --from), restore the bigints, check the factory, simulate deployToken.
 *          --send broadcasts after re-simulating, then POST /api/launch/confirm { txHash } (404 retried 10 x 6 s).
 * Options: --supply <whole tokens> --paired <quote address> --fee-in both|quote --dev-buy <ETH> --share-with-holders
 *          --airdrop-list <file.json|file.txt> --airdrop-bps <1..9000> --lockup-days <n, at least 1> --vesting-days <n, at least 0>
 *          --image <url> --description <text> --website --twitter --telegram --discord <value> --json --body-only
 *          --save-prepare <file> (writes the raw prepare response, for audit; a prepare is never sent twice)
 * Signer: PRIVATE_KEY (viem) or BANKR_API_KEY + BANKR_WALLET (Bankr /wallet/submit, raw calldata); --from 0x... with no key
 *         simulates only. Exit 0 ok, 1 failure or revert, 2 usage.
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, RPC_URL, B420_API.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, isAddress, parseAbi } from "viem";
import { ADDR, api, errorLine, fail, fromUnits, getSigner, out, parseArgs, publicClient, runSteps, toJson, usage } from "../../examples/lib/b420.mjs";

const USAGE = `usage: node launch/examples/launch-classic.mjs [--name <n> --symbol <s>] [--supply <whole>] [--paired <addr>]
  [--fee-in both|quote] [--dev-buy <eth>] [--share-with-holders]
  [--airdrop-list <file> --airdrop-bps <1..9000> --lockup-days <n> --vesting-days <n>]
  [--image <url>] [--description <t>] [--website|--twitter|--telegram|--discord <v>]
  [--from 0x..] [--send|--print] [--json] [--body-only] [--save-prepare <file>]`;

// B420Factory v2 (b420-factory/src/Clanker.sol, IClanker.sol): deployToken 0xf8d04011 and every revert a launch can hit.
const FACTORY_ABI = parseAbi([
  "struct TokenConfig { address tokenAdmin; string name; string symbol; bytes32 salt; string image; string metadata; string context; uint256 originatingChainId; uint256 supply; }",
  "struct PoolConfig { address hook; address pairedToken; int24 tickIfToken0IsClanker; int24 tickSpacing; bytes poolData; }",
  "struct LockerConfig { address locker; address[] rewardAdmins; address[] rewardRecipients; uint16[] rewardBps; int24[] tickLower; int24[] tickUpper; uint16[] positionBps; bytes lockerData; }",
  "struct MevModuleConfig { address mevModule; bytes mevModuleData; }",
  "struct ExtensionConfig { address extension; uint256 msgValue; uint16 extensionBps; bytes extensionData; }",
  "struct DeploymentConfig { TokenConfig tokenConfig; PoolConfig poolConfig; LockerConfig lockerConfig; MevModuleConfig mevModuleConfig; ExtensionConfig[] extensionConfigs; }",
  "function deployToken(DeploymentConfig deploymentConfig) payable returns (address tokenAddress)",
  "function deprecated() view returns (bool)",
  "function feeCollector() view returns (address)",
  "error B420InvalidProtocolSplit()",
  "error B420VanitySuffixRequired()",
  "error Deprecated()",
  "error OnlyOriginatingChain()",
  "error InvalidSupply()",
  "error ExtensionMsgValueMismatch()",
  "error ExtensionNotEnabled()",
  "error MaxExtensionBpsExceeded()",
  "error MaxExtensionsExceeded()",
  "error HookNotEnabled()",
  "error LockerNotEnabled()",
  "error MevModuleNotEnabled()",
]);
// Extensions a launch can carry (airdrop v2, distributor extension, the three dev-buy extensions).
const EXTENSION_ERRORS = parseAbi([
  "error InvalidAirdropPercentage()",
  "error AirdropLockupDurationTooShort()",
  "error AirdropAlreadyExists()",
  "error InvalidMsgValue()",
  "error NoSupplyAllowed()",
  "error NotRoutedToDistributor(address predicted)",
  "error DistributorNotCreated(address predicted)",
  "error InvalidEthDevBuyPercentage()",
  "error InvalidPairedTokenPoolKey()",
  "error RouterNotAllowed(address router)",
  "error FirstHopFailed()",
  "error InsufficientPairedOut(uint256 got, uint256 minimum)",
]);

const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { flags } = parseArgs(process.argv.slice(2), { booleans: ["body-only"] });
if (flags.help) usage(USAGE);
const log = (line) => process.stderr.write(`${line}\n`);
const say = (line) => (flags.json || flags.print ? log(line) : process.stdout.write(`${line}\n`));

main().catch((e) => fail(errorLine(e)));

async function main() {
  // ── Status and name check (launch/SKILL.md section 1) ──
  const status = await api("/launch").catch((e) => fail(`GET /api/launch failed: ${e.message}`));
  if (!flags.name && !flags.symbol) {
    const deprecatedV2 = await publicClient.readContract({ address: ADDR.factoryV2, abi: FACTORY_ABI, functionName: "deprecated" });
    out({ paused: status.paused, live: status.live, factory: status.factory, factoryDeprecated: deprecatedV2, predictedSuffix: status.predictedSuffix, openingValuationUsd: status.openingValuationUsd }, flags);
    return;
  }
  if (typeof flags.name !== "string" || typeof flags.symbol !== "string") usage(`--name and --symbol go together.\n${USAGE}`);
  if (status.paused) fail("Launches are paused on b420.io (GET /api/launch paused: true). Nothing was prepared.");
  if (!status.live || !status.factory) fail("The B420 factory is not live (GET /api/launch live: false). Nothing was prepared.");
  if (getAddress(status.factory) !== ADDR.factoryV2) fail(`GET /api/launch names factory ${status.factory}, not factory v2 ${ADDR.factoryV2}. Stop and re-read launch/classic/SKILL.md.`);

  const name = flags.name.trim();
  const symbol = flags.symbol.trim().toUpperCase();
  if (!name || name.length > 48) usage("--name must be 1 to 48 characters (the API cuts longer names).");
  if (!symbol || symbol.length > 12) usage("--symbol must be 1 to 12 characters (the API cuts longer tickers).");

  const signer = getSigner(flags);
  const recipient = signer.address;
  if (!recipient) fail("Set PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET, or pass --from 0x... to simulate.");

  // ── 1. Prepare: the POST body (every option the route reads; see "Options in depth") ──
  const body = { name, symbol, rewardRecipient: recipient };
  if (flags.supply !== undefined) {
    if (!/^[0-9]{1,15}$/.test(String(flags.supply)) || BigInt(flags.supply) === 0n) usage("--supply must be a whole number of tokens, 1 to 999999999999999.");
    body.supply = String(flags.supply);
  }
  if (flags.paired !== undefined) {
    if (!isAddress(String(flags.paired), { strict: false })) usage("--paired must be a token address.");
    body.pairedTokenAddress = getAddress(flags.paired);
  }
  if (flags["fee-in"] !== undefined) {
    if (flags["fee-in"] !== "both" && flags["fee-in"] !== "quote") usage("--fee-in is both or quote.");
    body.creatorFeeIn = flags["fee-in"];
  }
  if (flags["dev-buy"] !== undefined) {
    const v = String(flags["dev-buy"]);
    if (!/^[0-9]*\.?[0-9]+$/.test(v) || Number(v) <= 0 || Number(v) > 50) usage("--dev-buy is an ETH amount above 0 and at most 50.");
    body.devBuyEth = v;
  }
  if (flags["share-with-holders"]) body.shareWithHolders = true;
  for (const k of ["image", "description", "website", "twitter", "telegram", "discord"]) {
    if (flags[k] !== undefined && flags[k] !== true) body[k] = String(flags[k]);
  }
  if (body.description && body.description.length > 500) usage("--description is at most 500 characters.");
  if (flags["airdrop-list"] !== undefined) body.airdrop = airdropFromFile(flags);
  else if (flags["airdrop-bps"] !== undefined) usage("--airdrop-bps needs --airdrop-list.");

  if (flags["body-only"]) {
    process.stdout.write(`${flags.json ? toJson(body) : JSON.stringify(body, null, 2)}\n`);
    return;
  }

  const check = await api(`/launch?name=${encodeURIComponent(name)}&symbol=${encodeURIComponent(symbol)}`).catch((e) => fail(`name check failed: ${e.message}`));
  if (check.taken) fail(`${check.error || "That name and ticker are taken."} Existing token: ${check.existing?.token}`);

  // ── 1. Prepare: POST /api/launch (single use; prepare again before every send) ──
  let prep;
  try {
    prep = await api("/launch", { method: "POST", body });
  } catch (e) {
    if (e.status === 409) fail(`duplicate (409): ${e.body?.error || ""} Existing token: ${e.body?.existing?.token}`);
    fail(`POST /api/launch refused (${e.status ?? "network"}): ${e.body?.error || e.message}`);
  }
  if (!prep?.success) fail(`POST /api/launch: ${prep?.error || "no success flag"}`);
  if (typeof flags["save-prepare"] === "string") writeFileSync(flags["save-prepare"], JSON.stringify(prep, null, 2)); // audit copy, never a replay

  // ── 2. Restore the bigints and check what you are about to sign ──
  const config = restoreConfig(prep.config);
  const value = BigInt(prep.value);
  const extensionSum = config.extensionConfigs.reduce((s, e) => s + e.msgValue, 0n);
  if (extensionSum !== value) fail(`prepare value ${value} differs from the sum of extensionConfigs[].msgValue ${extensionSum}: do not send.`);
  if (getAddress(prep.factory) !== ADDR.factoryV2) fail(`The prepare targets ${prep.factory}, not factory v2 ${ADDR.factoryV2}: do not send.`);
  if (prep.chainId !== 8453) fail(`The prepare is for chainId ${prep.chainId}, not Base (8453).`);
  const deprecated = await publicClient.readContract({ address: ADDR.factoryV2, abi: FACTORY_ABI, functionName: "deprecated" });
  if (deprecated) fail("Factory v2 deprecated() is true: launches are closed onchain.");
  const slice0 = { admin: config.lockerConfig.rewardAdmins[0], recipient: config.lockerConfig.rewardRecipients[0] };
  const expected = prep.holdersDistributor ? getAddress(prep.holdersDistributor) : recipient;
  if (getAddress(slice0.admin) !== expected || getAddress(slice0.recipient) !== expected) fail(`Creator slice is ${slice0.recipient} (admin ${slice0.admin}), expected ${expected}: do not send.`);

  const summary = {
    stage: "prepare",
    factory: prep.factory,
    predictedAddress: prep.predictedAddress,
    startingTick: prep.startingTick,
    pairedToken: config.poolConfig.pairedToken,
    supply: fromUnits(config.tokenConfig.supply, 18),
    value: `${fromUnits(value, 18, 18)} ETH`,
    creatorSlice: `${slice0.recipient} (admin ${slice0.admin}), 50% of LP fees`,
    protocolSlice: `${config.lockerConfig.rewardRecipients[1]} (FeeCollector v2), 50% of LP fees`,
    ...(prep.devBuy ? { devBuy: { amountEth: fromUnits(prep.devBuy.amountWei, 18, 18), venue: prep.devBuy.venue, expectedPairedOut: prep.devBuy.expectedPairedOut } } : {}),
    ...(prep.holdersDistributor ? { holdersDistributor: prep.holdersDistributor } : {}),
    ...(prep.airdrop ? { airdrop: prep.airdrop } : {}),
    ...(prep.warnings ? { warnings: prep.warnings } : {}),
  };
  if (flags.json) process.stdout.write(`${toJson(summary)}\n`);
  else if (flags.print) log(toJson(summary));
  else out(summary, flags);

  // ── 3. Simulate and send deployToken (value exactly prep.value; gas est x 1.5, or 3,000,000) ──
  const step = {
    label: `deployToken ${symbol} at ${prep.predictedAddress}`,
    to: ADDR.factoryV2,
    abi: FACTORY_ABI,
    functionName: "deployToken",
    args: [config],
    value,
    gasRule: "classicLaunch",
    abis: [EXTENSION_ERRORS],
  };
  const res = await runSteps([step], flags);

  // ── 4. Confirm: POST /api/launch/confirm { txHash } records the launch at once ──
  if (res.mode === "send") {
    const txHash = res.hashes[res.hashes.length - 1];
    let confirmed = null;
    for (let i = 0; i < 10 && !confirmed; i++) {
      try {
        confirmed = await api("/launch/confirm", { method: "POST", body: { txHash } });
      } catch (e) {
        if (e.status !== 404 && e.status !== 502) {
          say(`confirm refused (${e.status}): ${e.body?.error || e.message}. The worker indexes the launch within about 2 minutes.`);
          break;
        }
        await sleep(6000);
      }
    }
    const token = confirmed?.token || prep.predictedAddress;
    const result = { stage: "confirm", ok: Boolean(confirmed?.ok), token, page: `https://b420.io/terminal/${token}`, ...(confirmed ? { routed: confirmed.routed, distributor: confirmed.distributor } : {}) };
    if (flags.json) process.stdout.write(`${toJson(result)}\n`);
    else out(result, flags);
    say("Trading opens 2 blocks after the launch block (PoolLocked before that): see trade/SKILL.md.");
  }
}

// ── helpers ──
function restoreConfig(c) {
  // The JSON carries three uint256 fields as strings; everything else is already in viem's shape.
  return {
    ...c,
    tokenConfig: { ...c.tokenConfig, originatingChainId: BigInt(c.tokenConfig.originatingChainId), supply: BigInt(c.tokenConfig.supply) },
    extensionConfigs: (c.extensionConfigs ?? []).map((e) => ({ ...e, msgValue: BigInt(e.msgValue) })),
  };
}

function airdropFromFile(f) {
  const bps = Number(f["airdrop-bps"]);
  const lockupDays = Number(f["lockup-days"]);
  const vestingDays = f["vesting-days"] === undefined ? 0 : Number(f["vesting-days"]);
  if (!Number.isInteger(bps) || bps < 1 || bps > 9000) usage("--airdrop-bps is an integer from 1 to 9000 (0.01% to 90% of the supply).");
  if (!Number.isFinite(lockupDays) || lockupDays < 1) usage("--lockup-days must be at least 1 (the airdrop extension refuses less).");
  if (!Number.isFinite(vestingDays) || vestingDays < 0) usage("--vesting-days cannot be negative.");
  let text;
  try {
    text = readFileSync(String(f["airdrop-list"]), "utf8");
  } catch (e) {
    usage(`cannot read --airdrop-list: ${e.message}`);
  }
  // JSON: ["0x..", ...] | [{ "address": "0x..", "weight": 2 }, ...] | { "0x..": 2, ... }. Anything else: one line per
  // recipient, "address" or "address,weight", the format the route parses itself.
  let rows = null;
  if (/^\s*[[{]/.test(text)) {
    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      usage(`--airdrop-list is not valid JSON: ${e.message}`);
    }
    if (Array.isArray(j)) rows = j.map((x) => (typeof x === "string" ? [x, null] : [x?.address, x?.weight ?? x?.amount ?? null]));
    else rows = Object.entries(j);
  } else {
    rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//")).map((l) => {
      const p = l.split(/[,;\t ]+/).filter(Boolean);
      return [p[0], p[1] ?? null];
    });
  }
  const lines = [];
  rows.forEach(([addr, weight], i) => {
    if (!isAddress(String(addr), { strict: false })) usage(`airdrop entry ${i + 1}: "${addr}" is not an address.`);
    if (BURN.has(String(addr).toLowerCase())) usage(`airdrop entry ${i + 1}: burn address refused.`);
    if (weight !== null && !(Number(weight) > 0)) usage(`airdrop entry ${i + 1}: weight must be a number above 0.`);
    lines.push(weight === null ? getAddress(addr) : `${getAddress(addr)},${weight}`);
  });
  if (!lines.length) usage("--airdrop-list holds no recipient.");
  return { bps, lockupDays, vestingDays, source: "list", list: lines.join("\n") };
}
