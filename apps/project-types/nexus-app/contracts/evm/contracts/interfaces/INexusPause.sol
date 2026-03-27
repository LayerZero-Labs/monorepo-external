// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title INexusPause
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Minimal interface for the Nexus pause extension. Contains only the functions called by Nexus.
 */
interface INexusPause {
    /**
     * @notice Thrown when attempting to transfer while paused.
     * @param id Destination ID that is paused
     */
    error Paused(uint256 id);

    /**
     * @notice Checks if transfers to a destination ID are paused.
     * @param _id Destination ID
     * @return paused Whether transfers are paused
     */
    function isPaused(uint256 _id) external view returns (bool paused);
}
