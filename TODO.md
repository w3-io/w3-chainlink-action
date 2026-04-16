# TODO

## Infrastructure now in place

✅ **Paid Alchemy RPCs**: `W3_RPC_BASE_SEPOLIA`, `W3_RPC_ETHEREUM_SEPOLIA`,
`W3_RPC_BASE`, `W3_RPC_ETHEREUM` all set as repo secrets. Use these instead
of public RPCs to avoid rate limits.

✅ **VRF subscription on Ethereum Sepolia**:
`71807528537906860133404221822604258614766191788723848022770699723800904247411`
(stored as repo var `CHAINLINK_VRF_SUB_ID`). Funded with 4 LINK, owned by
the bridge signer `0xe4E40...e90`. Consumer added:
`0x292D6d64603Dc555541E6aa8Db19Ed145479D241` (W3VRFConsumer, source in
`contracts/W3VRFConsumer.sol`).

✅ **VRF write path verified on-chain.** `addConsumer` tx
`0x9405fae6…985ed6f2`, `requestRandomWords` tx `0x095bd846…6f7b92a`
(request ID `47887014…445422`). `RandomWordsRequested` event emitted
from the coordinator at block 10673234; Sepolia VRF oracle fulfillment
is asynchronous and can take 5–20+ min. Read `s_lastRequestFulfilled()`
on the consumer to check.

⚠️ **Functions subscription 6491**: owned by `0xbF0B95...1cBE`, not the
bridge signer. `functions-get-subscription` (read-only) works against
it. Write-path exercise (`functions-create-subscription` from our
signer) is pending a path decision — either fresh sub from our signer
or ask the `0xbF0B95` wallet to `addConsumer` a signer-owned consumer.

## Blocked on protocol-side fix

- [ ] **`vrf-get-subscription` bridge decoder bug.** The return tuple
      `(uint96, uint96, uint64, address, address[])` trips the bridge's
      alloy-based decoder with "buffer overrun while deserializing" on
      the dynamic `address[] consumers` tail. Passing the full ABI JSON
      via `abi: ...` didn't help. Verified via raw `cast call` that the
      on-chain return is well-formed. Filing a protocol issue would be
      the right next step.

## Blocked on external state

- [ ] **`ccip-send`.** Code is fixed (tuple encoding + receipt
      unwrap). One successful send verified during development on Base
      Sepolia. Subsequent attempts return "already known" /
      "replacement transaction underpriced" from Alchemy's mempool
      protection, even though `eth_getTransactionCount` reports no
      pending tx. Typically clears after the original tx drops from
      the mempool. Retry in a fresh session or bump gas price to
      force-replace.

## Blocked on onboarding

- [ ] **Data Streams live verification.** Code implemented in PR #3
      (12 unit tests pass, HMAC auth validated). Waiting on Chainlink
      to issue client ID + client secret. When they arrive, live-run
      `streams-list-feeds` and `streams-fetch-report` against
      `api.testnet-dataengine.chain.link` and update RESULTS.md.

## v0.2.0 — Complete the product coverage

- [ ] `functions-request` — execute arbitrary JS source via Chainlink Functions DON
- [ ] `ccip-get-message` — read CCIP message status from OnRamp by message ID
- [ ] `vrf-remove-consumer` — remove a consumer from a VRF subscription

## v0.3.0 — Polling and async patterns

- [ ] `ccip-wait-for-delivery` — poll destination chain for CCIP message finalization
- [ ] `vrf-wait-for-fulfillment` — poll for VRF callback event with random words
- [ ] `functions-wait-for-fulfillment` — poll for Functions response

## v0.4.0 — Data Streams

- [ ] `streams-fetch-report` — fetch real-time market data report (REST, needs API key)
- [ ] `streams-list-feeds` — list available Data Streams feeds (REST, needs API key)

## Improvements

- [ ] `feed-address` input — bypass registry for unlisted feeds (declared in action.yml, not wired)
- [ ] VRF Direct Funding — pay-per-request alternative to subscription model
- [ ] Historical price data — `get-round-data` by round ID (ABI exists in registry)
- [ ] L2 Sequencer Uptime Feed — check if L2 sequencer is up before trusting prices
- [ ] Mainnet PoR feed expansion — currently only WBTC/BTC, add others as Chainlink deploys them
- [ ] `vrf-get-subscription` field parsing — owner and consumers return empty on some VRF v2.5 responses
