// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IAllowlist
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `Allowlist` contract.
 */
interface IAllowlist {
    /**
     * @notice Available allowlist modes.
     *         - `Open`: No restrictions.
     *         - `Blacklist`: Users in the blacklist are not allowed.
     *         - `Whitelist`: Only users in the whitelist are allowed.
     */
    enum AllowlistMode {
        Open,
        Blacklist,
        Whitelist
    }

    /**
     * @notice Parameters for setting the allowlist state for a user.
     * @param user User address
     * @param isEnabled Whether the user is whitelisted or blacklisted, depends on function context
     */
    struct SetAllowlistParam {
        address user;
        bool isEnabled;
    }

    /**
     * @notice Emitted when the allowlist mode is updated.
     * @param newMode New mode
     */
    event AllowlistModeUpdated(AllowlistMode newMode);

    /**
     * @notice Emitted when a user's blacklist state is updated.
     * @param user User address
     * @param isBlacklisted Whether the user is now blacklisted
     */
    event BlacklistUpdated(address indexed user, bool isBlacklisted);

    /**
     * @notice Emitted when a user's whitelist state is updated.
     * @param user User address
     * @param isWhitelisted Whether the user is now whitelisted
     */
    event WhitelistUpdated(address indexed user, bool isWhitelisted);

    /**
     * @notice Thrown when the intended allowlist mode is already set.
     * @param mode Current mode
     */
    error ModeAlreadySet(AllowlistMode mode);

    /**
     * @notice Thrown when a user is already in the desired state (blacklist or whitelist).
     * @param user User address
     * @param isEnabled The desired state that the user is already in
     */
    error AllowlistStateIdempotent(address user, bool isEnabled);

    /**
     * @notice Thrown when a user is not allowlisted.
     * @param user User address
     * @param mode Current mode
     */
    error NotAllowlisted(address user, AllowlistMode mode);

    /**
     * @notice Returns the current allowlist mode.
     * @return mode Current mode
     */
    function allowlistMode() external view returns (AllowlistMode mode);

    /**
     * @notice Returns the blacklist state for a user.
     * @param _user User address
     * @return isUserBlacklisted Whether the user is blacklisted
     */
    function isBlacklisted(address _user) external view returns (bool isUserBlacklisted);

    /**
     * @notice Returns the whitelist state for a user.
     * @param _user User address
     * @return isUserWhitelisted Whether the user is whitelisted
     */
    function isWhitelisted(address _user) external view returns (bool isUserWhitelisted);

    /**
     * @notice Checks if a user is allowlisted under the current mode.
     * @param _user User address
     * @return isUserAllowlisted Whether the user is allowlisted
     */
    function isAllowlisted(address _user) external view returns (bool isUserAllowlisted);

    /**
     * @notice Returns the total count of blacklisted addresses.
     * @return count Total number of blacklisted addresses
     */
    function blacklistedCount() external view returns (uint256 count);

    /**
     * @notice Returns the total count of whitelisted addresses.
     * @return count Total number of whitelisted addresses
     */
    function whitelistedCount() external view returns (uint256 count);

    /**
     * @notice Returns a paginated list of blacklisted addresses.
     * @param _offset Starting index
     * @param _limit Maximum number of addresses to return
     * @return addresses Array of blacklisted addresses
     */
    function getBlacklist(uint256 _offset, uint256 _limit) external view returns (address[] memory addresses);

    /**
     * @notice Returns a paginated list of whitelisted addresses.
     * @param _offset Starting index
     * @param _limit Maximum number of addresses to return
     * @return addresses Array of whitelisted addresses
     */
    function getWhitelist(uint256 _offset, uint256 _limit) external view returns (address[] memory addresses);

    /**
     * @notice Sets the allowlist mode.
     * @param _mode New allowlist mode
     */
    function setAllowlistMode(AllowlistMode _mode) external;

    /**
     * @notice Sets the blacklist state for an array of users.
     * @param _params Array of users and blacklist states
     */
    function setBlacklisted(SetAllowlistParam[] calldata _params) external;

    /**
     * @notice Sets the whitelist state for an array of users.
     * @param _params Array of users and whitelist states
     */
    function setWhitelisted(SetAllowlistParam[] calldata _params) external;
}
