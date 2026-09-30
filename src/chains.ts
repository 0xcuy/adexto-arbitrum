/**
 * Chain registry for ADEXTO on Arbitrum.
 *
 * Every address and hash below was read back from the chain before it was written here:
 * `VERSION()` was called at the address and its runtime bytecode was hashed with
 * `eth_getCode`. `scripts/probe.ts` repeats both checks on every run and fails on drift,
 * so a stale entry is caught by a command, not by a reader.
 *
 * Deployment targets are data. Adding a chain is one entry here, with an empty `factories`
 * list until something has actually been broadcast there. An empty list is a statement of
 * fact the probe can check, which a placeholder address would not be.
 */

export interface FactoryGeneration {
  /** Semantic version as returned by `VERSION()` on chain. */
  version: string;
  address: string;
  /** Size of the runtime bytecode, as returned by `eth_getCode`. */
  runtimeBytes: number;
  /** keccak256 of that runtime bytecode. Identical on every chain a generation runs on. */
  runtimeKeccak: string;
  /** The generation new markets are launched on. Exactly one per chain. */
  current: boolean;
  /** Present when the deployment receipt has been checked against the address. */
  deployment?: { block: number; tx: string };
}

export interface ChainTarget {
  /** Short key used on the command line. */
  key: string;
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
  /** Newest first. Empty for a chain the protocol has not been deployed to yet. */
  factories: FactoryGeneration[];
}

/**
 * Receives the protocol fee leg of every market, on every chain.
 *
 * It is an `immutable` in the factory and in each curve it deploys, with no setter in
 * either contract, so revenue from a launched market cannot be redirected, including by
 * us. The key behind it is kept offline.
 */
export const PROTOCOL_TREASURY = "0x24268Fffc119ec5550F68e80D94476fD64daE967";

/**
 * ERC-8004 Identity Registry. The factory hard-codes this address as a `constant` and only
 * ever calls `ownerOf` on it, which compiles to a STATICCALL.
 *
 * Because it is a constant, the registry must exist at this exact address on any chain the
 * same bytecode is deployed to, or agent-bound launches on that chain are unavailable.
 * The probe checks that before a deployment is planned rather than after.
 */
export const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/** Multicall3, used here only to read `block.number` as a contract sees it. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * The source the current generation was compiled from, and how to check that claim.
 *
 * The factory's runtime bytecode matches a `--via-ir` build of this commit except for two
 * 20-byte slots, both holding the immutable `protocolTreasury`. With every occurrence of
 * that address zeroed, the code on chain hashes to `maskedKeccak`. The factory's runtime
 * carries the creation code of the curve and the token it deploys, so this one comparison
 * covers all three contracts.
 */
export const SOURCE = {
  repo: "https://github.com/0xcuy/adexto",
  commit: "1f1cbfc5ce97b417aa926e122e564738d4389e55",
  compile: "node scripts/compile-contracts.mjs --via-ir",
  maskedKeccak: "0x83adf2725ca03af986bf18a15a4b675eeba4e288b0515bbd370342d1de3dac3f",
  maskedSlots: 2,
} as const;

/**
 * Tickers the current factory reserved in its constructor. There is no function that adds
 * to or releases from this list, so every one of them is unlaunchable on that factory for
 * as long as the chain exists. Case-insensitive: `eth` is rejected along with `ETH`.
 */
export const RESERVED_TICKERS = [
  "ADEXTO", "ADT", "ZEEBO", "WOMBO", "BLOOP", "PARCEL",
  "ETH", "WETH", "USDC", "USDT", "BTC", "WBTC", "0G", "A0GI", "MON", "ARB",
] as const;

export const ARBITRUM_ONE: ChainTarget = {
  key: "arbitrum",
  chainId: 42161,
  name: "Arbitrum One",
  nativeSymbol: "ETH",
  rpcUrl: "https://arb1.arbitrum.io/rpc",
  explorer: "https://arbiscan.io",
  factories: [
    {
      version: "0.12.0",
      address: "0x75EeDEd196D2BE283d815D52F617eB70bCe865bC",
      runtimeBytes: 21_403,
      runtimeKeccak: "0xc0841d5a2193f21df6b7f685bbe39fd5ee6411cbf89bf76e1b99d867174d8f0f",
      current: true,
      deployment: {
        block: 509_845_969,
        tx: "0x9084a9ae5d7a765563ff2c935980053fa11a6ff87fc114bc8c3c9bb35cec35f5",
      },
    },
    {
      version: "0.11.0",
      address: "0xE17f1027FC5f294327D701829baeD9d6519e922C",
      runtimeBytes: 21_281,
      runtimeKeccak: "0xcbb89e32ae973400723287f16f32e87f039efcef1c1f814c5805bd1a6fe3add8",
      current: false,
    },
    {
      version: "0.10.0",
      address: "0x8F3948902c48489fc9E7287590E7eb8A8E915A64",
      runtimeBytes: 20_054,
      runtimeKeccak: "0x78eab848d1c53a9f4893f20a417c2dc3b8f3f639cd993d21a78e8740457da4e9",
      current: false,
    },
  ],
};

/**
 * Robinhood Chain, an Arbitrum Orbit L2 settling to Ethereum, with ETH as gas.
 *
 * Nothing is deployed here yet, and the empty list says so. What has been checked is
 * whether the current bytecode could be deployed unmodified: the ERC-8004 registry the
 * factory hard-codes is present at the same address on mainnet, and absent on testnet,
 * where agent-bound launches would therefore be unavailable.
 */
export const ROBINHOOD: ChainTarget = {
  key: "robinhood",
  chainId: 4663,
  name: "Robinhood Chain",
  nativeSymbol: "ETH",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  factories: [],
};

export const ROBINHOOD_TESTNET: ChainTarget = {
  key: "robinhood-testnet",
  chainId: 46630,
  name: "Robinhood Chain Testnet",
  nativeSymbol: "ETH",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  factories: [],
};

export const TARGETS: Record<string, ChainTarget> = {
  [ARBITRUM_ONE.key]: ARBITRUM_ONE,
  [ROBINHOOD.key]: ROBINHOOD,
  [ROBINHOOD_TESTNET.key]: ROBINHOOD_TESTNET,
};

export function targetByChainId(chainId: number): ChainTarget | undefined {
  return Object.values(TARGETS).find((t) => t.chainId === chainId);
}

/**
 * Launch parameters the site uses on `0.12.0`: a 1.00% total fee, carved four ways.
 * `swapFeeBps` is the whole fee a trader pays; depth is the remainder after the other three.
 *
 *   creator  70 bps · depth 10 bps · buyback 10 bps · protocol 10 bps (a factory constant)
 */
export const LAUNCH_MODEL = {
  swapFeeBps: 100n,
  creatorShareBps: 70n,
  treasuryShareBps: 10n,
} as const;

/** Minimum ABI surface the probe reads. Deliberately narrow. */
export const FACTORY_ABI = [
  "function VERSION() view returns (string)",
  "function PROTOCOL_FEE_BPS() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function ANTI_SNIPER_BPS() view returns (uint256)",
  "function AGENT_REGISTRY() view returns (address)",
  "function SYMBOL_RESERVED() view returns (address)",
  "function protocolTreasury() view returns (address)",
  "function totalProjectsCount() view returns (uint256)",
  "function projectAt(uint256 index) view returns (address token, address curve, address creator, string symbol, uint256 deployedAt)",
  "function isSymbolAvailable(string symbol) view returns (bool)",
  "function deployTrinity(string name, string symbol, uint256 initialSupply, address agentIdentity, uint256 virtualNative, uint256 swapFeeBps, uint256 creatorShareBps, uint256 treasuryShareBps, bytes32 metadataRoot, bool bindAgent, uint256 agentId) returns (address token, address curve)",
] as const;

export const CURVE_ABI = [
  "function VERSION() view returns (string)",
  "function swapCount() view returns (uint256)",
  "function totalVolumeNative() view returns (uint256)",
  "function treasuryNative() view returns (uint256)",
  "function totalTokensBurned() view returns (uint256)",
  "function creatorOwed() view returns (uint256)",
  "function protocolOwed() view returns (uint256)",
  "function depthFeeBps() view returns (uint256)",
  "function creatorFeeBps() view returns (uint256)",
  "function treasuryBuybackBps() view returns (uint256)",
  "function protocolFeeBps() view returns (uint256)",
  "function floorPriceNativePerToken() view returns (uint256)",
  "function spotPriceNativePerToken() view returns (uint256)",
] as const;

export const TOKEN_ABI = [
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function launchBlock() view returns (uint256)",
  "function ANTI_SNIPE_BLOCKS() view returns (uint256)",
] as const;

export const MULTICALL3_ABI = ["function getBlockNumber() view returns (uint256)"] as const;

/** EIP-1967 implementation slot, to compare proxies across chains. */
export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
