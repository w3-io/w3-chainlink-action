/**
 * Polling / wait command unit tests.
 *
 * Tests pollUntil helper, ccipWaitForDelivery, vrfWaitForFulfillment,
 * and functionsWaitForFulfillment.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  pollUntil,
  ccipWaitForDelivery,
  vrfWaitForFulfillment,
  functionsWaitForFulfillment,
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

// ── pollUntil ──────────────────────────────────────────────────────

describe('pollUntil', () => {
  it('returns immediately when checkFn returns truthy on first call', async () => {
    let calls = 0
    const { result, elapsed } = await pollUntil(
      async () => {
        calls++
        return 'done'
      },
      { timeout: 5000, interval: 100 },
    )

    assert.equal(result, 'done')
    assert.equal(calls, 1)
    assert.ok(elapsed < 200, `elapsed ${elapsed}ms should be < 200ms`)
  })

  it('polls until checkFn returns truthy', async () => {
    let calls = 0
    const { result, elapsed } = await pollUntil(
      async () => {
        calls++
        return calls >= 3 ? 'found' : null
      },
      { timeout: 5000, interval: 50 },
    )

    assert.equal(result, 'found')
    assert.equal(calls, 3)
    assert.ok(elapsed >= 90, `elapsed ${elapsed}ms should be >= 90ms`)
  })

  it('throws POLL_TIMEOUT when deadline exceeded', async () => {
    await assert.rejects(
      () =>
        pollUntil(async () => null, {
          timeout: 100,
          interval: 60,
        }),
      (err) => {
        assert.ok(err instanceof ChainlinkError)
        assert.equal(err.code, 'POLL_TIMEOUT')
        return true
      },
    )
  })

  it('returns the truthy value from checkFn', async () => {
    const { result } = await pollUntil(async () => ({ status: 'ok' }), {
      timeout: 1000,
      interval: 50,
    })

    assert.deepEqual(result, { status: 'ok' })
  })
})

// ── ccipWaitForDelivery ────────────────────────────────────────────

describe('ccipWaitForDelivery', () => {
  const MSG_ID = '0xabc123000000000000000000000000000000000000000000000000000000dead'
  const OFFRAMP = '0x1111111111111111111111111111111111111111'

  it('returns when message state is SUCCESS on first poll', async () => {
    mockBridge([
      {
        value: [
          {
            blockNumber: '0xa1',
            transactionHash: '0xtx1',
            topics: [
              '0x84f4178f0724c8855c4ba94203d6af73647c851f4b23d29ab0b86aa9a7148079',
              '0x0000000000000000000000000000000000000000000000000000000000000007',
              MSG_ID,
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000002',
          },
        ],
      },
    ])

    const result = await ccipWaitForDelivery(MSG_ID, 'base', {
      offramp: OFFRAMP,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.state, 'SUCCESS')
    assert.equal(result.stateCode, 2)
    assert.ok(typeof result.elapsed === 'number')
    assert.ok(result.elapsed >= 0)
  })

  it('returns on FAILURE state', async () => {
    mockBridge([
      {
        value: [
          {
            blockNumber: '0xa2',
            transactionHash: '0xtx2',
            topics: [
              '0x84f4178f0724c8855c4ba94203d6af73647c851f4b23d29ab0b86aa9a7148079',
              '0x000000000000000000000000000000000000000000000000000000000000000c',
              MSG_ID,
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000003',
          },
        ],
      },
    ])

    const result = await ccipWaitForDelivery(MSG_ID, 'base', {
      offramp: OFFRAMP,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.state, 'FAILURE')
    assert.equal(result.stateCode, 3)
  })

  it('polls multiple times until message arrives', async () => {
    // First poll: v1.5 empty, legacy empty (NOT_FOUND)
    // Second poll: SUCCESS
    mockBridge([
      { value: [] }, // v1.5 empty
      { value: [] }, // legacy empty -> NOT_FOUND, keep polling
      {
        value: [
          {
            blockNumber: '0xb1',
            transactionHash: '0xtx3',
            topics: [
              '0x84f4178f0724c8855c4ba94203d6af73647c851f4b23d29ab0b86aa9a7148079',
              '0x0000000000000000000000000000000000000000000000000000000000000001',
              MSG_ID,
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000002',
          },
        ],
      },
    ])

    const result = await ccipWaitForDelivery(MSG_ID, 'base', {
      offramp: OFFRAMP,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.state, 'SUCCESS')
    // Should have made at least 3 bridge calls (2 for first poll, 1+ for second)
    assert.ok(bridgeCalls.length >= 3)
  })

  it('throws MISSING_MESSAGE_ID when id empty', async () => {
    await assert.rejects(
      () => ccipWaitForDelivery('', 'base', { offramp: OFFRAMP }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_MESSAGE_ID',
    )
  })

  it('throws MISSING_OFFRAMP when offramp empty', async () => {
    await assert.rejects(
      () => ccipWaitForDelivery(MSG_ID, 'base', {}),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_OFFRAMP',
    )
  })

  it('throws POLL_TIMEOUT when message never arrives', async () => {
    // Return NOT_FOUND on every poll
    const emptyResponses = Array.from({ length: 20 }, () => ({ value: [] }))
    mockBridge(emptyResponses)

    await assert.rejects(
      () =>
        ccipWaitForDelivery(MSG_ID, 'base', {
          offramp: OFFRAMP,
          timeout: 150,
          pollInterval: 60,
        }),
      (err) => err instanceof ChainlinkError && err.code === 'POLL_TIMEOUT',
    )
  })
})

// ── vrfWaitForFulfillment ──────────────────────────────────────────

describe('vrfWaitForFulfillment', () => {
  const CONSUMER = '0x292D6d64603Dc555541E6aa8Db19Ed145479D241'

  it('returns when fulfilled on first poll and reads random word', async () => {
    mockBridge([
      { value: true }, // s_lastRequestFulfilled() -> true
      { value: '12345678901234567890' }, // s_lastRandomWords(0)
    ])

    const result = await vrfWaitForFulfillment('sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.randomWord, '12345678901234567890')
    assert.equal(result.consumerContract, CONSUMER)
    assert.equal(result.chain, 'sepolia')
    assert.ok(typeof result.elapsed === 'number')
  })

  it('handles string "true" from bridge', async () => {
    mockBridge([
      { value: 'true' }, // string form
      { value: '99999' },
    ])

    const result = await vrfWaitForFulfillment('sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.randomWord, '99999')
  })

  it('polls until fulfilled', async () => {
    mockBridge([
      { value: false }, // not yet
      { value: false }, // not yet
      { value: true }, // fulfilled!
      { value: '42' }, // random word
    ])

    const result = await vrfWaitForFulfillment('sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.randomWord, '42')
    // 3 polls for fulfilled + 1 for random word = at least 4 bridge calls
    assert.ok(bridgeCalls.length >= 4)
  })

  it('returns undefined randomWord when getter fails', async () => {
    mockBridge([
      { value: true },
      // s_lastRandomWords call will throw because no more responses
    ])

    // Override to make the second call throw
    const orig = bridge.chain
    let callCount = 0
    bridge.chain = async (...args) => {
      callCount++
      if (callCount === 1) return true
      throw new Error('no such method')
    }

    const result = await vrfWaitForFulfillment('sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.randomWord, undefined)
    bridge.chain = orig
  })

  it('throws MISSING_CONSUMER_CONTRACT when consumer empty', async () => {
    await assert.rejects(
      () => vrfWaitForFulfillment('sepolia', { consumerContract: '' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CONSUMER_CONTRACT',
    )
  })

  it('throws POLL_TIMEOUT when never fulfilled', async () => {
    const falseResponses = Array.from({ length: 20 }, () => ({ value: false }))
    mockBridge(falseResponses)

    await assert.rejects(
      () =>
        vrfWaitForFulfillment('sepolia', {
          consumerContract: CONSUMER,
          timeout: 150,
          pollInterval: 60,
        }),
      (err) => err instanceof ChainlinkError && err.code === 'POLL_TIMEOUT',
    )
  })
})

// ── functionsWaitForFulfillment ────────────────────────────────────

describe('functionsWaitForFulfillment', () => {
  const CONSUMER = '0xf6e25c31057dF6A26b1e5acADB71C9bA8E16F822'

  it('returns when fulfilled and reads response + error', async () => {
    mockBridge([
      { value: true }, // s_lastRequestFulfilled()
      { value: '0x68656c6c6f' }, // s_lastResponse()
      { value: '0x' }, // s_lastError()
    ])

    const result = await functionsWaitForFulfillment('base-sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.response, '0x68656c6c6f')
    assert.equal(result.error, '0x')
    assert.equal(result.consumerContract, CONSUMER)
    assert.equal(result.chain, 'base-sepolia')
    assert.ok(typeof result.elapsed === 'number')
  })

  it('polls until fulfilled', async () => {
    mockBridge([
      { value: false }, // not yet
      { value: '1' }, // "1" is truthy for bool check
      { value: '0xresponse' }, // response
      { value: '0x' }, // error
    ])

    const result = await functionsWaitForFulfillment('base-sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.response, '0xresponse')
  })

  it('handles missing response/error getters gracefully', async () => {
    let callCount = 0
    bridge.chain = async () => {
      callCount++
      if (callCount === 1) return true // fulfilled
      throw new Error('no such method') // response/error fail
    }

    const result = await functionsWaitForFulfillment('base-sepolia', {
      consumerContract: CONSUMER,
      timeout: 5000,
      pollInterval: 50,
    })

    assert.equal(result.fulfilled, true)
    assert.equal(result.response, undefined)
    assert.equal(result.error, undefined)
  })

  it('throws MISSING_CONSUMER_CONTRACT when consumer empty', async () => {
    await assert.rejects(
      () => functionsWaitForFulfillment('base-sepolia', { consumerContract: '' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_CONSUMER_CONTRACT',
    )
  })

  it('throws POLL_TIMEOUT when never fulfilled', async () => {
    const falseResponses = Array.from({ length: 20 }, () => ({ value: false }))
    mockBridge(falseResponses)

    await assert.rejects(
      () =>
        functionsWaitForFulfillment('base-sepolia', {
          consumerContract: CONSUMER,
          timeout: 150,
          pollInterval: 60,
        }),
      (err) => err instanceof ChainlinkError && err.code === 'POLL_TIMEOUT',
    )
  })
})
