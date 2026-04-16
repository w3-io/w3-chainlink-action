import * as core from '@actions/core'
import { createCommandRouter, setJsonOutput, handleError } from '@w3-io/action-core'
import {
  getPrice,
  getFeedInfo,
  listFeeds,
  getReserves,
  ccipEstimateFee,
  ccipGetMessage,
  ccipSend,
  vrfCreateSubscription,
  vrfFundSubscription,
  vrfGetSubscription,
  vrfAddConsumer,
  vrfRemoveConsumer,
  vrfRequest,
  functionsCreateSubscription,
  functionsGetSubscription,
  streamsListFeeds,
  streamsFetchReport,
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

  'ccip-get-message': async () => {
    const result = await ccipGetMessage(
      core.getInput('message-id', { required: true }),
      core.getInput('chain', { required: true }),
      {
        offramp: core.getInput('offramp', { required: true }),
        fromBlock: core.getInput('from-block') || '0',
        toBlock: core.getInput('to-block') || 'latest',
        rpcUrl: core.getInput('rpc-url') || undefined,
      },
    )
    setJsonOutput('result', result)
  },

  // ── VRF ───────────────────────────────────────────────────────

  'vrf-create-subscription': async () => {
    const result = await vrfCreateSubscription(core.getInput('chain', { required: true }), {
      rpcUrl: core.getInput('rpc-url') || undefined,
    })
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

  'vrf-remove-consumer': async () => {
    const result = await vrfRemoveConsumer(
      core.getInput('subscription-id', { required: true }),
      core.getInput('consumer-contract', { required: true }),
      core.getInput('chain', { required: true }),
      { rpcUrl: core.getInput('rpc-url') || undefined },
    )
    setJsonOutput('result', result)
  },

  'vrf-request': async () => {
    const result = await vrfRequest(core.getInput('chain', { required: true }), {
      consumerContract: core.getInput('consumer-contract', { required: true }),
      numWords: Number(core.getInput('num-words')) || 1,
      rpcUrl: core.getInput('rpc-url') || undefined,
    })
    setJsonOutput('result', result)
  },

  // ── Functions ─────────────────────────────────────────────────

  'functions-create-subscription': async () => {
    const result = await functionsCreateSubscription(core.getInput('chain', { required: true }), {
      rpcUrl: core.getInput('rpc-url') || undefined,
    })
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

  // ── Data Streams (Tier 4 — REST, not bridge) ──────────────────
  //
  // Data Streams is Chainlink's low-latency pull-based market data
  // product. Auth is HMAC-SHA256 with a client ID + secret issued by
  // Chainlink (separate from on-chain feed access).

  'streams-list-feeds': async () => {
    const result = await streamsListFeeds({
      clientId: core.getInput('streams-client-id', { required: true }),
      clientSecret: core.getInput('streams-client-secret', { required: true }),
      apiUrl: core.getInput('streams-api-url') || undefined,
    })
    setJsonOutput('result', result)
  },

  'streams-fetch-report': async () => {
    const timestampInput = core.getInput('timestamp')
    const result = await streamsFetchReport(core.getInput('feed-id', { required: true }), {
      clientId: core.getInput('streams-client-id', { required: true }),
      clientSecret: core.getInput('streams-client-secret', { required: true }),
      timestamp: timestampInput ? Number(timestampInput) : undefined,
      apiUrl: core.getInput('streams-api-url') || undefined,
    })
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
