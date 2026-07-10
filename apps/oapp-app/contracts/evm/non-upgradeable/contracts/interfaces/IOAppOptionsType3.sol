// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IOAppOptionsType3
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for the `IOAppOptionsType3` contract.
 */
interface IOAppOptionsType3 {
    /**
     * @notice Struct representing enforced option parameters.
     * @param eid Endpoint ID
     * @param msgType OApp message type
     * @param options Additional options
     */
    struct EnforcedOptionParam {
        uint32 eid;
        uint16 msgType;
        bytes options;
    }

    /**
     * @notice Thrown when invalid options are provided.
     * @param options Invalid options
     */
    error InvalidOptions(bytes options);

    /**
     * @notice Emitted when enforced options are set.
     * @param _enforcedOptions Array of enforced options
     */
    event EnforcedOptionSet(EnforcedOptionParam[] _enforcedOptions);

    /**
     * @notice Returns the enforced options for a given endpoint ID and message type.
     * @param _eid Endpoint ID
     * @param _msgType Message type, as defined by the OApp
     * @return options Enforced options
     */
    function enforcedOptions(uint32 _eid, uint16 _msgType) external view returns (bytes memory options);

    /**
     * @notice Combines options for a given endpoint and message type.
     * @param _eid Endpoint ID
     * @param _msgType Message type, as defined by the OApp
     * @param _extraOptions Additional options passed by the caller
     * @return options Combination of caller specified options AND enforced options
     */
    function combineOptions(
        uint32 _eid,
        uint16 _msgType,
        bytes calldata _extraOptions
    ) external view returns (bytes memory options);

    /**
     * @notice Sets enforced options for specific endpoint and message type combinations.
     * @dev Provides a way for the OApp to enforce things like paying for minimum destination `lzReceive` gas amounts.
     * @dev These enforced options can vary as the potential options/execution on the remote may differ as per the
     *      `msgType`. E.g., the amount of `lzReceive` gas necessary to deliver a `lzCompose` message adds overhead you
     *      don't want to pay if you are only sending a standard message such as `lzReceive` WITHOUT `sendCompose`.
     * @param _enforcedOptions Array of enforced options
     */
    function setEnforcedOptions(EnforcedOptionParam[] calldata _enforcedOptions) external;
}
