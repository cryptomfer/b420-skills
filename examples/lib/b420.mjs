/**
 * B420 shared example library: the one helper module every example script in this repo imports.
 *
 *   npm ci        (once, at the repo root; installs the viem version pinned in package-lock.json)
 *   import { ADDR, publicClient, parseArgs, getSigner, runSteps } from "../../examples/lib/b420.mjs";
 *
 * What it holds, so no example restates it:
 *   address book (ADDR, INDEX_STACKS), the Base public client, CLI parsing, the signer (PRIVATE_KEY
 *   or Bankr /wallet/submit, read from env and never printed), decimal unit helpers, the b420.io API
 *   client, token metadata, the frontend fee entries, exact-amount approvals, gas rules, revert
 *   decoding, and the simulate / send / print ending every script shares (runSteps).
 *
 * Conventions: every flow is simulated from the sending address before anything is sent (several
 * steps as one eth_simulateV1 bundle); --send simulates the whole flow first, then re-simulates
 * each step right before broadcasting it; --print emits raw {to, data, value, gas, chainId} JSON per
 * step for CDP, Safe or relayers. Canonical rules: ../../SKILL.md.
 *
 * Env: PRIVATE_KEY (never printed), BANKR_API_KEY (never printed), BANKR_WALLET, RPC_URL (never
 *      printed: error output redacts it), B420_API, FROM. Node 18+.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeFunctionData,
  fallback,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// ── Constants ──
export const CHAIN_ID = 8453;
export const RPC = process.env.RPC_URL || "https://mainnet.base.org";
export const API = (process.env.B420_API || "https://b420.io/api").replace(/\/+$/, "");
/** Native ETH sentinel for POST /api/swap (tokenIn / tokenOut). */
export const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/** Native ETH in v4 pool keys, the rewards and index routers and the ledgers. */
export const ZERO = "0x0000000000000000000000000000000000000000";

const A = (a) => getAddress(a);

// ── Address book (Base mainnet, chainId 8453; verified with eth_getCode 2026-10-05) ──
export const ADDR = Object.freeze({
  factoryV2: A("0x0B5E30E8D5fdD6257F4Eb293dFc3121b0207F575"), // B420Factory v2, the live launch factory
  factoryV1: A("0x760AFca74b37B7D8a5a2b062eCB9DBDC3f0018fE"), // deprecated: deployToken reverts Deprecated()
  hook: A("0x13810528fcF203CD05b96e8eB978D9855F01A8Cc"), // live classic hook
  hookV2Retired: A("0x0c97593B847beb32341dA5AFb8cbe242F4f168Cc"), // classic hook 2026-09-17 to 09-20
  hookV1: A("0xf95E48163F68C20B14A4e82525DCCC4BdbaAa8cC"),
  lockerV2: A("0x351C934d698eB3c0683066D2fbD6CE7215573Bc4"), // LP locker v2: tokenRewards(token) holds the pool key
  lockerV1: A("0x0c0B04d8Bd761dA1899b1a13CD3353d0974F99D3"),
  feeLocker: A("0x20835181fD6F4e62AA8d630A89b0e5c8676808C6"), // ClankerFeeLocker: availableFees / claim
  mevDelay: A("0x0028D5788aa5526Ab38920576c93A46048b09CD1"), // blockDelay() = 2
  distributorFactory: A("0x049B3Ee15c41163458073072e9573BF0fb88D5d4"), // never call create()
  distributorFactoryPrevious: A("0x6c8DB32e7b49743c56505718f6f5CBADd18705B6"), // previous generation: its distributors still pay
  distributorExtension: A("0x79e3103B568eEF64c376cE3fCF0196342f56108D"),
  airdrop: A("0x71D6FCA6840b7ffA1BcdC14982e14E573B8dAED2"), // airdrop extension v2
  hopRouter: A("0x82C2B0c34f843A5724497ce809ae96a6eeb03721"), // B420HopRouter
  kyberRouter: A("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"),
  zeroExAllowanceHolder: A("0x0000000000001fF3684f28c67538d4d072c22734"),
  feeCollectorV1: A("0xB9366B662b610F730a50408Db17E550d64F06F44"),
  feeCollectorV2: A("0x22F005aa2b90E06C642C7462388b9d212D6344d8"),
  stockRegistry: A("0x5E4643c2F48c14e09f209CAe5A51455211e10c1E"),
  stakingB420: A("0xC411bA66d1819054f67cDE26424cd876DB703E79"), // stake B420, earn tokenized stocks
  stakingB69: A("0x82E6b3CEE079432F31D64855ed3DD5faCA71d309"), // stake B69, earn B420
  rewardsFactory: A("0x4f924EDB313efB9E90CAf1f768dE54E5fFcD5e31"),
  rewardsHook: A("0x2d04aCae52491E882dd6D606F3A8160945fA2aeC"),
  rewardsLedger: A("0x8e95B431B70094B66836074B01c380A4935B7d49"),
  rewardsRouter: A("0x383156D66BdA2369c6eE061C66aa3D32E38cec72"),
  poolManager: A("0x498581fF718922c3f8e6A244956aF099B2652b2b"),
  universalRouter: A("0x6fF5693b99212Da76ad316178A184AB56D299b43"),
  quoter: A("0x0d5e0F971ED27FBfF6c2837bf31316121532048D"),
  stateView: A("0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71"),
  permit2: A("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
  weth: A("0x4200000000000000000000000000000000000006"),
  usdc: A("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  b420: A("0xb200000000000000000000231d6c1f1ce455ba32"), // B20, 18 decimals, supply 69
  b69: A("0xb2000000000000000000007594fe5acd56df3937"), // B20, 18 decimals, supply 420
  treasury: A("0xA3320DCaFAa124173fdf7BD18EcD85abBA325590"), // Strategic Reserve (EOA), the frontend fee recipient
  protocolAdmin: A("0xa1aB6Eb729c08B774798418b95D9C00D6Ec73527"),
  vaultFactoryLegacy: A("0xA0e85c7e3866c3bdC20CC2BEe78E04fdF214583A"), // paused(): existing vault stakers exit only
  curveFactory: A("0xb81c8fa0dB013f141edD056d1b920B7b0d2bC0a5"), // closed (launchEnabled() false); listed to verify the gate, never called
});

/** Index stacks, oldest first. Callers iterate the list: an index trades and claims on its own stack. */
export const INDEX_STACKS = Object.freeze([
  Object.freeze({
    id: "v3",
    factory: A("0xD732F8c5854ae9E6de3046ad9ecA87577e5e93AF"),
    hook: A("0x5C654E637B6bC597A655DaB90867296d5Ae76888"),
    router: A("0xbcD0329e229bc620704a2e86bF4D37DB68fA8ff4"),
    ledger: A("0x934654A3FCa109A6ce70B2aADbC19d34f0080Fe6"), // the factory's splitter()
  }),
  // v4 (live 2026-10-05): multi-hop constituent routes; same token, router and ledger ABIs
  Object.freeze({
    id: "v4",
    factory: A("0xD408a52ff4871097A89977Ca9fc48dF0D4243293"),
    hook: A("0x3A9721075D9f183648029058549A65C684D16888"),
    router: A("0x7B519742705e71313E982dA1cC89c05C076DA4AB"),
    ledger: A("0x1B66965006fbaa476fc22B8432cc232b6148E958"), // the factory's splitter()
  }),
]);

// ── Fee policy (same number and recipient as b420.io: lib/fees.ts SWAP_FEE_BPS) ──
export const FEE_BPS = 100;

// ── ABIs ──
export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidSpender(address spender)",
  "error ERC20InvalidReceiver(address receiver)",
]);

/** Custom errors of the B420 contracts (b420-factory/src) and the Uniswap contracts the routes touch,
 *  so decodeRevert can name a revert even when the caller passes no ABI. */
export const COMMON_ERRORS_ABI = parseAbi([
  // B20 tokens (B420, B69, tokenized stocks, launches)
  "error InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error InsufficientBalance(address account, uint256 balance, uint256 needed)",
  // factory, MEV module, lockers
  "error Deprecated()",
  "error PoolLocked()",
  "error Unauthorized()",
  "error NotFound()",
  "error ExtensionMsgValueMismatch()",
  "error InvalidSupply()",
  "error TokenAlreadyHasRewards()",
  // staking (B420MultiStaking) and legacy dividend vaults
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error InsufficientStake()",
  "error NothingUnbonding()",
  "error CooldownNotElapsed()",
  "error NotRewardToken()",
  "error RewardTransferFailed()",
  // hop router
  "error RouterNotAllowed(address router)",
  "error Expired()",
  "error InvalidPool()",
  "error LegFailed()",
  "error InsufficientOut(uint256 got, uint256 want)",
  "error EthSendFailed()",
  // rewards and index routers
  "error BadConfig()",
  "error NotRewardsToken(address token)",
  "error NotIndex(address token)",
  "error Expired(uint256 deadline)",
  "error BadRecipient()",
  "error BadValue()",
  "error TooManyFees()",
  "error BadFee()",
  "error FeeTooHigh(uint256 totalBps)",
  "error TooLittleReceived(uint256 received, uint256 minimum)",
  "error EthTransferFailed(address to)",
  "error EthTransferFailed()",
  "error AmountTooLarge()",
  "error InsufficientGas()",
  "error UnexpectedDelta()",
  // rewards factory, hook, ledger; index hook, token, ledger
  "error EmptyName()",
  "error NameTaken(address existing)",
  "error BadHoldersBps()",
  "error BadSupply()",
  "error BadPairedAsset()",
  "error BadTick()",
  "error BadVanity(address predicted)",
  "error DevBuyFailed()",
  "error BadCreator(address creator)",
  "error UnknownPool()",
  "error ExternalPool()",
  "error LiquidityLocked()",
  "error PartialFill()",
  "error OnlyCreator()",
  "error NotRaised()",
  "error TooHigh()",
  "error BadSlot()",
  "error NothingToClaim()",
  "error CollectorPull(uint256 expected, uint256 pulled)",
  "error UnknownIndex()",
  "error NoLiquidity()",
  "error ExactOutputNotSupported()",
  "error FirstBuyTooSmall()",
  "error ZeroShares()",
  "error Empty()",
  // fee collectors, distributors
  "error TooSoon()",
  "error BelowThreshold()",
  "error DeviationExceeded()",
  "error TwapDeviation()",
  "error MinOutNotMet()",
  "error NotKeeper()",
  "error FundingDisabled()",
  "error NotConfigured()",
  "error WethNotForwardable()",
  "error InvalidProof()",
  "error ExceedsPosted()",
  "error ExceedsReceived()",
  "error UnknownCurrency()",
  // Uniswap v4, Universal Router, Permit2
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
  "error TransactionDeadlinePassed()",
  "error InsufficientToken()",
  "error InsufficientETH()",
  "error CurrencyNotSettled()",
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
]);

// ── Client ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _lastNetAt = 0;
function markNet() {
  _lastNetAt = Date.now();
}

/** The public Base RPC answers bursts with code -32016 "over rate limit", which viem does not retry
 *  on its own: this wrapper retries those (and HTTP 429, timeouts, 5xx) with backoff before giving up. */
function rateLimitRetry(transport, { retries = 5, delay = 800 } = {}) {
  return (opts) => {
    const t = transport(opts);
    const request = async (args, options) => {
      markNet();
      for (let i = 0; ; i++) {
        try {
          const r = await t.request(args, options);
          markNet();
          return r;
        } catch (e) {
          markNet();
          if (i >= retries || !isRetryable(e)) throw e;
          await sleep(delay * 2 ** i);
        }
      }
    };
    return { ...t, request };
  };
}
function isRateLimit(e) {
  for (let x = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x.code === -32016 || x.code === 429 || x.status === 429) return true;
    if (typeof x.details === "string" && /rate limit/i.test(x.details)) return true;
    if (typeof x.message === "string" && /over rate limit|too many requests/i.test(x.message)) return true;
  }
  return false;
}
function isRetryable(e) {
  if (isRateLimit(e)) return true;
  for (let x = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x.name === "TimeoutError") return true;
    if (x.name === "HttpRequestError" && [408, 500, 502, 503, 504].includes(x.status)) return true;
    if (x.code === -32005) return true;
  }
  return false;
}

/** Without RPC_URL, reads fall back to this second public Base node (it also serves eth_simulateV1). */
export const RPC_FALLBACK = "https://base-rpc.publicnode.com";

function baseTransport() {
  if (process.env.RPC_URL) return rateLimitRetry(http(RPC, { retryCount: 4, retryDelay: 600 }));
  return rateLimitRetry(fallback([http(RPC, { retryCount: 1, retryDelay: 400 }), http(RPC_FALLBACK, { retryCount: 2, retryDelay: 600 })], { retryCount: 1 }));
}

export const publicClient = createPublicClient({
  chain: base,
  transport: baseTransport(),
  batch: { multicall: true },
});

// ── CLI ──
const BOOLEAN_FLAGS = new Set(["send", "print", "json", "help", "h", "all", "share-with-holders"]);

/** argv -> { _: positionals, flags }. Supports --k v, --k=v and --flag. Known boolean flags (send,
 *  print, json, help, all, share-with-holders, plus `booleans`) never consume the next token. */
export function parseArgs(argv = process.argv.slice(2), { booleans = [] } = {}) {
  const bools = new Set([...BOOLEAN_FLAGS, ...booleans]);
  const _ = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") {
      flags.help = true;
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (!bools.has(k) && next !== undefined && !next.startsWith("--")) {
          flags[k] = next;
          i++;
        } else flags[k] = true;
      }
    } else _.push(a);
  }
  return { _, flags };
}

/** Exit with `code`. Node 24 on Windows can abort (exit 127, a libuv async.c assertion) when
 *  process.exit runs within a few ms of a network request; a short synchronous pause after the last
 *  request lets the socket teardown finish first. Examples call this instead of process.exit. */
export function exit(code = 0) {
  const wait = 500 - (Date.now() - _lastNetAt);
  if (_lastNetAt && wait > 0) {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    } catch {
      /* no pause available: exit anyway */
    }
  }
  process.exit(code);
}

/** RPC_URL can carry a provider key in its path (Alchemy, Infura): every error line goes through this. */
function redact(text) {
  let s = String(text);
  const url = process.env.RPC_URL;
  if (url) {
    const forms = new Set([url, url.replace(/\/+$/, "")]);
    try {
      const u = new URL(url);
      u.username = "";
      u.password = "";
      forms.add(u.toString());
      forms.add(u.toString().replace(/\/+$/, ""));
    } catch {
      /* not a URL: the raw form is enough */
    }
    for (const f of [...forms].filter((x) => x.length > 8).sort((a, b) => b.length - a.length)) s = s.split(f).join("$RPC_URL");
  }
  return s;
}

/** stderr "error: msg" (RPC_URL redacted), exit 1. */
export function fail(msg) {
  process.stderr.write(`error: ${redact(msg)}\n`);
  exit(1);
}

/** One line for an unexpected error: viem's shortMessage (never the request URL or body it carries in
 *  `message`), its details, and a hint when the RPC throttled. Scripts end with
 *  `main().catch((e) => fail(errorLine(e)))`. */
export function errorLine(e) {
  const msg = String(e?.shortMessage || e?.message || e).split("\n")[0];
  const details = typeof e?.details === "string" && e.details && !msg.includes(e.details) ? ` (${e.details.split("\n")[0]})` : "";
  const rpc = isTransportError(e) || /rate limit|RPC Request failed|HTTP request failed|timed out|fetch failed/i.test(`${msg} ${details}`);
  const hint = process.env.RPC_URL ? ". The node in RPC_URL did not answer as expected: check it, then retry." : ". The public RPC throttles bursts: retry, or set RPC_URL to your own Base node.";
  return `${details ? msg.replace(/\.$/, "") : msg}${details}${rpc ? hint : ""}`;
}

// An error no script caught still prints one redacted line, never viem's full message with the RPC URL.
process.on("uncaughtException", (e) => fail(errorLine(e)));
process.on("unhandledRejection", (e) => fail(errorLine(e)));

/** stderr usage text, exit 2. */
export function usage(text) {
  process.stderr.write(`${String(text).trim()}\n`);
  exit(2);
}

const jsonReplacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
export const toJson = (obj) => JSON.stringify(obj, jsonReplacer);

const fmt = (v) => (v === null || v === undefined ? "-" : typeof v === "object" ? toJson(v) : String(v));

/** JSON (bigints as strings) when flags.json, else readable "key: value" lines. */
export function out(obj, flags = {}) {
  if (flags.json) {
    process.stdout.write(`${toJson(obj)}\n`);
    return;
  }
  const lines = [];
  const walk = (o, indent) => {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) {
        if (v.every((x) => x === null || typeof x !== "object")) lines.push(`${indent}${k}: ${v.map(fmt).join(", ") || "-"}`);
        else {
          lines.push(`${indent}${k}:${v.length ? "" : " -"}`);
          for (const x of v) {
            if (x && typeof x === "object" && !Array.isArray(x)) lines.push(`${indent}  - ${Object.entries(x).map(([a, b]) => `${a} ${fmt(b)}`).join(", ")}`);
            else lines.push(`${indent}  - ${fmt(x)}`);
          }
        }
      } else if (v && typeof v === "object") {
        lines.push(`${indent}${k}:`);
        walk(v, `${indent}  `);
      } else lines.push(`${indent}${k}: ${fmt(v)}`);
    }
  };
  if (obj && typeof obj === "object") walk(obj, "");
  else lines.push(fmt(obj));
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Basescan URL for a tx hash (66 chars) or an address. */
export function basescan(hashOrAddress) {
  const s = String(hashOrAddress);
  return s.length === 66 ? `https://basescan.org/tx/${s}` : `https://basescan.org/address/${s}`;
}

/** 0x1381…8Cc style, for labels (the full address must appear elsewhere in the same output). */
export const shortAddr = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;

// ── Signer (keys come from env only; never returned as strings, never printed) ──
let _signer = null;
let _account = null;
let _wallet = null;

/** { mode: 'bankr' | 'key' | 'none', address }. Order: BANKR_API_KEY + BANKR_WALLET, then
 *  PRIVATE_KEY, else 'none' with address = --from || env FROM || null. */
export function getSigner(flags = {}) {
  if (_signer) return _signer;
  const env = process.env;
  if (env.BANKR_API_KEY && env.BANKR_WALLET) {
    if (!isAddress(env.BANKR_WALLET, { strict: false })) fail("BANKR_WALLET is not an address.");
    _signer = { mode: "bankr", address: getAddress(env.BANKR_WALLET) };
  } else if (env.PRIVATE_KEY) {
    const raw = env.PRIVATE_KEY.trim();
    const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) fail("PRIVATE_KEY is not a 32-byte hex key.");
    _account = privateKeyToAccount(hex);
    _signer = { mode: "key", address: _account.address };
  } else if (env.BANKR_API_KEY) {
    fail("BANKR_WALLET (your Bankr wallet address) is required with BANKR_API_KEY.");
  } else {
    const from = typeof flags.from === "string" ? flags.from : env.FROM || null;
    if (from && !isAddress(from, { strict: false })) usage(`--from must be an address, got ${from}`);
    _signer = { mode: "none", address: from ? getAddress(from) : null };
  }
  return _signer;
}

function walletClient() {
  if (!_wallet) _wallet = createWalletClient({ account: _account, chain: base, transport: baseTransport() });
  return _wallet;
}

// ── Units ──
/** "1.5" -> 1500000000000000000n for 18 decimals. Usage error on bad input or too many decimals. */
export function toUnits(decimalString, decimals) {
  const s = String(decimalString ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) usage(`Amount must be a decimal number like 0.01, got "${s}".`);
  const frac = s.includes(".") ? s.split(".")[1].length : 0;
  if (frac > decimals) usage(`Amount ${s} has ${frac} decimals; this token has ${decimals}.`);
  return parseUnits(s.startsWith(".") ? `0${s}` : s, decimals);
}

/** 1500000000000000000n -> "1.5" (18 decimals), truncated to maxFrac fraction digits. A non-zero
 *  amount that would truncate to 0 is shown at full precision. */
export function fromUnits(value, decimals, maxFrac = 6) {
  const full = formatUnits(BigInt(value), decimals);
  const [i, f = ""] = full.split(".");
  const cut = f.slice(0, maxFrac).replace(/0+$/, "");
  const shown = cut ? `${i}.${cut}` : i;
  if (BigInt(value) !== 0n && /^-?0$/.test(shown)) return full;
  return shown;
}

// ── b420.io API ──
/** GET (or POST with body) on the b420.io API. `path` is relative to API ("/token/0x..."); a leading
 *  "/api" is tolerated. Non-2xx throws Error("<status> <error|code>") with .status and .body. */
export async function api(path, { method = "GET", body } = {}) {
  const p = String(path).startsWith("http") ? String(path) : `${API}${String(path).replace(/^\/?(api\/)?/, "/")}`;
  markNet();
  const res = await fetch(p, {
    method,
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? toJson(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  markNet();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const why = (parsed && typeof parsed === "object" && (parsed.error || parsed.code)) || res.statusText || "request failed";
    const err = new Error(`${res.status} ${typeof why === "string" ? why : toJson(why)}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

// ── Token metadata ──
const _meta = new Map();
/** { address, symbol, decimals }; ETH (sentinel) and ZERO -> ETH, 18. Cached. */
export async function tokenMeta(address) {
  const key = String(address).toLowerCase();
  if (key === ETH.toLowerCase() || key === ZERO) return { address: key === ZERO ? ZERO : ETH, symbol: "ETH", decimals: 18 };
  if (_meta.has(key)) return _meta.get(key);
  const addr = getAddress(address);
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  const m = { address: addr, symbol, decimals: Number(decimals) };
  _meta.set(key, m);
  return m;
}

// ── Frontend fee entries (struct FeeTake { address recipient; uint16 bps; }) ──
/** The fee entries of the Universal Router PAY_PORTION and of the rewards and index routers:
 *  [(Strategic Reserve, 100)], the recipient and rate b420.io uses for a trade without a referrer. The
 *  site's referral split needs a referrer bound to a logged-in b420.io profile, which an agent can
 *  neither bind nor verify, so agents never use it. */
export function feeEntries() {
  return [{ recipient: ADDR.treasury, bps: FEE_BPS }];
}

// ── Steps ──
/** Approve exactly `amount` when the allowance is short; null when nothing is needed (or ETH). */
export async function approvalStep({ token, owner, spender, amount, label, gasRule }) {
  const t = String(token).toLowerCase();
  if (t === ZERO || t === ETH.toLowerCase()) return null;
  const allowance = await publicClient.readContract({ address: getAddress(token), abi: ERC20_ABI, functionName: "allowance", args: [getAddress(owner), getAddress(spender)] });
  if (allowance >= BigInt(amount)) return null;
  let name = label;
  if (!name) {
    const m = await tokenMeta(token);
    name = `approve ${fromUnits(amount, m.decimals)} ${m.symbol} to ${getAddress(spender)}`;
  }
  return { label: name, to: getAddress(token), abi: ERC20_ABI, functionName: "approve", args: [getAddress(spender), BigInt(amount)], value: 0n, gasRule: gasRule || "default" };
}

const mulDivUp = (x, n, d) => (x * n + d - 1n) / d;
const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);

/** Gas limit for a rule from an estimate (bigint, or null when the estimate failed). */
export function gasFor(rule = "default", estimate = null) {
  const est = estimate === null || estimate === undefined ? null : BigInt(estimate);
  const need = (r) => {
    if (est === null) throw new Error(`gas rule "${r}" needs an estimate`);
    return est;
  };
  switch (rule) {
    case "default":
      return mulDivUp(need(rule), 12n, 10n);
    case "urSwap":
      return est === null ? 800_000n : mulDivUp(est, 12n, 10n);
    case "stockApprove":
      return est === null ? 150_000n : mulDivUp(est, 15n, 10n);
    case "rewardsEthTrade":
      return est === null ? 1_800_000n : max(est + 400_000n, 1_400_000n);
    case "rewardsErc20Trade":
      return est === null ? 700_000n : mulDivUp(est, 13n, 10n);
    case "indexTrade":
      return est === null ? 2_600_000n : mulDivUp(est, 125n, 100n);
    case "classicLaunch":
      return est === null ? 3_000_000n : mulDivUp(est, 15n, 10n);
    case "rewardsLaunch":
      return est === null ? 2_600_000n : mulDivUp(est, 12n, 10n);
    case "rewardsLaunchEthDevBuy":
      return est === null ? 4_500_000n : max(est + 600_000n, mulDivUp(est, 13n, 10n));
    case "ledgerStakingSlot":
      return est === null ? 700_000n : max(mulDivUp(est, 12n, 10n), 700_000n);
    case "batchPay":
      return min(mulDivUp(need(rule), 125n, 100n), 16_000_000n);
    default:
      throw new Error(`unknown gas rule "${rule}"`);
  }
}

const GAS_RULES = ["default", "urSwap", "stockApprove", "rewardsEthTrade", "rewardsErc20Trade", "indexTrade", "classicLaunch", "rewardsLaunch", "rewardsLaunchEthDevBuy", "ledgerStakingSlot", "batchPay"];
export { GAS_RULES };

// ── Revert decoding ──
function revertData(err) {
  if (typeof err === "string") return /^0x[0-9a-fA-F]{8,}$/.test(err) ? err : null;
  for (let x = err, n = 0; x && n < 12; x = x.cause, n++) {
    if (typeof x.raw === "string" && x.raw.startsWith("0x") && x.raw.length >= 10) return x.raw;
    if (typeof x.data === "string" && x.data.startsWith("0x") && x.data.length >= 10) return x.data;
    if (x.data && typeof x.data === "object" && typeof x.data.data === "string" && x.data.data.startsWith("0x")) return x.data.data;
  }
  return null;
}

const fmtArg = (v) => (Array.isArray(v) ? `[${v.map(fmtArg).join(", ")}]` : typeof v === "string" && !v.startsWith("0x") ? JSON.stringify(v) : String(v));

function decodeData(data, abi, depth = 0) {
  try {
    const { errorName, args = [] } = decodeErrorResult({ abi, data });
    if (depth < 3 && errorName === "WrappedError") {
      return `WrappedError(${args[0]}, ${decodeData(args[2], abi, depth + 1)})`;
    }
    if (depth < 3 && errorName === "ExecutionFailed") {
      return `ExecutionFailed(command ${args[0]}, ${decodeData(args[1], abi, depth + 1)})`;
    }
    return `${errorName}(${args.map(fmtArg).join(", ")})`;
  } catch {
    if (!data || data === "0x") return "empty revert";
    return `unknown error ${data.slice(0, 10)}`;
  }
}

/** 'Name(arg, ...)' from a viem error, revert data or a hex string; else viem's shortMessage. */
export function decodeRevert(err, abis = []) {
  const extra = (Array.isArray(abis) ? abis : [abis]).filter(Boolean).flat().filter((x) => x && x.type === "error");
  const seen = new Set();
  const abi = [...extra, ...ERC20_ABI.filter((x) => x.type === "error"), ...COMMON_ERRORS_ABI].filter((e) => {
    const sig = `${e.name}(${(e.inputs || []).map((i) => i.type).join(",")})`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  const data = revertData(err);
  if (data) return decodeData(data, abi);
  const msg = err && (err.shortMessage || err.message);
  if (msg) return String(msg).split("\n")[0];
  return String(err);
}

function isTransportError(e) {
  for (let x = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (isRateLimit(x)) return true;
    if (x.name === "HttpRequestError" || x.name === "TimeoutError" || x.name === "WebSocketRequestError") return true;
  }
  return false;
}

function prep(step) {
  if (!step || !step.to) throw new Error("step needs a `to` address");
  const data = step.data ?? encodeFunctionData({ abi: step.abi, functionName: step.functionName, args: step.args ?? [] });
  const value = step.value === undefined || step.value === null ? 0n : BigInt(step.value);
  return { ...step, to: getAddress(step.to), data, value, gasRule: step.gasRule || "default" };
}

function safeGas(rule, used) {
  try {
    return gasFor(rule, used);
  } catch {
    return null;
  }
}

async function simulateOne(s, from, stateOverride) {
  const abis = [s.abi, ...(s.abis || [])].filter(Boolean);
  try {
    let result;
    if (s.abi && s.functionName) {
      const r = await publicClient.simulateContract({ address: s.to, abi: s.abi, functionName: s.functionName, args: s.args ?? [], account: from, value: s.value, stateOverride });
      result = r.result;
    } else {
      await publicClient.call({ account: from, to: s.to, data: s.data, value: s.value, stateOverride });
    }
    const gasUsed = await publicClient.estimateGas({ account: from, to: s.to, data: s.data, value: s.value, stateOverride });
    return { label: s.label, ok: true, gasUsed, gas: safeGas(s.gasRule, gasUsed), ...(result !== undefined ? { result } : {}) };
  } catch (e) {
    if (isTransportError(e)) fail(`RPC error while simulating "${s.label}": ${e.shortMessage || e.message}. Set RPC_URL to your own Base node.`);
    return { label: s.label, ok: false, gasUsed: null, gas: null, revert: decodeRevert(e, abis) };
  }
}

async function simulateBundle(prepared, from, stateOverride) {
  const calls = prepared.map((s) => ({ to: s.to, data: s.data, value: s.value }));
  if (typeof publicClient.simulateCalls === "function") {
    const r = await publicClient.simulateCalls({ account: from, calls, stateOverrides: stateOverride });
    return r.results.map((x) => ({ ok: x.status === "success", gasUsed: x.gasUsed, maxUsedGas: x.maxUsedGas, data: x.data }));
  }
  const hex = (v) => `0x${BigInt(v).toString(16)}`;
  const stateOverrides = stateOverride
    ? Object.fromEntries(stateOverride.map((o) => [o.address, { ...(o.balance !== undefined ? { balance: hex(o.balance) } : {}), ...(o.nonce !== undefined ? { nonce: hex(o.nonce) } : {}), ...(o.code ? { code: o.code } : {}), ...(o.stateDiff ? { stateDiff: Object.fromEntries(o.stateDiff.map((d) => [d.slot, d.value])) } : {}) }]))
    : undefined;
  const res = await publicClient.request({
    method: "eth_simulateV1",
    params: [{ blockStateCalls: [{ calls: calls.map((c) => ({ from, to: c.to, data: c.data, value: hex(c.value) })), stateOverrides }], validation: false }, "latest"],
  });
  return res[0].calls.map((c) => ({ ok: c.status === "0x1", gasUsed: BigInt(c.gasUsed), maxUsedGas: c.maxUsedGas ? BigInt(c.maxUsedGas) : undefined, data: c.error?.data ?? c.returnData }));
}

function isMethodUnsupported(e) {
  for (let x = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x.code === -32601 || x.code === -32600) return true;
    if (typeof x.message === "string" && /method not (found|supported)|does not exist|not available|unsupported method/i.test(x.message)) return true;
  }
  return false;
}

/** Simulate steps from `from`. One step: simulateContract (or call) plus estimateGas. Several: one
 *  eth_simulateV1 bundle, so later steps see earlier approvals. Returns
 *  [{ label, ok, gasUsed, gas, result?, revert?, note? }] (ok null = not simulated). */
export async function simulateSteps(steps, from, { stateOverride } = {}) {
  if (!from) fail("simulateSteps needs a from address.");
  const sender = getAddress(from);
  const prepared = steps.map(prep);
  if (prepared.length === 0) return [];
  if (prepared.length === 1) return [await simulateOne(prepared[0], sender, stateOverride)];
  let rows;
  try {
    rows = await simulateBundle(prepared, sender, stateOverride);
  } catch (e) {
    if (isMethodUnsupported(e)) {
      const first = await simulateOne(prepared[0], sender, stateOverride);
      return [first, ...prepared.slice(1).map((s) => ({ label: s.label, ok: null, gasUsed: null, gas: safeGas(s.gasRule, null), note: "not simulated: needs step 1 on chain" }))];
    }
    if (isTransportError(e)) fail(`RPC error while simulating: ${e.shortMessage || e.message}. Set RPC_URL to your own Base node.`);
    throw e;
  }
  // Step 1 depends on nothing earlier: refine its number with a plain estimate (eth_simulateV1
  // reports gas used, which can sit below the limit a transaction needs).
  let firstEstimate = null;
  if (rows[0]?.ok) {
    try {
      firstEstimate = await publicClient.estimateGas({ account: sender, to: prepared[0].to, data: prepared[0].data, value: prepared[0].value, stateOverride });
    } catch {
      firstEstimate = null;
    }
  }
  return prepared.map((s, i) => {
    const r = rows[i];
    const abis = [s.abi, ...(s.abis || [])].filter(Boolean);
    if (!r.ok) return { label: s.label, ok: false, gasUsed: null, gas: null, revert: decodeRevert(r.data || "0x", abis) };
    let used = r.maxUsedGas !== undefined && r.maxUsedGas > r.gasUsed ? r.maxUsedGas : r.gasUsed;
    if (i === 0 && firstEstimate !== null && firstEstimate > used) used = firstEstimate;
    return { label: s.label, ok: true, gasUsed: used, gas: safeGas(s.gasRule, used) };
  });
}

// ── Send ──
async function bankrSubmit(tx, from) {
  const mayHaveSent = `the transaction may have been sent. Check ${basescan(from)} and your nonce before doing anything else; do not resend.`;
  markNet();
  let res;
  let text;
  try {
    res = await fetch("https://api.bankr.bot/wallet/submit", {
      method: "POST",
      headers: { "X-API-Key": process.env.BANKR_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction: { to: tx.to, data: tx.data, value: tx.value.toString(), gas: tx.gas.toString(), type: 2, chainId: CHAIN_ID },
        waitForConfirmation: true,
      }),
      signal: AbortSignal.timeout(240_000),
    });
    text = await res.text();
  } catch (e) {
    markNet();
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    fail(timedOut ? `Bankr did not answer within 240 s; ${mayHaveSent}` : `the connection to Bankr failed (${String(e?.message || e).split("\n")[0]}); ${mayHaveSent}`);
  }
  markNet();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  if (res.ok && j && j.transactionHash) return j.transactionHash;
  // A 4xx is a refusal before broadcast (config, auth, a bad body); anything else may follow a broadcast.
  if (res.status >= 400 && res.status < 500) fail(`Bankr refused the transaction (${res.status}): ${text.slice(0, 300)}. Nothing was broadcast${res.status === 403 ? "; a 403 is one of the Bankr config gotchas in SKILL.md (signer modes)" : ""}.`);
  fail(`Bankr answered ${res.status} without a transaction hash (${text.slice(0, 300)}); ${mayHaveSent}`);
}

/** Broadcast steps in order from the signer: re-simulate, gas, ETH check, send, wait, print. */
export async function sendSteps(steps, flags = {}) {
  const signer = getSigner(flags);
  if (signer.mode !== "key" && signer.mode !== "bankr") fail("--send needs PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET.");
  const log = (line) => (flags.json ? process.stderr : process.stdout).write(`${line}\n`);
  const n = steps.length;
  const hashes = [];
  for (let i = 0; i < n; i++) {
    const s = prep(steps[i]);
    const [sim] = await simulateSteps([s], signer.address);
    if (!sim.ok) fail(`${i + 1}/${n} ${s.label}: simulation reverted ${sim.revert}; nothing sent for this step.`);
    const gas = sim.gas ?? gasFor(s.gasRule, sim.gasUsed);
    const [balance, fees] = await Promise.all([publicClient.getBalance({ address: signer.address }), publicClient.estimateFeesPerGas()]);
    if (balance < s.value + gas * fees.maxFeePerGas) fail(`Not enough ETH on Base: you have ${fromUnits(balance, 18)}, this needs ${fromUnits(s.value, 18)} plus gas.`);
    let hash;
    if (signer.mode === "key") {
      try {
        hash = await walletClient().sendTransaction({ account: _account, chain: base, to: s.to, data: s.data, value: s.value, gas, type: "eip1559" });
      } catch (e) {
        fail(`${i + 1}/${n} ${s.label}: send failed: ${e.shortMessage || String(e.message).split("\n")[0]}. Check your nonce and ${basescan(signer.address)} before retrying.`);
      }
    } else {
      hash = await bankrSubmit({ to: s.to, data: s.data, value: s.value, gas }, signer.address);
    }
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    } catch {
      fail(`${i + 1}/${n} ${s.label}: ${hash} not confirmed after 180 s. Check ${basescan(hash)} and your nonce before doing anything else; do not resend.`);
    }
    if (receipt.status !== "success") fail(`${i + 1}/${n} ${s.label}: reverted onchain: ${hash} ${basescan(hash)}`);
    log(`${i + 1}/${n} ${s.label}: ${hash} ${basescan(hash)}`);
    hashes.push(hash);
  }
  return hashes;
}

/** One raw transaction JSON line per step: {"to","data","value","gas","chainId":8453}. */
export function printSteps(steps, sims = []) {
  steps.map(prep).forEach((s, i) => {
    const gas = sims[i]?.gas ?? null;
    process.stdout.write(`${JSON.stringify({ to: s.to, data: s.data, value: s.value.toString(), gas: gas === null ? null : gas.toString(), chainId: CHAIN_ID })}\n`);
  });
}

const group = (v) => (v === null || v === undefined ? "-" : BigInt(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","));

/** The standard ending of every example: --send simulates the whole flow, then broadcasts step by
 *  step; --print simulates then prints raw transactions; neither simulates and reports. Exits 1 if
 *  any simulation reverts. */
export async function runSteps(steps, flags = {}) {
  const signer = getSigner(flags);
  if (!steps.length) fail("Nothing to do: no steps.");
  if (flags.send) {
    if (signer.mode === "none") fail("--send needs PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET.");
    if (typeof flags.from === "string" && flags.from.toLowerCase() !== signer.address.toLowerCase()) fail(`--from ${flags.from} is not the signer ${signer.address}; drop --from to send.`);
    // The whole flow first (approve then act, one bundle): a later step that would revert stops
    // everything before step 1 is broadcast. sendSteps then re-simulates each step on its own.
    const sims = await simulateSteps(steps, signer.address);
    const n = sims.length;
    sims.forEach((s, i) => {
      if (s.ok === false) fail(`${i + 1}/${n} ${s.label}: simulation reverted ${s.revert}; nothing sent.`);
    });
    if (sims.some((s) => s.ok === null)) fail("This RPC cannot simulate the flow as one bundle (eth_simulateV1), so the steps after the first are unchecked; nothing sent. Unset RPC_URL (the public Base nodes serve it) or use a node that does.");
    (flags.json ? process.stderr : process.stdout).write(`simulated ${n} step${n === 1 ? "" : "s"} from ${signer.address} as one flow: ok; sending\n`);
    const hashes = await sendSteps(steps, flags);
    if (flags.json) out({ mode: "send", from: signer.address, hashes }, flags);
    return { mode: "send", sims: [], hashes };
  }
  const from = signer.address;
  if (!from) fail("Set PRIVATE_KEY, or BANKR_API_KEY + BANKR_WALLET, or pass --from 0x... to simulate.");
  const sims = await simulateSteps(steps, from);
  const prepared = steps.map(prep);
  const reverted = sims.some((s) => s.ok === false);
  if (flags.print && !reverted) {
    printSteps(steps, sims);
    return { mode: "print", sims, hashes: [] };
  }
  if (flags.json) {
    out({ mode: "simulate", from, chainId: CHAIN_ID, ok: !reverted, steps: sims.map((s, i) => ({ ...s, to: prepared[i].to, value: prepared[i].value, data: prepared[i].data })) }, flags);
  } else {
    const w = flags.print ? process.stderr : process.stdout;
    w.write(`simulated from ${from} on Base (chainId ${CHAIN_ID})\n`);
    sims.forEach((s, i) => {
      const head = `${i + 1}/${sims.length} ${s.label}`;
      if (s.ok === true) w.write(`${head}: ok, gas used ${group(s.gasUsed)}, gas limit ${group(s.gas)}\n`);
      else if (s.ok === null) w.write(`${head}: ${s.note}${s.gas ? `, gas limit ${group(s.gas)}` : ""}\n`);
      else w.write(`${head}: REVERT ${s.revert}\n`);
      w.write(`    to ${prepared[i].to}, value ${fromUnits(prepared[i].value, 18, 18)} ETH\n`);
    });
    if (!reverted) w.write("Nothing sent. Add --send to broadcast, or --print for raw transactions.\n");
  }
  if (reverted) exit(1);
  return { mode: "simulate", sims, hashes: [] };
}
