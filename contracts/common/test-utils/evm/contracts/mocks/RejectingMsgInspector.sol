// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspector.sol";

contract RejectingMsgInspector is IOAppMsgInspector {
    function inspect(
        address _sender,
        bytes calldata _message,
        bytes calldata _options
    ) external pure returns (bool /* accepted */) {
        revert InspectionFailed(_sender, _message, _options);
    }
}
