// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    MessagingReceipt,
    MessagingFee
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { IMessagingComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessagingComposer.sol";
import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspector.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm-impl/contracts/oapp/libs/OptionsBuilder.sol";
import { SendParam } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm-impl/contracts/libs/OFTComposeMsgCodec.sol";
import { EndpointV2Mock as EndpointV2 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import {
    MockBurnerMinterRedeemIssue,
    MockBurnerMinterCrosschain
} from "@layerzerolabs/test-utils-evm/contracts/mocks/MockBurnerMinterVariants.sol";
import { MockComposer } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockComposer.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";
import { RejectingMsgInspector } from "@layerzerolabs/test-utils-evm/contracts/mocks/RejectingMsgInspector.sol";
import { WhitelistMsgInspector } from "@layerzerolabs/test-utils-evm/contracts/mocks/WhitelistMsgInspector.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { INexusOFT } from "./../contracts/interfaces/INexusOFT.sol";
import { INexusPause } from "./../contracts/interfaces/INexusPause.sol";
import { INexusPauseModule } from "./../contracts/interfaces/INexusPauseModule.sol";
import { NexusMsgCodec } from "./../contracts/libs/NexusMsgCodec.sol";
import { Nexus } from "./../contracts/Nexus.sol";
import { NexusOFT } from "./../contracts/NexusOFT.sol";
import { NexusTestHelper } from "./shared/NexusTestHelper.sol";

contract NexusOFTTest is NexusTestHelper {
    using OptionsBuilder for bytes;

    function setUp() public virtual override {
        super.setUp();

        // Additional setup specific to `NexusOFT` tests.
        _setupRateLimits(aRateLimiterModule, bEid, 1_000_000 ether, 30 days);
        _setupRateLimits(bRateLimiterModule, aEid, 1_000_000 ether, 30 days);

        aToken.mint(alice, initialBalance);
    }

    function test_constructor() public view {
        assertTrue(aNexus.hasRole(aNexus.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(bNexus.hasRole(bNexus.DEFAULT_ADMIN_ROLE(), address(this)));

        assertEq(aNexusOFT.nexus(), address(aNexus));
        assertEq(bNexusOFT.nexus(), address(bNexus));

        assertEq(aNexusOFT.token(), address(aToken));
        assertEq(bNexusOFT.token(), address(bToken));

        assertEq(aNexusOFT.tokenId(), TOKEN_ID);
        assertEq(bNexusOFT.tokenId(), TOKEN_ID);

        assertEq(address(aNexus.endpoint()), address(endpoints[aEid]));
        assertEq(address(bNexus.endpoint()), address(endpoints[bEid]));

        assertEq(aToken.balanceOf(alice), initialBalance);
        assertEq(bToken.balanceOf(alice), 0);
        assertEq(bToken.balanceOf(bob), 0);
        assertEq(aToken.balanceOf(bob), 0);
    }

    function test_constructor_Revert_InvalidTokenId() public {
        vm.expectRevert(abi.encodeWithSelector(INexusOFT.InvalidTokenId.selector, 0));
        new NexusOFT(address(aNexus), address(aToken), 0);
    }

    /// @dev Helper to prepare and execute send with fees. Override in Alt tests for ERC20 fee payment.
    function _executeSend(
        address _sender,
        SendParam memory _sendParam,
        MessagingFee memory _fee,
        address _refundAddress
    ) internal virtual returns (MessagingReceipt memory receipt) {
        vm.prank(_sender);
        (receipt, ) = aNexusOFT.send{ value: _fee.nativeFee }(_sendParam, _fee, payable(_refundAddress));
    }

    function test_send() public virtual {
        uint256 tokensToSend = 1 ether;
        SendParam memory sendParam = _buildSendParamWithOptions(
            bEid,
            bob,
            tokensToSend,
            tokensToSend,
            _getDefaultLzOptions()
        );
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        assertEq(aToken.balanceOf(alice), initialBalance);
        assertEq(bToken.balanceOf(bob), 0);

        _executeSend(alice, sendParam, fee, address(this));

        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(aToken.balanceOf(alice), initialBalance - tokensToSend);
        assertEq(bToken.balanceOf(bob), tokensToSend);
    }

    function test_send_payInLzToken() public virtual {
        MockERC20 lzToken = new MockERC20(18);
        EndpointV2(endpoints[aEid]).setLzToken(address(lzToken));

        uint256 tokensToSend = 1 ether;
        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200000, 0);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, tokensToSend, tokensToSend, options);

        MessagingFee memory nativeFeeQuote = aNexusOFT.quoteSend(sendParam, false);

        // Include LZ token in the fee. Still keep the native fee to make the test simple. The LZ token fee will be
        // refunded.
        uint256 lzTokenFeeAmount = 0.01 ether;
        MessagingFee memory fee = MessagingFee({ nativeFee: nativeFeeQuote.nativeFee, lzTokenFee: lzTokenFeeAmount });

        lzToken.mint(alice, lzTokenFeeAmount);

        vm.prank(alice);
        lzToken.approve(address(aNexusOFT), lzTokenFeeAmount);

        assertEq(aToken.balanceOf(alice), initialBalance);
        assertEq(bToken.balanceOf(bob), 0);
        assertEq(lzToken.balanceOf(alice), lzTokenFeeAmount);
        assertEq(lzToken.balanceOf(charlie), 0);

        _executeSend(alice, sendParam, fee, charlie);

        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(aToken.balanceOf(alice), initialBalance - tokensToSend);
        assertEq(bToken.balanceOf(bob), tokensToSend);

        // The whole LZ token fee is refunded to the refund address.
        assertEq(lzToken.balanceOf(alice), 0);
        assertEq(lzToken.balanceOf(charlie), lzTokenFeeAmount);
    }

    function test_send_compose() public virtual {
        uint256 tokensToSend = 1 ether;
        bytes memory composePayload = hex"01"; // Minimal compose payload
        MockComposer composer = new MockComposer();

        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0)
            .addExecutorLzComposeOption(0, 200_000, 0);

        SendParam memory sendParam = SendParam({
            dstEid: bEid,
            to: bytes32(uint256(uint160(address(composer)))),
            amountLD: tokensToSend,
            minAmountLD: tokensToSend,
            extraOptions: options,
            composeMsg: composePayload,
            oftCmd: bytes("")
        });

        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        assertEq(aToken.balanceOf(alice), initialBalance);
        assertEq(bToken.balanceOf(address(composer)), 0);

        /// @dev Execute send and capture the receipt.
        MessagingReceipt memory receipt = _executeSend(alice, sendParam, fee, address(this));

        /// @dev Build the expected compose message, where `alice` is the original sender.
        bytes memory expectedComposeMsg = OFTComposeMsgCodec.encode(
            receipt.nonce,
            aEid,
            tokensToSend,
            abi.encodePacked(OFTComposeMsgCodec.addressToBytes32(alice), composePayload)
        );

        vm.expectEmit(true, true, true, true, endpoints[bEid]);
        emit IMessagingComposer.ComposeSent(address(bNexusOFT), address(composer), receipt.guid, 0, expectedComposeMsg);

        /// @dev Execute `lzReceive` and `lzCompose`.
        this.verifyPackets(bEid, address(bNexus));
        IMessagingComposer(endpoints[bEid]).lzCompose(
            address(bNexusOFT),
            address(composer),
            receipt.guid,
            0,
            expectedComposeMsg,
            bytes("")
        );

        assertEq(aToken.balanceOf(alice), initialBalance - tokensToSend);
        assertEq(bToken.balanceOf(address(composer)), tokensToSend);

        assertEq(composer.lastFrom(), address(bNexusOFT));
        assertEq(composer.lastGuid(), receipt.guid);
        assertEq(composer.lastMessage(), expectedComposeMsg);
    }

    function test_send_Revert_MsgInspection() public virtual {
        uint256 tokensToSend = 1 ether;
        SendParam memory sendParam = _buildSendParamWithOptions(
            bEid,
            bob,
            tokensToSend,
            tokensToSend,
            _getDefaultLzOptions()
        );

        // Get quote before setting inspector.
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        // Set up a rejecting message inspector.
        RejectingMsgInspector inspector = new RejectingMsgInspector();
        aNexus.setMsgInspector(address(inspector));

        (bytes memory message, ) = NexusMsgCodec.encode(
            TOKEN_ID,
            sendParam.to,
            uint64(sendParam.amountLD / 10 ** 12),
            alice,
            sendParam.composeMsg
        );

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IOAppMsgInspector.InspectionFailed.selector, alice, message, _getDefaultLzOptions())
        );
        aNexusOFT.send{ value: fee.nativeFee }(sendParam, fee, payable(address(this)));
    }

    function test_send_Revert_MsgInspectionWhitelist() public virtual {
        WhitelistMsgInspector inspector = new WhitelistMsgInspector();
        aNexus.setMsgInspector(address(inspector));

        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 1 ether, _getDefaultLzOptions());
        MessagingFee memory fee = MessagingFee({ nativeFee: 1 ether, lzTokenFee: 0 });

        /// @dev `alice` is not whitelisted, so the inspection should fail.
        vm.deal(alice, fee.nativeFee);
        vm.expectRevert(
            abi.encodeWithSelector(
                IOAppMsgInspector.InspectionFailed.selector,
                alice,
                abi.encodePacked(TOKEN_ID, sendParam.to, uint64(sendParam.amountLD / 1e12)),
                _getDefaultLzOptions()
            )
        );
        _executeSend(alice, sendParam, fee, alice);
    }

    // ============ View Function Tests ============

    function test_oftVersion() public view {
        (bytes4 interfaceId, uint64 version) = aNexusOFT.oftVersion();

        assertEq(interfaceId, type(INexusOFT).interfaceId);
        assertEq(version, 1);
    }

    function test_approvalRequired() public view {
        assertFalse(aNexusOFT.approvalRequired());
    }

    function test_sharedDecimals() public view {
        assertEq(aNexusOFT.sharedDecimals(), aNexus.sharedDecimals());
        assertEq(aNexusOFT.sharedDecimals(), sharedDecimals);
    }

    // ============ Access Control Tests ============

    function test_nexusReceive_Revert_OnlyNexus() public {
        bytes32 guid = bytes32(uint256(1));
        uint32 srcEid = bEid;

        vm.expectRevert(INexusOFT.OnlyNexus.selector);
        aNexusOFT.nexusReceive(address(endpoints[aEid]), guid, srcEid, bob, 1 ether, bytes(""));
    }

    function test_nexusReceive_Revert_OnlyNexus_FromOther() public {
        bytes32 guid = bytes32(uint256(1));
        uint32 srcEid = bEid;

        vm.prank(alice);
        vm.expectRevert(INexusOFT.OnlyNexus.selector);
        aNexusOFT.nexusReceive(address(endpoints[aEid]), guid, srcEid, bob, 1 ether, bytes(""));
    }

    // ============ LZ Token Tests ============

    function test_send_Revert_LzTokenUnavailable() public virtual {
        uint256 tokensToSend = 1 ether;
        SendParam memory sendParam = _buildSendParamWithOptions(
            bEid,
            bob,
            tokensToSend,
            tokensToSend,
            _getDefaultLzOptions()
        );

        // Quote without LZ token (to get the base native fee).
        MessagingFee memory nativeFee = aNexusOFT.quoteSend(sendParam, false);

        // Include LZ token fee but no LZ token is configured on endpoint.
        MessagingFee memory feeWithLzToken = MessagingFee({ nativeFee: nativeFee.nativeFee, lzTokenFee: 0.01 ether });

        vm.deal(alice, nativeFee.nativeFee);

        vm.prank(alice);
        vm.expectRevert(INexusOFT.LzTokenUnavailable.selector);
        aNexusOFT.send{ value: nativeFee.nativeFee }(sendParam, feeWithLzToken, payable(alice));
    }

    // ============ Module Tests ============

    function test_send_Fees() public virtual {
        uint16 feeBps = 1000; // 10%
        _setGlobalFeeBps(aFeeConfigModule, feeBps);
        aNexus.setFeeDeposit(charlie);

        uint256 tokensToSend = 1 ether;
        uint256 expectedFee = (tokensToSend * feeBps) / 10_000; // 0.1 ether
        uint256 expectedReceived = tokensToSend - expectedFee; // 0.9 ether

        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, tokensToSend, 0, _getDefaultLzOptions());
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        assertEq(aToken.balanceOf(alice), initialBalance);
        assertEq(bToken.balanceOf(bob), 0);
        assertEq(aToken.balanceOf(charlie), 0);

        _executeSend(alice, sendParam, fee, address(this));
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(aToken.balanceOf(alice), initialBalance - tokensToSend);
        assertEq(bToken.balanceOf(bob), expectedReceived);
        assertEq(aToken.balanceOf(charlie), expectedFee);
        assertEq(aToken.balanceOf(address(aNexus)), 0);
    }

    function test_send_Revert_WhenPaused() public virtual {
        aToken.mint(alice, 1 ether);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 0, _getDefaultLzOptions());
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        uint256 nexusId = aNexus.getNexusId(TOKEN_ID, bEid);
        INexusPauseModule.SetPausedParam[] memory pauseParams = new INexusPauseModule.SetPausedParam[](1);
        pauseParams[0] = INexusPauseModule.SetPausedParam({ id: nexusId, priority: 1, paused: true });
        aPauseModule.setPaused(pauseParams);

        vm.expectRevert(abi.encodeWithSelector(INexusPause.Paused.selector, nexusId));
        _executeSend(alice, sendParam, fee, alice);
    }

    function test_send_NoModules() public virtual {
        aNexus.setFeeConfigModule(address(0));
        aNexus.setPauseModule(address(0));
        aNexus.setRateLimiterModule(address(0));

        aToken.mint(alice, 1 ether);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 1 ether, 1 ether, _getDefaultLzOptions());
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        _executeSend(alice, sendParam, fee, alice);
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(bToken.balanceOf(bob), 1 ether);
    }

    // ============ Scaled Rate Limit Send Tests ============

    function test_send_ScaledRateLimit() public virtual {
        _setupScales(aRateLimiterModule, TOKEN_ID, 2e18);
        _setupScales(bRateLimiterModule, TOKEN_ID, 2e18);

        uint256 tokensToSend = 50 ether;
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, tokensToSend, 0, _getDefaultLzOptions());
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        _executeSend(alice, sendParam, fee, address(this));
        verifyPackets(bEid, addressToBytes32(address(bNexus)));

        assertEq(aToken.balanceOf(alice), initialBalance - tokensToSend);
        assertEq(bToken.balanceOf(bob), tokensToSend);

        (uint256 aOutUsage, uint256 aOutAvail, , ) = aRateLimiterModule.getRateLimitUsages(uint256(bEid));
        assertEq(aOutUsage, 100 ether, "outbound usage = 50 tokens * 2x scale");
        assertEq(aOutAvail, 1_000_000 ether - 100 ether, "outbound available = limit - usage");

        (, , uint256 bInUsage, uint256 bInAvail) = bRateLimiterModule.getRateLimitUsages(uint256(aEid));
        assertEq(bInUsage, 100 ether, "inbound usage = 50 tokens * 2x scale");
        assertEq(bInAvail, 1_000_000 ether - 100 ether, "inbound available = limit - usage");

        uint256 aOutAvailUnscaled = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(aOutAvailUnscaled, 499_950 ether, "unscaled outbound = (limit - usage) / scale");
    }

    function test_send_Revert_ScaledRateLimitOverLimit() public virtual {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether, 100);
        _setupScales(aRateLimiterModule, TOKEN_ID, 2e18);

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(available, 50 ether);

        aToken.mint(alice, 51 ether);
        SendParam memory sendParam = _buildSendParamWithOptions(bEid, bob, 51 ether, 0, _getDefaultLzOptions());
        MessagingFee memory fee = aNexusOFT.quoteSend(sendParam, false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 100 ether, 102 ether));
        aNexusOFT.send{ value: fee.nativeFee }(sendParam, fee, payable(alice));
    }
}

// ============ Dynamic Selector Tests ============

contract NexusRedeemIssueTest is NexusOFTTest {
    address aBurnerMinter;
    address bBurnerMinter;

    function _deployNexusContracts() internal override {
        bytes4 redeemSelector = bytes4(keccak256("redeem(address,uint256)"));
        bytes4 issueSelector = bytes4(keccak256("issue(address,uint256)"));

        aNexusImpl = new Nexus(address(endpoints[aEid]), localDecimals, redeemSelector, issueSelector);
        bNexusImpl = new Nexus(address(endpoints[bEid]), localDecimals, redeemSelector, issueSelector);

        aNexus = Nexus(
            _deployTransparentProxy(
                address(aNexusImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexus = Nexus(
            _deployTransparentProxy(
                address(bNexusImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
    }

    function _deployTokens() internal override {
        super._deployTokens();
        aBurnerMinter = address(new MockBurnerMinterRedeemIssue(address(aToken)));
        bBurnerMinter = address(new MockBurnerMinterRedeemIssue(address(bToken)));
    }

    function _setupTokenRoles() internal override {
        aToken.grantRole(aToken.MINTER_ROLE(), aBurnerMinter);
        aToken.grantRole(aToken.BURNER_ROLE(), aBurnerMinter);
        bToken.grantRole(bToken.MINTER_ROLE(), bBurnerMinter);
        bToken.grantRole(bToken.BURNER_ROLE(), bBurnerMinter);

        aToken.grantRole(aToken.MINTER_ROLE(), address(this));
    }

    function _deployNexusOFTs() internal override {
        _grantNexusRoles();

        aNexusOFT = new NexusOFT(address(aNexus), address(aToken), TOKEN_ID);
        bNexusOFT = new NexusOFT(address(bNexus), address(bToken), TOKEN_ID);

        aNexus.registerToken(TOKEN_ID, address(aNexusOFT), aBurnerMinter);
        bNexus.registerToken(TOKEN_ID, address(bNexusOFT), bBurnerMinter);
    }
}

contract NexusCrosschainTest is NexusOFTTest {
    address aBurnerMinter;
    address bBurnerMinter;

    function _deployNexusContracts() internal override {
        bytes4 crosschainBurnSelector = bytes4(keccak256("crosschainBurn(address,uint256)"));
        bytes4 crosschainMintSelector = bytes4(keccak256("crosschainMint(address,uint256)"));

        aNexusImpl = new Nexus(address(endpoints[aEid]), localDecimals, crosschainBurnSelector, crosschainMintSelector);
        bNexusImpl = new Nexus(address(endpoints[bEid]), localDecimals, crosschainBurnSelector, crosschainMintSelector);

        aNexus = Nexus(
            _deployTransparentProxy(
                address(aNexusImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexus = Nexus(
            _deployTransparentProxy(
                address(bNexusImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
    }

    function _deployTokens() internal override {
        super._deployTokens();
        aBurnerMinter = address(new MockBurnerMinterCrosschain(address(aToken)));
        bBurnerMinter = address(new MockBurnerMinterCrosschain(address(bToken)));
    }

    function _setupTokenRoles() internal override {
        aToken.grantRole(aToken.MINTER_ROLE(), aBurnerMinter);
        aToken.grantRole(aToken.BURNER_ROLE(), aBurnerMinter);
        bToken.grantRole(bToken.MINTER_ROLE(), bBurnerMinter);
        bToken.grantRole(bToken.BURNER_ROLE(), bBurnerMinter);

        aToken.grantRole(aToken.MINTER_ROLE(), address(this));
    }

    function _deployNexusOFTs() internal override {
        _grantNexusRoles();

        aNexusOFT = new NexusOFT(address(aNexus), address(aToken), TOKEN_ID);
        bNexusOFT = new NexusOFT(address(bNexus), address(bToken), TOKEN_ID);

        aNexus.registerToken(TOKEN_ID, address(aNexusOFT), aBurnerMinter);
        bNexus.registerToken(TOKEN_ID, address(bNexusOFT), bBurnerMinter);
    }
}
