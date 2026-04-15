# E2E Test Results

> Last verified: 2026-04-15 -- YAML fixed, not yet run

## Prerequisites

| Credential | Env var | Source |
|-----------|---------|--------|
| Alchemy ETH RPC URL | `ALCHEMY_ETH_RPC` | Alchemy dashboard |
| Ethereum private key | `W3_SECRET_ETHEREUM` | Bridge signer (for VRF/CCIP/Functions) |

### On-chain requirements

VRF and CCIP commands require testnet funding with LINK tokens.

## Results

| # | Step | Command | Status | Notes |
|---|------|---------|--------|-------|
| 1 | Get price ETH/USD | `get-price` | NOT YET VERIFIED | chain: base |
| 2 | Get price BTC/USD | `get-price` | NOT YET VERIFIED | chain: base |
| 3 | Get feed info ETH/USD | `get-feed-info` | NOT YET VERIFIED | |
| 4 | List feeds | `list-feeds` | NOT YET VERIFIED | chain: base |
| 5 | Print price results | (run step) | NOT YET VERIFIED | |

## Skipped Commands

| Command | Reason |
|---------|--------|
| `por-get-reserves` | WBTC PoR feed ABI decoding fails |
| `ccip-estimate-fee` | Bridge tuple encoding issue |
| `ccip-send` | Requires funded wallet with LINK |
| `vrf-create-subscription` | Requires funded subscription |
| `vrf-get-subscription` | Depends on create |
| `vrf-fund-subscription` | Requires LINK tokens |
| `vrf-add-consumer` | Requires deployed consumer contract |
| `vrf-request` | Requires consumer + funded subscription |
| `functions-create-subscription` | Requires funded subscription |
| `functions-get-subscription` | Depends on create |

## How to run

```bash
# Export credentials
export ALCHEMY_ETH_RPC="..."

# Run
w3 workflow test --execute test/workflows/e2e.yaml
```
