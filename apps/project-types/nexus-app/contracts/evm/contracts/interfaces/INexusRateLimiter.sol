// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title INexusRateLimiter
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Minimal interface for the Nexus rate limiter extension. Contains only the functions called by Nexus.
 */
interface INexusRateLimiter {
    /**
     * @notice Retrieves the available outbound capacity for a token on a destination chain, reverse-scaled from the
     *         common unit back to token raw units.
     * @param _id Composite Nexus identifier encoding `(tokenId << 32) | eid`
     * @return outboundAvailableAmount Outbound rate limit available capacity, in token raw units
     */
    function getOutboundAvailable(uint256 _id) external view returns (uint256 outboundAvailableAmount);

    /**
     * @notice Applies rate limit logic for an outflow. Scales the amount by the token's configured scale before
     *         consuming the per-EID rate limit bucket.
     * @dev Only callable by the Nexus contract.
     * @param _id Composite Nexus identifier encoding `(tokenId << 32) | eid`
     * @param _from Sender of the action
     * @param _amount Amount of the action, in token raw units
     */
    function outflow(uint256 _id, address _from, uint256 _amount) external;

    /**
     * @notice Applies rate limit logic for an inflow. Scales the amount by the token's configured scale before
     *         consuming the per-EID rate limit bucket.
     * @dev Only callable by the Nexus contract.
     * @param _id Composite Nexus identifier encoding `(tokenId << 32) | eid`
     * @param _to Recipient of the action
     * @param _amount Amount of the action, in token raw units
     */
    function inflow(uint256 _id, address _to, uint256 _amount) external;
}
