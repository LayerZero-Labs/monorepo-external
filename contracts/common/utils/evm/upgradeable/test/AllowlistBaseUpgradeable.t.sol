// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { AllowlistBaseUpgradeable } from "./../contracts/allowlist/AllowlistBaseUpgradeable.sol";

interface IAllowlistMock is IAllowlist {
    function setAllowlistMode(AllowlistMode _mode) external;
    function setWhitelisted(SetAllowlistParam[] calldata _params) external;
    function setBlacklisted(SetAllowlistParam[] calldata _params) external;
    function restrictedFunction() external view returns (bool);
}

contract AllowlistBaseUpgradeableMock is AllowlistBaseUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(AllowlistMode _mode) public initializer {
        __AllowlistBase_init(_mode);
    }

    function setAllowlistMode(AllowlistMode _mode) public {
        _setAllowlistMode(_mode);
    }

    function setWhitelisted(IAllowlist.SetAllowlistParam[] calldata _params) public {
        _setWhitelisted(_params);
    }

    function setBlacklisted(IAllowlist.SetAllowlistParam[] calldata _params) public {
        _setBlacklisted(_params);
    }

    function restrictedFunction() external view onlyAllowlisted(msg.sender) returns (bool) {
        return true;
    }
}

contract AllowlistBaseUpgradeableTest is Test {
    IAllowlistMock allowlist;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");

    function _createAllowlist(IAllowlist.AllowlistMode _mode) internal virtual returns (IAllowlistMock) {
        AllowlistBaseUpgradeableMock impl = new AllowlistBaseUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AllowlistBaseUpgradeableMock.initialize.selector, _mode)
        );
        return IAllowlistMock(address(proxy));
    }

    function setUp() public virtual {
        allowlist = _createAllowlist(IAllowlist.AllowlistMode.Open);
    }

    // ============ Initial State Tests ============

    function test_constructor_InitialMode() public view {
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Open));
    }

    function test_constructor_InitializeWhitelist() public {
        IAllowlistMock al = _createAllowlist(IAllowlist.AllowlistMode.Whitelist);
        assertEq(uint256(al.allowlistMode()), uint256(IAllowlist.AllowlistMode.Whitelist));
    }

    // ============ Open Mode Tests ============

    function test_isAllowlisted_Open_AllAllowed() public view {
        assertTrue(allowlist.isAllowlisted(alice));
        assertTrue(allowlist.isAllowlisted(bob));
        assertTrue(allowlist.isAllowlisted(charlie));
    }

    function test_onlyAllowlisted_Open_AllAllowed() public {
        vm.prank(alice);
        assertTrue(allowlist.restrictedFunction());

        vm.prank(bob);
        assertTrue(allowlist.restrictedFunction());
    }

    // ============ Blacklist Mode Tests ============

    function test_setMode_Blacklist() public {
        vm.expectEmit(true, true, true, true);
        emit IAllowlist.AllowlistModeUpdated(IAllowlist.AllowlistMode.Blacklist);
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Blacklist));
    }

    function test_isAllowlisted_Blacklist_NotBlacklisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        assertTrue(allowlist.isAllowlisted(alice));
    }

    function test_isAllowlisted_Blacklist_Blacklisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);

        vm.expectEmit(true, true, true, true);
        emit IAllowlist.BlacklistUpdated(alice, true);
        allowlist.setBlacklisted(params);

        assertFalse(allowlist.isAllowlisted(alice));
        assertTrue(allowlist.isBlacklisted(alice));
        assertTrue(allowlist.isAllowlisted(bob));
    }

    function test_onlyAllowlisted_Blacklist_RevertIfBlacklisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setBlacklisted(params);

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Blacklist)
        );
        allowlist.restrictedFunction();
        vm.stopPrank();

        vm.prank(bob);
        assertTrue(allowlist.restrictedFunction());
    }

    function test_setBlacklisted_RemoveFromBlacklist() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setBlacklisted(params);
        assertFalse(allowlist.isAllowlisted(alice));

        vm.expectEmit(true, true, true, true);
        emit IAllowlist.BlacklistUpdated(alice, false);
        params[0] = IAllowlist.SetAllowlistParam(alice, false);
        allowlist.setBlacklisted(params);

        assertTrue(allowlist.isAllowlisted(alice));
        assertFalse(allowlist.isBlacklisted(alice));
    }

    function test_setBlacklisted_MultipleUsers() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](2);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        params[1] = IAllowlist.SetAllowlistParam(bob, true);
        allowlist.setBlacklisted(params);

        assertFalse(allowlist.isAllowlisted(alice));
        assertFalse(allowlist.isAllowlisted(bob));
        assertTrue(allowlist.isBlacklisted(alice));
        assertTrue(allowlist.isBlacklisted(bob));
    }

    // ============ Whitelist Mode Tests ============

    function test_setMode_Whitelist() public {
        vm.expectEmit(true, true, true, true);
        emit IAllowlist.AllowlistModeUpdated(IAllowlist.AllowlistMode.Whitelist);
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Whitelist));
    }

    function test_isAllowlisted_Whitelist_NotWhitelisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
        assertFalse(allowlist.isAllowlisted(alice));
    }

    function test_isAllowlisted_Whitelist_Whitelisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);

        vm.expectEmit(true, true, true, true);
        emit IAllowlist.WhitelistUpdated(alice, true);
        allowlist.setWhitelisted(params);

        assertTrue(allowlist.isAllowlisted(alice));
        assertTrue(allowlist.isWhitelisted(alice));
        assertFalse(allowlist.isAllowlisted(bob));
    }

    function test_onlyAllowlisted_Whitelist_RevertIfNotWhitelisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Whitelist)
        );
        allowlist.restrictedFunction();
        vm.stopPrank();

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setWhitelisted(params);

        vm.prank(alice);
        assertTrue(allowlist.restrictedFunction());
    }

    function test_setWhitelisted_RemoveFromWhitelist() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setWhitelisted(params);
        assertTrue(allowlist.isAllowlisted(alice));

        vm.expectEmit(true, true, true, true);
        emit IAllowlist.WhitelistUpdated(alice, false);
        params[0] = IAllowlist.SetAllowlistParam(alice, false);
        allowlist.setWhitelisted(params);

        assertFalse(allowlist.isAllowlisted(alice));
        assertFalse(allowlist.isWhitelisted(alice));
    }

    function test_setWhitelisted_MultipleUsers() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](2);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        params[1] = IAllowlist.SetAllowlistParam(bob, true);
        allowlist.setWhitelisted(params);

        assertTrue(allowlist.isAllowlisted(alice));
        assertTrue(allowlist.isAllowlisted(bob));
        assertTrue(allowlist.isWhitelisted(alice));
        assertTrue(allowlist.isWhitelisted(bob));
    }

    // ============ Integration & Edge Tests ============

    function test_SwitchModes_PreservesState() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
        IAllowlist.SetAllowlistParam[] memory aParams = new IAllowlist.SetAllowlistParam[](1);
        aParams[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setWhitelisted(aParams);
        assertTrue(allowlist.isAllowlisted(alice));

        IAllowlist.SetAllowlistParam[] memory bParams = new IAllowlist.SetAllowlistParam[](1);
        bParams[0] = IAllowlist.SetAllowlistParam(bob, true);
        allowlist.setBlacklisted(bParams);

        // `bob` is not allowlisted in Whitelist mode because he is not whitelisted.
        assertFalse(allowlist.isAllowlisted(bob));

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        assertTrue(allowlist.isAllowlisted(alice));
        assertFalse(allowlist.isAllowlisted(bob));

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Open);

        assertTrue(allowlist.isAllowlisted(alice));
        assertTrue(allowlist.isAllowlisted(bob));
    }

    function test_setWhitelisted_EmptyArray() public {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](0);
        allowlist.setWhitelisted(params);
    }

    function test_setBlacklisted_EmptyArray() public {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](0);
        allowlist.setBlacklisted(params);
    }

    function test_setMode_MultipleChanges() public {
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Open));

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Blacklist));

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Whitelist));

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Blacklist));

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Open);
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Open));
    }

    function test_setMode_RevertSameMode() public {
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Open));
        vm.expectRevert(abi.encodeWithSelector(IAllowlist.ModeAlreadySet.selector, IAllowlist.AllowlistMode.Open));
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Open);

        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        assertEq(uint256(allowlist.allowlistMode()), uint256(IAllowlist.AllowlistMode.Blacklist));

        vm.expectRevert(abi.encodeWithSelector(IAllowlist.ModeAlreadySet.selector, IAllowlist.AllowlistMode.Blacklist));
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
    }

    function test_setWhitelisted_Revert_AlreadyWhitelisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setWhitelisted(params);
        assertTrue(allowlist.isWhitelisted(alice));
        assertEq(allowlist.whitelistedCount(), 1);

        vm.expectRevert(abi.encodeWithSelector(IAllowlist.AllowlistStateIdempotent.selector, alice, true));
        allowlist.setWhitelisted(params);

        assertEq(allowlist.whitelistedCount(), 1);
    }

    function test_setBlacklisted_Revert_AlreadyBlacklisted() public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        allowlist.setBlacklisted(params);
        assertTrue(allowlist.isBlacklisted(alice));
        assertEq(allowlist.blacklistedCount(), 1);

        vm.expectRevert(abi.encodeWithSelector(IAllowlist.AllowlistStateIdempotent.selector, alice, true));
        allowlist.setBlacklisted(params);

        assertEq(allowlist.blacklistedCount(), 1);
    }

    // ============ Fuzz Tests ============

    function test_isAllowlisted_Fuzz_Open(address _user) public view {
        assertTrue(allowlist.isAllowlisted(_user));
    }

    function test_isAllowlisted_Fuzz_Blacklist_NotBlacklisted(address _user) public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        assertTrue(allowlist.isAllowlisted(_user));
    }

    function test_isAllowlisted_Fuzz_Blacklist_Blacklisted(address _user) public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(_user, true);
        allowlist.setBlacklisted(params);
        assertFalse(allowlist.isAllowlisted(_user));
    }

    function test_isAllowlisted_Fuzz_Whitelist_NotWhitelisted(address _user) public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
        assertFalse(allowlist.isAllowlisted(_user));
    }

    function test_isAllowlisted_Fuzz_Whitelist_Whitelisted(address _user) public {
        allowlist.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(_user, true);
        allowlist.setWhitelisted(params);
        assertTrue(allowlist.isAllowlisted(_user));
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.allowlist")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xa9f917c522fb3fd8673bbc655e92a5c1f1ee3df7bf7ad06a1821b937d0205e00);
    }
}
