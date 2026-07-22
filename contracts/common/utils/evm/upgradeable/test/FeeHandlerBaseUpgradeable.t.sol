// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeHandler } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeHandler.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { FeeHandlerBaseUpgradeable } from "./../contracts/fee-accounting/FeeHandlerBaseUpgradeable.sol";

contract FeeHandlerBaseUpgradeableHarness is FeeHandlerBaseUpgradeable {
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

contract FeeHandlerBaseUpgradeableTest is Test {
    IFeeHandler public feeHandler;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function _deployFeeHandler() internal virtual returns (IFeeHandler) {
        FeeHandlerBaseUpgradeableHarness impl = new FeeHandlerBaseUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeHandlerBaseUpgradeableHarness.initialize.selector, alice)
        );

        return IFeeHandler(address(proxy));
    }

    function setUp() public virtual {
        feeHandler = _deployFeeHandler();
    }

    function test_feeDeposit() public view {
        assertEq(feeHandler.feeDeposit(), alice);
    }

    function test_setFeeDeposit() public {
        vm.expectEmit(true, true, true, true, address(feeHandler));
        emit IFeeHandler.FeeDepositSet(bob);
        feeHandler.setFeeDeposit(bob);

        assertEq(feeHandler.feeDeposit(), bob);
    }

    function test_setFeeDeposit_Revert_ZeroAddress() public {
        vm.expectRevert(IFeeHandler.InvalidFeeDeposit.selector);
        feeHandler.setFeeDeposit(address(0));
    }

    function test_setFeeDeposit_Fuzz(address _newDeposit) public {
        vm.assume(_newDeposit != address(0));
        feeHandler.setFeeDeposit(_newDeposit);
        assertEq(feeHandler.feeDeposit(), _newDeposit);
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.feehandler")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xe32e0c5f1df3081ca85b86156deac82a46e8fb7b21b412e09f7ccdc5fca29900);
    }
}
