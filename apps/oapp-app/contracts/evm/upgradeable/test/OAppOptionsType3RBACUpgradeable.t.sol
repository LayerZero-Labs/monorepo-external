// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppOptionsType3 } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm-impl/contracts/oapp/libs/OptionsBuilder.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OAppOptionsType3RBACUpgradeable } from "./../contracts/oapp/options-type-3/OAppOptionsType3RBACUpgradeable.sol";
import { OAppOptionsType3BaseUpgradeableTest } from "./OAppOptionsType3BaseUpgradeable.t.sol";

contract OAppOptionsType3RBACHarness is OAppOptionsType3RBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
    }
}

contract OAppOptionsType3RBACUpgradeableTest is OAppOptionsType3BaseUpgradeableTest {
    using OptionsBuilder for bytes;

    address alice = makeAddr("alice");

    function _createOApp() internal virtual override returns (IOAppOptionsType3) {
        OAppOptionsType3RBACHarness impl = new OAppOptionsType3RBACHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(OAppOptionsType3RBACHarness.initialize.selector, address(this))
        );
        return IOAppOptionsType3(address(proxy));
    }

    function setUp() public override {
        oapp = _createOApp();
    }

    // ============ initialize ============

    /// @dev Override since `OAppOptionsType3RBACHarness.initialize(address)` has a different signature.
    function test_initialize_Revert_AlreadyInitialized() public override {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        OAppOptionsType3RBACHarness(address(oapp)).initialize(alice);
    }

    // ============ setEnforcedOptions ============

    function test_setEnforcedOptions_Revert_Unauthorized() public {
        bytes memory sendOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(1, SEND, sendOptions);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                OAppOptionsType3RBACHarness(address(oapp)).DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        oapp.setEnforcedOptions(params);
    }
}
