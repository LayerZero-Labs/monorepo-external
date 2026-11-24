// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IMultiHopComposer } from "./IMultiHopComposer.sol";

/**
 * @title IMultiHopComposerNative
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for the `MultiHopComposerNative` contract.
 */
interface IMultiHopComposerNative is IMultiHopComposer {
    /**
     * @notice Thrown when an OFT does not report the native token.
     */
    error NativeRequired();
}
