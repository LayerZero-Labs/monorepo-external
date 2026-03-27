// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { RateLimiterRBACUpgradeable } from "./../contracts/rate-limiter/RateLimiterRBACUpgradeable.sol";
import { RateLimiterBaseUpgradeableTest, RateLimiterBaseUpgradeableMock } from "./RateLimiterBaseUpgradeable.t.sol";

contract RateLimiterRBACUpgradeableMock is RateLimiterRBACUpgradeable {
    constructor(uint8 _scaleDecimals) RateLimiterRBACUpgradeable(_scaleDecimals) {
        _disableInitializers();
    }

    function initialize(bool _useGlobalState, address _initialAdmin) public initializer {
        __RateLimiterBase_init(_useGlobalState);
        __AccessControl2Step_init(_initialAdmin);
        _grantRole(RATE_LIMITER_MANAGER_ROLE, _initialAdmin);
    }

    function outflow(uint256 _id, address _from, uint256 _amount) external {
        _outflow(_id, _from, _amount);
    }

    function inflow(uint256 _id, address _to, uint256 _amount) external {
        _inflow(_id, _to, _amount);
    }

    function upscaleRateLimitAmount(uint256 _amount) external view returns (uint256) {
        return _upscaleRateLimitAmount(_amount);
    }

    function downscaleRateLimitAmount(uint256 _amount) external view returns (uint256) {
        return _downscaleRateLimitAmount(_amount);
    }
}

contract RateLimiterRBACUpgradeableTest is RateLimiterBaseUpgradeableTest {
    bytes32 constant RATE_LIMITER_MANAGER_ROLE = keccak256("RATE_LIMITER_MANAGER_ROLE");

    address charlie = makeAddr("charlie");

    function _createRateLimiter(
        uint8 _scaleDecimals,
        bool _useGlobalState
    ) internal virtual override returns (RateLimiterBaseUpgradeableMock) {
        RateLimiterRBACUpgradeableMock impl = new RateLimiterRBACUpgradeableMock(_scaleDecimals);
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(RateLimiterRBACUpgradeableMock.initialize.selector, _useGlobalState, address(this))
        );
        return RateLimiterBaseUpgradeableMock(address(proxy));
    }

    function test_setRateLimitGlobalConfig_Revert_Unauthorized() public {
        IRateLimiter.RateLimitGlobalConfig memory config = IRateLimiter.RateLimitGlobalConfig({
            useGlobalState: true,
            isGloballyDisabled: false
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                RATE_LIMITER_MANAGER_ROLE
            )
        );
        vm.prank(charlie);
        RateLimiterRBACUpgradeableMock(address(rateLimiter)).setRateLimitGlobalConfig(config);
    }

    function test_setRateLimitConfigs_Revert_Unauthorized() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = _createConfig(ID_1, true, true, true, false, false, 1000, 1000, 1 days, 1 days);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                RATE_LIMITER_MANAGER_ROLE
            )
        );
        vm.prank(charlie);
        RateLimiterRBACUpgradeableMock(address(rateLimiter)).setRateLimitConfigs(configs);
    }

    function test_setRateLimitStates_Revert_Unauthorized() public {
        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = _createState(ID_1, 100, 100, uint40(block.timestamp));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                RATE_LIMITER_MANAGER_ROLE
            )
        );
        vm.prank(charlie);
        RateLimiterRBACUpgradeableMock(address(rateLimiter)).setRateLimitStates(states);
    }

    function test_setRateLimitAddressExemptions_Revert_Unauthorized() public {
        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory exemptions = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        exemptions[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: address(0x123), isExempt: true });
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                RATE_LIMITER_MANAGER_ROLE
            )
        );
        vm.prank(charlie);
        RateLimiterRBACUpgradeableMock(address(rateLimiter)).setRateLimitAddressExemptions(exemptions);
    }

    function test_checkpointRateLimits_Revert_Unauthorized() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = ID_1;
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                RATE_LIMITER_MANAGER_ROLE
            )
        );
        vm.prank(charlie);
        RateLimiterRBACUpgradeableMock(address(rateLimiter)).checkpointRateLimits(ids);
    }
}
