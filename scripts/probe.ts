/**
 * Read-only probe of ADEXTO on an Arbitrum chain. It never sends a transaction.
 *
 * Every check is an `eth_chainId`, `eth_getCode`, `eth_call` or `eth_estimateGas`, so it runs
 * against mainnet with no key, no funds and nothing left behind. A launch is proven possible
 * by simulating it, not by doing it: a test token born on mainnet cannot be deleted.
 *
 * What it answers, in order:
 *   1. Is the RPC the chain it claims to be? Asked with `eth_chainId`, not taken from config.
 *   2. Is the code at each factory address the code recorded in `src/chains.ts`?
 *   3. Is the current factory a build of the published source commit?
 *   4. Are the protocol constants what the documentation says they are?
 *   5. Can a stranger launch a market right now, and what would it cost?
 *   6. What markets exist, and what has each of them done?
 *
 * Exit code 0 means every check passed, 1 means a mismatch, 2 means the RPC was unreachable.
 *
 * Usage:
 *   node scripts/probe.ts                        # Arbitrum One
 *   node scripts/probe.ts robinhood              # Robinhood Chain readiness
 *   node scripts/probe.ts robinhood-testnet
 *   PROBE_RPC=https://… node scripts/probe.ts    # use another endpoint
 *   PROBE_FROM=0x… node scripts/probe.ts         # simulate as, and show the balance of, an address
 */
import { ethers } from "ethers";
import {
  CURVE_ABI,
  EIP1967_IMPLEMENTATION_SLOT,
  ERC8004_REGISTRY,
  FACTORY_ABI,
  LAUNCH_MODEL,
  MULTICALL3,
  MULTICALL3_ABI,
  PROTOCOL_TREASURY,
  RESERVED_TICKERS,
  SOURCE,
  TARGETS,
  TOKEN_ABI,
  type ChainTarget,
  type FactoryGeneration,
} from "../src/chains.ts";

const key = (process.argv[2] ?? "arbitrum").toLowerCase();
const target: ChainTarget | undefined = TARGETS[key];
if (!target) {
  console.error(`unknown target "${key}". Options: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const rpcUrl = process.env["PROBE_RPC"] || target.rpcUrl;
/**
 * `batchMaxCount: 1` because public endpoints rate-limit inside a JSON-RPC batch and answer
 * each entry with an error while the batch itself returns HTTP 200. ethers then reports
 * "missing revert data", which reads as a broken contract rather than a throttled RPC.
 */
const provider = new ethers.JsonRpcProvider(rpcUrl, target.chainId, {
  staticNetwork: true,
  batchMaxCount: 1,
});

const failures: string[] = [];
function check(pass: boolean, what: string): string {
  if (!pass) failures.push(what);
  return pass ? "ok" : "MISMATCH";
}

console.log(`\n=== ${target.name} · chainId ${target.chainId} ===`);

// 1. Identity. `getNetwork()` would answer from config because the network is static, so it
//    cannot fail, which makes it worse than no check at all. Ask the node instead.
let reportedId: number;
try {
  reportedId = Number(await provider.send("eth_chainId", []));
} catch (e) {
  console.error(`  RPC unreachable: ${rpcUrl}\n  ${short(e)}\n  Try another endpoint with PROBE_RPC=…`);
  process.exit(2);
}
const head = await provider.getBlockNumber();
const gasPrice = (await provider.getFeeData()).gasPrice ?? 0n;
line("rpc", rpcUrl);
line("eth_chainId", `${reportedId}  ${check(reportedId === target.chainId, "eth_chainId")}`);
line("head block", head);
line("gas price", `${ethers.formatUnits(gasPrice, "gwei")} gwei`);

/**
 * `block.number` as a contract sees it. On Arbitrum Nitro chains it tracks the parent
 * chain's block number, not the L2 head above, and every block-counted window in a
 * contract inherits that clock. The token's anti-sniper window is one of them.
 */
if ((await provider.getCode(MULTICALL3)) !== "0x") {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
  const evmBlock = await attempt(() => mc.getFunction("getBlockNumber")() as Promise<bigint>);
  line("block.number", evmBlock.ok ? `${evmBlock.value}  (inside the EVM)` : `n/a  ${evmBlock.error}`);
} else {
  line("block.number", "n/a  (no Multicall3 at the canonical address)");
}

// 2. The registry the factory hard-codes. A constant address has to exist on every chain the
//    same bytecode is deployed to.
const registryCode = await provider.getCode(ERC8004_REGISTRY);
const registryImpl = registryCode === "0x" ? null : await provider.getStorage(ERC8004_REGISTRY, EIP1967_IMPLEMENTATION_SLOT);
line(
  "ERC-8004",
  registryCode === "0x"
    ? `${ERC8004_REGISTRY}  ABSENT, agent-bound launches unavailable here`
    : `${ERC8004_REGISTRY}  ${bytes(registryCode)} B, implementation ${ethers.getAddress(ethers.dataSlice(registryImpl!, 12))}`,
);

// 3. Factories.
if (target.factories.length === 0) {
  console.log(`\n  no factory deployed on ${target.name} yet`);
  console.log(
    `  readiness for a byte-identical deployment: ${registryCode === "0x" ? "PARTIAL (no ERC-8004 registry)" : "READY (registry present at the hard-coded address)"}`,
  );
}

for (const gen of target.factories) {
  await probeFactory(gen);
}

if (process.env["PROBE_FROM"]) {
  const who = ethers.getAddress(process.env["PROBE_FROM"]);
  console.log("");
  line("balance", `${who}  ${ethers.formatEther(await provider.getBalance(who))} ${target.nativeSymbol}`);
}

console.log(
  failures.length === 0
    ? `\n  verdict: every check passed\n`
    : `\n  verdict: ${failures.length} mismatch(es)\n${failures.map((f) => `    - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);

async function probeFactory(gen: FactoryGeneration): Promise<void> {
  console.log(`\n  factory ${gen.version}${gen.current ? " (current)" : ""}  ${gen.address}`);
  const code = await provider.getCode(gen.address);
  if (code === "0x") {
    failures.push(`${gen.version}: no code at ${gen.address}`);
    line("code", "NONE");
    return;
  }
  const hash = ethers.keccak256(code);
  line("runtime", `${bytes(code)} B  ${check(bytes(code) === gen.runtimeBytes, `${gen.version} size`)}`);
  line("keccak", `${hash}  ${check(hash === gen.runtimeKeccak, `${gen.version} keccak`)}`);

  const factory = new ethers.Contract(gen.address, FACTORY_ABI, provider);
  const call = <T>(name: string, ...args: unknown[]) => attempt(() => factory.getFunction(name)(...args) as Promise<T>);

  const version = await call<string>("VERSION");
  line("VERSION", version.ok ? `${version.value}  ${check(version.value === gen.version, `${gen.version} VERSION`)}` : version.error);

  if (gen.current) await probeCurrent(gen, code, call);

  const count = await call<bigint>("totalProjectsCount");
  if (!count.ok) {
    line("markets", `n/a  ${count.error}`);
    return;
  }
  line("markets", count.value);
  const shown = count.value > 20n ? 20n : count.value;
  for (let i = 0n; i < shown; i++) {
    const p = await call<[string, string, string, string, bigint]>("projectAt", i);
    if (!p.ok) {
      line(`  #${i}`, p.error);
      continue;
    }
    await probeMarket(p.value);
  }
}

async function probeCurrent(
  gen: FactoryGeneration,
  code: string,
  call: <T>(name: string, ...args: unknown[]) => Promise<Result<T>>,
): Promise<void> {
  // Source match. Zero every occurrence of the immutable treasury, then hash.
  const needle = PROTOCOL_TREASURY.slice(2).toLowerCase();
  const parts = code.toLowerCase().split(needle);
  const masked = ethers.keccak256(parts.join("0".repeat(40)));
  line(
    "source",
    `${masked}  ${check(masked === SOURCE.maskedKeccak && parts.length - 1 === SOURCE.maskedSlots, "source match")}` +
      `\n${" ".repeat(19)}(${parts.length - 1} treasury slots zeroed; ${SOURCE.repo}/commit/${SOURCE.commit.slice(0, 7)}, ${SOURCE.compile})`,
  );

  if (gen.deployment) {
    const receipt = await attempt(() => provider.getTransactionReceipt(gen.deployment!.tx));
    if (receipt.ok && receipt.value) {
      const r = receipt.value;
      const same = r.contractAddress?.toLowerCase() === gen.address.toLowerCase() && r.blockNumber === gen.deployment.block;
      line("deployed", `block ${r.blockNumber}, status ${r.status}, ${r.gasUsed} gas  ${check(same && r.status === 1, "deployment receipt")}`);
    } else {
      line("deployed", `receipt unreadable from this RPC  ${receipt.ok ? "(null)" : receipt.error}`);
    }
  }

  const expect: Array<[string, (v: unknown) => boolean]> = [
    ["PROTOCOL_FEE_BPS", (v) => v === 10n],
    ["MAX_SUPPLY", (v) => v === 1_000_000_000_000n],
    ["ANTI_SNIPER_BPS", (v) => v === 100n],
    ["AGENT_REGISTRY", (v) => eq(String(v), ERC8004_REGISTRY)],
    ["SYMBOL_RESERVED", (v) => eq(String(v), "0x0000000000000000000000000000000000000001")],
    ["protocolTreasury", (v) => eq(String(v), PROTOCOL_TREASURY)],
  ];
  for (const [name, pass] of expect) {
    const v = await call<unknown>(name);
    line(name, v.ok ? `${v.value}  ${check(pass(v.value), `${gen.version} ${name}`)}` : v.error);
  }

  // Reserved tickers, including a lower-case spelling, which the factory upper-cases.
  let locked = 0;
  for (const t of [...RESERVED_TICKERS, "eth"]) {
    const free = await call<boolean>("isSymbolAvailable", t);
    if (free.ok && free.value === false) locked++;
  }
  const expected = RESERVED_TICKERS.length + 1;
  line("reserved", `${locked}/${expected} tickers unlaunchable  ${check(locked === expected, "reserved tickers")}`);

  // A stranger's launch, simulated. Random caller, random unused ticker, the site's fee model.
  const caller = process.env["PROBE_FROM"] ? ethers.getAddress(process.env["PROBE_FROM"]) : ethers.Wallet.createRandom().address;
  let symbol = "";
  for (let i = 0; i < 5 && !symbol; i++) {
    const candidate = `PRB${Math.floor(1000 + Math.random() * 9000)}`;
    const free = await call<boolean>("isSymbolAvailable", candidate);
    if (free.ok && free.value) symbol = candidate;
  }
  const args = [
    "Probe Market",
    symbol,
    1_000_000_000n, // initialSupply is in WHOLE tokens, not wei. MAX_SUPPLY is 1e12 whole tokens.
    caller, // agentIdentity must not be the zero address, even when bindAgent is false.
    ethers.parseEther("1.664337"), // virtual reserve, never deposited. The value $WOMBO opened with.
    LAUNCH_MODEL.swapFeeBps,
    LAUNCH_MODEL.creatorShareBps,
    LAUNCH_MODEL.treasuryShareBps,
    ethers.ZeroHash,
    false, // bindAgent
    0n, // agentId must be 0 unless bindAgent is set
  ] as const;
  const factory = new ethers.Contract(gen.address, FACTORY_ABI, provider);
  const deploy = factory.getFunction("deployTrinity");
  const sim = await attempt(() => deploy.staticCall(...args, { from: caller }) as Promise<[string, string]>);
  line("launch sim", sim.ok ? `ok as ${short(caller)} ($${symbol}), no native attached` : `REVERT ${sim.error}`);
  check(sim.ok, "launch simulation");
  const gas = await attempt(() => deploy.estimateGas(...args, { from: caller }));
  if (gas.ok) {
    line("launch gas", `${gas.value} gas = ${ethers.formatEther(gas.value * gasPrice)} ${target!.nativeSymbol} at ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  } else {
    line("launch gas", `n/a  ${gas.error}`);
  }
}

async function probeMarket([token, curve, creator, symbol, deployedAt]: [string, string, string, string, bigint]): Promise<void> {
  const c = new ethers.Contract(curve, CURVE_ABI, provider);
  const t = new ethers.Contract(token, TOKEN_ABI, provider);
  const read = async (contract: ethers.Contract, name: string): Promise<string> => {
    const r = await attempt(() => contract.getFunction(name)() as Promise<unknown>);
    return r.ok ? String(r.value) : "n/a";
  };
  const [version, swaps, volume, vault, burned, depth, creatorBps, buyback, protocol, launchBlock] = await Promise.all([
    read(c, "VERSION"),
    read(c, "swapCount"),
    read(c, "totalVolumeNative"),
    read(c, "treasuryNative"),
    read(c, "totalTokensBurned"),
    read(c, "depthFeeBps"),
    read(c, "creatorFeeBps"),
    read(c, "treasuryBuybackBps"),
    read(c, "protocolFeeBps"),
    read(t, "launchBlock"),
  ]);
  const eth = (v: string) => (v === "n/a" ? v : `${ethers.formatEther(BigInt(v))} ${target!.nativeSymbol}`);
  console.log(`    $${symbol}  token ${token}  curve ${curve}`);
  console.log(`      creator ${creator}, launched ${new Date(Number(deployedAt) * 1000).toISOString()}, curve ${version}`);
  console.log(`      fees bps: depth ${depth} · creator ${creatorBps} · buyback ${buyback} · protocol ${protocol}`);
  console.log(`      swaps ${swaps}, volume ${eth(volume)}, buyback vault ${eth(vault)}, burned ${burned === "n/a" ? burned : ethers.formatEther(BigInt(burned))}`);
  console.log(`      token launchBlock ${launchBlock}  (block.number at launch, parent-chain clock on Nitro)`);
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: short(e) };
  }
}
function short(e: unknown): string {
  if (typeof e === "string") return e.length > 14 && e.startsWith("0x") ? `${e.slice(0, 6)}…${e.slice(-4)}` : e;
  const anyE = e as { shortMessage?: string; message?: string };
  return String(anyE?.shortMessage ?? anyE?.message ?? e).slice(0, 160);
}
function bytes(code: string): number {
  return (code.length - 2) / 2;
}
function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(17)}${value}`);
}
