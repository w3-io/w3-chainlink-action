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
 * Resolve a chain name to its network identifier for the bridge.
 * Accepts both common names ("ethereum", "sepolia") and chain IDs.
 */
function resolveNetwork(chain) {
  if (!chain) {
    throw new ChainlinkError('MISSING_CHAIN', 'chain is required')
  }
  const network = NETWORKS[chain.toLowerCase()]
  if (!network) {
    throw new ChainlinkError(
      'UNSUPPORTED_CHAIN',
      `Chain "${chain}" is not supported. Available: ${Object.keys(NETWORKS).join(', ')}`,
    )
  }
  return network
}

// ── Price Feeds ────────────────────────────────────────────────────

/**
 * Get the latest price from a Chainlink Data Feed.
 *
 * @param {string} pair - e.g. "ETH/USD"
 * @param {string} chain - e.g. "ethereum", "sepolia", "base"
 * @returns {{ pair, chain, price, decimals, roundId, updatedAt, raw }}
 */
export async function getPrice(pair, chain) {
  if (!pair) throw new ChainlinkError('MISSING_PAIR', 'pair is required (e.g. "ETH/USD")')

  const net = resolveNetwork(chain)
  const feedAddress = lookupFeed(pair, chain)

  // Read decimals first so we can format the answer
  const decimalsResult = await bridge.chain('ethereum', 'read-contract', {
    contractAddress: feedAddress,
    functionSignature: FEED_INTERFACE.decimals,
    args: '[]',
    ...net.bridgeParams,
  })
  const feedDecimals = parseInt(decimalsResult, 10)

  // Read latest round data
  const roundData = await bridge.chain('ethereum', 'read-contract', {
    contractAddress: feedAddress,
    functionSignature: FEED_INTERFACE.latestRoundData,
    args: '[]',
    ...net.bridgeParams,
  })

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
export async function getFeedInfo(pair, chain) {
  if (!pair) throw new ChainlinkError('MISSING_PAIR', 'pair is required')

  const net = resolveNetwork(chain)
  const feedAddress = lookupFeed(pair, chain)

  const [description, decimalsResult] = await Promise.all([
    bridge.chain('ethereum', 'read-contract', {
      contractAddress: feedAddress,
      functionSignature: FEED_INTERFACE.description,
      args: '[]',
      ...net.bridgeParams,
    }),
    bridge.chain('ethereum', 'read-contract', {
      contractAddress: feedAddress,
      functionSignature: FEED_INTERFACE.decimals,
      args: '[]',
      ...net.bridgeParams,
    }),
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
export async function getReserves(feed, chain) {
  if (!feed) throw new ChainlinkError('MISSING_FEED', 'feed is required (e.g. "WBTC/BTC")')

  const net = resolveNetwork(chain)
  const feedAddress = lookupPorFeed(feed, chain)

  const [decimalsResult, roundData, description] = await Promise.all([
    bridge.chain('ethereum', 'read-contract', {
      contractAddress: feedAddress,
      functionSignature: FEED_INTERFACE.decimals,
      args: '[]',
      ...net.bridgeParams,
    }),
    bridge.chain('ethereum', 'read-contract', {
      contractAddress: feedAddress,
      functionSignature: FEED_INTERFACE.latestRoundData,
      args: '[]',
      ...net.bridgeParams,
    }),
    bridge.chain('ethereum', 'read-contract', {
      contractAddress: feedAddress,
      functionSignature: FEED_INTERFACE.description,
      args: '[]',
      ...net.bridgeParams,
    }),
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
  { receiver, tokenAmounts = [], data = '0x', feeToken = 'native' } = {},
) {
  if (!sourceChain) throw new ChainlinkError('MISSING_SOURCE_CHAIN', 'source-chain is required')
  if (!destinationChain)
    throw new ChainlinkError('MISSING_DESTINATION_CHAIN', 'destination-chain is required')
  if (!receiver) throw new ChainlinkError('MISSING_RECEIVER', 'receiver is required')

  const srcNet = resolveNetwork(sourceChain)
  const router = lookupCcipRouter(sourceChain)
  const destSelector = lookupCcipSelector(destinationChain)
  const resolvedFeeToken = resolveFeeToken(feeToken, sourceChain)

  // Build the EVM2AnyMessage struct
  const message = buildCcipMessage(receiver, data, tokenAmounts, resolvedFeeToken)

  const fee = await bridge.chain('ethereum', 'read-contract', {
    contractAddress: router,
    functionSignature: CCIP_INTERFACE.getFee,
    args: JSON.stringify([destSelector, message]),
    ...srcNet.bridgeParams,
  })

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
  { receiver, tokenAmounts = [], data = '0x', feeToken = 'native', gasLimit = '200000' } = {},
) {
  if (!sourceChain) throw new ChainlinkError('MISSING_SOURCE_CHAIN', 'source-chain is required')
  if (!destinationChain)
    throw new ChainlinkError('MISSING_DESTINATION_CHAIN', 'destination-chain is required')
  if (!receiver) throw new ChainlinkError('MISSING_RECEIVER', 'receiver is required')

  const srcNet = resolveNetwork(sourceChain)
  const router = lookupCcipRouter(sourceChain)
  const destSelector = lookupCcipSelector(destinationChain)
  const resolvedFeeToken = resolveFeeToken(feeToken, sourceChain)

  const message = buildCcipMessage(receiver, data, tokenAmounts, resolvedFeeToken, gasLimit)

  const messageId = await bridge.chain('ethereum', 'call-contract', {
    contractAddress: router,
    functionSignature: CCIP_INTERFACE.ccipSend,
    args: JSON.stringify([destSelector, message]),
    ...srcNet.bridgeParams,
  })

  return {
    status: 'sent',
    messageId: String(messageId),
    sourceChain,
    destinationChain,
    router,
    destinationSelector: destSelector,
  }
}

// ── Internal helpers ───────────────────────────────────────────────

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

  if (Array.isArray(raw)) {
    roundId = String(raw[0])
    answer = String(raw[1])
    updatedAt = String(raw[3])
  } else if (raw && typeof raw === 'object') {
    roundId = String(raw.roundId ?? raw[0] ?? '0')
    answer = String(raw.answer ?? raw[1] ?? '0')
    updatedAt = String(raw.updatedAt ?? raw[3] ?? '0')
  } else {
    // Fallback: treat as a single value (the answer)
    roundId = '0'
    answer = String(raw)
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
