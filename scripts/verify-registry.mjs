#!/usr/bin/env node
/**
 * verify-registry.mjs — validate Chainlink contract addresses against live RPC.
 *
 * Makes raw JSON-RPC eth_call requests to verify that each address in the
 * registry is a real, responding Chainlink contract. Does NOT use the W3
 * bridge — just a public RPC endpoint.
 *
 * Usage:
 *   node scripts/verify-registry.mjs                    # uses default public Sepolia RPC
 *   node scripts/verify-registry.mjs --chain ethereum   # verify Ethereum mainnet feeds
 *   node scripts/verify-registry.mjs --chain sepolia    # verify Sepolia feeds
 *   node scripts/verify-registry.mjs --rpc https://...  # custom RPC endpoint
 *
 * Exit code: 0 if all addresses respond, 1 if any fail.
 */

import { FEEDS, POR_FEEDS, CCIP, VRF, FUNCTIONS, FEED_INTERFACE } from '../src/registry.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_RPCS = {
  ethereum: 'https://eth.llamarpc.com',
  sepolia: 'https://rpc.sepolia.org',
  base: 'https://mainnet.base.org',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  polygon: 'https://polygon-rpc.com',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
}

let targetChain = 'sepolia'
let rpcUrl = null

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--chain' && process.argv[i + 1]) {
    targetChain = process.argv[++i]
  } else if (process.argv[i] === '--rpc' && process.argv[i + 1]) {
    rpcUrl = process.argv[++i]
  }
}

if (!rpcUrl) {
  rpcUrl = DEFAULT_RPCS[targetChain]
  if (!rpcUrl) {
    console.error(`No default RPC for chain "${targetChain}". Use --rpc <url>.`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a simple function call (no arguments) to calldata.
 * For `decimals()` → selector is keccak256("decimals()")[:4]
 * For `latestRoundData()` → keccak256("latestRoundData()")[:4]
 */
function encodeFunctionSelector(sig) {
  // Use the Web Crypto API to compute keccak256... but Node doesn't have
  // keccak256 natively. For this script, hardcode the selectors we need.
  const SELECTORS = {
    'decimals()': '0x313ce567',
    'latestRoundData()': '0xfeaf968c',
    'description()': '0x7284e416',
  }
  return SELECTORS[sig]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ethCall(to, data) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
    id: 1,
  })

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: `RPC returned non-JSON: ${text.slice(0, 80)}` }
    }

    if (json.error) return { ok: false, error: json.error.message }
    if (!json.result || json.result === '0x') return { ok: false, error: 'empty response' }
    return { ok: true, result: json.result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

let failed = 0
let passed = 0
let skipped = 0

async function verifyFeed(label, address) {
  await sleep(300) // rate-limit friendly

  // Call decimals() as a quick liveness check
  const selector = encodeFunctionSelector('decimals()')
  const result = await ethCall(address, selector)

  if (result.ok) {
    const decimals = parseInt(result.result, 16)
    if (decimals > 0 && decimals <= 18) {
      console.log(`  ✅ ${label} → ${address} (${decimals} decimals)`)
      passed++
      return
    }
  }

  console.log(`  ❌ ${label} → ${address} (${result.error || 'invalid decimals'})`)
  failed++
}

async function verifyContract(label, address) {
  await sleep(300) // rate-limit friendly

  // For non-feed contracts (routers, coordinators), just check code exists
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_getCode',
    params: [address, 'latest'],
    id: 1,
  })

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      console.log(`  ❌ ${label} → ${address} (RPC returned non-JSON: ${text.slice(0, 60)})`)
      failed++
      return
    }

    if (json.result && json.result !== '0x' && json.result.length > 10) {
      console.log(`  ✅ ${label} → ${address} (code present)`)
      passed++
    } else {
      console.log(`  ❌ ${label} → ${address} (no code at address)`)
      failed++
    }
  } catch (err) {
    console.log(`  ❌ ${label} → ${address} (${err.message})`)
    failed++
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\nVerifying Chainlink registry for chain: ${targetChain}`)
console.log(`RPC: ${rpcUrl}\n`)

// Price Feeds
const feeds = FEEDS[targetChain]
if (feeds) {
  console.log(`── Price Feeds (${Object.keys(feeds).length}) ──`)
  for (const [pair, address] of Object.entries(feeds)) {
    await verifyFeed(pair, address)
  }
} else {
  console.log(`── Price Feeds: no feeds registered for ${targetChain} ──`)
  skipped++
}

// PoR Feeds
const porFeeds = POR_FEEDS[targetChain]
if (porFeeds) {
  console.log(`\n── Proof of Reserve (${Object.keys(porFeeds).length}) ──`)
  for (const [feed, address] of Object.entries(porFeeds)) {
    await verifyFeed(feed, address)
  }
}

// CCIP Router
const ccipRouter = CCIP.routers[targetChain]
if (ccipRouter) {
  console.log(`\n── CCIP Router ──`)
  await verifyContract('Router', ccipRouter)
}

// VRF Coordinator
const vrfCoord = VRF.coordinators[targetChain]
if (vrfCoord) {
  console.log(`\n── VRF Coordinator ──`)
  await verifyContract('Coordinator', vrfCoord)
}

// Functions Router
const functionsRouter = FUNCTIONS.routers[targetChain]
if (functionsRouter) {
  console.log(`\n── Functions Router ──`)
  await verifyContract('Router', functionsRouter)
}

// Summary
console.log(`\n── Summary ──`)
console.log(`  Passed: ${passed}`)
console.log(`  Failed: ${failed}`)
console.log(`  Skipped: ${skipped}`)

if (failed > 0) {
  console.log(`\n⚠️  ${failed} address(es) failed verification. Check the registry.`)
  process.exit(1)
} else {
  console.log(`\n✅ All ${passed} addresses verified on ${targetChain}.`)
}
