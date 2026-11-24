// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @notice Models Ethereum USDT, which predates the finalized ERC20 standard.
 * @dev approve() and transferFrom() return no value at all, so a plain IERC20 call to either reverts when the
 * @dev compiler decodes the expected bool. A non-zero allowance also cannot be moved to another non-zero value
 * @dev without being reset to zero first.
 */
contract MockNonCompliantERC20 {
    mapping(address holder => uint256 balance) public balanceOf;
    mapping(address holder => mapping(address spender => uint256 amount)) public allowance;

    function mint(address _to, uint256 _amount) external {
        balanceOf[_to] += _amount;
    }

    function approve(address _spender, uint256 _value) external {
        require(_value == 0 || allowance[msg.sender][_spender] == 0, "unsafe allowance change");
        allowance[msg.sender][_spender] = _value;
    }

    function transferFrom(address _from, address _to, uint256 _value) external {
        if (allowance[_from][msg.sender] != type(uint256).max) {
            allowance[_from][msg.sender] -= _value;
        }
        balanceOf[_from] -= _value;
        balanceOf[_to] += _value;
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }
}

/// @dev Approves through the plain IERC20 interface, one call deep so the caller-side decode revert is observable.
contract RawApprover {
    function approve(address _token, address _spender, uint256 _value) external {
        IERC20Approve(_token).approve(_spender, _value);
    }
}

interface IERC20Approve {
    function approve(address spender, uint256 value) external returns (bool);
}
