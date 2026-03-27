// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeHandler } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeHandler.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { FeeHandlerBaseUpgradeable } from "./../contracts/fee-accounting/FeeHandlerBaseUpgradeable.sol";

interface IFeeHandlerTestHelper is IFeeHandler {}

contract FeeHandlerBaseUpgradeableMock is FeeHandlerBaseUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(address _feeDeposit) public initializer {
        __FeeHandlerBase_init(_feeDeposit);
    }

    function setFeeDeposit(address _feeDeposit) public {
        _setFeeDeposit(_feeDeposit);
    }
}

abstract contract FeeHandlerBaseUpgradeableTestCommon is Test {
    IFeeHandlerTestHelper public feeHandlerHelper;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public virtual {
        feeHandlerHelper = _deployFeeHandlerHelper();
    }

    function _deployFeeHandlerHelper() internal virtual returns (IFeeHandlerTestHelper);

    function test_feeDeposit() public view {
        assertEq(feeHandlerHelper.feeDeposit(), alice);
    }

    function test_setFeeDeposit() public {
        vm.expectEmit(true, true, true, true, address(feeHandlerHelper));
        emit IFeeHandler.FeeDepositSet(bob);
        feeHandlerHelper.setFeeDeposit(bob);

        assertEq(feeHandlerHelper.feeDeposit(), bob);
    }

    function test_setFeeDeposit_Revert_ZeroAddress() public {
        vm.expectRevert(IFeeHandler.InvalidFeeDeposit.selector);
        feeHandlerHelper.setFeeDeposit(address(0));
    }

    function test_setFeeDeposit_Fuzz(address _newDeposit) public {
        vm.assume(_newDeposit != address(0));
        feeHandlerHelper.setFeeDeposit(_newDeposit);
        assertEq(feeHandlerHelper.feeDeposit(), _newDeposit);
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.feehandler")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xe32e0c5f1df3081ca85b86156deac82a46e8fb7b21b412e09f7ccdc5fca29900);
    }
}

contract FeeHandlerBaseUpgradeableTest is FeeHandlerBaseUpgradeableTestCommon {
    function _deployFeeHandlerHelper() internal virtual override returns (IFeeHandlerTestHelper) {
        FeeHandlerBaseUpgradeableMock impl = new FeeHandlerBaseUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeHandlerBaseUpgradeableMock.initialize.selector, alice)
        );

        return IFeeHandlerTestHelper(address(proxy));
    }
}
