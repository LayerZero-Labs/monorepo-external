// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspector.sol";
import { IOAppReceiver } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppReceiver.sol";
import { OAppMsgInspectionRBACUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/msg-inspection/OAppMsgInspectionRBACUpgradeable.sol";
import { OAppCoreRBACUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppCoreRBACUpgradeable.sol";
import { OAppReceiverUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppReceiverUpgradeable.sol";
import { OAppSenderUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppSenderUpgradeable.sol";
import { OAppUpgradeable, Origin } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppUpgradeable.sol";
import { OAppOptionsType3RBACUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/options-type-3/OAppOptionsType3RBACUpgradeable.sol";
import {
    IOFT,
    SendParam,
    OFTLimit,
    OFTReceipt,
    OFTFeeDetail,
    MessagingReceipt,
    MessagingFee
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm-impl/contracts/libs/OFTComposeMsgCodec.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { FeeHandlerRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/fee-accounting/FeeHandlerRBACUpgradeable.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { OFTRegistryRBACUpgradeable } from "./extensions/OFTRegistryRBACUpgradeable.sol";
import { INexus } from "./interfaces/INexus.sol";
import { INexusFeeConfig } from "./interfaces/INexusFeeConfig.sol";
import { INexusOFT } from "./interfaces/INexusOFT.sol";
import { INexusPause } from "./interfaces/INexusPause.sol";
import { INexusRateLimiter } from "./interfaces/INexusRateLimiter.sol";
import { NexusMsgCodec } from "./libs/NexusMsgCodec.sol";

/**
 * @title Nexus
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice OApp in which OFTs are registered and inherit cross-chain messaging capabilities.
 *         Supports dynamic mint/burn function selectors.
 * @dev Fee configuration, pause, and rate-limiting are delegated to independently upgradeable modules. Module addresses
 *      are mutable and can be swapped by the admin. If a module is not set, its extension is inactive.
 * @dev Burner-minter configurations supported:
 *      - Any mint function if it has `(address,uint256)` parameters.
 *      - Any burn function if it has `(address,uint256)` parameters.
 *      - Examples:
 *        - `mint(address,uint256)`, `burn(address,uint256)`:
 *          - `_mintSelector`: `0x40c10f19`
 *          - `_burnSelector`: `0x9dc29fac`
 *        - `issue(address,uint256)`, `redeem(address,uint256)`:
 *          - `_mintSelector`: `0x867904b4`
 *          - `_burnSelector`: `0x1e9a6950`
 * @dev Conventional LZ token fee payment flow is altered in this contract, since the LZ token fee is pushed to the
 *      endpoint before the OFT token transfer. This can result in LZ token fee griefing if the OFT uses tokens that
 *      have hooks or allow arbitrary calls.
 */
contract Nexus is
    INexus,
    OAppUpgradeable,
    OAppCoreRBACUpgradeable,
    OAppOptionsType3RBACUpgradeable,
    OAppMsgInspectionRBACUpgradeable,
    FeeHandlerRBACUpgradeable,
    OFTRegistryRBACUpgradeable
{
    using Address for address;
    using NexusMsgCodec for bytes;
    using NexusMsgCodec for bytes32;

    /// @dev Message type for regular OFT send operations.
    uint16 public constant SEND = 1;

    /// @dev Message type for OFT send operations that include a compose message.
    uint16 public constant SEND_AND_CALL = 2;

    /// @dev Function selector for the burn function (e.g., `burn(address,uint256)`).
    bytes4 internal immutable BURN_SELECTOR;

    /// @dev Function selector for the mint function (e.g., `mint(address,uint256)`).
    bytes4 internal immutable MINT_SELECTOR;

    /// @custom:storage-location erc7201:layerzerov2.storage.nexus
    struct NexusStorage {
        INexusPause pauseModule;
        INexusFeeConfig feeConfigModule;
        INexusRateLimiter rateLimiterModule;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexus")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NEXUS_STORAGE_LOCATION =
        0xc20e04226fab28e0e9310021f59f0226a6ef622ef143aefd892d971127154900;

    /**
     * @notice Internal function to get the Nexus storage.
     * @return $ Storage pointer
     */
    function _getNexusStorage() internal pure returns (NexusStorage storage $) {
        assembly {
            $.slot := NEXUS_STORAGE_LOCATION
        }
    }

    /**
     * @dev Sets immutable variables.
     * @dev Cross-chain shared decimals are hardcoded to `6`.
     * @param _endpoint LayerZero endpoint address
     * @param _localDecimals Local decimals for tokens on this chain
     * @param _burnSelector Function selector for the burn function, `0x9dc29fac` for `burn(address,uint256)`
     * @param _mintSelector Function selector for the mint function, `0x40c10f19` for `mint(address,uint256)`
     */
    constructor(
        address _endpoint,
        uint8 _localDecimals,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) OAppUpgradeable(_endpoint) OFTRegistryRBACUpgradeable(_localDecimals) {
        BURN_SELECTOR = _burnSelector;
        MINT_SELECTOR = _mintSelector;

        _disableInitializers();
    }

    /**
     * @notice Initializes the Nexus contract.
     * @dev Module addresses are set via setters after initialization, since they depend on the Nexus contract address.
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE` and endpoint delegate
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function initialize(address _initialAdmin, address _feeDeposit) public initializer {
        __OAppCoreBase_init(_initialAdmin);
        __AccessControl2Step_init(_initialAdmin);
        __FeeHandlerBase_init(_feeDeposit);
    }

    // ============ Module Getters ============

    /**
     * @inheritdoc INexus
     */
    function pauseModule() public view virtual returns (INexusPause module) {
        return _getNexusStorage().pauseModule;
    }

    /**
     * @inheritdoc INexus
     */
    function feeConfigModule() public view virtual returns (INexusFeeConfig module) {
        return _getNexusStorage().feeConfigModule;
    }

    /**
     * @inheritdoc INexus
     */
    function rateLimiterModule() public view virtual returns (INexusRateLimiter module) {
        return _getNexusStorage().rateLimiterModule;
    }

    // ============ Module Setters ============

    /**
     * @inheritdoc INexus
     */
    function setPauseModule(address _module) external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _getNexusStorage().pauseModule = INexusPause(_module);
        emit PauseModuleSet(_module);
    }

    /**
     * @inheritdoc INexus
     */
    function setFeeConfigModule(address _module) external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _getNexusStorage().feeConfigModule = INexusFeeConfig(_module);
        emit FeeConfigModuleSet(_module);
    }

    /**
     * @inheritdoc INexus
     */
    function setRateLimiterModule(address _module) external virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _getNexusStorage().rateLimiterModule = INexusRateLimiter(_module);
        emit RateLimiterModuleSet(_module);
    }

    // ============ Nexus Functions ============

    /**
     * @inheritdoc INexus
     */
    function getNexusId(uint32 _tokenId, uint32 _eid) public view virtual returns (uint256 nexusId) {
        return (uint256(_tokenId) << 32) | uint256(_eid);
    }

    /**
     * @inheritdoc INexus
     */
    function nexusQuoteOFT(
        SendParam calldata _sendParam
    )
        public
        view
        virtual
        returns (OFTLimit memory oftLimit, OFTFeeDetail[] memory oftFeeDetails, OFTReceipt memory oftReceipt)
    {
        uint32 tokenId = _getAndAssertTokenId(msg.sender);
        uint256 nexusId = getNexusId(tokenId, _sendParam.dstEid);

        /// @dev Override `maxAmountLD` with rate limit and pausability rules.
        uint256 maxAmountLD;

        if (_isPaused(nexusId)) {
            maxAmountLD = 0;
        } else {
            maxAmountLD = _getOutboundAvailable(nexusId);
        }

        if (maxAmountLD != 0 && maxAmountLD != type(uint256).max) {
            maxAmountLD = _getAmountBeforeFee(nexusId, maxAmountLD);
        }

        oftLimit = OFTLimit(0, maxAmountLD);

        (uint256 amountSentLD, uint256 amountReceivedLD) = _debitView(
            nexusId,
            _sendParam.amountLD,
            _sendParam.minAmountLD
        );
        oftReceipt = OFTReceipt(amountSentLD, amountReceivedLD);

        if (amountSentLD > amountReceivedLD) {
            oftFeeDetails = new OFTFeeDetail[](1);
            unchecked {
                oftFeeDetails[0] = OFTFeeDetail(int256(amountSentLD - amountReceivedLD), "Fee");
            }
        } else {
            oftFeeDetails = new OFTFeeDetail[](0);
        }
    }

    /**
     * @inheritdoc INexus
     */
    function nexusQuoteSend(
        address _from,
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) public view virtual returns (MessagingFee memory msgFee) {
        uint32 tokenId = _getAndAssertTokenId(msg.sender);
        uint256 nexusId = getNexusId(tokenId, _sendParam.dstEid);

        /// @dev Calculate amount to receive on destination. Equivalent to the calculation in the `send` operation.
        (, uint256 amountReceivedLD) = _debitView(nexusId, _sendParam.amountLD, _sendParam.minAmountLD);

        /// @dev Builds the options and OFT message to quote in the endpoint.
        (bytes memory message, bytes memory options) = _buildMsgAndOptions(
            _from,
            tokenId,
            _sendParam,
            amountReceivedLD
        );

        /// @dev Calculates the LayerZero fee for the `send` operation.
        return _quote(_sendParam.dstEid, message, options, _payInLzToken);
    }

    /**
     * @inheritdoc INexus
     */
    function nexusSend(
        address _from,
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) public payable virtual returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt) {
        uint32 tokenId = _getAndAssertTokenId(msg.sender);

        /// @dev Applies the token transfers regarding this `send` operation.
        ///      - `amountSentLD` is the amount in local decimals that was actually debited from the sender.
        ///      - `amountReceivedLD` is the amount in local decimals that will be credited to the recipient on the
        ///         remote OFT instance.
        (uint256 amountSentLD, uint256 amountReceivedLD) = _debit(
            getNexusId(tokenId, _sendParam.dstEid),
            getBurnerMinterAddress(tokenId),
            _from,
            _sendParam.amountLD,
            _sendParam.minAmountLD
        );

        /// @dev Builds the options and OFT message to quote in the endpoint.
        (bytes memory message, bytes memory options) = _buildMsgAndOptions(
            _from,
            tokenId,
            _sendParam,
            amountReceivedLD
        );

        /// @dev Sends the message to the LayerZero endpoint and returns the LayerZero messaging receipt.
        msgReceipt = _lzSend(_sendParam.dstEid, message, options, _fee, _refundAddress);
        oftReceipt = OFTReceipt(amountSentLD, amountReceivedLD);
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculates the amounts for a debit operation without state changes.
     * @dev Applies fees and removes dust from the received amount.
     * @param _nexusId Unique Nexus identifier of token and EID
     * @param _amountLD Amount to send in local decimals
     * @param _minAmountLD Minimum amount acceptable (slippage protection)
     * @return amountSentLD Amount that will be debited from the sender
     * @return amountReceivedLD Amount that will be received on the remote chain
     */
    function _debitView(
        uint256 _nexusId,
        uint256 _amountLD,
        uint256 _minAmountLD
    ) internal view virtual returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        /// @dev Apply the fee, then de-dust the amount afterwards.
        ///      This means the fee is taken from the amount before the dust is removed.
        uint256 fee = _getFee(_nexusId, _amountLD);
        amountReceivedLD = _removeDust(_amountLD - fee);

        /// @dev `amountSentLD` is never de-dusted, UI needs to ensure the amount sent doesn't have dust, otherwise it
        ///      will be taken as a fee, even if no fees are enabled.
        amountSentLD = _amountLD;

        /// @dev Check for slippage.
        if (amountReceivedLD < _minAmountLD) {
            revert IOFT.SlippageExceeded(amountReceivedLD, _minAmountLD);
        }
    }

    /**
     * @notice Executes the debit operation, burning tokens and collecting fees.
     * @dev Applies rate limiting, fees, and pausability checks.
     * @param _nexusId Unique Nexus identifier of token and EID
     * @param _burnerMinter Burner minter of the underlying token
     * @param _from Address to debit tokens from
     * @param _amountLD Amount to send in local decimals
     * @param _minAmountLD Minimum amount acceptable (slippage protection)
     * @return amountSentLD Amount debited from the sender
     * @return amountReceivedLD Amount to be received on the remote chain
     */
    function _debit(
        uint256 _nexusId,
        address _burnerMinter,
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD
    ) internal virtual returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        if (_isPaused(_nexusId)) revert INexusPause.Paused(_nexusId);

        /// @dev Apply fees and slippage protection.
        (amountSentLD, amountReceivedLD) = _debitView(_nexusId, _amountLD, _minAmountLD);

        /// @dev Apply rate limit.
        _outflow(_nexusId, _from, amountReceivedLD);

        _burnAndCollectFee(_burnerMinter, _from, amountSentLD, amountReceivedLD);
    }

    /**
     * @notice Builds the LayerZero message and options for a send operation.
     * @dev Optionally inspects the message if a message inspector is configured.
     * @param _from Address sending the message
     * @param _tokenId Unique token identifier
     * @param _sendParam Parameters for the send operation
     * @param _amountLD Dust-removed amount in local decimals to encode
     * @return message Encoded Nexus message with `tokenId` prefix
     * @return options Combined enforced and extra options
     */
    function _buildMsgAndOptions(
        address _from,
        uint32 _tokenId,
        SendParam calldata _sendParam,
        uint256 _amountLD
    ) internal view virtual returns (bytes memory message, bytes memory options) {
        bool hasCompose;

        /// @dev Encode the Nexus message with `tokenId` prefix.
        ///      `_from` is passed as the compose sender so that receiving contracts can identify the original user,
        ///      rather than the `NexusOFT` wrapper contract.
        (message, hasCompose) = NexusMsgCodec.encode(
            _tokenId,
            _sendParam.to,
            _toSD(_amountLD),
            _from,
            /// @dev Must include a non-empty bytes to send any compose message, even if the remote doesn't require it.
            //       Even if an arbitrary payload is not required, it must be non-empty. For example, `0x01`.
            _sendParam.composeMsg
        );

        /// @dev Combine the caller's `extraOptions` with the enforced options via `OAppOptionsType3`.
        options = combineOptions(
            _sendParam.dstEid,
            hasCompose ? SEND_AND_CALL : SEND, /// @dev Message type depends on compose.
            _sendParam.extraOptions
        );

        /// @dev Inspection needs to revert if it fails, it does not rely on the return boolean.
        address inspector = msgInspector();
        if (inspector != address(0)) IOAppMsgInspector(inspector).inspect(_from, message, options);
    }

    /**
     * @dev Decodes the Nexus message to extract `tokenId`, then credits tokens to the recipient.
     * @dev If the message is composed, encodes a compose message and forwards it to the OFT contract.
     * @dev `_executor` and `_extraData` are unused in the default implementation.
     * @inheritdoc OAppReceiverUpgradeable
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address /* _executor */,
        bytes calldata /* _extraData */
    ) internal virtual override {
        uint32 tokenId = _message.tokenId();
        address oftAddress = _getAndAssertOFTAddress(tokenId);

        uint256 amountReceivedLD = _credit(
            getNexusId(tokenId, _origin.srcEid),
            getBurnerMinterAddress(tokenId),
            _message.sendTo().bytes32ToAddress(),
            _toLD(_message.amountSD())
        );

        bytes memory composeMsg;

        if (_message.isComposed()) {
            composeMsg = OFTComposeMsgCodec.encode(
                _origin.nonce,
                _origin.srcEid,
                amountReceivedLD,
                _message.composeMsg()
            );
        }

        INexusOFT(oftAddress).nexusReceive(
            address(endpoint),
            _guid,
            _origin.srcEid,
            _message.sendTo().bytes32ToAddress(),
            amountReceivedLD,
            composeMsg
        );
    }

    /**
     * @notice Credits tokens to a recipient on the destination chain.
     * @dev Applies inbound rate limiting before minting tokens.
     * @dev Redirects to `0xdead` if recipient is `address(0)`.
     * @param _nexusId Unique Nexus identifier of token and EID
     * @param _burnerMinter Burner minter contract of underlying token
     * @param _to Recipient address
     * @param _amountLD Amount to credit in local decimals
     * @return amountReceivedLD The amount actually received
     */
    function _credit(
        uint256 _nexusId,
        address _burnerMinter,
        address _to,
        uint256 _amountLD
    ) internal virtual returns (uint256 amountReceivedLD) {
        /// @dev Most ERC20 implementations do not support minting to `address(0x0)`.
        if (_to == address(0)) _to = address(0xdead);

        /// @dev Apply rate limit.
        _inflow(_nexusId, _to, _amountLD);

        _mint(_burnerMinter, _to, _amountLD);

        /// @dev In the case of a non-default OFT adapter, `_amountLD` might not be equal to `amountReceivedLD`.
        return _amountLD;
    }

    /**
     * @notice Burns tokens from the specified address and collects fees using the configured burn/mint interfaces.
     * @param _burnerMinter Address of the burner minter contract
     * @param _from Address to burn tokens from
     * @param _amountSentLD Amount of tokens sent in local decimals, amount burned from user
     * @param _amountReceivedLD Amount of tokens to be received in destination chain in local decimals
     */
    function _burnAndCollectFee(
        address _burnerMinter,
        address _from,
        uint256 _amountSentLD,
        uint256 _amountReceivedLD
    ) internal virtual {
        _callBurnerMinter(_burnerMinter, abi.encodeWithSelector(BURN_SELECTOR, _from, _amountSentLD));

        /// @dev Collect fee by minting directly to the fee deposit.
        if (_amountSentLD > _amountReceivedLD) {
            _mint(_burnerMinter, feeDeposit(), _amountSentLD - _amountReceivedLD);
        }
    }

    /**
     * @notice Mints tokens to the specified address using the configured mint interface.
     * @param _burnerMinter Address of the burner minter contract
     * @param _to Address to mint tokens to
     * @param _amount Amount of tokens to mint
     */
    function _mint(address _burnerMinter, address _to, uint256 _amount) internal virtual {
        _callBurnerMinter(_burnerMinter, abi.encodeWithSelector(MINT_SELECTOR, _to, _amount));
    }

    /**
     * @notice Executes a low-level call to the burner minter with the given data.
     *         Propagates revert reasons. Does not handle non-standard return values.
     * @dev Burner minter is expected to revert if the call fails.
     * @param _burnerMinter Address of the burner minter contract
     * @param _data Calldata to send
     */
    function _callBurnerMinter(address _burnerMinter, bytes memory _data) internal virtual {
        _burnerMinter.functionCall(_data);
    }

    // ============ Internal Module Wrappers ============

    /**
     * @notice Checks if transfers to a destination ID are paused.
     * @dev Returns `false` if the pause module is not set.
     * @param _id Destination ID
     * @return paused Whether transfers are paused
     */
    function _isPaused(uint256 _id) internal view virtual returns (bool paused) {
        INexusPause pauseModule_ = _getNexusStorage().pauseModule;
        if (address(pauseModule_) == address(0)) return false;
        return pauseModule_.isPaused(_id);
    }

    /**
     * @notice Calculates the fee for a given amount and destination.
     * @dev Returns `0` if the fee config module is not set.
     * @param _id Destination ID
     * @param _amount Amount to calculate the fee for
     * @return fee Fee amount
     */
    function _getFee(uint256 _id, uint256 _amount) internal view virtual returns (uint256 fee) {
        INexusFeeConfig feeConfigModule_ = _getNexusStorage().feeConfigModule;
        if (address(feeConfigModule_) == address(0)) return 0;
        return feeConfigModule_.getFee(_id, _amount);
    }

    /**
     * @notice Calculates the pre-fee amount required to yield a given post-fee amount.
     * @dev Returns `_amountAfterFee` if the fee config module is not set.
     * @param _id Destination ID
     * @param _amountAfterFee Desired amount after fees
     * @return amountBeforeFee Required amount before fees
     */
    function _getAmountBeforeFee(
        uint256 _id,
        uint256 _amountAfterFee
    ) internal view virtual returns (uint256 amountBeforeFee) {
        INexusFeeConfig feeConfigModule_ = _getNexusStorage().feeConfigModule;
        if (address(feeConfigModule_) == address(0)) return _amountAfterFee;
        return feeConfigModule_.getAmountBeforeFee(_id, _amountAfterFee);
    }

    /**
     * @notice Retrieves the available outbound rate limit capacity.
     * @dev Returns `type(uint256).max` if the rate limiter module is not set.
     * @param _id Destination ID
     * @return outboundAvailableAmount Outbound rate limit available capacity
     */
    function _getOutboundAvailable(uint256 _id) internal view virtual returns (uint256 outboundAvailableAmount) {
        INexusRateLimiter rateLimiterModule_ = _getNexusStorage().rateLimiterModule;
        if (address(rateLimiterModule_) == address(0)) return type(uint256).max;
        return rateLimiterModule_.getOutboundAvailable(_id);
    }

    /**
     * @notice Applies rate limit logic for an outflow.
     * @dev No-op if the rate limiter module is not set.
     * @param _id Destination ID
     * @param _from Sender of the action
     * @param _amount Amount of the action
     */
    function _outflow(uint256 _id, address _from, uint256 _amount) internal virtual {
        INexusRateLimiter rateLimiterModule_ = _getNexusStorage().rateLimiterModule;
        if (address(rateLimiterModule_) == address(0)) return;
        rateLimiterModule_.outflow(_id, _from, _amount);
    }

    /**
     * @notice Applies rate limit logic for an inflow.
     * @dev No-op if the rate limiter module is not set.
     * @param _id Destination ID
     * @param _to Recipient of the action
     * @param _amount Amount of the action
     */
    function _inflow(uint256 _id, address _to, uint256 _amount) internal virtual {
        INexusRateLimiter rateLimiterModule_ = _getNexusStorage().rateLimiterModule;
        if (address(rateLimiterModule_) == address(0)) return;
        rateLimiterModule_.inflow(_id, _to, _amount);
    }

    // ============ Overrides ============

    /**
     * @dev Authenticates compose message senders using OFT registry.
     * @inheritdoc OAppReceiverUpgradeable
     */
    function isComposeMsgSender(
        Origin calldata /* _origin */,
        bytes calldata /* _message */,
        address _sender
    ) public view virtual override(IOAppReceiver, OAppReceiverUpgradeable) returns (bool isSender) {
        return getTokenId(_sender) != 0;
    }

    /**
     * @dev `NexusOFT.send` handles pushing LZ token fee to the endpoint. This alters conventional OFT flow, where the
     *      fee is paid after the OFT token transfer, and can result in LZ token fee griefing if the OFT uses tokens
     *      that have hooks or allow arbitrary calls.
     * @inheritdoc OAppSenderUpgradeable
     */
    function _payLzToken(uint256 _lzTokenFee) internal virtual override {}

    /**
     * @inheritdoc OAppCoreRBACUpgradeable
     */
    function acceptDefaultAdminTransfer()
        public
        virtual
        override(OAppCoreRBACUpgradeable, AccessControl2StepUpgradeable)
    {
        super.acceptDefaultAdminTransfer();
    }
}
