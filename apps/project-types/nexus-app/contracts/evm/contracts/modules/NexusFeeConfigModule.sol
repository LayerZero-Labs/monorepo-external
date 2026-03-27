// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { EnumerableSetPagination } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/libs/EnumerableSetPagination.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { INexusFeeConfig } from "./../interfaces/INexusFeeConfig.sol";
import { INexusFeeConfigModule } from "./../interfaces/INexusFeeConfigModule.sol";
import { NexusModule } from "./NexusModule.sol";

/**
 * @title NexusFeeConfigModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Independently upgradeable fee configuration module for Nexus with priority-based resolution over four
 *         levels: composite (tokenId + eid), token-only, destination-only, and global.
 * @dev The least specific key wins on equal priority (global-first resolution order with strict `>`).
 * @dev Key derivation from a composite Nexus ID `(tokenId << 32) | eid`:
 *      - Composite key:        `nexusId` itself — applies to a specific (tokenId, eid) pair.
 *      - Token-only key:       `nexusId & TOKEN_KEY_MASK` (zeroed eid) — applies to all destinations for a token.
 *      - Destination-only key: `nexusId & DESTINATION_KEY_MASK` (zeroed tokenId) — applies to all tokens for a destination.
 *      - Global key:           `GLOBAL_KEY` — applies to all pathways.
 * @dev Admin setters authenticate callers via the Nexus contract's access control.
 * @dev Does not hold fee balances, as fee accounting is handled by Nexus.
 */
contract NexusFeeConfigModule is INexusFeeConfigModule, Initializable, NexusModule {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSetPagination for EnumerableSet.UintSet;

    /// @notice Constant with which fee basis points (BPS) are divided to get the fee amount.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Role for setting fee basis points.
    bytes32 public constant FEE_CONFIG_MANAGER_ROLE = keccak256("FEE_CONFIG_MANAGER_ROLE");

    /// @custom:storage-location erc7201:layerzerov2.storage.nexusfeeconfig
    struct NexusFeeConfigStorage {
        mapping(uint256 id => FeeConfig config) configs;
        EnumerableSet.UintSet configIds;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexusfeeconfig")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NEXUS_FEE_CONFIG_STORAGE_LOCATION =
        0x5268a9a613634dcf33189cc90ebb850aa75d29be6bcd96969ede23ed9c30ee00;

    function _getNexusFeeConfigStorage() private pure returns (NexusFeeConfigStorage storage $) {
        assembly {
            $.slot := NEXUS_FEE_CONFIG_STORAGE_LOCATION
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
     * @inheritdoc INexusFeeConfigModule
     */
    function feeConfig(uint256 _id) public view virtual returns (FeeConfig memory config) {
        return _getNexusFeeConfigStorage().configs[_id];
    }

    /**
     * @inheritdoc INexusFeeConfigModule
     */
    function feeConfigCount() public view virtual returns (uint256 count) {
        return _getNexusFeeConfigStorage().configIds.length();
    }

    /**
     * @inheritdoc INexusFeeConfigModule
     */
    function getFeeConfigs(
        uint256 _offset,
        uint256 _limit
    ) public view virtual returns (uint256[] memory ids, FeeConfig[] memory configs) {
        NexusFeeConfigStorage storage $ = _getNexusFeeConfigStorage();
        ids = $.configIds.paginate(_offset, _limit);
        configs = new FeeConfig[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            configs[i] = $.configs[ids[i]];
        }
    }

    /**
     * @inheritdoc INexusFeeConfig
     */
    function getFee(uint256 _id, uint256 _amount) public view virtual returns (uint256 fee) {
        uint16 bps = _getFeeBps(_id);
        return bps == 0 ? 0 : (_amount * bps) / BPS_DENOMINATOR;
    }

    /**
     * @inheritdoc INexusFeeConfig
     */
    function getAmountBeforeFee(
        uint256 _id,
        uint256 _amountAfterFee
    ) public view virtual returns (uint256 amountBeforeFee) {
        uint16 bps = _getFeeBps(_id);
        if (bps == BPS_DENOMINATOR) return 0;
        if (bps == 0) return _amountAfterFee;
        return (_amountAfterFee * BPS_DENOMINATOR) / (BPS_DENOMINATOR - bps);
    }

    // ============ Admin Setters ============

    /**
     * @inheritdoc INexusFeeConfigModule
     */
    function setFeeBps(SetFeeBpsParam[] calldata _params) public virtual onlyNexusRole(FEE_CONFIG_MANAGER_ROLE) {
        _setFeeBps(_params);
    }

    // ============ Internal Functions ============

    /**
     * @notice Writes fee configs to storage and emits events.
     * @param _params Array of fee parameters
     */
    function _setFeeBps(SetFeeBpsParam[] calldata _params) internal virtual {
        NexusFeeConfigStorage storage $ = _getNexusFeeConfigStorage();
        for (uint256 i = 0; i < _params.length; i++) {
            SetFeeBpsParam calldata param = _params[i];

            if (param.feeBps > BPS_DENOMINATOR) revert InvalidBps(param.feeBps);

            $.configs[param.id] = FeeConfig(param.priority, param.feeBps);

            if (param.priority == 0 && param.feeBps == 0) {
                $.configIds.remove(param.id);
            } else {
                $.configIds.add(param.id);
            }

            emit FeeConfigSet(param.id, param.priority, param.feeBps);
        }
    }

    /**
     * @notice Resolves the effective fee BPS for a composite Nexus ID.
     * @dev Checks four levels in generality order: global, destination-only, token-only, composite.
     *      The highest-priority config wins. On equal priority, the least specific key (checked first) wins.
     *      A config with `MAX_PRIORITY` short-circuits the resolution.
     * @param _id Composite Nexus ID: `(tokenId << 32) | eid`
     * @return feeBps Fee basis points (BPS)
     */
    function _getFeeBps(uint256 _id) internal view virtual returns (uint16) {
        NexusFeeConfigStorage storage $ = _getNexusFeeConfigStorage();

        FeeConfig memory best = $.configs[GLOBAL_KEY];
        if (best.priority == MAX_PRIORITY) return best.feeBps;

        FeeConfig memory config = $.configs[_id & DESTINATION_KEY_MASK];
        if (config.priority == MAX_PRIORITY) return config.feeBps;
        if (config.priority > best.priority) best = config;

        config = $.configs[_id & TOKEN_KEY_MASK];
        if (config.priority == MAX_PRIORITY) return config.feeBps;
        if (config.priority > best.priority) best = config;

        config = $.configs[_id];
        if (config.priority > best.priority) best = config;

        return best.feeBps;
    }
}
