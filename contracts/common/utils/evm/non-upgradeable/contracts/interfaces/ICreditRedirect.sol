// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ICreditRedirect
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `CreditRedirect` contract.
 */
interface ICreditRedirect {
    /**
     * @notice Credit redirect configuration.
     * @param allowlist Allowlist address implementing `ICreditRedirectAllowlist`
     * @param escrow Escrow address that will receive credits originally sent to a non-allowlisted user
     */
    struct CreditRedirectConfig {
        address allowlist;
        address escrow;
    }

    /**
     * @notice Thrown when the credit redirect config has exactly one of `allowlist` or `escrow` unset.
     */
    error InvalidCreditRedirectConfig();

    /**
     * @notice Emitted when the credit redirect configuration is set.
     * @param config Updated credit redirect configuration
     */
    event CreditRedirectConfigSet(CreditRedirectConfig config);

    /**
     * @notice Emitted when a credit to a non-allowlisted recipient is redirected to the escrow.
     * @param from Original intended recipient
     * @param to Escrow address that received the credit
     * @param amountLD Redirected amount in local decimals
     */
    event CreditRedirected(address indexed from, address indexed to, uint256 amountLD);

    /**
     * @notice Returns the credit redirect configuration.
     * @return config Credit redirect configuration
     */
    function creditRedirectConfig() external view returns (CreditRedirectConfig memory config);

    /**
     * @notice Sets the credit redirect configuration.
     * @dev `allowlist` and `escrow` must both be set or both be `address(0)` (disabled).
     * @param _config New credit redirect configuration
     */
    function setCreditRedirectConfig(CreditRedirectConfig calldata _config) external;
}
