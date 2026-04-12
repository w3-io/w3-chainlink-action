/**
 * CCIP unit tests.
 *
 * Tests the cross-chain send flow: fee estimation, message building,
 * router lookup, chain selector resolution, and fee token handling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ccipEstimateFee, ccipSend, ChainlinkError } from '../src/chainlink.js'
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
  it('calls ccipSend on the router and returns a message ID', async () => {
    mockBridge([{ value: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' }])

    const result = await ccipSend('ethereum', 'arbitrum', {
      receiver: '0xRecipient',
      tokenAmounts: [{ token: '0xUSDC', amount: '1000000000' }],
    })

    assert.equal(result.status, 'sent')
    assert.equal(
      result.messageId,
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    )
    assert.equal(result.sourceChain, 'ethereum')
    assert.equal(result.destinationChain, 'arbitrum')

    // Verify it was a write call
    assert.equal(bridgeCalls[0].operation, 'call-contract')
  })

  it('formats token amounts as strings', async () => {
    mockBridge([{ value: '0x123' }])

    await ccipSend('sepolia', 'arbitrum-sepolia', {
      receiver: '0xRecipient',
      tokenAmounts: [{ token: '0xToken', amount: 500 }],
    })

    const args = bridgeCalls[0].params.args
    // args[1] is a parenthesized tuple string for coerce_str
    assert.ok(args[1].includes('500'))
  })

  it('sends with empty tokenAmounts for message-only transfers', async () => {
    mockBridge([{ value: '0x456' }])

    const result = await ccipSend('ethereum', 'base', {
      receiver: '0xRecipient',
      data: '0xdeadbeef',
    })

    assert.equal(result.status, 'sent')
    const args = bridgeCalls[0].params.args
    // args[1] is a tuple string with empty tokenAmounts: [..., [], ...]
    assert.ok(args[1].includes('[]'))
  })

  it('uses the correct testnet router and selector', async () => {
    mockBridge([{ value: '0x789' }])

    await ccipSend('sepolia', 'fuji', {
      receiver: '0xRecipient',
    })

    assert.equal(bridgeCalls[0].params.contract, '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59')
    const args = bridgeCalls[0].params.args
    assert.equal(args[0], '14767482510784806043') // fuji selector
  })
})
