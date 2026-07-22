// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeConfig } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeConfig.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { FeeConfigRBACUpgradeable } from "./../contracts/fee-config/FeeConfigRBACUpgradeable.sol";
import { FeeConfigBaseUpgradeableTest } from "./FeeConfigBaseUpgradeable.t.sol";

contract FeeConfigRBACUpgradeableHarness is FeeConfigRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
        _grantRole(FEE_CONFIG_MANAGER_ROLE, _initialAdmin);
    }
}

contract FeeConfigRBACUpgradeableTest is FeeConfigBaseUpgradeableTest {
    address alice = makeAddr("alice");
    FeeConfigRBACUpgradeableHarness feeConfigRbac;

    function _deployFeeConfig() internal virtual override returns (IFeeConfig) {
        FeeConfigRBACUpgradeableHarness impl = new FeeConfigRBACUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeConfigRBACUpgradeableHarness.initialize.selector, address(this))
        );

        feeConfigRbac = FeeConfigRBACUpgradeableHarness(address(proxy));
        return IFeeConfig(address(proxy));
    }

    function test_setDefaultFeeBps_Revert_Unauthorized() public {
        bytes32 feeConfigManagerRole = feeConfigRbac.FEE_CONFIG_MANAGER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                feeConfigManagerRole
            )
        );
        vm.prank(alice);
        feeConfig.setDefaultFeeBps(100);
    }

    function test_setFeeBps_Revert_Unauthorized() public {
        bytes32 feeConfigManagerRole = feeConfigRbac.FEE_CONFIG_MANAGER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                feeConfigManagerRole
            )
        );
        vm.prank(alice);
        feeConfig.setFeeBps(1, 100, true);
    }
}
