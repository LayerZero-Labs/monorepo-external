// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { AddressCast } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/AddressCast.sol";
import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { LowLevelCall } from "@openzeppelin/contracts/utils/LowLevelCall.sol";
import { BitMaps } from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "./interfaces/IAirlock.sol";
import { IAirlockReceiver } from "./interfaces/IAirlockReceiver.sol";
import { IZoneRouter } from "./interfaces/IZoneRouter.sol";

/**
 * @title ZoneRouter
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Transfers one ERC20 asset across trusted Zero applications.
 * @dev Zone peers must use the same asset. Scales amounts up to 18 decimals on send and down on receive,
 *      where dust is removed.
 *      Lock/unlock zone peers share this router's locked liquidity.
 *      Fee-on-transfer and rebasing tokens are unsupported. The token and its privileged operators must be trusted.
 */
contract ZoneRouter is IZoneRouter, Ownable2StepUpgradeable {
    using SafeERC20 for IERC20;
    using Address for address;
    using BitMaps for BitMaps.BitMap;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.BytesSet;

    /// @custom:storage-location erc7201:layerzerov2.storage.zonerouter
    struct ZoneRouterStorage {
        Config config;
        mapping(uint64 zone => bytes zonePeer) zonePeers;
        EnumerableSet.UintSet peerZones;
        mapping(uint64 zone => EnumerableSet.BytesSet peers) extraInboundPeers;
        mapping(uint64 zone => mapping(bytes app => mapping(uint64 nonce => bytes32 messageHash))) cachedMessages;
        mapping(uint64 zone => mapping(bytes app => uint256 count)) cachedMessagesCount;
        mapping(uint64 zone => mapping(bytes app => BitMaps.BitMap)) messagesToCache;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.zonerouter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ZONE_ROUTER_STORAGE_LOCATION =
        0x0456790dfd3b2585c24c79cad9a90da0a48da35ababc338f6e24b28613616300;

    /**
     * @notice Internal function to get the router storage.
     * @return $ Storage pointer
     */
    function _getZoneRouterStorage() internal pure returns (ZoneRouterStorage storage $) {
        assembly {
            $.slot := ZONE_ROUTER_STORAGE_LOCATION
        }
    }

    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IZoneRouter
    function initialize(address _initialOwner, Config calldata _config) public virtual initializer {
        __Ownable_init(_initialOwner);
        __Ownable2Step_init();

        if (_config.token.code.length == 0) revert InvalidToken();
        if (_config.mode != Mode.LockUnlock && _config.burnerMinter == address(0)) revert InvalidBurnerMinter();
        if (_config.localDecimals > 18) revert InvalidLocalDecimals(_config.localDecimals);
        uint8 tokenDecimals = IERC20Metadata(_config.token).decimals();
        if (_config.localDecimals != tokenDecimals) revert LocalDecimalsMismatch(_config.localDecimals, tokenDecimals);

        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        $.config = _config;
    }

    /// @inheritdoc IZoneRouter
    function config() public view virtual returns (Config memory configuration) {
        return _getZoneRouterStorage().config;
    }

    /// @inheritdoc IZoneRouter
    function zonePeers(uint64 _zone) public view virtual returns (bytes memory zonePeer) {
        return _getZoneRouterStorage().zonePeers[_zone];
    }

    /// @inheritdoc IZoneRouter
    function getZonePeers() public view virtual returns (ZonePeer[] memory peers) {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        uint256 length = $.peerZones.length();
        peers = new ZonePeer[](length);
        for (uint256 i; i < length; ++i) {
            uint64 zone = uint64($.peerZones.at(i));
            peers[i] = ZonePeer(zone, $.zonePeers[zone]);
        }
    }

    /// @inheritdoc IZoneRouter
    function extraInboundPeers(uint64 _srcZone, bytes calldata _srcApp) public view virtual returns (bool allowed) {
        return _getZoneRouterStorage().extraInboundPeers[_srcZone].contains(_srcApp);
    }

    /// @inheritdoc IZoneRouter
    function getExtraInboundPeers(uint64 _srcZone) public view virtual returns (bytes[] memory peers) {
        return _getZoneRouterStorage().extraInboundPeers[_srcZone].values();
    }

    /// @inheritdoc IZoneRouter
    function cachedMessages(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce
    ) public view virtual returns (bytes32 messageHash) {
        return _getZoneRouterStorage().cachedMessages[_srcZone][_srcApp][_nonce];
    }

    /// @inheritdoc IZoneRouter
    function cachedMessagesCount(uint64 _srcZone, bytes calldata _srcApp) public view virtual returns (uint256 count) {
        return _getZoneRouterStorage().cachedMessagesCount[_srcZone][_srcApp];
    }

    /// @inheritdoc IZoneRouter
    function messagesToCache(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce
    ) public view virtual returns (bool marked) {
        return _getZoneRouterStorage().messagesToCache[_srcZone][_srcApp].get(_nonce);
    }

    /// @inheritdoc IZoneRouter
    function sendToken(
        uint64 _dstZone,
        bytes calldata _recipient,
        uint256 _amountLD,
        bytes calldata _memo
    ) public virtual returns (uint64 nonce) {
        bytes memory zonePeer = _getZoneRouterStorage().zonePeers[_dstZone];
        if (zonePeer.length == 0) revert UntrustedZonePeer(_dstZone, zonePeer);

        if (_amountLD == 0) revert ZeroAmount();

        _debit(msg.sender, _amountLD);

        nonce = IAirlock(AIRLOCK_ADDRESS).send(
            _dstZone,
            zonePeer,
            _amountLD * _conversionRate(),
            abi.encodePacked(msg.sender),
            _recipient,
            _memo
        );
        emit Sent(_dstZone, zonePeer, nonce, msg.sender, _recipient, _amountLD);
    }

    /**
     * @dev Anyone may relay a batch. `Airlock` authenticates proofs and enforces its cursor
     *      and a count from `1` through `64`.
     *      Marked messages and execution failures are cached by payload hash and emit `MessageCached`.
     *      `Airlock` failures or insufficient outer execution gas revert the batch, including the cursor.
     * @inheritdoc IAirlockReceiver
     */
    function airlockReceive(uint64 _srcZone, bytes calldata _srcApp, uint64 _firstNonce, uint64 _count) public virtual {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        if (
            keccak256($.zonePeers[_srcZone]) != keccak256(_srcApp) && !$.extraInboundPeers[_srcZone].contains(_srcApp)
        ) {
            revert UntrustedZonePeer(_srcZone, _srcApp);
        }

        /// @dev `Airlock` journals the batch cursor before token calls, so reentrant calls cannot replay its nonces.
        IAirlock.Message[] memory messages = IAirlock(AIRLOCK_ADDRESS).receiveMessages(
            _srcZone,
            _srcApp,
            _firstNonce,
            _count
        );

        for (uint256 i; i < messages.length; ++i) {
            uint64 nonce = _firstNonce + uint64(i);
            if ($.messagesToCache[_srcZone][_srcApp].get(nonce)) {
                _cacheMessage(_srcZone, _srcApp, nonce, messages[i]);
                continue;
            }

            bool success = LowLevelCall.callNoReturn(
                address(this),
                abi.encodeCall(this.receiveMessage, (_srcZone, _srcApp, nonce, messages[i]))
            );
            if (!success) {
                _cacheMessage(_srcZone, _srcApp, nonce, messages[i]);
            }
        }
    }

    /**
     * @dev External call for isolated message execution. Only this router may call it.
     * @param _srcZone Authenticated source zone
     * @param _srcApp Authenticated source application
     * @param _nonce Authenticated channel nonce
     * @param _message Authenticated transfer payload
     */
    function receiveMessage(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce,
        IAirlock.Message calldata _message
    ) public virtual {
        if (msg.sender != address(this)) revert OnlySelf(msg.sender);
        address recipient = AddressCast.toAddress(_message.recipient);
        uint256 amountLD = _message.amount18d / _conversionRate();
        _credit(recipient, amountLD);
        emit Received(_srcZone, _srcApp, _nonce, recipient, amountLD);
    }

    /// @inheritdoc IZoneRouter
    function retryMessage(
        uint64 _srcZone,
        bytes memory _srcApp,
        uint64 _nonce,
        IAirlock.Message calldata _message
    ) public virtual {
        _consumeCachedMessage(_srcZone, _srcApp, _nonce, _message);
        this.receiveMessage(_srcZone, _srcApp, _nonce, _message);
    }

    /// @inheritdoc IZoneRouter
    function rescueMessage(
        uint64 _srcZone,
        bytes memory _srcApp,
        uint64 _nonce,
        IAirlock.Message calldata _message,
        address _to
    ) public virtual onlyOwner {
        if (_to == address(0)) revert InvalidRescueRecipient();
        if (_message.recipient.length == 20) revert InvalidRescueMessage();

        _consumeCachedMessage(_srcZone, _srcApp, _nonce, _message);
        uint256 amountLD = _message.amount18d / _conversionRate();
        _credit(_to, amountLD);
        emit MessageRescued(_srcZone, _srcApp, _nonce, _to, amountLD);
    }

    /// @inheritdoc IZoneRouter
    function setZonePeer(uint64 _zone, bytes calldata _zonePeer) public virtual onlyOwner {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        $.zonePeers[_zone] = _zonePeer;
        if (_zonePeer.length == 0) {
            $.peerZones.remove(_zone);
        } else {
            $.peerZones.add(_zone);
        }
        emit ZonePeerSet(_zone, _zonePeer);
    }

    /// @inheritdoc IZoneRouter
    function setExtraInboundPeer(uint64 _srcZone, bytes calldata _srcApp, bool _allowed) public virtual onlyOwner {
        EnumerableSet.BytesSet storage peers = _getZoneRouterStorage().extraInboundPeers[_srcZone];
        bool addedOrRemoved;
        if (_allowed) {
            addedOrRemoved = peers.add(_srcApp);
        } else {
            addedOrRemoved = peers.remove(_srcApp);
        }
        if (!addedOrRemoved) revert ExtraInboundPeerStateIdempotent(_srcZone, _srcApp, _allowed);
        emit ExtraInboundPeerSet(_srcZone, _srcApp, _allowed);
    }

    /// @inheritdoc IZoneRouter
    function markMessageForCaching(uint64 _srcZone, bytes calldata _srcApp, uint64 _nonce) public virtual onlyOwner {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        if ($.messagesToCache[_srcZone][_srcApp].get(_nonce)) {
            revert MessageAlreadyMarkedForCaching(_srcZone, _srcApp, _nonce);
        }
        $.messagesToCache[_srcZone][_srcApp].set(_nonce);
        emit MessageMarkedForCaching(_srcZone, _srcApp, _nonce);
    }

    /**
     * @inheritdoc OwnableUpgradeable
     * @dev Disallow renouncing ownership.
     */
    function renounceOwnership() public view virtual override onlyOwner {
        revert CannotRenounceOwnership();
    }

    /**
     * @notice Returns the factor between local units and `Airlock`'s 18-decimal amounts.
     * @return rate `10 ** (18 - localDecimals)`
     */
    function _conversionRate() internal view virtual returns (uint256 rate) {
        return 10 ** uint256(18 - _getZoneRouterStorage().config.localDecimals);
    }

    /**
     * @notice Consumes an exact authenticated cached claim before token settlement.
     * @param _srcZone Authenticated source zone
     * @param _srcApp Authenticated source application
     * @param _nonce Authenticated channel nonce
     * @param _message Authenticated transfer payload
     */
    function _consumeCachedMessage(
        uint64 _srcZone,
        bytes memory _srcApp,
        uint64 _nonce,
        IAirlock.Message calldata _message
    ) internal virtual {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        bytes32 expected = $.cachedMessages[_srcZone][_srcApp][_nonce];
        if (expected == bytes32(0) || expected != keccak256(abi.encode(_message))) revert InvalidCachedMessage();

        delete $.cachedMessages[_srcZone][_srcApp][_nonce];
        --$.cachedMessagesCount[_srcZone][_srcApp];
    }

    /**
     * @notice Caches an authenticated message for permissionless retry.
     * @param _srcZone Authenticated source zone
     * @param _srcApp Authenticated source application
     * @param _nonce Authenticated channel nonce
     * @param _message Authenticated transfer payload
     */
    function _cacheMessage(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _nonce,
        IAirlock.Message memory _message
    ) internal virtual {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        ++$.cachedMessagesCount[_srcZone][_srcApp];
        $.cachedMessages[_srcZone][_srcApp][_nonce] = keccak256(abi.encode(_message));
        emit MessageCached(_srcZone, _srcApp, _nonce, _message);
    }

    /**
     * @notice Locks or burns tokens from the caller.
     * @param _from Token owner
     * @param _amountLD Token amount in local units
     */
    function _debit(address _from, uint256 _amountLD) internal virtual {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        if ($.config.mode == Mode.LockUnlock) {
            IERC20($.config.token).safeTransferFrom(_from, address(this), _amountLD);
        } else if ($.config.mode == Mode.BurnMint) {
            $.config.burnerMinter.functionCall(abi.encodeWithSelector($.config.burnSelector, _from, _amountLD));
        } else {
            IERC20($.config.token).safeTransferFrom(_from, address(this), _amountLD);
            $.config.burnerMinter.functionCall(abi.encodeWithSelector($.config.burnSelector, _amountLD));
        }
    }

    /**
     * @notice Releases or mints tokens to the recipient.
     * @param _to Token recipient
     * @param _amountLD Token amount in local units
     */
    function _credit(address _to, uint256 _amountLD) internal virtual {
        ZoneRouterStorage storage $ = _getZoneRouterStorage();
        if ($.config.mode == Mode.LockUnlock) {
            IERC20($.config.token).safeTransfer(_to, _amountLD);
        } else {
            $.config.burnerMinter.functionCall(abi.encodeWithSelector($.config.mintSelector, _to, _amountLD));
        }
    }
}
