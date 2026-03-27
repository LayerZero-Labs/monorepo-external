// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IPauseByID
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `PauseByID` contract.
 */
interface IPauseByID {
    /**
     * @notice Configuration for a pause setting.
     * @param paused Whether transfers are paused for this ID
     * @param enabled False to fallback to the default pause setting
     */
    struct PauseConfig {
        bool paused;
        bool enabled;
    }

    /**
     * @notice Parameter for setting pause state.
     * @param id Destination ID
     * @param paused Whether transfers are paused for this ID
     * @param enabled Whether the pause config is enabled for the destination
     */
    struct SetPausedParam {
        uint256 id;
        bool paused;
        bool enabled;
    }

    /**
     * @notice Emitted when the pause status is set for a specific destination ID.
     * @param id Destination ID
     * @param paused Whether transfers are paused for this ID
     * @param enabled Whether the pause config is enabled for the destination
     */
    event PauseSet(uint256 id, bool paused, bool enabled);

    /**
     * @notice Emitted when the default pause status is set.
     * @param paused Default pause status
     */
    event DefaultPauseSet(bool paused);

    /**
     * @notice Thrown when attempting to transfer while paused.
     * @param id Destination ID that is paused
     */
    error Paused(uint256 id);

    /**
     * @notice Thrown when setting pause state is idempotent (no change).
     * @param isPaused Whether transfers are paused
     */
    error PauseStateIdempotent(bool isPaused);

    /**
     * @notice Checks if transfers to a destination ID are paused.
     * @param _id Destination ID
     * @return paused Whether transfers are paused
     */
    function isPaused(uint256 _id) external view returns (bool paused);

    /**
     * @notice Retrieves default pause status used if no pause config is set for the destination ID.
     * @return paused Default pause status
     */
    function defaultPaused() external view returns (bool paused);

    /**
     * @notice Retrieves the configured pause setting for a given ID.
     * @param _id Destination ID
     * @return config Configured pause setting for the destination ID
     */
    function pauseConfig(uint256 _id) external view returns (PauseConfig memory config);

    /**
     * @notice Set the default pause status for all destinations.
     * @param _paused New default pause status
     */
    function setDefaultPaused(bool _paused) external;

    /**
     * @notice Sets the pause status for an array of destination IDs.
     * @param _params Array of pause configurations
     */
    function setPaused(SetPausedParam[] calldata _params) external;
}
