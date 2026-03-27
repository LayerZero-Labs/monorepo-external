// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { IBurnableMintable } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IBurnableMintable.sol";
import { IFundRecovery } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFundRecovery.sol";
import { IPause } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPause.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title IERC20Plus
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `ERC20Plus` contract.
 */
interface IERC20Plus is IBurnableMintable, IAllowlist, IPause, IFundRecovery, IERC20Metadata, IERC20Permit {
    /**
     * @notice Thrown when trying to recover funds from an allowlisted address.
     * @param user Address that is allowlisted
     */
    error CannotRecoverFromAllowlisted(address user);
}
