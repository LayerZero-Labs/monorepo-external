// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { EndpointV2Mock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OAppCoreBaseUpgradeable } from "./../contracts/oapp/OAppCoreBaseUpgradeable.sol";
import { OAppCoreRBACUpgradeable } from "./../contracts/oapp/OAppCoreRBACUpgradeable.sol";

contract OAppCoreRBACHarness is OAppCoreRBACUpgradeable {
    constructor(address _endpoint) OAppCoreBaseUpgradeable(_endpoint) {}

    function initialize(address _initialAdmin) public initializer {
        __OAppCoreBase_init(_initialAdmin);
        __AccessControl2Step_init(_initialAdmin);
    }

    function oAppVersion() public pure returns (uint64 senderVersion, uint64 receiverVersion) {
        return (1, 1);
    }
}

contract OAppCoreRBACUpgradeableTest is TestHelperOz5 {
    OAppCoreRBACHarness oapp;
    EndpointV2Mock endpoint;

    address owner;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address proxyAdmin;

    function setUp() public override {
        owner = address(this);
        setUpEndpoints(2, LibraryType.SimpleMessageLib);
        endpoint = endpointSetup.endpointList[0];
        OAppCoreRBACHarness impl = new OAppCoreRBACHarness(address(endpoint));

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        oapp = OAppCoreRBACHarness(
            address(
                new TransparentUpgradeableProxy(
                    address(impl),
                    address(this),
                    abi.encodeWithSelector(OAppCoreRBACHarness.initialize.selector, owner)
                )
            )
        );
    }

    // ============ initialize ============

    function test_initialize_SetsDelegate() public view {
        assertEq(endpoint.delegates(address(oapp)), owner);
    }

    // ============ setDelegate ============

    function test_setDelegate_Revert_CannotDirectlySetDelegate_Admin() public {
        vm.expectRevert(OAppCoreRBACUpgradeable.CannotDirectlySetDelegate.selector);
        oapp.setDelegate(alice);
    }

    function test_setDelegate_Revert_CannotDirectlySetDelegate_NonAdmin() public {
        vm.expectRevert(OAppCoreRBACUpgradeable.CannotDirectlySetDelegate.selector);
        vm.prank(alice);
        oapp.setDelegate(alice);
    }

    // ============ acceptDefaultAdminTransfer ============

    function test_acceptDefaultAdminTransfer() public {
        oapp.beginDefaultAdminTransfer(alice);

        vm.prank(alice);
        oapp.acceptDefaultAdminTransfer();

        assertEq(endpoint.delegates(address(oapp)), alice);
        assertTrue(oapp.hasRole(oapp.DEFAULT_ADMIN_ROLE(), alice));
        assertFalse(oapp.hasRole(oapp.DEFAULT_ADMIN_ROLE(), owner));
    }

    function test_acceptDefaultAdminTransfer_ChainedTransfers() public {
        oapp.beginDefaultAdminTransfer(alice);
        vm.prank(alice);
        oapp.acceptDefaultAdminTransfer();

        assertEq(endpoint.delegates(address(oapp)), alice);

        vm.prank(alice);
        oapp.beginDefaultAdminTransfer(bob);
        vm.prank(bob);
        oapp.acceptDefaultAdminTransfer();

        assertEq(endpoint.delegates(address(oapp)), bob);
        assertTrue(oapp.hasRole(oapp.DEFAULT_ADMIN_ROLE(), bob));
        assertFalse(oapp.hasRole(oapp.DEFAULT_ADMIN_ROLE(), alice));
    }

    function test_acceptDefaultAdminTransfer_Fuzz(address _newAdmin) public {
        vm.assume(_newAdmin != address(0));
        vm.assume(_newAdmin != proxyAdmin);
        vm.assume(_newAdmin != owner);

        oapp.beginDefaultAdminTransfer(_newAdmin);

        vm.prank(_newAdmin);
        oapp.acceptDefaultAdminTransfer();

        assertEq(endpoint.delegates(address(oapp)), _newAdmin);
        assertTrue(oapp.hasRole(oapp.DEFAULT_ADMIN_ROLE(), _newAdmin));
        assertFalse(oapp.hasRole(oapp.DEFAULT_ADMIN_ROLE(), owner));
    }
}
