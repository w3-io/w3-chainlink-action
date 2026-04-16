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
  vrfRemoveConsumer,
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

  it('parses JSON string result from bridge (real bridge behavior)', async () => {
    // The bridge returns decoded values as a JSON-encoded string,
    // not a pre-parsed array. This test simulates real bridge output.
    mockBridge([
      {
        value:
          '["4000000000000000000","0","0","0xe4E402962943c4EB2253f666575eE12700e78e90",["0x292D6d64603Dc555541E6aa8Db19Ed145479D241"]]',
      },
    ])

    const result = await vrfGetSubscription('42', 'sepolia')

    assert.equal(result.balance, '4000000000000000000')
    assert.equal(result.nativeBalance, '0')
    assert.equal(result.requestCount, '0')
    assert.equal(result.owner, '0xe4E402962943c4EB2253f666575eE12700e78e90')
    assert.deepEqual(result.consumers, ['0x292D6d64603Dc555541E6aa8Db19Ed145479D241'])
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

describe('vrfRemoveConsumer', () => {
  it('calls removeConsumer on the coordinator', async () => {
    mockBridge([{ value: { tx_hash: '0xrm789' } }])

    const result = await vrfRemoveConsumer('42', '0xMyContract', 'sepolia')

    assert.equal(result.subscriptionId, '42')
    assert.equal(result.consumer, '0xMyContract')
    assert.equal(result.txHash, '0xrm789')
    assert.equal(bridgeCalls[0].operation, 'call-contract')
    assert.match(bridgeCalls[0].params.method, /removeConsumer/)
    const args = bridgeCalls[0].params.args
    assert.equal(args[0], '42')
    assert.equal(args[1], '0xMyContract')
  })

  it('throws MISSING_SUBSCRIPTION_ID when subId is empty', async () => {
    await assert.rejects(
      () => vrfRemoveConsumer('', '0xMyContract', 'sepolia'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_SUBSCRIPTION_ID',
    )
  })

  it('throws MISSING_CONSUMER when consumer is empty', async () => {
    await assert.rejects(
      () => vrfRemoveConsumer('42', '', 'sepolia'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CONSUMER',
    )
  })
})

describe('vrfRequest', () => {
  it('calls requestRandomWords on the consumer contract', async () => {
    mockBridge([{ value: { tx_hash: '0xreq123' } }])

    const result = await vrfRequest('sepolia', {
      consumerContract: '0x292D6d64603Dc555541E6aa8Db19Ed145479D241',
      numWords: 3,
    })

    assert.equal(result.txHash, '0xreq123')
    assert.equal(result.consumerContract, '0x292D6d64603Dc555541E6aa8Db19Ed145479D241')
    assert.equal(result.numWords, 3)
    assert.equal(bridgeCalls[0].operation, 'call-contract')

    // Consumer — not coordinator — is the contract targeted.
    assert.equal(bridgeCalls[0].params.contract, '0x292D6d64603Dc555541E6aa8Db19Ed145479D241')
    assert.match(bridgeCalls[0].params.method, /requestRandomWords\(uint32\)/)
    assert.deepEqual(bridgeCalls[0].params.args, [3])
  })

  it('defaults numWords to 1', async () => {
    mockBridge([{ value: { tx_hash: '0x99' } }])

    const result = await vrfRequest('sepolia', {
      consumerContract: '0x292D6d64603Dc555541E6aa8Db19Ed145479D241',
    })

    assert.equal(result.numWords, 1)
    assert.deepEqual(bridgeCalls[0].params.args, [1])
  })

  it('throws MISSING_CONSUMER_CONTRACT when consumer is empty', async () => {
    await assert.rejects(
      () => vrfRequest('sepolia', { consumerContract: '' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CONSUMER_CONTRACT',
    )
  })
})
