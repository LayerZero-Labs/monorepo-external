// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAdversarialRouterToken is ERC20 {
    error Unauthorized(address caller);
    error Rejected();

    enum Effect {
        Normal,
        Noop,
        Fee,
        FalseReturn,
        EmptyReturn,
        Revert,
        Reenter,
        GasBomb,
        LargeRevert,
        LargeReturn
    }

    address public immutable admin;
    address public operator;
    Effect public transferEffect;
    Effect public mintEffect;
    Effect public burnEffect;
    address public effectRecipient;
    address public callback;
    bytes public callbackData;

    constructor() ERC20("Adversarial", "ADV") {
        admin = msg.sender;
    }

    function configure(Effect _transfer, Effect _mint, Effect _burn) external {
        transferEffect = _transfer;
        mintEffect = _mint;
        burnEffect = _burn;
    }

    function setOperator(address _operator) external {
        operator = _operator;
    }

    function setEffectRecipient(address _recipient) external {
        effectRecipient = _recipient;
    }

    function setCallback(address _callback, bytes calldata _data) external {
        callback = _callback;
        callbackData = _data;
    }

    function mint(address _to, uint256 _amount) external returns (bool success) {
        if (msg.sender != admin && msg.sender != operator) revert Unauthorized(msg.sender);
        _before(mintEffect, _to);
        if (mintEffect != Effect.Noop) _mint(_to, _amount);
        return _after(mintEffect);
    }

    function burn(address _from, uint256 _amount) external returns (bool success) {
        if (msg.sender != admin && msg.sender != operator) revert Unauthorized(msg.sender);
        _before(burnEffect, _from);
        if (burnEffect != Effect.Noop) _burn(_from, _amount);
        return _after(burnEffect);
    }

    function transfer(address _to, uint256 _amount) public override returns (bool success) {
        _before(transferEffect, _to);
        if (transferEffect != Effect.Noop) {
            if (transferEffect == Effect.Fee) {
                _transfer(msg.sender, _to, _amount - 1);
                _burn(msg.sender, 1);
            } else {
                super.transfer(_to, _amount);
            }
        }
        return _after(transferEffect);
    }

    function transferFrom(address _from, address _to, uint256 _amount) public override returns (bool success) {
        _before(transferEffect, _to);
        if (transferEffect != Effect.Noop) {
            if (transferEffect == Effect.Fee) {
                _spendAllowance(_from, msg.sender, _amount);
                _transfer(_from, _to, _amount - 1);
                _burn(_from, 1);
            } else {
                super.transferFrom(_from, _to, _amount);
            }
        }
        return _after(transferEffect);
    }

    function _before(Effect _effect, address _recipient) internal {
        if (effectRecipient != address(0) && _recipient != effectRecipient) return;
        if (_effect == Effect.GasBomb)
            assembly ("memory-safe") {
                invalid()
            }
        if (_effect == Effect.LargeRevert)
            assembly {
                revert(0, 0x100000)
            }
        if (_effect == Effect.Revert) revert Rejected();
        if (_effect == Effect.Reenter) {
            address target = callback;
            bytes memory data = callbackData;
            callback = address(0);
            (bool success, bytes memory result) = target.call(data);
            if (!success)
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
        }
    }

    function _after(Effect _effect) internal pure returns (bool success) {
        if (_effect == Effect.LargeReturn)
            assembly {
                mstore(0, 1)
                return(0, 0x100000)
            }
        if (_effect == Effect.EmptyReturn)
            assembly ("memory-safe") {
                return(0, 0)
            }
        return _effect != Effect.FalseReturn;
    }
}
