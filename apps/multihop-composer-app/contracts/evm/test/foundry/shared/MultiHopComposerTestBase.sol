// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import {
    EnforcedOptionParam,
    IOAppOptionsType3
} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import {
    IOFT,
    MessagingFee,
    MessagingReceipt,
    SendParam
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm/contracts/libs/OFTComposeMsgCodec.sol";
import { OFTNativeExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTNativeExtendedRBACUpgradeable.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IMultiHopComposer } from "./../../../contracts/interfaces/IMultiHopComposer.sol";
import { MultiHopComposerMsgCodec } from "./../../../contracts/libs/MultiHopComposerMsgCodec.sol";
import { MultiHopComposer } from "./../../../contracts/MultiHopComposer.sol";
import { MultiHopComposerNative } from "./../../../contracts/MultiHopComposerNative.sol";
import { NativeOFTAdapterHarness, OFTAdapterHarness, OFTHarness } from "./../harnesses/OFTHarnesses.sol";

/// @dev Mints both `MockERC20` and `OFTHarness` tokens, whose `mint` returns a value and nothing respectively.
interface IMintable {
    function mint(address _to, uint256 _amount) external;
}

/**
 * @notice Shared fixture for the composer tests: two meshes that overlap on one chain, with a composer joining them.
 * @dev Mesh A spans eth and arb, and mesh B spans arb and pol. Arb is the hub chain where the composer lives.
 * @dev With `OFTKind.ERC20`, mesh A is lock-unlock style and mesh B is burn-mint style. There, mesh A locks mesh B's own
 * @dev token, so both meshes share the token the composer requires. With a native kind, every OFT holds the native token
 * @dev and the composer is a `MultiHopComposerNative`.
 * @dev Every chain shares one native balance per address in the test, so a landing is measured as the change in the
 * @dev recipient's balance across its delivery.
 */
abstract contract MultiHopComposerTestBase is TestHelperOz5 {
    using OptionsBuilder for bytes;

    /**
     * @notice OFT kind the fixture deploys.
     *         - `ERC20`: lock-unlock and burn-mint OFTs of one ERC20 token, joined by a `MultiHopComposer`.
     *         - `NativeOFTAdapter`: `NativeOFTAdapter`s, joined by a `MultiHopComposerNative`.
     *         - `NativeConsole`: Console OFTs (`OFTNativeExtendedRBACUpgradeable`) behind transparent proxies, joined by a
     *           `MultiHopComposerNative`.
     */
    enum OFTKind {
        ERC20,
        NativeOFTAdapter,
        NativeConsole
    }

    uint8 internal constant DECIMALS = 6;
    uint8 internal constant NATIVE_DECIMALS = 18;

    uint32 internal constant ETH_EID = 1;
    uint32 internal constant ARB_EID = 2;
    uint32 internal constant POL_EID = 3;
    /// @dev An eid no mesh has a peer for, so a send to it fails.
    uint32 internal constant BAD_EID = 100;

    uint256 internal constant TOKENS_TO_SEND = 1 ether;
    uint256 internal constant INITIAL_BALANCE = 100 ether;

    uint128 internal constant LZ_RECEIVE_GAS = 2_000_000;
    uint128 internal constant LZ_COMPOSE_GAS = 2_000_000;
    uint128 internal constant LZ_COMPOSE_VALUE = 3 gwei;
    /// @dev Too little gas for the second hop, so the whole `lzCompose` runs out of gas.
    uint256 internal constant LOW_COMPOSE_GAS = 100_000;
    /// @dev A committed minimum `msg.value` above `LZ_COMPOSE_VALUE`.
    uint256 internal constant MIN_MSG_VALUE = 1 ether;
    /// @dev A cap above `MIN_MSG_VALUE`, so a committed minimum up to it is enforced as is.
    uint256 internal constant MAX_ENFORCED_MSG_VALUE = 10 ether;
    /// @dev Gas a gas-heavy OFT's `send` burns.
    uint256 internal constant HEAVY_SEND_GAS = 10_000_000;
    /// @dev Delivery gas too low for a `HEAVY_SEND_GAS` send, whose EIP-150 remainder still records the failure.
    uint256 internal constant HEAVY_SEND_GAS_SHORTFALL = 9_000_000;

    /**
     * @dev The OFTs a two-hop transfer goes through. OFT A carries the first leg from the source chain to the hub
     * @dev chain, where `composer` forwards the tokens into OFT B, which carries the second leg to the destination
     * @dev chain.
     */
    struct FullTripParams {
        address oftASrcChain;
        address oftAHubChain;
        MultiHopComposer composer;
        address oftBHubChain;
        address oftBDstChain;
    }

    /// @dev `ERC20` kind only.
    MockERC20 internal ethToken;
    /// @dev `ERC20` kind only.
    IERC20 internal arbToken;

    address internal ethMeshA;
    address internal arbMeshA;

    address internal arbMeshB;
    address internal polMeshB;

    MultiHopComposer internal composer;

    address internal arbEndpoint;

    bytes internal lzReceiveOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);

    address internal userA = makeAddr("userA");
    address internal userB = makeAddr("userB");
    address internal executor = makeAddr("executor");
    address internal nativeRefundRecipient = makeAddr("nativeRefundRecipient");
    /// @dev `NativeConsole` kind only: fee deposit of every Console OFT.
    address internal feeDeposit = makeAddr("feeDeposit");

    function setUp() public virtual override {
        vm.deal(userA, 1_000 ether);
        vm.deal(userB, 1_000 ether);
        vm.deal(executor, 1_000 ether);

        super.setUp();
        setUpEndpoints(3, LibraryType.UltraLightNode);

        arbEndpoint = address(endpoints[ARB_EID]);

        _deployMeshes();

        composer = _newComposer(
            address(this),
            _addressArray(arbMeshA, arbMeshB),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );

        vm.label(ethMeshA, "MeshA_eth");
        vm.label(arbMeshA, "MeshA_arb");
        vm.label(arbMeshB, "MeshB_arb");
        vm.label(polMeshB, "MeshB_pol");
        vm.label(address(composer), "MultiHopComposer");

        this.wireOApps(_addressArray(ethMeshA, arbMeshA));
        this.wireOApps(_addressArray(arbMeshB, polMeshB));

        /// @dev Refunds carry no caller options, so the return pathways need enforced options to be executable.
        _setEnforcedOptions(arbMeshA, ETH_EID);
        _setEnforcedOptions(arbMeshB, POL_EID);
    }

    // ============ Hooks ============

    /// @dev The OFT kind the fixture deploys. A suite overrides it to run against another kind.
    function _oftKind() internal pure virtual returns (OFTKind) {
        return OFTKind.ERC20;
    }

    /// @dev Deploys meshes A and B, and gives the OFTs that release tokens inventory so an inbound hop has something to
    /// @dev release.
    function _deployMeshes() internal virtual {
        if (_isNative()) {
            ethMeshA = _newNativeOFT(address(endpoints[ETH_EID]));
            arbMeshA = _newNativeOFT(arbEndpoint);
            arbMeshB = _newNativeOFT(arbEndpoint);
            polMeshB = _newNativeOFT(address(endpoints[POL_EID]));
            _fund(polMeshB, polMeshB, INITIAL_BALANCE);
            _fund(arbMeshB, arbMeshB, INITIAL_BALANCE);
        } else {
            arbMeshB = address(new OFTHarness("arbMeshB", "arbMeshB", arbEndpoint, address(this)));
            polMeshB = address(new OFTHarness("polMeshB", "polMeshB", address(endpoints[POL_EID]), address(this)));
            ethToken = new MockERC20(DECIMALS);
            ethMeshA = address(new OFTAdapterHarness(address(ethToken), address(endpoints[ETH_EID]), address(this)));
            arbMeshA = address(new OFTAdapterHarness(arbMeshB, arbEndpoint, address(this)));
            arbToken = IERC20(arbMeshB);
        }

        _fund(ethMeshA, ethMeshA, INITIAL_BALANCE);
        _fund(arbMeshA, arbMeshA, INITIAL_BALANCE);
    }

    /// @dev Deploys the composer for the fixture's OFT kind.
    function _newComposer(
        address _initialOwner,
        address[] memory _ofts,
        address _nativeRefundRecipient,
        uint256 _maxEnforcedMsgValue
    ) internal virtual returns (MultiHopComposer) {
        if (_isNative()) {
            return new MultiHopComposerNative(_initialOwner, _ofts, _nativeRefundRecipient, _maxEnforcedMsgValue);
        }
        return new MultiHopComposer(_initialOwner, _ofts, _nativeRefundRecipient, _maxEnforcedMsgValue);
    }

    /// @dev Deploys another lock-unlock OFT on the hub chain over the hub's token, with no inventory and no peers.
    function _deployHubOFT() internal virtual returns (address) {
        if (_isNative()) return _newNativeOFT(arbEndpoint);
        return address(new OFTAdapterHarness(address(arbToken), arbEndpoint, address(this)));
    }

    /// @dev Deploys a native OFT of the fixture's native kind on `_endpoint`.
    function _newNativeOFT(address _endpoint) internal virtual returns (address oft) {
        if (_oftKind() == OFTKind.NativeOFTAdapter) {
            return address(new NativeOFTAdapterHarness(NATIVE_DECIMALS, _endpoint, address(this)));
        }
        return _newConsoleNativeOFT(_endpoint);
    }

    /**
     * @dev Deploys a Console OFT (`OFTNativeExtendedRBACUpgradeable`) behind a transparent proxy, with this contract as
     * @dev its admin and every manager role. Its rate limits are closed by default, so they are disabled.
     */
    function _newConsoleNativeOFT(address _endpoint) internal returns (address oft) {
        address impl = address(new OFTNativeExtendedRBACUpgradeable(NATIVE_DECIMALS, _endpoint, 0));
        OFTNativeExtendedRBACUpgradeable consoleOFT = OFTNativeExtendedRBACUpgradeable(
            payable(
                new TransparentUpgradeableProxy(
                    impl,
                    makeAddr("proxyAdminOwner"),
                    abi.encodeCall(OFTNativeExtendedRBACUpgradeable.initialize, (address(this), feeDeposit))
                )
            )
        );

        consoleOFT.grantRole(consoleOFT.RATE_LIMITER_MANAGER_ROLE(), address(this));
        consoleOFT.grantRole(consoleOFT.FEE_CONFIG_MANAGER_ROLE(), address(this));
        consoleOFT.grantRole(consoleOFT.PAUSER_ROLE(), address(this));
        consoleOFT.grantRole(consoleOFT.UNPAUSER_ROLE(), address(this));
        consoleOFT.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );

        return address(consoleOFT);
    }

    /// @dev Gives `_account` `_amount` of the token `_oft` carries.
    function _fund(address _oft, address _account, uint256 _amount) internal virtual {
        address token = IOFT(_oft).token();
        if (token == address(0)) {
            vm.deal(_account, _account.balance + _amount);
        } else {
            IMintable(token).mint(_account, _amount);
        }
    }

    /// @dev Balance of `_account` in the token `_oft` carries.
    function _balanceOf(address _oft, address _account) internal view virtual returns (uint256 balance) {
        address token = IOFT(_oft).token();
        return token == address(0) ? _account.balance : IERC20(token).balanceOf(_account);
    }

    /// @dev Checks that `_composer` can pay `_oft` what a send takes.
    function _assertApproval(MultiHopComposer _composer, address _oft) internal view virtual {
        if (_isNative()) {
            assertFalse(IOFT(_oft).approvalRequired(), "a native OFT takes the amount as value, not by allowance");
        } else {
            assertEq(arbToken.allowance(address(_composer), _oft), type(uint256).max);
        }
    }

    /// @dev Checks that `_account` holds `_amount` of the hub's token and `_value` of native.
    function _assertHeld(address _account, uint256 _amount, uint256 _value, string memory _message) internal view {
        if (_isNative()) {
            assertEq(_account.balance, _amount + _value, _message);
        } else {
            assertEq(_balanceOf(arbMeshA, _account), _amount, _message);
            assertEq(_account.balance, _value, _message);
        }
    }

    function _isNative() internal pure returns (bool) {
        return _oftKind() != OFTKind.ERC20;
    }

    // ============ Helpers ============

    /// @dev Builds the message the delivering OFT's lzReceive() queues for a compose, nonce included.
    function _createComposePayload(
        uint64 _nonce,
        uint32 _srcEid,
        bytes memory _composeMsg,
        uint256 _amount,
        address _user
    ) internal pure returns (bytes memory composeMsg) {
        composeMsg = OFTComposeMsgCodec.encode(
            _nonce,
            _srcEid,
            _amount,
            abi.encodePacked(addressToBytes32(_user), _composeMsg)
        );
    }

    function _randomGUID() internal view returns (bytes32) {
        return bytes32(vm.randomBytes(32));
    }

    function _addressArray() internal pure returns (address[] memory addrs_) {
        return new address[](0);
    }

    function _addressArray(address _a) internal pure returns (address[] memory addrs_) {
        addrs_ = new address[](1);
        addrs_[0] = _a;
    }

    function _addressArray(address _a, address _b) internal pure returns (address[] memory addrs_) {
        addrs_ = new address[](2);
        addrs_[0] = _a;
        addrs_[1] = _b;
    }

    function _hop(address _oft, SendParam memory _sendParam) internal pure returns (bytes memory) {
        return _hop(_oft, bytes32(0), 0, _sendParam);
    }

    function _hop(address _oft, bytes32 _refundTo, SendParam memory _sendParam) internal pure returns (bytes memory) {
        return _hop(_oft, _refundTo, 0, _sendParam);
    }

    function _hop(
        address _oft,
        bytes32 _refundTo,
        uint256 _minMsgValue,
        SendParam memory _sendParam
    ) internal pure returns (bytes memory) {
        return MultiHopComposerMsgCodec.encode(_sendParam, _oft, _refundTo, _minMsgValue);
    }

    /// @dev Enforces `lzReceiveOptions` on `_oft`'s pathway to `_eid`.
    function _setEnforcedOptions(address _oft, uint32 _eid) internal {
        EnforcedOptionParam[] memory options = new EnforcedOptionParam[](1);
        options[0] = EnforcedOptionParam({ eid: _eid, msgType: 1, options: lzReceiveOptions });
        IOAppOptionsType3(_oft).setEnforcedOptions(options);
    }

    /**
     * @dev Runs a two-hop transfer of `TOKENS_TO_SEND` from `userA` back to `userA`, who must already hold the tokens on
     * @dev the source chain and have approved `oftASrcChain` if it locks them.
     */
    function _fullTrip(FullTripParams memory _p) internal {
        uint32 srcEid = _eid(_p.oftASrcChain);
        uint32 hubEid = _eid(_p.oftAHubChain);

        /// @dev 1. Send on OFT A on the source chain, carrying the second leg as the compose payload.
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _sendFirstLeg(
            _p.oftASrcChain,
            address(_p.composer),
            hubEid,
            _hop(_p.oftBHubChain, _secondLegSendParam(_eid(_p.oftBDstChain), _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );

        /// @dev 2. Receive on OFT A on the hub chain: the composer holds the tokens.
        verifyPackets(hubEid, addressToBytes32(_p.oftAHubChain));
        assertEq(
            _balanceOf(_p.oftAHubChain, address(_p.composer)),
            TOKENS_TO_SEND,
            "the composer should hold the received tokens"
        );

        /// @dev 3. Compose into OFT B on the hub chain. The executor delivers the compose through the endpoint, which
        /// @dev checks it against the hash OFT A queued.
        bytes memory composeMsg = _queuedComposeMsg(srcEid, sendParam, receipt);
        vm.expectEmit(true, true, true, true, address(_p.composer));
        emit IMultiHopComposer.Sent(receipt.guid, _p.oftBHubChain);
        this.lzCompose(hubEid, _p.oftAHubChain, sendParam.extraOptions, receipt.guid, address(_p.composer), composeMsg);
        assertEq(
            _balanceOf(_p.oftAHubChain, address(_p.composer)),
            0,
            "the composer should retain nothing after the hop"
        );

        /// @dev 4. Receive on OFT B on the destination chain: the user holds the tokens.
        _verifyLanded(_p.oftBDstChain, TOKENS_TO_SEND);
    }

    function _sendFirstLeg(
        address _oftASrcChain,
        address _composer,
        uint32 _hubEid,
        bytes memory _payload,
        uint128 _composeValue
    ) internal returns (SendParam memory sendParam, MessagingReceipt memory receipt) {
        return _sendFirstLeg(_oftASrcChain, _composer, _hubEid, _payload, _composeValue, TOKENS_TO_SEND);
    }

    /// @dev Sends `_amount` from `userA` through `_oftASrcChain`, paying the amount as value for a native OFT.
    function _sendFirstLeg(
        address _oftASrcChain,
        address _composer,
        uint32 _hubEid,
        bytes memory _payload,
        uint128 _composeValue,
        uint256 _amount
    ) internal returns (SendParam memory sendParam, MessagingReceipt memory receipt) {
        sendParam = SendParam(
            _hubEid,
            addressToBytes32(_composer),
            _amount,
            _amount,
            OptionsBuilder.newOptions().addExecutorLzReceiveOption(LZ_RECEIVE_GAS, 0).addExecutorLzComposeOption(
                0,
                LZ_COMPOSE_GAS,
                _composeValue
            ),
            _payload,
            ""
        );

        MessagingFee memory fee = IOFT(_oftASrcChain).quoteSend(sendParam, false);
        uint256 value = fee.nativeFee + (IOFT(_oftASrcChain).token() == address(0) ? _amount : 0);
        vm.prank(userA);
        (receipt, ) = IOFT(_oftASrcChain).send{ value: value }(sendParam, fee, payable(userA));
    }

    /// @dev Funds `userA` on eth and lands the first leg through mesh A on `_composer`.
    function _landFirstLeg(
        address _composer,
        bytes memory _payload,
        uint128 _composeValue
    ) internal returns (SendParam memory sendParam, MessagingReceipt memory receipt) {
        return _landFirstLeg(ethMeshA, arbMeshA, _composer, _payload, _composeValue);
    }

    /// @dev Funds `userA` and lands the first leg through `_oftASrcChain` on `_composer`.
    function _landFirstLeg(
        address _oftASrcChain,
        address _oftAHubChain,
        address _composer,
        bytes memory _payload,
        uint128 _composeValue
    ) internal returns (SendParam memory sendParam, MessagingReceipt memory receipt) {
        _fundUserA(_oftASrcChain);
        (sendParam, receipt) = _sendFirstLeg(_oftASrcChain, _composer, _eid(_oftAHubChain), _payload, _composeValue);
        verifyPackets(_eid(_oftAHubChain), addressToBytes32(_oftAHubChain));
    }

    /// @dev Lands the first leg through mesh A and delivers a compose whose second hop through `_oftBHubChain` fails.
    function _failSecondLeg(
        MultiHopComposer _composer,
        address _oftBHubChain,
        SendParam memory _secondLeg,
        uint128 _composeValue
    ) internal returns (bytes32) {
        return _failSecondLeg(_composer, _oftBHubChain, _hop(_oftBHubChain, _secondLeg), _composeValue);
    }

    function _failSecondLeg(
        MultiHopComposer _composer,
        address _oftBHubChain,
        bytes memory _payload,
        uint128 _composeValue
    ) internal returns (bytes32) {
        return _failSecondLeg(_composer, ethMeshA, arbMeshA, _oftBHubChain, _payload, _composeValue);
    }

    /// @dev Lands the first leg through `_oftASrcChain` and delivers a compose whose second hop through `_oftBHubChain`
    /// @dev fails.
    function _failSecondLeg(
        MultiHopComposer _composer,
        address _oftASrcChain,
        address _oftAHubChain,
        address _oftBHubChain,
        bytes memory _payload,
        uint128 _composeValue
    ) internal returns (bytes32 guid) {
        bytes memory options;
        bytes memory composeMsg;
        {
            (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
                _oftASrcChain,
                _oftAHubChain,
                address(_composer),
                _payload,
                _composeValue
            );
            options = sendParam.extraOptions;
            composeMsg = _queuedComposeMsg(_eid(_oftASrcChain), sendParam, receipt);
            guid = receipt.guid;
        }
        uint256 landedBalance = _balanceOf(_oftAHubChain, address(_composer));

        vm.expectEmit(true, true, true, true, address(_composer));
        emit IMultiHopComposer.SendFailed(guid, _oftBHubChain);
        this.lzCompose(_eid(_oftAHubChain), _oftAHubChain, options, guid, address(_composer), composeMsg);

        /// @dev A native composer keeps the compose value in the same balance as the tokens.
        assertEq(
            _balanceOf(_oftAHubChain, address(_composer)),
            landedBalance + (_isNative() ? _composeValue : 0),
            "a failed hop should keep the tokens"
        );
    }

    /// @dev Lands the first leg through mesh A with a payload that does not decode, and delivers its compose.
    function _failDecode(MultiHopComposer _composer) internal returns (bytes32 guid) {
        return _failDecode(_composer, bytes("malformed"));
    }

    function _failDecode(MultiHopComposer _composer, bytes memory _payload) internal returns (bytes32 guid) {
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(_composer),
            _payload,
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);
        guid = receipt.guid;

        vm.expectEmit(true, true, true, true, address(_composer));
        emit IMultiHopComposer.DecodeFailed(guid, _payload);
        this.lzCompose(ARB_EID, arbMeshA, sendParam.extraOptions, guid, address(_composer), composeMsg);
    }

    function _refundAndLand(
        MultiHopComposer _composer,
        bytes32 _guid,
        address _oftAHubChain,
        address _oftASrcChain
    ) internal {
        _refundAndLand(_composer, _guid, _oftAHubChain, _oftASrcChain, TOKENS_TO_SEND);
    }

    /// @dev Refunds a failed hop and checks the record clears, the leftover native reaches the native refund recipient,
    /// @dev and `_amount` lands back with `userA` on `_oftASrcChain`.
    function _refundAndLand(
        MultiHopComposer _composer,
        bytes32 _guid,
        address _oftAHubChain,
        address _oftASrcChain,
        uint256 _amount
    ) internal {
        /// @dev The refund pays the cached `msg.value` plus the 1 ether sent, and the endpoint returns the excess.
        uint256 expectedRecipientBalance;
        {
            (, , , SendParam memory refundSendParam, uint256 cachedMsgValue) = _composer.failedMessages(_guid);
            MessagingFee memory refundFee = IOFT(_oftAHubChain).quoteSend(refundSendParam, false);
            expectedRecipientBalance = nativeRefundRecipient.balance + 1 ether + cachedMsgValue - refundFee.nativeFee;
        }

        vm.expectEmit(true, true, true, true, address(_composer));
        emit IMultiHopComposer.Refunded(_guid, _oftAHubChain);
        /// @dev Anyone can refund, not just the owner.
        vm.prank(userB, userB);
        _composer.refund{ value: 1 ether }(_guid);

        (, , address refundOFT, , ) = _composer.failedMessages(_guid);
        assertEq(refundOFT, address(0), "the refund should clear the record");
        assertEq(
            nativeRefundRecipient.balance,
            expectedRecipientBalance,
            "leftover native should go to the native refund recipient"
        );

        _verifyLanded(_oftASrcChain, _amount);
    }

    /// @dev Delivers the pending packets to `_dstOFT` and checks `_amount` lands with `userA`.
    function _verifyLanded(address _dstOFT, uint256 _amount) internal {
        uint256 initialBalance = _balanceOf(_dstOFT, userA);
        verifyPackets(_eid(_dstOFT), addressToBytes32(_dstOFT));
        assertEq(_balanceOf(_dstOFT, userA) - initialBalance, _amount, "the amount should land with the recipient");
    }

    /// @dev The compose message OFT A queues on the hub chain for a first leg `userA` sent from `_srcEid`.
    function _queuedComposeMsg(
        uint32 _srcEid,
        SendParam memory _sendParam,
        MessagingReceipt memory _receipt
    ) internal view returns (bytes memory) {
        return _createComposePayload(_receipt.nonce, _srcEid, _sendParam.composeMsg, _sendParam.amountLD, userA);
    }

    function _secondLegSendParam(uint32 _dstEid, bytes memory _extraOptions) internal view returns (SendParam memory) {
        return SendParam(_dstEid, addressToBytes32(userA), TOKENS_TO_SEND, TOKENS_TO_SEND, _extraOptions, "", "");
    }

    function _secondLegOptions() internal pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(LZ_RECEIVE_GAS, 0);
    }

    /// @dev Gives `userA` `TOKENS_TO_SEND` to send through `_srcOFT`, approving it when it pulls an ERC20 token.
    function _fundUserA(address _srcOFT) internal {
        _fund(_srcOFT, userA, TOKENS_TO_SEND);
        address token = IOFT(_srcOFT).token();
        if (token != address(0)) {
            vm.prank(userA);
            IERC20(token).approve(_srcOFT, TOKENS_TO_SEND);
        }
    }

    function _deployComposer(address _oftA, address _oftB) internal returns (MultiHopComposer) {
        return _newComposer(address(this), _addressArray(_oftA, _oftB), nativeRefundRecipient, MAX_ENFORCED_MSG_VALUE);
    }

    /// @dev Mesh C is a second lock-unlock mesh over the hub chain's token, spanning arb and pol, with no enforced options.
    function _deployMeshC(bool _wire) internal returns (address arbMeshC, address polMeshC) {
        address polToken = _isNative() ? address(0) : address(new MockERC20(DECIMALS));
        arbMeshC = _deployHubOFT();
        polMeshC = _isNative()
            ? _newNativeOFT(address(endpoints[POL_EID]))
            : address(new OFTAdapterHarness(polToken, address(endpoints[POL_EID]), address(this)));
        vm.label(arbMeshC, "MeshC_arb");
        vm.label(polMeshC, "MeshC_pol");
        if (_wire) this.wireOApps(_addressArray(arbMeshC, polMeshC));

        /// @dev Give the destination lock-unlock mesh inventory so the second leg has something to release.
        _fund(polMeshC, polMeshC, INITIAL_BALANCE);
    }

    /// @dev Mesh D is a second lock-unlock mesh over eth's token, spanning eth and arb, with no enforced options.
    function _deployMeshD() internal returns (address ethMeshD, address arbMeshD) {
        ethMeshD = _isNative()
            ? _newNativeOFT(address(endpoints[ETH_EID]))
            : address(new OFTAdapterHarness(address(ethToken), address(endpoints[ETH_EID]), address(this)));
        arbMeshD = _deployHubOFT();
        vm.label(ethMeshD, "MeshD_eth");
        vm.label(arbMeshD, "MeshD_arb");
        this.wireOApps(_addressArray(ethMeshD, arbMeshD));

        /// @dev Give the hub lock-unlock mesh inventory so the first leg has something to release.
        _fund(arbMeshD, arbMeshD, INITIAL_BALANCE);
    }

    function _emptySendParam() internal pure returns (SendParam memory) {
        return SendParam(0, bytes32(0), 0, 0, "", "", "");
    }

    function _eid(address _oft) internal view returns (uint32) {
        return IOAppCore(_oft).endpoint().eid();
    }
}
