# W3 Chainlink Action — Reference Guide

On-chain primitives for DeFi workflows. 11 commands across 5 Chainlink products: Price Feeds, Proof of Reserve, CCIP cross-chain messaging, VRF verifiable randomness, and Functions off-chain compute.

## Architecture

This action uses the **W3 syscall bridge** rather than HTTP calls. Chainlink products are smart contracts, so the action makes `bridge.chain('ethereum', 'read-contract', ...)` and `bridge.chain('ethereum', 'call-contract', ...)` calls under the hood.

The action's value is the **contract address registry** — it maps human-readable inputs (`pair: ETH/USD chain: ethereum`) to the right contract address and ABI, then formats the raw on-chain response into a clean JSON output.

For feeds not in the curated registry, use the `feed-address` input to pass a contract address directly.

## Common inputs

| Input     | Required          | Notes                                                                                                |
| --------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `command` | yes               | One of the commands below.                                                                           |
| `chain`   | for most commands | Target chain: `ethereum`, `sepolia`, `base`, `arbitrum`, `polygon`, `avalanche`, and their testnets. |

## Errors

| Code                                                 | Meaning                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `MISSING_CHAIN`                                      | `chain` input not provided.                                                                         |
| `UNSUPPORTED_CHAIN`                                  | Chain not in the registry.                                                                          |
| `MISSING_PAIR` / `UNKNOWN_FEED`                      | Feed pair not recognized. Use `list-feeds` to see available pairs, or pass `feed-address` directly. |
| `MISSING_SUBSCRIPTION_ID`                            | VRF/Functions subscription ID not provided.                                                         |
| `MISSING_KEY_HASH`                                   | No VRF key hash registered for the target chain.                                                    |
| `MISSING_SOURCE_CHAIN` / `MISSING_DESTINATION_CHAIN` | CCIP source or destination chain not provided.                                                      |
| `MISSING_RECEIVER`                                   | CCIP receiver address not provided.                                                                 |

---

## Price Feeds

### `get-price`

Get the latest price from a Chainlink Data Feed.

| Input          | Required | Description                                 |
| -------------- | -------- | ------------------------------------------- |
| `pair`         | yes      | Price pair (e.g. `ETH/USD`, `BTC/USD`)      |
| `chain`        | yes      | Target chain                                |
| `feed-address` | no       | Direct contract address (bypasses registry) |

**Output:**

```jsonc
{
  "pair": "ETH/USD",
  "chain": "ethereum",
  "price": "1905.23000000", // human-readable, decimal-formatted
  "priceRaw": "190523000000", // raw int256 from the contract
  "decimals": 8,
  "roundId": "110680464442257310138",
  "updatedAt": "1712345700",
  "feedAddress": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
}
```

**Staleness check:** Compare `updatedAt` against the current time. For volatile assets, consider a threshold of 1 hour. For stablecoins, 24 hours is typical. If the feed is stale, the price may not reflect current market conditions.

### `get-feed-info`

Get metadata about a specific feed (description, decimals, address).

| Input   | Required | Description  |
| ------- | -------- | ------------ |
| `pair`  | yes      | Price pair   |
| `chain` | yes      | Target chain |

### `list-feeds`

List all registered feeds for a chain.

| Input   | Required | Description  |
| ------- | -------- | ------------ |
| `chain` | yes      | Target chain |

**Output:** `{ chain, feeds: [{ pair, address }, ...], count }`.

---

## Proof of Reserve

### `por-get-reserves`

Get the latest reserve data from a Chainlink Proof of Reserve feed. Same interface as price feeds — the `reserves` field represents total reserves (not a price).

| Input   | Required | Description                           |
| ------- | -------- | ------------------------------------- |
| `pair`  | yes      | PoR feed identifier (e.g. `WBTC/BTC`) |
| `chain` | yes      | Target chain                          |

**Output:** same shape as `get-price` but with `reserves` instead of `price`, plus a `description` field that typically contains "Reserves" or "PoR".

---

## CCIP (Cross-Chain Interoperability Protocol)

### `ccip-estimate-fee`

Estimate the fee for a CCIP cross-chain transfer.

| Input               | Required | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `source-chain`      | yes      | Source chain                                           |
| `destination-chain` | yes      | Destination chain                                      |
| `receiver`          | yes      | Destination address                                    |
| `token-amounts`     | no       | JSON array of `[{token, amount}]` for token transfers  |
| `fee-token`         | no       | `"native"` (default), `"link"`, or a raw token address |

**Output:** `{ sourceChain, destinationChain, fee, feeToken, router, destinationSelector }`.

### `ccip-send`

Send a CCIP cross-chain message (optionally with tokens). This is a **write operation** — requires a signer key via `W3_SECRET_*`.

| Input               | Required | Description                              |
| ------------------- | -------- | ---------------------------------------- |
| `source-chain`      | yes      | Source chain                             |
| `destination-chain` | yes      | Destination chain                        |
| `receiver`          | yes      | Destination address                      |
| `token-amounts`     | no       | JSON array for token transfers           |
| `fee-token`         | no       | `"native"` (default) or `"link"`         |
| `gas-limit`         | no       | Destination gas limit (default `200000`) |

**Important:** When sending tokens, you must **approve the CCIP Router** to spend the token amounts before calling `ccip-send`. Use a native `ethereum:` chain step to call `approve()` on the token contract with the router address returned by `ccip-estimate-fee`.

**Output:** `{ status: "sent", messageId, sourceChain, destinationChain, router, destinationSelector }`.

Track delivery via the [CCIP Explorer](https://ccip.chain.link) using the returned `messageId`.

---

## VRF (Verifiable Random Function)

Chainlink VRF v2.5 provides cryptographically verifiable randomness. Requires a subscription funded with LINK or native tokens.

### `vrf-create-subscription`

Create a new VRF subscription on the coordinator contract. **Write operation.**

| Input   | Required | Description  |
| ------- | -------- | ------------ |
| `chain` | yes      | Target chain |

**Output:** `{ subscriptionId, coordinator, chain }`.

After creating, fund the subscription via the [VRF subscription manager](https://vrf.chain.link).

### `vrf-get-subscription`

Get subscription details — balance, consumers, request count.

| Input             | Required | Description     |
| ----------------- | -------- | --------------- |
| `subscription-id` | yes      | Subscription ID |
| `chain`           | yes      | Target chain    |

**Output:** `{ subscriptionId, chain, coordinator, balance, nativeBalance, requestCount, owner, consumers }`.

### `vrf-fund-subscription`

Fund a VRF subscription with native ETH. Uses `fundSubscriptionWithNative` — no LINK approval needed. **Write operation.**

| Input             | Required | Description                                         |
| ----------------- | -------- | --------------------------------------------------- |
| `subscription-id` | yes      | Subscription ID                                     |
| `amount`          | yes      | Amount in wei (e.g. `10000000000000000` = 0.01 ETH) |
| `chain`           | yes      | Target chain                                        |

**Output:** `{ subscriptionId, amount, txHash, coordinator, chain }`.

### `vrf-add-consumer`

Whitelist a consumer contract on a subscription. **Write operation.**

| Input               | Required | Description               |
| ------------------- | -------- | ------------------------- |
| `subscription-id`   | yes      | Subscription ID           |
| `consumer-contract` | yes      | Consumer contract address |
| `chain`             | yes      | Target chain              |

### `vrf-request`

Request random words from VRF v2.5. Returns a request ID for tracking.

| Input                   | Required | Description                                                   |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `chain`                 | yes      | Target chain (must have a registered key hash)                |
| `subscription-id`       | yes      | Funded subscription ID                                        |
| `num-words`             | no       | Number of random words (default `1`, max `500`)               |
| `callback-gas-limit`    | no       | Gas limit for the fulfillment callback (default `100000`)     |
| `request-confirmations` | no       | Block confirmations before fulfillment (default `3`, min `3`) |

**Output:** `{ requestId, subscriptionId, numWords, coordinator, chain }`.

**Callback gas limit tip:** Each random word costs ~20,000 gas to store. Start with `100000 + 20000 * numWords`.

---

## Functions

Chainlink Functions provides off-chain computation executed by a Decentralized Oracle Network (DON). Requires a subscription funded with LINK.

### `functions-create-subscription`

Create a new Chainlink Functions subscription. The caller's address becomes the subscription owner. **Write operation.** Requires ToS acceptance on the Functions Router (via [functions.chain.link](https://functions.chain.link)).

| Input   | Required | Description  |
| ------- | -------- | ------------ |
| `chain` | yes      | Target chain |

**Output:** `{ subscriptionId, txHash, router, chain }`.

### `functions-get-subscription`

Get subscription details — balance, owner, consumers.

| Input             | Required | Description     |
| ----------------- | -------- | --------------- |
| `subscription-id` | yes      | Subscription ID |
| `chain`           | yes      | Target chain    |

**Output:** `{ subscriptionId, chain, router, balance, owner, consumers }`.

---

## Testing

### Mocked unit tests

```bash
npm test    # 37 tests covering registry lookups, parameter formatting, error handling
```

### Registry verification

Validate that all contract addresses in the registry are live and responding:

```bash
node scripts/verify-registry.mjs --chain ethereum
node scripts/verify-registry.mjs --chain sepolia
```

Uses raw JSON-RPC calls — no bridge or W3 node needed. Catches deprecated feeds and wrong addresses.

### Live integration (requires W3 node)

The action uses the W3 bridge for all on-chain calls. Full end-to-end testing requires a running W3 node with the bridge available at `W3_BRIDGE_URL` or `W3_BRIDGE_SOCKET`. Deploy a test workflow that calls `get-price` and verify the result matches Etherscan.

---

## Cookbook recipes

- **DeFi liquidation guard** — Chainlink price feed triggers a BitGo treasury top-up when collateral ratio drops
- **Cross-chain rebalance** — CCIP moves USDC between chains based on yield conditions
- **Provably fair airdrop** — VRF selects random winners from a participant list

See the [W3 MCP cookbook](https://github.com/w3-io/w3-mcp/tree/master/content/cookbook) for complete workflow YAML.
