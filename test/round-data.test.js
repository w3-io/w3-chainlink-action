/**
 * get-round-data unit tests.
 *
 * Verify that getRoundData fetches historical price data by round ID
 * and supports the feedAddress bypass.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getRoundData, ChainlinkError } from '../src/chainlink.js'
import { FEED_INTERFACE } from '../src/registry.js'
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

describe('getRoundData', () => {
  it('returns historical price data for a given round ID', async () => {
    mockBridge([
      // decimals() call
      { value: 8 },
      // getRoundData(roundId) call
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

    const result = await getRoundData('ETH/USD', 'ethereum', {
      roundId: '110680464442257310138',
    })

    assert.equal(result.pair, 'ETH/USD')
    assert.equal(result.chain, 'ethereum')
    assert.equal(result.price, '1905.23000000')
    assert.equal(result.priceRaw, '190523000000')
    assert.equal(result.decimals, 8)
    assert.equal(result.roundId, '110680464442257310138')
    assert.equal(result.updatedAt, '1712345700')
    assert.equal(result.feedAddress, '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419')
  })

  it('passes the round ID to the getRoundData ABI method', async () => {
    mockBridge([{ value: 8 }, { value: ['42', '300000000000', '0', '1700000000', '42'] }])

    await getRoundData('BTC/USD', 'sepolia', { roundId: '42' })

    // Second call should be getRoundData with the round ID arg
    assert.equal(bridgeCalls[1].params.method, FEED_INTERFACE.getRoundData)
    assert.deepEqual(bridgeCalls[1].params.args, ['42'])
  })

  it('uses feedAddress bypass when provided', async () => {
    const customAddress = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    mockBridge([{ value: 18 }, { value: ['1', '1000000000000000000', '0', '1700000000', '1'] }])

    const result = await getRoundData('UNLISTED/USD', 'ethereum', {
      roundId: '1',
      feedAddress: customAddress,
    })

    assert.equal(bridgeCalls[0].params.contract, customAddress)
    assert.equal(bridgeCalls[1].params.contract, customAddress)
    assert.equal(result.feedAddress, customAddress)
  })

  it('throws MISSING_PAIR when pair is empty', async () => {
    await assert.rejects(
      () => getRoundData('', 'ethereum', { roundId: '1' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_PAIR',
    )
  })

  it('throws MISSING_ROUND_ID when roundId is missing', async () => {
    await assert.rejects(
      () => getRoundData('ETH/USD', 'ethereum', {}),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_ROUND_ID',
    )
  })

  it('throws MISSING_CHAIN when chain is empty', async () => {
    await assert.rejects(
      () => getRoundData('ETH/USD', '', { roundId: '1' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CHAIN',
    )
  })

  it('throws UNKNOWN_FEED for unregistered pair without feedAddress', async () => {
    await assert.rejects(
      () => getRoundData('FOO/BAR', 'ethereum', { roundId: '1' }),
      (err) => err instanceof ChainlinkError && err.code === 'UNKNOWN_FEED',
    )
  })

  it('handles object-shaped return from the bridge', async () => {
    mockBridge([
      { value: 8 },
      {
        value: {
          roundId: '99',
          answer: '250000000000',
          startedAt: '1700000000',
          updatedAt: '1700000100',
          answeredInRound: '99',
        },
      },
    ])

    const result = await getRoundData('ETH/USD', 'ethereum', { roundId: '99' })
    assert.equal(result.price, '2500.00000000')
    assert.equal(result.roundId, '99')
  })
})
