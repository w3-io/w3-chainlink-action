import * as core from '@actions/core'
import { createCommandRouter, setJsonOutput, handleError } from '@w3-io/action-core'
import {
  getPrice,
  getFeedInfo,
  listFeeds,
  getReserves,
  ccipEstimateFee,
  ccipSend,
  vrfCreateSubscription,
  vrfFundSubscription,
  vrfGetSubscription,
  vrfAddConsumer,
  vrfRequest,
  functionsCreateSubscription,
  functionsGetSubscription,
  ChainlinkError,
} from './chainlink.js'

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
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'get-feed-info': async () => {
    const result = await getFeedInfo(
      core.getInput('pair', { required: true }),
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'list-feeds': async () => {
    const result = listFeeds(core.getInput('chain', { required: true }))
    setJsonOutput('result', result)
  },

  // ── Proof of Reserve ──────────────────────────────────────────

  'por-get-reserves': async () => {
    const result = await getReserves(
      core.getInput('pair', { required: true }),
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  // ── CCIP ──────────────────────────────────────────────────────

  'ccip-estimate-fee': async () => {
    const tokenAmounts = core.getInput('token-amounts')
    const result = await ccipEstimateFee(
      core.getInput('source-chain', { required: true }),
      core.getInput('destination-chain', { required: true }),
      {
        receiver: core.getInput('receiver', { required: true }),
        tokenAmounts: tokenAmounts ? JSON.parse(tokenAmounts) : [],
        feeToken: core.getInput('fee-token') || 'native',
        rpcUrl: core.getInput('rpc-url') || undefined,
      },
    )
    setJsonOutput('result', result)
  },

  'ccip-send': async () => {
    const tokenAmounts = core.getInput('token-amounts')
    const result = await ccipSend(
      core.getInput('source-chain', { required: true }),
      core.getInput('destination-chain', { required: true }),
      {
        receiver: core.getInput('receiver', { required: true }),
        tokenAmounts: tokenAmounts ? JSON.parse(tokenAmounts) : [],
        feeToken: core.getInput('fee-token') || 'native',
        gasLimit: core.getInput('gas-limit') || '200000',
        rpcUrl: core.getInput('rpc-url') || undefined,
      },
    )
    setJsonOutput('result', result)
  },

  // ── VRF ───────────────────────────────────────────────────────

  'vrf-create-subscription': async () => {
    const result = await vrfCreateSubscription(
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'vrf-fund-subscription': async () => {
    const result = await vrfFundSubscription(
      core.getInput('subscription-id', { required: true }),
      core.getInput('chain', { required: true }),
      {
        amount: core.getInput('amount', { required: true }),
        rpcUrl: core.getInput('rpc-url') || undefined,
      },
    )
    setJsonOutput('result', result)
  },

  'vrf-get-subscription': async () => {
    const result = await vrfGetSubscription(
      core.getInput('subscription-id', { required: true }),
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'vrf-add-consumer': async () => {
    const result = await vrfAddConsumer(
      core.getInput('subscription-id', { required: true }),
      core.getInput('consumer-contract', { required: true }),
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'vrf-request': async () => {
    const result = await vrfRequest(core.getInput('chain', { required: true }), {
      subscriptionId: core.getInput('subscription-id', { required: true }),
      numWords: Number(core.getInput('num-words')) || 1,
      callbackGasLimit: Number(core.getInput('callback-gas-limit')) || 100000,
      requestConfirmations: Number(core.getInput('request-confirmations')) || 3,
      rpcUrl: core.getInput('rpc-url') || undefined,
    })
    setJsonOutput('result', result)
  },

  // ── Functions ─────────────────────────────────────────────────

  'functions-create-subscription': async () => {
    const result = await functionsCreateSubscription(
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'functions-get-subscription': async () => {
    const result = await functionsGetSubscription(
      core.getInput('subscription-id', { required: true }),
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
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
