// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeHandler } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeHandler.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { FeeHandlerRBACUpgradeable } from "./../contracts/fee-accounting/FeeHandlerRBACUpgradeable.sol";
import { FeeHandlerBaseUpgradeableTest } from "./FeeHandlerBaseUpgradeable.t.sol";

contract FeeHandlerRBACUpgradeableHarness is FeeHandlerRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin, address _feeDeposit) public initializer {
        __FeeHandlerBase_init(_feeDeposit);
        __AccessControl2Step_init(_initialAdmin);
    }
}

contract FeeHandlerRBACUpgradeableTest is FeeHandlerBaseUpgradeableTest {
    address charlie = makeAddr("charlie");
    FeeHandlerRBACUpgradeableHarness feeHandlerRbac;

    function _deployFeeHandler() internal virtual override returns (IFeeHandler) {
        FeeHandlerRBACUpgradeableHarness impl = new FeeHandlerRBACUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeHandlerRBACUpgradeableHarness.initialize.selector, address(this), alice)
        );

        feeHandlerRbac = FeeHandlerRBACUpgradeableHarness(address(proxy));
        return IFeeHandler(address(proxy));
    }

    function test_setFeeDeposit_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                feeHandlerRbac.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(charlie);
        feeHandler.setFeeDeposit(bob);
    }
}
