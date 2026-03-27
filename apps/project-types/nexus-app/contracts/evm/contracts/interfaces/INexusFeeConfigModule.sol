// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { INexusFeeConfig } from "./INexusFeeConfig.sol";
import { INexusModule } from "./INexusModule.sol";

/**
 * @title INexusFeeConfigModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the Nexus fee configuration module with priority-based resolution. The highest-priority config
 *         wins; on equal priority the least specific key (global > destination-only > token-only > composite) takes
 *         precedence.
 */
interface INexusFeeConfigModule is INexusFeeConfig, INexusModule {
    /**
     * @notice Configuration for a priority-based fee setting.
     * @param priority Priority level (higher wins). `type(uint128).max` triggers an early return.
     * @param feeBps Fee basis points (BPS)
     */
    struct FeeConfig {
        uint128 priority;
        uint16 feeBps;
    }

    /**
     * @notice Parameter for batch-setting fee configs.
     * @param id Config key (composite nexus ID, or derived token-only / destination-only / global key)
     * @param priority Priority level
     * @param feeBps Fee basis points (BPS)
     */
    struct SetFeeBpsParam {
        uint256 id;
        uint128 priority;
        uint16 feeBps;
    }

    /**
     * @notice Emitted when a fee config is set.
     * @param id Config key
     * @param priority Priority level
     * @param feeBps Fee basis points (BPS)
     */
    event FeeConfigSet(uint256 indexed id, uint128 priority, uint16 feeBps);

    /**
     * @notice Thrown when the fee basis points (BPS) are invalid.
     * @param feeBps Invalid fee basis points (BPS)
     */
    error InvalidBps(uint16 feeBps);

    /**
     * @notice Retrieves the raw fee config for a given key.
     * @param _id Config key
     * @return config Fee config
     */
    function feeConfig(uint256 _id) external view returns (FeeConfig memory config);

    /**
     * @notice Returns the number of distinct config keys that have been set.
     * @return count Number of config keys
     */
    function feeConfigCount() external view returns (uint256 count);

    /**
     * @notice Returns a paginated list of config keys and their associated configs.
     * @param _offset Starting index
     * @param _limit Maximum number of entries to return
     * @return ids Config keys
     * @return configs Associated fee configs
     */
    function getFeeConfigs(
        uint256 _offset,
        uint256 _limit
    ) external view returns (uint256[] memory ids, FeeConfig[] memory configs);

    /**
     * @notice Batch-sets fee configs.
     * @param _params Array of fee parameters
     */
    function setFeeBps(SetFeeBpsParam[] calldata _params) external;
}
