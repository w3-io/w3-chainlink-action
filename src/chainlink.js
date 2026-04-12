/**
 * Chainlink on-chain client.
 *
 * Unlike REST-based partners (BitGo, Stripe, etc.), Chainlink's products
 * are mostly smart contracts you read from or call. This client uses the
 * W3 syscall bridge to make on-chain calls rather than HTTP requests.
 *
 * The bridge runs on the host and handles signing via W3_SECRET_*
 * keys — no private keys in the action container.
 *
 * ## Architecture
 *
 * Each Chainlink product has its own set of methods organized by prefix:
 *   - Price Feeds:    getPrice, getFeedInfo, listFeeds
 *   - Proof of Reserve: getReserves
 *   - CCIP:           ccipSend, ccipEstimateFee, ccipGetMessage
 *   - VRF:            vrfRequest, vrfGetSubscription, ...
 *   - Functions:      functionsRequest, functionsGetSubscription, ...
 *   - Data Streams:   streamsFetchReport, ... (REST, not bridge)
 *
 * All on-chain reads go through `bridge.chain('ethereum', 'read-contract', ...)`
 * All on-chain writes go through `bridge.chain('ethereum', 'call-contract', ...)`
 */

import { W3ActionError, bridge } from '@w3-io/action-core'
import {
  FEEDS,
  FEED_INTERFACE,
  NETWORKS,
  POR_FEEDS,
  CCIP,
  CCIP_INTERFACE,
  LINK_TOKENS,
  VRF,
  VRF_INTERFACE,
  FUNCTIONS,
} from './registry.js'

/**
 * Chainlink-specific error class.
 */
export class ChainlinkError extends W3ActionError {
  constructor(code, message, { details } = {}) {
    super(code, message, { details })
    this.name = 'ChainlinkError'
  }
}

/**
 * Resolve a chain name to its bridge network name and optional params.
 *
 * bridge.chain() takes 4 args: (chainFamily, action, params, network).
 * The network (4th arg) is what the bridge uses for RPC resolution.
 * The params (3rd arg) contain contract, method, args, and optionally rpcUrl.
 *
 * Returns { network, params } where:
 *   - network: the bridge network name (e.g. "ethereum-sepolia")
 *   - params: extra params to merge into each bridge call (e.g. { rpcUrl })
 */
function resolveNetwork(chain, rpcUrl) {
  if (!chain) {
    throw new ChainlinkError('MISSING_CHAIN', 'chain is required')
  }
  const config = NETWORKS[chain.toLowerCase()]
  if (!config) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `Chain "${chain}" is not supported. Available: ${Object.keys(NETWORKS).join(', ')}`,
    )
  }
  return {
    network: config.bridgeParams?.network || chain.toLowerCase(),
    params: rpcUrl ? { rpcUrl } : {},
  }
}

/**
 * Extract a value from a bridge response. The bridge may return:
 *   - A decoded value directly (string, number, array)
 *   - An object { ok: true, raw: "0x...", result: [...] }
 *   - An object { ok: false, error: "..." }
 */
function unwrapBridgeResult(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (!result.ok) {
      throw new ChainlinkError(
        result.code || 'BRIDGE_ERROR',
        result.error || 'Bridge call failed',
      )
    }
    // If the bridge decoded the result, use it
    if (result.result !== undefined) return result.result
    // Otherwise decode the raw ABI hex ourselves
    if (result.raw) return decodeAbiHex(result.raw)
    return result
  }
  return result
}

/**
 * Decode ABI-encoded hex into an array of uint256 words.
 * Each word is 32 bytes (64 hex chars). Values are returned as strings
 * to avoid JavaScript number precision loss on uint256.
 */
function decodeAbiHex(hex) {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex
  const words = []
  for (let i = 0; i < data.length; i += 64) {
    const word = data.slice(i, i + 64)
    if (word.length === 64) {
      words.push(BigInt('0x' + word).toString())
    }
  }
  return words.length === 1 ? words[0] : words
}

// ── Price Feeds ────────────────────────────────────────────────────

/**
 * Get the latest price from a Chainlink Data Feed.
 *
 * @param {string} pair - e.g. "ETH/USD"
 * @param {string} chain - e.g. "ethereum", "sepolia", "base"
 * @returns {{ pair, chain, price, decimals, roundId, updatedAt, raw }}
 */
export async function getPrice(pair, chain, { rpcUrl } = {}) {
  if (!pair) throw new ChainlinkError('MISSING_PAIR', 'pair is required (e.g. "ETH/USD")')

  const net = resolveNetwork(chain, rpcUrl)
  const feedAddress = lookupFeed(pair, chain)

  // Read decimals first so we can format the answer
  const decimalsResult = unwrapBridgeResult(await bridge.chain('ethereum', 'read-contract', {
    contract: feedAddress,
    method: FEED_INTERFACE.decimals,
    args: [],
    ...net.params,
  }, net.network))
  const feedDecimals = parseInt(decimalsResult, 10)

  // Read latest round data
  const roundData = unwrapBridgeResult(await bridge.chain('ethereum', 'read-contract', {
    contract: feedAddress,
    method: FEED_INTERFACE.latestRoundData,
    args: [],
    ...net.params,
  }, net.network))

  // roundData is typically returned as a tuple:
  // [roundId, answer, startedAt, updatedAt, answeredInRound]
  const parsed = parseRoundData(roundData, feedDecimals)

  return {
    pair,
    chain,
    price: parsed.price,
    priceRaw: parsed.answerRaw,
    decimals: feedDecimals,
    roundId: parsed.roundId,
    updatedAt: parsed.updatedAt,
    feedAddress,
    raw: roundData,
  }
}

/**
 * Get metadata about a specific feed.
 */
export async function getFeedInfo(pair, chain, { rpcUrl } = {}) {
  if (!pair) throw new ChainlinkError('MISSING_PAIR', 'pair is required')

  const net = resolveNetwork(chain, rpcUrl)
  const feedAddress = lookupFeed(pair, chain)

  const [description, decimalsResult] = await Promise.all([
    bridge.chain('ethereum', 'read-contract', {
      contract: feedAddress,
      method: FEED_INTERFACE.description,
      args: [],
      ...net.params,
    }, net.network).then(unwrapBridgeResult),
    bridge.chain('ethereum', 'read-contract', {
      contract: feedAddress,
      method: FEED_INTERFACE.decimals,
      args: [],
      ...net.params,
    }, net.network).then(unwrapBridgeResult),
  ])

  return {
    pair,
    chain,
    feedAddress,
    description: String(description),
    decimals: parseInt(decimalsResult, 10),
  }
}

/**
 * List available price feeds for a chain.
 */
export function listFeeds(chain) {
  if (!chain) throw new ChainlinkError('MISSING_CHAIN', 'chain is required')

  const chainKey = chain.toLowerCase()
  const feeds = FEEDS[chainKey]
  if (!feeds) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No feeds registered for chain "${chain}". Available chains: ${Object.keys(FEEDS).join(', ')}`,
    )
  }

  return {
    chain,
    feeds: Object.entries(feeds).map(([pair, address]) => ({ pair, address })),
    count: Object.keys(feeds).length,
  }
}

// ── Proof of Reserve ───────────────────────────────────────────────

/**
 * Get the latest reserve data from a Chainlink Proof of Reserve feed.
 *
 * Same AggregatorV3Interface as price feeds — the `answer` field
 * represents total reserves in base units (e.g., satoshis for BTC).
 *
 * @param {string} feed - e.g. "WBTC/BTC"
 * @param {string} chain - e.g. "ethereum"
 */
export async function getReserves(feed, chain, { rpcUrl } = {}) {
  if (!feed) throw new ChainlinkError('MISSING_FEED', 'feed is required (e.g. "WBTC/BTC")')

  const net = resolveNetwork(chain, rpcUrl)
  const feedAddress = lookupPorFeed(feed, chain)

  const [decimalsResult, roundData, description] = await Promise.all([
    bridge.chain('ethereum', 'read-contract', {
      contract: feedAddress,
      method: FEED_INTERFACE.decimals,
      args: [],
      ...net.params,
    }, net.network).then(unwrapBridgeResult),
    bridge.chain('ethereum', 'read-contract', {
      contract: feedAddress,
      method: FEED_INTERFACE.latestRoundData,
      args: [],
      ...net.params,
    }, net.network).then(unwrapBridgeResult),
    bridge.chain('ethereum', 'read-contract', {
      contract: feedAddress,
      method: FEED_INTERFACE.description,
      args: [],
      ...net.params,
    }, net.network).then(unwrapBridgeResult),
  ])

  const feedDecimals = parseInt(decimalsResult, 10)
  const parsed = parseRoundData(roundData, feedDecimals)

  return {
    feed,
    chain,
    reserves: parsed.price,
    reservesRaw: parsed.answerRaw,
    decimals: feedDecimals,
    description: String(description),
    roundId: parsed.roundId,
    updatedAt: parsed.updatedAt,
    feedAddress,
    raw: roundData,
  }
}

// ── CCIP (Cross-Chain Interoperability Protocol) ───────────────────

/**
 * Estimate the fee for a CCIP cross-chain transfer.
 *
 * @param {string} sourceChain - e.g. "ethereum"
 * @param {string} destinationChain - e.g. "arbitrum"
 * @param {string} receiver - destination address
 * @param {Array} tokenAmounts - [{token, amount}] or empty for message-only
 * @param {string} data - arbitrary bytes payload (default "0x")
 * @param {string} feeToken - LINK address, or "native" for native gas, or "link" for LINK
 */
export async function ccipEstimateFee(
  sourceChain,
  destinationChain,
  { receiver, tokenAmounts = [], data = '0x', feeToken = 'native', rpcUrl } = {},
) {
  if (!sourceChain) throw new ChainlinkError('MISSING_SOURCE_CHAIN', 'source-chain is required')
  if (!destinationChain)
    throw new ChainlinkError('MISSING_DESTINATION_CHAIN', 'destination-chain is required')
  if (!receiver) throw new ChainlinkError('MISSING_RECEIVER', 'receiver is required')

  const srcNet = resolveNetwork(sourceChain, rpcUrl)
  const router = lookupCcipRouter(sourceChain)
  const destSelector = lookupCcipSelector(destinationChain)
  const resolvedFeeToken = resolveFeeToken(feeToken, sourceChain)

  // Build the EVM2AnyMessage struct
  const message = buildCcipMessage(receiver, data, tokenAmounts, resolvedFeeToken)

  const fee = unwrapBridgeResult(await bridge.chain('ethereum', 'read-contract', {
    contract: router,
    method: CCIP_INTERFACE.getFee,
    args: [destSelector, message],
    ...srcNet.params,
  }, srcNet.network))

  return {
    sourceChain,
    destinationChain,
    fee: String(fee),
    feeToken: resolvedFeeToken,
    router,
    destinationSelector: destSelector,
  }
}

/**
 * Send a CCIP cross-chain message (optionally with tokens).
 *
 * This is a write operation — the bridge needs a signer key
 * configured via W3_SECRET_* environment variables.
 */
export async function ccipSend(
  sourceChain,
  destinationChain,
  { receiver, tokenAmounts = [], data = '0x', feeToken = 'native', gasLimit = '200000', rpcUrl } = {},
) {
  if (!sourceChain) throw new ChainlinkError('MISSING_SOURCE_CHAIN', 'source-chain is required')
  if (!destinationChain)
    throw new ChainlinkError('MISSING_DESTINATION_CHAIN', 'destination-chain is required')
  if (!receiver) throw new ChainlinkError('MISSING_RECEIVER', 'receiver is required')

  const srcNet = resolveNetwork(sourceChain, rpcUrl)
  const router = lookupCcipRouter(sourceChain)
  const destSelector = lookupCcipSelector(destinationChain)
  const resolvedFeeToken = resolveFeeToken(feeToken, sourceChain)

  const message = buildCcipMessage(receiver, data, tokenAmounts, resolvedFeeToken, gasLimit)

  const messageId = unwrapBridgeResult(await bridge.chain('ethereum', 'call-contract', {
    contract: router,
    method: CCIP_INTERFACE.ccipSend,
    args: [destSelector, message],
    ...srcNet.params,
  }, srcNet.network))

  return {
    status: 'sent',
    messageId: String(messageId),
    sourceChain,
    destinationChain,
    router,
    destinationSelector: destSelector,
  }
}

// ── VRF (Verifiable Random Function) ───────────────────────────────

/**
 * Create a new VRF subscription.
 */
export async function vrfCreateSubscription(chain, { rpcUrl } = {}) {
  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)

  const subId = unwrapBridgeResult(await bridge.chain('ethereum', 'call-contract', {
    contract: coordinator,
    method: VRF_INTERFACE.createSubscription,
    args: [],
    ...net.params,
  }, net.network))

  return { subscriptionId: String(subId), coordinator, chain }
}

/**
 * Get VRF subscription details.
 */
export async function vrfGetSubscription(subscriptionId, chain, { rpcUrl } = {}) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')

  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)

  const sub = unwrapBridgeResult(await bridge.chain('ethereum', 'read-contract', {
    contract: coordinator,
    method: VRF_INTERFACE.getSubscription,
    args: [subscriptionId],
    ...net.params,
  }, net.network))

  // Normalize the return value
  const balance = Array.isArray(sub) ? sub[0] : sub?.balance
  const nativeBalance = Array.isArray(sub) ? sub[1] : sub?.nativeBalance
  const reqCount = Array.isArray(sub) ? sub[2] : sub?.reqCount
  const owner = Array.isArray(sub) ? sub[3] : sub?.subOwner
  const consumers = Array.isArray(sub) ? sub[4] : sub?.consumers

  return {
    subscriptionId,
    chain,
    coordinator,
    balance: String(balance ?? '0'),
    nativeBalance: String(nativeBalance ?? '0'),
    requestCount: String(reqCount ?? '0'),
    owner: String(owner ?? ''),
    consumers: Array.isArray(consumers) ? consumers.map(String) : [],
  }
}

/**
 * Add a consumer contract to a VRF subscription.
 */
export async function vrfAddConsumer(subscriptionId, consumer, chain, { rpcUrl } = {}) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')
  if (!consumer) throw new ChainlinkError('MISSING_CONSUMER', 'consumer-contract is required')

  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)

  unwrapBridgeResult(await bridge.chain('ethereum', 'call-contract', {
    contract: coordinator,
    method: VRF_INTERFACE.addConsumer,
    args: [subscriptionId, consumer],
    ...net.params,
  }, net.network))

  return { subscriptionId, consumer, coordinator, chain }
}

/**
 * Request random words from VRF v2.5.
 */
export async function vrfRequest(
  chain,
  { subscriptionId, numWords = 1, callbackGasLimit = 100000, requestConfirmations = 3, rpcUrl } = {},
) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')

  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)
  const keyHash = lookupVrfKeyHash(chain)

  const requestId = unwrapBridgeResult(await bridge.chain('ethereum', 'call-contract', {
    contract: coordinator,
    method: VRF_INTERFACE.requestRandomWords,
    args: [
      keyHash,
      subscriptionId,
      requestConfirmations,
      callbackGasLimit,
      numWords,
      '0x', // extraArgs (empty = pay in LINK)
    ],
    ...net.params,
  }, net.network))

  return {
    requestId: String(requestId),
    subscriptionId,
    numWords,
    coordinator,
    chain,
  }
}

// ── Functions (Chainlink Functions) ────────────────────────────────

/**
 * Get a Chainlink Functions subscription.
 */
export async function functionsGetSubscription(subscriptionId, chain, { rpcUrl } = {}) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')

  const net = resolveNetwork(chain, rpcUrl)
  const router = lookupFunctionsRouter(chain)

  // Functions uses a different getSubscription signature than VRF
  const sub = unwrapBridgeResult(await bridge.chain('ethereum', 'read-contract', {
    contract: router,
    method:
      'function getSubscription(uint64 subscriptionId) external view returns (uint96 balance, address owner, uint64 blockedBalance, address[] memory consumers)',
    args: [subscriptionId],
    ...net.params,
  }, net.network))

  const balance = Array.isArray(sub) ? sub[0] : sub?.balance
  const owner = Array.isArray(sub) ? sub[1] : sub?.owner
  const consumers = Array.isArray(sub) ? sub[3] : sub?.consumers

  return {
    subscriptionId,
    chain,
    router,
    balance: String(balance ?? '0'),
    owner: String(owner ?? ''),
    consumers: Array.isArray(consumers) ? consumers.map(String) : [],
  }
}

// ── Internal helpers ───────────────────────────────────────────────

/**
 * Look up the VRF coordinator address for a chain.
 */
function lookupVrfCoordinator(chain) {
  const addr = VRF.coordinators[chain.toLowerCase()]
  if (!addr) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No VRF coordinator for chain "${chain}". Available: ${Object.keys(VRF.coordinators).join(', ')}`,
    )
  }
  return addr
}

/**
 * Look up the VRF key hash for a chain.
 */
function lookupVrfKeyHash(chain) {
  const hash = VRF.keyHashes[chain.toLowerCase()]
  if (!hash) {
    throw new ChainlinkError(
      'MISSING_KEY_HASH',
      `No VRF key hash registered for chain "${chain}". Available: ${Object.keys(VRF.keyHashes).join(', ')}`,
    )
  }
  return hash
}

/**
 * Look up the Functions router address for a chain.
 */
function lookupFunctionsRouter(chain) {
  const addr = FUNCTIONS.routers[chain.toLowerCase()]
  if (!addr) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No Functions router for chain "${chain}". Available: ${Object.keys(FUNCTIONS.routers).join(', ')}`,
    )
  }
  return addr
}

/**
 * Look up a PoR feed address from the registry.
 */
function lookupPorFeed(feed, chain) {
  const chainKey = chain.toLowerCase()
  const feedKey = feed.toUpperCase().replace(/\s/g, '')

  const chainFeeds = POR_FEEDS[chainKey]
  if (!chainFeeds) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No PoR feeds registered for chain "${chain}". Available chains: ${Object.keys(POR_FEEDS).join(', ')}`,
    )
  }

  const address = chainFeeds[feedKey]
  if (!address) {
    throw new ChainlinkError(
      'UNKNOWN_FEED',
      `No PoR feed found for "${feed}" on ${chain}. Available: ${Object.keys(chainFeeds).join(', ')}`,
    )
  }

  return address
}

/**
 * Look up the CCIP router address for a chain.
 */
function lookupCcipRouter(chain) {
  const router = CCIP.routers[chain.toLowerCase()]
  if (!router) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No CCIP router for chain "${chain}". Available: ${Object.keys(CCIP.routers).join(', ')}`,
    )
  }
  return router
}

/**
 * Look up the CCIP chain selector for a destination chain.
 */
function lookupCcipSelector(chain) {
  const selector = CCIP.chainSelectors[chain.toLowerCase()]
  if (!selector) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No CCIP selector for chain "${chain}". Available: ${Object.keys(CCIP.chainSelectors).join(', ')}`,
    )
  }
  return selector
}

/**
 * Resolve a fee token specifier to an address.
 * "native" or "" → address(0) — pay in native gas
 * "link" → the LINK token address for the source chain
 * Otherwise → treat as a raw address
 */
function resolveFeeToken(feeToken, sourceChain) {
  if (!feeToken || feeToken === 'native') return '0x0000000000000000000000000000000000000000'
  if (feeToken.toLowerCase() === 'link') {
    const addr = LINK_TOKENS[sourceChain.toLowerCase()]
    if (!addr) {
      throw new ChainlinkError(
        'UNKNOWN_LINK_TOKEN',
        `No LINK token address registered for ${sourceChain}`,
      )
    }
    return addr
  }
  return feeToken
}

/**
 * Build the CCIP EVM2AnyMessage struct for bridge calls.
 */
function buildCcipMessage(receiver, data, tokenAmounts, feeToken, _gasLimit) {
  return {
    receiver,
    data: data || '0x',
    tokenAmounts: tokenAmounts.map((ta) => ({ token: ta.token, amount: String(ta.amount) })),
    feeToken,
    extraArgs: '0x',
  }
}

/**
 * Look up a feed address from the registry.
 */
function lookupFeed(pair, chain) {
  const chainKey = chain.toLowerCase()
  const pairKey = pair.toUpperCase().replace(/\s/g, '')

  const chainFeeds = FEEDS[chainKey]
  if (!chainFeeds) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `No feeds registered for chain "${chain}". Available chains: ${Object.keys(FEEDS).join(', ')}`,
    )
  }

  const address = chainFeeds[pairKey]
  if (!address) {
    throw new ChainlinkError(
      'UNKNOWN_FEED',
      `No feed found for "${pair}" on ${chain}. Available feeds: ${Object.keys(chainFeeds).join(', ')}`,
    )
  }

  return address
}

/**
 * Parse the return value of latestRoundData().
 *
 * The bridge returns contract read results in different shapes depending
 * on the chain provider. This function normalizes the common cases:
 *   - Array/tuple: [roundId, answer, startedAt, updatedAt, answeredInRound]
 *   - Object with named fields
 *   - Raw hex that needs decoding
 */
function parseRoundData(raw, decimals) {
  let roundId, answer, updatedAt

  // The bridge may return:
  //   - A real JS array [roundId, answer, startedAt, updatedAt, answeredInRound]
  //   - A JSON-encoded string: '["val1","val2",...]'
  //   - An object with named fields
  //   - A raw hex string (when ABI decode failed)
  let data = raw
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      // Not JSON — treat as a single value
    }
  }

  if (Array.isArray(data)) {
    roundId = String(data[0])
    answer = String(data[1])
    updatedAt = String(data[3])
  } else if (data && typeof data === 'object') {
    roundId = String(data.roundId ?? data[0] ?? '0')
    answer = String(data.answer ?? data[1] ?? '0')
    updatedAt = String(data.updatedAt ?? data[3] ?? '0')
  } else {
    // Fallback: treat as a single value (the answer)
    roundId = '0'
    answer = String(data)
    updatedAt = '0'
  }

  // Convert the raw integer answer to a decimal price string.
  // Chainlink feeds return answer as an int256 scaled by 10^decimals.
  const negative = answer.startsWith('-')
  const absAnswer = negative ? answer.slice(1) : answer
  const padded = absAnswer.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals) || '0'
  const frac = padded.slice(-decimals)
  const price = `${negative ? '-' : ''}${whole}.${frac}`

  return {
    roundId,
    answerRaw: answer,
    price,
    updatedAt,
  }
}
