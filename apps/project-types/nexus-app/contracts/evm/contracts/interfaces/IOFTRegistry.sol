// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOFTDecimalUtils } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFTDecimalUtils.sol";

/**
 * @title IOFTRegistry
 * @author LayerZero Labs (@TRileySchwarz)
 * @custom:version 1.0.0
 * @notice Interface for the `OFTRegistry` contract.
 */
interface IOFTRegistry is IOFTDecimalUtils {
    // ============ Events ============

    /**
     * @notice Emitted when a token is registered.
     * @param tokenId Unique identifier for the token
     * @param oftAddress Address of the OFT contract
     * @param burnerMinterAddress Address of the burner minter contract
     * @param tokenAddress Address of the underlying token contract
     */
    event TokenRegistered(
        uint32 indexed tokenId,
        address indexed oftAddress,
        address indexed burnerMinterAddress,
        address tokenAddress
    );

    /**
     * @notice Emitted when a token is deregistered.
     * @param tokenId Unique identifier for the token
     */
    event TokenDeregistered(uint32 indexed tokenId);

    // ============ Errors ============

    /**
     * @notice Thrown when attempting to register with invalid parameters.
     * @param tokenId Invalid token identifier
     * @param burnerMinterAddress Invalid burner minter address
     * @param oftAddress Invalid OFT address
     */
    error InvalidTokenRegistration(uint32 tokenId, address burnerMinterAddress, address oftAddress);

    /**
     * @notice Thrown when attempting to register a token or OFT that is already registered.
     * @param tokenId Unique identifier for the token
     * @param tokenAddress Address of the underlying token contract
     * @param oftAddress Address of the OFT contract
     */
    error TokenAlreadyRegistered(uint32 tokenId, address tokenAddress, address oftAddress);

    /**
     * @notice Thrown when attempting to deregister a token that is not registered.
     * @param tokenId Unique identifier for the token that is not registered
     */
    error TokenNotRegistered(uint32 tokenId);

    /**
     * @notice Thrown when an invalid OFT address is provided.
     * @param oftAddress Invalid OFT address
     */
    error InvalidOFT(address oftAddress);

    /**
     * @notice Thrown when an invalid token identifier is provided.
     * @param tokenId Invalid token identifier
     */
    error InvalidTokenId(uint32 tokenId);

    /**
     * @notice Thrown when a token has invalid decimals.
     * @param tokenAddress Address of the underlying token contract
     * @param expected Expected decimals
     * @param actual Actual decimals
     */
    error InvalidTokenDecimals(address tokenAddress, uint8 expected, uint8 actual);

    /**
     * @notice Thrown when an OFT has invalid shared decimals.
     * @param oftAddress Address of the OFT contract
     * @param expected Expected shared decimals
     * @param actual Actual shared decimals
     */
    error InvalidOFTSharedDecimals(address oftAddress, uint8 expected, uint8 actual);

    // ============ View Functions ============

    /**
     * @notice Returns the token identifier for a given OFT address.
     * @param _oftAddress Address of the OFT contract
     * @return tokenId Unique identifier for the token
     */
    function getTokenId(address _oftAddress) external view returns (uint32 tokenId);

    /**
     * @notice Returns the burner minter address for a given token identifier.
     * @param _tokenId Unique identifier for the token
     * @return burnerMinterAddress Address of burner and minter contract for the underlying token
     */
    function getBurnerMinterAddress(uint32 _tokenId) external view returns (address burnerMinterAddress);

    /**
     * @notice Returns the OFT address for a given token identifier.
     * @param _tokenId Unique identifier for the token
     * @return oftAddress Address of the OFT contract
     */
    function getOFTAddress(uint32 _tokenId) external view returns (address oftAddress);

    // ============ Management Functions ============

    /**
     * @notice Registers a token with an OFT contract address.
     * @param _tokenId Unique identifier for the token
     * @param _oftAddress Address of the OFT contract
     * @param _burnerMinterAddress Address of the burner minter contract
     */
    function registerToken(uint32 _tokenId, address _oftAddress, address _burnerMinterAddress) external;

    /**
     * @notice Deregisters an existing token and clears all associated mappings.
     * @param _tokenId Unique identifier for the token to be deregistered
     */
    function deregisterToken(uint32 _tokenId) external;
}
