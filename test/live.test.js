/**
 * Live integration tests against real Chainlink contracts on Sepolia.
 *
 * Skipped unless `CHAINLINK_LIVE_TEST=1` is set.
 * Required env vars:
 *   - CHAINLINK_RPC_URL — Sepolia JSON-RPC endpoint (e.g. Alchemy)
 *
 * These tests call the same contracts our action targets, but via
 * direct JSON-RPC instead of the W3 bridge. This validates:
 *   - Contract addresses in the registry are correct
 *   - ABI function signatures produce valid calldata
 *   - Response parsing handles real on-chain data
 *
 * The bridge integration (action → bridge → chain) is tested by
 * deploying a real workflow on a running W3 node.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FEEDS, FEED_INTERFACE, CCIP, VRF, FUNCTIONS } from '../src/registry.js'

const LIVE = process.env.CHAINLINK_LIVE_TEST === '1'
const RPC_URL = process.env.CHAINLINK_RPC_URL
const skip = !LIVE
const reason = 'CHAINLINK_LIVE_TEST != 1'

// ── Helpers ─────────────────────────────────────────────────────

const SELECTORS = {
  'decimals()': '0x313ce567',
  'latestRoundData()': '0xfeaf968c',
  'description()': '0x7284e416',
}

async function ethCall(to, selector) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to, data: selector }, 'latest'],
      id: 1,
    }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`RPC error: ${json.error.message}`)
  return json.result
}

async function ethGetCode(address) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [address, 'latest'],
      id: 1,
    }),
  })
  const json = await res.json()
  return json.result
}

// ── Price Feeds ─────────────────────────────────────────────────

describe('live: Sepolia price feeds', { skip, todo: skip ? reason : undefined }, () => {
  const sepoliaFeeds = FEEDS.sepolia || {}

  it('ETH/USD returns 8 decimals and a non-zero price', async () => {
    const address = sepoliaFeeds['ETH/USD']
    assert.ok(address, 'ETH/USD not in registry')

    const decimalsHex = await ethCall(address, SELECTORS['decimals()'])
    const decimals = parseInt(decimalsHex, 16)
    assert.equal(decimals, 8)

    const roundData = await ethCall(address, SELECTORS['latestRoundData()'])
    assert.ok(roundData.length > 10, 'latestRoundData returned empty')

    // The answer is at bytes 32-64 of the return data (second word)
    const answerHex = '0x' + roundData.slice(66, 130)
    const answer = BigInt(answerHex)
    assert.ok(answer > 0n, `ETH/USD price should be positive, got ${answer}`)

    // Sanity check: ETH should be > $100 and < $100,000
    const price = Number(answer) / 10 ** 8
    assert.ok(price > 100, `ETH price suspiciously low: $${price}`)
    assert.ok(price < 100000, `ETH price suspiciously high: $${price}`)
    console.log(`    ETH/USD = $${price.toFixed(2)}`)
  })

  it('BTC/USD returns a reasonable price', async () => {
    const address = sepoliaFeeds['BTC/USD']
    assert.ok(address)

    const roundData = await ethCall(address, SELECTORS['latestRoundData()'])
    const answerHex = '0x' + roundData.slice(66, 130)
    const answer = BigInt(answerHex)
    const price = Number(answer) / 10 ** 8
    assert.ok(price > 1000, `BTC price suspiciously low: $${price}`)
    console.log(`    BTC/USD = $${price.toFixed(2)}`)
  })

  it('LINK/USD returns a reasonable price', async () => {
    const address = sepoliaFeeds['LINK/USD']
    assert.ok(address)

    const roundData = await ethCall(address, SELECTORS['latestRoundData()'])
    const answerHex = '0x' + roundData.slice(66, 130)
    const answer = BigInt(answerHex)
    const price = Number(answer) / 10 ** 8
    assert.ok(price > 1, `LINK price suspiciously low: $${price}`)
    console.log(`    LINK/USD = $${price.toFixed(2)}`)
  })

  it('all Sepolia feeds respond to decimals()', async () => {
    for (const [pair, address] of Object.entries(sepoliaFeeds)) {
      const decimalsHex = await ethCall(address, SELECTORS['decimals()'])
      const decimals = parseInt(decimalsHex, 16)
      assert.ok(decimals > 0 && decimals <= 18, `${pair} decimals=${decimals}`)
    }
  })
})

// ── Infrastructure contracts ────────────────────────────────────

describe(
  'live: Sepolia infrastructure contracts',
  { skip, todo: skip ? reason : undefined },
  () => {
    it('CCIP Router has code deployed', async () => {
      const code = await ethGetCode(CCIP.routers.sepolia)
      assert.ok(code && code !== '0x' && code.length > 10, 'CCIP Router has no code')
    })

    it('VRF Coordinator has code deployed', async () => {
      const code = await ethGetCode(VRF.coordinators.sepolia)
      assert.ok(code && code !== '0x' && code.length > 10, 'VRF Coordinator has no code')
    })

    it('Functions Router has code deployed', async () => {
      const code = await ethGetCode(FUNCTIONS.routers.sepolia)
      assert.ok(code && code !== '0x' && code.length > 10, 'Functions Router has no code')
    })
  },
)
