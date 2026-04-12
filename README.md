# W3 Chainlink Action

Chainlink on-chain primitives for W3 workflows — price feeds, CCIP cross-chain transfers, VRF randomness, proof of reserve, and Functions off-chain compute. 13 commands across 5 products, targeting the full Chainlink-supported chain catalog.

## Quick start

```yaml
# Get ETH/USD price from Chainlink
- uses: w3-io/w3-chainlink-action@v0
  id: price
  with:
    command: get-price
    pair: ETH/USD
    chain: ethereum

- if: ${{ fromJSON(steps.price.outputs.result).price < '1900' }}
  run: echo "ETH below $1900 — consider buying"
```

## How this action works

Unlike REST-based partner actions (BitGo, Stripe, etc.), Chainlink products are **smart contracts you read from or call**. This action uses the W3 syscall bridge to interact with those contracts, hiding the contract addresses, ABIs, and chain-specific quirks behind a clean YAML surface.

The workflow author says `pair: ETH/USD chain: ethereum` and the action looks up the right Chainlink feed address, calls `latestRoundData()` via the bridge, formats the response, and returns a structured result.

## Commands

| Group                | Commands                                                                             |
| -------------------- | ------------------------------------------------------------------------------------ |
| **Price Feeds**      | `get-price`, `get-feed-info`, `list-feeds`                                           |
| **Proof of Reserve** | `por-get-reserves`                                                                   |
| **CCIP**             | `ccip-estimate-fee`, `ccip-send`                                                     |
| **VRF**              | `vrf-create-subscription`, `vrf-fund-subscription`, `vrf-add-consumer`, `vrf-get-subscription`, `vrf-request` |
| **Functions**        | `functions-create-subscription`, `functions-get-subscription`                        |

## Inputs

| Input                                | Required          | Notes                                                                                                |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `command`                            | yes               | One of the commands above.                                                                           |
| `chain`                              | depends           | Target chain: `ethereum`, `sepolia`, `base`, `arbitrum`, `polygon`, `avalanche`, and their testnets. |
| `pair`                               | for feeds         | Price pair (e.g. `ETH/USD`, `BTC/USD`).                                                              |
| `feed-address`                       | no                | Direct contract address — bypasses the built-in registry for unlisted feeds.                         |
| `source-chain` / `destination-chain` | for CCIP          | Source and destination chains.                                                                       |
| `receiver`                           | for CCIP          | Destination address.                                                                                 |
| `subscription-id`                    | for VRF/Functions | Subscription ID.                                                                                     |

See [`docs/guide.md`](docs/guide.md) for the full per-command reference.

## Outputs

A single `result` output, always a JSON string. Parse with `fromJSON()`:

```yaml
- run: |
    echo "price = ${{ fromJSON(steps.price.outputs.result).price }}"
    echo "decimals = ${{ fromJSON(steps.price.outputs.result).decimals }}"
```

## Chain coverage

The feed registry covers the most popular feeds across:

| Chain     | Feeds | CCIP | VRF | Functions |
| --------- | ----- | ---- | --- | --------- |
| Ethereum  | 16    | ✅   | ✅  | ✅        |
| Sepolia   | 5     | ✅   | ✅  | ✅        |
| Base      | 5     | ✅   | ✅  | ✅        |
| Arbitrum  | 5     | ✅   | ✅  | ✅        |
| Polygon   | 5     | ✅   | ✅  | ✅        |
| Avalanche | 5     | ✅   | ✅  | ✅        |

Workflow authors who need feeds not in the curated list can pass the contract address directly via `feed-address`.

## Authentication

**No API key needed** for price feeds, PoR, VRF, or CCIP. These are permissionless on-chain operations.

**Signing operations** (CCIP send, VRF requests, subscription management) require a signer key configured in the W3 protocol via `W3_SECRET_*` environment variables. The bridge handles signing — no private keys in the workflow YAML.

**Data Streams** (not yet implemented) will require a paid Chainlink subscription + API key.

## Registry verification

The action ships with a `scripts/verify-registry.mjs` that validates all contract addresses against live RPC. Run it periodically to catch deprecated feeds:

```bash
node scripts/verify-registry.mjs --chain ethereum
```

## Status

v0.1.0 — 11 commands across 5 products. 37 mocked unit tests. Registry verified against live Ethereum mainnet RPC.

## License

GPL-3.0
