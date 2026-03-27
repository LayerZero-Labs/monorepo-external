// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { INexusModule } from "./../../contracts/interfaces/INexusModule.sol";
import { ITokenScales } from "./../../contracts/interfaces/ITokenScales.sol";
import { NexusTestHelper } from "./../shared/NexusTestHelper.sol";

contract NexusRateLimiterModuleTest is NexusTestHelper {
    uint256 constant SCALE_DENOMINATOR = 1e18;
    bytes32 constant RATE_LIMITER_MANAGER_ROLE = keccak256("RATE_LIMITER_MANAGER_ROLE");

    // ============ Setter Authentication Tests ============

    function test_outflow_Revert_OnlyNexus() public {
        vm.prank(alice);
        vm.expectRevert(INexusModule.OnlyNexus.selector);
        aRateLimiterModule.outflow(0, alice, 1 ether);
    }

    function test_inflow_Revert_OnlyNexus() public {
        vm.prank(alice);
        vm.expectRevert(INexusModule.OnlyNexus.selector);
        aRateLimiterModule.inflow(0, alice, 1 ether);
    }

    function test_setRateLimitConfigs_Revert_UnauthorizedRole() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: 1,
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: 100 ether,
                inboundLimit: 100 ether,
                outboundWindow: 100,
                inboundWindow: 100
            })
        });

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, RATE_LIMITER_MANAGER_ROLE, alice)
        );
        vm.prank(alice);
        aRateLimiterModule.setRateLimitConfigs(configs);
    }

    function test_setRateLimitGlobalConfig_Revert_UnauthorizedRole() public {
        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, RATE_LIMITER_MANAGER_ROLE, alice)
        );
        vm.prank(alice);
        aRateLimiterModule.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );
    }

    function test_setRateLimitStates_Revert_UnauthorizedRole() public {
        IRateLimiter.SetRateLimitStateParam[] memory params = new IRateLimiter.SetRateLimitStateParam[](1);
        params[0] = IRateLimiter.SetRateLimitStateParam({ id: 1, state: IRateLimiter.RateLimitState(0, 0, 0) });

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, RATE_LIMITER_MANAGER_ROLE, alice)
        );
        vm.prank(alice);
        aRateLimiterModule.setRateLimitStates(params);
    }

    function test_setRateLimitAddressExemptions_Revert_UnauthorizedRole() public {
        IRateLimiter.SetRateLimitAddressExemptionParam[]
            memory params = new IRateLimiter.SetRateLimitAddressExemptionParam[](1);
        params[0] = IRateLimiter.SetRateLimitAddressExemptionParam({ user: alice, isExempt: true });

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, RATE_LIMITER_MANAGER_ROLE, alice)
        );
        vm.prank(alice);
        aRateLimiterModule.setRateLimitAddressExemptions(params);
    }

    function test_checkpointRateLimits_Revert_UnauthorizedRole() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, RATE_LIMITER_MANAGER_ROLE, alice)
        );
        vm.prank(alice);
        aRateLimiterModule.checkpointRateLimits(ids);
    }

    function test_setScales_Revert_UnauthorizedRole() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: TOKEN_ID, scale: 1e18, enabled: true });

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, RATE_LIMITER_MANAGER_ROLE, alice)
        );
        vm.prank(alice);
        aRateLimiterModule.setScales(params);
    }

    // ============ getOutboundAvailable Tests ============

    function test_getOutboundAvailable_ScaleEnabled() public {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether + 1, 1 days);
        _setupScales(aRateLimiterModule, TOKEN_ID, 2e18);

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(available, 50 ether);
    }

    function test_getOutboundAvailable_Fuzz_ScaleEnabled(uint96 _limit, uint128 _scale) public {
        _scale = uint128(bound(_scale, 1, type(uint128).max));
        _setupRateLimits(aRateLimiterModule, bEid, _limit, 1 days);
        _setupScales(aRateLimiterModule, TOKEN_ID, _scale);

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        uint256 expected = Math.mulDiv(uint256(_limit), SCALE_DENOMINATOR, _scale, Math.Rounding.Floor);
        assertEq(available, expected);
    }

    function test_getOutboundAvailable_ScaleDisabled() public {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether + 1, 1 days);

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(available, 100 ether + 1);
    }

    function test_getOutboundAvailable_ScaleZero() public {
        _setupRateLimits(aRateLimiterModule, bEid, 100 ether + 1, 1 days);
        _setupScales(aRateLimiterModule, TOKEN_ID, 0);

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(available, type(uint256).max);
    }

    function test_getOutboundAvailable_ZeroScaleAndRateLimitCapacity() public {
        _setupRateLimits(aRateLimiterModule, bEid, 0, 1 days);
        _setupScales(aRateLimiterModule, TOKEN_ID, 0);

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(available, type(uint256).max);
    }

    function test_getOutboundAvailable_RateLimiterGloballyDisabled() public {
        _setupScales(aRateLimiterModule, TOKEN_ID, 2e18);
        aRateLimiterModule.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );

        uint256 available = aRateLimiterModule.getOutboundAvailable(aNexus.getNexusId(TOKEN_ID, bEid));
        assertEq(available, type(uint256).max);
    }
}
