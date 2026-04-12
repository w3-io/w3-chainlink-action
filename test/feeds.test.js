/**
 * Price Feeds unit tests.
 *
 * These test the feed lookup, price parsing, and error handling
 * without making real bridge calls. The bridge.chain() function is
 * mocked to return canned responses.
 *
 * Unlike HTTP-based actions that mock global.fetch, this action mocks
 * the bridge namespace from @w3-io/action-core. The bridge is imported
 * as a module-level object, so we mock it by replacing its methods
 * before each test.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getPrice, getFeedInfo, listFeeds, ChainlinkError } from '../src/chainlink.js'

// Mock the bridge. The chainlink module imports { bridge } from
// '@w3-io/action-core'. We need to intercept bridge.chain() calls.
// Since the module caches the import, we mock via the same imported
// reference.

import { bridge } from '@w3-io/action-core'

let originalChain
let bridgeCalls

beforeEach(() => {
  originalChain = bridge.chain
  bridgeCalls = []
})

afterEach(() => {
  bridge.chain = originalChain
})

function mockBridge(responses) {
  let index = 0
  bridge.chain = async (chainType, operation, params) => {
    bridgeCalls.push({ chainType, operation, params })
    const response = responses[index++]
    if (!response) throw new Error(`Unexpected bridge call ${index}`)
    if (response.error) throw response.error
    return response.value
  }
}

// ── getPrice ────────────────────────────────────────────────────

describe('getPrice', () => {
  it('returns a formatted price from a Chainlink feed', async () => {
    mockBridge([
      // decimals() call
      { value: 8 },
      // latestRoundData() call
      {
        value: [
          '110680464442257310138', // roundId
          '190523000000', // answer (1905.23 with 8 decimals)
          '1712345678', // startedAt
          '1712345700', // updatedAt
          '110680464442257310138', // answeredInRound
        ],
      },
    ])

    const result = await getPrice('ETH/USD', 'ethereum')

    assert.equal(result.pair, 'ETH/USD')
    assert.equal(result.chain, 'ethereum')
    assert.equal(result.price, '1905.23000000')
    assert.equal(result.priceRaw, '190523000000')
    assert.equal(result.decimals, 8)
    assert.equal(result.roundId, '110680464442257310138')
    assert.equal(result.feedAddress, '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419')
  })

  it('reads from the correct contract address for each pair + chain', async () => {
    mockBridge([{ value: 8 }, { value: ['0', '300000000000', '0', '0', '0'] }])

    await getPrice('BTC/USD', 'sepolia')

    assert.equal(
      bridgeCalls[0].params.contractAddress,
      '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43',
    )
  })

  it('throws MISSING_PAIR when pair is empty', async () => {
    await assert.rejects(
      () => getPrice('', 'ethereum'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_PAIR',
    )
  })

  it('throws MISSING_CHAIN when chain is empty', async () => {
    await assert.rejects(
      () => getPrice('ETH/USD', ''),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CHAIN',
    )
  })

  it('throws UNSUPPORTED_CHAIN for an unknown chain', async () => {
    await assert.rejects(
      () => getPrice('ETH/USD', 'solana'),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })

  it('throws UNKNOWN_FEED for an unregistered pair', async () => {
    await assert.rejects(
      () => getPrice('FOO/BAR', 'ethereum'),
      (err) => err instanceof ChainlinkError && err.code === 'UNKNOWN_FEED',
    )
  })

  it('normalizes pair casing and spacing', async () => {
    mockBridge([{ value: 8 }, { value: ['0', '190000000000', '0', '0', '0'] }])

    const result = await getPrice('eth/usd', 'Ethereum')
    assert.equal(result.pair, 'eth/usd')
    assert.ok(result.price)
  })

  it('handles object-shaped return from the bridge', async () => {
    mockBridge([
      { value: 8 },
      {
        value: {
          roundId: '123',
          answer: '250000000000',
          startedAt: '1700000000',
          updatedAt: '1700000100',
          answeredInRound: '123',
        },
      },
    ])

    const result = await getPrice('ETH/USD', 'ethereum')
    assert.equal(result.price, '2500.00000000')
  })
})

// ── getFeedInfo ─────────────────────────────────────────────────

describe('getFeedInfo', () => {
  it('returns the feed description and decimals', async () => {
    mockBridge([
      // description() and decimals() are called in parallel
      { value: 'ETH / USD' },
      { value: 8 },
    ])

    const result = await getFeedInfo('ETH/USD', 'ethereum')

    assert.equal(result.pair, 'ETH/USD')
    assert.equal(result.chain, 'ethereum')
    assert.equal(result.description, 'ETH / USD')
    assert.equal(result.decimals, 8)
    assert.equal(result.feedAddress, '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419')
  })
})

// ── listFeeds ───────────────────────────────────────────────────

describe('listFeeds', () => {
  it('returns all registered feeds for a chain', () => {
    const result = listFeeds('sepolia')

    assert.ok(Array.isArray(result.feeds))
    assert.ok(result.feeds.length >= 3) // ETH, BTC, LINK at minimum
    assert.equal(result.chain, 'sepolia')
    assert.equal(result.count, result.feeds.length)

    const ethFeed = result.feeds.find((f) => f.pair === 'ETH/USD')
    assert.ok(ethFeed)
    assert.equal(ethFeed.address, '0x694AA1769357215DE4FAC081bf1f309aDC325306')
  })

  it('throws UNSUPPORTED_CHAIN for an unknown chain', () => {
    assert.throws(
      () => listFeeds('solana'),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })

  it('throws MISSING_CHAIN when chain is empty', () => {
    assert.throws(
      () => listFeeds(''),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CHAIN',
    )
  })
})
