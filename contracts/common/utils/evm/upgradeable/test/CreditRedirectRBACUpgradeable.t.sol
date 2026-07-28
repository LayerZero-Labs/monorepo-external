// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { CreditRedirectRBACUpgradeable } from "./../contracts/credit-redirect/CreditRedirectRBACUpgradeable.sol";
import {
    CreditRedirectBaseUpgradeableTest,
    CreditRedirectBaseUpgradeableHarness
} from "./CreditRedirectBaseUpgradeable.t.sol";

contract CreditRedirectRBACUpgradeableHarness is CreditRedirectRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
        __CreditRedirectBase_init();
    }

    function isAllowlisted(address _user) public view returns (bool isUserAllowlisted) {
        return _isAllowlisted(_user);
    }

    function redirectCredit(address _to, uint256 _amountLD) public returns (address recipient) {
        return _redirectCredit(_to, _amountLD);
    }
}

contract CreditRedirectRBACUpgradeableTest is CreditRedirectBaseUpgradeableTest {
    address charlie = makeAddr("charlie");
    CreditRedirectRBACUpgradeableHarness creditRedirectRbac;

    function _deployCreditRedirect() internal virtual override returns (CreditRedirectBaseUpgradeableHarness) {
        CreditRedirectRBACUpgradeableHarness impl = new CreditRedirectRBACUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(CreditRedirectRBACUpgradeableHarness.initialize.selector, address(this))
        );

        return CreditRedirectBaseUpgradeableHarness(address(proxy));
    }

    function setUp() public override {
        super.setUp();
        creditRedirectRbac = CreditRedirectRBACUpgradeableHarness(address(creditRedirect));
    }

    function test_setCreditRedirectConfig_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                creditRedirectRbac.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(charlie);
        creditRedirect.setCreditRedirectConfig(ICreditRedirect.CreditRedirectConfig({ allowlist: bob, escrow: alice }));
    }
}
