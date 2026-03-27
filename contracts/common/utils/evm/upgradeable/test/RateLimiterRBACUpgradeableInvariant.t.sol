// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { RateLimiterRBACUpgradeable } from "./../contracts/rate-limiter/RateLimiterRBACUpgradeable.sol";

contract RateLimiterRBACUpgradeableFuzzMock is RateLimiterRBACUpgradeable {
    constructor(uint8 _scaleDecimals) RateLimiterRBACUpgradeable(_scaleDecimals) {
        _disableInitializers();
    }

    function initialize(bool _useGlobalState, address _initialAdmin) public initializer {
        __RateLimiterBase_init(_useGlobalState);
        __AccessControl2Step_init(_initialAdmin);
        _grantRole(RATE_LIMITER_MANAGER_ROLE, _initialAdmin);
    }

    function outflow(uint256 _id, address _from, uint256 _amount) public {
        _outflow(_id, _from, _amount);
    }

    function inflow(uint256 _id, address _to, uint256 _amount) public {
        _inflow(_id, _to, _amount);
    }
}

contract RateLimiterRBACUpgradeableHandler is Test {
    RateLimiterRBACUpgradeableFuzzMock public limiter;

    uint256 public immutable ID;
    address public constant USER = address(0x123);
    address public constant EXEMPT_USER = address(0x999);

    uint96 public currentOutboundLimit;
    uint96 public currentInboundLimit;
    uint32 public currentOutboundWindow;
    uint32 public currentInboundWindow;
    bool public netAccounting;
    bool public addressExemptionEnabled;

    uint256 public ghost_outboundUsage;
    uint256 public ghost_inboundUsage;
    uint40 public ghost_lastUpdated;
    bool public ghost_exemptUserIsExempt;
    bool public ghost_globallyDisabled;
    bool public ghost_revertMismatch;

    constructor(RateLimiterRBACUpgradeableFuzzMock _limiter, uint256 _id) {
        limiter = _limiter;
        ID = _id;

        currentOutboundLimit = 1000 ether;
        currentInboundLimit = 1000 ether;
        currentOutboundWindow = 1000;
        currentInboundWindow = 1000;
        netAccounting = false;
        addressExemptionEnabled = true;

        ghost_lastUpdated = uint40(block.timestamp);
        ghost_exemptUserIsExempt = true;

        vm.startPrank(msg.sender);
        _applyConfig(
            currentOutboundLimit,
            currentInboundLimit,
            currentOutboundWindow,
            currentInboundWindow,
            netAccounting,
            addressExemptionEnabled
        );

        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: EXEMPT_USER, isExempt: true });
        limiter.setRateLimitAddressExemptions(exemptions);
        vm.stopPrank();
    }

    function _applyConfig(
        uint96 outLimit,
        uint96 inLimit,
        uint32 outWindow,
        uint32 inWindow,
        bool newNet,
        bool newExemptionEnabled
    ) internal {
        // Checkpoint ghost with old config, then checkpoint on-chain before setting new config.
        _updateGhostDecay();

        uint256[] memory ids = new uint256[](1);
        ids[0] = ID;
        limiter.checkpointRateLimits(ids);

        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: ID,
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: newNet,
                addressExemptionEnabled: newExemptionEnabled,
                outboundLimit: outLimit,
                inboundLimit: inLimit,
                outboundWindow: outWindow,
                inboundWindow: inWindow
            })
        });
        limiter.setRateLimitConfigs(configs);
    }

    function _updateGhostDecay() internal {
        uint256 timeSince = block.timestamp - ghost_lastUpdated;

        uint256 outDecay = (uint256(currentOutboundLimit) * timeSince) /
            (currentOutboundWindow > 0 ? currentOutboundWindow : 1);
        uint256 inDecay = (uint256(currentInboundLimit) * timeSince) /
            (currentInboundWindow > 0 ? currentInboundWindow : 1);

        if (outDecay > 0) ghost_outboundUsage = Math.saturatingSub(ghost_outboundUsage, outDecay);
        if (inDecay > 0) ghost_inboundUsage = Math.saturatingSub(ghost_inboundUsage, inDecay);

        ghost_lastUpdated = uint40(block.timestamp);
    }

    function getGhostUsages() public view returns (uint256 outbound, uint256 inbound) {
        uint256 timeSince = block.timestamp - ghost_lastUpdated;

        uint256 outDecay = (uint256(currentOutboundLimit) * timeSince) /
            (currentOutboundWindow > 0 ? currentOutboundWindow : 1);
        uint256 inDecay = (uint256(currentInboundLimit) * timeSince) /
            (currentInboundWindow > 0 ? currentInboundWindow : 1);

        outbound = Math.saturatingSub(ghost_outboundUsage, outDecay);
        inbound = Math.saturatingSub(ghost_inboundUsage, inDecay);
    }

    function outflow(uint96 amount, bool useExempt) public {
        amount = uint96(bound(amount, 1, currentOutboundLimit * 2));
        address user = useExempt ? EXEMPT_USER : USER;

        if (ghost_globallyDisabled) {
            try limiter.outflow(ID, user, amount) {} catch {
                ghost_revertMismatch = true;
            }
            return;
        }

        bool isExempt = useExempt && addressExemptionEnabled && ghost_exemptUserIsExempt;

        (, uint256 outAvail, , ) = limiter.getRateLimitUsages(ID);
        bool shouldSucceed = isExempt || amount <= outAvail;

        try limiter.outflow(ID, user, amount) {
            if (!shouldSucceed) ghost_revertMismatch = true;
            if (!isExempt) {
                _updateGhostDecay();
                ghost_outboundUsage += amount;
                if (netAccounting) {
                    ghost_inboundUsage = Math.saturatingSub(ghost_inboundUsage, amount);
                }
            }
        } catch (bytes memory reason) {
            if (shouldSucceed) {
                ghost_revertMismatch = true;
            } else {
                bytes memory expected = abi.encodeWithSelector(
                    IRateLimiter.RateLimitExceeded.selector,
                    outAvail,
                    amount
                );
                if (keccak256(reason) != keccak256(expected)) ghost_revertMismatch = true;
            }
        }
    }

    function inflow(uint96 amount, bool useExempt) public {
        amount = uint96(bound(amount, 1, currentInboundLimit * 2));
        address user = useExempt ? EXEMPT_USER : USER;

        if (ghost_globallyDisabled) {
            try limiter.inflow(ID, user, amount) {} catch {
                ghost_revertMismatch = true;
            }
            return;
        }

        bool isExempt = useExempt && addressExemptionEnabled && ghost_exemptUserIsExempt;

        (, , , uint256 inAvail) = limiter.getRateLimitUsages(ID);
        bool shouldSucceed = isExempt || amount <= inAvail;

        try limiter.inflow(ID, user, amount) {
            if (!shouldSucceed) ghost_revertMismatch = true;
            if (!isExempt) {
                _updateGhostDecay();
                ghost_inboundUsage += amount;
                if (netAccounting) {
                    ghost_outboundUsage = Math.saturatingSub(ghost_outboundUsage, amount);
                }
            }
        } catch (bytes memory reason) {
            if (shouldSucceed) {
                ghost_revertMismatch = true;
            } else {
                bytes memory expected = abi.encodeWithSelector(
                    IRateLimiter.RateLimitExceeded.selector,
                    inAvail,
                    amount
                );
                if (keccak256(reason) != keccak256(expected)) ghost_revertMismatch = true;
            }
        }
    }

    function warp(uint32 seconds_) public {
        uint32 maxWindow = currentOutboundWindow > currentInboundWindow ? currentOutboundWindow : currentInboundWindow;
        seconds_ = uint32(bound(seconds_, 1, maxWindow * 2));
        vm.warp(block.timestamp + seconds_);
    }

    function setConfig(
        uint96 outLimit,
        uint96 inLimit,
        uint32 outWindow,
        uint32 inWindow,
        bool net,
        bool exemptionEnabled
    ) public {
        outLimit = uint96(bound(outLimit, 100 ether, 10000 ether));
        inLimit = uint96(bound(inLimit, 100 ether, 10000 ether));
        outWindow = uint32(bound(outWindow, 10, 10000));
        inWindow = uint32(bound(inWindow, 10, 10000));

        _applyConfig(outLimit, inLimit, outWindow, inWindow, net, exemptionEnabled);

        currentOutboundLimit = outLimit;
        currentInboundLimit = inLimit;
        currentOutboundWindow = outWindow;
        currentInboundWindow = inWindow;
        netAccounting = net;
        addressExemptionEnabled = exemptionEnabled;
    }

    function toggleExemption() public {
        bool newExempt = !ghost_exemptUserIsExempt;

        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: EXEMPT_USER, isExempt: newExempt });
        limiter.setRateLimitAddressExemptions(exemptions);

        ghost_exemptUserIsExempt = newExempt;
    }

    function toggleGlobalDisable() public {
        bool newDisabled = !ghost_globallyDisabled;

        IRateLimiter.RateLimitGlobalConfig memory gc = limiter.getRateLimitGlobalConfig();
        gc.isGloballyDisabled = newDisabled;
        limiter.setRateLimitGlobalConfig(gc);

        ghost_globallyDisabled = newDisabled;
    }

    function setState(uint96 outUsage, uint96 inUsage, uint32 ageSeconds) public {
        outUsage = uint96(bound(outUsage, 0, currentOutboundLimit * 2));
        inUsage = uint96(bound(inUsage, 0, currentInboundLimit * 2));
        uint32 maxWindow = currentOutboundWindow > currentInboundWindow ? currentOutboundWindow : currentInboundWindow;
        uint256 maxAge = block.timestamp < maxWindow ? block.timestamp : maxWindow;
        ageSeconds = uint32(bound(ageSeconds, 0, maxAge));

        uint40 lastUpdated = uint40(block.timestamp) - uint40(ageSeconds);

        IRateLimiter.SetRateLimitStateParam[] memory params = new IRateLimiter.SetRateLimitStateParam[](1);
        params[0] = IRateLimiter.SetRateLimitStateParam({
            id: ID,
            state: IRateLimiter.RateLimitState({
                outboundUsage: outUsage,
                inboundUsage: inUsage,
                lastUpdated: lastUpdated
            })
        });
        limiter.setRateLimitStates(params);

        ghost_outboundUsage = outUsage;
        ghost_inboundUsage = inUsage;
        ghost_lastUpdated = lastUpdated;
    }
}

contract RateLimiterRBACUpgradeableInvariantTest is StdInvariant, Test {
    RateLimiterRBACUpgradeableFuzzMock limiter;
    RateLimiterRBACUpgradeableHandler handler;
    uint256 constant PRISTINE_ID = uint256(keccak256("PRISTINE_ID"));

    function setUp() public virtual {
        limiter = _createRateLimiter(0, _globalStateEnabled());
        handler = new RateLimiterRBACUpgradeableHandler(limiter, _handlerId());

        limiter.grantRole(limiter.RATE_LIMITER_MANAGER_ROLE(), address(handler));

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = RateLimiterRBACUpgradeableHandler.outflow.selector;
        selectors[1] = RateLimiterRBACUpgradeableHandler.inflow.selector;
        selectors[2] = RateLimiterRBACUpgradeableHandler.warp.selector;
        selectors[3] = RateLimiterRBACUpgradeableHandler.setConfig.selector;
        selectors[4] = RateLimiterRBACUpgradeableHandler.toggleExemption.selector;
        selectors[5] = RateLimiterRBACUpgradeableHandler.toggleGlobalDisable.selector;
        selectors[6] = RateLimiterRBACUpgradeableHandler.setState.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function _createRateLimiter(
        uint8 _scaleDecimals,
        bool _useGlobalState
    ) internal virtual returns (RateLimiterRBACUpgradeableFuzzMock) {
        RateLimiterRBACUpgradeableFuzzMock impl = new RateLimiterRBACUpgradeableFuzzMock(_scaleDecimals);
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(
                RateLimiterRBACUpgradeableFuzzMock.initialize.selector,
                _useGlobalState,
                address(this)
            )
        );
        return RateLimiterRBACUpgradeableFuzzMock(address(proxy));
    }

    function _globalStateEnabled() internal pure virtual returns (bool) {
        return false;
    }

    function _handlerId() internal pure virtual returns (uint256) {
        return uint256(keccak256("ID"));
    }

    /// @notice Available should always be saturatingSub(limit, usage); max when globally disabled.
    function invariant_AvailableConsistent() public view {
        (uint256 outUsage, uint256 outAvail, uint256 inUsage, uint256 inAvail) = limiter.getRateLimitUsages(
            handler.ID()
        );

        if (handler.ghost_globallyDisabled()) {
            assertEq(outAvail, type(uint256).max, "Outbound available should be max when globally disabled");
            assertEq(inAvail, type(uint256).max, "Inbound available should be max when globally disabled");
        } else {
            uint256 outLimit = handler.currentOutboundLimit();
            uint256 inLimit = handler.currentInboundLimit();

            assertEq(outAvail, (outLimit > outUsage) ? outLimit - outUsage : 0, "Outbound available mismatch");
            assertEq(inAvail, (inLimit > inUsage) ? inLimit - inUsage : 0, "Inbound available mismatch");
        }
    }

    /// @notice On-chain config and global flags must match handler-tracked state.
    function invariant_ConfigConsistency() public view {
        IRateLimiter.RateLimit memory rl = limiter.rateLimits(handler.ID());

        assertEq(rl.outboundLimit, handler.currentOutboundLimit(), "Outbound limit mismatch");
        assertEq(rl.inboundLimit, handler.currentInboundLimit(), "Inbound limit mismatch");
        assertEq(rl.outboundWindow, handler.currentOutboundWindow(), "Outbound window mismatch");
        assertEq(rl.inboundWindow, handler.currentInboundWindow(), "Inbound window mismatch");

        IRateLimiter.RateLimitGlobalConfig memory gc = limiter.getRateLimitGlobalConfig();
        assertEq(gc.isGloballyDisabled, handler.ghost_globallyDisabled(), "Global disabled flag mismatch");
    }

    /// @notice Contract-reported usage must match independent ghost decay calculation.
    function invariant_GhostConsistency() public view {
        (uint256 outUsage, , uint256 inUsage, ) = limiter.getRateLimitUsages(handler.ID());
        (uint256 expectedOut, uint256 expectedIn) = handler.getGhostUsages();

        assertEq(outUsage, expectedOut, "Ghost outbound usage mismatch");
        assertEq(inUsage, expectedIn, "Ghost inbound usage mismatch");
    }

    /// @notice Every outflow/inflow must succeed or revert exactly as predicted.
    function invariant_RevertConsistency() public view {
        assertFalse(handler.ghost_revertMismatch(), "Revert behavior diverged from predicted");
    }

    /// @notice On-chain exemption mapping must match handler-tracked ghost.
    function invariant_ExemptionConsistency() public view {
        assertEq(
            limiter.isRateLimitAddressExempt(handler.EXEMPT_USER()),
            handler.ghost_exemptUserIsExempt(),
            "Exemption state mismatch"
        );
    }

    /// @notice lastUpdated must never exceed block.timestamp.
    function invariant_LastUpdatedNotFuture() public view {
        IRateLimiter.RateLimit memory rl = limiter.rateLimits(handler.ID());
        assertTrue(rl.lastUpdated <= block.timestamp, "lastUpdated exceeds current block.timestamp");
    }

    /// @notice Config bitmap must decode to the same flags the handler tracks.
    function invariant_ConfigBitmapConsistency() public view {
        IRateLimiter.RateLimit memory rl = limiter.rateLimits(handler.ID());
        uint256 bitmap = rl.configBitmap;

        assertTrue(bitmap & 1 != 0, "Override default config bit not set");
        assertTrue(bitmap & 2 != 0, "Outbound enabled bit not set");
        assertTrue(bitmap & 4 != 0, "Inbound enabled bit not set");

        bool onChainNet = bitmap & 8 != 0;
        bool onChainExemption = bitmap & 16 != 0;
        assertEq(onChainNet, handler.netAccounting(), "Net accounting bitmap mismatch");
        assertEq(onChainExemption, handler.addressExemptionEnabled(), "Address exemption bitmap mismatch");
    }

    /// @notice An untouched ID must always have zero usage (catches cross-ID state contamination).
    function invariant_PristineIdUntouched() public view virtual {
        (uint256 outUsage, , uint256 inUsage, ) = limiter.getRateLimitUsages(PRISTINE_ID);
        assertEq(outUsage, 0, "Pristine ID has unexpected outbound usage");
        assertEq(inUsage, 0, "Pristine ID has unexpected inbound usage");
    }
}

contract RateLimiterRBACUpgradeableInvariantGlobalStateTest is RateLimiterRBACUpgradeableInvariantTest {
    function _globalStateEnabled() internal pure override returns (bool) {
        return true;
    }

    function _handlerId() internal pure override returns (uint256) {
        return 0;
    }

    /// @notice In global-state mode, all IDs share state so pristine ID mirrors active ID.
    function invariant_PristineIdUntouched() public view override {
        (uint256 outUsage, , uint256 inUsage, ) = limiter.getRateLimitUsages(PRISTINE_ID);
        (uint256 activeOut, , uint256 activeIn, ) = limiter.getRateLimitUsages(handler.ID());
        assertEq(outUsage, activeOut, "Global state: pristine ID should mirror active ID outbound usage");
        assertEq(inUsage, activeIn, "Global state: pristine ID should mirror active ID inbound usage");
    }
}
