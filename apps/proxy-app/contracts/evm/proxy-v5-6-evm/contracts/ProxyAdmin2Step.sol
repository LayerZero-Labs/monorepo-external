// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import { IProxyAdmin2Step } from "./interfaces/IProxyAdmin2Step.sol";

/**
 * @title ProxyAdmin2Step
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice OZ's `ProxyAdmin` with `Ownable2Step` ownership transfers and disallowed renouncement.
 */
contract ProxyAdmin2Step is IProxyAdmin2Step, ProxyAdmin, Ownable2Step {
    constructor(address _initialOwner) ProxyAdmin(_initialOwner) {}

    /**
     * @inheritdoc Ownable2Step
     */
    function transferOwnership(address _newOwner) public virtual override(Ownable, Ownable2Step) {
        Ownable2Step.transferOwnership(_newOwner);
    }

    /**
     * @inheritdoc Ownable2Step
     */
    function _transferOwnership(address _newOwner) internal virtual override(Ownable, Ownable2Step) {
        Ownable2Step._transferOwnership(_newOwner);
    }

    /**
     * @dev Override to prevent renouncing ownership.
     * @inheritdoc Ownable
     */
    function renounceOwnership() public virtual override {
        revert CannotRenounceOwnership();
    }
}
