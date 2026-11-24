// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAirlock } from "./IAirlock.sol";
import { IAirlockReceiver } from "./IAirlockReceiver.sol";

/**
 * @title IZoneRouter
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for the `ZoneRouter` contract.
 */
interface IZoneRouter is IAirlockReceiver {
    /**
     * @notice Token settlement mode: lock/unlock, burn from caller/mint, or burn from router/mint.
     */
    enum Mode {
        LockUnlock,
        BurnMint,
        BurnSelfMint
    }

    /**
     * @notice Initialization-only token settlement configuration.
     * @param token ERC20 token
     * @param mode Token settlement mode
     * @param localDecimals The token's `decimals()`, from 0 through 18
     * @param burnerMinter Contract called to burn and mint; required for burn modes
     * @param burnSelector Selector accepting `(address,uint256)` for burn/mint or `(uint256)` for burn-self/mint
     * @param mintSelector Selector accepting `(address,uint256)`
     */
    struct Config {
        address token;
        Mode mode;
        uint8 localDecimals;
        address burnerMinter;
        bytes4 burnSelector;
        bytes4 mintSelector;
    }

    /**
     * @notice Outbound and default inbound application for a remote zone.
     * @param zone Remote zone
     * @param zonePeer Remote application
     */
    struct ZonePeer {
        uint64 zone;
        bytes zonePeer;
    }

    /**
     * @notice Emitted when the owner configures a zone's outbound and default inbound token application.
     * @param zone Remote zone
     * @param zonePeer Remote application, or empty bytes to disable sends and default inbound trust
     */
    event ZonePeerSet(uint64 indexed zone, bytes zonePeer);

    /**
     * @notice Emitted when the owner updates an extra trusted inbound application.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param allowed Whether inbound delivery is allowed
     */
    event ExtraInboundPeerSet(uint64 indexed srcZone, bytes srcApp, bool allowed);

    /**
     * @notice Emitted when tokens are sent to another Zero zone.
     * @param dstZone Destination zone
     * @param dstApp Destination application
     * @param nonce `Airlock` channel nonce
     * @param sender Token sender
     * @param recipient Destination recipient
     * @param amountLD Settled token amount in local units
     */
    event Sent(
        uint64 indexed dstZone,
        bytes dstApp,
        uint64 indexed nonce,
        address indexed sender,
        bytes recipient,
        uint256 amountLD
    );

    /**
     * @notice Emitted when authenticated tokens are received from another Zero zone.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param nonce `Airlock` channel nonce
     * @param recipient EVM token recipient
     * @param amountLD Settled token amount in local units
     */
    event Received(
        uint64 indexed srcZone,
        bytes srcApp,
        uint64 indexed nonce,
        address indexed recipient,
        uint256 amountLD
    );

    /**
     * @notice Emitted when an authenticated transfer is cached for permissionless retry.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param nonce `Airlock` channel nonce
     * @param message Authenticated payload for permissionless retry
     */
    event MessageCached(uint64 indexed srcZone, bytes srcApp, uint64 indexed nonce, IAirlock.Message message);

    /**
     * @notice Emitted when the owner rescues a cached message with a malformed recipient.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param nonce `Airlock` channel nonce
     * @param to Recipient of the rescued token amount
     * @param amountLD Settled token amount in local units
     */
    event MessageRescued(
        uint64 indexed srcZone,
        bytes srcApp,
        uint64 indexed nonce,
        address indexed to,
        uint256 amountLD
    );

    /**
     * @notice Emitted when the owner marks a message for caching without execution.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param nonce `Airlock` channel nonce
     */
    event MessageMarkedForCaching(uint64 indexed srcZone, bytes srcApp, uint64 indexed nonce);

    /**
     * @notice Thrown when the token is not a contract.
     */
    error InvalidToken();

    /**
     * @notice Thrown when a burn mode has no burner/minter address.
     */
    error InvalidBurnerMinter();

    /**
     * @notice Thrown when the local decimals exceed 18.
     * @param localDecimals Requested local decimals
     */
    error InvalidLocalDecimals(uint8 localDecimals);

    /**
     * @notice Thrown when the local decimals differ from the token's `decimals()`.
     * @param localDecimals Requested local decimals
     * @param tokenDecimals Token decimals
     */
    error LocalDecimalsMismatch(uint8 localDecimals, uint8 tokenDecimals);

    /**
     * @notice Thrown when a destination has no zone peer or a source application is not allowed inbound.
     * @param zone Remote zone
     * @param app Requested application
     */
    error UntrustedZonePeer(uint64 zone, bytes app);

    /**
     * @notice Thrown when the outbound transfer amount is zero.
     */
    error ZeroAmount();

    /**
     * @notice Thrown when a message execution caller is not this router.
     * @param caller Message execution caller
     */
    error OnlySelf(address caller);

    /**
     * @notice Thrown when a cached message is absent or its payload hash does not match.
     */
    error InvalidCachedMessage();

    /**
     * @notice Thrown when a rescue message has a valid twenty-byte EVM recipient.
     */
    error InvalidRescueMessage();

    /**
     * @notice Thrown when the rescue recipient is the zero address.
     */
    error InvalidRescueRecipient();

    /**
     * @notice Thrown when an extra inbound peer is already in the requested state.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param allowed Requested inbound permission
     */
    error ExtraInboundPeerStateIdempotent(uint64 srcZone, bytes srcApp, bool allowed);

    /**
     * @notice Thrown when a message is already marked for caching.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param nonce Channel nonce
     */
    error MessageAlreadyMarkedForCaching(uint64 srcZone, bytes srcApp, uint64 nonce);

    /**
     * @notice Thrown when the owner attempts to renounce ownership.
     */
    error CannotRenounceOwnership();

    /**
     * @notice Initializes the token router and its owner once.
     * @dev Burn/mint backends must revert on failure; successful return data is ignored.
     *      Lock/unlock ignores the optional backend and selectors.
     * @param _initialOwner Initial router owner
     * @param _config Token settlement configuration
     */
    function initialize(address _initialOwner, Config calldata _config) external;

    /**
     * @notice Returns the token settlement configuration.
     * @return configuration Token settlement configuration
     */
    function config() external view returns (Config memory configuration);

    /**
     * @notice Returns the outbound and default inbound token application for a zone.
     * @param _zone Remote zone
     * @return zonePeer Remote application, or empty bytes when disabled
     */
    function zonePeers(uint64 _zone) external view returns (bytes memory zonePeer);

    /**
     * @notice Returns all configured outbound and default inbound zone peers.
     * @dev Ordering is not guaranteed.
     * @return peers Configured zones and their trusted applications
     */
    function getZonePeers() external view returns (ZonePeer[] memory peers);

    /**
     * @notice Returns whether an application is allowed as an extra inbound peer.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @return allowed Whether the extra application is trusted for inbound delivery
     */
    function extraInboundPeers(uint64 _srcZone, bytes calldata _srcApp) external view returns (bool allowed);

    /**
     * @notice Returns the extra inbound applications allowed for a source zone.
     * @dev The order is not guaranteed.
     * @param _srcZone Source zone
     * @return peers Extra applications trusted for inbound delivery
     */
    function getExtraInboundPeers(uint64 _srcZone) external view returns (bytes[] memory peers);

    /**
     * @notice Returns the authenticated payload hash cached for a transfer.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _nonce `Airlock` channel nonce
     * @return messageHash Cached payload hash, or zero when no retry is pending
     */
    function cachedMessages(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce
    ) external view returns (bytes32 messageHash);

    /**
     * @notice Returns the number of pending cached claims for a source channel.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @return count Number of pending cached claims
     */
    function cachedMessagesCount(uint64 _srcZone, bytes calldata _srcApp) external view returns (uint256 count);

    /**
     * @notice Returns whether a message is marked for caching without execution.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _nonce `Airlock` channel nonce
     * @return marked Whether the owner has permanently marked the message
     */
    function messagesToCache(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce
    ) external view returns (bool marked);

    /**
     * @notice Debits tokens from the caller and sends a transfer through `Airlock` atomically.
     * @dev Debits the full amount and sends it to `Airlock` scaled up to 18 decimals. A destination with fewer
     *      local decimals removes dust on receive, so an amount below one destination unit credits zero.
     * @param _dstZone Destination zone
     * @param _recipient Recipient in the destination zone's account encoding
     * @param _amountLD Token amount in local units
     * @param _memo Opaque transfer memo
     * @return nonce `Airlock` channel nonce
     */
    function sendToken(
        uint64 _dstZone,
        bytes calldata _recipient,
        uint256 _amountLD,
        bytes calldata _memo
    ) external returns (uint64 nonce);

    /**
     * @notice Retries the exact authenticated payload of a cached transfer.
     * @dev Anyone may retry a cached claim, including after its source application is no longer trusted.
     *      Failed retries revert and retain the cache entry. Successful retries clear it before token settlement.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _nonce `Airlock` channel nonce
     * @param _message Exact payload emitted by `Airlock` for this message
     */
    function retryMessage(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce,
        IAirlock.Message calldata _message
    ) external;

    /**
     * @notice Lets the owner rescue a cached transfer with a recipient that is not twenty bytes.
     * @dev Valid twenty-byte recipients cannot be redirected. Failed settlement retains the claim.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _nonce `Airlock` channel nonce
     * @param _message Exact cached payload
     * @param _to Nonzero local rescue recipient
     */
    function rescueMessage(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce,
        IAirlock.Message calldata _message,
        address _to
    ) external;

    /**
     * @notice Configures the outbound and default inbound token application for a zone.
     * @dev Zone peers must route the same asset. Empty bytes disable sends
     *      and default inbound trust; extra inbound peers remain allowed. Unchanged values still emit an event.
     * @param _zone Remote zone
     * @param _zonePeer Remote application in the remote zone's account encoding
     */
    function setZonePeer(uint64 _zone, bytes calldata _zonePeer) external;

    /**
     * @notice Updates an extra trusted inbound application without changing the outbound zone peer.
     * @dev Allowed applications may send new messages. Revocation does not invalidate already cached claims.
     *      Reverts when the application already has the requested permission.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _allowed Whether inbound delivery is allowed
     */
    function setExtraInboundPeer(uint64 _srcZone, bytes calldata _srcApp, bool _allowed) external;

    /**
     * @notice Marks a message for caching without execution during authenticated delivery.
     * @dev Only the owner may set this permanent marker. It does not advance the `Airlock` cursor or verify a payload.
     *      Normal receive must authenticate the payload before caching its hash for permissionless retry.
     *      Reverts when the message is already marked.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _nonce `Airlock` channel nonce
     */
    function markMessageForCaching(uint64 _srcZone, bytes calldata _srcApp, uint64 _nonce) external;
}
