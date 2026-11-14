// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { RateLimiterBaseUpgradeable } from "./../contracts/rate-limiter/RateLimiterBaseUpgradeable.sol";

contract RateLimiterBaseUpgradeableHarness is RateLimiterBaseUpgradeable {
    constructor(uint8 _scaleDecimals) RateLimiterBaseUpgradeable(_scaleDecimals) {
        _disableInitializers();
    }

    function initialize(bool _useGlobalState) public initializer {
        __RateLimiterBase_init(_useGlobalState);
    }

    function setRateLimitGlobalConfig(IRateLimiter.RateLimitGlobalConfig memory _globalConfig) public {
        _setRateLimitGlobalConfig(_globalConfig);
    }

    function setRateLimitConfigs(IRateLimiter.SetRateLimitConfigParam[] calldata _configs) public {
        _setRateLimitConfigs(_configs);
    }

    function setRateLimitStates(IRateLimiter.SetRateLimitStateParam[] calldata _states) public {
        _setRateLimitStates(_states);
    }

    function setRateLimitAddressExemptions(
        IRateLimiter.SetRateLimitAddressExemptionParam[] calldata _exemptions
    ) public {
        _setRateLimitAddressExemptions(_exemptions);
    }

    function checkpointRateLimits(uint256[] calldata _ids) public {
        _checkpointRateLimits(_ids);
    }

    function outflow(uint256 _id, address _from, uint256 _amount) external {
        _outflow(_id, _from, _amount);
    }

    function inflow(uint256 _id, address _to, uint256 _amount) external {
        _inflow(_id, _to, _amount);
    }

    function getRateLimitUsage(
        uint40 _lastUpdated,
        uint96 _amountInFlight,
        uint96 _limit,
        uint32 _window
    ) external view returns (uint256 currentUsage, uint256 availableAmount) {
        return _getRateLimitUsage(_lastUpdated, _amountInFlight, _limit, _window);
    }

    function upscaleRateLimitAmount(uint256 _amount) external view returns (uint256) {
        return _upscaleRateLimitAmount(_amount);
    }
}

contract RateLimiterBaseUpgradeableTest is Test {
    RateLimiterBaseUpgradeableHarness rateLimiter;
    /// @dev Separate instance for global state tests to avoid warm storage overlap or conflict.
    RateLimiterBaseUpgradeableHarness rateLimiterGlobal;

    uint256 constant ID_1 = uint256(keccak256("ID_1"));
    uint256 constant ID_2 = uint256(keccak256("ID_2"));
    uint256 constant GLOBAL_STATE_ID = 0;
    uint32 constant NO_DECAY_WINDOW = type(uint32).max;
    uint256 constant YEAR = 365 days;
    uint96 constant HUB_LEDGER_LIMIT = type(uint96).max;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant ID_SNAP_EXPLICIT_OUTBOUND_GROSS = uint256(keccak256("ID_SNAP_EXPLICIT_OUTBOUND_GROSS"));
    uint256 constant ID_SNAP_EXPLICIT_INBOUND_GROSS = uint256(keccak256("ID_SNAP_EXPLICIT_INBOUND_GROSS"));
    uint256 constant ID_SNAP_EXPLICIT_BOTH_NET_OUT = uint256(keccak256("ID_SNAP_EXPLICIT_BOTH_NET_OUT"));
    uint256 constant ID_SNAP_EXPLICIT_BOTH_NET_IN = uint256(keccak256("ID_SNAP_EXPLICIT_BOTH_NET_IN"));
    uint256 constant ID_SNAP_EXPLICIT_BOTH_GROSS_EXEMPT = uint256(keccak256("ID_SNAP_EXPLICIT_BOTH_GROSS_EXEMPT"));
    uint256 constant ID_SNAP_GLOBAL_OUTBOUND_GROSS = uint256(keccak256("ID_SNAP_GLOBAL_OUTBOUND_GROSS"));
    uint256 constant ID_SNAP_DISABLED = uint256(keccak256("ID_SNAP_DISABLED"));

    function setUp() public virtual {
        rateLimiter = _deployRateLimiter(0, false);
        rateLimiterGlobal = _deployRateLimiter(0, true);

        _setUpConfigs();
    }

    function _deployRateLimiter(
        uint8 _scaleDecimals,
        bool _useGlobalState
    ) internal virtual returns (RateLimiterBaseUpgradeableHarness) {
        RateLimiterBaseUpgradeableHarness impl = new RateLimiterBaseUpgradeableHarness(_scaleDecimals);
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(
                RateLimiterBaseUpgradeableHarness.initialize.selector,
                _useGlobalState,
                address(this)
            )
        );
        return RateLimiterBaseUpgradeableHarness(address(proxy));
    }

    function _setUpConfigs() internal {
        uint96 limit = 1000;
        uint32 window = 1000;

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(
            ID_SNAP_EXPLICIT_OUTBOUND_GROSS,
            true,
            true,
            false,
            false,
            false,
            limit,
            limit,
            window,
            window
        );
        rateLimiter.setRateLimitConfigs(configs);

        configs[0] = _createConfig(
            ID_SNAP_EXPLICIT_INBOUND_GROSS,
            true,
            false,
            true,
            false,
            false,
            limit,
            limit,
            window,
            window
        );
        rateLimiter.setRateLimitConfigs(configs);

        configs[0] = _createConfig(
            ID_SNAP_EXPLICIT_BOTH_NET_OUT,
            true,
            true,
            true,
            true,
            false,
            limit,
            limit,
            window,
            window
        );
        rateLimiter.setRateLimitConfigs(configs);
        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(ID_SNAP_EXPLICIT_BOTH_NET_OUT, 0, 50, uint40(block.timestamp));
        rateLimiter.setRateLimitStates(states);

        configs[0] = _createConfig(
            ID_SNAP_EXPLICIT_BOTH_NET_IN,
            true,
            true,
            true,
            true,
            false,
            limit,
            limit,
            window,
            window
        );
        rateLimiter.setRateLimitConfigs(configs);
        states[0] = _createState(ID_SNAP_EXPLICIT_BOTH_NET_IN, 50, 0, uint40(block.timestamp));
        rateLimiter.setRateLimitStates(states);

        configs[0] = _createConfig(
            ID_SNAP_EXPLICIT_BOTH_GROSS_EXEMPT,
            true,
            true,
            true,
            false,
            true,
            limit,
            limit,
            window,
            window
        );
        rateLimiter.setRateLimitConfigs(configs);
        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: alice, isExempt: true });
        rateLimiter.setRateLimitAddressExemptions(exemptions);

        configs[0] = _createConfig(GLOBAL_STATE_ID, true, true, true, false, false, limit, limit, window, window);
        rateLimiterGlobal.setRateLimitConfigs(configs);

        configs[0] = _createConfig(ID_SNAP_DISABLED, true, false, true, false, false, limit, limit, window, window);
        rateLimiter.setRateLimitConfigs(configs);
    }

    function _createConfig(
        uint256 _id,
        bool _active,
        bool _outboundEnabled,
        bool _inboundEnabled,
        bool _netAccountingEnabled,
        bool _addressExemptionEnabled,
        uint96 _outboundLimit,
        uint96 _inboundLimit,
        uint32 _outboundWindow,
        uint32 _inboundWindow
    ) internal pure returns (IRateLimiter.SetRateLimitConfigParam memory) {
        return
            IRateLimiter.SetRateLimitConfigParam({
                id: _id,
                config: IRateLimiter.RateLimitConfig({
                    active: _active,
                    outboundEnabled: _outboundEnabled,
                    inboundEnabled: _inboundEnabled,
                    netAccountingEnabled: _netAccountingEnabled,
                    addressExemptionEnabled: _addressExemptionEnabled,
                    outboundLimit: _outboundLimit,
                    inboundLimit: _inboundLimit,
                    outboundWindow: _outboundWindow,
                    inboundWindow: _inboundWindow
                })
            });
    }

    function _createState(
        uint256 _id,
        uint96 _outboundUsage,
        uint96 _inboundUsage,
        uint40 _lastUpdated
    ) internal pure returns (IRateLimiter.SetRateLimitStateParam memory) {
        return
            IRateLimiter.SetRateLimitStateParam({
                id: _id,
                state: IRateLimiter.RateLimitState({
                    outboundUsage: _outboundUsage,
                    inboundUsage: _inboundUsage,
                    lastUpdated: _lastUpdated
                })
            });
    }

    function _setUpHubLedger(
        RateLimiterBaseUpgradeableHarness _limiter,
        uint256 _id,
        bool _outboundEnabled,
        uint96 _outboundLimit,
        uint32 _outboundWindow
    ) internal {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(
            _id,
            true,
            _outboundEnabled,
            true,
            true,
            false,
            _outboundLimit,
            HUB_LEDGER_LIMIT,
            _outboundWindow,
            NO_DECAY_WINDOW
        );
        _limiter.setRateLimitConfigs(configs);

        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(_id, 0, HUB_LEDGER_LIMIT, uint40(block.timestamp));
        _limiter.setRateLimitStates(states);
    }

    function _inboundAvailable(
        RateLimiterBaseUpgradeableHarness _limiter,
        uint256 _id
    ) internal view returns (uint256 inAvail) {
        (, , , inAvail) = _limiter.getRateLimitUsages(_id);
    }

    // ============ Constructor / Initialization Tests ============

    function test_constructor_Revert_InvalidScaledDecimals() public {
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.InvalidScaledDecimals.selector, 19));
        new RateLimiterBaseUpgradeableHarness(19);
    }

    function test_constructor_MaxScaledDecimals() public {
        RateLimiterBaseUpgradeableHarness impl = new RateLimiterBaseUpgradeableHarness(18);

        assertEq(impl.SCALE_DECIMALS(), 18);
    }

    function test_constructor_ZeroScaledDecimals() public {
        RateLimiterBaseUpgradeableHarness impl = new RateLimiterBaseUpgradeableHarness(0);

        assertEq(impl.SCALE_DECIMALS(), 0);
    }

    // ============ Scaling Tests ============

    function test_outflow_WithScaleDecimals() public {
        RateLimiterBaseUpgradeableHarness scaledLimiter = _deployRateLimiter(12, false);

        uint96 limit = 1_000_000_000;
        uint32 window = 1000;

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, true, false, limit, limit, window, window);
        scaledLimiter.setRateLimitConfigs(configs);

        uint256 scaledAmount = 500 * 1e18;

        scaledLimiter.outflow(ID_1, alice, scaledAmount);

        (uint256 outUsage, uint256 outAvail, , ) = scaledLimiter.getRateLimitUsages(ID_1);

        assertEq(outUsage, scaledAmount);
        assertGt(outAvail, 0);
    }

    function test_inflow_WithScaleDecimals() public {
        RateLimiterBaseUpgradeableHarness scaledLimiter = _deployRateLimiter(12, false);

        uint96 limit = 1_000_000_000;
        uint32 window = 1000;

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, true, false, limit, limit, window, window);
        scaledLimiter.setRateLimitConfigs(configs);

        uint256 scaledAmount = 300 * 1e18;

        scaledLimiter.inflow(ID_1, alice, scaledAmount);

        (, , uint256 inUsage, uint256 inAvail) = scaledLimiter.getRateLimitUsages(ID_1);

        assertEq(inUsage, scaledAmount);
        assertGt(inAvail, 0);
    }

    function test_upscaleRateLimitAmount() public {
        RateLimiterBaseUpgradeableHarness scaledLimiter = _deployRateLimiter(12, false);

        uint256 downscaled = 100;
        uint256 upscaled = scaledLimiter.upscaleRateLimitAmount(downscaled);

        assertEq(upscaled, 100 * 1e12);
    }

    // ============ Global State Tests ============

    function test_globalState_UsesGlobalStateIdForState() public {
        RateLimiterBaseUpgradeableHarness globalLimiter = _deployRateLimiter(0, true);

        uint96 limit = 1000;
        uint32 window = 1000;

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(GLOBAL_STATE_ID, true, true, true, true, false, limit, limit, window, window);
        globalLimiter.setRateLimitConfigs(configs);

        globalLimiter.outflow(ID_1, alice, 100);

        IRateLimiter.RateLimit memory globalState = globalLimiter.rateLimits(GLOBAL_STATE_ID);
        IRateLimiter.RateLimit memory id1State = globalLimiter.rateLimits(ID_1);

        assertEq(globalState.outboundUsage, 100);
        assertEq(id1State.outboundUsage, 0);
    }

    function test_globalState_IgnoresIdSpecificConfig() public {
        RateLimiterBaseUpgradeableHarness globalLimiter = _deployRateLimiter(0, true);

        uint96 globalLimit = 1000;
        uint96 idSpecificLimit = 500;
        uint32 window = 1000;

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](2);
        configs[0] = _createConfig(
            GLOBAL_STATE_ID,
            true,
            true,
            true,
            true,
            false,
            globalLimit,
            globalLimit,
            window,
            window
        );
        configs[1] = _createConfig(
            ID_1,
            true,
            true,
            true,
            true,
            false,
            idSpecificLimit,
            idSpecificLimit,
            window,
            window
        );
        globalLimiter.setRateLimitConfigs(configs);

        (, uint256 outAvail, , ) = globalLimiter.getRateLimitUsages(ID_1);

        assertEq(outAvail, globalLimit);
    }

    function test_globalState_SharesStateAcrossIds() public {
        RateLimiterBaseUpgradeableHarness globalLimiter = _deployRateLimiter(0, true);

        uint96 limit = 1000;
        uint32 window = 1000;

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(GLOBAL_STATE_ID, true, true, true, true, false, limit, limit, window, window);
        globalLimiter.setRateLimitConfigs(configs);

        globalLimiter.outflow(ID_1, alice, 100);
        globalLimiter.outflow(ID_2, alice, 200);

        (uint256 id1OutUsage, , , ) = globalLimiter.getRateLimitUsages(ID_1);
        (uint256 id2OutUsage, , , ) = globalLimiter.getRateLimitUsages(ID_2);

        assertEq(id1OutUsage, 300);
        assertEq(id2OutUsage, 300);
    }

    // ============ setRateLimitGlobalConfig Tests ============

    function test_setRateLimitGlobalConfig() public {
        IRateLimiter.RateLimitGlobalConfig memory config = IRateLimiter.RateLimitGlobalConfig({
            useGlobalState: true,
            isGloballyDisabled: false
        });

        vm.expectEmit(true, true, true, true, address(rateLimiter));
        emit IRateLimiter.RateLimitGlobalConfigUpdated(config);
        rateLimiter.setRateLimitGlobalConfig(config);

        IRateLimiter.RateLimitGlobalConfig memory retrieved = rateLimiter.getRateLimitGlobalConfig();
        assertTrue(retrieved.useGlobalState);
        assertFalse(retrieved.isGloballyDisabled);

        config.useGlobalState = false;
        config.isGloballyDisabled = true;

        vm.expectEmit(true, true, true, true, address(rateLimiter));
        emit IRateLimiter.RateLimitGlobalConfigUpdated(config);
        rateLimiter.setRateLimitGlobalConfig(config);

        retrieved = rateLimiter.getRateLimitGlobalConfig();
        assertFalse(retrieved.useGlobalState);
        assertTrue(retrieved.isGloballyDisabled);
    }

    function test_setRateLimitConfigs_Single() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, false, false, true, true, 100, 200, 300, 400);

        vm.expectEmit(false, false, false, true);
        emit IRateLimiter.RateLimitConfigUpdated(ID_1, configs[0].config);

        rateLimiter.setRateLimitConfigs(configs);

        IRateLimiter.RateLimit memory rl = rateLimiter.rateLimits(ID_1);
        assertEq(rl.outboundLimit, 100);
        assertEq(rl.inboundLimit, 200);
        assertEq(rl.outboundWindow, 300);
        assertEq(rl.inboundWindow, 400);
        // Active (bit 0) = 1, NetAccounting (bit 3) = 8, AddressExemption (bit 4) = 16 => 25 total.
        assertEq(rl.configBitmap, 25);
    }

    function test_setRateLimitConfigs_Multiple() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](2);
        configs[0] = _createConfig(ID_1, true, true, true, true, true, 10, 10, 10, 10);
        configs[1] = _createConfig(ID_2, true, false, false, false, false, 20, 20, 20, 20);

        rateLimiter.setRateLimitConfigs(configs);

        IRateLimiter.RateLimit memory rl1 = rateLimiter.rateLimits(ID_1);
        assertEq(rl1.outboundLimit, 10);

        IRateLimiter.RateLimit memory rl2 = rateLimiter.rateLimits(ID_2);
        assertEq(rl2.outboundLimit, 20);
    }

    function test_setRateLimitStates_Single() public {
        vm.warp(1000);
        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(ID_1, 50, 60, 1000);

        vm.expectEmit(false, false, false, true);
        emit IRateLimiter.RateLimitStateUpdated(ID_1, states[0].state);

        rateLimiter.setRateLimitStates(states);

        IRateLimiter.RateLimit memory rl = rateLimiter.rateLimits(ID_1);
        assertEq(rl.outboundUsage, 50);
        assertEq(rl.inboundUsage, 60);
        assertEq(rl.lastUpdated, 1000);
    }

    function test_setRateLimitStates_Revert_FutureTimestamp() public {
        vm.warp(1000);
        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(ID_1, 50, 60, 1001); // Future

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.LastUpdatedInFuture.selector, 1001, 1000));
        rateLimiter.setRateLimitStates(states);
    }

    function test_setRateLimitAddressExemptions() public {
        if (rateLimiter.isRateLimitAddressExempt(alice)) {
            IRateLimiter.SetRateLimitAddressExemptionParam[]
                memory resetExemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
            resetExemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: alice, isExempt: false });
            rateLimiter.setRateLimitAddressExemptions(resetExemptions);
        }

        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](2);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: alice, isExempt: true });
        exemptions[1] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: bob, isExempt: true });

        vm.expectEmit(true, false, false, true);
        emit IRateLimiter.RateLimitAddressExemptionUpdated(alice, true);
        vm.expectEmit(true, false, false, true);
        emit IRateLimiter.RateLimitAddressExemptionUpdated(bob, true);

        rateLimiter.setRateLimitAddressExemptions(exemptions);

        assertTrue(rateLimiter.isRateLimitAddressExempt(alice));
        assertTrue(rateLimiter.isRateLimitAddressExempt(bob));

        exemptions[0].isExempt = false;
        exemptions[1].isExempt = false;
        rateLimiter.setRateLimitAddressExemptions(exemptions);
        assertFalse(rateLimiter.isRateLimitAddressExempt(alice));
    }

    function test_setRateLimitAddressExemptions_Revert_AlreadyExempt() public {
        if (!rateLimiter.isRateLimitAddressExempt(alice)) {
            IRateLimiter.SetRateLimitAddressExemptionParam[]
                memory initExemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
            initExemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: alice, isExempt: true });
            rateLimiter.setRateLimitAddressExemptions(initExemptions);
        }

        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: alice, isExempt: true });
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.ExemptionStateIdempotent.selector, alice, true));
        rateLimiter.setRateLimitAddressExemptions(exemptions);
    }

    // ============ checkpointRateLimits Tests ============

    function test_checkpointRateLimits_Single() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 100, 100);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 1000);

        vm.warp(block.timestamp + 50);

        uint256[] memory ids = new uint256[](1);
        ids[0] = ID_1;
        rateLimiter.checkpointRateLimits(ids);

        IRateLimiter.RateLimit memory rl = rateLimiter.rateLimits(ID_1);
        assertEq(rl.outboundUsage, 500);
        assertEq(rl.lastUpdated, block.timestamp);
    }

    function test_checkpointRateLimits_Multiple() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](2);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 100, 100);
        configs[1] = _createConfig(ID_2, true, true, true, false, false, 500, 500, 100, 100);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 1000);
        rateLimiter.outflow(ID_2, alice, 500);

        vm.warp(block.timestamp + 50);

        uint256[] memory ids = new uint256[](2);
        ids[0] = ID_1;
        ids[1] = ID_2;
        rateLimiter.checkpointRateLimits(ids);

        IRateLimiter.RateLimit memory rl1 = rateLimiter.rateLimits(ID_1);
        assertEq(rl1.outboundUsage, 500);
        assertEq(rl1.lastUpdated, block.timestamp);

        IRateLimiter.RateLimit memory rl2 = rateLimiter.rateLimits(ID_2);
        assertEq(rl2.outboundUsage, 250);
        assertEq(rl2.lastUpdated, block.timestamp);
    }

    function test_checkpointRateLimits_NoDecayWindow() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, NO_DECAY_WINDOW, NO_DECAY_WINDOW);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 600);
        rateLimiter.inflow(ID_1, alice, 400);

        vm.warp(block.timestamp + 100 * YEAR);

        uint256[] memory ids = new uint256[](1);
        ids[0] = ID_1;
        rateLimiter.checkpointRateLimits(ids);

        IRateLimiter.RateLimit memory rl = rateLimiter.rateLimits(ID_1);
        assertEq(rl.outboundUsage, 600);
        assertEq(rl.inboundUsage, 400);
        assertEq(rl.lastUpdated, block.timestamp);
    }

    function test_checkpointRateLimits_Empty() public {
        uint256[] memory ids = new uint256[](0);
        rateLimiter.checkpointRateLimits(ids);
    }

    function test_checkpointRateLimits_PreservesDecay() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 100, 100);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 1000);

        vm.warp(block.timestamp + 50);

        (uint256 outUsageBefore, uint256 outAvailBefore, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsageBefore, 500);
        assertEq(outAvailBefore, 500);

        uint256[] memory ids = new uint256[](1);
        ids[0] = ID_1;
        rateLimiter.checkpointRateLimits(ids);

        (uint256 outUsageAfter, uint256 outAvailAfter, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsageAfter, 500);
        assertEq(outAvailAfter, 500);
    }

    function test_setRateLimitConfigs_DoesNotAutoCheckpoint() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 100, 100);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 1000);

        vm.warp(block.timestamp + 50);

        /// @dev Usage should still be 1000 in storage (no checkpoint).
        IRateLimiter.RateLimit memory rlBefore = rateLimiter.rateLimits(ID_1);
        assertEq(rlBefore.outboundUsage, 1000);

        /// @dev Setting configs should NOT checkpoint anymore.
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 2000, 2000, 200, 200);
        rateLimiter.setRateLimitConfigs(configs);

        /// @dev Raw storage still has the old usage since no checkpoint was performed.
        IRateLimiter.RateLimit memory rlAfter = rateLimiter.rateLimits(ID_1);
        assertEq(rlAfter.outboundUsage, 1000);
    }

    // ============ Outflow/Inflow Tests ============

    function test_outflow_Revert_UnconfiguredId() public {
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.outflow(ID_2, bob, 100);
    }

    function test_inflow_Revert_UnconfiguredId() public {
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.inflow(ID_2, bob, 100);
    }

    function test_outflow_Revert_UnconfiguredIdWithState() public {
        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(ID_2, 0, 50, uint40(block.timestamp));
        rateLimiter.setRateLimitStates(states);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.outflow(ID_2, bob, 100);
    }

    function test_outflow_Revert_UnconfiguredIdExemptAddress() public {
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.outflow(ID_2, alice, 100);
    }

    function test_outflow_Revert_InactiveConfig() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, false, false, false, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.outflow(ID_1, bob, 100);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.inflow(ID_1, bob, 100);
    }

    function test_outflow_Revert_DeactivatedConfig() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);
        rateLimiter.outflow(ID_1, bob, 100);

        configs[0] = _createConfig(ID_1, false, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.outflow(ID_1, bob, 100);
    }

    function test_outflow_ReactivatedConfigKeepsDecay() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);
        rateLimiter.outflow(ID_1, bob, 1000);

        configs[0] = _createConfig(ID_1, false, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);

        vm.warp(block.timestamp + 10 * 1000);
        uint256[] memory ids = new uint256[](1);
        ids[0] = ID_1;
        rateLimiter.checkpointRateLimits(ids);
        rateLimiter.outflow(ID_1, bob, 0);

        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);

        (, uint256 outAvail, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outAvail, 1000);
        rateLimiter.outflow(ID_1, bob, 1000);
    }

    function test_getRateLimitUsages_InactiveUsageDecays() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);
        rateLimiter.outflow(ID_1, bob, 1000);

        configs[0] = _createConfig(ID_1, false, true, true, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);
        vm.warp(block.timestamp + 500);

        (uint256 outUsage, uint256 outAvail, , uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 500);
        assertEq(outAvail, 0);
        assertEq(inAvail, 0);
    }

    function test_outflow_Revert_GlobalStateUnconfigured() public {
        RateLimiterBaseUpgradeableHarness globalLimiter = _deployRateLimiter(0, true);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        globalLimiter.outflow(ID_1, bob, 100);
    }

    function test_outflow_ConfiguredIdDoesNotOpenOtherIds() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, false, false, false, false, 0, 0, 0, 0);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, bob, 100);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        rateLimiter.outflow(ID_2, bob, 100);
    }

    function test_outflow_ExplicitConfig_SpecificState_Outbound_Gross_NotExempt() public {
        rateLimiter.outflow(ID_SNAP_EXPLICIT_OUTBOUND_GROSS, alice, 100);

        (uint256 usage, , , ) = rateLimiter.getRateLimitUsages(ID_SNAP_EXPLICIT_OUTBOUND_GROSS);
        assertEq(usage, 100);
    }

    function test_outflow_ExplicitConfig_SpecificState_Both_Gross_Exempt() public {
        rateLimiter.outflow(ID_SNAP_EXPLICIT_BOTH_GROSS_EXEMPT, alice, 100);

        (uint256 usage, , , ) = rateLimiter.getRateLimitUsages(ID_SNAP_EXPLICIT_BOTH_GROSS_EXEMPT);
        assertEq(usage, 0);
    }

    function test_inflow_GloballyDisabled() public {
        rateLimiter.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );

        rateLimiter.inflow(ID_1, alice, 100);

        (uint256 outUsage, , uint256 inUsage, ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(inUsage, 0);
        assertEq(outUsage, 0);
    }

    function test_outflow_GloballyDisabled() public {
        rateLimiter.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );

        rateLimiter.outflow(ID_1, alice, 100);

        (uint256 outUsage, , uint256 inUsage, ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 0);
        assertEq(inUsage, 0);
    }

    function test_outflow_NoDecayWindow() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, NO_DECAY_WINDOW, NO_DECAY_WINDOW);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 600);

        vm.warp(block.timestamp + 100 * YEAR);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 400, 401));
        rateLimiter.outflow(ID_1, alice, 401);

        rateLimiter.outflow(ID_1, alice, 400);

        (uint256 outUsage, uint256 outAvail, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 1000);
        assertEq(outAvail, 0);
    }

    function test_inflow_NoDecayWindow() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, NO_DECAY_WINDOW, NO_DECAY_WINDOW);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.inflow(ID_1, alice, 600);

        vm.warp(block.timestamp + 100 * YEAR);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 400, 401));
        rateLimiter.inflow(ID_1, alice, 401);

        rateLimiter.inflow(ID_1, alice, 400);

        (, , uint256 inUsage, uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(inUsage, 1000);
        assertEq(inAvail, 0);
    }

    function test_inflow_HubLedger() public {
        _setUpHubLedger(rateLimiter, ID_1, false, 0, 0);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 0);

        rateLimiter.outflow(ID_1, alice, 300);
        rateLimiter.inflow(ID_1, alice, 100);
        rateLimiter.outflow(ID_1, alice, 50);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 250);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 250, 251));
        rateLimiter.inflow(ID_1, alice, 251);

        rateLimiter.inflow(ID_1, alice, 250);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 0);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1));
        rateLimiter.inflow(ID_1, alice, 1);
    }

    function test_inflow_HubLedger_LongWarp() public {
        _setUpHubLedger(rateLimiter, ID_1, false, 0, 0);
        rateLimiter.outflow(ID_1, alice, 300);

        vm.warp(block.timestamp + 100 * YEAR);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 300);

        vm.warp(block.timestamp + 10_000 * YEAR);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 300);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 300, 301));
        rateLimiter.inflow(ID_1, alice, 301);

        rateLimiter.inflow(ID_1, alice, 300);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 0);
    }

    function test_inflow_HubLedger_DecayingOutboundNetLimit() public {
        _setUpHubLedger(rateLimiter, ID_1, true, 500, 100);

        rateLimiter.outflow(ID_1, alice, 500);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 500);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1));
        rateLimiter.outflow(ID_1, alice, 1);

        vm.warp(block.timestamp + 50);
        (uint256 outUsage, uint256 outAvail, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 250);
        assertEq(outAvail, 250);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 500);

        rateLimiter.inflow(ID_1, alice, 200);
        (outUsage, outAvail, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 50);
        assertEq(outAvail, 450);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 300);

        vm.warp(block.timestamp + 100 * YEAR);
        (outUsage, , , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 0);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 300);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 300, 301));
        rateLimiter.inflow(ID_1, alice, 301);

        rateLimiter.inflow(ID_1, alice, 300);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 0);
    }

    function test_inflow_HubLedger_WithScaleDecimals() public {
        RateLimiterBaseUpgradeableHarness scaledLimiter = _deployRateLimiter(12, false);
        _setUpHubLedger(scaledLimiter, ID_1, false, 0, 0);

        scaledLimiter.outflow(ID_1, alice, 300_000_000e18 + 123_456e12);
        scaledLimiter.inflow(ID_1, alice, 100_000_000e18);

        uint256 headroom = 200_000_000e18 + 123_456e12;
        assertEq(_inboundAvailable(scaledLimiter, ID_1), headroom);

        vm.warp(block.timestamp + 100 * YEAR);
        assertEq(_inboundAvailable(scaledLimiter, ID_1), headroom);

        vm.expectRevert(
            abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, headroom / 1e12, headroom / 1e12 + 1)
        );
        scaledLimiter.inflow(ID_1, alice, headroom + 1);

        scaledLimiter.inflow(ID_1, alice, headroom);
        assertEq(_inboundAvailable(scaledLimiter, ID_1), 0);
    }

    function test_inflow_HubLedger_MaxLimit() public {
        _setUpHubLedger(rateLimiter, ID_1, false, 0, 0);

        rateLimiter.outflow(ID_1, alice, HUB_LEDGER_LIMIT);
        rateLimiter.outflow(ID_1, alice, 1);
        assertEq(_inboundAvailable(rateLimiter, ID_1), HUB_LEDGER_LIMIT);

        vm.expectRevert(
            abi.encodeWithSelector(
                IRateLimiter.RateLimitExceeded.selector,
                HUB_LEDGER_LIMIT,
                uint256(HUB_LEDGER_LIMIT) + 1
            )
        );
        rateLimiter.inflow(ID_1, alice, uint256(HUB_LEDGER_LIMIT) + 1);

        rateLimiter.inflow(ID_1, alice, HUB_LEDGER_LIMIT);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 0);
        assertEq(rateLimiter.rateLimits(ID_1).inboundUsage, HUB_LEDGER_LIMIT);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1));
        rateLimiter.inflow(ID_1, alice, 1);
    }

    function test_outflow_HubLedger_PerIdIsolation() public {
        _setUpHubLedger(rateLimiter, ID_1, false, 0, 0);
        _setUpHubLedger(rateLimiter, ID_2, false, 0, 0);

        rateLimiter.outflow(ID_1, alice, 300);
        assertEq(_inboundAvailable(rateLimiter, ID_1), 300);
        assertEq(_inboundAvailable(rateLimiter, ID_2), 0);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1));
        rateLimiter.inflow(ID_2, alice, 1);

        rateLimiter.inflow(ID_1, alice, 300);
    }

    function test_outflow_Revert_RateLimitExceeded() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 100, 100, 100, 100);
        rateLimiter.setRateLimitConfigs(configs);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 100, 101));
        rateLimiter.outflow(ID_1, alice, 101);
    }

    // ============ getRateLimitUsages Disabled Direction Tests ============

    function test_getRateLimitUsages_WithDecay() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 100, 100);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 1000);

        (uint256 outUsageBefore, uint256 outAvailBefore, , ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsageBefore, 1000);
        assertEq(outAvailBefore, 0);

        vm.warp(block.timestamp + 50);

        (uint256 outUsageAfter, uint256 outAvailAfter, , ) = rateLimiter.getRateLimitUsages(ID_1);

        assertEq(outUsageAfter, 500);
        assertEq(outAvailAfter, 500);
    }

    function test_getRateLimitUsages_NoDecayWindow() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, NO_DECAY_WINDOW, NO_DECAY_WINDOW);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 600);
        rateLimiter.inflow(ID_1, alice, 400);

        vm.warp(block.timestamp + 100 * YEAR);

        (uint256 outUsage, uint256 outAvail, uint256 inUsage, uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 600);
        assertEq(outAvail, 400);
        assertEq(inUsage, 400);
        assertEq(inAvail, 600);

        vm.warp(type(uint40).max);

        (outUsage, outAvail, inUsage, inAvail) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 600);
        assertEq(outAvail, 400);
        assertEq(inUsage, 400);
        assertEq(inAvail, 600);
    }

    function test_getRateLimitUsages_MaxDecayingWindow() public {
        uint32 window = NO_DECAY_WINDOW - 1;
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, window, window);
        rateLimiter.setRateLimitConfigs(configs);

        rateLimiter.outflow(ID_1, alice, 1000);
        rateLimiter.inflow(ID_1, alice, 1000);

        vm.warp(block.timestamp + 100 * YEAR);

        uint256 decay = (1000 * 100 * YEAR) / window;
        (uint256 outUsage, , uint256 inUsage, ) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, 1000 - decay);
        assertEq(inUsage, 1000 - decay);
        assertGt(decay, 0);
    }

    function test_getRateLimitUsages_Fuzz_NoDecayWindow(
        uint96 _outboundUsage,
        uint96 _inboundUsage,
        uint96 _limit,
        uint256 _elapsed
    ) public {
        _elapsed = bound(_elapsed, 0, type(uint40).max - block.timestamp);

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(
            ID_1,
            true,
            true,
            true,
            false,
            false,
            _limit,
            _limit,
            NO_DECAY_WINDOW,
            NO_DECAY_WINDOW
        );
        rateLimiter.setRateLimitConfigs(configs);

        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(ID_1, _outboundUsage, _inboundUsage, uint40(block.timestamp));
        rateLimiter.setRateLimitStates(states);

        vm.warp(block.timestamp + _elapsed);

        (uint256 outUsage, uint256 outAvail, uint256 inUsage, uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_1);
        assertEq(outUsage, _outboundUsage);
        assertEq(outAvail, _limit > _outboundUsage ? _limit - _outboundUsage : 0);
        assertEq(inUsage, _inboundUsage);
        assertEq(inAvail, _limit > _inboundUsage ? _limit - _inboundUsage : 0);
    }

    function test_getRateLimitUsages_OutboundDisabled() public view {
        // ID_SNAP_DISABLED: outbound=false, inbound=true, limit=1000, window=1000.
        (uint256 outUsage, uint256 outAvail, uint256 inUsage, uint256 inAvail) = rateLimiter.getRateLimitUsages(
            ID_SNAP_DISABLED
        );

        assertEq(outUsage, 0);
        assertEq(outAvail, type(uint256).max);
        assertEq(inUsage, 0);
        assertEq(inAvail, 1000);
    }

    function test_getRateLimitUsages_InboundDisabled() public view {
        // ID_SNAP_EXPLICIT_OUTBOUND_GROSS: outbound=true, inbound=false, limit=1000, window=1000.
        (uint256 outUsage, uint256 outAvail, uint256 inUsage, uint256 inAvail) = rateLimiter.getRateLimitUsages(
            ID_SNAP_EXPLICIT_OUTBOUND_GROSS
        );

        assertEq(outUsage, 0);
        assertEq(outAvail, 1000);
        assertEq(inUsage, 0);
        assertEq(inAvail, type(uint256).max);
    }

    function test_getRateLimitUsages_BothDisabled() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, false, false, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);

        (, uint256 outAvail, , uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_1);

        assertEq(outAvail, type(uint256).max);
        assertEq(inAvail, type(uint256).max);
    }

    function test_getRateLimitUsages_Inactive() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, false, false, false, false, false, 1000, 1000, 1000, 1000);
        rateLimiter.setRateLimitConfigs(configs);

        (, uint256 outAvail, , uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_1);

        assertEq(outAvail, 0);
        assertEq(inAvail, 0);
    }

    function test_getRateLimitUsages_Unconfigured() public view {
        (uint256 outUsage, uint256 outAvail, uint256 inUsage, uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_2);

        assertEq(outUsage, 0);
        assertEq(outAvail, 0);
        assertEq(inUsage, 0);
        assertEq(inAvail, 0);
    }

    function test_getRateLimitUsages_GloballyDisabled() public {
        rateLimiter.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );

        (, uint256 outAvail, , uint256 inAvail) = rateLimiter.getRateLimitUsages(ID_SNAP_EXPLICIT_BOTH_NET_OUT);

        assertEq(outAvail, type(uint256).max);
        assertEq(inAvail, type(uint256).max);
    }

    function test_initial_state_closed() public {
        RateLimiterBaseUpgradeableHarness freshLimiter = _deployRateLimiter(0, false);

        IRateLimiter.RateLimit memory rl = freshLimiter.rateLimits(GLOBAL_STATE_ID);

        // All-zero bitmap, closed in both directions.
        assertEq(rl.configBitmap, 0);
        assertEq(rl.outboundLimit, 0);
        assertEq(rl.inboundLimit, 0);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        freshLimiter.outflow(uint256(keccak256("ANY_ID")), address(this), 100);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 100));
        freshLimiter.inflow(uint256(keccak256("ANY_ID")), address(this), 100);
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.ratelimiter")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xfc4b3847e0649a09792d4c694ef28e20c43dde62a8b3de98eff85ccb4e1f3000);
    }
}
