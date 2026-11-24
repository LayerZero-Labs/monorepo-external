// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IZoneComposer } from "./IZoneComposer.sol";

/**
 * @title IZoneComposerNative
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for the `ZoneComposerNative` contract.
 */
interface IZoneComposerNative is IZoneComposer {
    /**
     * @notice Thrown when the rescued native transfer fails.
     */
    error NativeTransferFailed();
}
