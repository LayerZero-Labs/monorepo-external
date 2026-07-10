// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IOAppMsgInspection
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `OAppMsgInspection` contract.
 */
interface IOAppMsgInspection {
    /**
     * @notice Emitted when a new message inspector is set.
     * @param msgInspector Address of the new message inspector
     */
    event MsgInspectorSet(address msgInspector);

    /**
     * @notice Retrieves the message inspector address.
     * @return inspector Address of the message inspector
     */
    function msgInspector() external view returns (address inspector);

    /**
     * @notice Sets the message inspector address.
     * @param _msgInspector Address of the new message inspector
     */
    function setMsgInspector(address _msgInspector) external;
}
