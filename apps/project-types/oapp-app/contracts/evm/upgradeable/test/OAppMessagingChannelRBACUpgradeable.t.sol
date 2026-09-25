// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-upgradeable-evm-contracts/contracts/access/AccessControl2StepUpgradeable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OAppMessagingChannelRBACUpgradeable } from "./../contracts/oapp/messaging-channel/OAppMessagingChannelRBACUpgradeable.sol";
import { OAppCoreBaseUpgradeable } from "./../contracts/oapp/OAppCoreBaseUpgradeable.sol";
import { OAppCoreRBACUpgradeable } from "./../contracts/oapp/OAppCoreRBACUpgradeable.sol";
import {
    OAppMessagingChannelBaseUpgradeableTest,
    OAppMessagingChannelBaseHarness
} from "./OAppMessagingChannelBaseUpgradeable.t.sol";

contract OAppMessagingChannelRBACHarness is OAppCoreRBACUpgradeable, OAppMessagingChannelRBACUpgradeable {
    constructor(address _endpoint) OAppCoreBaseUpgradeable(_endpoint) {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __OAppCoreBase_init(_initialAdmin);
        __AccessControl2Step_init(_initialAdmin);
    }

    function oAppVersion() public pure returns (uint64 senderVersion, uint64 receiverVersion) {
        return (1, 1);
    }

    function allowInitializePath(Origin calldata _origin) public view returns (bool isAllowed) {
        return peers(_origin.srcEid) == _origin.sender;
    }

    function acceptDefaultAdminTransfer()
        public
        virtual
        override(OAppCoreRBACUpgradeable, AccessControl2StepUpgradeable)
    {
        super.acceptDefaultAdminTransfer();
    }
}

contract OAppMessagingChannelRBACUpgradeableTest is OAppMessagingChannelBaseUpgradeableTest {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    OAppMessagingChannelRBACHarness oappRbac;

    function _deployOApp() internal virtual override returns (OAppMessagingChannelBaseHarness) {
        OAppMessagingChannelRBACHarness impl = new OAppMessagingChannelRBACHarness(address(endpoint));
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(OAppMessagingChannelRBACHarness.initialize.selector, address(this))
        );
        oappRbac = OAppMessagingChannelRBACHarness(address(proxy));
        return OAppMessagingChannelBaseHarness(address(proxy));
    }

    function setUp() public override {
        super.setUp();

        /// @dev Grant roles to this contract so inherited base tests can call the gated functions.
        oappRbac.grantRole(oappRbac.MESSAGING_CHANNEL_MANAGER_ROLE(), address(this));
        oappRbac.grantRole(oappRbac.MESSAGE_NILIFIER_ROLE(), address(this));
        oappRbac.grantRole(oappRbac.MESSAGING_CHANNEL_MANAGER_ROLE(), bob);
        oappRbac.grantRole(oappRbac.MESSAGE_NILIFIER_ROLE(), charlie);
    }

    // ============ clear ============

    function test_clear_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                oappRbac.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(alice);
        oapp.clear(_origin(1), GUID, MESSAGE);
    }

    function test_clear_Revert_NilifierUnauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                oappRbac.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(charlie);
        oapp.clear(_origin(1), GUID, MESSAGE);
    }

    // ============ skip ============

    function test_skip_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                oappRbac.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(alice);
        oapp.skip(SRC_EID, SENDER, 1);
    }

    // ============ burn ============

    function test_burn_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                oappRbac.MESSAGING_CHANNEL_MANAGER_ROLE()
            )
        );
        vm.prank(alice);
        oapp.burn(SRC_EID, SENDER, 1, PAYLOAD_HASH);
    }

    // ============ nilify ============

    function test_nilify_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                oappRbac.MESSAGE_NILIFIER_ROLE()
            )
        );
        vm.prank(alice);
        oapp.nilify(SRC_EID, SENDER, 1, PAYLOAD_HASH);
    }

    function test_nilify_Revert_ManagerUnauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                bob,
                oappRbac.MESSAGE_NILIFIER_ROLE()
            )
        );
        vm.prank(bob);
        oapp.nilify(SRC_EID, SENDER, 1, PAYLOAD_HASH);
    }
}
