// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { AllowlistRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/allowlist/AllowlistRBACUpgradeable.sol";
import { PauseByIDRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/pause-by-id/PauseByIDRBACUpgradeable.sol";
import { INexusERC20Guard } from "./interfaces/INexusERC20Guard.sol";

/**
 * @title NexusERC20Guard
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable contract providing shared allowlist and pause functionality for multiple `NexusERC20` tokens.
 * @dev Deployed once and referenced by N `NexusERC20` contracts via `checkTransfer`.
 *      Roles are handled through `AccessControl2StepUpgradeable`.
 */
contract NexusERC20Guard is INexusERC20Guard, AllowlistRBACUpgradeable, PauseByIDRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract with open allowlist mode.
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE`
     */
    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
        __AllowlistBase_init(AllowlistMode.Open);
    }

    /**
     * @inheritdoc INexusERC20Guard
     */
    function checkTransfer(address _token, address _caller, address _from, address _to, uint256) external view virtual {
        _assertNotPaused(uint160(_token));
        if (_caller != address(0)) _assertAllowlisted(_caller);
        if (_from != address(0)) _assertAllowlisted(_from);
        if (_to != address(0)) _assertAllowlisted(_to);
    }

    /**
     * @notice Internal function to assert that an address is allowlisted.
     * @param _user Address to check
     */
    function _assertAllowlisted(address _user) internal view virtual {
        if (!isAllowlisted(_user)) revert NotAllowlisted(_user, allowlistMode());
    }
}
