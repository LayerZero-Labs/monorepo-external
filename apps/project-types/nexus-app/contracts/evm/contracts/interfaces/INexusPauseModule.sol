// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { INexusModule } from "./INexusModule.sol";
import { INexusPause } from "./INexusPause.sol";

/**
 * @title INexusPauseModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the Nexus pause module with priority-based resolution. The highest-priority config wins;
 *         on equal priority the least specific key (global > destination-only > token-only > composite) takes
 *         precedence.
 */
interface INexusPauseModule is INexusPause, INexusModule {
    /**
     * @notice Configuration for a priority-based pause setting.
     * @param priority Priority level (higher wins). `type(uint128).max` triggers an early return.
     * @param paused Whether transfers are paused
     */
    struct PauseConfig {
        uint128 priority;
        bool paused;
    }

    /**
     * @notice Parameter for batch-setting pause configs.
     * @param id Config key (composite Nexus ID, or derived token-only / destination-only / global key)
     * @param priority Priority level
     * @param paused Whether transfers are paused
     */
    struct SetPausedParam {
        uint256 id;
        uint128 priority;
        bool paused;
    }

    /**
     * @notice Emitted when a pause config is set.
     * @param id Config key
     * @param priority Priority level
     * @param paused Whether transfers are paused
     */
    event PauseConfigSet(uint256 indexed id, uint128 priority, bool paused);

    /**
     * @notice Retrieves the raw pause config for a given key.
     * @param _id Config key
     * @return config Pause config
     */
    function pauseConfig(uint256 _id) external view returns (PauseConfig memory config);

    /**
     * @notice Returns the number of distinct config keys that have been set.
     * @return count Number of config keys
     */
    function pauseConfigCount() external view returns (uint256 count);

    /**
     * @notice Returns a paginated list of config keys and their associated configs.
     * @param _offset Starting index
     * @param _limit Maximum number of entries to return
     * @return ids Config keys
     * @return configs Associated pause configs
     */
    function getPauseConfigs(
        uint256 _offset,
        uint256 _limit
    ) external view returns (uint256[] memory ids, PauseConfig[] memory configs);

    /**
     * @notice Batch-sets pause configs.
     * @param _params Array of pause parameters
     */
    function setPaused(SetPausedParam[] calldata _params) external;
}
