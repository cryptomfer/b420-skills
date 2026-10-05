#!/usr/bin/env node
/**
 * B420 trade: buy or sell any token on B420 (Base). The market is detected onchain, every step is quoted and simulated first.
 *
 *   npm ci        (once, at the repo root)
 *   node trade/examples/trade.mjs <token>                                      # read only: path, pool key, 0.001 ETH reference quote
 *   node trade/examples/trade.mjs <token> buy 0.001 --from 0x...               # simulate every step from any address, no key
 *   PRIVATE_KEY=0x... node trade/examples/trade.mjs <token> buy 0.001          # simulate from the signer
 *   PRIVATE_KEY=0x... node trade/examples/trade.mjs <token> sell all --send    # re-simulate, then broadcast each step
 *   BANKR_API_KEY=... BANKR_WALLET=0x... node trade/examples/trade.mjs <token> sell 100 --send
 *   node trade/examples/trade.mjs <token> buy 0.001 --from 0x... --print       # raw tx JSON per step for CDP, Safe or relayers
 *   node trade/examples/trade.mjs <B69> buy 0.0005 --pay <B420> --from 0x...   # aggregator path only: pay with a token
 *
 * Actions: (none) read only | buy <amount> | sell <amount|all>
 *   buy:  ETH to spend; an amount of --pay on the aggregator path; an amount of the paired asset on an ERC-20-paired
 *         rewards token (the router takes only that asset).
 *   sell: token amount or all; proceeds in ETH, in --receive on the aggregator path, in the paired asset on an
 *         ERC-20-paired rewards token.
 *   --slippage <bps> (5 to 2000) overrides the per-path default (trade/SKILL.md). --json prints one plan line, then the
 *   result line.
 * Signer: PRIVATE_KEY (viem), or BANKR_API_KEY + BANKR_WALLET (Bankr /wallet/submit, raw calldata); without either,
 *         --from 0x... (or FROM) simulates only. Exit 0 ok, 1 failure or revert, 2 usage.
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, FROM, RPC_URL, B420_API.
 */
import { encodeAbiParameters, encodePacked, getAddress, isAddress, keccak256, parseAbi } from "viem";
import {
  ADDR,
  ETH,
  ERC20_ABI,
  INDEX_STACKS,
  ZERO,
  api,
  approvalStep,
  decodeRevert,
  errorLine,
  fail,
  feeEntries,
  fromUnits,
  getSigner,
  out,
  parseArgs,
  publicClient,
  runSteps,
  toJson,
  tokenMeta,
  toUnits,
  usage,
} from "../../examples/lib/b420.mjs";

const USAGE = "usage: node trade/examples/trade.mjs <token> [buy|sell] [amount|all] [--pay <token>] [--receive <token>] [--slippage <bps>] [--from 0x..] [--send|--print] [--json]";

// ── ABIs (b420-factory/src, Uniswap v4 periphery, Permit2) ──
const POOL_KEY = "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }";
const FEE_TAKE = "struct FeeTake { address recipient; uint16 bps; }";
const LOCKER_ABI = parseAbi([
  POOL_KEY,
  "struct TokenRewardInfo { address token; PoolKey poolKey; uint256 positionId; uint256 numPositions; uint16[] rewardBps; address[] rewardAdmins; address[] rewardRecipients; }",
  "function tokenRewards(address token) view returns (TokenRewardInfo)",
]);
const INDEX_FACTORY_ABI = parseAbi([POOL_KEY, "function isIndex(address token) view returns (bool)", "function poolKeyOf(address index) view returns (PoolKey)"]);
const INDEX_TOKEN_ABI = parseAbi(["function totalSupply() view returns (uint256)", "function feeBps() view returns (uint16)"]);
const INDEX_HOOK_ABI = parseAbi(["function MIN_FIRST_BUY() view returns (uint256)"]);
const REWARDS_FACTORY_ABI = parseAbi([
  POOL_KEY,
  "function isRewardsToken(address token) view returns (bool)",
  "function pairedOf(address token) view returns (address)",
  "function poolKeyOf(address token) view returns (PoolKey)",
]);
const REWARDS_HOOK_ABI = parseAbi([
  "struct LaunchPool { address token; uint64 launchBlock; bool tokenIs0; uint8 kind; address paired; }",
  "function poolIdOf(address token) view returns (bytes32)",
  "function poolOf(bytes32 id) view returns (LaunchPool)",
  "function LAUNCH_BLOCK_DELAY() view returns (uint256)",
]);
const MEV_ABI = parseAbi(["function poolUnlockTime(bytes32 poolId) view returns (uint256)"]);
const QUOTER_ABI = parseAbi([
  POOL_KEY,
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  "error UnexpectedRevertBytes(bytes revertData)",
  "error NotEnoughLiquidity(bytes32 poolId)",
]);
const UR_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
  "error DeltaNotNegative(address currency)",
  "error DeltaNotPositive(address currency)",
]);
const PERMIT2_ABI = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const HOP_ROUTER_ABI = parseAbi([
  POOL_KEY,
  "struct Leg { address router; bytes call; uint256 minOut; }",
  "function buyWithETH(address token, address quote, PoolKey key, Leg first, uint256 minTokenOut, address recipient, uint256 deadline) payable returns (uint256 tokenOut)",
  "function sellForETH(address token, address quote, PoolKey key, uint256 tokenIn, uint256 minQuoteOut, Leg last, uint256 sellAmount, address recipient, uint256 deadline) returns (uint256 ethOut)",
]);
const REWARDS_ROUTER_ABI = parseAbi([
  FEE_TAKE,
  "function buy(address token, uint256 amountIn, uint256 minOut, address recipient, FeeTake[] fees, uint256 deadline) payable returns (uint256 out)",
  "function sell(address token, uint256 amountIn, uint256 minOut, address recipient, FeeTake[] fees, uint256 deadline) returns (uint256 out)",
]);
const INDEX_ROUTER_ABI = parseAbi([
  FEE_TAKE,
  "function buy(address index, uint256 minShares, address recipient, FeeTake[] fees, uint256 deadline) payable returns (uint256 shares)",
  "function sell(address index, uint256 shares, uint256 minEthOut, address recipient, FeeTake[] fees, uint256 deadline) returns (uint256 ethOut)",
]);

// ── Constants ──
const BPS = 10_000n;
const REF_ETH = 10n ** 15n; // 0.001 ETH, the reference quote of a read
const PLACEHOLDER = "0x000000000000000000000000000000000000dEaD"; // /api/swap sender for a read with no signer
const UR_MSG_SENDER = "0x0000000000000000000000000000000000000001";
const UR_ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const CMD = { SWEEP: 0x04, PAY_PORTION: 0x06, WRAP_ETH: 0x0b, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10 };
const ACT = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE: 0x0e };
const PERMIT2_EXPIRY_S = 1800n; // onchain Permit2.approve: short expiry, the trade's own amount
// Per-path defaults, the single copy is trade/SKILL.md "Slippage, deadlines and quotes".
const SLIPPAGE = { aggregator: 100, rewards: 300, index: 200 };
const SLIPPAGE_RANGE = [5, 2000]; // POST /api/swap clamps to this range; every path uses the same bounds
const DEADLINE_S = { classic: 1200n, hop: 180n, rewards: 1200n, index: 1200n };

const isB20 = (a) => /^0xb2[0]{20}/i.test(a);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const slip = (x, bps) => (x * (BPS - BigInt(bps))) / BPS;
/** trade/SKILL.md rule 3: never build a trade whose minimum (or swapped amount) is 0. */
const positive = (x, what) => {
  if (x <= 0n) fail(`${what} rounds to 0 at this size: no trade built (a zero minimum accepts any price). Trade a larger amount.`);
  return x;
};
const feeOf = (base, fees) => fees.reduce((s, f) => s + (base * BigInt(f.bps)) / BPS, 0n);
const unix = () => BigInt(Math.floor(Date.now() / 1000));
const poolId = (k) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
const keyOut = (k) => ({ currency0: k.currency0, currency1: k.currency1, fee: Number(k.fee), tickSpacing: Number(k.tickSpacing), hooks: k.hooks });
const say = (flags, line) => (flags.json || flags.print ? process.stderr : process.stdout).write(`${line}\n`);

// ── CLI ──
const { _, flags } = parseArgs();
if (flags.help) usage(USAGE);
const [tokenArg, action, amountArg] = _;
if (!tokenArg || !isAddress(tokenArg, { strict: false })) usage(USAGE);
if (action && action !== "buy" && action !== "sell") usage(`Unknown action "${action}".\n${USAGE}`);
if (action && !amountArg) usage(`${action} needs an amount${action === "sell" ? " or all" : ""}.\n${USAGE}`);
for (const f of ["pay", "receive"]) if (flags[f] !== undefined && (typeof flags[f] !== "string" || !isAddress(flags[f], { strict: false }))) usage(`--${f} must be a token address.`);
if (flags.slippage !== undefined) {
  const v = String(flags.slippage);
  if (!/^\d+$/.test(v) || Number(v) < SLIPPAGE_RANGE[0] || Number(v) > SLIPPAGE_RANGE[1]) usage(`--slippage is a whole number of basis points from ${SLIPPAGE_RANGE[0]} to ${SLIPPAGE_RANGE[1]} (100 = 1%), got ${v}.`);
}
const token = getAddress(tokenArg);
const signer = getSigner(flags);
const me = signer.address;
if (action && !me) fail("Set PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET, or pass --from 0x... to simulate.");

// ── 1. Pick the path (trade/SKILL.md): index, rewards token, classic launch, everything else ──
async function detect() {
  const reads = [
    ...INDEX_STACKS.map((s) => ({ address: s.factory, abi: INDEX_FACTORY_ABI, functionName: "isIndex", args: [token] })),
    { address: ADDR.rewardsFactory, abi: REWARDS_FACTORY_ABI, functionName: "isRewardsToken", args: [token] },
    { address: ADDR.lockerV2, abi: LOCKER_ABI, functionName: "tokenRewards", args: [token] },
    { address: ADDR.lockerV1, abi: LOCKER_ABI, functionName: "tokenRewards", args: [token] },
  ];
  const r = await publicClient.multicall({ contracts: reads, allowFailure: true });
  // A failed read never falls through to a cheaper guess: routing a rewards or index token anywhere else is refused.
  r.forEach((x, i) => {
    if (x.status !== "success") fail(`Could not read ${reads[i].functionName} on ${reads[i].address}; refusing to guess the path. Retry, or set RPC_URL.`);
  });
  const n = INDEX_STACKS.length;
  for (let i = 0; i < n; i++) {
    if (r[i].result) {
      const stack = INDEX_STACKS[i];
      const key = await publicClient.readContract({ address: stack.factory, abi: INDEX_FACTORY_ABI, functionName: "poolKeyOf", args: [token] });
      return { kind: "index", stack, key, paired: ZERO, label: `index (${stack.id} stack, B420IndexRouter ${stack.router})` };
    }
  }
  if (r[n].result) {
    const [paired, key] = await Promise.all([
      publicClient.readContract({ address: ADDR.rewardsFactory, abi: REWARDS_FACTORY_ABI, functionName: "pairedOf", args: [token] }),
      publicClient.readContract({ address: ADDR.rewardsFactory, abi: REWARDS_FACTORY_ABI, functionName: "poolKeyOf", args: [token] }),
    ]);
    return { kind: "rewards", key, paired: getAddress(paired), label: `rewards token (B420RewardsRouter ${ADDR.rewardsRouter})` };
  }
  for (const [j, locker] of [[n + 1, ADDR.lockerV2], [n + 2, ADDR.lockerV1]]) {
    const info = r[j].result;
    if (!same(info.token, ZERO)) {
      const key = info.poolKey;
      const quote = getAddress(same(key.currency0, token) ? key.currency1 : key.currency0);
      if (same(quote, ADDR.weth)) return { kind: "classic", key, paired: quote, locker, label: `classic launch, WETH pair (Universal Router ${ADDR.universalRouter})` };
      return { kind: "hop", key, paired: quote, locker, label: `classic launch, non-WETH quote (B420HopRouter ${ADDR.hopRouter})` };
    }
  }
  return { kind: "aggregator", paired: ETH, label: "aggregator (POST /api/swap)" };
}

// The 2-block launch delay: classic pools read the MEV module, rewards pools the rewards hook.
async function launchDelay(p) {
  if (p.kind === "classic" || p.kind === "hop") {
    const [unlock, block] = await Promise.all([
      publicClient.readContract({ address: ADDR.mevDelay, abi: MEV_ABI, functionName: "poolUnlockTime", args: [poolId(p.key)] }),
      publicClient.getBlockNumber(),
    ]);
    return { tradingFromBlock: unlock, block, locked: block < unlock };
  }
  if (p.kind === "rewards") {
    const id = await publicClient.readContract({ address: ADDR.rewardsHook, abi: REWARDS_HOOK_ABI, functionName: "poolIdOf", args: [token] });
    const [lp, delay, block] = await Promise.all([
      publicClient.readContract({ address: ADDR.rewardsHook, abi: REWARDS_HOOK_ABI, functionName: "poolOf", args: [id] }),
      publicClient.readContract({ address: ADDR.rewardsHook, abi: REWARDS_HOOK_ABI, functionName: "LAUNCH_BLOCK_DELAY" }),
      publicClient.getBlockNumber(),
    ]);
    const from = BigInt(lp.launchBlock) + delay;
    return { tradingFromBlock: from, block, locked: block < from };
  }
  return null;
}

// ── 2. Quote: the v4 Quoter simulates the swap through the hook (fee, buyback, basket legs included) ──
const isTransport = (e) => /rate limit|RPC Request failed|HTTP request failed|timed out|fetch failed/i.test(`${e?.shortMessage || ""} ${e?.details || ""} ${e?.message || ""}`) && !/reverted/i.test(e?.shortMessage || "");
function explain(e, abis = []) {
  const why = decodeRevert(e, [QUOTER_ABI, ...abis]);
  const inner = /^UnexpectedRevertBytes\((0x[0-9a-fA-F]*)\)$/.exec(why);
  return inner ? decodeRevert(inner[1], [QUOTER_ABI, ...abis]) : why;
}
async function quoteV4(key, buying, amount) {
  const zeroForOne = buying ? same(key.currency1, token) : same(key.currency0, token);
  try {
    const { result } = await publicClient.simulateContract({
      address: ADDR.quoter,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: keyOut(key), zeroForOne, exactAmount: amount, hookData: "0x" }],
    });
    if (result[0] <= 0n) fail("The Quoter returned 0: no liquidity for this size. Nothing built.");
    return result[0];
  } catch (e) {
    if (isTransport(e)) throw e; // an RPC hiccup is not a revert: main() reports it
    fail(`Quote reverted: ${explain(e)}. Nothing built.`);
  }
}
async function aggregatorRoute(body) {
  let r;
  try {
    r = await api("/swap", { method: "POST", body });
  } catch (e) {
    fail(`POST /api/swap ${toJson({ tokenIn: body.tokenIn, tokenOut: body.tokenOut })}: ${e.message}`);
  }
  if (!r || r.success !== true || !r.routerAddress || !r.data) fail(`POST /api/swap returned no route: ${r?.error || "empty response"}`);
  return { router: getAddress(r.routerAddress), data: r.data, amountOut: BigInt(r.amountOut), source: r.source || "kyber", gas: r.gas ?? null, priceImpact: r.priceImpact ?? null };
}

// Classic slippage: b420.io's "auto" from pool depth (1% from $100k, 3% from $20k, 6% below, 3% when unknown).
async function classicAutoSlippage() {
  try {
    const rows = await api(`/tokens?q=${token}`);
    const arr = Array.isArray(rows) ? rows : rows?.tokens || rows?.rows || [];
    const row = arr.find((x) => same(x.address || "", token));
    const liq = Number(row?.liqUsd || 0);
    if (!row) return 300;
    return liq >= 100_000 ? 100 : liq >= 20_000 ? 300 : 600;
  } catch {
    return 300;
  }
}

// ── 3. Universal Router encoding (trade/classic/SKILL.md 3a, 3b) ──
const enc = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values);
const SWAP_PARAMS = [{ type: "tuple", components: [{ name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }];
// PAY_PORTION pays bips of the router's CURRENT balance: an entry after the first is scaled for what the earlier ones took.
function payPortions(entries) {
  let taken = 0n;
  return entries.map((f) => {
    const bps = BigInt(f.bps);
    const bips = taken === 0n ? bps : (bps * BPS) / (BPS - taken);
    taken += bps;
    return { recipient: f.recipient, bips };
  });
}
function urCalldata({ key, buying, amountIn, minOut, entries, deadline }) {
  const zeroForOne = buying ? same(key.currency1, token) : same(key.currency0, token);
  const swap = encodeAbiParameters(SWAP_PARAMS, [{ poolKey: keyOut(key), zeroForOne, amountIn, amountOutMinimum: 0n, hookData: "0x" }]);
  const total = entries.reduce((s, f) => s + BigInt(f.bps), 0n);
  const minAfterFee = (minOut * (BPS - total)) / BPS;
  const outCurrency = buying ? token : ZERO; // native ETH after UNWRAP_WETH on a sell
  const portions = payPortions(entries).map((p) => enc(["address", "address", "uint256"], [outCurrency, p.recipient, p.bips]));
  const sweep = enc(["address", "address", "uint256"], [outCurrency, UR_MSG_SENDER, minAfterFee]);
  let cmds;
  let inputs;
  if (buying) {
    const actions = encodePacked(["uint8", "uint8", "uint8"], [ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE, ACT.TAKE]);
    const v4 = enc(["bytes", "bytes[]"], [actions, [swap, enc(["address", "uint256", "bool"], [ADDR.weth, 0n, false]), enc(["address", "address", "uint256"], [token, UR_ADDRESS_THIS, 0n])]]);
    cmds = [CMD.WRAP_ETH, CMD.V4_SWAP, ...portions.map(() => CMD.PAY_PORTION), CMD.SWEEP];
    inputs = [enc(["address", "uint256"], [UR_ADDRESS_THIS, amountIn]), v4, ...portions, sweep];
  } else {
    const actions = encodePacked(["uint8", "uint8", "uint8"], [ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE]);
    const v4 = enc(["bytes", "bytes[]"], [actions, [swap, enc(["address", "uint256"], [token, amountIn]), enc(["address", "address", "uint256"], [ADDR.weth, UR_ADDRESS_THIS, 0n])]]);
    cmds = [CMD.V4_SWAP, CMD.UNWRAP_WETH, ...portions.map(() => CMD.PAY_PORTION), CMD.SWEEP];
    inputs = [v4, enc(["address", "uint256"], [UR_ADDRESS_THIS, minOut]), ...portions, sweep];
  }
  return { args: [encodePacked(cmds.map(() => "uint8"), cmds), inputs, deadline], minAfterFee };
}

// ── 4. Build the steps for each path ──
async function buildTrade(p, side, meta) {
  const buying = side === "buy";
  const steps = [];
  const plan = {};
  const fees = () => feeEntries();
  const approve = async (tok, spender, amount) => {
    const s = await approvalStep({ token: tok, owner: me, spender, amount, gasRule: isB20(tok) ? "stockApprove" : "default" });
    if (s) steps.push(s);
  };
  const balanceOf = (tok) => publicClient.readContract({ address: tok, abi: ERC20_ABI, functionName: "balanceOf", args: [me] });
  const sellAmount = async () => {
    if (amountArg === "all") {
      const b = await balanceOf(token);
      if (b === 0n) fail(`No ${meta.symbol} to sell at ${me}.`);
      return b;
    }
    return toUnits(amountArg, meta.decimals);
  };

  if (p.kind === "aggregator") {
    // trade/aggregator/SKILL.md: one POST returns the router, the calldata and a net amountOut.
    const tokenIn = buying ? (flags.pay ? getAddress(flags.pay) : ETH) : token;
    const tokenOut = buying ? token : flags.receive ? getAddress(flags.receive) : ETH;
    if (same(tokenIn, tokenOut)) usage("--pay / --receive is the token itself.");
    const inMeta = await tokenMeta(tokenIn);
    const outMeta = await tokenMeta(tokenOut);
    const amountIn = buying ? toUnits(amountArg, inMeta.decimals) : await sellAmount();
    const slippageBps = Number(flags.slippage ?? SLIPPAGE.aggregator);
    positive(amountIn, "The amount in");
    const r = await aggregatorRoute({ tokenIn, tokenOut, amountIn: amountIn.toString(), sender: me, slippageBps });
    positive(r.amountOut, "The aggregator's output");
    // trade/aggregator/SKILL.md errors: Kyber refuses a fee-on-input route sent by its own fee receiver.
    if (r.source === "kyber" && !same(tokenIn, ETH) && same(me, ADDR.treasury)) say(flags, `note: the sender is the Strategic Reserve, the fee receiver of this Kyber route; Kyber refuses that (Error("sender != recipient")). Send from another wallet.`);
    if (!same(tokenIn, ETH)) await approve(tokenIn, r.router, amountIn);
    steps.push({ label: `swap ${fromUnits(amountIn, inMeta.decimals)} ${inMeta.symbol} for ${outMeta.symbol} via ${r.source} (${r.router})`, to: r.router, data: r.data, value: same(tokenIn, ETH) ? amountIn : 0n, gasRule: "urSwap" });
    Object.assign(plan, { spend: `${fromUnits(amountIn, inMeta.decimals)} ${inMeta.symbol}`, expectedOut: `${fromUnits(r.amountOut, outMeta.decimals)} ${outMeta.symbol} (net)`, source: r.source, router: r.router, slippageBps, ...(r.priceImpact !== null ? { priceImpact: r.priceImpact } : {}) });
    return { steps, plan };
  }

  const delay = await launchDelay(p);
  if (delay?.locked) fail(`PoolLocked: this pool trades from block ${delay.tradingFromBlock} (now ${delay.block}), the 2-block launch delay. Retry in a few seconds.`);
  if ((flags.pay && !(p.kind === "rewards" && same(flags.pay, p.paired))) || flags.receive) usage("--pay / --receive work on the aggregator path only.");

  if (p.kind === "classic") {
    // trade/classic/SKILL.md 3a / 3b: Universal Router, WETH pair, fee via PAY_PORTION, slippage on the SWEEP.
    const slippageBps = Number(flags.slippage ?? (await classicAutoSlippage()));
    const amountIn = buying ? toUnits(amountArg, 18) : await sellAmount();
    const q = await quoteV4(p.key, buying, amountIn);
    const minOut = positive(slip(q, slippageBps), "The minimum output");
    const entries = fees();
    const deadline = unix() + DEADLINE_S.classic;
    if (!buying) {
      await approve(token, ADDR.permit2, amountIn);
      const [p2amount, p2exp] = await publicClient.readContract({ address: ADDR.permit2, abi: PERMIT2_ABI, functionName: "allowance", args: [me, token, ADDR.universalRouter] });
      if (p2amount < amountIn || BigInt(p2exp) <= unix() + 60n) {
        steps.push({ label: `Permit2.approve ${fromUnits(amountIn, meta.decimals)} ${meta.symbol} to the Universal Router, ${PERMIT2_EXPIRY_S / 60n} min`, to: ADDR.permit2, abi: PERMIT2_ABI, functionName: "approve", args: [token, ADDR.universalRouter, amountIn, Number(unix() + PERMIT2_EXPIRY_S)], gasRule: "default" });
      }
    }
    const { args, minAfterFee } = urCalldata({ key: p.key, buying, amountIn, minOut, entries, deadline });
    positive(minAfterFee, "The SWEEP minimum");
    const inLabel = buying ? `${fromUnits(amountIn, 18)} ETH` : `${fromUnits(amountIn, meta.decimals)} ${meta.symbol}`;
    steps.push({ label: `${side} ${inLabel} on the Universal Router (V4_SWAP, PAY_PORTION, SWEEP)`, to: ADDR.universalRouter, abi: UR_ABI, functionName: "execute", args, value: buying ? amountIn : 0n, gasRule: "urSwap" });
    const outDec = buying ? meta.decimals : 18;
    const outSym = buying ? meta.symbol : "ETH";
    Object.assign(plan, { spend: inLabel, quoted: `${fromUnits(q, outDec)} ${outSym} before the fee`, minOut: `${fromUnits(minAfterFee, outDec)} ${outSym} (SWEEP minimum, after PAY_PORTION)`, payPortion: payPortions(entries).map((x) => `${x.recipient} ${x.bips} bips`), slippageBps, deadline: deadline.toString() });
    return { steps, plan };
  }

  if (p.kind === "hop") {
    // trade/classic/SKILL.md 4: aggregator leg (sender and recipient = the hop router) plus the token's own pool.
    const slippageBps = Number(flags.slippage ?? (await classicAutoSlippage()));
    const qMeta = await tokenMeta(p.paired);
    const deadline = unix() + DEADLINE_S.hop;
    if (buying) {
      const amountIn = toUnits(amountArg, 18);
      const leg = await aggregatorRoute({ tokenIn: ETH, tokenOut: p.paired, amountIn: amountIn.toString(), sender: ADDR.hopRouter, recipient: ADDR.hopRouter, slippageBps });
      const legMin = positive(slip(leg.amountOut, slippageBps), "The aggregator leg's minimum");
      const tokenOut = await quoteV4(p.key, true, leg.amountOut);
      const minTokenOut = positive(slip(tokenOut, slippageBps), "The minimum output");
      steps.push({ label: `buyWithETH ${fromUnits(amountIn, 18)} ETH, leg via ${leg.source} then the ${qMeta.symbol} pool`, to: ADDR.hopRouter, abi: HOP_ROUTER_ABI, functionName: "buyWithETH", args: [token, p.paired, keyOut(p.key), { router: leg.router, call: leg.data, minOut: legMin }, minTokenOut, me, deadline], value: amountIn, gasRule: "urSwap" });
      Object.assign(plan, { spend: `${fromUnits(amountIn, 18)} ETH`, leg: `${fromUnits(leg.amountOut, qMeta.decimals)} ${qMeta.symbol} (net) via ${leg.source} ${leg.router}`, quoted: `${fromUnits(tokenOut, meta.decimals)} ${meta.symbol}`, minOut: `${fromUnits(minTokenOut, meta.decimals)} ${meta.symbol}`, slippageBps, deadline: deadline.toString() });
    } else {
      const amountIn = await sellAmount();
      const quoteOut = await quoteV4(p.key, false, amountIn);
      const sellAmt = positive(slip(quoteOut, slippageBps), "The pool leg's minimum");
      const leg = await aggregatorRoute({ tokenIn: p.paired, tokenOut: ETH, amountIn: sellAmt.toString(), sender: ADDR.hopRouter, recipient: ADDR.hopRouter, slippageBps });
      const minEth = positive(slip(leg.amountOut, slippageBps), "The minimum ETH output");
      await approve(token, ADDR.hopRouter, amountIn);
      steps.push({ label: `sellForETH ${fromUnits(amountIn, meta.decimals)} ${meta.symbol}, the ${qMeta.symbol} pool then a leg via ${leg.source}`, to: ADDR.hopRouter, abi: HOP_ROUTER_ABI, functionName: "sellForETH", args: [token, p.paired, keyOut(p.key), amountIn, sellAmt, { router: leg.router, call: leg.data, minOut: minEth }, sellAmt, me, deadline], gasRule: "urSwap" });
      Object.assign(plan, { spend: `${fromUnits(amountIn, meta.decimals)} ${meta.symbol}`, poolOut: `${fromUnits(quoteOut, qMeta.decimals)} ${qMeta.symbol}, leg sells ${fromUnits(sellAmt, qMeta.decimals)}`, quoted: `${fromUnits(leg.amountOut, 18)} ETH (net)`, minOut: `${fromUnits(minEth, 18)} ETH`, slippageBps, deadline: deadline.toString() });
    }
    return { steps, plan };
  }

  if (p.kind === "rewards") {
    // trade/rewards-token/SKILL.md: fee entries off amountIn (buy) or off the paired output (sell).
    const slippageBps = Number(flags.slippage ?? SLIPPAGE.rewards);
    const pMeta = await tokenMeta(p.paired);
    const ethPair = same(p.paired, ZERO);
    const entries = fees();
    const deadline = unix() + DEADLINE_S.rewards;
    const gasRule = ethPair ? "rewardsEthTrade" : "rewardsErc20Trade";
    if (buying) {
      const amountIn = toUnits(amountArg, pMeta.decimals);
      const fee = feeOf(amountIn, entries);
      positive(amountIn - fee, "The amount swapped after the fee entries");
      const out = await quoteV4(p.key, true, amountIn - fee);
      const minOut = positive(slip(out, slippageBps), "The minimum output");
      if (!ethPair) await approve(p.paired, ADDR.rewardsRouter, amountIn);
      steps.push({ label: `buy with ${fromUnits(amountIn, pMeta.decimals)} ${pMeta.symbol} on B420RewardsRouter`, to: ADDR.rewardsRouter, abi: REWARDS_ROUTER_ABI, functionName: "buy", args: [token, amountIn, minOut, me, entries, deadline], value: ethPair ? amountIn : 0n, gasRule });
      Object.assign(plan, { spend: `${fromUnits(amountIn, pMeta.decimals)} ${pMeta.symbol}`, swapped: `${fromUnits(amountIn - fee, pMeta.decimals)} ${pMeta.symbol}`, quoted: `${fromUnits(out, meta.decimals)} ${meta.symbol}`, minOut: `${fromUnits(minOut, meta.decimals)} ${meta.symbol}`, fees: entries.map((f) => `${f.recipient} ${f.bps} bps`), slippageBps, deadline: deadline.toString(), gasRule });
    } else {
      const amountIn = await sellAmount();
      const gross = await quoteV4(p.key, false, amountIn);
      const net = gross - feeOf(gross, entries);
      const minOut = positive(slip(net, slippageBps), "The minimum output");
      await approve(token, ADDR.rewardsRouter, amountIn);
      steps.push({ label: `sell ${fromUnits(amountIn, meta.decimals)} ${meta.symbol} on B420RewardsRouter`, to: ADDR.rewardsRouter, abi: REWARDS_ROUTER_ABI, functionName: "sell", args: [token, amountIn, minOut, me, entries, deadline], gasRule });
      Object.assign(plan, { spend: `${fromUnits(amountIn, meta.decimals)} ${meta.symbol}`, quoted: `${fromUnits(net, pMeta.decimals)} ${pMeta.symbol} (after the fee entries)`, minOut: `${fromUnits(minOut, pMeta.decimals)} ${pMeta.symbol}`, fees: entries.map((f) => `${f.recipient} ${f.bps} bps`), slippageBps, deadline: deadline.toString(), gasRule });
    }
    return { steps, plan };
  }

  // p.kind === "index": trade/index/SKILL.md. Quotes come only from the Quoter (the pool holds no liquidity).
  const router = p.stack.router;
  const slippageBps = Number(flags.slippage ?? SLIPPAGE.index);
  const entries = fees();
  const deadline = unix() + DEADLINE_S.index;
  if (buying) {
    const value = toUnits(amountArg, 18);
    const fee = feeOf(value, entries);
    const [supply, indexFeeBps, minFirst] = await Promise.all([
      publicClient.readContract({ address: token, abi: INDEX_TOKEN_ABI, functionName: "totalSupply" }),
      publicClient.readContract({ address: token, abi: INDEX_TOKEN_ABI, functionName: "feeBps" }),
      publicClient.readContract({ address: p.stack.hook, abi: INDEX_HOOK_ABI, functionName: "MIN_FIRST_BUY" }),
    ]);
    const spend = value - fee - ((value - fee) * BigInt(indexFeeBps)) / BPS;
    if (supply === 0n && spend < minFirst) fail(`FirstBuyTooSmall: the first buy of an empty index must put ${fromUnits(minFirst, 18)} ETH into the basket after both fees; ${fromUnits(value, 18)} ETH puts ${fromUnits(spend, 18)}.`);
    positive(value - fee, "The amount swapped after the fee entries");
    const shares = await quoteV4(p.key, true, value - fee);
    const minShares = positive(slip(shares, slippageBps), "The minimum shares");
    steps.push({ label: `buy ${meta.symbol} with ${fromUnits(value, 18)} ETH on B420IndexRouter (${p.stack.id})`, to: router, abi: INDEX_ROUTER_ABI, functionName: "buy", args: [token, minShares, me, entries, deadline], value, gasRule: "indexTrade" });
    Object.assign(plan, { spend: `${fromUnits(value, 18)} ETH`, swapped: `${fromUnits(value - fee, 18)} ETH`, quoted: `${fromUnits(shares, meta.decimals)} ${meta.symbol}`, minOut: `${fromUnits(minShares, meta.decimals)} ${meta.symbol}`, fees: entries.map((f) => `${f.recipient} ${f.bps} bps`), slippageBps, deadline: deadline.toString() });
  } else {
    const shares = await sellAmount();
    const gross = await quoteV4(p.key, false, shares);
    const net = gross - feeOf(gross, entries);
    const minEth = positive(slip(net, slippageBps), "The minimum ETH output");
    await approve(token, router, shares);
    steps.push({ label: `sell ${fromUnits(shares, meta.decimals)} ${meta.symbol} on B420IndexRouter (${p.stack.id})`, to: router, abi: INDEX_ROUTER_ABI, functionName: "sell", args: [token, shares, minEth, me, entries, deadline], gasRule: "indexTrade" });
    Object.assign(plan, { spend: `${fromUnits(shares, meta.decimals)} ${meta.symbol}`, quoted: `${fromUnits(net, 18)} ETH (after the fee entries)`, minOut: `${fromUnits(minEth, 18)} ETH`, fees: entries.map((f) => `${f.recipient} ${f.bps} bps`), slippageBps, deadline: deadline.toString() });
  }
  return { steps, plan };
}

// Read only: the path, the pool, and what 0.001 ETH buys right now.
async function reference(p, meta) {
  const r = { amountIn: "0.001 ETH" };
  const entries = feeEntries();
  if (p.kind === "aggregator") {
    const q = await aggregatorRoute({ tokenIn: ETH, tokenOut: token, amountIn: REF_ETH.toString(), sender: me || PLACEHOLDER, slippageBps: SLIPPAGE.aggregator });
    return { ...r, out: `${fromUnits(q.amountOut, meta.decimals)} ${meta.symbol} (net)`, source: q.source, router: q.router };
  }
  const delay = await launchDelay(p);
  if (delay) r.tradingFromBlock = delay.tradingFromBlock.toString();
  if (delay?.locked) return { ...r, out: `pool locked until block ${delay.tradingFromBlock} (now ${delay.block})` };
  if (p.kind === "classic") {
    const q = await quoteV4(p.key, true, REF_ETH);
    return { ...r, out: `${fromUnits(q - feeOf(q, entries), meta.decimals)} ${meta.symbol} (after PAY_PORTION)` };
  }
  if (p.kind === "hop") {
    const leg = await aggregatorRoute({ tokenIn: ETH, tokenOut: p.paired, amountIn: REF_ETH.toString(), sender: ADDR.hopRouter, recipient: ADDR.hopRouter, slippageBps: 300 });
    const q = await quoteV4(p.key, true, leg.amountOut);
    const qm = await tokenMeta(p.paired);
    return { ...r, leg: `${fromUnits(leg.amountOut, qm.decimals)} ${qm.symbol} via ${leg.source}`, out: `${fromUnits(q, meta.decimals)} ${meta.symbol}` };
  }
  if (p.kind === "rewards" && !same(p.paired, ZERO)) {
    const pm = await tokenMeta(p.paired);
    const leg = await aggregatorRoute({ tokenIn: ETH, tokenOut: p.paired, amountIn: REF_ETH.toString(), sender: me || PLACEHOLDER, slippageBps: SLIPPAGE.aggregator });
    const q = await quoteV4(p.key, true, leg.amountOut - feeOf(leg.amountOut, entries));
    return { ...r, amountIn: `${fromUnits(leg.amountOut, pm.decimals)} ${pm.symbol} (0.001 ETH worth, via /api/swap)`, out: `${fromUnits(q, meta.decimals)} ${meta.symbol}` };
  }
  const q = await quoteV4(p.key, true, REF_ETH - feeOf(REF_ETH, entries));
  return { ...r, out: `${fromUnits(q, meta.decimals)} ${meta.symbol} (after the fee entries)` };
}

// ── 5. Run: read only, or simulate / --send / --print through the shared runSteps ──
async function main() {
  const meta = await tokenMeta(token);
  const path = await detect();
  const head = {
    token,
    symbol: meta.symbol,
    decimals: meta.decimals,
    path: path.kind,
    route: path.label,
    ...(path.key ? { poolKey: keyOut(path.key) } : {}),
    paired: path.kind === "aggregator" ? "(the aggregator picks the route)" : same(path.paired, ZERO) ? "native ETH" : `${(await tokenMeta(path.paired)).symbol} ${path.paired}`,
  };

  if (!action) {
    const ref = await reference(path, meta);
    const wallet = me
      ? { address: me, eth: fromUnits(await publicClient.getBalance({ address: me }), 18), [meta.symbol]: fromUnits(await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }), meta.decimals) }
      : undefined;
    out({ ...head, reference: ref, ...(wallet ? { wallet } : {}) }, flags);
    return;
  }

  const { steps, plan } = await buildTrade(path, action, meta);
  const summary = { ...head, side: action, from: me, ...plan };
  if (flags.json) process.stdout.write(`${toJson({ plan: summary })}\n`);
  else {
    const w = flags.print ? process.stderr : process.stdout;
    for (const [k, v] of Object.entries(summary)) w.write(`${k}: ${typeof v === "object" ? toJson(v) : v}\n`);
  }
  say(flags, `${steps.length} step${steps.length === 1 ? "" : "s"}: ${steps.map((s) => s.label).join(" | ")}`);
  if (flags.print && steps.length > 1) {
    say(flags, "note: steps after the first are simulated in one bundle and their gas comes from the gas used there; send step 1, then run again for a standalone estimate of the trade (--send does this itself).");
  }
  await runSteps(steps, flags);
}

main().catch((e) => fail(errorLine(e)));
