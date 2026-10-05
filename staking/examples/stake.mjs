#!/usr/bin/env node
/**
 * B420 staking: stake B420 (earn the registry tokenized stocks) or B69 (earn B420), unstake through the 48h unbonding,
 * withdraw, cancel, exit, claim; and the exit-only calls left to legacy dividend vault stakers.
 * Single copy of the recipe: staking/SKILL.md.
 *
 *   npm ci        (once, at the repo root)
 *   node staking/examples/stake.mjs b420 --from 0x...                          # position, read only
 *   node staking/examples/stake.mjs b420 stake 0.5 --from 0x...                # simulate approve + stake, nothing sent
 *   PRIVATE_KEY=0x... node staking/examples/stake.mjs b69 stake all --send
 *   BANKR_API_KEY=... BANKR_WALLET=0x... node staking/examples/stake.mjs b420 claim --send
 *   node staking/examples/stake.mjs b420 claim --token 0xb20000000000000000000078ee7ce2fE4908108C --from 0x... --print
 *   node staking/examples/stake.mjs vault:0x297A304167F6dc057c300fabE58b772c6DB0d22d unstake all --from 0x...
 *
 * Actions: position (default) | stake <amount|all> | unstake <amount|all> | withdraw | cancel | exit | claim [--token <reward>]
 *          on b420 or b69. vault:0x... accepts position | unstake | withdraw | cancel | claim; stake and exit are refused
 *          (the vault product is closed: existing stakers exit only).
 *          An action without --send simulates every step from the signer (or --from 0x... with no key) and prints the
 *          calls; --send broadcasts after re-simulating; --print emits raw tx JSON per step; --json machine output.
 * Signer: PRIVATE_KEY (viem) or BANKR_API_KEY + BANKR_WALLET (Bankr /wallet/submit, raw calldata). Exit 0 ok, 1 failure
 *         or revert, 2 usage.
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, RPC_URL.
 */
import { getAddress, isAddress, parseAbi } from "viem";
import { ADDR, ERC20_ABI, approvalStep, errorLine, fail, fromUnits, getSigner, out, parseArgs, publicClient, runSteps, toUnits, tokenMeta, usage } from "../../examples/lib/b420.mjs";

const USAGE = `usage: node staking/examples/stake.mjs <b420|b69|vault:0x..> [position|stake|unstake|withdraw|cancel|exit|claim] [amount|all]
  [--token <rewardToken>] [--from 0x..] [--send|--print] [--json]`;

// B420MultiStaking (b420-factory/src/b420/B420MultiStaking.sol): StakingB420 and StakingB69 share this ABI.
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
  "function stakingToken() view returns (address)",
  "function stakedBalance(address account) view returns (uint256)",
  "function unbondingAmount(address account) view returns (uint256)",
  "function unbondingUnlockAt(address account) view returns (uint256)",
  "function cooldownPeriod() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "error ZeroAmount()",
  "error InsufficientStake()",
  "error NothingUnbonding()",
  "error CooldownNotElapsed()",
  "error NotRewardToken()",
]);
// B420DividendVault (b420-factory/src/b420/B420DividendVault.sol; site lib/contracts/b420-dividend.ts). One reward token.
const VAULT_ABI = parseAbi([
  "function requestUnstake(uint256 amount)",
  "function withdraw()",
  "function cancelUnstake()",
  "function getReward()",
  "function earned(address account) view returns (uint256)",
  "function rewardClaimable(address account) view returns (uint256)",
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function stakedBalance(address account) view returns (uint256)",
  "function unbondingAmount(address account) view returns (uint256)",
  "function unbondingUnlockAt(address account) view returns (uint256)",
  "function cooldownPeriod() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "error ZeroAmount()",
  "error InsufficientStake()",
  "error NothingUnbonding()",
  "error CooldownNotElapsed()",
  "error RewardTransferFailed()",
]);
const VAULT_FACTORY_ABI = parseAbi(["function vaultFor(address meme) view returns (address)", "function paused() view returns (bool)"]);

const POOLS = {
  b420: { address: ADDR.stakingB420, name: "StakingB420" },
  b69: { address: ADDR.stakingB69, name: "StakingB69" },
};
const ACTIONS = ["position", "stake", "unstake", "withdraw", "cancel", "exit", "claim"];
const VAULT_ACTIONS = ["position", "unstake", "withdraw", "cancel", "claim"];

const { _, flags } = parseArgs(process.argv.slice(2));
if (flags.help || !_[0]) usage(USAGE);
const say = (line) => (flags.json || flags.print ? process.stderr : process.stdout).write(`${line}\n`);
const iso = (t) => new Date(Number(t) * 1000).toISOString();

main().catch((e) => fail(errorLine(e)));

async function main() {
  // ── Target, action, account ──
  const target = String(_[0]).toLowerCase();
  const action = (_[1] || "position").toLowerCase();
  if (!ACTIONS.includes(action)) usage(`unknown action "${action}".\n${USAGE}`);
  const isVault = target.startsWith("vault:");
  if (!isVault && !POOLS[target]) usage(`target is b420, b69 or vault:0x..., got "${_[0]}".\n${USAGE}`);
  if (isVault && !VAULT_ACTIONS.includes(action)) {
    fail(`${action} is refused on a dividend vault: the vault product is closed (vault factory paused) and existing stakers may only unstake, withdraw, cancel or claim.`);
  }
  if (flags.token !== undefined && (isVault || action !== "claim")) usage("--token goes with claim on b420 or b69 only.");

  const signer = getSigner(flags);
  const me = signer.address; // null: pool-level read only

  let pool, abi, stakingToken, rewardTokens;
  if (isVault) {
    const v = target.slice(6);
    if (!isAddress(v, { strict: false })) usage(`vault:${v} is not an address.`);
    pool = { address: getAddress(v), name: "dividend vault" };
    abi = VAULT_ABI;
    [stakingToken, rewardTokens] = await Promise.all([
      publicClient.readContract({ address: pool.address, abi, functionName: "stakingToken" }),
      publicClient.readContract({ address: pool.address, abi, functionName: "rewardToken" }).then((t) => [t]),
    ]).catch(() => fail(`${pool.address} does not answer as a B420DividendVault.`));
    const registered = await publicClient.readContract({ address: ADDR.vaultFactoryLegacy, abi: VAULT_FACTORY_ABI, functionName: "vaultFor", args: [stakingToken] });
    if (getAddress(registered) !== pool.address) fail(`${pool.address} is not the legacy vault factory's vault for ${stakingToken}; refusing an unknown contract.`);
  } else {
    pool = POOLS[target];
    abi = STAKING_ABI;
    [stakingToken, rewardTokens] = await Promise.all([
      publicClient.readContract({ address: pool.address, abi, functionName: "stakingToken" }),
      publicClient.readContract({ address: pool.address, abi, functionName: "rewardTokens" }),
    ]);
  }
  const stakeMeta = await tokenMeta(stakingToken);
  const rewardMetas = await Promise.all(rewardTokens.map((t) => tokenMeta(t)));
  const read = (functionName, args = []) => publicClient.readContract({ address: pool.address, abi, functionName, args });

  // ── Read a position (no read is needed to stake or claim; this is for display and the guards below) ──
  const [cooldown, totalStaked, block] = await Promise.all([read("cooldownPeriod"), read("totalStaked"), publicClient.getBlock()]);
  let pos = null;
  if (me) {
    const [staked, unbonding, unlockAt, wallet, earned] = await Promise.all([
      read("stakedBalance", [me]),
      read("unbondingAmount", [me]),
      read("unbondingUnlockAt", [me]),
      publicClient.readContract({ address: stakingToken, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }),
      isVault
        ? Promise.all([read("earned", [me]), read("rewardClaimable", [me])]).then(([e, c]) => [c > e ? c : e])
        : Promise.all(rewardTokens.map((t) => read("earned", [me, t]))),
    ]);
    pos = { staked, unbonding, unlockAt, wallet, earned };
  }

  if (action === "position") {
    const view = {
      pool: `${pool.name} ${pool.address}`,
      stakingToken: `${stakeMeta.symbol} ${stakeMeta.address} (${stakeMeta.decimals} decimals)`,
      cooldown: `${cooldown} s (${Number(cooldown) / 3600} h)`,
      totalStaked: `${fromUnits(totalStaked, stakeMeta.decimals)} ${stakeMeta.symbol}`,
      ...(isVault ? { note: "Legacy dividend vault, closed: unstake, withdraw, cancel and claim only." } : {}),
    };
    if (pos) {
      Object.assign(view, {
        account: me,
        wallet: `${fromUnits(pos.wallet, stakeMeta.decimals)} ${stakeMeta.symbol}`,
        staked: `${fromUnits(pos.staked, stakeMeta.decimals)} ${stakeMeta.symbol}`,
        share: totalStaked > 0n ? `${((Number(pos.staked) / Number(totalStaked)) * 100).toFixed(2)}%` : "0%",
        unbonding: `${fromUnits(pos.unbonding, stakeMeta.decimals)} ${stakeMeta.symbol}`,
        unlockAt: pos.unbonding > 0n ? `${iso(pos.unlockAt)}${pos.unlockAt <= block.timestamp ? " (withdrawable now)" : ""}` : "-",
        earned: rewardMetas.map((m, i) => ({ token: m.address, symbol: m.symbol, amount: fromUnits(pos.earned[i], m.decimals, m.decimals) })),
      });
    } else view.account = "none (set PRIVATE_KEY or BANKR_WALLET, or pass --from 0x... to read a position)";
    out(view, flags);
    return;
  }

  if (!me) fail("Set PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET, or pass --from 0x... to simulate.");
  const amountOf = (cap, what) => {
    const raw = _[2];
    if (raw === undefined) usage(`${action} needs an amount or "all".\n${USAGE}`);
    if (String(raw).toLowerCase() === "all") {
      if (cap === 0n) fail(`No ${stakeMeta.symbol} ${what}.`);
      return cap;
    }
    const v = toUnits(raw, stakeMeta.decimals);
    if (v === 0n) fail(`Amount is zero: ${action} would revert ZeroAmount() (0x1f2a2005).`);
    return v;
  };
  const fmt = (v) => `${fromUnits(v, stakeMeta.decimals, stakeMeta.decimals)} ${stakeMeta.symbol}`;
  const clockWarning = () => {
    if (pos.unbonding > 0n) say(`warning: ${fmt(pos.unbonding)} is already unbonding (unlock ${iso(pos.unlockAt)}). This call restarts the ${Number(cooldown) / 3600} h clock for the whole unbonding balance.`);
  };

  // ── Build the steps ──
  const steps = [];
  if (action === "stake") {
    // ── 1. Stake: approve the exact amount, then stake(amount). Earning starts in the same block ──
    const amount = amountOf(pos.wallet, "in the wallet");
    if (pos.wallet < amount) fail(`Wallet holds ${fmt(pos.wallet)}, less than ${fmt(amount)}.`);
    const approve = await approvalStep({ token: stakingToken, owner: me, spender: pool.address, amount, gasRule: "stockApprove" }); // B20 approve gas: trade/SKILL.md approvals
    if (approve) steps.push(approve);
    steps.push({ label: `stake ${fmt(amount)} in ${pool.name}`, to: pool.address, abi, functionName: "stake", args: [amount] });
  } else if (action === "claim") {
    // ── 2. Claim: getReward() pays every reward token (skipping a failing one); getReward(token) pays one or reverts ──
    const total = pos.earned.reduce((s, x) => s + x, 0n);
    if (flags.token !== undefined) {
      if (!isAddress(String(flags.token), { strict: false })) usage("--token must be a reward token address.");
      const t = getAddress(flags.token);
      const i = rewardTokens.findIndex((x) => getAddress(x) === t);
      const owed = i >= 0 ? pos.earned[i] : await read("earned", [me, t]);
      if (owed === 0n) fail(`Nothing earned in ${t} (earned(account, token) = 0).`);
      const m = await tokenMeta(t);
      steps.push({ label: `getReward(${m.symbol}): ${fromUnits(owed, m.decimals, m.decimals)} ${m.symbol}`, to: pool.address, abi, functionName: "getReward", args: [t] });
    } else {
      if (total === 0n) fail(isVault ? `Nothing claimable: earned(account) and rewardClaimable(account) are 0 (${rewardMetas[0].symbol}).` : `Nothing earned: earned(account, token) is 0 for every reward token (${rewardMetas.map((m) => m.symbol).join(", ")}).`);
      const parts = rewardMetas.map((m, i) => (pos.earned[i] > 0n ? `${fromUnits(pos.earned[i], m.decimals, m.decimals)} ${m.symbol}` : null)).filter(Boolean);
      steps.push({ label: `getReward(): ${parts.join(", ")}`, to: pool.address, abi, functionName: "getReward", args: [] });
    }
  } else if (action === "unstake") {
    // ── 3. Unstake: requestUnstake(amount) stops earning now; withdraw after the cooldown ──
    const amount = amountOf(pos.staked, "staked");
    if (pos.staked < amount) fail(`Staked ${fmt(pos.staked)}, less than ${fmt(amount)}: requestUnstake would revert InsufficientStake() (0xf1bc94d2).`);
    clockWarning();
    steps.push({ label: `requestUnstake ${fmt(amount)} (withdrawable ${Number(cooldown) / 3600} h after it lands)`, to: pool.address, abi, functionName: "requestUnstake", args: [amount] });
  } else if (action === "withdraw") {
    if (pos.unbonding === 0n) fail("Nothing unbonding: withdraw() would revert NothingUnbonding() (0x262b9d74).");
    if (block.timestamp < pos.unlockAt) fail(`${fmt(pos.unbonding)} unlocks at ${iso(pos.unlockAt)} (chain time now ${iso(block.timestamp)}); withdraw() before that reverts CooldownNotElapsed() (0xa22b745e).`);
    steps.push({ label: `withdraw ${fmt(pos.unbonding)} to ${me}`, to: pool.address, abi, functionName: "withdraw", args: [] });
  } else if (action === "cancel") {
    if (pos.unbonding === 0n) fail("Nothing unbonding: cancelUnstake() would revert NothingUnbonding() (0x262b9d74).");
    steps.push({ label: `cancelUnstake: re-stake ${fmt(pos.unbonding)}`, to: pool.address, abi, functionName: "cancelUnstake", args: [] });
  } else if (action === "exit") {
    // exit() = getReward() + requestUnstake(everything staked).
    if (pos.staked === 0n) fail("Nothing staked: use claim for rewards, withdraw for an unlocked unbonding balance.");
    clockWarning();
    steps.push({ label: `exit: claim every reward token, requestUnstake ${fmt(pos.staked)}`, to: pool.address, abi, functionName: "exit", args: [] });
  }

  // ── Simulate (default), --send or --print ──
  await runSteps(steps, flags);
}
