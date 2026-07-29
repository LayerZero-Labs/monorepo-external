// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MessagingReceipt } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { IMessagingChannel } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessagingChannel.sol";
import { IMessagingComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessagingComposer.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppCore.sol";
import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppMsgInspector.sol";
import { Origin } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppReceiver.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm-contracts/contracts/oapp/libs/OptionsBuilder.sol";
import {
    SendParam,
    OFTLimit,
    OFTFeeDetail,
    OFTReceipt,
    MessagingFee
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm-contracts/contracts/libs/OFTComposeMsgCodec.sol";
import { EndpointV2Mock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import { MockComposer } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockComposer.sol";
import { WhitelistMsgInspector } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/WhitelistMsgInspector.sol";
import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { CreditRedirectAllowlistMock } from "@layerzerolabs/utils-upgradeable-evm-contracts/test/CreditRedirectBaseUpgradeable.t.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { INexus } from "./../contracts/interfaces/INexus.sol";
import { INexusPauseModule } from "./../contracts/interfaces/INexusPauseModule.sol";
import { NexusMsgCodec } from "./../contracts/libs/NexusMsgCodec.sol";
import { Nexus } from "./../contracts/Nexus.sol";
import { NexusTestHelper } from "./shared/NexusTestHelper.sol";

contract NexusTest is NexusTestHelper {
    using OptionsBuilder for bytes;

    uint16 constant BPS_DENOMINATOR = 10_000;
    uint16 constant FEE_BPS = 1_000; // 10%
    bytes32 internal constant MSG_CHANNEL_SENDER = bytes32(uint256(uint160(address(0xBEEF))));
    bytes32 internal constant MSG_CHANNEL_GUID = keccak256("guid");
    bytes32 internal constant MSG_CHANNEL_PAYLOAD_HASH = keccak256("payload");
    bytes internal constant MSG_CHANNEL_MESSAGE = hex"01";

    /// @dev Helper to execute send with proper fee payment. Override in Alt tests for ERC20 fee payment.
    function _executeSend(
        address _sender,
        SendParam memory _sendParam,
        MessagingFee memory _fee,
        address _refundAddress
    ) internal virtual returns (MessagingReceipt memory receipt) {
        vm.deal(_sender, _fee.nativeFee);
        vm.prank(_sender);
        (receipt, ) = aNexusOFT.send{ value: _fee.nativeFee }(_sendParam, _fee, payable(_refundAddress));
    }

    function test_initialize() public view {
        assertTrue(aNexus.hasRole(aNexus.DEFAULT_ADMIN_ROLE(), owner));
        assertTrue(bNexus.hasRole(bNexus.DEFAULT_ADMIN_ROLE(), owner));

        assertEq(address(aNexus.endpoint()), address(endpoints[aEid]));
        assertEq(address(bNexus.endpoint()), address(endpoints[bEid]));
    }

    function test_initialize_Revert_DoubleInitialize() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        aNexus.initialize(owner, owner);
    }

    function test_initialize_Revert_InvalidInitialAdmin() public {
        vm.expectRevert(IOAppCore.InvalidDelegate.selector);
        _deployTransparentProxy(
            address(aNexusImpl),
            proxyAdmin,
            abi.encodeWithSelector(Nexus.initialize.selector, address(0), owner)
        );
    }

    function test_initialize_Revert_ImplDisabled() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        aNexusImpl.initialize(owner, owner);
    }

    function test_getNexusId() public view {
        uint32 tokenId = 1;
        uint32 eid = 30100;

        // `nexusId` = (`tokenId` << 32) | `eid`.
        // `nexusId` = (1 << 32) | 30100 = 4294967296 + 30100 = 4294997396.
        uint256 expectedNexusId = tokenIdOffset * tokenId + eid;
        uint256 actualNexusId = aNexus.getNexusId(tokenId, eid);

        assertEq(actualNexusId, expectedNexusId);
        assertEq(actualNexusId, 4294997396);
    }

    function test_getNexusId_DifferentTokenIds() public view {
        uint256 nexusId1 = aNexus.getNexusId(1, aEid);
        uint256 nexusId2 = aNexus.getNexusId(2, aEid);

        assertTrue(nexusId1 != nexusId2);

        assertEq(nexusId1, tokenIdOffset * 1 + aEid);
        assertEq(nexusId2, tokenIdOffset * 2 + aEid);
    }

    function test_getNexusId_DifferentEids() public view {
        uint32 tokenId = 1;

        uint256 nexusIdA = aNexus.getNexusId(tokenId, aEid);
        uint256 nexusIdB = aNexus.getNexusId(tokenId, bEid);

        assertTrue(nexusIdA != nexusIdB);

        assertEq(nexusIdA, tokenIdOffset * tokenId + aEid);
        assertEq(nexusIdB, tokenIdOffset * tokenId + bEid);
    }

    function test_getNexusId_MaxValues() public view {
        uint32 maxTokenId = type(uint32).max;
        uint32 maxEid = type(uint32).max;

        uint256 nexusId = aNexus.getNexusId(maxTokenId, maxEid);
        uint256 expectedNexusId = tokenIdOffset * maxTokenId + maxEid;

        assertEq(nexusId, expectedNexusId);
        assertEq(nexusId, type(uint64).max);
    }

    function test_getNexusId_ZeroValues() public view {
        uint256 nexusId = aNexus.getNexusId(0, 0);

        assertEq(nexusId, 0);
    }

    function test_getNexusId_ConsistentAcrossInstances() public view {
        uint32 tokenId = 42;
        uint32 eid = 100;

        uint256 nexusIdA = aNexus.getNexusId(tokenId, eid);
        uint256 nexusIdB = bNexus.getNexusId(tokenId, eid);

        assertEq(nexusIdA, nexusIdB);
    }

    function test_getNexusId_Fuzz(uint32 _tokenId, uint32 eid) public view {
        uint256 nexusId = aNexus.getNexusId(_tokenId, eid);
        uint256 expectedNexusId = tokenIdOffset * _tokenId + eid;

        assertEq(nexusId, expectedNexusId);
        assertTrue(nexusId <= type(uint64).max);
    }

    // ============ nexusQuoteOFT Tests ============

    function test_nexusQuoteOFT() public {
        _setGlobalFeeBps(aFeeConfigModule, FEE_BPS); // 10% fee

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);

        (OFTLimit memory limit, OFTFeeDetail[] memory details, OFTReceipt memory receipt) = aNexusOFT.quoteOFT(
            sendParam
        );

        assertEq(limit.minAmountLD, 0);
        assertEq(limit.maxAmountLD, (uint256(1_000_000 ether) * BPS_DENOMINATOR) / (BPS_DENOMINATOR - FEE_BPS));

        assertEq(receipt.amountSentLD, 1 ether);
        assertEq(receipt.amountReceivedLD, 0.9 ether);

        assertEq(details.length, 1);
        assertEq(details[0].feeAmountLD, int256(0.1 ether));
    }

    function test_nexusQuoteOFT_NoFee() public view {
        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);

        (OFTLimit memory limit, OFTFeeDetail[] memory details, OFTReceipt memory receipt) = aNexusOFT.quoteOFT(
            sendParam
        );

        assertEq(limit.minAmountLD, 0);
        assertEq(limit.maxAmountLD, 1_000_000 ether);

        assertEq(receipt.amountSentLD, 1 ether);
        assertEq(receipt.amountReceivedLD, 1 ether);

        assertEq(details.length, 0);
    }

    function test_nexusQuoteOFT_Paused() public {
        uint256 nexusId = aNexus.getNexusId(TOKEN_ID, bEid);
        INexusPauseModule.SetPausedParam[] memory pauseParams = new INexusPauseModule.SetPausedParam[](1);
        pauseParams[0] = INexusPauseModule.SetPausedParam({ id: nexusId, priority: 1, paused: true });
        aPauseModule.setPaused(pauseParams);

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        assertEq(limit.minAmountLD, 0);
        assertEq(limit.maxAmountLD, 0); // `maxAmountLD` is 0 when paused
    }

    function test_nexusQuoteOFT_RateLimiterUsage() public virtual {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether, 100);

        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, _getDefaultLzOptions());

        // Initially, `maxAmountLD` should match outbound limit.
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 100 ether);

        // Use up 60 ether of the rate limit.
        aToken.mint(alice, 60 ether);
        SendParam memory send60Param = _buildSendParamWithOptions(
            bEid,
            bob,
            60 ether,
            60 ether,
            _getDefaultLzOptions()
        );
        MessagingFee memory fee = aNexusOFT.quoteSend(send60Param, false);

        _executeSend(alice, send60Param, fee, alice);

        // After usage, `maxAmountLD` should be reduced.
        (limit, , ) = aNexusOFT.quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 40 ether); // 100 - 60 = 40 ether

        // Use up another 40 ether to max out the limit.
        aToken.mint(alice, 40 ether);
        SendParam memory send40Param = _buildSendParamWithOptions(
            bEid,
            bob,
            40 ether,
            40 ether,
            _getDefaultLzOptions()
        );
        fee = aNexusOFT.quoteSend(send40Param, false);

        _executeSend(alice, send40Param, fee, alice);

        // After maxing out, `maxAmountLD` should be 0.
        (limit, , ) = aNexusOFT.quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 0);
    }

    function test_nexusQuoteOFT_OutboundRateLimitDisabled() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: uint256(bEid),
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: false,
                inboundEnabled: true,
                netAccountingEnabled: false,
                addressExemptionEnabled: false,
                outboundLimit: 100 ether,
                inboundLimit: 100 ether,
                outboundWindow: 100,
                inboundWindow: 100
            })
        });
        aRateLimiterModule.setRateLimitConfigs(configs);

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        // When outbound rate limit is disabled, `maxAmountLD` should be unlimited.
        assertEq(limit.maxAmountLD, type(uint256).max);
    }

    function test_nexusQuoteOFT_GloballyDisabled() public {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether, 100);
        aRateLimiterModule.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        // When rate limiter is globally disabled, `maxAmountLD` should be unlimited.
        assertEq(limit.maxAmountLD, type(uint256).max);
    }

    function test_nexusQuoteOFT_RateLimiterWithFee() public virtual {
        uint96 outboundLimit = 100 ether;

        _setupRateLimits(aRateLimiterModule, bEid, outboundLimit, 100);
        _setGlobalFeeBps(aFeeConfigModule, FEE_BPS);

        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, _getDefaultLzOptions());

        /// @dev maxAmountLD = rateLimitAvailable * BPS_DENOMINATOR / (BPS_DENOMINATOR - feeBps).
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, (uint256(outboundLimit) * BPS_DENOMINATOR) / (BPS_DENOMINATOR - FEE_BPS));

        /// @dev Send 50 ether with 10% fee: fee = 5 ether, received = 45 ether.
        aToken.mint(alice, 50 ether);
        SendParam memory send50Param = _buildSendParamWithOptions(bEid, bob, 50 ether, 0, _getDefaultLzOptions());
        MessagingFee memory fee = aNexusOFT.quoteSend(send50Param, false);
        _executeSend(alice, send50Param, fee, alice);

        /// @dev Remaining outbound capacity = 100 - 45 = 55 ether.
        uint256 remainingAvailable = 55 ether;
        (limit, , ) = aNexusOFT.quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, (remainingAvailable * BPS_DENOMINATOR) / (BPS_DENOMINATOR - FEE_BPS));

        /// @dev Sending the reported `maxAmountLD` should succeed (rate limit not exceeded).
        uint256 maxSendable = limit.maxAmountLD;
        aToken.mint(alice, maxSendable);
        SendParam memory sendMaxParam = _buildSendParamWithOptions(bEid, bob, maxSendable, 0, _getDefaultLzOptions());
        fee = aNexusOFT.quoteSend(sendMaxParam, false);
        _executeSend(alice, sendMaxParam, fee, alice);
    }

    function test_nexusQuoteOFT_RateLimiterWithFee_Fuzz(uint96 _limit, uint16 _feeBps) public {
        _limit = uint96(bound(_limit, 1 ether, 1_000_000 ether));
        _feeBps = uint16(bound(_feeBps, 1, 5000)); // 0.01% to 50%

        _setupRateLimits(aRateLimiterModule, bEid, _limit, 100);
        _setGlobalFeeBps(aFeeConfigModule, _feeBps);

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        /// @dev Verify `maxAmountLD` formula: `rateLimitAvailable * BPS_DENOMINATOR / (BPS_DENOMINATOR - feeBps)`.
        uint256 expectedMax = (uint256(_limit) * BPS_DENOMINATOR) / (BPS_DENOMINATOR - uint256(_feeBps));
        assertEq(limit.maxAmountLD, expectedMax);
    }

    function test_nexusQuoteOFT_RateLimiterWithMaxFee() public {
        uint96 outboundLimit = 100 ether;

        _setupRateLimits(aRateLimiterModule, bEid, outboundLimit, 100);
        _setGlobalFeeBps(aFeeConfigModule, BPS_DENOMINATOR);

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 0);
    }

    function test_nexusQuoteOFT_NoFeeConfigModule() public {
        aNexus.setFeeConfigModule(address(0));

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (, OFTFeeDetail[] memory details, OFTReceipt memory receipt) = aNexusOFT.quoteOFT(sendParam);

        assertEq(receipt.amountSentLD, 1 ether);
        assertEq(receipt.amountReceivedLD, 1 ether);
        assertEq(details.length, 0);
    }

    function test_nexusQuoteOFT_NoPauseModule() public {
        aNexus.setPauseModule(address(0));

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        /// @dev Not paused: `maxAmountLD` should reflect rate limit.
        assertEq(limit.maxAmountLD, 1_000_000 ether);
    }

    function test_nexusQuoteOFT_NoRateLimiterModule() public {
        aNexus.setRateLimiterModule(address(0));

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        assertEq(limit.maxAmountLD, type(uint256).max);
    }

    function test_nexusQuoteOFT_NoModules() public {
        aNexus.setFeeConfigModule(address(0));
        aNexus.setPauseModule(address(0));
        aNexus.setRateLimiterModule(address(0));

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (OFTLimit memory limit, OFTFeeDetail[] memory details, OFTReceipt memory receipt) = aNexusOFT.quoteOFT(
            sendParam
        );

        assertEq(limit.maxAmountLD, type(uint256).max);
        assertEq(receipt.amountSentLD, 1 ether);
        assertEq(receipt.amountReceivedLD, 1 ether);
        assertEq(details.length, 0);
    }

    function test_nexusQuoteOFT_ScaledRateLimit() public virtual {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether, 100);
        _setupScales(aRateLimiterModule, TOKEN_ID, 2e18);

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        assertEq(limit.maxAmountLD, 50 ether);
    }

    function test_nexusQuoteOFT_ZeroScale() public virtual {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether, 100);
        _setupScales(aRateLimiterModule, TOKEN_ID, 0);

        SendParam memory sendParam = _buildSendParam(bEid, bob, 1 ether, 0);
        (OFTLimit memory limit, , ) = aNexusOFT.quoteOFT(sendParam);

        assertEq(limit.maxAmountLD, type(uint256).max);
    }

    // ============ nexusQuoteSend Tests ============

    function test_nexusQuoteSend() public {
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 1 ether, _getDefaultLzOptions());

        vm.prank(alice);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        assertTrue(fee.nativeFee > 0);
        assertEq(fee.lzTokenFee, 0);
    }

    function test_nexusQuoteSend_WithFee() public {
        _setGlobalFeeBps(aFeeConfigModule, 1000); // 10% fee

        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, _getDefaultLzOptions());

        vm.prank(alice);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        assertTrue(fee.nativeFee > 0);
        assertEq(fee.lzTokenFee, 0);
    }

    function test_nexusQuoteSend_WithComposeMsg() public {
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(100_000, 0)
            .addExecutorLzComposeOption(0, 50_000, 0);

        SendParam memory sendParam = SendParam({
            dstEid: bEid,
            to: bytes32(uint256(uint160(bob))),
            amountLD: 1 ether,
            minAmountLD: 1 ether,
            extraOptions: options,
            composeMsg: hex"01",
            oftCmd: bytes("")
        });

        vm.prank(alice);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        assertTrue(fee.nativeFee > 0);
        assertEq(fee.lzTokenFee, 0);
    }

    function test_nexusQuoteSend_Revert_MsgInspection() public {
        WhitelistMsgInspector inspector = new WhitelistMsgInspector();
        aNexus.setMsgInspector(address(inspector));

        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 1 ether, _getDefaultLzOptions());

        /// @dev `alice` is not whitelisted, so the inspection should fail.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IOAppMsgInspector.InspectionFailed.selector,
                alice,
                abi.encodePacked(TOKEN_ID, sendParam.to, uint64(sendParam.amountLD / 1e12)),
                _getDefaultLzOptions()
            )
        );
        aNexusOFT.quoteSend(sendParam, false);
    }

    // ============ Fee Recipient Tests ============

    function test_debit_PushesFees() public virtual {
        _setGlobalFeeBps(aFeeConfigModule, 1000); // 10% fee
        aNexus.setFeeDeposit(charlie);

        _setupRateLimits(aRateLimiterModule, bEid, 1_000_000 ether, 30 days);
        aToken.mint(alice, 1 ether);

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, options);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        _executeSend(alice, sendParam, fee, alice);

        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(aToken.balanceOf(charlie), 0.1 ether);
        assertEq(aToken.balanceOf(address(aNexus)), 0);
    }

    function test_setFeeDeposit() public {
        aNexus.setFeeDeposit(charlie);
        assertEq(aNexus.feeDeposit(), charlie);
    }

    function test_setFeeDeposit_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.setFeeDeposit(charlie);
    }

    // ============ isComposeMsgSender Tests ============

    function test_isComposeMsgSender() public view {
        Origin memory origin = Origin({ srcEid: bEid, sender: bytes32(uint256(uint160(address(bNexus)))), nonce: 1 });
        (bytes memory message, ) = NexusMsgCodec.encode(
            TOKEN_ID,
            bytes32(uint256(uint160(bob))),
            1 ether,
            alice,
            bytes("")
        );

        bool isValidSender = aNexus.isComposeMsgSender(origin, message, address(aNexusOFT));

        assertTrue(isValidSender);
    }

    function test_isComposeMsgSender_WithComposeMsg() public view {
        Origin memory origin = Origin({ srcEid: bEid, sender: bytes32(uint256(uint160(address(bNexus)))), nonce: 1 });
        (bytes memory message, ) = NexusMsgCodec.encode(
            TOKEN_ID,
            bytes32(uint256(uint160(bob))),
            1 ether,
            alice,
            hex"deadbeef"
        );

        bool isValidSender = aNexus.isComposeMsgSender(origin, message, address(aNexusOFT));

        assertTrue(isValidSender);
    }

    function test_isComposeMsgSender_InvalidSender() public view {
        Origin memory origin = Origin({ srcEid: bEid, sender: bytes32(uint256(uint160(address(bNexus)))), nonce: 1 });
        (bytes memory message, ) = NexusMsgCodec.encode(
            TOKEN_ID,
            bytes32(uint256(uint160(bob))),
            1 ether,
            alice,
            bytes("")
        );

        bool isValidSender = aNexus.isComposeMsgSender(origin, message, alice);

        assertFalse(isValidSender);
    }

    function test_isComposeMsgSender_ZeroAddressSender() public view {
        Origin memory origin = Origin({ srcEid: bEid, sender: bytes32(uint256(uint160(address(bNexus)))), nonce: 1 });
        (bytes memory message, ) = NexusMsgCodec.encode(
            TOKEN_ID,
            bytes32(uint256(uint160(bob))),
            1 ether,
            alice,
            bytes("")
        );

        bool isValidSender = aNexus.isComposeMsgSender(origin, message, address(0));

        assertFalse(isValidSender);
    }

    // ============ Module Getter Tests ============

    function test_feeConfigModule() public view {
        assertEq(address(aNexus.feeConfigModule()), address(aFeeConfigModule));
        assertEq(address(bNexus.feeConfigModule()), address(bFeeConfigModule));
    }

    function test_pauseModule() public view {
        assertEq(address(aNexus.pauseModule()), address(aPauseModule));
        assertEq(address(bNexus.pauseModule()), address(bPauseModule));
    }

    function test_rateLimiterModule() public view {
        assertEq(address(aNexus.rateLimiterModule()), address(aRateLimiterModule));
        assertEq(address(bNexus.rateLimiterModule()), address(bRateLimiterModule));
    }

    // ============ Module Setter Tests ============

    function test_setFeeConfigModule() public {
        address newModule = address(0xBEEF);

        vm.expectEmit(address(aNexus));
        emit INexus.FeeConfigModuleSet(newModule);
        aNexus.setFeeConfigModule(newModule);

        assertEq(address(aNexus.feeConfigModule()), newModule);
    }

    function test_setFeeConfigModule_Deactivate() public {
        vm.expectEmit(address(aNexus));
        emit INexus.FeeConfigModuleSet(address(0));
        aNexus.setFeeConfigModule(address(0));

        assertEq(address(aNexus.feeConfigModule()), address(0));
    }

    function test_setFeeConfigModule_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.setFeeConfigModule(address(0xBEEF));
    }

    function test_setPauseModule() public {
        address newModule = address(0xBEEF);

        vm.expectEmit(address(aNexus));
        emit INexus.PauseModuleSet(newModule);
        aNexus.setPauseModule(newModule);

        assertEq(address(aNexus.pauseModule()), newModule);
    }

    function test_setPauseModule_Deactivate() public {
        vm.expectEmit(address(aNexus));
        emit INexus.PauseModuleSet(address(0));
        aNexus.setPauseModule(address(0));

        assertEq(address(aNexus.pauseModule()), address(0));
    }

    function test_setPauseModule_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.setPauseModule(address(0xBEEF));
    }

    function test_setRateLimiterModule() public {
        address newModule = address(0xBEEF);

        vm.expectEmit(address(aNexus));
        emit INexus.RateLimiterModuleSet(newModule);
        aNexus.setRateLimiterModule(newModule);

        assertEq(address(aNexus.rateLimiterModule()), newModule);
    }

    function test_setRateLimiterModule_Deactivate() public {
        vm.expectEmit(address(aNexus));
        emit INexus.RateLimiterModuleSet(address(0));
        aNexus.setRateLimiterModule(address(0));

        assertEq(address(aNexus.rateLimiterModule()), address(0));
    }

    function test_setRateLimiterModule_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.setRateLimiterModule(address(0xBEEF));
    }

    // ============ Storage Hash Tests ============

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexus")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xc20e04226fab28e0e9310021f59f0226a6ef622ef143aefd892d971127154900);
    }

    // ============ Credit Redirect Tests ============

    function test_credit_Redirect_NotAllowlisted() public virtual {
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        bNexus.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: charlie })
        );

        aToken.mint(alice, 1 ether);

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, options);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        uint256 escrowBefore = bToken.balanceOf(charlie);
        uint256 recipientBefore = bToken.balanceOf(bob);

        _executeSend(alice, sendParam, fee, alice);
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(bToken.balanceOf(charlie) - escrowBefore, 1 ether);
        assertEq(bToken.balanceOf(bob), recipientBefore);
    }

    function test_credit_NoRedirect_Allowlisted() public virtual {
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        allowlist.setAllowlisted(bob, true);
        bNexus.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: charlie })
        );

        aToken.mint(alice, 1 ether);

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, options);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        uint256 balanceBefore = bToken.balanceOf(bob);
        _executeSend(alice, sendParam, fee, alice);
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(bToken.balanceOf(bob) - balanceBefore, 1 ether);
        assertEq(bToken.balanceOf(charlie), 0);
    }

    function test_credit_NoRedirect_ConfigUnset() public virtual {
        aToken.mint(alice, 1 ether);

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, options);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        uint256 balanceBefore = bToken.balanceOf(bob);
        _executeSend(alice, sendParam, fee, alice);
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(bToken.balanceOf(bob) - balanceBefore, 1 ether);
    }

    function test_credit_Redirect_WithCompose() public virtual {
        MockComposer composer = new MockComposer();
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        bNexus.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: charlie })
        );

        aToken.mint(alice, 1 ether);

        bytes memory composePayload = hex"01";
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0)
            .addExecutorLzComposeOption(0, 200_000, 0);

        SendParam memory sendParam = SendParam({
            dstEid: bEid,
            to: bytes32(uint256(uint160(address(composer)))),
            amountLD: 1 ether,
            minAmountLD: 1 ether,
            extraOptions: options,
            composeMsg: composePayload,
            oftCmd: bytes("")
        });
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        uint256 escrowBefore = bToken.balanceOf(charlie);
        uint256 composerBefore = bToken.balanceOf(address(composer));

        MessagingReceipt memory receipt = _executeSend(alice, sendParam, fee, address(this));

        bytes memory expectedComposeMsg = OFTComposeMsgCodec.encode(
            receipt.nonce,
            aEid,
            0,
            abi.encodePacked(OFTComposeMsgCodec.addressToBytes32(alice), composePayload)
        );

        vm.expectEmit(true, true, true, true, address(bNexus));
        emit ICreditRedirect.CreditRedirected(address(composer), charlie, 1 ether);
        vm.expectEmit(true, true, true, true, endpoints[bEid]);
        emit IMessagingComposer.ComposeSent(address(bNexusOFT), address(composer), receipt.guid, 0, expectedComposeMsg);

        this.verifyPackets(bEid, address(bNexus));

        assertEq(bToken.balanceOf(charlie) - escrowBefore, 1 ether);
        assertEq(bToken.balanceOf(address(composer)), composerBefore);

        IMessagingComposer(endpoints[bEid]).lzCompose(
            address(bNexusOFT),
            address(composer),
            receipt.guid,
            0,
            expectedComposeMsg,
            bytes("")
        );

        assertEq(composer.lastFrom(), address(bNexusOFT));
        assertEq(composer.lastGuid(), receipt.guid);
        assertEq(composer.lastMessage(), expectedComposeMsg);
    }

    function test_credit_Redirect_RateLimitUsesOriginalRecipient() public virtual {
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        bNexus.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: charlie })
        );

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: uint256(aEid),
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: false,
                inboundEnabled: true,
                netAccountingEnabled: false,
                addressExemptionEnabled: true,
                outboundLimit: 0,
                inboundLimit: 1 ether,
                outboundWindow: 0,
                inboundWindow: 100
            })
        });
        bRateLimiterModule.setRateLimitConfigs(configs);

        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: charlie, isExempt: true });
        bRateLimiterModule.setRateLimitAddressExemptions(exemptions);

        aToken.mint(alice, 2 ether);

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, options);
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        /// @dev Escrow (`charlie`) is exempt; inflow must still key on original `bob` or this would skip limits.
        _executeSend(alice, sendParam, fee, alice);
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(bToken.balanceOf(charlie), 1 ether);
        assertEq(bToken.balanceOf(bob), 0);
        (, , uint256 inboundUsage, uint256 inboundAvailable) = bRateLimiterModule.getRateLimitUsages(uint256(aEid));
        assertEq(inboundUsage, 1 ether);
        assertEq(inboundAvailable, 0);

        _executeSend(alice, sendParam, fee, alice);
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1 ether));
        this.verifyPackets(bEid, addressToBytes32(address(bNexus)));
    }

    // ============ Messaging Channel Tests ============

    function _origin(uint64 _nonce) internal view returns (Origin memory origin) {
        return Origin({ srcEid: bEid, sender: MSG_CHANNEL_SENDER, nonce: _nonce });
    }

    function _verify(uint64 _nonce, bytes32 _payloadHash) internal {
        aNexus.setPeer(bEid, MSG_CHANNEL_SENDER);
        vm.prank(endpointSetup.receiveLibs[0]);
        EndpointV2Mock(endpoints[aEid]).verify(_origin(_nonce), address(aNexus), _payloadHash);
    }

    function _grantMessagingChannelRoles() internal {
        aNexus.grantRole(aNexus.MESSAGING_CHANNEL_MANAGER_ROLE(), owner);
        aNexus.grantRole(aNexus.MESSAGING_CHANNEL_MANAGER_ROLE(), charlie);
        aNexus.grantRole(aNexus.MESSAGE_NILIFIER_ROLE(), owner);
        aNexus.grantRole(aNexus.MESSAGE_NILIFIER_ROLE(), dave);
    }

    function test_clear() public {
        bytes32 payloadHash = keccak256(abi.encodePacked(MSG_CHANNEL_GUID, MSG_CHANNEL_MESSAGE));
        _verify(1, payloadHash);
        _grantMessagingChannelRoles();

        aNexus.clear(_origin(1), MSG_CHANNEL_GUID, MSG_CHANNEL_MESSAGE);

        assertEq(
            EndpointV2Mock(endpoints[aEid]).inboundPayloadHash(address(aNexus), bEid, MSG_CHANNEL_SENDER, 1),
            bytes32(0)
        );
        assertEq(EndpointV2Mock(endpoints[aEid]).lazyInboundNonce(address(aNexus), bEid, MSG_CHANNEL_SENDER), 1);
    }

    function test_clear_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.clear(_origin(1), MSG_CHANNEL_GUID, MSG_CHANNEL_MESSAGE);
    }

    function test_clear_Revert_NilifierUnauthorized() public {
        _grantMessagingChannelRoles();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                aNexus.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(dave);
        aNexus.clear(_origin(1), MSG_CHANNEL_GUID, MSG_CHANNEL_MESSAGE);
    }

    function test_skip() public {
        _grantMessagingChannelRoles();

        vm.expectEmit(true, true, true, true, endpoints[aEid]);
        emit IMessagingChannel.InboundNonceSkipped(bEid, MSG_CHANNEL_SENDER, address(aNexus), 1);

        aNexus.skip(bEid, MSG_CHANNEL_SENDER, 1);

        assertEq(EndpointV2Mock(endpoints[aEid]).lazyInboundNonce(address(aNexus), bEid, MSG_CHANNEL_SENDER), 1);
    }

    function test_skip_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.skip(bEid, MSG_CHANNEL_SENDER, 1);
    }

    function test_burn() public {
        _verify(1, MSG_CHANNEL_PAYLOAD_HASH);
        _grantMessagingChannelRoles();

        aNexus.skip(bEid, MSG_CHANNEL_SENDER, 2);

        vm.expectEmit(true, true, true, true, endpoints[aEid]);
        emit IMessagingChannel.PacketBurnt(bEid, MSG_CHANNEL_SENDER, address(aNexus), 1, MSG_CHANNEL_PAYLOAD_HASH);
        aNexus.burn(bEid, MSG_CHANNEL_SENDER, 1, MSG_CHANNEL_PAYLOAD_HASH);

        assertEq(
            EndpointV2Mock(endpoints[aEid]).inboundPayloadHash(address(aNexus), bEid, MSG_CHANNEL_SENDER, 1),
            bytes32(0)
        );
    }

    function test_burn_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.burn(bEid, MSG_CHANNEL_SENDER, 1, MSG_CHANNEL_PAYLOAD_HASH);
    }

    function test_nilify() public {
        _verify(1, MSG_CHANNEL_PAYLOAD_HASH);
        _grantMessagingChannelRoles();

        vm.expectEmit(true, true, true, true, endpoints[aEid]);
        emit IMessagingChannel.PacketNilified(bEid, MSG_CHANNEL_SENDER, address(aNexus), 1, MSG_CHANNEL_PAYLOAD_HASH);

        aNexus.nilify(bEid, MSG_CHANNEL_SENDER, 1, MSG_CHANNEL_PAYLOAD_HASH);

        assertEq(
            EndpointV2Mock(endpoints[aEid]).inboundPayloadHash(address(aNexus), bEid, MSG_CHANNEL_SENDER, 1),
            bytes32(type(uint256).max)
        );
    }

    function test_nilify_Unverified() public {
        _grantMessagingChannelRoles();

        vm.expectEmit(true, true, true, true, endpoints[aEid]);
        emit IMessagingChannel.PacketNilified(bEid, MSG_CHANNEL_SENDER, address(aNexus), 1, bytes32(0));

        aNexus.nilify(bEid, MSG_CHANNEL_SENDER, 1, bytes32(0));

        assertEq(
            EndpointV2Mock(endpoints[aEid]).inboundPayloadHash(address(aNexus), bEid, MSG_CHANNEL_SENDER, 1),
            bytes32(type(uint256).max)
        );
    }

    function test_nilify_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                aNexus.MESSAGE_NILIFIER_ROLE()
            )
        );
        vm.prank(alice);
        aNexus.nilify(bEid, MSG_CHANNEL_SENDER, 1, MSG_CHANNEL_PAYLOAD_HASH);
    }

    function test_nilify_Revert_ManagerUnauthorized() public {
        _grantMessagingChannelRoles();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                aNexus.MESSAGE_NILIFIER_ROLE()
            )
        );
        vm.prank(charlie);
        aNexus.nilify(bEid, MSG_CHANNEL_SENDER, 1, MSG_CHANNEL_PAYLOAD_HASH);
    }
}
