// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { TokenScalesBaseUpgradeable } from "./../contracts/extensions/TokenScalesBaseUpgradeable.sol";
import { ITokenScales } from "./../contracts/interfaces/ITokenScales.sol";

contract TokenScalesBaseUpgradeableMock is TokenScalesBaseUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {}

    function setScales(ITokenScales.SetScaleParam[] calldata _params) public {
        _setScales(_params);
    }

    function toScaledAmount(uint32 _tokenId, uint256 _amount) public view returns (uint256) {
        return _toScaledAmount(_tokenId, _amount);
    }

    function fromScaledAmount(uint32 _tokenId, uint256 _scaledAmount) public view returns (uint256) {
        return _fromScaledAmount(_tokenId, _scaledAmount);
    }
}

contract TokenScalesBaseUpgradeableTest is Test {
    ITokenScales tokenScales;
    TokenScalesBaseUpgradeableMock mock;

    function setUp() public virtual {
        TokenScalesBaseUpgradeableMock impl = new TokenScalesBaseUpgradeableMock();

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(TokenScalesBaseUpgradeableMock.initialize.selector)
        );
        tokenScales = ITokenScales(address(proxy));
        mock = TokenScalesBaseUpgradeableMock(address(proxy));
    }

    // ============ Helpers ============

    function _setScale(uint32 _tokenId, uint128 _scale) internal {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: _tokenId, scale: _scale, enabled: true });
        mock.setScales(params);
    }

    // ============ SCALE_DENOMINATOR Tests ============

    function test_SCALE_DENOMINATOR() public view {
        assertEq(tokenScales.SCALE_DENOMINATOR(), 1e18);
    }

    // ============ scales Tests ============

    function test_scales_InitialState() public view {
        ITokenScales.ScaleConfig memory config = tokenScales.scales(1);
        assertEq(config.scale, 0);
        assertFalse(config.enabled);
    }

    function test_scales_AfterSet() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 2e18, enabled: true });
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(1);
        assertEq(config.scale, 2e18);
        assertTrue(config.enabled);
    }

    // ============ setScales Tests ============

    function test_setScales_Single() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 42, scale: 1.5e18, enabled: true });

        vm.expectEmit(true, false, false, true);
        emit ITokenScales.ScaleSet(42, 1.5e18, true);
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(42);
        assertEq(config.scale, 1.5e18);
        assertTrue(config.enabled);
    }

    function test_setScales_Multiple() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](3);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 0.5e18, enabled: true });
        params[1] = ITokenScales.SetScaleParam({ tokenId: 2, scale: 2e18, enabled: true });
        params[2] = ITokenScales.SetScaleParam({ tokenId: 3, scale: 0, enabled: false });

        mock.setScales(params);

        ITokenScales.ScaleConfig memory config1 = tokenScales.scales(1);
        assertEq(config1.scale, 0.5e18);
        assertTrue(config1.enabled);

        ITokenScales.ScaleConfig memory config2 = tokenScales.scales(2);
        assertEq(config2.scale, 2e18);
        assertTrue(config2.enabled);

        ITokenScales.ScaleConfig memory config3 = tokenScales.scales(3);
        assertEq(config3.scale, 0);
        assertFalse(config3.enabled);
    }

    function test_setScales_Overwrite() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 1e18, enabled: true });
        mock.setScales(params);

        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 3e18, enabled: true });
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(1);
        assertEq(config.scale, 3e18);
        assertTrue(config.enabled);
    }

    function test_setScales_ZeroScaleEnabled() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 0, enabled: true });
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(1);
        assertEq(config.scale, 0);
        assertTrue(config.enabled);
    }

    function test_setScales_Disable() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 1e18, enabled: true });
        mock.setScales(params);

        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 0, enabled: false });
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(1);
        assertEq(config.scale, 0);
        assertFalse(config.enabled);
    }

    function test_setScales_Empty() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](0);
        mock.setScales(params);
    }

    function test_setScales_Fuzz(uint32 _tokenId, uint128 _scale, bool _enabled) public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: _tokenId, scale: _scale, enabled: _enabled });

        vm.expectEmit(true, false, false, true);
        emit ITokenScales.ScaleSet(_tokenId, _scale, _enabled);
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(_tokenId);
        assertEq(config.scale, _scale);
        assertEq(config.enabled, _enabled);
    }

    function test_setScales_DoesNotAffectOtherIds() public {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: 1, scale: 5e18, enabled: true });
        mock.setScales(params);

        ITokenScales.ScaleConfig memory config = tokenScales.scales(2);
        assertEq(config.scale, 0);
        assertFalse(config.enabled);
    }

    // ============ _toScaledAmount Tests ============

    function test_toScaledAmount_OneToOne() public {
        _setScale(1, 1e18);
        assertEq(mock.toScaledAmount(1, 100), 100);
    }

    function test_toScaledAmount_DoubleScale() public {
        _setScale(1, 2e18);
        assertEq(mock.toScaledAmount(1, 100), 200);
    }

    function test_toScaledAmount_HalfScale() public {
        _setScale(1, 0.5e18);
        assertEq(mock.toScaledAmount(1, 100), 50);
    }

    function test_toScaledAmount_ZeroAmount() public {
        _setScale(1, 2e18);
        assertEq(mock.toScaledAmount(1, 0), 0);
    }

    function test_toScaledAmount_ZeroScale() public {
        _setScale(1, 0);
        assertEq(mock.toScaledAmount(1, 100), 0);
    }

    function test_toScaledAmount_RoundsCeil() public {
        _setScale(1, 0.5e18);
        assertEq(mock.toScaledAmount(1, 1), 1);
    }

    function test_toScaledAmount_LargeValues() public {
        _setScale(1, 1e18);
        assertEq(mock.toScaledAmount(1, type(uint128).max), type(uint128).max);
    }

    function test_toScaledAmount_NotEnabled() public view {
        assertEq(mock.toScaledAmount(1, 100), 100);
    }

    function test_toScaledAmount_Fuzz_NeverReverts(uint128 _amount, uint128 _scale) public {
        _setScale(1, _scale);
        mock.toScaledAmount(1, _amount);
    }

    // ============ _fromScaledAmount Tests ============

    function test_fromScaledAmount_OneToOne() public {
        _setScale(1, 1e18);
        assertEq(mock.fromScaledAmount(1, 100), 100);
    }

    function test_fromScaledAmount_DoubleScale() public {
        _setScale(1, 2e18);
        assertEq(mock.fromScaledAmount(1, 201), 100);
    }

    function test_fromScaledAmount_HalfScale() public {
        _setScale(1, 0.5e18);
        assertEq(mock.fromScaledAmount(1, 51), 102);
    }

    function test_fromScaledAmount_ZeroAmount() public {
        _setScale(1, 2e18);
        assertEq(mock.fromScaledAmount(1, 0), 0);
    }

    function test_fromScaledAmount_ZeroScale_ReturnsMax() public {
        _setScale(1, 0);
        assertEq(mock.fromScaledAmount(1, 100), type(uint256).max);
    }

    function test_fromScaledAmount_RoundsFloor() public {
        _setScale(1, 2e18);
        assertEq(mock.fromScaledAmount(1, 1), 0);
    }

    function test_fromScaledAmount_NotEnabled() public view {
        assertEq(mock.fromScaledAmount(1, 100), 100);
    }

    function test_fromScaledAmount_Fuzz_NeverReverts(uint128 _scaledAmount, uint128 _scale) public {
        _setScale(1, _scale);
        mock.fromScaledAmount(1, _scaledAmount);
    }

    // ============ Integration Tests ============

    function test_integration_Fuzz_RoundtripSafety(uint128 _bucketAvailable, uint128 _scale) public {
        _setScale(1, _scale);

        uint256 available = mock.fromScaledAmount(1, _bucketAvailable);
        uint256 consumed = mock.toScaledAmount(1, available);

        assertLe(consumed, _bucketAvailable, "Sending reported available must not exceed bucket");
    }

    function test_integration_Fuzz_Conservative(uint128 _bucketAvailable, uint128 _scale) public {
        _setScale(1, _scale);

        uint256 available = mock.fromScaledAmount(1, _bucketAvailable);
        uint256 consumed = mock.toScaledAmount(1, available);

        assertLe(consumed, _bucketAvailable, "Ceil write + Floor read must be conservative");
    }

    // ============ Storage Hash Tests ============

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.tokenscales")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xceb972fd3814c37156c133544054ec98282d351e249128053f31fdd9c6efb800);
    }
}
