// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { FeeConfigRBACUpgradeable } from "./../contracts/fee-config/FeeConfigRBACUpgradeable.sol";
import { FeeConfigBaseUpgradeableTest, IFeeConfigTestHelper } from "./FeeConfigBaseUpgradeable.t.sol";

contract FeeConfigRBACUpgradeableMock is FeeConfigRBACUpgradeable {
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

    function _deployFeeConfigHelper() internal virtual override returns (IFeeConfigTestHelper) {
        FeeConfigRBACUpgradeableMock impl = new FeeConfigRBACUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeConfigRBACUpgradeableMock.initialize.selector, address(this))
        );

        return IFeeConfigTestHelper(address(proxy));
    }

    function test_setDefaultFeeBps_Revert_Unauthorized() public {
        bytes32 feeConfigManagerRole = FeeConfigRBACUpgradeableMock(address(feeConfigHelper)).FEE_CONFIG_MANAGER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                feeConfigManagerRole
            )
        );
        vm.prank(alice);
        feeConfigHelper.setDefaultFeeBps(100);
    }

    function test_setFeeBps_Revert_Unauthorized() public {
        bytes32 feeConfigManagerRole = FeeConfigRBACUpgradeableMock(address(feeConfigHelper)).FEE_CONFIG_MANAGER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                feeConfigManagerRole
            )
        );
        vm.prank(alice);
        feeConfigHelper.setFeeBps(1, 100, true);
    }
}
