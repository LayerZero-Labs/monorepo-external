// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IBurnableMintable } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IBurnableMintable.sol";
import { IFundRecovery } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFundRecovery.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { INexusERC20Guard } from "./INexusERC20Guard.sol";

/**
 * @title INexusERC20
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `NexusERC20` contract.
 */
interface INexusERC20 is IBurnableMintable, IFundRecovery, IERC20Metadata, IERC20Permit {
    /**
     * @notice Emitted when the guard contract is set.
     * @param guard New guard address
     */
    event GuardSet(address indexed guard);

    /**
     * @notice Thrown when trying to set an invalid guard address.
     */
    error InvalidGuardAddress();

    /**
     * @notice Thrown when trying to recover funds from an allowlisted address.
     * @param user Address that is allowlisted
     */
    error CannotRecoverFromAllowlisted(address user);

    /**
     * @notice Returns the guard contract.
     * @return guard Guard contract
     */
    function getGuard() external view returns (INexusERC20Guard guard);

    /**
     * @notice Sets the guard contract.
     * @param _guard New guard address
     */
    function setGuard(address _guard) external;
}
