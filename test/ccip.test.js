/**
 * CCIP unit tests.
 *
 * Tests the cross-chain send flow: fee estimation, message building,
 * router lookup, chain selector resolution, and fee token handling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ccipEstimateFee, ccipGetMessage, ccipSend, ChainlinkError } from '../src/chainlink.js'
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

describe('ccipEstimateFee', () => {
  it('calls getFee on the correct router with the destination selector', async () => {
    mockBridge([{ value: '500000000000000' }]) // fee in wei

    const result = await ccipEstimateFee('ethereum', 'arbitrum', {
      receiver: '0xRecipient',
    })

    assert.equal(result.sourceChain, 'ethereum')
    assert.equal(result.destinationChain, 'arbitrum')
    assert.equal(result.fee, '500000000000000')
    assert.equal(result.router, '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D')
    assert.equal(result.destinationSelector, '4949039107694359620')

    // Verify bridge call
    assert.equal(bridgeCalls[0].operation, 'read-contract')
    assert.equal(bridgeCalls[0].params.contract, '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D')
  })

  it('resolves "link" feeToken to the LINK address', async () => {
    mockBridge([{ value: '100000000000000000' }])

    const result = await ccipEstimateFee('ethereum', 'base', {
      receiver: '0xRecipient',
      feeToken: 'link',
    })

    assert.equal(result.feeToken, '0x514910771AF9Ca656af840dff83E8264EcF986CA')
  })

  it('resolves "native" feeToken to address(0)', async () => {
    mockBridge([{ value: '500000000000000' }])

    const result = await ccipEstimateFee('ethereum', 'arbitrum', {
      receiver: '0xRecipient',
      feeToken: 'native',
    })

    assert.equal(result.feeToken, '0x0000000000000000000000000000000000000000')
  })

  it('throws MISSING_SOURCE_CHAIN when source is empty', async () => {
    await assert.rejects(
      () => ccipEstimateFee('', 'arbitrum', { receiver: '0x' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_SOURCE_CHAIN',
    )
  })

  it('throws MISSING_DESTINATION_CHAIN when dest is empty', async () => {
    await assert.rejects(
      () => ccipEstimateFee('ethereum', '', { receiver: '0x' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_DESTINATION_CHAIN',
    )
  })

  it('throws MISSING_RECEIVER when receiver is empty', async () => {
    await assert.rejects(
      () => ccipEstimateFee('ethereum', 'arbitrum', { receiver: '' }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_RECEIVER',
    )
  })

  it('throws UNSUPPORTED_CHAIN for unknown source chain', async () => {
    await assert.rejects(
      () => ccipEstimateFee('solana', 'arbitrum', { receiver: '0x' }),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })

  it('throws UNSUPPORTED_CHAIN for unknown destination chain', async () => {
    await assert.rejects(
      () => ccipEstimateFee('ethereum', 'solana', { receiver: '0x' }),
      (err) => err instanceof ChainlinkError && err.code === 'UNSUPPORTED_CHAIN',
    )
  })
})

describe('ccipSend', () => {
  it('calls ccipSend on the router and returns a tx hash', async () => {
    mockBridge([{ value: '500000000000000' }, { value: { tx_hash: '0xabcdef1234567890' } }])

    const result = await ccipSend('ethereum', 'arbitrum', {
      receiver: '0xRecipient',
      tokenAmounts: [{ token: '0xUSDC', amount: '1000000000' }],
    })

    assert.equal(result.status, 'sent')
    assert.equal(result.txHash, '0xabcdef1234567890')
    assert.equal(result.sourceChain, 'ethereum')
    assert.equal(result.destinationChain, 'arbitrum')

    // bridgeCalls[0] = getFee (read), bridgeCalls[1] = ccipSend (write)
    assert.equal(bridgeCalls[0].operation, 'read-contract')
    assert.equal(bridgeCalls[1].operation, 'call-contract')
  })

  it('formats token amounts as nested arrays', async () => {
    mockBridge([{ value: '100000000000000' }, { value: { tx_hash: '0x123' } }])

    await ccipSend('sepolia', 'arbitrum-sepolia', {
      receiver: '0xRecipient',
      tokenAmounts: [{ token: '0xToken', amount: 500 }],
    })

    // bridgeCalls[0] = getFee, bridgeCalls[1] = ccipSend
    // args[1] is the EVM2AnyMessage tuple as a nested JSON array.
    // tokenAmounts is at index 2 of that tuple.
    const message = bridgeCalls[1].params.args[1]
    assert.ok(Array.isArray(message), 'message should be an array')
    assert.deepEqual(message[2], [['0xToken', 500]])
  })

  it('sends with empty tokenAmounts for message-only transfers', async () => {
    mockBridge([{ value: '200000000000000' }, { value: { tx_hash: '0x456' } }])

    const result = await ccipSend('ethereum', 'base', {
      receiver: '0xRecipient',
      data: '0xdeadbeef',
    })

    assert.equal(result.status, 'sent')
    // bridgeCalls[0] = getFee, bridgeCalls[1] = ccipSend
    const message = bridgeCalls[1].params.args[1]
    assert.ok(Array.isArray(message))
    assert.deepEqual(message[2], []) // empty tokenAmounts array
    assert.equal(message[1], '0xdeadbeef') // data field
  })

  it('uses the correct testnet router and selector', async () => {
    mockBridge([{ value: '300000000000000' }, { value: { tx_hash: '0x789' } }])

    await ccipSend('sepolia', 'fuji', {
      receiver: '0xRecipient',
    })

    // bridgeCalls[0] = getFee, bridgeCalls[1] = ccipSend
    assert.equal(bridgeCalls[1].params.contract, '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59')
    const args = bridgeCalls[1].params.args
    assert.equal(args[0], '14767482510784806043') // fuji selector
  })
})

describe('ccipGetMessage', () => {
  const MSG_ID = '0xabc123000000000000000000000000000000000000000000000000000000dead'
  const OFFRAMP = '0x1111111111111111111111111111111111111111'

  it('returns SUCCESS state when v1.5 event matches', async () => {
    // First query (v1.5 signature) returns a matching event.
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
            // state = 2 (SUCCESS)
            data: '0x0000000000000000000000000000000000000000000000000000000000000002',
          },
        ],
      },
    ])

    const result = await ccipGetMessage(MSG_ID, 'base', { offramp: OFFRAMP })

    assert.equal(result.state, 'SUCCESS')
    assert.equal(result.stateCode, 2)
    assert.equal(result.sequenceNumber, '7')
    assert.equal(result.offramp, OFFRAMP)
    assert.equal(result.transactionHash, '0xtx1')
    assert.equal(result.messageId, MSG_ID)

    // Verify the bridge call topics filter
    assert.equal(bridgeCalls[0].operation, 'get-events')
    assert.equal(bridgeCalls[0].params.address, OFFRAMP)
    assert.equal(
      bridgeCalls[0].params.topics[0],
      '0x84f4178f0724c8855c4ba94203d6af73647c851f4b23d29ab0b86aa9a7148079',
    )
    assert.equal(bridgeCalls[0].params.topics[2], MSG_ID)
  })

  it('falls back to legacy (pre-v1.5) event signature', async () => {
    mockBridge([
      { value: [] }, // v1.5 query returns nothing
      {
        value: [
          {
            blockNumber: '0xa2',
            transactionHash: '0xtx2',
            topics: [
              '0xd4f851956a5d67c3997d1c9205045fef79bae2947fdee7e9e2641abc7391ef65',
              '0x000000000000000000000000000000000000000000000000000000000000000c',
              MSG_ID,
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000003', // FAILURE
          },
        ],
      },
    ])

    const result = await ccipGetMessage(MSG_ID, 'base', { offramp: OFFRAMP })

    assert.equal(result.state, 'FAILURE')
    assert.equal(result.sequenceNumber, '12')
    assert.equal(bridgeCalls.length, 2) // v1.5 tried, then legacy
  })

  it('returns NOT_FOUND when neither signature matches', async () => {
    mockBridge([{ value: [] }, { value: [] }])

    const result = await ccipGetMessage(MSG_ID, 'base', { offramp: OFFRAMP })

    assert.equal(result.state, 'NOT_FOUND')
    assert.equal(result.stateCode, null)
    assert.equal(result.sequenceNumber, undefined)
  })

  it('normalizes short messageId hex to bytes32', async () => {
    mockBridge([
      {
        value: [
          {
            blockNumber: '0xa3',
            transactionHash: '0xtx3',
            topics: [
              '0x84f4178f0724c8855c4ba94203d6af73647c851f4b23d29ab0b86aa9a7148079',
              '0x0000000000000000000000000000000000000000000000000000000000000001',
              '0x000000000000000000000000000000000000000000000000000000000000dead',
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000002',
          },
        ],
      },
    ])

    const result = await ccipGetMessage('0xdead', 'base', { offramp: OFFRAMP })

    assert.equal(
      bridgeCalls[0].params.topics[2],
      '0x000000000000000000000000000000000000000000000000000000000000dead',
    )
    assert.equal(result.state, 'SUCCESS')
  })

  it('throws MISSING_MESSAGE_ID when id empty', async () => {
    await assert.rejects(
      () => ccipGetMessage('', 'base', { offramp: OFFRAMP }),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_MESSAGE_ID',
    )
  })

  it('throws MISSING_OFFRAMP when offramp empty', async () => {
    await assert.rejects(
      () => ccipGetMessage(MSG_ID, 'base', {}),
      (err) => err instanceof ChainlinkError && err.code === 'MISSING_OFFRAMP',
    )
  })
})
