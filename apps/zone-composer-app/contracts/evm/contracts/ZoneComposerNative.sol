// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOFT } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "@layerzerolabs/zone-router-evm-contracts/contracts/interfaces/IAirlock.sol";
import { IZoneComposerNative } from "./interfaces/IZoneComposerNative.sol";
import { ZoneComposer } from "./ZoneComposer.sol";

/**
 * @title ZoneComposerNative
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Forwards ZRO to another Zero zone through the `Airlock` precompile.
 * @dev Undecodable payloads are cached for owner rescue.
 * @dev Destinations reported inactive are cached for permissionless retry or owner rescue.
 * @dev `Airlock` reverts leave compose delivery retryable.
 */
contract ZoneComposerNative is IZoneComposerNative, ZoneComposer {
    /**
     * @param _initialOwner Initial owner of the contract
     * @param _oft Native OFT address
     */
    constructor(address _initialOwner, address _oft) ZoneComposer(_initialOwner, _oft, AIRLOCK_ADDRESS) {}

    /**
     * @dev Accepts native credits before their compose delivery.
     */
    receive() external payable {
        if (msg.sender != OFT) revert OnlyOFT(msg.sender);
    }

    /**
     * @inheritdoc ZoneComposer
     */
    function _configureToken(address _oft, address) internal view virtual override returns (address token) {
        if (IOFT(_oft).token() != address(0)) revert InvalidOFT();
        return address(0);
    }

    /**
     * @dev Uses `Airlock.isActiveZone` instead of router peer configuration.
     * @inheritdoc ZoneComposer
     */
    function _isRoutable(uint64 _dstZone) internal view virtual override returns (bool routable) {
        return IAirlock(ROUTER).isActiveZone(_dstZone);
    }

    /// @inheritdoc ZoneComposer
    function _send(
        bytes32 _guid,
        uint64 _dstZone,
        bytes memory _recipient,
        uint256 _amountLD,
        bytes memory _memo
    ) internal virtual override {
        uint64 nonce = IAirlock(ROUTER).sendZro{ value: _amountLD }(_dstZone, _recipient, _memo);
        emit Sent(_guid, _dstZone, nonce);
    }

    /// @inheritdoc ZoneComposer
    function _rescue(address _to, uint256 _amountLD) internal virtual override {
        (bool success, ) = _to.call{ value: _amountLD }("");
        if (!success) revert NativeTransferFailed();
    }
}
