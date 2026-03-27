// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { EnumerableSetPagination } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/libs/EnumerableSetPagination.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { INexusPause } from "./../interfaces/INexusPause.sol";
import { INexusPauseModule } from "./../interfaces/INexusPauseModule.sol";
import { NexusModule } from "./NexusModule.sol";

/**
 * @title NexusPauseModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Independently upgradeable pause module for Nexus with priority-based resolution over four levels:
 *         composite (tokenId + eid), token-only, destination-only, and global.
 * @dev The least specific key wins on equal priority (global-first resolution order with strict `>`).
 * @dev Key derivation from a composite Nexus ID `(tokenId << 32) | eid`:
 *      - Composite key:        `nexusId` itself — applies to a specific (tokenId, eid) pair.
 *      - Token-only key:       `nexusId & TOKEN_KEY_MASK` (zeroed eid) — applies to all destinations for a token.
 *      - Destination-only key: `nexusId & DESTINATION_KEY_MASK` (zeroed tokenId) — applies to all tokens for a destination.
 *      - Global key:           `GLOBAL_KEY` — applies to all pathways.
 * @dev Admin setters authenticate callers via the Nexus contract's access control.
 */
contract NexusPauseModule is INexusPauseModule, Initializable, NexusModule {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSetPagination for EnumerableSet.UintSet;

    /// @notice Role required to set pause configs that can effectively pause pathways.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role required to set pause configs that can effectively unpause pathways.
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    /// @custom:storage-location erc7201:layerzerov2.storage.nexuspause
    struct NexusPauseStorage {
        mapping(uint256 id => PauseConfig config) configs;
        EnumerableSet.UintSet configIds;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexuspause")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NEXUS_PAUSE_STORAGE_LOCATION =
        0xd34179d4b7cb188c337b89523bfed55ea9c8d48fd632a0c59dbed502c1b8b800;

    function _getNexusPauseStorage() private pure returns (NexusPauseStorage storage $) {
        assembly {
            $.slot := NEXUS_PAUSE_STORAGE_LOCATION
        }
    }

    /**
     * @dev Sets immutable variables.
     * @param _nexus Address of the Nexus contract
     */
    constructor(address _nexus) NexusModule(_nexus) {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     */
    function initialize() public initializer {}

    // ============ View Functions ============

    /**
     * @inheritdoc INexusPauseModule
     */
    function pauseConfig(uint256 _id) public view virtual returns (PauseConfig memory config) {
        return _getNexusPauseStorage().configs[_id];
    }

    /**
     * @inheritdoc INexusPauseModule
     */
    function pauseConfigCount() public view virtual returns (uint256 count) {
        return _getNexusPauseStorage().configIds.length();
    }

    /**
     * @inheritdoc INexusPauseModule
     */
    function getPauseConfigs(
        uint256 _offset,
        uint256 _limit
    ) public view virtual returns (uint256[] memory ids, PauseConfig[] memory configs) {
        NexusPauseStorage storage $ = _getNexusPauseStorage();
        ids = $.configIds.paginate(_offset, _limit);
        configs = new PauseConfig[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            configs[i] = $.configs[ids[i]];
        }
    }

    /**
     * @inheritdoc INexusPause
     */
    function isPaused(uint256 _id) public view virtual returns (bool paused) {
        return _getPaused(_id);
    }

    // ============ Admin Setters ============

    /**
     * @dev Role is determined by the effective impact on pathway pause states:
     *      - Strengthening, switching, or no-op: role matches the new config's paused state.
     *      - Weakening: role is the opposite of the old config's paused state.
     * @dev Caller must hold both roles if the batch contains mixed effects.
     * @dev Requires the more restrictive `UNPAUSER_ROLE` for no-ops.
     * @inheritdoc INexusPauseModule
     */
    function setPaused(SetPausedParam[] calldata _params) public virtual {
        NexusPauseStorage storage $ = _getNexusPauseStorage();

        bool needsPauser;
        bool needsUnpauser;

        for (uint256 i = 0; i < _params.length; i++) {
            SetPausedParam calldata param = _params[i];
            PauseConfig memory oldConfig = $.configs[param.id];

            uint128 oldPriority = oldConfig.priority;
            bool oldPaused = oldConfig.paused;

            /// @dev Treat equal priority as strengthening to avoid unauthenticated no-ops.
            bool strengthening = param.priority >= oldPriority;
            bool weakening = param.priority < oldPriority;
            bool switching = param.paused != oldPaused;

            if (strengthening || switching) {
                if (param.paused) needsPauser = true;
                else needsUnpauser = true;
            }

            if (weakening) {
                if (oldPaused) needsUnpauser = true;
                else needsPauser = true;
            }

            if (needsPauser && needsUnpauser) break;
        }

        if (needsPauser) _checkRole(PAUSER_ROLE);
        /// @dev Avoid unauthorized no-ops.
        if (needsUnpauser || !needsPauser) _checkRole(UNPAUSER_ROLE);

        _setPaused(_params);
    }

    // ============ Internal Functions ============

    /**
     * @notice Writes pause configs to storage and emits events.
     * @param _params Array of pause parameters
     */
    function _setPaused(SetPausedParam[] calldata _params) internal virtual {
        NexusPauseStorage storage $ = _getNexusPauseStorage();
        for (uint256 i = 0; i < _params.length; i++) {
            SetPausedParam calldata param = _params[i];

            $.configs[param.id] = PauseConfig(param.priority, param.paused);

            if (param.priority == 0 && !param.paused) {
                $.configIds.remove(param.id);
            } else {
                $.configIds.add(param.id);
            }

            emit PauseConfigSet(param.id, param.priority, param.paused);
        }
    }

    /**
     * @notice Resolves the effective pause state for a composite Nexus ID.
     * @dev Checks four levels in generality order: global, destination-only, token-only, composite.
     *      The highest-priority config wins. On equal priority, the least specific key (checked first) wins.
     *      A config with `MAX_PRIORITY` short-circuits the resolution.
     * @param _id Composite Nexus ID: `(tokenId << 32) | eid`
     * @return paused Whether transfers are paused
     */
    function _getPaused(uint256 _id) internal view virtual returns (bool) {
        NexusPauseStorage storage $ = _getNexusPauseStorage();

        PauseConfig memory best = $.configs[GLOBAL_KEY];
        if (best.priority == MAX_PRIORITY) return best.paused;

        PauseConfig memory config = $.configs[_id & DESTINATION_KEY_MASK];
        if (config.priority == MAX_PRIORITY) return config.paused;
        if (config.priority > best.priority) best = config;

        config = $.configs[_id & TOKEN_KEY_MASK];
        if (config.priority == MAX_PRIORITY) return config.paused;
        if (config.priority > best.priority) best = config;

        config = $.configs[_id];
        if (config.priority > best.priority) best = config;

        return best.paused;
    }
}
