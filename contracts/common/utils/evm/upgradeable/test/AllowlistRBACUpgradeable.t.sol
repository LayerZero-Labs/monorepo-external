// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { AllowlistRBACUpgradeable } from "./../contracts/allowlist/AllowlistRBACUpgradeable.sol";
import { AllowlistBaseUpgradeableTest, IAllowlistMock } from "./AllowlistBaseUpgradeable.t.sol";

contract AllowlistRBACUpgradeableMock is AllowlistRBACUpgradeable {
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

    function _createAllowlist(IAllowlist.AllowlistMode _mode) internal virtual override returns (IAllowlistMock) {
        AllowlistRBACUpgradeableMock impl = new AllowlistRBACUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AllowlistRBACUpgradeableMock.initialize.selector, _mode, address(this))
        );
        AllowlistRBACUpgradeableMock _allowlist = AllowlistRBACUpgradeableMock(address(proxy));
        _allowlist.grantRole(_allowlist.WHITELISTER_ROLE(), address(this));
        _allowlist.grantRole(_allowlist.BLACKLISTER_ROLE(), address(this));
        return IAllowlistMock(address(proxy));
    }

    function setUp() public override {
        allowlist = _createAllowlist(IAllowlist.AllowlistMode.Open);
    }

    function test_setAllowlistMode_Revert_Unauthorized() public virtual {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                AllowlistRBACUpgradeableMock(address(allowlist)).DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(dave);
        AllowlistRBACUpgradeableMock(address(allowlist)).setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
    }

    function test_setWhitelisted_Revert_Unauthorized() public virtual {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam({ user: alice, isEnabled: true });
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                AllowlistRBACUpgradeableMock(address(allowlist)).WHITELISTER_ROLE()
            )
        );
        vm.prank(dave);
        AllowlistRBACUpgradeableMock(address(allowlist)).setWhitelisted(params);
    }

    function test_setBlacklisted_Revert_Unauthorized() public virtual {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam({ user: alice, isEnabled: true });
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                dave,
                AllowlistRBACUpgradeableMock(address(allowlist)).BLACKLISTER_ROLE()
            )
        );
        vm.prank(dave);
        AllowlistRBACUpgradeableMock(address(allowlist)).setBlacklisted(params);
    }
}
