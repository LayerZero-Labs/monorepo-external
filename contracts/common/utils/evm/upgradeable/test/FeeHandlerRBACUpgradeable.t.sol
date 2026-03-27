// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { FeeHandlerRBACUpgradeable } from "./../contracts/fee-accounting/FeeHandlerRBACUpgradeable.sol";
import { FeeHandlerBaseUpgradeableTestCommon, IFeeHandlerTestHelper } from "./FeeHandlerBaseUpgradeable.t.sol";

contract FeeHandlerRBACUpgradeableMock is FeeHandlerRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin, address _feeDeposit) public initializer {
        __FeeHandlerBase_init(_feeDeposit);
        __AccessControl2Step_init(_initialAdmin);
    }
}

contract FeeHandlerRBACUpgradeableTest is FeeHandlerBaseUpgradeableTestCommon {
    address charlie = makeAddr("charlie");

    function _deployFeeHandlerHelper() internal virtual override returns (IFeeHandlerTestHelper) {
        FeeHandlerRBACUpgradeableMock impl = new FeeHandlerRBACUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeHandlerRBACUpgradeableMock.initialize.selector, address(this), alice)
        );

        return IFeeHandlerTestHelper(address(proxy));
    }

    function test_setFeeDeposit_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                FeeHandlerRBACUpgradeableMock(address(feeHandlerHelper)).DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(charlie);
        feeHandlerHelper.setFeeDeposit(bob);
    }
}
