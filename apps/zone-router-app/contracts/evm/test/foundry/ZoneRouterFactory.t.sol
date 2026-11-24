// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { Test } from "forge-std/Test.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "../../contracts/interfaces/IAirlock.sol";
import { IZoneRouter } from "../../contracts/interfaces/IZoneRouter.sol";
import { IZoneRouterFactory } from "../../contracts/interfaces/IZoneRouterFactory.sol";
import { ZoneRouter } from "../../contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "../../contracts/ZoneRouterFactory.sol";
import { MockGenericAirlock, numbered } from "./mocks/MockGenericAirlock.sol";
import { MockZoneRouterV2 } from "./mocks/MockZoneRouterV2.sol";

contract ZoneRouterFactoryTest is Test {
    uint64 internal constant LOCAL = 7;
    bytes32 internal constant SALT = 0x00000000000000000000000000000000000000000102030405060708090a0b0c;
    address internal constant OTHER = address(0xbeef);
    MockERC20 internal token;
    ZoneRouterFactory internal factory;
    ZoneRouter internal implementation;

    function setUp() public {
        token = new MockERC20(18);
        implementation = new ZoneRouter();
        factory = new ZoneRouterFactory(address(implementation));
    }

    function test_constructor() public view {
        assertEq(factory.IMPLEMENTATION(), address(implementation));
    }

    function test_constructor_NoAdministrativeFunctions() public {
        (bool ownerSuccess, bytes memory ownerData) = address(factory).call(abi.encodeWithSignature("owner()"));
        assertFalse(ownerSuccess);
        assertEq(ownerData, bytes(""));
        (bool upgradeSuccess, bytes memory upgradeData) = address(factory).call(
            abi.encodeWithSignature("upgradeTo(address)", address(new MockZoneRouterV2()))
        );
        assertFalse(upgradeSuccess);
        assertEq(upgradeData, bytes(""));
    }

    function test_constructor_Revert_InvalidImplementation() public {
        vm.expectRevert(IZoneRouterFactory.InvalidImplementation.selector);
        new ZoneRouterFactory(address(0));
        vm.expectRevert(IZoneRouterFactory.InvalidImplementation.selector);
        new ZoneRouterFactory(OTHER);
    }

    function test_isRouter_UnrelatedAddress() public view {
        assertFalse(factory.isRouter(OTHER));
        assertFalse(factory.isRouter(address(implementation)));
    }

    function test_deploy() public {
        address expected = _predict(SALT, address(token), address(this));
        vm.expectEmit(true, true, true, true, address(factory));
        emit IZoneRouterFactory.RouterDeployed(address(this), address(token), SALT, expected);
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(deployed, expected);
        assertTrue(factory.isRouter(deployed));
        assertEq(
            vm.load(deployed, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc),
            bytes32(uint256(uint160(address(implementation))))
        );
        ZoneRouter router = ZoneRouter(deployed);
        assertEq(router.owner(), address(this));
        assertEq(router.pendingOwner(), address(0));
        assertEq(router.config().token, address(token));
        router.setZonePeer(99, abi.encodePacked(bytes32(uint256(1))));
        assertEq(router.zonePeers(99), abi.encodePacked(bytes32(uint256(1))));
    }

    function test_deploy_DifferentSalt() public {
        address first = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        bytes32 otherSalt = bytes32(uint256(SALT) + 1);
        address second = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            otherSalt
        );
        assertNotEq(first, second);
        assertEq(second, _predict(otherSalt, address(token), address(this)));
    }

    function test_deploy_DifferentToken() public {
        MockERC20 otherToken = new MockERC20(18);
        address first = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        address second = factory.deploy(
            address(this),
            IZoneRouter.Config(address(otherToken), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertNotEq(first, second);
        assertEq(second, _predict(SALT, address(otherToken), address(this)));
        assertEq(ZoneRouter(second).config().token, address(otherToken));
    }

    function test_deploy_FactoryDoesNotOwnRouter() public {
        ZoneRouter router = ZoneRouter(
            factory.deploy(
                address(this),
                IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                SALT
            )
        );
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(factory)));
        router.markMessageForCaching(99, abi.encodePacked(bytes32(uint256(1))), 0);
    }

    function test_deploy_Gas() public {
        address expected = _predict(SALT, address(token), address(this));
        vm.expectEmit(true, true, true, true, address(factory));
        emit IZoneRouterFactory.RouterDeployed(address(this), address(token), SALT, expected);
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        vm.snapshotGasLastCall("ZoneRouterFactory", "deploy_Gas");
        assertEq(deployed, expected);
    }

    function test_deploy_DifferentConfigurationsHaveDifferentAddresses() public {
        IZoneRouter.Config memory configuration;
        configuration.token = address(token);
        configuration.localDecimals = 18;
        ZoneRouter locked = ZoneRouter(factory.deploy(address(this), configuration, SALT));
        configuration.mode = IZoneRouter.Mode.BurnMint;
        configuration.burnerMinter = address(token);
        ZoneRouter burned = ZoneRouter(factory.deploy(address(this), configuration, SALT));
        assertNotEq(address(locked), address(burned));
        assertEq(uint256(locked.config().mode), uint256(IZoneRouter.Mode.LockUnlock));
        assertEq(uint256(burned.config().mode), uint256(IZoneRouter.Mode.BurnMint));
        assertEq(burned.config().burnerMinter, address(token));
        configuration.burnSelector = MockERC20.burnFrom.selector;
        ZoneRouter allowanceBurned = ZoneRouter(factory.deploy(address(this), configuration, SALT));
        assertNotEq(address(burned), address(allowanceBurned));
        assertEq(allowanceBurned.config().burnSelector, MockERC20.burnFrom.selector);
    }

    function test_deploy_DifferentOwnersHaveDifferentAddresses() public {
        address expected = _predict(SALT, address(token), address(this));
        vm.prank(OTHER);
        address otherRouter = factory.deploy(
            OTHER,
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertNotEq(otherRouter, expected);
        assertEq(otherRouter, _predict(SALT, address(token), OTHER));
        assertEq(ZoneRouter(otherRouter).owner(), OTHER);
        assertEq(expected.code.length, 0);
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(deployed, expected);
        assertEq(ZoneRouter(deployed).owner(), address(this));
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        ZoneRouter(deployed).setZonePeer(99, abi.encodePacked(bytes32(uint256(1))));
    }

    function test_deploy_NoPerRouterUpgradeFunction() public {
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        (bool success, bytes memory result) = deployed.call(
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", OTHER, bytes(""))
        );
        assertFalse(success);
        assertEq(result, bytes(""));
        assertEq(ZoneRouter(deployed).owner(), address(this));
        assertEq(factory.IMPLEMENTATION(), address(implementation));
    }

    function test_deploy_OnBehalfOfOwner() public {
        address deployed = factory.deploy(
            OTHER,
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(deployed, _predict(SALT, address(token), OTHER));
        assertEq(ZoneRouter(deployed).owner(), OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        ZoneRouter(deployed).setZonePeer(99, abi.encodePacked(bytes32(uint256(1))));
        vm.prank(OTHER);
        ZoneRouter(deployed).setZonePeer(99, abi.encodePacked(bytes32(uint256(1))));
    }

    function test_deploy_PreDeploymentPreservesIntendedOwner() public {
        address expected = _predict(SALT, address(token), address(this));
        vm.prank(OTHER);
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(deployed, expected);
        assertEq(ZoneRouter(deployed).owner(), address(this));
        vm.expectRevert(bytes(""));
        factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        ZoneRouter(deployed).setZonePeer(99, abi.encodePacked(bytes32(uint256(1))));
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        ZoneRouter(deployed).setZonePeer(99, abi.encodePacked(bytes32(uint256(2))));
    }

    function test_deploy_PredictedAddressUnchangedAfterCodeUpdate() public {
        address predicted = _predict(SALT, address(token), address(this));
        vm.etch(address(implementation), address(new MockZoneRouterV2()).code);
        assertEq(predicted, _predict(SALT, address(token), address(this)));
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(deployed, predicted);
        assertEq(MockZoneRouterV2(deployed).version(), 2);
        assertEq(ZoneRouter(deployed).owner(), address(this));
    }

    function test_deploy_SharedImplementationCodeUpdatePreservesCachedRetry() public {
        MockERC20 otherToken = new MockERC20(18);
        ZoneRouter first = ZoneRouter(
            factory.deploy(
                address(this),
                IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                SALT
            )
        );
        ZoneRouter second = ZoneRouter(
            new ZoneRouterFactory(address(implementation)).deploy(
                address(this),
                IZoneRouter.Config(
                    address(otherToken),
                    IZoneRouter.Mode.LockUnlock,
                    18,
                    address(0),
                    bytes4(0),
                    bytes4(0)
                ),
                SALT
            )
        );
        bytes memory zonePeer = abi.encodePacked(keccak256("source app"));
        first.setZonePeer(99, zonePeer);
        second.setZonePeer(99, zonePeer);
        first.transferOwnership(OTHER);
        second.transferOwnership(OTHER);
        first.markMessageForCaching(99, zonePeer, 0);
        second.markMessageForCaching(99, zonePeer, 3);
        token.mint(address(first), 20);
        otherToken.mint(address(second), 30);
        IAirlock.Message memory message = IAirlock.Message(
            99,
            zonePeer,
            LOCAL,
            abi.encodePacked(address(first)),
            0,
            10,
            zonePeer,
            abi.encodePacked(OTHER),
            hex"0405"
        );
        vm.etch(AIRLOCK_ADDRESS, address(new MockGenericAirlock()).code);
        MockGenericAirlock airlock = MockGenericAirlock(AIRLOCK_ADDRESS);
        {
            IAirlock.Message[] memory messages = new IAirlock.Message[](1);
            messages[0] = message;
            airlock.setMessages(address(first), 99, zonePeer, numbered(messages, 0));
        }
        first.airlockReceive(99, zonePeer, 0, 1);
        assertEq(first.cachedMessages(99, zonePeer, 0), keccak256(abi.encode(message)));
        vm.etch(address(implementation), address(new MockZoneRouterV2()).code);
        assertEq(MockZoneRouterV2(address(first)).version(), 2);
        assertEq(MockZoneRouterV2(address(second)).version(), 2);
        assertEq(first.config().token, address(token));
        assertEq(second.config().token, address(otherToken));
        assertEq(first.owner(), address(this));
        assertEq(second.owner(), address(this));
        assertEq(first.pendingOwner(), OTHER);
        assertEq(second.pendingOwner(), OTHER);
        assertEq(first.zonePeers(99), zonePeer);
        assertEq(second.zonePeers(99), zonePeer);
        assertTrue(first.messagesToCache(99, zonePeer, 0));
        assertTrue(second.messagesToCache(99, zonePeer, 3));
        assertEq(first.cachedMessages(99, zonePeer, 0), keccak256(abi.encode(message)));
        assertEq(token.balanceOf(address(first)), 20);
        assertEq(otherToken.balanceOf(address(second)), 30);
        assertEq(airlock.cursor(address(first), 99, zonePeer), 1);
        vm.expectEmit(true, true, true, true, address(first));
        emit IZoneRouter.Received(99, zonePeer, 0, OTHER, 10);
        vm.prank(OTHER);
        first.retryMessage(99, zonePeer, 0, message);
        assertEq(first.cachedMessages(99, zonePeer, 0), bytes32(0));
        assertEq(token.balanceOf(OTHER), 10);
        assertEq(token.balanceOf(address(first)), 10);
        assertEq(airlock.cursor(address(first), 99, zonePeer), 1);
    }

    function test_deploy_Fuzz(bytes32 _salt, uint160 _owner) public {
        address owner = address(uint160(bound(uint256(_owner), 1, type(uint160).max)));
        address expected = _predict(_salt, address(token), owner);
        vm.expectEmit(true, true, true, true, address(factory));
        emit IZoneRouterFactory.RouterDeployed(owner, address(token), _salt, expected);
        vm.prank(owner);
        address deployed = factory.deploy(
            owner,
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            _salt
        );
        assertEq(deployed, expected);
        assertEq(ZoneRouter(deployed).owner(), owner);
        assertEq(ZoneRouter(deployed).config().token, address(token));
    }

    function test_deploy_Revert_Collision() public {
        address deployed = factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        vm.expectRevert(bytes(""));
        factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(ZoneRouter(deployed).owner(), address(this));
        assertTrue(factory.isRouter(deployed));
    }

    function test_deploy_Revert_ImplementationCodeRemoved() public {
        address predicted = _predict(SALT, address(token), address(this));
        vm.etch(address(implementation), bytes(""));
        vm.expectRevert(
            abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, address(implementation))
        );
        factory.deploy(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(predicted.code.length, 0);
    }

    function test_deploy_Revert_ZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        factory.deploy(
            address(0),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        address predicted = _predict(SALT, address(token), address(0));
        assertEq(predicted.code.length, 0);
        assertFalse(factory.isRouter(predicted));
    }

    function test_deploy_Revert_InvalidToken() public {
        vm.expectRevert(IZoneRouter.InvalidToken.selector);
        factory.deploy(
            address(this),
            IZoneRouter.Config(address(0), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(_predict(SALT, address(0), address(this)).code.length, 0);
        vm.expectRevert(IZoneRouter.InvalidToken.selector);
        factory.deploy(
            address(this),
            IZoneRouter.Config(OTHER, IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
            SALT
        );
        assertEq(_predict(SALT, OTHER, address(this)).code.length, 0);
    }

    function _predict(bytes32 _salt, address _token, address _owner) internal view returns (address predicted) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(
                    address(implementation),
                    abi.encodeCall(
                        IZoneRouter.initialize,
                        (
                            _owner,
                            IZoneRouter.Config(
                                _token,
                                IZoneRouter.Mode.LockUnlock,
                                18,
                                address(0),
                                bytes4(0),
                                bytes4(0)
                            )
                        )
                    )
                )
            )
        );
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), _salt, initCodeHash))))
        );
    }
}
