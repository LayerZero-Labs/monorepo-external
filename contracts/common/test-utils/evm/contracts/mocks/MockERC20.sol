// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IBurnableMintable } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IBurnableMintable.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice A mock ERC20 token for testing with mint, burn, and configurable decimals.
 */
contract MockERC20 is ERC20, IBurnableMintable {
    uint8 private immutable _decimals;

    constructor(uint8 decimals_) ERC20("Mock Token", "MTK") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8 tokenDecimals) {
        return _decimals;
    }

    function mint(address _to, uint256 _amount) external returns (bool success) {
        _mint(_to, _amount);
        return true;
    }

    function burn(address _from, uint256 _amount) external returns (bool success) {
        _burn(_from, _amount);
        return true;
    }

    function burnFrom(address _from, uint256 _amount) external returns (bool success) {
        _spendAllowance(_from, _msgSender(), _amount);
        _burn(_from, _amount);
        return true;
    }
}
