// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OptionsBuilder } from "@layerzerolabs/oapp-evm-impl/contracts/oapp/libs/OptionsBuilder.sol";
import { SendParam } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { INexusFeeConfigModule } from "./../../contracts/interfaces/INexusFeeConfigModule.sol";
import { ITokenScales } from "./../../contracts/interfaces/ITokenScales.sol";
import { NexusFeeConfigModule } from "./../../contracts/modules/NexusFeeConfigModule.sol";
import { NexusPauseModule } from "./../../contracts/modules/NexusPauseModule.sol";
import { NexusRateLimiterModule } from "./../../contracts/modules/NexusRateLimiterModule.sol";
import { Nexus } from "./../../contracts/Nexus.sol";
import { NexusERC20 } from "./../../contracts/NexusERC20.sol";
import { NexusERC20Guard } from "./../../contracts/NexusERC20Guard.sol";
import { NexusOFT } from "./../../contracts/NexusOFT.sol";

/**
 * @notice Test helper contract for `Nexus` and `NexusOFT` tests.
 * @dev Provides common setup, state variables, and helper functions.
 */
abstract contract NexusTestHelper is TestHelperOz5 {
    using OptionsBuilder for bytes;

    uint32 aEid = 1;
    uint32 bEid = 2;

    Nexus aNexus;
    Nexus bNexus;
    Nexus aNexusImpl;
    Nexus bNexusImpl;
    NexusERC20 aToken;
    NexusERC20 bToken;
    NexusERC20Guard guard;
    NexusOFT aNexusOFT;
    NexusOFT bNexusOFT;

    NexusFeeConfigModule aFeeConfigModule;
    NexusFeeConfigModule bFeeConfigModule;
    NexusPauseModule aPauseModule;
    NexusPauseModule bPauseModule;
    NexusRateLimiterModule aRateLimiterModule;
    NexusRateLimiterModule bRateLimiterModule;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address dave = makeAddr("dave");

    uint8 localDecimals = 18;
    uint8 sharedDecimals = 6;

    address proxyAdmin;
    address owner;

    uint256 tokenIdOffset = uint256(type(uint32).max) + 1;
    uint32 constant TOKEN_ID = 1;

    bytes4 constant BURN_SELECTOR = bytes4(keccak256("burn(address,uint256)"));
    bytes4 constant MINT_SELECTOR = bytes4(keccak256("mint(address,uint256)"));

    uint256 initialBalance = 100 ether;

    function setUp() public virtual override {
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);

        super.setUp();
        _setupEndpoints();

        proxyAdmin = dave;
        owner = address(this);

        _deployNexusContracts();
        _deployModules();
        _deployTokens();
        _setupTokenRoles();
        _deployNexusOFTs();
        _wireNexusContracts();
        _setupDefaultRateLimits();
    }

    function _setupEndpoints() internal virtual {
        setUpEndpoints(2, LibraryType.UltraLightNode);
    }

    function _deployNexusContracts() internal virtual {
        aNexusImpl = new Nexus(address(endpoints[aEid]), localDecimals, BURN_SELECTOR, MINT_SELECTOR);
        bNexusImpl = new Nexus(address(endpoints[bEid]), localDecimals, BURN_SELECTOR, MINT_SELECTOR);

        aNexus = Nexus(
            _deployTransparentProxy(
                address(aNexusImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexus = Nexus(
            _deployTransparentProxy(
                address(bNexusImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
    }

    function _deployModules() internal virtual {
        aFeeConfigModule = NexusFeeConfigModule(
            _deployTransparentProxy(
                address(new NexusFeeConfigModule(address(aNexus))),
                proxyAdmin,
                abi.encodeWithSelector(NexusFeeConfigModule.initialize.selector)
            )
        );
        bFeeConfigModule = NexusFeeConfigModule(
            _deployTransparentProxy(
                address(new NexusFeeConfigModule(address(bNexus))),
                proxyAdmin,
                abi.encodeWithSelector(NexusFeeConfigModule.initialize.selector)
            )
        );

        aPauseModule = NexusPauseModule(
            _deployTransparentProxy(
                address(new NexusPauseModule(address(aNexus))),
                proxyAdmin,
                abi.encodeWithSelector(NexusPauseModule.initialize.selector)
            )
        );
        bPauseModule = NexusPauseModule(
            _deployTransparentProxy(
                address(new NexusPauseModule(address(bNexus))),
                proxyAdmin,
                abi.encodeWithSelector(NexusPauseModule.initialize.selector)
            )
        );

        aRateLimiterModule = NexusRateLimiterModule(
            _deployTransparentProxy(
                address(new NexusRateLimiterModule(address(aNexus))),
                proxyAdmin,
                abi.encodeWithSelector(NexusRateLimiterModule.initialize.selector, false)
            )
        );
        bRateLimiterModule = NexusRateLimiterModule(
            _deployTransparentProxy(
                address(new NexusRateLimiterModule(address(bNexus))),
                proxyAdmin,
                abi.encodeWithSelector(NexusRateLimiterModule.initialize.selector, false)
            )
        );

        aNexus.setFeeConfigModule(address(aFeeConfigModule));
        aNexus.setPauseModule(address(aPauseModule));
        aNexus.setRateLimiterModule(address(aRateLimiterModule));

        bNexus.setFeeConfigModule(address(bFeeConfigModule));
        bNexus.setPauseModule(address(bPauseModule));
        bNexus.setRateLimiterModule(address(bRateLimiterModule));
    }

    function _deployTokens() internal virtual {
        NexusERC20Guard guardImpl = new NexusERC20Guard();
        guard = NexusERC20Guard(
            _deployTransparentProxy(
                address(guardImpl),
                proxyAdmin,
                abi.encodeWithSelector(NexusERC20Guard.initialize.selector, owner)
            )
        );

        NexusERC20 nexusERC20Impl = new NexusERC20(localDecimals);

        aToken = NexusERC20(
            _deployTransparentProxy(
                address(nexusERC20Impl),
                proxyAdmin,
                abi.encodeWithSelector(NexusERC20.initialize.selector, "Token A", "A", owner, address(guard))
            )
        );
        bToken = NexusERC20(
            _deployTransparentProxy(
                address(nexusERC20Impl),
                proxyAdmin,
                abi.encodeWithSelector(NexusERC20.initialize.selector, "Token B", "B", owner, address(guard))
            )
        );
    }

    function _setupTokenRoles() internal virtual {
        aToken.grantRole(aToken.MINTER_ROLE(), address(aNexus));
        aToken.grantRole(aToken.BURNER_ROLE(), address(aNexus));
        bToken.grantRole(bToken.MINTER_ROLE(), address(bNexus));
        bToken.grantRole(bToken.BURNER_ROLE(), address(bNexus));

        aToken.grantRole(aToken.MINTER_ROLE(), address(this));
    }

    function _grantNexusRoles() internal virtual {
        aNexus.grantRole(aNexus.TOKEN_REGISTRAR_ROLE(), owner);
        bNexus.grantRole(bNexus.TOKEN_REGISTRAR_ROLE(), owner);

        /// @dev Module admin roles are granted on Nexus -- modules check `IAccessControl(NEXUS).hasRole()`.
        bytes32 rateLimiterManagerRole = aRateLimiterModule.RATE_LIMITER_MANAGER_ROLE();
        aNexus.grantRole(rateLimiterManagerRole, owner);
        bNexus.grantRole(rateLimiterManagerRole, owner);

        bytes32 feeConfigManagerRole = aFeeConfigModule.FEE_CONFIG_MANAGER_ROLE();
        aNexus.grantRole(feeConfigManagerRole, owner);
        bNexus.grantRole(feeConfigManagerRole, owner);

        bytes32 pauserRole = aPauseModule.PAUSER_ROLE();
        bytes32 unpauserRole = aPauseModule.UNPAUSER_ROLE();
        aNexus.grantRole(pauserRole, owner);
        bNexus.grantRole(pauserRole, owner);
        aNexus.grantRole(unpauserRole, owner);
        bNexus.grantRole(unpauserRole, owner);
    }

    function _deployNexusOFTs() internal virtual {
        _grantNexusRoles();

        aNexusOFT = new NexusOFT(address(aNexus), address(aToken), TOKEN_ID);
        bNexusOFT = new NexusOFT(address(bNexus), address(bToken), TOKEN_ID);

        aNexus.registerToken(TOKEN_ID, address(aNexusOFT), address(aToken));
        bNexus.registerToken(TOKEN_ID, address(bNexusOFT), address(bToken));
    }

    function _wireNexusContracts() internal virtual {
        address[] memory nexusContracts = new address[](2);
        nexusContracts[0] = address(aNexus);
        nexusContracts[1] = address(bNexus);
        this.wireOApps(nexusContracts);
    }

    function _setupDefaultRateLimits() internal virtual {
        _setupRateLimits(aRateLimiterModule, bEid, 1_000_000 ether, 24 hours);
        _setupRateLimits(bRateLimiterModule, aEid, 1_000_000 ether, 24 hours);
    }

    function _setupRateLimits(
        NexusRateLimiterModule _rlModule,
        uint32 _dstEid,
        uint96 _limit,
        uint32 _window
    ) internal {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: uint256(_dstEid),
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: _limit,
                inboundLimit: _limit,
                outboundWindow: _window,
                inboundWindow: _window
            })
        });
        _rlModule.setRateLimitConfigs(configs);
    }

    function _setupScales(NexusRateLimiterModule _rlModule, uint32 _tokenId, uint128 _scale) internal {
        ITokenScales.SetScaleParam[] memory params = new ITokenScales.SetScaleParam[](1);
        params[0] = ITokenScales.SetScaleParam({ tokenId: _tokenId, scale: _scale, enabled: true });
        _rlModule.setScales(params);
    }

    function _deployTransparentProxy(
        address _impl,
        address _proxyAdmin,
        bytes memory _initData
    ) internal returns (address) {
        return address(new TransparentUpgradeableProxy(address(_impl), _proxyAdmin, _initData));
    }

    function _buildSendParam(
        uint32 _dstEid,
        address _to,
        uint256 _amountLD,
        uint256 _minAmountLD
    ) internal pure returns (SendParam memory) {
        return
            SendParam({
                dstEid: _dstEid,
                to: bytes32(uint256(uint160(_to))),
                amountLD: _amountLD,
                minAmountLD: _minAmountLD,
                extraOptions: bytes(""),
                composeMsg: bytes(""),
                oftCmd: bytes("")
            });
    }

    function _buildSendParamWithOptions(
        uint32 _dstEid,
        address _to,
        uint256 _amountLD,
        uint256 _minAmountLD,
        bytes memory _extraOptions
    ) internal pure returns (SendParam memory) {
        return
            SendParam({
                dstEid: _dstEid,
                to: bytes32(uint256(uint160(_to))),
                amountLD: _amountLD,
                minAmountLD: _minAmountLD,
                extraOptions: _extraOptions,
                composeMsg: bytes(""),
                oftCmd: bytes("")
            });
    }

    function _setGlobalFeeBps(NexusFeeConfigModule _module, uint16 _feeBps) internal {
        INexusFeeConfigModule.SetFeeBpsParam[] memory params = new INexusFeeConfigModule.SetFeeBpsParam[](1);
        params[0] = INexusFeeConfigModule.SetFeeBpsParam({ id: 0, priority: 1, feeBps: _feeBps });
        _module.setFeeBps(params);
    }

    function _getDefaultLzOptions() internal pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
    }
}
