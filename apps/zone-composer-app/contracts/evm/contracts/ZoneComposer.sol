// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ILayerZeroComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroComposer.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppCore.sol";
import { IOFT } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm-contracts/contracts/libs/OFTComposeMsgCodec.sol";
import { IZoneRouter } from "@layerzerolabs/zone-router-evm-contracts/contracts/interfaces/IZoneRouter.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IZoneComposer } from "./interfaces/IZoneComposer.sol";
import { ZoneComposerMsgCodec } from "./libs/ZoneComposerMsgCodec.sol";

/**
 * @title ZoneComposer
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Forwards credited OFT tokens through a token router to another Zero zone.
 * @dev Undecodable payloads are cached for owner rescue.
 * @dev Unroutable destinations are cached for permissionless retry or owner rescue.
 * @dev Other router failures leave compose delivery retryable.
 */
contract ZoneComposer is IZoneComposer, Ownable2Step {
    using SafeERC20 for IERC20;

    /// @inheritdoc IZoneComposer
    address public immutable OFT;

    /// @inheritdoc IZoneComposer
    address public immutable ENDPOINT;

    /// @inheritdoc IZoneComposer
    address public immutable TOKEN;

    /// @inheritdoc IZoneComposer
    address public immutable ROUTER;

    /// @inheritdoc IZoneComposer
    mapping(bytes32 guid => uint256 amountLD) public rescuableMessages;

    /// @inheritdoc IZoneComposer
    mapping(bytes32 guid => bytes32 transferHash) public retryableMessages;

    /**
     * @param _initialOwner Initial owner
     * @param _oft OFT whose credited tokens can be forwarded
     * @param _router Token router
     */
    constructor(address _initialOwner, address _oft, address _router) Ownable(_initialOwner) {
        if (_oft == address(0)) revert InvalidOFT();

        address endpoint = address(IOAppCore(_oft).endpoint());
        if (endpoint == address(0)) revert InvalidEndpoint();
        address token = _configureToken(_oft, _router);

        OFT = _oft;
        TOKEN = token;
        ENDPOINT = endpoint;
        ROUTER = _router;
    }

    /// @inheritdoc ILayerZeroComposer
    function lzCompose(
        address _from,
        bytes32 _guid,
        bytes calldata _message,
        address,
        bytes calldata
    ) public payable virtual {
        if (msg.sender != ENDPOINT) revert OnlyEndpoint(msg.sender);
        if (_from != OFT) revert OnlyOFT(_from);
        if (msg.value != 0) revert UnexpectedValue(msg.value);

        uint256 amountLD = OFTComposeMsgCodec.amountLD(_message);
        if (amountLD == 0) revert ZeroAmount();

        try this.decode(OFTComposeMsgCodec.composeMsg(_message)) returns (
            uint64 dstZone,
            bytes memory recipient,
            bytes memory memo
        ) {
            if (_isRoutable(dstZone)) {
                _send(_guid, dstZone, recipient, amountLD, memo);
            } else {
                rescuableMessages[_guid] = amountLD;
                retryableMessages[_guid] = keccak256(abi.encode(dstZone, recipient, memo));
                emit UnroutableZone(_guid, dstZone, recipient, memo);
            }
        } catch {
            rescuableMessages[_guid] = amountLD;
            emit DecodeFailed(_guid, OFTComposeMsgCodec.composeMsg(_message));
        }
    }

    /// @inheritdoc IZoneComposer
    function retry(bytes32 _guid, uint64 _dstZone, bytes calldata _recipient, bytes calldata _memo) public virtual {
        if (retryableMessages[_guid] != keccak256(abi.encode(_dstZone, _recipient, _memo))) {
            revert NothingToRetry(_guid);
        }

        uint256 amountLD = rescuableMessages[_guid];
        delete rescuableMessages[_guid];
        delete retryableMessages[_guid];

        _send(_guid, _dstZone, _recipient, amountLD, _memo);
        emit Retried(_guid);
    }

    /// @inheritdoc IZoneComposer
    function rescue(bytes32 _guid, address _to) public virtual onlyOwner {
        if (_to == address(0)) revert InvalidRescueRecipient();

        uint256 amountLD = rescuableMessages[_guid];
        if (amountLD == 0) revert NothingToRescue(_guid);

        delete rescuableMessages[_guid];
        delete retryableMessages[_guid];
        _rescue(_to, amountLD);
        emit Rescued(_guid, _to, amountLD);
    }

    /**
     * @inheritdoc Ownable
     * @dev Disallow renouncing ownership.
     */
    function renounceOwnership() public view virtual override onlyOwner {
        revert CannotRenounceOwnership();
    }

    /**
     * @notice Decodes a compose payload for the external try-catch boundary.
     * @param _message Encoded destination zone, recipient, and optional memo
     * @return dstZone Destination zone
     * @return recipient Recipient in the destination zone's account encoding
     * @return memo Opaque transfer memo
     */
    function decode(
        bytes calldata _message
    ) public pure virtual returns (uint64 dstZone, bytes memory recipient, bytes memory memo) {
        return ZoneComposerMsgCodec.decode(_message);
    }

    /**
     * @notice Validates the OFT asset and configures its router approval.
     * @param _oft OFT whose credited tokens can be forwarded
     * @param _router Token router
     * @return token ERC20 token
     */
    function _configureToken(address _oft, address _router) internal virtual returns (address token) {
        token = IOFT(_oft).token();
        if (token.code.length == 0) revert InvalidOFT();
        if (_router.code.length == 0) revert InvalidRouter();

        IZoneRouter.Config memory configuration = IZoneRouter(_router).config();
        if (configuration.token != token) revert InvalidRouter();
        address spender = configuration.mode == IZoneRouter.Mode.BurnMint && configuration.burnerMinter != token
            ? configuration.burnerMinter
            : _router;
        IERC20(token).forceApprove(spender, type(uint256).max);
    }

    /**
     * @notice Returns whether a destination zone can be routed.
     * @param _dstZone Destination zone
     * @return routable Whether the destination zone can be routed
     */
    function _isRoutable(uint64 _dstZone) internal view virtual returns (bool routable) {
        return IZoneRouter(ROUTER).zonePeers(_dstZone).length != 0;
    }

    /**
     * @notice Forwards a credited amount through the configured router and emits `Sent`.
     * @param _guid Message GUID
     * @param _dstZone Destination zone
     * @param _recipient Destination recipient
     * @param _amountLD Credited amount in local units
     * @param _memo Opaque transfer memo
     */
    function _send(
        bytes32 _guid,
        uint64 _dstZone,
        bytes memory _recipient,
        uint256 _amountLD,
        bytes memory _memo
    ) internal virtual {
        uint64 nonce = IZoneRouter(ROUTER).sendToken(_dstZone, _recipient, _amountLD, _memo);
        emit Sent(_guid, _dstZone, nonce);
    }

    /**
     * @notice Transfers a cached credit to its rescue recipient.
     * @param _to Rescue recipient
     * @param _amountLD Credited amount
     */
    function _rescue(address _to, uint256 _amountLD) internal virtual {
        IERC20(TOKEN).safeTransfer(_to, _amountLD);
    }
}
