// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IBurnableMintable } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IBurnableMintable.sol";

/**
 * @title MockBurnerMinter
 * @notice Mock contract that can burn and mint tokens.
 */
contract MockBurnerMinter {
    IBurnableMintable public token;

    constructor(address _token) {
        token = IBurnableMintable(_token);
    }

    function burn(address _from, uint256 _amount) external {
        token.burn(_from, _amount);
    }

    function mint(address _to, uint256 _amount) external {
        token.mint(_to, _amount);
    }
}
