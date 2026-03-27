// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOFT } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";

/**
 * @title INexusOFT
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for `NexusOFT` contracts that extends `IOFT` with Nexus receive functionality.
 */
interface INexusOFT is IOFT {
    // ============ Errors ============

    /**
     * @notice Thrown when an invalid token identifier is provided.
     * @param tokenId Invalid token identifier
     */
    error InvalidTokenId(uint32 tokenId);

    /**
     * @notice Thrown when caller is not the Nexus contract.
     */
    error OnlyNexus();

    /**
     * @notice Thrown when an OFT send intends to pay fees in LZ token, but the LZ token is unavailable.
     * @dev From `OAppSenderUpgradeable`.
     */
    error LzTokenUnavailable();

    // ============ View Functions ============

    /**
     * @notice Returns the Nexus hub contract address.
     * @return nexusAddress Nexus contract address
     */
    function nexus() external view returns (address nexusAddress);

    /**
     * @notice Returns the unique token identifier for this OFT.
     * @return id Token identifier
     */
    function tokenId() external view returns (uint32 id);

    // ============ Functions ============

    /**
     * @notice Called by Nexus when tokens are received from a cross-chain transfer.
     * @dev Emits `OFTReceived` event and handles compose via `EndpointV2.sendCompose` if present.
     * @param _endpoint LayerZero endpoint address for compose handling
     * @param _guid Unique identifier for the LayerZero message
     * @param _srcEid Source endpoint ID
     * @param _to Recipient address
     * @param _amountLD Amount received in local decimals
     * @param _composeMsg Composed message (empty if none)
     */
    function nexusReceive(
        address _endpoint,
        bytes32 _guid,
        uint32 _srcEid,
        address _to,
        uint256 _amountLD,
        bytes calldata _composeMsg
    ) external;
}
