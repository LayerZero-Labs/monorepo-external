// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { OFTRegistryBaseUpgradeable } from "./../contracts/extensions/OFTRegistryBaseUpgradeable.sol";
import { IOFTRegistry } from "./../contracts/interfaces/IOFTRegistry.sol";
import { NexusOFT } from "./../contracts/NexusOFT.sol";

contract OFTRegistryBaseUpgradeableMock is OFTRegistryBaseUpgradeable {
    constructor(uint8 _localDecimals) OFTRegistryBaseUpgradeable(_localDecimals) {
        _disableInitializers();
    }

    function initialize() public initializer {}

    function registerToken(uint32 _tokenId, address _oftAddress, address _burnerMinterAddress) public {
        _registerToken(_tokenId, _oftAddress, _burnerMinterAddress);
    }

    function deregisterToken(uint32 _tokenId) public {
        _deregisterToken(_tokenId);
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

contract OFTRegistryBaseUpgradeableTest is Test {
    IOFTRegistry registry;
    OFTRegistryBaseUpgradeableMock registryMock;

    uint8 constant LOCAL_DECIMALS = 18;
    uint8 constant SHARED_DECIMALS = 6;

    address proxyAdmin;

    MockERC20 token1;
    MockERC20 token2;
    NexusOFT oft1;
    NexusOFT oft2;

    uint32 constant TOKEN_ID_1 = 1;
    uint32 constant TOKEN_ID_2 = 2;

    function setUp() public virtual {
        OFTRegistryBaseUpgradeableMock impl = new OFTRegistryBaseUpgradeableMock(LOCAL_DECIMALS);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(OFTRegistryBaseUpgradeableMock.initialize.selector)
        );
        registry = IOFTRegistry(address(proxy));
        registryMock = OFTRegistryBaseUpgradeableMock(address(proxy));

        bytes32 adminSlot = vm.load(address(proxy), ERC1967Utils.ADMIN_SLOT);
        proxyAdmin = address(uint160(uint256(adminSlot)));

        token1 = new MockERC20(LOCAL_DECIMALS);
        token2 = new MockERC20(LOCAL_DECIMALS);
        oft1 = _createNexusOFT(address(token1), TOKEN_ID_1);
        oft2 = _createNexusOFT(address(token2), TOKEN_ID_2);
    }

    /// @dev Helper to create a NexusOFT using the registry as the nexus, mocking `endpoint()` for the constructor.
    function _createNexusOFT(address _token, uint32 _tokenId) internal returns (NexusOFT) {
        vm.mockCall(address(registry), abi.encodeWithSignature("endpoint()"), abi.encode(address(1)));
        NexusOFT oft = new NexusOFT(address(registry), _token, _tokenId);
        vm.clearMockedCalls();
        return oft;
    }

    // ============ Storage ============

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.oftregistry")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0x6939e24df0ee44eebf982e30da61bb082fb6a50870e9086efcbf20101d7ac300);
    }

    // ============ Initialization Tests ============

    function test_localDecimals() public view virtual {
        assertEq(registryMock.localDecimals(), LOCAL_DECIMALS);
    }

    function test_sharedDecimals() public view virtual {
        assertEq(registryMock.sharedDecimals(), SHARED_DECIMALS);
    }

    function test_decimalConversionRate() public view virtual {
        assertEq(registryMock.decimalConversionRate(), 10 ** (LOCAL_DECIMALS - SHARED_DECIMALS));
    }

    // ============ Initial State Tests ============

    function test_getTokenId_InitialState() public view {
        assertEq(registry.getTokenId(address(oft1)), 0);
    }

    function test_getBurnerMinterAddress_InitialState() public view {
        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_1), address(0));
    }

    function test_getOFTAddress_InitialState() public view {
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(0));
    }

    // ============ Registration Tests ============

    function test_registerToken() public {
        vm.expectEmit(true, true, true, true);
        emit IOFTRegistry.TokenRegistered(TOKEN_ID_1, address(oft1), address(token1), address(token1));
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_1), address(token1));
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(oft1));
    }

    function test_registerToken_Fuzz(uint32 _tokenId, address _burnerMinter) public {
        _tokenId = uint32(bound(_tokenId, 1, type(uint32).max));
        vm.assume(_burnerMinter != address(0));

        NexusOFT fuzzOft = _createNexusOFT(address(token1), _tokenId);

        vm.expectEmit(true, true, true, true);
        emit IOFTRegistry.TokenRegistered(_tokenId, address(fuzzOft), _burnerMinter, address(token1));
        registry.registerToken(_tokenId, address(fuzzOft), _burnerMinter);

        assertEq(registry.getTokenId(address(fuzzOft)), _tokenId);
        assertEq(registry.getBurnerMinterAddress(_tokenId), _burnerMinter);
        assertEq(registry.getOFTAddress(_tokenId), address(fuzzOft));
    }

    function test_registerToken_Success_MultipleTokens() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.registerToken(TOKEN_ID_2, address(oft2), address(token2));

        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
        assertEq(registry.getTokenId(address(oft2)), TOKEN_ID_2);
        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_1), address(token1));
        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_2), address(token2));
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(oft1));
        assertEq(registry.getOFTAddress(TOKEN_ID_2), address(oft2));
    }

    function test_registerToken_Success_MaxTokenId() public {
        uint32 maxTokenId = type(uint32).max;
        NexusOFT maxOft = _createNexusOFT(address(token1), maxTokenId);

        vm.expectEmit(true, true, true, true);
        emit IOFTRegistry.TokenRegistered(maxTokenId, address(maxOft), address(token1), address(token1));
        registry.registerToken(maxTokenId, address(maxOft), address(token1));

        assertEq(registry.getTokenId(address(maxOft)), maxTokenId);
        assertEq(registry.getOFTAddress(maxTokenId), address(maxOft));
    }

    function test_registerToken_Revert_ZeroTokenId() public {
        vm.expectRevert(
            abi.encodeWithSelector(IOFTRegistry.InvalidTokenRegistration.selector, 0, address(token1), address(oft1))
        );
        registry.registerToken(0, address(oft1), address(token1));
    }

    function test_registerToken_Revert_ZeroOFTAddress() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IOFTRegistry.InvalidTokenRegistration.selector,
                TOKEN_ID_1,
                address(token1),
                address(0)
            )
        );
        registry.registerToken(TOKEN_ID_1, address(0), address(token1));
    }

    function test_registerToken_Revert_ZeroBurnerMinterAddress() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IOFTRegistry.InvalidTokenRegistration.selector,
                TOKEN_ID_1,
                address(0),
                address(oft1)
            )
        );
        registry.registerToken(TOKEN_ID_1, address(oft1), address(0));
    }

    function test_registerToken_Revert_TokenIdMismatch() public {
        /// @dev oft1 was constructed with TOKEN_ID_1, so registering it as TOKEN_ID_2 should revert.
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidTokenId.selector, TOKEN_ID_1));
        registry.registerToken(TOKEN_ID_2, address(oft1), address(token1));
    }

    function test_registerToken_Revert_InvalidTokenDecimals() public {
        MockERC20 invalidToken = new MockERC20(8);
        NexusOFT invalidOft = _createNexusOFT(address(invalidToken), TOKEN_ID_1);

        vm.expectRevert(
            abi.encodeWithSelector(IOFTRegistry.InvalidTokenDecimals.selector, address(invalidToken), LOCAL_DECIMALS, 8)
        );
        registry.registerToken(TOKEN_ID_1, address(invalidOft), address(token1));
    }

    function test_registerToken_Revert_InvalidOFTSharedDecimals() public {
        /// @dev Create a NexusOFT pointing to a fake nexus that reports incorrect shared decimals.
        ///      The mock must persist because `NexusOFT.sharedDecimals()` delegates to its nexus at call time.
        address fakeNexus = makeAddr("fakeNexus");
        vm.mockCall(fakeNexus, abi.encodeWithSignature("endpoint()"), abi.encode(address(1)));
        vm.mockCall(fakeNexus, abi.encodeWithSignature("sharedDecimals()"), abi.encode(uint8(8)));
        NexusOFT invalidOft = new NexusOFT(fakeNexus, address(token1), TOKEN_ID_1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IOFTRegistry.InvalidOFTSharedDecimals.selector,
                address(invalidOft),
                SHARED_DECIMALS,
                8
            )
        );
        registry.registerToken(TOKEN_ID_1, address(invalidOft), address(token1));
    }

    function test_registerToken_Revert_TokenIdAlreadyRegistered() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        NexusOFT duplicateOft = _createNexusOFT(address(token2), TOKEN_ID_1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IOFTRegistry.TokenAlreadyRegistered.selector,
                TOKEN_ID_1,
                address(token2),
                address(duplicateOft)
            )
        );
        registry.registerToken(TOKEN_ID_1, address(duplicateOft), address(token2));
    }

    function test_registerToken_Revert_OFTAlreadyRegistered() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.expectRevert(
            abi.encodeWithSelector(
                IOFTRegistry.TokenAlreadyRegistered.selector,
                TOKEN_ID_1,
                address(token1),
                address(oft1)
            )
        );
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token2));
    }

    // ============ Deregistration Tests ============

    function test_deregisterToken() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.expectEmit(true, false, false, false);
        emit IOFTRegistry.TokenDeregistered(TOKEN_ID_1);
        registry.deregisterToken(TOKEN_ID_1);

        assertEq(registry.getTokenId(address(oft1)), 0);
        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_1), address(0));
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(0));
    }

    function test_deregisterToken_Fuzz(uint32 _tokenId, address _burnerMinter) public {
        _tokenId = uint32(bound(_tokenId, 1, type(uint32).max));
        vm.assume(_burnerMinter != address(0));

        NexusOFT fuzzOft = _createNexusOFT(address(token1), _tokenId);
        registry.registerToken(_tokenId, address(fuzzOft), _burnerMinter);

        vm.expectEmit(true, false, false, false);
        emit IOFTRegistry.TokenDeregistered(_tokenId);
        registry.deregisterToken(_tokenId);

        assertEq(registry.getTokenId(address(fuzzOft)), 0);
        assertEq(registry.getBurnerMinterAddress(_tokenId), address(0));
        assertEq(registry.getOFTAddress(_tokenId), address(0));
    }

    function test_deregisterToken_Success_KeepsOtherTokens() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.registerToken(TOKEN_ID_2, address(oft2), address(token2));

        registry.deregisterToken(TOKEN_ID_1);

        assertEq(registry.getTokenId(address(oft1)), 0);
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(0));
        assertEq(registry.getTokenId(address(oft2)), TOKEN_ID_2);
        assertEq(registry.getOFTAddress(TOKEN_ID_2), address(oft2));
    }

    function test_deregisterToken_Success_CanReregisterAfterDeregister() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.deregisterToken(TOKEN_ID_1);

        vm.expectEmit(true, true, true, true);
        emit IOFTRegistry.TokenRegistered(TOKEN_ID_1, address(oft1), address(token1), address(token1));
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(oft1));
    }

    function test_deregisterToken_Success_CanRegisterDifferentOFTToSameTokenId() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.deregisterToken(TOKEN_ID_1);

        NexusOFT newOft = _createNexusOFT(address(token2), TOKEN_ID_1);

        vm.expectEmit(true, true, true, true);
        emit IOFTRegistry.TokenRegistered(TOKEN_ID_1, address(newOft), address(token2), address(token2));
        registry.registerToken(TOKEN_ID_1, address(newOft), address(token2));

        assertEq(registry.getTokenId(address(newOft)), TOKEN_ID_1);
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(newOft));
    }

    function test_deregisterToken_Revert_TokenNotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.TokenNotRegistered.selector, TOKEN_ID_1));
        registry.deregisterToken(TOKEN_ID_1);
    }

    function test_deregisterToken_Revert_AlreadyDeregistered() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.deregisterToken(TOKEN_ID_1);

        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.TokenNotRegistered.selector, TOKEN_ID_1));
        registry.deregisterToken(TOKEN_ID_1);
    }

    // ============ Getter Tests ============

    function test_getTokenId() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.getTokenId(address(oft1));

        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
    }

    function test_getTokenId_Fuzz_ReadableByAnyone(address _caller) public virtual {
        vm.assume(_caller != address(proxyAdmin));

        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.prank(_caller);
        assertEq(registry.getTokenId(address(oft1)), TOKEN_ID_1);
    }

    function test_getBurnerMinterAddress() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.getBurnerMinterAddress(TOKEN_ID_1);

        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_1), address(token1));
    }

    function test_getBurnerMinterAddress_Fuzz_ReadableByAnyone(address _caller) public virtual {
        vm.assume(_caller != address(proxyAdmin));

        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.prank(_caller);
        assertEq(registry.getBurnerMinterAddress(TOKEN_ID_1), address(token1));
    }

    function test_getOFTAddress() public {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registry.getOFTAddress(TOKEN_ID_1);

        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(oft1));
    }

    function test_getOFTAddress_Fuzz_ReadableByAnyone(address _caller) public virtual {
        vm.assume(_caller != address(proxyAdmin));

        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));

        vm.prank(_caller);
        assertEq(registry.getOFTAddress(TOKEN_ID_1), address(oft1));
    }

    // ============ Assert Helper Tests ============

    function test_getAndAssertTokenId() public virtual {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registryMock.getAndAssertTokenId(address(oft1));

        assertEq(registryMock.getAndAssertTokenId(address(oft1)), TOKEN_ID_1);
    }

    function test_getAndAssertTokenId_Fuzz(uint32 _tokenId, address _burnerMinter) public virtual {
        _tokenId = uint32(bound(_tokenId, 1, type(uint32).max));
        vm.assume(_burnerMinter != address(0));

        NexusOFT fuzzOft = _createNexusOFT(address(token1), _tokenId);
        registry.registerToken(_tokenId, address(fuzzOft), _burnerMinter);
        assertEq(registryMock.getAndAssertTokenId(address(fuzzOft)), _tokenId);
    }

    function test_getAndAssertTokenId_Revert_InvalidOFT() public virtual {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidOFT.selector, address(oft1)));
        registryMock.getAndAssertTokenId(address(oft1));
    }

    function test_getAndAssertBurnerMinterAddress() public virtual {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registryMock.getAndAssertBurnerMinterAddress(TOKEN_ID_1);

        assertEq(registryMock.getAndAssertBurnerMinterAddress(TOKEN_ID_1), address(token1));
    }

    function test_getAndAssertBurnerMinterAddress_Revert_InvalidTokenId() public virtual {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidTokenId.selector, TOKEN_ID_1));
        registryMock.getAndAssertBurnerMinterAddress(TOKEN_ID_1);
    }

    function test_getAndAssertOFTAddress() public virtual {
        registry.registerToken(TOKEN_ID_1, address(oft1), address(token1));
        registryMock.getAndAssertOFTAddress(TOKEN_ID_1);

        assertEq(registryMock.getAndAssertOFTAddress(TOKEN_ID_1), address(oft1));
    }

    function test_getAndAssertOFTAddress_Revert_InvalidTokenId() public virtual {
        vm.expectRevert(abi.encodeWithSelector(IOFTRegistry.InvalidTokenId.selector, TOKEN_ID_1));
        registryMock.getAndAssertOFTAddress(TOKEN_ID_1);
    }
}
