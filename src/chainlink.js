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

import { createHash, createHmac } from 'node:crypto'
import { W3ActionError, bridge } from '@w3-io/action-core'
import {
  FEEDS,
  FEED_INTERFACE,
  NETWORKS,
  POR_FEEDS,
  CCIP,
  CCIP_ABI,
  CCIP_INTERFACE,
  LINK_TOKENS,
  VRF,
  VRF_INTERFACE,
  VRF_GET_SUBSCRIPTION_ABI,
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
      throw new ChainlinkError(result.code || 'BRIDGE_ERROR', result.error || 'Bridge call failed')
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
  const decimalsResult = unwrapBridgeResult(
    await bridge.chain(
      'ethereum',
      'read-contract',
      {
        contract: feedAddress,
        method: FEED_INTERFACE.decimals,
        args: [],
        ...net.params,
      },
      net.network,
    ),
  )
  const feedDecimals = parseInt(decimalsResult, 10)

  // Read latest round data
  const roundData = unwrapBridgeResult(
    await bridge.chain(
      'ethereum',
      'read-contract',
      {
        contract: feedAddress,
        method: FEED_INTERFACE.latestRoundData,
        args: [],
        ...net.params,
      },
      net.network,
    ),
  )

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
    bridge
      .chain(
        'ethereum',
        'read-contract',
        {
          contract: feedAddress,
          method: FEED_INTERFACE.description,
          args: [],
          ...net.params,
        },
        net.network,
      )
      .then(unwrapBridgeResult),
    bridge
      .chain(
        'ethereum',
        'read-contract',
        {
          contract: feedAddress,
          method: FEED_INTERFACE.decimals,
          args: [],
          ...net.params,
        },
        net.network,
      )
      .then(unwrapBridgeResult),
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
    bridge
      .chain(
        'ethereum',
        'read-contract',
        {
          contract: feedAddress,
          method: FEED_INTERFACE.decimals,
          args: [],
          ...net.params,
        },
        net.network,
      )
      .then(unwrapBridgeResult),
    bridge
      .chain(
        'ethereum',
        'read-contract',
        {
          contract: feedAddress,
          method: FEED_INTERFACE.latestRoundData,
          args: [],
          ...net.params,
        },
        net.network,
      )
      .then(unwrapBridgeResult),
    bridge
      .chain(
        'ethereum',
        'read-contract',
        {
          contract: feedAddress,
          method: FEED_INTERFACE.description,
          args: [],
          ...net.params,
        },
        net.network,
      )
      .then(unwrapBridgeResult),
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

  const fee = unwrapBridgeResult(
    await bridge.chain(
      'ethereum',
      'read-contract',
      {
        contract: router,
        method: CCIP_INTERFACE.getFee,
        abi: CCIP_ABI,
        args: [destSelector, message],
        ...srcNet.params,
      },
      srcNet.network,
    ),
  )

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
  {
    receiver,
    tokenAmounts = [],
    data = '0x',
    feeToken = 'native',
    gasLimit = '200000',
    rpcUrl,
  } = {},
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

  // For native fee payment, estimate the fee first and send as msg.value
  let value
  if (resolvedFeeToken === '0x0000000000000000000000000000000000000000') {
    const fee = unwrapBridgeResult(
      await bridge.chain(
        'ethereum',
        'read-contract',
        {
          contract: router,
          method: CCIP_INTERFACE.getFee,
          abi: CCIP_ABI,
          args: [destSelector, message],
          ...srcNet.params,
        },
        srcNet.network,
      ),
    )
    // Add 10% buffer for fee fluctuation
    value = String(BigInt(fee) + BigInt(fee) / 10n)
  }

  // Unwrap the bridge response. `unwrapBridgeResult` throws on
  // {ok: false}, otherwise returns the inner {txHash, ...} object.
  // Without this, extractTxHash sees the envelope and falls through
  // to String(receipt) -> "[object Object]".
  const receipt = unwrapBridgeResult(
    await bridge.chain(
      'ethereum',
      'call-contract',
      {
        contract: router,
        method: CCIP_INTERFACE.ccipSend,
        abi: CCIP_ABI,
        args: [destSelector, message],
        ...(value ? { value } : {}),
        ...srcNet.params,
      },
      srcNet.network,
    ),
  )

  return {
    status: 'sent',
    txHash: extractTxHash(receipt),
    fee: value || '0',
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

  const receipt = await bridge.chain(
    'ethereum',
    'call-contract',
    {
      contract: coordinator,
      method: VRF_INTERFACE.createSubscription,
      args: [],
      ...net.params,
    },
    net.network,
  )

  // call-contract returns a tx receipt. Parse the subscription ID from
  // the SubscriptionCreated event log or fall back to the tx hash.
  const subId = parseSubscriptionIdFromReceipt(receipt)

  return {
    subscriptionId: subId,
    txHash: extractTxHash(receipt),
    coordinator,
    chain,
  }
}

/**
 * Get VRF subscription details.
 */
export async function vrfGetSubscription(subscriptionId, chain, { rpcUrl } = {}) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')

  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)

  const sub = unwrapBridgeResult(
    await bridge.chain(
      'ethereum',
      'read-contract',
      {
        contract: coordinator,
        method: VRF_INTERFACE.getSubscription,
        // Pass the full ABI JSON — the signature-only form trips the
        // alloy decoder on the dynamic `address[] consumers` return.
        abi: VRF_GET_SUBSCRIPTION_ABI,
        args: [subscriptionId],
        ...net.params,
      },
      net.network,
    ),
  )

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

  const receipt = await bridge.chain(
    'ethereum',
    'call-contract',
    {
      contract: coordinator,
      method: VRF_INTERFACE.addConsumer,
      args: [subscriptionId, consumer],
      ...net.params,
    },
    net.network,
  )

  return {
    subscriptionId,
    consumer,
    txHash: extractTxHash(receipt),
    coordinator,
    chain,
  }
}

/**
 * Fund a VRF subscription with native ETH.
 *
 * Uses fundSubscriptionWithNative — avoids the ERC20 approve dance.
 * The value (in wei) is sent as msg.value.
 */
export async function vrfFundSubscription(subscriptionId, chain, { amount, rpcUrl } = {}) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')
  if (!amount) throw new ChainlinkError('MISSING_AMOUNT', 'amount is required (in wei)')

  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)

  const receipt = await bridge.chain(
    'ethereum',
    'call-contract',
    {
      contract: coordinator,
      method: VRF_INTERFACE.fundSubscription,
      args: [subscriptionId],
      value: amount,
      ...net.params,
    },
    net.network,
  )

  return {
    subscriptionId,
    amount,
    txHash: extractTxHash(receipt),
    coordinator,
    chain,
  }
}

/**
 * Request random words from VRF v2.5.
 */
export async function vrfRequest(
  chain,
  {
    subscriptionId,
    numWords = 1,
    callbackGasLimit = 100000,
    requestConfirmations = 3,
    rpcUrl,
  } = {},
) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')

  const net = resolveNetwork(chain, rpcUrl)
  const coordinator = lookupVrfCoordinator(chain)
  const keyHash = lookupVrfKeyHash(chain)

  const receipt = await bridge.chain(
    'ethereum',
    'call-contract',
    {
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
    },
    net.network,
  )

  return {
    txHash: extractTxHash(receipt),
    subscriptionId,
    numWords,
    coordinator,
    chain,
  }
}

// ── Functions (Chainlink Functions) ────────────────────────────────

/**
 * Create a Chainlink Functions subscription.
 */
export async function functionsCreateSubscription(chain, { rpcUrl } = {}) {
  const net = resolveNetwork(chain, rpcUrl)
  const router = lookupFunctionsRouter(chain)

  const receipt = await bridge.chain(
    'ethereum',
    'call-contract',
    {
      contract: router,
      method: 'function createSubscription() returns (uint64)',
      args: [],
      ...net.params,
    },
    net.network,
  )

  // Parse subscription ID from SubscriptionCreated event
  const subId = parseSubscriptionIdFromReceipt(receipt)

  return {
    subscriptionId: subId,
    txHash: extractTxHash(receipt),
    router,
    chain,
  }
}

/**
 * Get a Chainlink Functions subscription.
 */
export async function functionsGetSubscription(subscriptionId, chain, { rpcUrl } = {}) {
  if (!subscriptionId)
    throw new ChainlinkError('MISSING_SUBSCRIPTION_ID', 'subscription-id is required')

  const net = resolveNetwork(chain, rpcUrl)
  const router = lookupFunctionsRouter(chain)

  // Functions Router v1.2 returns a Subscription struct.
  // Use the full ABI to handle tuple return type properly.
  const sub = unwrapBridgeResult(
    await bridge.chain(
      'ethereum',
      'read-contract',
      {
        contract: router,
        method: 'getSubscription',
        abi: JSON.stringify([
          {
            name: 'getSubscription',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'subscriptionId', type: 'uint64' }],
            outputs: [
              {
                name: 'subscription',
                type: 'tuple',
                components: [
                  { name: 'balance', type: 'uint96' },
                  { name: 'owner', type: 'address' },
                  { name: 'blockedBalance', type: 'uint96' },
                  { name: 'proposedOwner', type: 'address' },
                  { name: 'consumers', type: 'address[]' },
                  { name: 'flags', type: 'bytes32' },
                ],
              },
            ],
          },
        ]),
        args: [subscriptionId],
        ...net.params,
      },
      net.network,
    ),
  )

  // Bridge returns the tuple as a JSON array
  let data = sub
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      /* use as-is */
    }
  }
  const balance = Array.isArray(data) ? data[0] : data?.balance
  const owner = Array.isArray(data) ? data[1] : data?.owner
  const consumers = Array.isArray(data) ? data[4] : data?.consumers

  return {
    subscriptionId,
    chain,
    router,
    balance: String(balance ?? '0'),
    owner: String(owner ?? ''),
    consumers: Array.isArray(consumers) ? consumers.map(String) : [],
  }
}

// ── Data Streams (REST, not bridge) ────────────────────────────────
//
// Chainlink Data Streams is a pull-based REST API for high-frequency
// market data, distinct from on-chain Price Feeds. Reports are signed
// blobs that can be verified on-chain later. Access is gated behind
// Chainlink's onboarding (client ID + client secret).
//
// Endpoints (source: smartcontractkit/data-streams-sdk):
//   GET /api/v1/feeds            — list available feeds
//   GET /api/v1/reports/latest?feedID=0x…   — latest report for a feed
//   GET /api/v1/reports?feedID=0x…&timestamp=…  — report at/near ts
//
// Auth: three headers.
//   Authorization                       : <client ID>
//   X-Authorization-Timestamp           : <ms since epoch>
//   X-Authorization-Signature-SHA256    : HMAC-SHA256 of
//       "<METHOD> <path?query> <sha256(body)> <client_id> <ts>"
//     using the client secret as the HMAC key. Empty string hash is
//     used for bodyless GETs.

const DEFAULT_STREAMS_API = 'https://api.dataengine.chain.link'
// Testnet endpoint for reference — callers override via `streams-api-url`:
//   https://api.testnet-dataengine.chain.link

function streamsAuthHeaders(clientId, clientSecret, method, url, body = '') {
  const parsed = new URL(url)
  const pathWithQuery = parsed.pathname + parsed.search
  const ts = Date.now()
  const bodyHash = sha256Hex(body)
  const stringToSign = `${method} ${pathWithQuery} ${bodyHash} ${clientId} ${ts}`
  const signature = hmacSha256Hex(clientSecret, stringToSign)
  return {
    Authorization: clientId,
    'X-Authorization-Timestamp': String(ts),
    'X-Authorization-Signature-SHA256': signature,
  }
}

async function streamsRequest({ clientId, clientSecret, apiUrl = DEFAULT_STREAMS_API, path }) {
  if (!clientId) {
    throw new ChainlinkError('MISSING_STREAMS_CLIENT_ID', 'streams-client-id is required')
  }
  if (!clientSecret) {
    throw new ChainlinkError('MISSING_STREAMS_CLIENT_SECRET', 'streams-client-secret is required')
  }
  const url = apiUrl.replace(/\/+$/, '') + path
  const headers = streamsAuthHeaders(clientId, clientSecret, 'GET', url)
  const res = await fetch(url, { method: 'GET', headers })
  const text = await res.text()
  if (!res.ok) {
    throw new ChainlinkError(
      'STREAMS_API_ERROR',
      `Data Streams API ${res.status}: ${text.slice(0, 300)}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ChainlinkError(
      'STREAMS_PARSE_ERROR',
      `Invalid JSON from Data Streams: ${text.slice(0, 200)}`,
    )
  }
}

/**
 * List all available Data Streams feeds.
 *
 * @param {object} options
 * @param {string} options.clientId - Chainlink-issued client ID
 * @param {string} options.clientSecret - Chainlink-issued client secret
 * @param {string} [options.apiUrl] - Override the default API URL (e.g. use
 *                                    `api.testnet-dataengine.chain.link` for testnet)
 * @returns {{feeds: Array}} List of feed metadata objects
 */
export async function streamsListFeeds({ clientId, clientSecret, apiUrl } = {}) {
  return streamsRequest({
    clientId,
    clientSecret,
    apiUrl,
    path: '/api/v1/feeds',
  })
}

/**
 * Fetch the latest report, or a specific report by timestamp, for a feed.
 *
 * @param {string} feedId - Hex-encoded feed ID (0x…)
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {number} [options.timestamp] - If set, fetch the report valid at this
 *                                        UNIX timestamp (seconds). Omit for latest.
 * @param {string} [options.apiUrl]
 */
export async function streamsFetchReport(
  feedId,
  { clientId, clientSecret, timestamp, apiUrl } = {},
) {
  if (!feedId) {
    throw new ChainlinkError('MISSING_FEED_ID', 'feed-id is required (e.g. "0x0003...")')
  }
  const encoded = encodeURIComponent(feedId)
  const path =
    timestamp == null
      ? `/api/v1/reports/latest?feedID=${encoded}`
      : `/api/v1/reports?feedID=${encoded}&timestamp=${timestamp}`
  return streamsRequest({ clientId, clientSecret, apiUrl, path })
}

// ── Internal helpers ───────────────────────────────────────────────

/**
 * Parse the subscription ID from a VRF createSubscription receipt.
 *
 * The coordinator emits SubscriptionCreated(uint256 subId, address owner).
 * Topic[0] = keccak256("SubscriptionCreated(uint256,address)")
 * Topic[1] = subId (indexed)
 */
function parseSubscriptionIdFromReceipt(receipt) {
  // The bridge may return a nested JSON string or a plain object.
  let rx = receipt
  if (typeof rx === 'string') {
    try {
      rx = JSON.parse(rx)
    } catch {
      return rx
    }
  }
  // Unwrap bridge envelope
  if (rx?.ok && rx?.logs) rx = { ...rx, logs_json: rx.logs }

  const logs = rx?.logs_json || rx?.logs || rx?.logsJson
  if (logs) {
    const logArr = typeof logs === 'string' ? JSON.parse(logs) : logs
    // VRF v2.5 SubscriptionCreated event — topic[1] is the subId
    // Accept any event with 2 topics from the coordinator address
    for (const log of logArr) {
      const topics = log.topics || []
      if (topics.length >= 2 && topics[1]) {
        return BigInt(topics[1]).toString()
      }
    }
  }
  // Fallback: return the tx hash or stringified receipt
  return rx?.txHash || rx?.tx_hash || JSON.stringify(receipt)
}

/**
 * Extract tx hash from a bridge call-contract receipt.
 *
 * The bridge may return:
 *   - A plain string (tx hash)
 *   - An object { ok, txHash, blockNumber, gasUsed, status, logs }
 *   - A nested JSON string of the above
 */
function extractTxHash(receipt) {
  let rx = receipt
  if (typeof rx === 'string') {
    try {
      rx = JSON.parse(rx)
    } catch {
      return rx
    }
  }
  // Different bridge versions have returned the hash under different
  // keys. Check the known aliases before falling back to stringifying
  // the whole response (which produces "[object Object]" and is
  // always wrong).
  return (
    rx?.txHash ||
    rx?.transactionHash ||
    rx?.tx_hash ||
    rx?.transactionId ||
    rx?.signature ||
    rx?.result?.txHash ||
    rx?.result?.transactionHash ||
    null
  )
}

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
 *
 * The bridge expects tuple arguments as JSON arrays, not
 * parenthesized coerce_str strings. The previous encoding produced
 * `(val1, val2, ...)` which alloy's parser rejected with "Expected a
 * JSON array for tuple argument." Return arrays directly and let the
 * bridge's JSON serializer hand them off to alloy's
 * `DynSolValue::CustomStruct` deserializer.
 *
 * Shape of EVM2AnyMessage (from Client.sol):
 *
 *   struct EVM2AnyMessage {
 *     bytes receiver;              // ABI-encoded destination address
 *     bytes data;                  // arbitrary payload
 *     EVMTokenAmount[] tokenAmounts;
 *     address feeToken;            // address(0) => native
 *     bytes extraArgs;             // `0x` defaults; populate for
 *                                  // gas-limit / strict hooks.
 *   }
 *
 *   struct EVMTokenAmount {
 *     address token;
 *     uint256 amount;
 *   }
 */
function buildCcipMessage(receiver, data, tokenAmounts, feeToken, _gasLimit) {
  // CCIP receiver is bytes — ABI-encode the 20-byte address to 32 bytes.
  const encodedReceiver = '0x' + receiver.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  return [
    encodedReceiver,
    data || '0x',
    tokenAmounts.map((ta) => [ta.token, ta.amount]),
    feeToken,
    '0x',
  ]
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

/** sha256 of a string, hex-encoded. Used for the Data Streams body hash. */
function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex')
}

/** HMAC-SHA256 of a message, hex-encoded. Used for the Data Streams signature. */
function hmacSha256Hex(key, message) {
  return createHmac('sha256', key).update(message).digest('hex')
}
