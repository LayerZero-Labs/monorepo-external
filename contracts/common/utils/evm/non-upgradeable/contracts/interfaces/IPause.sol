// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IPause
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `Pause` contract.
 */
interface IPause {
    /**
     * @notice Emitted when the pause status is set.
     * @param paused Pause status
     */
    event PauseSet(bool paused);

    /**
     * @notice Thrown when attempting to perform an action while paused.
     */
    error Paused();

    /**
     * @notice Thrown when setting pause state is idempotent (no change).
     * @param isPaused Whether system is paused
     */
    error PauseStateIdempotent(bool isPaused);

    /**
     * @notice Checks if the system is paused.
     * @return paused Whether the system is paused
     */
    function isPaused() external view returns (bool paused);

    /**
     * @notice Pauses the system.
     */
    function pause() external;

    /**
     * @notice Unpauses the system.
     */
    function unpause() external;
}
