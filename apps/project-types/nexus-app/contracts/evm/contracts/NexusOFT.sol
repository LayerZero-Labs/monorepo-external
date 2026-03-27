// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ILayerZeroEndpointV2 } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppCore.sol";
import {
    IOFT,
    SendParam,
    OFTLimit,
    OFTReceipt,
    OFTFeeDetail,
    MessagingReceipt,
    MessagingFee
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { INexus } from "./interfaces/INexus.sol";
import { INexusOFT } from "./interfaces/INexusOFT.sol";
import { IOFTRegistry } from "./interfaces/IOFTRegistry.sol";

/**
 * @title NexusOFT
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice OFT contract that forwards cross-chain operations to the Nexus hub.
 * @dev This contract is stateless and acts as a proxy between users and the Nexus contract.
 * @dev Users interact with this contract using the standard IOFT interface.
 * @dev Conventional LZ token fee payment flow is altered in this contract, since the LZ token fee is pushed to the
 *      endpoint before the OFT token transfer. This can result in LZ token fee griefing if the OFT uses tokens that
 *      have hooks or allow arbitrary calls.
 */
contract NexusOFT is INexusOFT {
    using SafeERC20 for IERC20;

    /// @dev Nexus hub contract (typed for internal use).
    INexus internal immutable NEXUS;

    /// @dev LayerZero endpoint contract, cached to allow LZ token fee pushing.
    ILayerZeroEndpointV2 internal immutable ENDPOINT;

    /// @dev Underlying ERC20 token.
    address internal immutable INNER_TOKEN;

    /// @dev Token ID for the OFT in Nexus.
    uint32 internal immutable TOKEN_ID;

    /**
     * @notice Modifier to restrict function access to the Nexus contract only.
     */
    modifier onlyNexus() {
        if (msg.sender != address(NEXUS)) revert OnlyNexus();
        _;
    }

    /**
     * @dev Sets immutable variables.
     * @param _nexus Address of the Nexus hub contract
     * @param _token Address of the underlying ERC20 token
     * @param _tokenId Unique token identifier
     */
    constructor(address _nexus, address _token, uint32 _tokenId) {
        if (_tokenId == 0) revert InvalidTokenId(_tokenId);

        NEXUS = INexus(_nexus);
        ENDPOINT = IOAppCore(_nexus).endpoint();
        INNER_TOKEN = _token;
        TOKEN_ID = _tokenId;
    }

    /**
     * @inheritdoc INexusOFT
     */
    function nexus() public view virtual returns (address nexusAddress) {
        return address(NEXUS);
    }

    /**
     * @inheritdoc INexusOFT
     */
    function tokenId() public view virtual returns (uint32 id) {
        return TOKEN_ID;
    }

    // ============ IOFT Implementation ============

    /**
     * @inheritdoc IOFT
     */
    function oftVersion() public pure virtual returns (bytes4 interfaceId, uint64 version) {
        return (type(INexusOFT).interfaceId, 1);
    }

    /**
     * @inheritdoc IOFT
     */
    function token() public view virtual returns (address tokenAddress) {
        return INNER_TOKEN;
    }

    /**
     * @dev Always returns false as `NexusOFT` uses burn/mint and does not require approval.
     * @inheritdoc IOFT
     */
    function approvalRequired() public pure virtual returns (bool requiresApproval) {
        return false;
    }

    /**
     * @inheritdoc IOFT
     */
    function sharedDecimals() public view virtual returns (uint8 sd) {
        return IOFTRegistry(nexus()).sharedDecimals();
    }

    /**
     * @inheritdoc IOFT
     */
    function quoteOFT(
        SendParam calldata _sendParam
    )
        public
        view
        virtual
        returns (OFTLimit memory oftLimit, OFTFeeDetail[] memory oftFeeDetails, OFTReceipt memory oftReceipt)
    {
        return NEXUS.nexusQuoteOFT(_sendParam);
    }

    /**
     * @inheritdoc IOFT
     */
    function quoteSend(
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) external view returns (MessagingFee memory msgFee) {
        return NEXUS.nexusQuoteSend(msg.sender, _sendParam, _payInLzToken);
    }

    /**
     * @dev Handles pushing LZ token fee to the endpoint. This alters conventional OFT flow, where the fee is paid after
     *      the OFT token transfer, and can result in LZ token fee griefing if the OFT uses tokens that have hooks or
     *      allow arbitrary calls.
     * @inheritdoc IOFT
     */
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) public payable virtual returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt) {
        /// @dev Push LZ token fee to the endpoint. Equivalent to `OAppSender._payLzToken()`.
        if (_fee.lzTokenFee > 0) {
            address lzToken = ENDPOINT.lzToken();
            if (lzToken == address(0)) revert LzTokenUnavailable();
            IERC20(lzToken).safeTransferFrom(msg.sender, address(ENDPOINT), _fee.lzTokenFee);
        }

        (msgReceipt, oftReceipt) = NEXUS.nexusSend{ value: msg.value }(msg.sender, _sendParam, _fee, _refundAddress);

        emit OFTSent(
            msgReceipt.guid,
            _sendParam.dstEid,
            msg.sender,
            oftReceipt.amountSentLD,
            oftReceipt.amountReceivedLD
        );
    }

    // ============ INexusOFT Implementation ============

    /**
     * @inheritdoc INexusOFT
     */
    function nexusReceive(
        address _endpoint,
        bytes32 _guid,
        uint32 _srcEid,
        address _to,
        uint256 _amountLD,
        bytes calldata _composeMsg
    ) public virtual onlyNexus {
        emit OFTReceived(_guid, _srcEid, _to, _amountLD);

        /// @dev If there's a compose message, send it to the endpoint for execution.
        if (_composeMsg.length > 0) {
            ILayerZeroEndpointV2(_endpoint).sendCompose(_to, _guid, 0, _composeMsg);
        }
    }
}
