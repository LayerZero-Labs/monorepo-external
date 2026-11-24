// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppCore.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { IMultiHopComposer } from "./interfaces/IMultiHopComposer.sol";
import { IMultiHopComposerNative } from "./interfaces/IMultiHopComposerNative.sol";
import { MultiHopComposer } from "./MultiHopComposer.sol";

/**
 * @title MultiHopComposerNative
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice `MultiHopComposer` for a set of native OFTs.
 */
contract MultiHopComposerNative is IMultiHopComposerNative, MultiHopComposer {
    /**
     * @param _initialOwner Initial owner of the contract
     * @param _ofts Native OFTs to register
     * @param _nativeRefundRecipient Native refund recipient, must accept native token transfers
     * @param _maxEnforcedMsgValue Cap on the `minMsgValue` enforced on a compose
     */
    constructor(
        address _initialOwner,
        address[] memory _ofts,
        address _nativeRefundRecipient,
        uint256 _maxEnforcedMsgValue
    ) MultiHopComposer(_initialOwner, _ofts, _nativeRefundRecipient, _maxEnforcedMsgValue) {}

    /// @dev Accepts native only from registered OFTs, which credit inbound transfers through it.
    receive() external payable virtual {
        if (!isOFT[msg.sender]) revert OnlyOFT(msg.sender);
    }

    /**
     * @dev Pays the amount and the cached native value in a single native transfer.
     * @inheritdoc IMultiHopComposer
     */
    function rescue(bytes32 _guid, address _to) public virtual override(IMultiHopComposer, MultiHopComposer) onlyOwner {
        if (_to == address(0)) revert InvalidRescueRecipient();
        UndecodableMessage memory undecodable = undecodableMessages[_guid];
        if (undecodable.amount == 0 && undecodable.msgValue == 0) revert NothingToRescue(_guid);

        delete undecodableMessages[_guid];

        (bool success, ) = _to.call{ value: undecodable.amount + undecodable.msgValue }("");
        if (!success) revert NativeTransferFailed();
        emit Rescued(_guid, _to, undecodable.amount, undecodable.msgValue);
    }

    /**
     * @notice Validates and registers native OFTs.
     * @param _ofts Non-empty array of OFTs
     */
    function _processOFTs(
        address[] memory _ofts
    ) internal virtual override returns (address endpoint, address token, address[] memory ofts) {
        address firstOFT = _ofts[0];
        if (firstOFT == address(0)) revert InvalidOFT(firstOFT);
        endpoint = address(IOAppCore(firstOFT).endpoint());

        for (uint256 i; i < _ofts.length; i++) {
            address oft = _ofts[i];

            if (oft == address(0) || isOFT[oft]) revert InvalidOFT(oft);
            if (address(IOAppCore(oft).endpoint()) != endpoint) revert DifferentEndpoints();
            if (IOFT(oft).token() != address(0)) revert NativeRequired();

            isOFT[oft] = true;
        }

        return (endpoint, address(0), _ofts);
    }

    /// @dev Single function to send OFT messages. The amount is paid on top of the messaging fee.
    function _send(
        address _oft,
        SendParam memory _sendParam,
        uint256 _prePaidValue,
        address _refundTo
    ) internal virtual override {
        uint256 nativeFee = msg.value + _prePaidValue;
        IOFT(_oft).send{ value: nativeFee + _sendParam.amountLD }(
            _sendParam,
            MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 }),
            _refundTo
        );
    }
}
