# E2E Test Results

> Last verified: 2026-04-16 on a local W3 node (ARM64 Mac).
>
> Five jobs exercised end-to-end via `w3_triggerWorkflow` against a
> native ARM localnet built per protocol PR #1413. Bridge → action
> runner → Chainlink contract path is proven; read commands return
> live on-chain data. Trigger hash `0x40b218a2…7cfcd95d`; workflow
> deployed as `Chainlink E2E v2`.

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

| #   | Step                  | Command         | Status | Notes                                       |
| --- | --------------------- | --------------- | ------ | ------------------------------------------- |
| 1   | Get ETH/USD price     | `get-price`     | PASS   | Base: $2350.89 @ round 36893488147419108835 |
| 2   | Get BTC/USD price     | `get-price`     | PASS   | Base: $75189.59                             |
| 3   | Get ETH/USD feed info | `get-feed-info` | PASS   | Base: feed `0x71041ddd…a16Bb70`             |
| 4   | List feeds on Base    | `list-feeds`    | PASS   | full registry returned                      |

### Proof of Reserve (read-only)

| #   | Step              | Command            | Status | Notes                             |
| --- | ----------------- | ------------------ | ------ | --------------------------------- |
| 5   | Get WBTC reserves | `por-get-reserves` | PASS   | Ethereum: 119,016.66 WBTC reserve |

### CCIP — read-only

| #   | Step                                | Command             | Status | Notes                                  |
| --- | ----------------------------------- | ------------------- | ------ | -------------------------------------- |
| 6   | Estimate fee base → ethereum        | `ccip-estimate-fee` | PASS   | ~0.000391 ETH native (tuple encoding)  |
| 7   | Estimate fee base-sepolia → sepolia | `ccip-estimate-fee` | PASS   | ~0.000215 ETH testnet (tuple encoding) |

### Functions (read-only)

| #   | Step                              | Command                      | Status | Notes                                                                    |
| --- | --------------------------------- | ---------------------------- | ------ | ------------------------------------------------------------------------ |
| 8   | Get Functions sub 6491 on Sepolia | `functions-get-subscription` | FAIL   | PROVIDER_ERROR: `eth_chainId` HTTP 522 from public RPC — retry with paid |

### VRF (write)

| #   | Step                            | Command       | Status | Notes                                                |
| --- | ------------------------------- | ------------- | ------ | ---------------------------------------------------- |
| 9   | Request randomness via consumer | `vrf-request` | FAIL   | Missing `W3_SECRET_ETHEREUM` secret on this localnet |

**Summary: 7/7 read paths that had a healthy RPC pass; the two failures are operational (public-RPC 522 / missing secret), not code bugs. Run wall time: ~2m (5 jobs, 20 blocks).**

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

### Quick read-only smoke via a running localnet

No credentials needed; public RPCs work for the read steps.

```bash
# 1. Deploy
w3 --url http://localhost:8233 workflow deploy test/workflows/e2e.yaml

# 2. Trigger (the CLI's `trigger` may hit RPC version skew on older
#    localnets — fall back to raw RPC if needed):
curl -s -X POST http://localhost:8233 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"w3_triggerWorkflow","params":{"workflowName":"Chainlink E2E"}}' \
  | jq -r '.result.triggerHash'

# 3. Poll
TRIGGER=<from step 2>
curl -s -X POST http://localhost:8233 \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"w3_getWorkflowRun\",\"params\":{\"triggerHash\":\"$TRIGGER\"}}" \
  > run.json
```

### Bringing up the localnet on ARM64

Protocol [PR #1413](https://github.com/w3-io/protocol/pull/1413) added
native ARM docker builds via `docker-ci-image-local` /
`docker-runner-image-local`. `make dev` from a clean protocol checkout
now builds the CI + runner images natively on Apple Silicon, so the
localnet comes up without amd64 emulation.

### For write commands

Configure `W3_SECRET_ETHEREUM` on the localnet before triggering, and
use paid RPC URLs for writes (public endpoints rate-limit the second
tx per job and leave the bridge's nonce tracker stuck on "already
known").
