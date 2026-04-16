// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Reference VRF v2.5 consumer used by `vrf-request` in this action.
//
// The action's `vrf-request` command calls `requestRandomWords(uint32 numWords)`
// on the consumer address you pass as `consumer-contract`. This minimal
// implementation is one way to satisfy that contract — you can substitute
// any consumer with the same public signature.
//
// Deployment (foundry):
//   forge install smartcontractkit/chainlink-brownie-contracts --shallow
//   forge create contracts/W3VRFConsumer.sol:W3VRFConsumer \
//     --rpc-url <RPC> --private-key $DEPLOYER \
//     --broadcast \
//     --constructor-args <COORDINATOR> <SUB_ID> <KEY_HASH>
//
// After deploying:
//   1. Add the deployed address as a consumer of your subscription:
//      (via cast)  cast send <COORDINATOR> "addConsumer(uint256,address)" <SUB_ID> <CONSUMER>
//      (via action) command: vrf-add-consumer
//   2. Trigger randomness:
//      command: vrf-request, with consumer-contract: <deployed address>
//   3. Read fulfillment from `s_lastRandomWords` (or your own handler).
//
// References:
//   - Chainlink VRF v2.5 docs: https://docs.chain.link/vrf/v2-5
//   - VRFConsumerBaseV2Plus: https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol

import {VRFConsumerBaseV2Plus} from
    "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from
    "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract W3VRFConsumer is VRFConsumerBaseV2Plus {
    uint256 public s_subscriptionId;
    bytes32 public s_keyHash;
    uint32 public s_callbackGasLimit = 100000;
    uint16 public s_requestConfirmations = 3;

    uint256 public s_lastRequestId;
    uint256[] public s_lastRandomWords;
    bool public s_lastRequestFulfilled;

    event RandomWordsRequested(uint256 indexed requestId);
    event RandomWordsFulfilled(uint256 indexed requestId, uint256[] randomWords);

    constructor(address coordinator, uint256 subscriptionId, bytes32 keyHash)
        VRFConsumerBaseV2Plus(coordinator)
    {
        s_subscriptionId = subscriptionId;
        s_keyHash = keyHash;
    }

    /// @notice Called by the action's `vrf-request` command. Anyone can
    /// trigger a request; fulfillment is written to contract state.
    function requestRandomWords(uint32 numWords) external returns (uint256 requestId) {
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: s_keyHash,
                subId: s_subscriptionId,
                requestConfirmations: s_requestConfirmations,
                callbackGasLimit: s_callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        s_lastRequestId = requestId;
        s_lastRequestFulfilled = false;
        emit RandomWordsRequested(requestId);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        s_lastRandomWords = randomWords;
        s_lastRequestFulfilled = true;
        emit RandomWordsFulfilled(requestId, randomWords);
    }

    function getLastRandomWords() external view returns (uint256[] memory) {
        return s_lastRandomWords;
    }
}
