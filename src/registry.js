/**
 * Chainlink contract address registry.
 *
 * Maps (pair, chain) to feed contract addresses and provides the ABI
 * function signatures needed to interact with each product.
 *
 * Sources:
 *   - Price Feeds: https://docs.chain.link/data-feeds/price-feeds/addresses
 *   - CCIP: https://docs.chain.link/ccip/supported-networks
 *   - VRF: https://docs.chain.link/vrf/v2-5/supported-networks
 *   - Functions: https://docs.chain.link/chainlink-functions/supported-networks
 *
 * This file is the source of truth for all contract addresses the action
 * uses. Keep it up to date when Chainlink deploys new feeds or upgrades
 * contracts. The `list-feeds` and `list-chains` commands surface this
 * data directly to workflow authors.
 */

// ── AggregatorV3Interface ──────────────────────────────────────────

// Signatures stripped of `external view` modifiers — alloy's parser
// expects just `function name(params) returns (types)`.
export const FEED_INTERFACE = {
  latestRoundData:
    'function latestRoundData() returns (uint80, int256, uint256, uint256, uint80)',
  decimals: 'function decimals() returns (uint8)',
  description: 'function description() returns (string)',
  getRoundData:
    'function getRoundData(uint80) returns (uint80, int256, uint256, uint256, uint80)',
}

// ── Network configuration ──────────────────────────────────────────

/**
 * Network mapping: common name → bridge params.
 *
 * The bridge's `chain` operation needs to know which network to target.
 * The exact param shape depends on the bridge's chain provider
 * implementation. For most EVM chains, passing the network name or
 * chain ID is sufficient.
 */
export const NETWORKS = {
  // Mainnets
  ethereum: { bridgeParams: {}, chainName: 'ethereum', chainId: 1 },
  base: { bridgeParams: { network: 'base' }, chainName: 'base', chainId: 8453 },
  arbitrum: { bridgeParams: { network: 'arbitrum' }, chainName: 'arbitrum', chainId: 42161 },
  optimism: { bridgeParams: { network: 'optimism' }, chainName: 'optimism', chainId: 10 },
  polygon: { bridgeParams: { network: 'polygon' }, chainName: 'polygon', chainId: 137 },
  avalanche: { bridgeParams: { network: 'avalanche' }, chainName: 'avalanche', chainId: 43114 },

  // Testnets — the bridge network name must match the protocol's
  // KNOWN_CHAINS keys (e.g. "ethereum-sepolia", not just "sepolia").
  // The user-facing name stays short; the mapping happens here.
  sepolia: {
    bridgeParams: { network: 'ethereum-sepolia' },
    chainName: 'sepolia',
    chainId: 11155111,
  },
  'base-sepolia': {
    bridgeParams: { network: 'base-sepolia' },
    chainName: 'base-sepolia',
    chainId: 84532,
  },
  'arbitrum-sepolia': {
    bridgeParams: { network: 'arbitrum-sepolia' },
    chainName: 'arbitrum-sepolia',
    chainId: 421614,
  },
  fuji: {
    bridgeParams: { network: 'avalanche-fuji' },
    chainName: 'fuji',
    chainId: 43113,
  },
  amoy: {
    bridgeParams: { network: 'polygon-amoy' },
    chainName: 'amoy',
    chainId: 80002,
  },
}

// ── Price Feed addresses ───────────────────────────────────────────

/**
 * Feed registry: chain → { pair → address }
 *
 * Pairs are stored uppercase with no spaces: "ETH/USD", "BTC/USD".
 * Addresses are checksummed.
 *
 * This is a curated subset of the most commonly used feeds. Workflow
 * authors who need a feed not listed here can pass the contract address
 * directly via the `feed-address` input (bypass the registry).
 */
export const FEEDS = {
  ethereum: {
    'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
    'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
    'DAI/USD': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
    'USDT/USD': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
    'SOL/USD': '0x4ffC43a60e009B551865A93d232E33Fce9f01507',
    'AVAX/USD': '0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7',
    'MATIC/USD': '0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676',
    'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
    'AAVE/USD': '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
    'UNI/USD': '0x553303d460EE0afB37EdFf9bE42922D8FF63220e',
    'COMP/USD': '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5',
    'MKR/USD': '0xec1D1B3b0443256cc3860e24a46F108e699484Aa',
    'SNX/USD': '0xDC3EA94CD0AC27d9A86C180091e7f78C683d3699',
    'SHIB/USD': '0x8dD1CD88F43aF196ae478e91b9F5E4Ac69A97C61',
    // Removed: OP/USD, CRV/USD, DOGE/USD, LTC/USD, XRP/USD, DOT/USD,
    // ATOM/USD, FIL/USD — these addresses revert or return empty on
    // mainnet as of April 2026. The feeds may have been deprecated or
    // migrated. Re-verify via data.chain.link before re-adding.
  },
  sepolia: {
    'ETH/USD': '0x694AA1769357215DE4FAC081bf1f309aDC325306',
    'BTC/USD': '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43',
    'LINK/USD': '0xc59E3633BAAC79493d908e63626716e204A45EdF',
    'USDC/USD': '0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E',
    'DAI/USD': '0x14866185B1962B63C3Ea9E03Bc1da838bab34C19',
  },
  base: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    'BTC/USD': '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F',
    'LINK/USD': '0x17CAb8FE31cA45e1ab3ACC27e678a47D9CDca516',
    'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
    'CBETH/USD': '0xd7818272B9e248357d13057AAb0B417aF31E817d',
  },
  arbitrum: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'BTC/USD': '0x6ce185860a4963106506C203335A2910413708e9',
    'LINK/USD': '0x86E53CF1B870786351Da77A57575e79CB55812CB',
    'USDC/USD': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
    'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
  },
  polygon: {
    'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945',
    'BTC/USD': '0xc907E116054Ad103354f2D350FD2514433D57F6f',
    'LINK/USD': '0xd9FFdb71EbE7496cC440152d43986Aae0AB76665',
    'MATIC/USD': '0xAB594600376Ec9fD91F8e8dC60a760E1142F1eE1',
    'USDC/USD': '0xfE4A8cc5b5B2366C1B58Bea3858e81843583ee2e',
  },
  avalanche: {
    'ETH/USD': '0x976B3D034E162d8bD72D6b9C989d545b839003b0',
    'BTC/USD': '0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743',
    'LINK/USD': '0x49ccd9ca821EfEab2b98c60dC60F518E765EDe9a',
    'AVAX/USD': '0x0A77230d17318075983913bC2145DB16C7366156',
    'USDC/USD': '0xF096872672F44d6EBA71458D74fe67F9a77a23B9',
  },
}

// ── Proof of Reserve feed addresses ────────────────────────────────

/**
 * Proof of Reserve feeds. Same AggregatorV3Interface as price feeds.
 * The `answer` field represents total reserves (not a price). Units
 * depend on the asset (e.g., satoshis for BTC reserves, base units for
 * USDC). Always call decimals() to confirm.
 *
 * No programmatic on-chain way to distinguish PoR from price feeds —
 * you must know from the documentation. description() typically
 * contains "Reserves" or "PoR".
 */
export const POR_FEEDS = {
  ethereum: {
    'WBTC/BTC': '0xa81FE04086865e63E12dD3776978E49DEEa2ea4e',
  },
}

// ── CCIP configuration ─────────────────────────────────────────────

/**
 * CCIP chain selectors and router addresses.
 * Source: https://docs.chain.link/ccip/supported-networks
 */
export const CCIP = {
  routers: {
    ethereum: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
    arbitrum: '0x141fa059441E0ca23ce184B6A78bafD2A517DdE8',
    optimism: '0x3206695CaE29952f4b0c22a169725a865bc8Ce0f',
    base: '0x881e3A65B4d4a04dD529061dd0071cf975F58bCD',
    polygon: '0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe',
    avalanche: '0xF4c7E640EdA248ef95972845a62bdC74237805dB',
    // Testnets
    sepolia: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
    'base-sepolia': '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93',
    'arbitrum-sepolia': '0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165',
    fuji: '0xF694E193200268f9a4868e4Aa017A0118C9a8177',
    amoy: '0x9C32fCB86BF0f4a1A8921a9Fe46de3198bb884B2',
  },
  chainSelectors: {
    ethereum: '5009297550715157269',
    arbitrum: '4949039107694359620',
    optimism: '3734403246176062136',
    base: '15971525489660198786',
    polygon: '4051577828743386545',
    avalanche: '6433500567565415381',
    // Testnets
    sepolia: '16015286601757825753',
    'base-sepolia': '10344971235874465080',
    'arbitrum-sepolia': '3478487238524512106',
    fuji: '14767482510784806043',
    amoy: '16281711391670634445',
  },
}

/**
 * LINK token addresses per chain (needed for CCIP fee payment).
 * address(0) means "pay in native" — the router accepts msg.value.
 */
export const LINK_TOKENS = {
  ethereum: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  arbitrum: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
  base: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
  polygon: '0xb0897686c545045aFc77CF20eC7A532E3120E0F1',
  avalanche: '0x5947BB275c521040051D82396192181b413227A3',
  optimism: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6',
  // Testnets
  sepolia: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
  fuji: '0x0b9d5D9136855f6FEc3c0993feE6E9CE8a297846',
}

/**
 * CCIP interface functions.
 */
export const CCIP_INTERFACE = {
  // Tuple field names stripped — alloy's parser requires unnamed tuple components
  getFee:
    'function getFee(uint64, (bytes, bytes, (address, uint256)[], address, bytes)) returns (uint256)',
  ccipSend:
    'function ccipSend(uint64, (bytes, bytes, (address, uint256)[], address, bytes)) payable returns (bytes32)',
}

// ── VRF v2.5 configuration ─────────────────────────────────────────

export const VRF = {
  coordinators: {
    ethereum: '0xD7f86b4b8Cae7D942340FF628F82735b7a20893a',
    arbitrum: '0x3C0Ca683b403E37668AE3DC4FB62F4B29B6f7571',
    base: '0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634',
    polygon: '0xec0Ed46f36576541C681b72033893895e0faE0C9',
    avalanche: '0xE40895D055bccd2053FD1F5744b0ad87781E523B',
    // Testnets
    sepolia: '0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B',
    'base-sepolia': '0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE',
    fuji: '0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE',
  },
  keyHashes: {
    // Each chain has multiple key hashes for different gas lanes.
    // Using the "500 gwei" lane as default for mainnet, "100 gwei" for testnets.
    ethereum: '0x8077df514608a09f83e4e8d300645594e5d7234665448ba83f51a50f842bd3d9',
    sepolia: '0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae',
  },
}

export const VRF_INTERFACE = {
  createSubscription: 'function createSubscription() returns (uint256)',
  addConsumer: 'function addConsumer(uint256, address)',
  removeConsumer: 'function removeConsumer(uint256, address)',
  getSubscription:
    'function getSubscription(uint256) returns (uint96, uint96, uint64, address, address[])',
  requestRandomWords:
    'function requestRandomWords(bytes32, uint256, uint16, uint32, uint32, bytes) returns (uint256)',
  fundSubscription: 'function fundSubscriptionWithNative(uint256) payable',
}

// ── Functions configuration ────────────────────────────────────────

export const FUNCTIONS = {
  routers: {
    ethereum: '0x65Dcc24F8ff9e51F10DCc7Ed1e4e2A61e6E14bd6',
    arbitrum: '0x97083E831F8F0638855e2A515c90EdCF158DF238',
    base: '0xf9B8fc078197181C841c296C876945aaa425B278',
    polygon: '0xdc2AAF042Aeff2E68B3e8E33F19e4B9fA7C73F10',
    avalanche: '0xA9d587a00A31A52Ed70D6026794a8FC5E2F5E6bf',
    // Testnets
    sepolia: '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0',
    'base-sepolia': '0xf9B8fc078197181C841c296C876945aaa425B278',
    fuji: '0xA9d587a00A31A52Ed70D6026794a8FC5E2F5E6bf',
  },
  donIds: {
    ethereum: 'fun-ethereum-mainnet-1',
    sepolia: 'fun-ethereum-sepolia-1',
    arbitrum: 'fun-arbitrum-mainnet-1',
    'arbitrum-sepolia': 'fun-arbitrum-sepolia-1',
    base: 'fun-base-mainnet-1',
    'base-sepolia': 'fun-base-sepolia-1',
    polygon: 'fun-polygon-mainnet-1',
    amoy: 'fun-polygon-amoy-1',
    avalanche: 'fun-avalanche-mainnet-1',
    fuji: 'fun-avalanche-fuji-1',
  },
}
