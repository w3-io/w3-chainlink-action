# Chainlink Integration Guide

## What is Chainlink?

Chainlink is a decentralized oracle network that connects smart contracts to real-world data, off-chain computation, and cross-chain messaging. This action exposes five Chainlink products as workflow commands: Price Feeds for market data, Proof of Reserve for asset backing verification, CCIP for cross-chain token and message transfers, VRF for cryptographically verifiable randomness, and Functions for arbitrary off-chain computation executed by a Decentralized Oracle Network (DON).

All commands interact with on-chain contracts via the W3 syscall bridge. The action's value is the built-in contract address registry -- it maps human-readable inputs (`pair: ETH/USD chain: ethereum`) to the correct contract address and ABI, then formats raw on-chain responses into clean JSON.

## Quick Start

```yaml
- uses: w3-io/w3-chainlink-action@v0
  id: price
  with:
    command: get-price
    pair: ETH/USD
    chain: ethereum

- run: |
    echo "ETH price: ${{ fromJSON(steps.price.outputs.result).price }}"
```

## Commands

### Price Feeds

#### `get-price`

Get the latest price from a Chainlink Data Feed.

| Input     | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `pair`    | string | Yes      | Price pair (e.g. "ETH/USD", "BTC/USD")       |
| `chain`   | string | Yes      | Target chain                                 |
| `rpc-url` | string | No       | Custom RPC URL (recommended for reliability) |

**Output:**

```json
{
  "pair": "ETH/USD",
  "chain": "ethereum",
  "price": "1905.23000000",
  "priceRaw": "190523000000",
  "decimals": 8,
  "roundId": "110680464442257310138",
  "updatedAt": "1712345700",
  "feedAddress": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
}
```

**Staleness check:** Compare `updatedAt` against the current time. For volatile assets, consider a threshold of 1 hour. For stablecoins, 24 hours is typical.

**Example:**

```yaml
- id: chainlink-price
  uses: w3-io/w3-chainlink-action@v0
  with:
    command: get-price
    pair: ETH/USD
    chain: ethereum

- run: |
    echo "Price: ${{ fromJSON(steps.chainlink-price.outputs.result).price }}"
    echo "Updated: ${{ fromJSON(steps.chainlink-price.outputs.result).updatedAt }}"
```

#### `get-feed-info`

Get metadata about a specific feed (description, decimals, address).

| Input     | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `pair`    | string | Yes      | Price pair                                   |
| `chain`   | string | Yes      | Target chain                                 |
| `rpc-url` | string | No       | Custom RPC URL (recommended for reliability) |

**Output:**

```json
{
  "pair": "ETH/USD",
  "chain": "ethereum",
  "feedAddress": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "description": "ETH / USD",
  "decimals": 8
}
```

#### `list-feeds`

List all registered feeds for a chain.

| Input   | Type   | Required | Description  |
| ------- | ------ | -------- | ------------ |
| `chain` | string | Yes      | Target chain |

**Output:** `{ chain, feeds: [{ pair, address }, ...], count }`

---

### Proof of Reserve

#### `por-get-reserves`

Get the latest reserve data from a Chainlink Proof of Reserve feed. Same AggregatorV3Interface as price feeds but the `reserves` field represents total reserves in base units (not a price).

| Input     | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `pair`    | string | Yes      | PoR feed identifier (e.g. "WBTC/BTC")        |
| `chain`   | string | Yes      | Target chain                                 |
| `rpc-url` | string | No       | Custom RPC URL (recommended for reliability) |

**Output:** Same shape as `get-price` but with `reserves` instead of `price`, plus a `description` field that typically contains "Reserves" or "PoR".

---

### CCIP (Cross-Chain Interoperability Protocol)

#### `ccip-estimate-fee`

Estimate the fee for a CCIP cross-chain transfer.

| Input               | Type   | Required | Description                                            |
| ------------------- | ------ | -------- | ------------------------------------------------------ |
| `source-chain`      | string | Yes      | Source chain                                           |
| `destination-chain` | string | Yes      | Destination chain                                      |
| `receiver`          | string | Yes      | Destination address                                    |
| `token-amounts`     | string | No       | JSON array of `[{token, amount}]` for token transfers  |
| `fee-token`         | string | No       | `"native"` (default), `"link"`, or a raw token address |
| `rpc-url`           | string | No       | Custom RPC URL (recommended for reliability)           |

**Output:** `{ sourceChain, destinationChain, fee, feeToken, router, destinationSelector }`

**Example:**

```yaml
- id: fee
  uses: w3-io/w3-chainlink-action@v0
  with:
    command: ccip-estimate-fee
    source-chain: ethereum
    destination-chain: arbitrum
    receiver: '0xReceiverAddress'

- run: |
    echo "Fee: ${{ fromJSON(steps.fee.outputs.result).fee }} wei"
```

#### `ccip-send`

Send a CCIP cross-chain message (optionally with tokens). **Write operation** requiring a signer key via `W3_SECRET_*`.

| Input               | Type   | Required | Description                                  |
| ------------------- | ------ | -------- | -------------------------------------------- |
| `source-chain`      | string | Yes      | Source chain                                 |
| `destination-chain` | string | Yes      | Destination chain                            |
| `receiver`          | string | Yes      | Destination address                          |
| `token-amounts`     | string | No       | JSON array for token transfers               |
| `fee-token`         | string | No       | `"native"` (default) or `"link"`             |
| `gas-limit`         | string | No       | Destination gas limit (default `200000`)     |
| `rpc-url`           | string | No       | Custom RPC URL (recommended for reliability) |

**Important:** When sending tokens, you must approve the CCIP Router to spend the token amounts before calling `ccip-send`.

**Output:** `{ status: "sent", txHash, fee, sourceChain, destinationChain, router, destinationSelector }`

Track delivery via the [CCIP Explorer](https://ccip.chain.link) using the returned message ID.

---

### VRF (Verifiable Random Function)

Chainlink VRF v2.5 provides cryptographically verifiable randomness. Requires a subscription funded with LINK or native tokens.

#### `vrf-create-subscription`

Create a new VRF subscription on the coordinator contract. **Write operation.**

| Input     | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `chain`   | string | Yes      | Target chain                                 |
| `rpc-url` | string | No       | Custom RPC URL (recommended for reliability) |

**Output:** `{ subscriptionId, txHash, coordinator, chain }`

#### `vrf-fund-subscription`

Fund a VRF subscription with native ETH via `fundSubscriptionWithNative`. No LINK approval needed. **Write operation.**

| Input             | Type   | Required | Description                                         |
| ----------------- | ------ | -------- | --------------------------------------------------- |
| `subscription-id` | string | Yes      | Subscription ID                                     |
| `chain`           | string | Yes      | Target chain                                        |
| `amount`          | string | Yes      | Amount in wei (e.g. `10000000000000000` = 0.01 ETH) |
| `rpc-url`         | string | No       | Custom RPC URL (recommended for reliability)        |

**Output:** `{ subscriptionId, amount, txHash, coordinator, chain }`

#### `vrf-add-consumer`

Whitelist a consumer contract on a subscription. **Write operation.**

| Input               | Type   | Required | Description                                  |
| ------------------- | ------ | -------- | -------------------------------------------- |
| `subscription-id`   | string | Yes      | Subscription ID                              |
| `consumer-contract` | string | Yes      | Consumer contract address                    |
| `chain`             | string | Yes      | Target chain                                 |
| `rpc-url`           | string | No       | Custom RPC URL (recommended for reliability) |

**Output:** `{ subscriptionId, consumer, txHash, coordinator, chain }`

#### `vrf-get-subscription`

Get subscription details including balance, consumers, and request count.

| Input             | Type   | Required | Description                                  |
| ----------------- | ------ | -------- | -------------------------------------------- |
| `subscription-id` | string | Yes      | Subscription ID                              |
| `chain`           | string | Yes      | Target chain                                 |
| `rpc-url`         | string | No       | Custom RPC URL (recommended for reliability) |

**Output:** `{ subscriptionId, chain, coordinator, balance, nativeBalance, requestCount, owner, consumers }`

#### `vrf-request`

Trigger a VRF v2.5 request by calling `requestRandomWords(uint32 numWords)` on a consumer contract you've deployed and registered as a consumer of the subscription. Fulfillment is asynchronous — the oracle calls back into your consumer's `fulfillRandomWords`.

| Input               | Type   | Required | Description                                     |
| ------------------- | ------ | -------- | ----------------------------------------------- |
| `chain`             | string | Yes      | Target chain                                    |
| `consumer-contract` | string | Yes      | Address of your VRF consumer contract           |
| `num-words`         | string | No       | Number of random words (default `1`, max `500`) |
| `rpc-url`           | string | No       | Custom RPC URL (recommended for reliability)    |

**Output:** `{ txHash, consumerContract, numWords, coordinator, chain }`

**Why via a consumer contract, not the coordinator directly?** VRF v2.5 requires `coordinator.requestRandomWords` to be called from a contract registered as a consumer on the subscription. An EOA (the bridge signer) cannot initiate a request directly, and even if it could, the randomness would be lost because EOAs don't implement `fulfillRandomWords`.

**Required consumer signature:** your contract must expose `function requestRandomWords(uint32 numWords) external returns (uint256)` and internally call the coordinator. The contract holds the subscription ID, key hash, callback gas limit, and confirmation count as constructor / storage values — the action only passes `numWords`. Minimal reference consumer in the action repo at `contracts/W3VRFConsumer.sol`.

---

### Functions

Chainlink Functions provides off-chain computation executed by a Decentralized Oracle Network (DON). Requires a subscription funded with LINK.

#### `functions-create-subscription`

Create a new Chainlink Functions subscription. The caller's address becomes the subscription owner. **Write operation.** Requires ToS acceptance on the Functions Router (via [functions.chain.link](https://functions.chain.link)).

| Input     | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `chain`   | string | Yes      | Target chain                                 |
| `rpc-url` | string | No       | Custom RPC URL (recommended for reliability) |

**Output:** `{ subscriptionId, txHash, router, chain }`

#### `functions-get-subscription`

Get subscription details including balance, owner, and consumer list.

| Input             | Type   | Required | Description                                  |
| ----------------- | ------ | -------- | -------------------------------------------- |
| `subscription-id` | string | Yes      | Subscription ID                              |
| `chain`           | string | Yes      | Target chain                                 |
| `rpc-url`         | string | No       | Custom RPC URL (recommended for reliability) |

**Output:** `{ subscriptionId, chain, router, balance, owner, consumers }`

---

## Authentication

No API key required. Read operations (price feeds, quotes, subscription lookups) work without signing. Write operations need the bridge signing secret:

```yaml
env:
  W3_SECRET_ETHEREUM: ${{ secrets.W3_SECRET_ETHEREUM }}
bridge-allow: [ethereum/call-contract]
```

## Supported Chains

| Chain     | Mainnet | Testnet          |
| --------- | ------- | ---------------- |
| Ethereum  | Yes     | Sepolia          |
| Base      | Yes     | Base Sepolia     |
| Arbitrum  | Yes     | Arbitrum Sepolia |
| Polygon   | Yes     | Amoy             |
| Avalanche | Yes     | Fuji             |
| Optimism  | Yes     | --               |

Not all products are available on all chains. Use `list-feeds` to check price feed availability. VRF key hashes are only registered for Ethereum and Sepolia.

## Error Codes

| Code                        | Meaning                                               |
| --------------------------- | ----------------------------------------------------- |
| `MISSING_CHAIN`             | `chain` input not provided                            |
| `UNSUPPORTED_CHAIN`         | Chain not in the registry for the requested product   |
| `MISSING_PAIR`              | `pair` input not provided                             |
| `UNKNOWN_FEED`              | Feed pair not found in registry                       |
| `MISSING_FEED`              | PoR feed identifier not provided                      |
| `MISSING_SUBSCRIPTION_ID`   | VRF or Functions subscription ID not provided         |
| `MISSING_AMOUNT`            | Amount not provided for fund operations               |
| `MISSING_CONSUMER`          | Consumer contract address not provided                |
| `MISSING_KEY_HASH`          | No VRF key hash registered for the target chain       |
| `MISSING_SOURCE_CHAIN`      | CCIP source chain not provided                        |
| `MISSING_DESTINATION_CHAIN` | CCIP destination chain not provided                   |
| `MISSING_RECEIVER`          | CCIP receiver address not provided                    |
| `UNKNOWN_LINK_TOKEN`        | No LINK token address registered for the source chain |
| `BRIDGE_ERROR`              | Bridge call failed                                    |

## Future Work

Features not included in v0.1.0:

- **Data Streams** -- Chainlink's low-latency pull-based data feeds for DeFi. Requires a REST API key and on-chain report verification. The registry already has placeholder infrastructure (`feed-id`, `api-key` inputs in action.yml) but the command handlers are not yet implemented.
- **Functions request execution** -- `functions-send-request` to submit JavaScript source code for DON execution. Subscription management is implemented; request dispatch is the next step.
- **VRF fulfillment polling** -- `vrf-wait-for-fulfillment` to poll until random words are delivered. Currently returns the request tx hash; callers must check fulfillment externally.
- **CCIP delivery tracking** -- `ccip-get-message` to check cross-chain message delivery status via the CCIP Explorer API.
