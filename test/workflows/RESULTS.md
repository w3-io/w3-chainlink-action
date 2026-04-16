# E2E Test Results

> Last verified: 2026-04-16 (PoR + CCIP reads unblocked; sends code-fixed, await paid RPC)

## Prerequisites

The env var names below are what this repo's own E2E workflow reads.
In your own workflows, name secrets however you like; the fixed
contract is the action-input names (`pair`, `chain`, `source-chain`,
etc.), not the secret names.

| Credential        | Env var              | Source                              |
| ----------------- | -------------------- | ----------------------------------- |
| Ethereum RPC URL  | `ALCHEMY_ETH_RPC`    | Alchemy / Infura / any Ethereum RPC |
| Base RPC URL      | `ALCHEMY_BASE_RPC`   | Alchemy / Infura / any Base RPC     |
| Bridge signer key | `W3_SECRET_ETHEREUM` | EOA funded on target chains         |

The E2E file uses public RPCs (`ethereum-rpc.publicnode.com`,
`base-rpc.publicnode.com`) so the read steps work out-of-the-box.
Write commands (VRF/Functions/CCIP-send) need a paid RPC tier to
avoid the aggressive rate limits you see on public endpoints — public
RPCs throttle the second tx per job and the bridge's nonce tracker
ends up stuck on "already known" for subsequent runs.

## Results

### Price Feeds (read-only)

| #   | Step                  | Command         | Status | Notes       |
| --- | --------------------- | --------------- | ------ | ----------- |
| 1   | Get ETH/USD price     | `get-price`     | PASS   | chain: base |
| 2   | Get BTC/USD price     | `get-price`     | PASS   | chain: base |
| 3   | Get ETH/USD feed info | `get-feed-info` | PASS   |             |
| 4   | List feeds on Base    | `list-feeds`    | PASS   |             |

### Proof of Reserve (read-only)

| #   | Step              | Command            | Status | Notes                   |
| --- | ----------------- | ------------------ | ------ | ----------------------- |
| 5   | Get WBTC reserves | `por-get-reserves` | PASS   | 119,016.66 WBTC backing |

### CCIP — read-only

| #   | Step                                | Command             | Status | Notes                      |
| --- | ----------------------------------- | ------------------- | ------ | -------------------------- |
| 6   | Estimate fee base → ethereum        | `ccip-estimate-fee` | PASS   | ~0.000421 ETH (~$1) native |
| 7   | Estimate fee base-sepolia → sepolia | `ccip-estimate-fee` | PASS   | ~0.000235 ETH testnet      |

**Summary: 7/7 active read steps pass. Run wall time: ~9s.**

## Skipped Commands (by category)

### Bridge-signed on-chain writes — code-fixed but need paid RPC

| Command     | Reason                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ccip-send` | Code fix landed (tuple encoding + receipt unwrap). Live run on base-sepolia needs a paid RPC — public endpoints rate-limit before the tx lands, leaving the bridge's nonce tracker stuck. Verified one successful send during development (tx hash captured). |

### VRF — funded subscription required

| Command                   | Reason                               |
| ------------------------- | ------------------------------------ |
| `vrf-create-subscription` | Needs base wallet + testnet LINK     |
| `vrf-get-subscription`    | Depends on create                    |
| `vrf-fund-subscription`   | Needs LINK tokens on test account    |
| `vrf-add-consumer`        | Needs deployed consumer contract     |
| `vrf-request`             | Needs consumer + funded subscription |

Unblock at [vrf.chain.link](https://vrf.chain.link): create subscription
on Base Sepolia, fund with faucet LINK, deploy the consumer, add it,
then the commands are testable.

### Functions — funded subscription required

| Command                         | Reason                         |
| ------------------------------- | ------------------------------ |
| `functions-create-subscription` | Needs LINK-funded subscription |
| `functions-get-subscription`    | Depends on create              |

Unblock at [functions.chain.link](https://functions.chain.link) — same
story as VRF.

### Tier 4 — not implemented yet

| Command                | Reason                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `streams-fetch-report` | Data Streams not wrapped yet (REST API, needs Chainlink key) |
| `streams-list-feeds`   | Same                                                         |

## How to run

```bash
# No credentials needed for reads — public RPCs work.
w3 workflow test --execute test/workflows/e2e.yaml
```

For write commands when you have a paid RPC, export `W3_SECRET_ETHEREUM`
and start a local bridge:

```bash
W3_BRIDGE_SIGNER_ETHEREUM="$W3_SECRET_ETHEREUM" \
  w3 bridge serve --port 8232 --allow '*'

W3_BRIDGE_URL='http://host.docker.internal:8232' \
  w3 workflow test --execute test/workflows/e2e.yaml
```
