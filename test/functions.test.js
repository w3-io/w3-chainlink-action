/**
 * Functions unit tests.
 *
 * Tests subscription creation, subscription lookups, and
 * router address resolution.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  functionsCreateSubscription,
  functionsGetSubscription,
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

describe('functionsCreateSubscription', () => {
  it('calls createSubscription on the router and returns the subId', async () => {
    const subCreatedTopic = '0x464722b4166576d3dcbba877b999bc35cf911f4eaf434b7eba68fa113951d0d7'
    const subIdTopic = '0x0000000000000000000000000000000000000000000000000000000000000007' // 7
    mockBridge([
      {
        value: {
          tx_hash: '0xfunc123',
          logs_json: JSON.stringify([{ topics: [subCreatedTopic, subIdTopic] }]),
        },
      },
    ])

    const result = await functionsCreateSubscription('sepolia')

    assert.equal(result.subscriptionId, '7')
    assert.equal(result.txHash, '0xfunc123')
    assert.equal(result.router, '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0')
    assert.equal(result.chain, 'sepolia')
    assert.equal(bridgeCalls[0].operation, 'call-contract')
    assert.equal(bridgeCalls[0].params.method, 'function createSubscription() returns (uint64)')
  })

  it('throws UNSUPPORTED_CHAIN for unknown chain', async () => {
    await assert.rejects(
      () => functionsCreateSubscription('solana'),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })

  it('throws MISSING_CHAIN when chain is empty', async () => {
    await assert.rejects(
      () => functionsCreateSubscription(''),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CHAIN',
    )
  })
})

describe('functionsGetSubscription', () => {
  it('returns subscription details from the router', async () => {
    mockBridge([
      {
        value: [
          '3000000000000000000', // balance (3 LINK)
          '0xOwner123', // owner
          '0', // blockedBalance
          '0x0000000000000000000000000000000000000000', // proposedOwner
          ['0xConsumerA', '0xConsumerB'], // consumers
          '0x0000000000000000000000000000000000000000000000000000000000000000', // flags
        ],
      },
    ])

    const result = await functionsGetSubscription('7', 'sepolia')

    assert.equal(result.subscriptionId, '7')
    assert.equal(result.chain, 'sepolia')
    assert.equal(result.router, '0xb83E47C2bC239B3bf370bc41e1459A34b41238D0')
    assert.equal(result.balance, '3000000000000000000')
    assert.equal(result.owner, '0xOwner123')
    assert.deepEqual(result.consumers, ['0xConsumerA', '0xConsumerB'])
    assert.equal(bridgeCalls[0].operation, 'read-contract')
  })

  it('handles object-shaped response', async () => {
    mockBridge([
      {
        value: {
          balance: '1000000000000000000',
          owner: '0xObj',
          consumers: ['0xC1'],
        },
      },
    ])

    const result = await functionsGetSubscription('99', 'ethereum')

    assert.equal(result.balance, '1000000000000000000')
    assert.equal(result.owner, '0xObj')
    assert.deepEqual(result.consumers, ['0xC1'])
  })

  it('throws MISSING_SUBSCRIPTION_ID when subId is empty', async () => {
    await assert.rejects(
      () => functionsGetSubscription('', 'sepolia'),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_SUBSCRIPTION_ID',
    )
  })

  it('throws UNSUPPORTED_CHAIN for unknown chain', async () => {
    await assert.rejects(
      () => functionsGetSubscription('7', 'solana'),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })
})
