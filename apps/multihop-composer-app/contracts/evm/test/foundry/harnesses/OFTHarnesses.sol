// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { RateLimiter } from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import { NativeOFTAdapter } from "@layerzerolabs/oft-evm/contracts/NativeOFTAdapter.sol";
import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { OFTAdapter } from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev The OFT variants are abstract because they leave Ownable's initial owner to the deployment. These harnesses
/// @dev supply it so the real implementations can be deployed unmodified in tests.

/// @notice A burn-mint style mesh whose OFT is itself the token.
contract OFTHarness is OFT {
    constructor(
        string memory _name,
        string memory _symbol,
        address _endpoint,
        address _owner
    ) OFT(_name, _symbol, _endpoint, _owner) Ownable(_owner) {}

    /// @dev Matches the locked token's decimals so amounts round-trip between the meshes without dust.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}

/// @notice A lock-unlock style mesh that locks an existing token.
contract OFTAdapterHarness is OFTAdapter {
    constructor(
        address _token,
        address _endpoint,
        address _owner
    ) OFTAdapter(_token, _endpoint, _owner) Ownable(_owner) {}
}

/// @notice A lock-unlock style mesh with 8 shared decimals, so it carries every unit of an 8-decimal token.
contract SharedDecimals8OFTAdapterHarness is OFTAdapterHarness {
    constructor(address _token, address _endpoint, address _owner) OFTAdapterHarness(_token, _endpoint, _owner) {}

    function sharedDecimals() public pure override returns (uint8) {
        return 8;
    }
}

/// @notice A lock-unlock style mesh that rate-limits what it sends to each destination. A destination without a limit
/// @notice set takes nothing, so every send to it reverts with `RateLimitExceeded` while its quote still succeeds.
contract RateLimitedOFTAdapterHarness is OFTAdapterHarness, RateLimiter {
    constructor(address _token, address _endpoint, address _owner) OFTAdapterHarness(_token, _endpoint, _owner) {}

    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal override returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        _outflow(_dstEid, _amountLD);
        return super._debit(_from, _amountLD, _minAmountLD, _dstEid);
    }
}

/// @notice A mesh holding the chain's native gas token, which reports address(0) as its token.
contract NativeOFTAdapterHarness is NativeOFTAdapter {
    constructor(
        uint8 _localDecimals,
        address _endpoint,
        address _owner
    ) NativeOFTAdapter(_localDecimals, _endpoint, _owner) Ownable(_owner) {}
}

/// @notice A native mesh that rate-limits what it sends to each destination, as `RateLimitedOFTAdapterHarness` does.
contract RateLimitedNativeOFTAdapterHarness is NativeOFTAdapterHarness, RateLimiter {
    constructor(
        uint8 _localDecimals,
        address _endpoint,
        address _owner
    ) NativeOFTAdapterHarness(_localDecimals, _endpoint, _owner) {}

    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal override returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        _outflow(_dstEid, _amountLD);
        return super._debit(_from, _amountLD, _minAmountLD, _dstEid);
    }
}

/// @notice A native mesh with 8 shared decimals, so it carries amounts with dust for a mesh with the default 6.
contract SharedDecimals8NativeOFTAdapterHarness is NativeOFTAdapterHarness {
    constructor(
        uint8 _localDecimals,
        address _endpoint,
        address _owner
    ) NativeOFTAdapterHarness(_localDecimals, _endpoint, _owner) {}

    function sharedDecimals() public pure override returns (uint8) {
        return 8;
    }
}
