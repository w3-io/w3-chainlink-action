/**
 * Proof of Reserve unit tests.
 *
 * Same interface as price feeds but for reserve data. The answer
 * represents total reserves rather than a price.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getReserves, ChainlinkError } from '../src/chainlink.js'
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
    return response.value
  }
}

describe('getReserves', () => {
  it('returns reserve data from a PoR feed', async () => {
    mockBridge([
      { value: 8 }, // decimals
      { value: ['1', '2100000000000000', '0', '1712345700', '1'] }, // latestRoundData
      { value: 'Reserves: BTC [WBTC]' }, // description
    ])

    const result = await getReserves('WBTC/BTC', 'ethereum')

    assert.equal(result.feed, 'WBTC/BTC')
    assert.equal(result.chain, 'ethereum')
    assert.equal(result.reserves, '21000000.00000000')
    assert.equal(result.reservesRaw, '2100000000000000')
    assert.equal(result.decimals, 8)
    assert.equal(result.description, 'Reserves: BTC [WBTC]')
    assert.equal(result.feedAddress, '0xa81FE04086865e63E12dD3776978E49DEEa2ea4e')
  })

  it('throws MISSING_FEED when feed is empty', async () => {
    await assert.rejects(
      () => getReserves('', 'ethereum'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_FEED',
    )
  })

  it('throws UNKNOWN_FEED for an unregistered PoR feed', async () => {
    await assert.rejects(
      () => getReserves('FOO/BAR', 'ethereum'),
      (err) => err instanceof ChainlinkError && err.code === 'UNKNOWN_FEED',
    )
  })
})
