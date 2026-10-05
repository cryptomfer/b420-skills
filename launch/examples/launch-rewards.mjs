#!/usr/bin/env node
/**
 * B420 holder-rewards launch: POST https://b420.io/api/launch/rewards mines a salt bound to your sending wallet, then one
 * B420RewardsFactory.launch call (payable), after an exact approval when an ERC-20 pair carries a dev buy.
 * Single copy of the recipe: launch/rewards/SKILL.md.
 *
 *   npm ci        (once, at the repo root)
 *   node launch/examples/launch-rewards.mjs                                                        # factory state only
 *   node launch/examples/launch-rewards.mjs --name "My Token" --symbol MYT --holders-bps 5000 --from 0x...   # prepare + simulate
 *   PRIVATE_KEY=0x... node launch/examples/launch-rewards.mjs --name "My Token" --symbol MYT --holders-bps 5000 --dev-buy 0.01 --send
 *   BANKR_API_KEY=... BANKR_WALLET=0x... node launch/examples/launch-rewards.mjs --name ... --symbol ... --holders-bps 10000 --send
 *   node launch/examples/launch-rewards.mjs --name ... --symbol ... --holders-bps 5000 --from 0x... --print   # raw tx JSON per step
 *
 * Actions: no --name/--symbol = read the rewards factory only. With --name, --symbol and --holders-bps: name check, POST
 *          /api/launch/rewards (sender = the signer or --from), restore the bigints, check the prediction onchain, then
 *          simulate [approve paired asset] + launch as one bundle. --send broadcasts each step after re-simulating it,
 *          then POST /api/launch/confirm { txHash } (404 retried 10 x 6 s).
 * Options: --supply <whole tokens> --paired <ERC-20 address; empty or WETH = native ETH> --dev-buy <amount in paired units>
 *          --creator 0x... (fee recipient, defaults to the sender) --image <url> --description <text>
 *          --website --twitter --telegram --discord <value> --json --save-prepare <file> (audit copy, never a replay)
 * Signer: PRIVATE_KEY (viem) or BANKR_API_KEY + BANKR_WALLET (Bankr /wallet/submit, raw calldata); --from 0x... with no key
 *         simulates only. The salt is mined for the sender: never send a prepare from another wallet. Exit 0 ok, 1 failure
 *         or revert, 2 usage.
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, RPC_URL, B420_API.
 */
import { writeFileSync } from "node:fs";
import { getAddress, isAddress, parseAbi } from "viem";
import { ADDR, ZERO, api, approvalStep, errorLine, fail, fromUnits, getSigner, out, parseArgs, publicClient, runSteps, toJson, usage } from "../../examples/lib/b420.mjs";

const USAGE = `usage: node launch/examples/launch-rewards.mjs [--name <n> --symbol <s> --holders-bps <1..10000>]
  [--supply <whole>] [--paired <addr>] [--dev-buy <amount>] [--creator 0x..] [--image <url>] [--description <t>]
  [--website|--twitter|--telegram|--discord <v>] [--from 0x..] [--send|--print] [--json] [--save-prepare <file>]`;

// B420RewardsFactory (b420-factory/src/rewards/B420RewardsFactory.sol): launch 0x1379dda9, the views a launch checks, every revert.
const REWARDS_FACTORY_ABI = parseAbi([
  "struct LaunchParams { string name; string symbol; uint256 supply; address pairedAsset; uint16 holdersBps; address creator; bytes32 salt; int24 startingTick; uint256 devBuy; }",
  "function launch(LaunchParams p) payable returns (address token, bytes32 poolId)",
  "function predictToken(LaunchParams p, address sender) view returns (address)",
  "function tokenCount() view returns (uint256)",
  "function MAX_HOLDERS_BPS() view returns (uint16)",
  "function DEFAULT_SUPPLY() view returns (uint256)",
  "function hook() view returns (address)",
  "function ledger() view returns (address)",
  "error EmptyName()",
  "error NameTaken(address existing)",
  "error BadHoldersBps()",
  "error BadSupply()",
  "error BadPairedAsset()",
  "error BadTick()",
  "error BadValue()",
  "error BadVanity(address predicted)",
  "error DevBuyFailed()",
  "error BadCreator(address creator)",
]);
// The hook runs inside launch (pool creation and the dev buy swap).
const HOOK_ERRORS = parseAbi([
  "error OnlyFactory()",
  "error UnknownPool()",
  "error PoolLocked()",
  "error PartialFill()",
  "error BadLaunch()",
  "error InsufficientGas()",
  "error TooLarge()",
  "error OpenDeltas()",
  "error SafeERC20FailedOperation(address token)",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isB20 = (a) => /^0xb20{20}/i.test(a); // Base B20 assets (tokenized stocks, B420, B69): precompile, approve gas rule
const { flags } = parseArgs(process.argv.slice(2));
if (flags.help) usage(USAGE);
const log = (line) => process.stderr.write(`${line}\n`);
const say = (line) => (flags.json || flags.print ? log(line) : process.stdout.write(`${line}\n`));

main().catch((e) => fail(errorLine(e)));

async function main() {
  // ── No action: the factory's fixed rules ──
  if (!flags.name && !flags.symbol) {
    const read = (functionName) => publicClient.readContract({ address: ADDR.rewardsFactory, abi: REWARDS_FACTORY_ABI, functionName });
    const [tokenCount, maxHoldersBps, defaultSupply, hook, ledger] = await Promise.all(["tokenCount", "MAX_HOLDERS_BPS", "DEFAULT_SUPPLY", "hook", "ledger"].map(read));
    out({ factory: ADDR.rewardsFactory, tokenCount, maxHoldersBps, defaultSupply: fromUnits(defaultSupply, 18), hook, ledger }, flags);
    return;
  }
  if (typeof flags.name !== "string" || typeof flags.symbol !== "string") usage(`--name and --symbol go together.\n${USAGE}`);
  const name = flags.name.trim();
  const symbol = flags.symbol.trim().toUpperCase();
  if (!name || name.length > 48) usage("--name must be 1 to 48 characters.");
  if (!symbol || symbol.length > 12) usage("--symbol must be 1 to 12 characters.");
  const holdersBps = Number(flags["holders-bps"]);
  if (!Number.isInteger(holdersBps) || holdersBps < 1 || holdersBps > 10000) usage("--holders-bps is an integer from 1 to 10000 (bps of the creator half).");

  const signer = getSigner(flags);
  const sender = signer.address;
  if (!sender) fail("Set PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET, or pass --from 0x... to simulate.");

  // ── Name check (launch/SKILL.md section 1: the launches table and the factory's byNameSymbol) ──
  const check = await api(`/launch/rewards?name=${encodeURIComponent(name)}&symbol=${encodeURIComponent(symbol)}`).catch((e) => fail(`name check failed: ${e.message}`));
  if (check.taken) fail(`${check.error || "That name and ticker are taken."} Existing token: ${check.existing?.token}`);

  // ── 1. Prepare: POST /api/launch/rewards (the salt is mined for `sender`; one prepare, one send) ──
  const body = { sender, name, symbol, holdersBps };
  if (flags.supply !== undefined) {
    if (!/^[0-9]{1,15}$/.test(String(flags.supply)) || BigInt(flags.supply) === 0n) usage("--supply must be a whole number of tokens, 1 to 999999999999999.");
    body.supply = String(flags.supply);
  }
  if (flags.paired !== undefined) {
    if (!isAddress(String(flags.paired), { strict: false })) usage("--paired must be a token address.");
    body.pairedTokenAddress = getAddress(flags.paired);
  }
  if (flags["dev-buy"] !== undefined) {
    const v = String(flags["dev-buy"]);
    if (!/^[0-9]*\.?[0-9]+$/.test(v) || !(Number(v) > 0)) usage("--dev-buy is an amount above 0, in units of the paired asset.");
    body.devBuy = v;
  }
  if (flags.creator !== undefined) {
    if (!isAddress(String(flags.creator), { strict: false })) usage("--creator must be a wallet address.");
    body.creator = getAddress(flags.creator);
  }
  for (const k of ["image", "description", "website", "twitter", "telegram", "discord"]) {
    if (flags[k] !== undefined && flags[k] !== true) body[k] = String(flags[k]);
  }

  let prep;
  try {
    prep = await api("/launch/rewards", { method: "POST", body });
  } catch (e) {
    const code = e.body?.code ? ` ${e.body.code}` : "";
    if (e.status === 409) fail(`duplicate (409): ${e.body?.error || ""} Existing token: ${e.body?.existing?.token}`);
    fail(`POST /api/launch/rewards refused (${e.status ?? "network"}${code}): ${e.body?.error || e.message}`);
  }
  if (!prep?.success) fail(`POST /api/launch/rewards: ${prep?.error || "no success flag"}`);
  if (typeof flags["save-prepare"] === "string") writeFileSync(flags["save-prepare"], JSON.stringify(prep, null, 2)); // audit copy, never a replay

  // ── 1. Prepare: restore the bigints and check what you are about to sign ──
  if (prep.kind !== "rewards" || prep.chainId !== 8453) fail(`unexpected prepare kind ${prep.kind} / chainId ${prep.chainId}.`);
  if (getAddress(prep.factory) !== ADDR.rewardsFactory) fail(`The prepare targets ${prep.factory}, not B420RewardsFactory ${ADDR.rewardsFactory}: do not send.`);
  if (getAddress(prep.sender) !== sender) fail(`The salt was mined for ${prep.sender}, not ${sender}: prepare again from the sending wallet.`);
  const params = { ...prep.params, supply: BigInt(prep.params.supply), devBuy: BigInt(prep.params.devBuy) };
  const value = BigInt(prep.value);
  const isEth = params.pairedAsset.toLowerCase() === ZERO;
  if (params.holdersBps !== holdersBps) fail(`prepared holdersBps ${params.holdersBps} differs from ${holdersBps}: do not send.`);
  if (getAddress(params.creator) !== (body.creator ?? sender)) fail(`prepared creator ${params.creator} differs from ${body.creator ?? sender}: do not send.`);
  if (value !== (isEth ? params.devBuy : 0n)) fail(`prepared value ${value} breaks the factory rule (ETH pair: value = devBuy; ERC-20 pair: 0); do not send.`);
  const predicted = await publicClient.readContract({ address: ADDR.rewardsFactory, abi: REWARDS_FACTORY_ABI, functionName: "predictToken", args: [params, sender] });
  if (predicted.toLowerCase() !== prep.predictedAddress.toLowerCase()) fail(`factory predicts ${predicted}, the prepare says ${prep.predictedAddress}: do not send.`);

  const summary = {
    stage: "prepare",
    factory: prep.factory,
    sender: prep.sender,
    predictedAddress: prep.predictedAddress,
    paired: `${prep.paired.symbol} ${prep.paired.address} (${prep.paired.decimals} decimals)`,
    holdersBps: `${params.holdersBps} of the creator half (holders get ${params.holdersBps / 200}% of the 1% fee, ${params.holdersBps / 20000}% of each trade's ${prep.paired.symbol} leg)`,
    creator: params.creator,
    supply: fromUnits(params.supply, 18),
    startingTick: params.startingTick,
    devBuy: `${fromUnits(params.devBuy, prep.paired.decimals, prep.paired.decimals)} ${prep.paired.symbol}`,
    value: `${fromUnits(value, 18, 18)} ETH`,
    ...(prep.approval ? { approval: { token: prep.approval.token, spender: prep.approval.spender, amount: prep.approval.amount, allowance: prep.approval.allowance, balance: prep.approval.balance } } : {}),
    ...(prep.warnings ? { warnings: prep.warnings } : {}),
  };
  if (flags.json) process.stdout.write(`${toJson(summary)}\n`);
  else if (flags.print) log(toJson(summary));
  else out(summary, flags);

  // ── 2. Approve the paired asset (ERC-20 pair with a dev buy: the factory pulls it) ──
  const steps = [];
  if (prep.approval) {
    // Exact-approval rule (launch/rewards/SKILL.md rule 4): the server's figure must be the dev buy, in the paired asset.
    if (isEth || params.devBuy === 0n) fail(`the prepare asks for an approval on a launch without an ERC-20 dev buy: do not send.`);
    if (!isAddress(String(prep.approval.token), { strict: false }) || getAddress(prep.approval.token) !== getAddress(params.pairedAsset)) fail(`approval token ${prep.approval.token} is not the paired asset ${params.pairedAsset}: do not send.`);
    if (BigInt(prep.approval.amount) !== params.devBuy) fail(`approval amount ${prep.approval.amount} differs from the dev buy ${params.devBuy}: do not send.`);
    if (prep.approval.spender !== undefined && getAddress(prep.approval.spender) !== ADDR.rewardsFactory) fail(`approval spender ${prep.approval.spender} is not B420RewardsFactory ${ADDR.rewardsFactory}: do not send.`);
    const approve = await approvalStep({
      token: prep.approval.token,
      owner: sender,
      spender: ADDR.rewardsFactory,
      amount: params.devBuy,
      gasRule: isB20(prep.approval.token) ? "stockApprove" : "default", // approval gas: trade/SKILL.md approvals
    });
    if (approve) steps.push(approve);
  }
  // ── 3. Simulate and send launch (one bundle with the approval) ──
  steps.push({
    label: `launch ${symbol} at ${prep.predictedAddress}`,
    to: ADDR.rewardsFactory,
    abi: REWARDS_FACTORY_ABI,
    functionName: "launch",
    args: [params],
    value,
    // ETH pair with a dev buy: the swap runs the hook's 1M-gas B420 buyback, so max(est + 600k, est x 1.3), or 4.5M.
    gasRule: isEth && params.devBuy > 0n ? "rewardsLaunchEthDevBuy" : "rewardsLaunch",
    abis: [HOOK_ERRORS],
  });
  const res = await runSteps(steps, flags);

  // ── 4. Confirm: POST /api/launch/confirm { txHash } (the launch is the last step) ──
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
    const result = { stage: "confirm", ok: Boolean(confirmed?.ok), token, kind: confirmed?.kind ?? "rewards", page: `https://b420.io/terminal/${token}` };
    if (flags.json) process.stdout.write(`${toJson(result)}\n`);
    else out(result, flags);
    say("Trading opens 2 blocks after the launch block (PoolLocked before that): see trade/SKILL.md.");
  }
}
