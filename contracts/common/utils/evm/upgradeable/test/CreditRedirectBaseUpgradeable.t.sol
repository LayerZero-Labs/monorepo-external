// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { ICreditRedirectAllowlist } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirectAllowlist.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { CreditRedirectBaseUpgradeable } from "./../contracts/credit-redirect/CreditRedirectBaseUpgradeable.sol";

contract CreditRedirectAllowlistMock is ICreditRedirectAllowlist {
    mapping(address user => bool isAllowlisted) public allowlisted;

    function setAllowlisted(address _user, bool _isAllowlisted) public {
        allowlisted[_user] = _isAllowlisted;
    }

    function isAllowlisted(address _user) public view returns (bool isUserAllowlisted) {
        return allowlisted[_user];
    }
}

contract CreditRedirectBaseUpgradeableHarness is CreditRedirectBaseUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __CreditRedirectBase_init();
    }

    function setCreditRedirectConfig(ICreditRedirect.CreditRedirectConfig calldata _config) public {
        _setCreditRedirectConfig(_config);
    }

    function isAllowlisted(address _user) public view returns (bool isUserAllowlisted) {
        return _isAllowlisted(_user);
    }

    function redirectCredit(address _to, uint256 _amountLD) public returns (address recipient) {
        return _redirectCredit(_to, _amountLD);
    }
}

contract CreditRedirectBaseUpgradeableTest is Test {
    CreditRedirectBaseUpgradeableHarness public creditRedirect;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function _deployCreditRedirect() internal virtual returns (CreditRedirectBaseUpgradeableHarness) {
        CreditRedirectBaseUpgradeableHarness impl = new CreditRedirectBaseUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(CreditRedirectBaseUpgradeableHarness.initialize.selector)
        );

        return CreditRedirectBaseUpgradeableHarness(address(proxy));
    }

    function setUp() public virtual {
        creditRedirect = _deployCreditRedirect();
    }

    function test_initialize() public view {
        ICreditRedirect.CreditRedirectConfig memory config = creditRedirect.creditRedirectConfig();
        assertEq(config.allowlist, address(0));
        assertEq(config.escrow, address(0));
    }

    function test_setCreditRedirectConfig_Set() public {
        ICreditRedirect.CreditRedirectConfig memory config = ICreditRedirect.CreditRedirectConfig({
            allowlist: bob,
            escrow: alice
        });

        vm.expectEmit(true, true, true, true, address(creditRedirect));
        emit ICreditRedirect.CreditRedirectConfigSet(config);
        creditRedirect.setCreditRedirectConfig(config);

        ICreditRedirect.CreditRedirectConfig memory stored = creditRedirect.creditRedirectConfig();
        assertEq(stored.allowlist, bob);
        assertEq(stored.escrow, alice);
    }

    function test_setCreditRedirectConfig_Unset() public {
        creditRedirect.setCreditRedirectConfig(ICreditRedirect.CreditRedirectConfig({ allowlist: bob, escrow: alice }));

        ICreditRedirect.CreditRedirectConfig memory config = ICreditRedirect.CreditRedirectConfig({
            allowlist: address(0),
            escrow: address(0)
        });

        vm.expectEmit(true, true, true, true, address(creditRedirect));
        emit ICreditRedirect.CreditRedirectConfigSet(config);
        creditRedirect.setCreditRedirectConfig(config);

        ICreditRedirect.CreditRedirectConfig memory stored = creditRedirect.creditRedirectConfig();
        assertEq(stored.allowlist, address(0));
        assertEq(stored.escrow, address(0));
    }

    function test_setCreditRedirectConfig_Fuzz(address _allowlist, address _escrow) public {
        vm.assume((_allowlist == address(0)) == (_escrow == address(0)));

        creditRedirect.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: _allowlist, escrow: _escrow })
        );

        ICreditRedirect.CreditRedirectConfig memory stored = creditRedirect.creditRedirectConfig();
        assertEq(stored.allowlist, _allowlist);
        assertEq(stored.escrow, _escrow);
    }

    function test_setCreditRedirectConfig_Revert_AllowlistOnly() public {
        vm.expectRevert(ICreditRedirect.InvalidCreditRedirectConfig.selector);
        creditRedirect.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: bob, escrow: address(0) })
        );
    }

    function test_setCreditRedirectConfig_Revert_EscrowOnly() public {
        vm.expectRevert(ICreditRedirect.InvalidCreditRedirectConfig.selector);
        creditRedirect.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(0), escrow: alice })
        );
    }

    function test_isAllowlisted_NoAllowlist() public view {
        assertTrue(creditRedirect.isAllowlisted(alice));
        assertTrue(creditRedirect.isAllowlisted(bob));
    }

    function test_isAllowlisted_DelegatesToAllowlist() public {
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        allowlist.setAllowlisted(alice, true);
        creditRedirect.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: bob })
        );

        assertTrue(creditRedirect.isAllowlisted(alice));
        assertFalse(creditRedirect.isAllowlisted(bob));
    }

    function test_redirectCredit_Disabled() public {
        assertEq(creditRedirect.redirectCredit(bob, 1 ether), bob);
    }

    function test_redirectCredit_Allowlisted() public {
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        allowlist.setAllowlisted(bob, true);
        creditRedirect.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: alice })
        );

        assertEq(creditRedirect.redirectCredit(bob, 1 ether), bob);
    }

    function test_redirectCredit_NotAllowlisted() public {
        CreditRedirectAllowlistMock allowlist = new CreditRedirectAllowlistMock();
        creditRedirect.setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({ allowlist: address(allowlist), escrow: alice })
        );

        vm.expectEmit(true, true, true, true, address(creditRedirect));
        emit ICreditRedirect.CreditRedirected(bob, alice, 1 ether);
        assertEq(creditRedirect.redirectCredit(bob, 1 ether), alice);
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.creditredirect")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xb868bd7fc06fef88c81262b11fe9b85cff6f00e2736baf361fa258c33ba8cd00);
    }
}
