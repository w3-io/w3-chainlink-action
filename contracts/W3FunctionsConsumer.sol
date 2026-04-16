// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Reference Chainlink Functions consumer used by `functions-request`
// in this action.
//
// The action calls `sendRequest(string source, string[] args)` on the
// address you pass as `consumer-contract`. This minimal implementation
// satisfies that contract — substitute any consumer with the same
// public signature.
//
// Deployment (foundry):
//   forge install smartcontractkit/chainlink-brownie-contracts --shallow
//   forge create contracts/W3FunctionsConsumer.sol:W3FunctionsConsumer \
//     --rpc-url <RPC> --private-key $DEPLOYER \
//     --broadcast \
//     --constructor-args <ROUTER> <SUB_ID> <DON_ID_BYTES32>
//
// DON_ID_BYTES32 is the bytes32 encoding of the string DON ID:
//   cast format-bytes32-string fun-ethereum-sepolia-1
//     -> 0x66756e2d657468657265756d2d7365706f6c69612d31000000000000000000
//
// After deploying:
//   1. Add as a consumer on your Functions subscription:
//      - via Chainlink Functions UI: functions.chain.link
//      - via cast: router.addConsumer(subId, consumer) — but note the
//        router requires subscription owner auth, so this only works
//        from the wallet that created the sub.
//   2. Trigger a request via:
//      command: functions-request, with consumer-contract, source-code,
//      and (optional) args.
//   3. Read fulfillment from `s_lastResponse` / `s_lastError` once the
//      DON call returns (typically 1–3 blocks after the source-side
//      tx).
//
// References:
//   - Chainlink Functions docs: https://docs.chain.link/chainlink-functions
//   - FunctionsClient base: https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol

import {FunctionsClient} from
    "chainlink-brownie-contracts/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from
    "chainlink-brownie-contracts/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";

contract W3FunctionsConsumer is FunctionsClient {
    using FunctionsRequest for FunctionsRequest.Request;

    uint64 public s_subscriptionId;
    bytes32 public s_donId;
    uint32 public s_callbackGasLimit = 300_000;

    bytes32 public s_lastRequestId;
    bytes public s_lastResponse;
    bytes public s_lastError;
    bool public s_lastRequestFulfilled;

    event RequestSent(bytes32 indexed requestId);
    event RequestFulfilled(bytes32 indexed requestId, bytes response, bytes err);

    constructor(address router, uint64 subId, bytes32 donId) FunctionsClient(router) {
        s_subscriptionId = subId;
        s_donId = donId;
    }

    /// @notice Called by the action's `functions-request` command.
    /// Anyone can trigger a request; fulfillment lands on this contract.
    function sendRequest(string calldata source, string[] calldata args)
        external
        returns (bytes32 requestId)
    {
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);
        if (args.length > 0) req.setArgs(args);
        requestId = _sendRequest(req.encodeCBOR(), s_subscriptionId, s_callbackGasLimit, s_donId);
        s_lastRequestId = requestId;
        s_lastRequestFulfilled = false;
        emit RequestSent(requestId);
    }

    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err)
        internal
        override
    {
        s_lastResponse = response;
        s_lastError = err;
        s_lastRequestFulfilled = true;
        emit RequestFulfilled(requestId, response, err);
    }
}
