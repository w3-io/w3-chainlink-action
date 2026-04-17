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

✅ **Functions subscription 640 on Base Sepolia**: 5 LINK, owned by
bridge signer `0xe4E40...e90`. Consumer deployed at
`0xf6e25c31057dF6A26b1e5acADB71C9bA8E16F822` (W3FunctionsConsumer,
source in `contracts/W3FunctionsConsumer.sol`).

✅ **Functions write path verified end-to-end.** `addConsumer` tx
`0x132c9eef…be57c12d`, `sendRequest` tx `0x119619cb…139e7523`.
DON fulfilled in ~10 seconds with response
`0x68656c6c6f2066726f6d207733` = `"hello from w3"`. Error bytes
empty. Source: `return Functions.encodeString("hello from w3")`.

## Cleared: protocol-side decoder fix (merged)

✅ **`vrf-get-subscription` bridge decoder bug** — fixed in protocol
PR #1726 (merged 2026-04-16). Root cause: `abi_decode()` vs
`abi_decode_params()` in `decode_result()`. The old method treated
multi-output tuples with dynamic tails as single wrapped values;
the fix uses the correct flat-sequence decoder. Action-side JSON
parse also fixed in this PR.

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

## v0.2.0 — Complete the product coverage ✅ (shipped)

- [x] `functions-request` — execute arbitrary JS source via Chainlink Functions DON (PR #8)
- [x] `ccip-get-message` — resolve CCIP message state via OffRamp event scan (PR #7)
- [x] `vrf-remove-consumer` — remove a consumer from a VRF subscription (PR #6)

## v0.3.0 — Polling and async patterns

- [ ] `ccip-wait-for-delivery` — poll destination chain for CCIP message finalization
- [ ] `vrf-wait-for-fulfillment` — poll for VRF callback event with random words
- [ ] `functions-wait-for-fulfillment` — poll for Functions response

## Improvements

- [x] `feed-address` input — bypass registry for unlisted feeds
- [ ] VRF Direct Funding — pay-per-request alternative to subscription model
- [x] Historical price data — `get-round-data` by round ID
- [ ] L2 Sequencer Uptime Feed — check if L2 sequencer is up before trusting prices
- [ ] Mainnet PoR feed expansion — currently only WBTC/BTC, add others as Chainlink deploys them
- [ ] `vrf-get-subscription` field parsing — owner and consumers return empty on some VRF v2.5 responses
