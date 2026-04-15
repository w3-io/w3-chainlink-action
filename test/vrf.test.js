/**
 * VRF unit tests.
 *
 * Tests subscription management, random word requests, and
 * coordinator/key hash lookups.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  vrfCreateSubscription,
  vrfGetSubscription,
  vrfAddConsumer,
  vrfRequest,
  ChainlinkError,
} from '../src/chainlink.js'
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

describe('vrfCreateSubscription', () => {
  it('calls createSubscription on the coordinator and returns the subId', async () => {
    // Mock a receipt with SubscriptionCreated event log
    const subCreatedTopic = '0x464722b4166576d3dcbba877b999bc35cf911f4eaf434b7eba68fa113951d0d7'
    const subIdTopic = '0x000000000000000000000000000000000000000000000000000000000000002a' // 42
    mockBridge([
      {
        value: {
          tx_hash: '0xabc123',
          logs_json: JSON.stringify([{ topics: [subCreatedTopic, subIdTopic] }]),
        },
      },
    ])

    const result = await vrfCreateSubscription('sepolia')

    assert.equal(result.subscriptionId, '42')
    assert.equal(result.txHash, '0xabc123')
    assert.equal(result.coordinator, '0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B')
    assert.equal(result.chain, 'sepolia')
    assert.equal(bridgeCalls[0].operation, 'call-contract')
  })

  it('throws UNSUPPORTED_CHAIN for unknown chain', async () => {
    await assert.rejects(
      () => vrfCreateSubscription('solana'),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })
})

describe('vrfGetSubscription', () => {
  it('returns subscription details from the coordinator', async () => {
    mockBridge([
      {
        value: [
          '5000000000000000000', // balance (5 LINK)
          '1000000000000000000', // nativeBalance
          '10', // reqCount
          '0xOwner', // subOwner
          ['0xConsumer1', '0xConsumer2'], // consumers
        ],
      },
    ])

    const result = await vrfGetSubscription('42', 'sepolia')

    assert.equal(result.subscriptionId, '42')
    assert.equal(result.balance, '5000000000000000000')
    assert.equal(result.nativeBalance, '1000000000000000000')
    assert.equal(result.requestCount, '10')
    assert.equal(result.owner, '0xOwner')
    assert.deepEqual(result.consumers, ['0xConsumer1', '0xConsumer2'])
    assert.equal(bridgeCalls[0].operation, 'read-contract')
  })

  it('throws MISSING_SUBSCRIPTION_ID when subId is empty', async () => {
    await assert.rejects(
      () => vrfGetSubscription('', 'sepolia'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_SUBSCRIPTION_ID',
    )
  })
})

describe('vrfAddConsumer', () => {
  it('calls addConsumer on the coordinator', async () => {
    mockBridge([{ value: { tx_hash: '0xdef456' } }])

    const result = await vrfAddConsumer('42', '0xMyContract', 'sepolia')

    assert.equal(result.subscriptionId, '42')
    assert.equal(result.consumer, '0xMyContract')
    assert.equal(result.txHash, '0xdef456')
    assert.equal(bridgeCalls[0].operation, 'call-contract')
    const args = bridgeCalls[0].params.args
    assert.equal(args[0], '42')
    assert.equal(args[1], '0xMyContract')
  })

  it('throws MISSING_CONSUMER when consumer is empty', async () => {
    await assert.rejects(
      () => vrfAddConsumer('42', '', 'sepolia'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CONSUMER',
    )
  })
})

describe('vrfRequest', () => {
  it('requests random words from the coordinator', async () => {
    mockBridge([{ value: { tx_hash: '0xreq123' } }])

    const result = await vrfRequest('sepolia', {
      subscriptionId: '42',
      numWords: 3,
      callbackGasLimit: 200000,
      requestConfirmations: 5,
    })

    assert.equal(result.txHash, '0xreq123')
    assert.equal(result.subscriptionId, '42')
    assert.equal(result.numWords, 3)
    assert.equal(bridgeCalls[0].operation, 'call-contract')

    // Verify the args include the key hash and sub ID
    const args = bridgeCalls[0].params.args
    assert.equal(args[0], '0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae') // sepolia key hash
    assert.equal(args[1], '42') // subscription ID
    assert.equal(args[2], 5) // request confirmations
    assert.equal(args[3], 200000) // callback gas limit
    assert.equal(args[4], 3) // num words
  })

  it('uses defaults for optional params', async () => {
    mockBridge([{ value: { tx_hash: '0x99' } }])

    const result = await vrfRequest('sepolia', { subscriptionId: '1' })

    assert.equal(result.numWords, 1)
    const args = bridgeCalls[0].params.args
    assert.equal(args[2], 3) // default confirmations
    assert.equal(args[3], 100000) // default gas limit
    assert.equal(args[4], 1) // default num words
  })

  it('throws MISSING_KEY_HASH for chains without a registered key hash', async () => {
    await assert.rejects(
      () => vrfRequest('arbitrum', { subscriptionId: '1' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_KEY_HASH',
    )
  })

  it('throws MISSING_SUBSCRIPTION_ID when subId is empty', async () => {
    await assert.rejects(
      () => vrfRequest('sepolia', { subscriptionId: '' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_SUBSCRIPTION_ID',
    )
  })
})
