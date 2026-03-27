// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Test } from "forge-std/Test.sol";
import { RateLimiterUtils } from "../contracts/rate-limiter/libs/RateLimiterUtils.sol";

/// @dev Individual harnesses to prevent function selection costs in snapshots.

contract DecodeOverrideDefaultConfigHarness {
    function decodeOverrideDefaultConfig(uint24 _config) external pure returns (bool overrideDefaultConfig) {
        return RateLimiterUtils.decodeOverrideDefaultConfig(_config);
    }
}

contract DecodeConfigBitmapFlagsHarness {
    function decodeConfigBitmapFlags(
        uint24 _config
    )
        external
        pure
        returns (bool outboundEnabled, bool inboundEnabled, bool netAccountingEnabled, bool addressExemptionEnabled)
    {
        return RateLimiterUtils.decodeConfigBitmapFlags(_config);
    }
}

contract EncodeConfigBitmapHarness {
    function encodeConfigBitmap(
        bool _overrideDefaultConfig,
        bool _outboundEnabled,
        bool _inboundEnabled,
        bool _netAccountingEnabled,
        bool _addressExemptionEnabled
    ) external pure returns (uint24 config) {
        return
            RateLimiterUtils.encodeConfigBitmap(
                _overrideDefaultConfig,
                _outboundEnabled,
                _inboundEnabled,
                _netAccountingEnabled,
                _addressExemptionEnabled
            );
    }
}

contract RateLimiterUtilsTest is Test {
    DecodeOverrideDefaultConfigHarness public decodeOverrideDefaultConfigHarness;
    DecodeConfigBitmapFlagsHarness public decodeConfigBitmapFlagsHarness;
    EncodeConfigBitmapHarness public encodeConfigBitmapHarness;

    function setUp() public {
        decodeOverrideDefaultConfigHarness = new DecodeOverrideDefaultConfigHarness();
        decodeConfigBitmapFlagsHarness = new DecodeConfigBitmapFlagsHarness();
        encodeConfigBitmapHarness = new EncodeConfigBitmapHarness();
    }

    // ============ Encode/Decode Tests ============

    function test_decodeOverrideDefaultConfig_False() public view {
        uint24 config = 0;
        bool overrideDefaultConfig = decodeOverrideDefaultConfigHarness.decodeOverrideDefaultConfig(config);
        assertFalse(overrideDefaultConfig);
    }

    function test_decodeOverrideDefaultConfig_True() public view {
        uint24 config = 1;
        bool overrideDefaultConfig = decodeOverrideDefaultConfigHarness.decodeOverrideDefaultConfig(config);
        assertTrue(overrideDefaultConfig);
    }

    function test_decodeOverrideDefaultConfig_Fuzz(uint24 config) public pure {
        bool overrideDefaultConfig = RateLimiterUtils.decodeOverrideDefaultConfig(config);
        if (config % 2 == 0) {
            assertFalse(overrideDefaultConfig);
        } else {
            assertTrue(overrideDefaultConfig);
        }
    }

    function test_encodeConfigBitmap_AllFalse() public view {
        uint24 config = encodeConfigBitmapHarness.encodeConfigBitmap(false, false, false, false, false);
        assertEq(config, 0);
    }

    function test_encodeConfigBitmap_AllTrue() public view {
        uint24 config = encodeConfigBitmapHarness.encodeConfigBitmap(true, true, true, true, true);
        // 1 | 2 | 4 | 8 | 16 = 31.
        assertEq(config, 31);
    }

    function test_encodeConfigBitmap_Mixed() public view {
        // Only `netAccounting` (bit 3) and `addressExemption` (bit 4).
        uint24 config = encodeConfigBitmapHarness.encodeConfigBitmap(false, false, false, true, true);
        // 8 | 16 = 24.
        assertEq(config, 24);
    }

    function test_decodeConfigBitmapFlags_AllFalse() public view {
        uint24 c = 0;
        (bool out, bool inn, bool net, bool exempt) = decodeConfigBitmapFlagsHarness.decodeConfigBitmapFlags(c);
        assertFalse(out);
        assertFalse(inn);
        assertFalse(net);
        assertFalse(exempt);
    }

    function test_decodeConfigBitmapFlags_AllTrue() public view {
        uint24 c = 31;
        (bool out, bool inn, bool net, bool exempt) = decodeConfigBitmapFlagsHarness.decodeConfigBitmapFlags(c);
        assertTrue(out);
        assertTrue(inn);
        assertTrue(net);
        assertTrue(exempt);
    }

    function test_decodeConfigBitmapFlags_Mixed() public view {
        uint24 c = 24; // 8 | 16
        (bool out, bool inn, bool net, bool exempt) = decodeConfigBitmapFlagsHarness.decodeConfigBitmapFlags(c);
        assertFalse(out);
        assertFalse(inn);
        assertTrue(net);
        assertTrue(exempt);
    }

    // ============ Fuzz Tests ============

    function test_encodeDecode_Fuzz(bool f, bool out, bool inn, bool net, bool exempt) public pure {
        uint24 config = RateLimiterUtils.encodeConfigBitmap(f, out, inn, net, exempt);

        (bool dout, bool dinn, bool dnet, bool dexempt) = RateLimiterUtils.decodeConfigBitmapFlags(config);

        assertEq(out, dout);
        assertEq(inn, dinn);
        assertEq(net, dnet);
        assertEq(exempt, dexempt);
    }
}
