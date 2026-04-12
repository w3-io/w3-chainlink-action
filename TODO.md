# TODO

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
