// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OFTRegistryRBACUpgradeable } from "./../contracts/extensions/OFTRegistryRBACUpgradeable.sol";
import { IOFTRegistry } from "./../contracts/interfaces/IOFTRegistry.sol";
import { NexusOFT } from "./../contracts/NexusOFT.sol";
import { OFTRegistryBaseUpgradeableTest, OFTRegistryBaseUpgradeableHarness } from "./OFTRegistryBaseUpgradeable.t.sol";

contract OFTRegistryRBACUpgradeableHarness is OFTRegistryRBACUpgradeable {
    constructor(uint8 _localDecimals) OFTRegistryRBACUpgradeable(_localDecimals) {
        _disableInitializers();
    }

    function initialize(address _admin) public initializer {
        __AccessControl2Step_init(_admin);
        _grantRole(TOKEN_REGISTRAR_ROLE, _admin);
    }

    function getAndAssertTokenId(address _oftAddress) public view returns (uint32) {
        return _getAndAssertTokenId(_oftAddress);
    }

    function getAndAssertBurnerMinterAddress(uint32 _tokenId) public view returns (address) {
        return _getAndAssertBurnerMinterAddress(_tokenId);
    }

    function getAndAssertOFTAddress(uint32 _tokenId) public view returns (address) {
        return _getAndAssertOFTAddress(_tokenId);
    }
}

contract OFTRegistryRBACUpgradeableTest is OFTRegistryBaseUpgradeableTest {
    address alice = makeAddr("alice");
    OFTRegistryRBACUpgradeableHarness registryRbac;

    function _deployRegistry() internal virtual override returns (OFTRegistryBaseUpgradeableHarness) {
        OFTRegistryRBACUpgradeableHarness impl = new OFTRegistryRBACUpgradeableHarness(LOCAL_DECIMALS);
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(OFTRegistryRBACUpgradeableHarness.initialize.selector, address(this))
        );
        registryRbac = OFTRegistryRBACUpgradeableHarness(address(proxy));
        return OFTRegistryBaseUpgradeableHarness(address(proxy));
    }

    // ============ Initialization Tests ============

    function test_localDecimals() public view override {
        assertEq(registry.localDecimals(), LOCAL_DECIMALS);
    }

    function test_sharedDecimals() public view override {
        assertEq(registry.sharedDecimals(), SHARED_DECIMALS);
    }

    function test_decimalConversionRate() public view override {
        assertEq(registry.decimalConversionRate(), 10 ** (LOCAL_DECIMALS - SHARED_DECIMALS));
    }

    // ============ Registration Tests ============

    function test_registerToken_Success_AsAdmin() public {
        vm.expectEmit(true, true, true, true);
        emit IOFTRegistry.TokenRegistered(TOKEN_ID_1, address(oft1), address(token1), address(token1));
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(oft1));
    }

    function test_registerToken_Success_AfterRoleGrant() public {
        address newRegistrar = address(0x400);

        registryRbac.grantRole(registryRbac.TOKEN_REGISTRAR_ROLE(), newRegistrar);

        vm.prank(newRegistrar);
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
    }

    function test_registerToken_Revert_Unauthorized() public {
        bytes32 tokenRegistrarRole = registryRbac.TOKEN_REGISTRAR_ROLE();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, tokenRegistrarRole)
        );
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
    }

    function test_registerToken_Fuzz_Revert_Unauthorized(address _nonRegistrar) public {
        vm.assume(_nonRegistrar != address(this));
        vm.assume(_nonRegistrar != address(0));
        vm.assume(_nonRegistrar != proxyAdmin);
        vm.assume(!registryRbac.hasRole(registryRbac.TOKEN_REGISTRAR_ROLE(), _nonRegistrar));

        bytes32 tokenRegistrarRole = registryRbac.TOKEN_REGISTRAR_ROLE();
        vm.prank(_nonRegistrar);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                _nonRegistrar,
                tokenRegistrarRole
            )
        );
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
    }

    // ============ Deregistration Tests ============

    function test_deregisterToken_Success_AsAdmin() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.expectEmit(true, false, false, false);
        emit IOFTRegistry.TokenDeregistered(TOKEN_ID_1);
        registry.deregisterToken(TOKEN_ID_1);

        assertEq(registry.getTokenId(address(oft1)), 0);
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(0));
    }

    function test_deregisterToken_Success_AfterRoleGrant() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        address newRegistrar = address(0x400);
        registryRbac.grantRole(registryRbac.TOKEN_REGISTRAR_ROLE(), newRegistrar);

        vm.prank(newRegistrar);
        registry.deregisterToken(TOKEN_ID_1);

        assertEq(registry.getTokenId(address(oft1)), 0);
    }

    function test_deregisterToken_Revert_Unauthorized() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        bytes32 tokenRegistrarRole = registryRbac.TOKEN_REGISTRAR_ROLE();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, tokenRegistrarRole)
        );
        registry.deregisterToken(TOKEN_ID_1);
    }

    function test_deregisterToken_Fuzz_Revert_Unauthorized(address _nonRegistrar) public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.assume(_nonRegistrar != address(this));
        vm.assume(_nonRegistrar != address(0));
        vm.assume(_nonRegistrar != proxyAdmin);
        vm.assume(!registryRbac.hasRole(registryRbac.TOKEN_REGISTRAR_ROLE(), _nonRegistrar));

        bytes32 tokenRegistrarRole = registryRbac.TOKEN_REGISTRAR_ROLE();
        vm.prank(_nonRegistrar);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                _nonRegistrar,
                tokenRegistrarRole
            )
        );
        registry.deregisterToken(TOKEN_ID_1);
    }

    // ============ Assert Helper Tests ============

    function test_getAndAssertTokenId() public override {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.getAndAssertTokenId(address(oft1));

        assertEq(registry.getAndAssertTokenId(address(oft1)), TOKEN_ID_1);
    }

    function test_getAndAssertTokenId_Fuzz(uint32 _tokenId, address _burnerMinter) public override {
        _tokenId = uint32(bound(_tokenId, 1, type(uint32).max));
        vm.assume(_burnerMinter != address(0));

        NexusOFT fuzzOft = _createNexusOFT(address(token1), _tokenId);
        registry.registerToken(_tokenId, address(fuzzOft), _burnerMinter);
        assertEq(registry.getAndAssertTokenId(address(fuzzOft)), _tokenId);
    }

    function test_getAndAssertTokenId_Revert_InvalidOFT() public override {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidOFT.selector, address(oft1)));
        registry.getAndAssertTokenId(address(oft1));
    }

    function test_getAndAssertBurnerMinterAddress() public override {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.getAndAssertBurnerMinterAddress(TOKEN_ID_1);

        assertEq(registry.getAndAssertBurnerMinterAddress(TOKEN_ID_1), address(token1));
    }

    function test_getAndAssertBurnerMinterAddress_Revert_InvalidTokenId() public override {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidTokenId.selector, TOKEN_ID_1));
        registry.getAndAssertBurnerMinterAddress(TOKEN_ID_1);
    }

    function test_getAndAssertOFTAddress() public override {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.getAndAssertOFTAddress(TOKEN_ID_1);

        assertEq(registry.getAndAssertOFTAddress(TOKEN_ID_1), address(oft1));
    }

    function test_getAndAssertOFTAddress_Revert_InvalidTokenId() public override {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidTokenId.selector, TOKEN_ID_1));
        registry.getAndAssertOFTAddress(TOKEN_ID_1);
    }
}
