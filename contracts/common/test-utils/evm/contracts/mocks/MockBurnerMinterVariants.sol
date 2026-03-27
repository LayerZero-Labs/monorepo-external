// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IBurnableMintable } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IBurnableMintable.sol";

contract MockBurnerMinterRedeemIssue {
    IBurnableMintable public token;

    constructor(address _token) {
        token = IBurnableMintable(_token);
    }

    function redeem(address _from, uint256 _amount) external returns (bool success) {
        token.burn(_from, _amount);
        return true;
    }

    function issue(address _to, uint256 _amount) external returns (bool success) {
        token.mint(_to, _amount);
        return true;
    }
}

contract MockBurnerMinterCrosschain {
    IBurnableMintable public token;

    constructor(address _token) {
        token = IBurnableMintable(_token);
    }

    function crosschainBurn(address _from, uint256 _amount) external returns (bool success) {
        token.burn(_from, _amount);
        return true;
    }

    function crosschainMint(address _to, uint256 _amount) external returns (bool success) {
        token.mint(_to, _amount);
        return true;
    }
}

contract MockMinterBurnerMsgSender {
    IBurnableMintable public token;

    constructor(address _token) {
        token = IBurnableMintable(_token);
    }

    function mint(address _to, uint256 _amount) external returns (bool success) {
        token.mint(_to, _amount);
        return true;
    }

    function burn(uint256 _amount) external returns (bool success) {
        token.burn(msg.sender, _amount);
        return true;
    }
}
