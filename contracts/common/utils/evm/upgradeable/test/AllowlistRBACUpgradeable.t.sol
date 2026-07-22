// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IAllowlist.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { AllowlistRBACUpgradeable } from "./../contracts/allowlist/AllowlistRBACUpgradeable.sol";
import { AllowlistBaseUpgradeableTest, AllowlistBaseUpgradeableHarness } from "./AllowlistBaseUpgradeable.t.sol";

contract AllowlistRBACUpgradeableHarness is AllowlistRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(AllowlistMode _mode, address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
        __AllowlistBase_init(_mode);
    }

    function restrictedFunction() external view onlyAllowlisted(msg.sender) returns (bool) {
        return true;
    }
}

contract AllowlistRBACUpgradeableTest is AllowlistBaseUpgradeableTest {
    address dave = makeAddr("dave");
    AllowlistRBACUpgradeableHarness allowlistRbac;

    function _deployAllowlist(
        IAllowlist.AllowlistMode _mode
    ) internal virtual override returns (AllowlistBaseUpgradeableHarness) {
        AllowlistRBACUpgradeableHarness impl = new AllowlistRBACUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AllowlistRBACUpgradeableHarness.initialize.selector, _mode, address(this))
        );
        AllowlistRBACUpgradeableHarness rbac = AllowlistRBACUpgradeableHarness(address(proxy));
        rbac.grantRole(rbac.WHITELISTER_ROLE(), address(this));
        rbac.grantRole(rbac.BLACKLISTER_ROLE(), address(this));
        return AllowlistBaseUpgradeableHarness(address(proxy));
    }

    function setUp() public override {
        super.setUp();
        allowlistRbac = AllowlistRBACUpgradeableHarness(address(allowlist));
    }

    function test_setAllowlistMode_Revert_Unauthorized() public virtual {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                allowlistRbac.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(dave);
        allowlistRbac.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
    }

    function test_setWhitelisted_Revert_Unauthorized() public virtual {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam({ user: alice, isEnabled: true });
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                allowlistRbac.WHITELISTER_ROLE()
            )
        );
        vm.prank(dave);
        allowlistRbac.setWhitelisted(params);
    }

    function test_setBlacklisted_Revert_Unauthorized() public virtual {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam({ user: alice, isEnabled: true });
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                allowlistRbac.BLACKLISTER_ROLE()
            )
        );
        vm.prank(dave);
        allowlistRbac.setBlacklisted(params);
    }
}
