// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppExtended } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppExtended.sol";
import {
    SendParam,
    OFTLimit,
    OFTReceipt,
    OFTFeeDetail,
    MessagingReceipt,
    MessagingFee
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { IFeeHandler } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeHandler.sol";
import { INexusFeeConfig } from "./INexusFeeConfig.sol";
import { INexusPause } from "./INexusPause.sol";
import { INexusRateLimiter } from "./INexusRateLimiter.sol";
import { IOFTRegistry } from "./IOFTRegistry.sol";

/**
 * @title INexus
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `Nexus` contract.
 */
interface INexus is IOAppExtended, IOFTRegistry, IFeeHandler {
    // ============ Events ============

    /**
     * @notice Emitted when the pause module is set.
     * @param module Pause module address
     */
    event PauseModuleSet(address indexed module);

    /**
     * @notice Emitted when the fee config module is set.
     * @param module Fee config module address
     */
    event FeeConfigModuleSet(address indexed module);

    /**
     * @notice Emitted when the rate limiter module is set.
     * @param module Rate limiter module address
     */
    event RateLimiterModuleSet(address indexed module);

    // ============ View Functions ============

    /**
     * @notice Computes the unique identifier for a token-pathway pair by concatenating token ID and EID.
     * @dev Nexus ID is a 64-bit integer safe to be stored in a `uint64` variable, it's stored here as a `uint256` to
     *      avoid casting up and down in extensions.
     * @param _tokenId Unique token identifier
     * @param _eid LayerZero endpoint ID
     * @return nexusId Unique Nexus identifier used for rate limiting and fees
     */
    function getNexusId(uint32 _tokenId, uint32 _eid) external view returns (uint256 nexusId);

    /**
     * @notice Returns the pause module address.
     * @return module Pause module
     */
    function pauseModule() external view returns (INexusPause module);

    /**
     * @notice Returns the fee config module address.
     * @return module Fee config module
     */
    function feeConfigModule() external view returns (INexusFeeConfig module);

    /**
     * @notice Returns the rate limiter module address.
     * @return module Rate limiter module
     */
    function rateLimiterModule() external view returns (INexusRateLimiter module);

    /**
     * @notice Provides a quote for OFT-related information based on the send parameters.
     * @dev Only callable by registered OFT contracts.
     * @dev Includes fee details as any difference between the amount sent and received.
     * @dev Applies extension rules to specify the maximum amount that can be sent, but does not apply user-specific
     *      rules or privileges. Message inspection is not applied either.
     * @dev Reverts on slippage.
     * @param _sendParam Parameters for the send operation
     * @return oftLimit OFT limit information (min and max amounts)
     * @return oftFeeDetails Fee details for the send operation
     * @return oftReceipt OFT receipt containing sent and received amounts
     */
    function nexusQuoteOFT(
        SendParam calldata _sendParam
    )
        external
        view
        returns (OFTLimit memory oftLimit, OFTFeeDetail[] memory oftFeeDetails, OFTReceipt memory oftReceipt);

    /**
     * @notice Provides a quote for the LayerZero messaging fee for the send operation.
     * @dev Only callable by registered OFT contracts.
     * @dev Reverts on slippage and message inspection failures.
     * @param _from Address sending the message
     * @param _sendParam Parameters for the send operation
     * @param _payInLzToken Flag indicating whether the caller is paying in the LZ token
     * @return msgFee Calculated LayerZero messaging fee
     */
    function nexusQuoteSend(
        address _from,
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) external view returns (MessagingFee memory msgFee);

    // ============ Functions ============

    /**
     * @notice Sets the pause module address. Pass `address(0)` to deactivate pause functionality.
     * @param _module Pause module address
     */
    function setPauseModule(address _module) external;

    /**
     * @notice Sets the fee config module address. Pass `address(0)` to deactivate fee configuration.
     * @param _module Fee config module address
     */
    function setFeeConfigModule(address _module) external;

    /**
     * @notice Sets the rate limiter module address. Pass `address(0)` to deactivate rate limiting.
     * @param _module Rate limiter module address
     */
    function setRateLimiterModule(address _module) external;

    /**
     * @notice Executes the send operation to transfer tokens cross-chain.
     * @dev Only callable by registered OFT contracts. Applies rate limiting and fees.
     * @param _from Address to debit tokens from
     * @param _sendParam Parameters for the send operation
     * @param _fee LayerZero messaging fee
     * @param _refundAddress Address to receive any excess funds
     * @return msgReceipt LayerZero messaging receipt
     * @return oftReceipt OFT receipt
     */
    function nexusSend(
        address _from,
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt);
}
