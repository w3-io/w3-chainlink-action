import * as core from '@actions/core'
import { createCommandRouter, setJsonOutput, handleError } from '@w3-io/action-core'
import { getPrice, getFeedInfo, listFeeds, ChainlinkError } from './chainlink.js'

/**
 * W3 Chainlink Action — command dispatch.
 *
 * Tier 1: Price Feeds + Proof of Reserve (bridge reads)
 * Tier 2: CCIP (cross-chain orchestrated sends)
 * Tier 3: VRF + Functions (subscription mgmt + async fulfillment)
 * Tier 4: Data Streams (REST + on-chain verifier)
 */

const handlers = {
  // ── Price Feeds ───────────────────────────────────────────────

  'get-price': async () => {
    const result = await getPrice(
      core.getInput('pair', { required: true }),
      core.getInput('chain', { required: true }),
    )
    setJsonOutput('result', result)
  },

  'get-feed-info': async () => {
    const result = await getFeedInfo(
      core.getInput('pair', { required: true }),
      core.getInput('chain', { required: true }),
    )
    setJsonOutput('result', result)
  },

  'list-feeds': async () => {
    const result = listFeeds(core.getInput('chain', { required: true }))
    setJsonOutput('result', result)
  },
}

const router = createCommandRouter(handlers)

export async function run() {
  try {
    await router()
  } catch (error) {
    if (error instanceof ChainlinkError) {
      core.setFailed(`Chainlink error (${error.code}): ${error.message}`)
    } else {
      handleError(error)
    }
  }
}
