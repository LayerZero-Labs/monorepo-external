// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspector.sol";

contract WhitelistMsgInspector is IOAppMsgInspector {
    mapping(address user => bool isWhitelisted) public whitelist;

    function setWhitelisted(address _user, bool _isWhitelisted) external {
        whitelist[_user] = _isWhitelisted;
    }

    function inspect(
        address _sender,
        bytes calldata _message,
        bytes calldata _options
    ) external view returns (bool accepted) {
        if (!whitelist[_sender]) {
            revert InspectionFailed(_sender, _message, _options);
        }
        return true;
    }
}
