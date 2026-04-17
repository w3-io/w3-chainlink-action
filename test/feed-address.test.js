/**
 * feed-address bypass unit tests.
 *
 * Verify that getPrice and getFeedInfo use the provided feedAddress
 * directly instead of looking up the pair in the registry.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getPrice, getFeedInfo, ChainlinkError } from '../src/chainlink.js'
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

describe('feed-address bypass', () => {
  describe('getPrice with feedAddress', () => {
    it('uses the provided feedAddress instead of registry lookup', async () => {
      const customAddress = '0x1111111111111111111111111111111111111111'
      mockBridge([{ value: 8 }, { value: ['0', '190523000000', '0', '1712345700', '0'] }])

      const result = await getPrice('CUSTOM/USD', 'ethereum', {
        feedAddress: customAddress,
      })

      // Both bridge calls should target the custom address
      assert.equal(bridgeCalls[0].params.contract, customAddress)
      assert.equal(bridgeCalls[1].params.contract, customAddress)
      assert.equal(result.feedAddress, customAddress)
      assert.equal(result.price, '1905.23000000')
    })

    it('skips registry lookup for unlisted pairs when feedAddress is provided', async () => {
      const customAddress = '0x2222222222222222222222222222222222222222'
      mockBridge([{ value: 18 }, { value: ['1', '1000000000000000000', '0', '1700000000', '1'] }])

      // FOO/BAR is not in the registry, but feedAddress bypasses the lookup
      const result = await getPrice('FOO/BAR', 'ethereum', {
        feedAddress: customAddress,
      })

      assert.equal(result.pair, 'FOO/BAR')
      assert.equal(result.feedAddress, customAddress)
    })

    it('falls back to registry when feedAddress is not provided', async () => {
      mockBridge([{ value: 8 }, { value: ['0', '190523000000', '0', '1712345700', '0'] }])

      const result = await getPrice('ETH/USD', 'ethereum')

      // Should use the registry address for ETH/USD on ethereum
      assert.equal(bridgeCalls[0].params.contract, '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419')
      assert.equal(result.feedAddress, '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419')
    })
  })

  describe('getFeedInfo with feedAddress', () => {
    it('uses the provided feedAddress instead of registry lookup', async () => {
      const customAddress = '0x3333333333333333333333333333333333333333'
      mockBridge([{ value: 'CUSTOM / USD' }, { value: 18 }])

      const result = await getFeedInfo('CUSTOM/USD', 'ethereum', {
        feedAddress: customAddress,
      })

      assert.equal(bridgeCalls[0].params.contract, customAddress)
      assert.equal(bridgeCalls[1].params.contract, customAddress)
      assert.equal(result.feedAddress, customAddress)
      assert.equal(result.description, 'CUSTOM / USD')
      assert.equal(result.decimals, 18)
    })

    it('skips registry for unlisted pairs when feedAddress is provided', async () => {
      const customAddress = '0x4444444444444444444444444444444444444444'
      mockBridge([{ value: 'BAZ / QUX' }, { value: 6 }])

      const result = await getFeedInfo('BAZ/QUX', 'ethereum', {
        feedAddress: customAddress,
      })

      assert.equal(result.pair, 'BAZ/QUX')
      assert.equal(result.feedAddress, customAddress)
    })
  })
})
