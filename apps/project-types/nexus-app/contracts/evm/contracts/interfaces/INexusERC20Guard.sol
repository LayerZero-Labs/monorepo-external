// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";

/**
 * @title INexusERC20Guard
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the shared guard contract that provides allowlist and pause functionality for
 *         multiple `NexusERC20` tokens.
 */
interface INexusERC20Guard is IAllowlist, IPauseByID {
    /**
     * @notice Validates a transfer operation against pause and allowlist rules.
     * @dev Reverts if the token is paused or any non-zero address is not allowlisted.
     * @param _token Token being transferred (used as pause ID)
     * @param _caller The address initiating the transaction
     * @param _from The address tokens are transferred from
     * @param _to The address tokens are transferred to
     * @param _amount The amount of tokens being transferred (reserved for future extensions)
     */
    function checkTransfer(address _token, address _caller, address _from, address _to, uint256 _amount) external view;
}
