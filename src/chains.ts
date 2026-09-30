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
  /** Tickers the current factory reserves on this chain beyond `RESERVED_TICKERS`, or a sample of them. */
  extraReserved?: readonly string[];
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
  commit: "71b5adfe774ed7a93f9fe589b4430c8122febb1f",
  compile: "node scripts/compile-contracts.mjs --via-ir",
  maskedKeccak: "0x0e70cb93fbb10b66109cc71d547329cb48b4c3953791c2c4609519ff92221d62",
  maskedSlots: 2,
} as const;

/**
 * Tickers every ADEXTO v1 factory reserved in its constructor. There is no function that adds
 * to or releases from this list, so every one of them is unlaunchable on that factory for as
 * long as the chain exists. Case-insensitive: `eth` is rejected along with `ETH`. The full
 * per-chain lists are in `scripts/reserved-symbols.json` of the main repository.
 */
export const RESERVED_TICKERS = [
  "ADEXTO", "ADT", "ZEEBO", "WOMBO", "BLOOP", "PARCEL",
  "ETH", "WETH", "USDC", "USDT", "BTC", "WBTC", "0G", "A0GI", "MON", "ARB",
] as const;

/**
 * Robinhood Chain's factory reserves 196 more: `USDG` and the 195 tokenized stocks listed as
 * active on chain 4663 when it was deployed. The probe spot-checks this sample, including
 * one-letter and common-word tickers, rather than all 196.
 */
export const ROBINHOOD_RESERVED_SAMPLE = ["USDG", "AAPL", "TSLA", "NVDA", "SPY", "COIN", "P", "ON"] as const;

export const ARBITRUM_ONE: ChainTarget = {
  key: "arbitrum",
  chainId: 42161,
  name: "Arbitrum One",
  nativeSymbol: "ETH",
  rpcUrl: "https://arb1.arbitrum.io/rpc",
  explorer: "https://arbiscan.io",
  /**
   * ADEXTO v1 launches every new market. 0.11.0 stays listed because `$WOMBO` lives on it and
   * keeps its terms forever. Other earlier generations have no listed market on Arbitrum One
   * and are named once, as retired, in the main repository's audit/README.md.
   */
  factories: [
    {
      version: "1.0.0",
      address: "0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E",
      runtimeBytes: 21_806,
      runtimeKeccak: "0x1ca02ca53a3b2a2082f9e5dab6924e1339110e3037608f750981699678881fd4",
      current: true,
      deployment: {
        block: 510_474_755,
        tx: "0xf78fb444c72d5f2a150392a4ea4991e0caf0a11c060107d0a9f2d46f7b72ddf9",
      },
    },
    {
      version: "0.11.0",
      address: "0xE17f1027FC5f294327D701829baeD9d6519e922C",
      runtimeBytes: 21_281,
      runtimeKeccak: "0xcbb89e32ae973400723287f16f32e87f039efcef1c1f814c5805bd1a6fe3add8",
      current: false,
    },
  ],
};

/**
 * Robinhood Chain, an Arbitrum Orbit L2 settling to Ethereum, with ETH as gas.
 *
 * ADEXTO v1 is the first generation here, byte-identical to Arbitrum One's. Its constructor
 * reserved 212 tickers: the base 16, `USDG`, and the 195 tokenized stocks active on the
 * chain at deployment, so no curve token can pose as a stock. The testnet has no ERC-8004
 * registry, which is why the deployment is on mainnet.
 */
export const ROBINHOOD: ChainTarget = {
  key: "robinhood",
  chainId: 4663,
  name: "Robinhood Chain",
  nativeSymbol: "ETH",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  factories: [
    {
      version: "1.0.0",
      address: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
      runtimeBytes: 21_806,
      runtimeKeccak: "0x1ca02ca53a3b2a2082f9e5dab6924e1339110e3037608f750981699678881fd4",
      current: true,
      deployment: {
        block: 76_864_198,
        tx: "0x2a8f8a0c8ef6ff11ec907e13979788c927bd810b8efb8d250895be54705334c9",
      },
    },
  ],
  extraReserved: ROBINHOOD_RESERVED_SAMPLE,
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
 * Launch parameters the site uses on ADEXTO v1: a 1.00% total fee, carved four ways.
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

/**
 * Both token generations. A v1 token measures its launch window in seconds (`launchTime`,
 * `ANTI_SNIPE_WINDOW`, per-wallet `maxWalletAmount`); a 0.11.0 token counted blocks
 * (`launchBlock`, `ANTI_SNIPE_BLOCKS`). A getter the token lacks reads as n/a.
 */
export const TOKEN_ABI = [
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function launchBlock() view returns (uint256)",
  "function launchTime() view returns (uint256)",
  "function ANTI_SNIPE_BLOCKS() view returns (uint256)",
  "function ANTI_SNIPE_WINDOW() view returns (uint256)",
] as const;

export const MULTICALL3_ABI = ["function getBlockNumber() view returns (uint256)"] as const;

/** EIP-1967 implementation slot, to compare proxies across chains. */
export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
