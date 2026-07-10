// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { INexusModule } from "./../../contracts/interfaces/INexusModule.sol";
import { INexusPauseModule } from "./../../contracts/interfaces/INexusPauseModule.sol";
import { NexusTestHelper } from "./../shared/NexusTestHelper.sol";

contract NexusPauseModuleTest is NexusTestHelper {
    uint32 constant TOKEN_A = 1;
    uint32 constant TOKEN_B = 2;
    uint32 constant DST_EID = 2;

    function _compositeKey() internal view returns (uint256) {
        return aNexus.getNexusId(TOKEN_A, DST_EID);
    }

    function _tokenKey() internal pure returns (uint256) {
        return uint256(TOKEN_A) << 32;
    }

    function _destinationKey() internal pure returns (uint256) {
        return uint256(DST_EID);
    }

    function _globalKey() internal pure returns (uint256) {
        return 0;
    }

    function _pauseParam(
        uint256 _id,
        uint128 _priority,
        bool _paused
    ) internal pure returns (INexusPauseModule.SetPausedParam[] memory params) {
        params = new INexusPauseModule.SetPausedParam[](1);
        params[0] = INexusPauseModule.SetPausedParam({ id: _id, priority: _priority, paused: _paused });
    }

    // ============ setPaused Tests ============

    function test_setPaused() public {
        vm.expectEmit(address(aPauseModule));
        emit INexusPauseModule.PauseConfigSet(1, 5, true);
        aPauseModule.setPaused(_pauseParam(1, 5, true));

        INexusPauseModule.PauseConfig memory config = aPauseModule.pauseConfig(1);
        assertEq(config.priority, 5);
        assertTrue(config.paused);
    }

    function _assertRequiresRole(
        uint256 _key,
        uint128 _oldPri,
        bool _oldPaused,
        uint128 _newPri,
        bool _newPaused,
        bytes32 _requiredRole
    ) internal {
        if (_oldPri > 0 || _oldPaused) {
            aPauseModule.setPaused(_pauseParam(_key, _oldPri, _oldPaused));
        }

        vm.expectRevert(abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, _requiredRole, alice));
        vm.prank(alice);
        aPauseModule.setPaused(_pauseParam(_key, _newPri, _newPaused));

        aNexus.grantRole(_requiredRole, alice);

        vm.prank(alice);
        aPauseModule.setPaused(_pauseParam(_key, _newPri, _newPaused));

        INexusPauseModule.PauseConfig memory config = aPauseModule.pauseConfig(_key);
        assertEq(config.priority, _newPri);
        assertEq(config.paused, _newPaused);

        aNexus.revokeRole(_requiredRole, alice);
    }

    /// @dev Tests all (priority change × paused state) permutations for single-entry role determination.
    ///      Each row verifies: (1) revert without the required role, (2) success with it.
    function test_setPaused_RolePermutations() public {
        bytes32 PAUSER = aPauseModule.PAUSER_ROLE();
        bytes32 UNPAUSER = aPauseModule.UNPAUSER_ROLE();

        uint256 key;

        // Strengthening (`newPriority > oldPriority`): role matches `param.paused`.
        _assertRequiresRole(++key, 1, false, 5, false, UNPAUSER);
        _assertRequiresRole(++key, 1, false, 5, true, PAUSER);
        _assertRequiresRole(++key, 1, true, 5, false, UNPAUSER);
        _assertRequiresRole(++key, 1, true, 5, true, PAUSER);

        // Weakening (`newPriority < oldPriority`): role is opposite of `oldPaused`.
        _assertRequiresRole(++key, 5, false, 1, false, PAUSER);
        _assertRequiresRole(++key, 5, false, 1, true, PAUSER); // weakening + switching → converges
        _assertRequiresRole(++key, 5, true, 1, false, UNPAUSER); // weakening + switching → converges
        _assertRequiresRole(++key, 5, true, 1, true, UNPAUSER);

        // Same priority: role matches `param.paused`.
        _assertRequiresRole(++key, 5, false, 5, false, UNPAUSER);
        _assertRequiresRole(++key, 5, false, 5, true, PAUSER);
        _assertRequiresRole(++key, 5, true, 5, false, UNPAUSER);
        _assertRequiresRole(++key, 5, true, 5, true, PAUSER);

        // Fresh writes (from default `0` / `false`): role matches `param.paused`.
        _assertRequiresRole(++key, 0, false, 1, false, UNPAUSER);
        _assertRequiresRole(++key, 0, false, 1, true, PAUSER);
    }

    function test_setPaused_MixedBatch() public {
        aNexus.grantRole(aPauseModule.PAUSER_ROLE(), alice);
        aNexus.grantRole(aPauseModule.UNPAUSER_ROLE(), alice);

        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](2);
        params[0] = INexusPauseModule.SetPausedParam({ id: 1, priority: 1, paused: true });
        params[1] = INexusPauseModule.SetPausedParam({ id: 2, priority: 1, paused: false });

        vm.prank(alice);
        aPauseModule.setPaused(params);

        INexusPauseModule.PauseConfig memory config = aPauseModule.pauseConfig(1);
        assertEq(config.priority, 1);
        assertTrue(config.paused);

        config = aPauseModule.pauseConfig(2);
        assertEq(config.priority, 1);
        assertFalse(config.paused);
    }

    function test_setPaused_Revert_MixedBatchRequiresBothRoles() public {
        aNexus.grantRole(aPauseModule.PAUSER_ROLE(), alice);

        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](2);
        params[0] = INexusPauseModule.SetPausedParam({ id: 1, priority: 1, paused: true });
        params[1] = INexusPauseModule.SetPausedParam({ id: 2, priority: 1, paused: false });

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, aPauseModule.UNPAUSER_ROLE(), alice)
        );
        vm.prank(alice);
        aPauseModule.setPaused(params);
    }

    function test_setPaused_EmptyArrayWithUnpauserRole() public {
        aNexus.grantRole(aPauseModule.UNPAUSER_ROLE(), alice);

        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](0);

        vm.prank(alice);
        aPauseModule.setPaused(params);
    }

    function test_setPaused_Revert_EmptyArrayRequiresUnpauserRole() public {
        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](0);

        vm.expectRevert(
            abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, aPauseModule.UNPAUSER_ROLE(), alice)
        );
        vm.prank(alice);
        aPauseModule.setPaused(params);
    }

    // ============ pauseConfig Tests ============

    function test_pauseConfig() public {
        aPauseModule.setPaused(_pauseParam(42, 7, true));

        INexusPauseModule.PauseConfig memory config = aPauseModule.pauseConfig(42);
        assertEq(config.priority, 7);
        assertTrue(config.paused);
    }

    function test_pauseConfig_DefaultZero() public view {
        INexusPauseModule.PauseConfig memory config = aPauseModule.pauseConfig(1);
        assertEq(config.priority, 0);
        assertFalse(config.paused);
    }

    // ============ isPaused Tests ============

    function test_isPaused_DefaultFalse() public view {
        assertFalse(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_GlobalPause() public {
        aPauseModule.setPaused(_pauseParam(_globalKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_TokenOnlyPause() public {
        aPauseModule.setPaused(_pauseParam(_tokenKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_DestinationOnlyPause() public {
        aPauseModule.setPaused(_pauseParam(_destinationKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_CompositePause() public {
        aPauseModule.setPaused(_pauseParam(_compositeKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_Tiebreak_GlobalOverridesComposite() public {
        aPauseModule.setPaused(_pauseParam(_compositeKey(), 1, false));
        aPauseModule.setPaused(_pauseParam(_globalKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_Tiebreak_GlobalOverridesTokenOnly() public {
        aPauseModule.setPaused(_pauseParam(_tokenKey(), 1, false));
        aPauseModule.setPaused(_pauseParam(_globalKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_Tiebreak_GlobalOverridesDestOnly() public {
        aPauseModule.setPaused(_pauseParam(_destinationKey(), 1, false));
        aPauseModule.setPaused(_pauseParam(_globalKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_Tiebreak_DestOnlyOverridesTokenOnly() public {
        aPauseModule.setPaused(_pauseParam(_tokenKey(), 1, true));
        aPauseModule.setPaused(_pauseParam(_destinationKey(), 1, false));

        assertFalse(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_HigherPriorityWins_CompositeOverridesGlobal() public {
        aPauseModule.setPaused(_pauseParam(_globalKey(), 1, true));
        aPauseModule.setPaused(_pauseParam(_compositeKey(), 5, false));

        assertFalse(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_HigherPriorityWins_TokenOverridesGlobal() public {
        aPauseModule.setPaused(_pauseParam(_globalKey(), 1, true));
        aPauseModule.setPaused(_pauseParam(_tokenKey(), 5, false));

        assertFalse(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_MaxPriority_EarlyReturn_Global() public {
        aPauseModule.setPaused(_pauseParam(_compositeKey(), type(uint128).max, false));
        aPauseModule.setPaused(_pauseParam(_globalKey(), type(uint128).max, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_MaxPriority_EarlyReturn_DestOnly() public {
        aPauseModule.setPaused(_pauseParam(_compositeKey(), type(uint128).max, false));
        aPauseModule.setPaused(_pauseParam(_destinationKey(), type(uint128).max, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_MaxPriority_EarlyReturn_TokenOnly() public {
        aPauseModule.setPaused(_pauseParam(_compositeKey(), type(uint128).max, false));
        aPauseModule.setPaused(_pauseParam(_tokenKey(), type(uint128).max, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
    }

    function test_isPaused_DoesNotAffectOtherKeys() public {
        uint256 otherComposite = aNexus.getNexusId(TOKEN_B, DST_EID);
        aPauseModule.setPaused(_pauseParam(_compositeKey(), 1, true));

        assertTrue(aPauseModule.isPaused(_compositeKey()));
        assertFalse(aPauseModule.isPaused(otherComposite));
    }

    function test_isPaused_Fuzz(uint128 _globalPriority, uint128 _compositePriority) public {
        aPauseModule.setPaused(_pauseParam(_globalKey(), _globalPriority, true));
        aPauseModule.setPaused(_pauseParam(_compositeKey(), _compositePriority, false));

        if (_compositePriority > _globalPriority) {
            assertFalse(aPauseModule.isPaused(_compositeKey()));
        } else {
            assertTrue(aPauseModule.isPaused(_compositeKey()));
        }
    }

    // ============ pauseConfigCount Tests ============

    function test_pauseConfigCount_DefaultZero() public view {
        assertEq(aPauseModule.pauseConfigCount(), 0);
    }

    function test_pauseConfigCount_IncrementsOnNewKeys() public {
        aPauseModule.setPaused(_pauseParam(1, 1, true));
        assertEq(aPauseModule.pauseConfigCount(), 1);

        aPauseModule.setPaused(_pauseParam(2, 1, false));
        assertEq(aPauseModule.pauseConfigCount(), 2);

        aPauseModule.setPaused(_pauseParam(3, 1, true));
        assertEq(aPauseModule.pauseConfigCount(), 3);
    }

    function test_pauseConfigCount_DuplicateKeyDoesNotIncrement() public {
        aPauseModule.setPaused(_pauseParam(1, 1, true));
        assertEq(aPauseModule.pauseConfigCount(), 1);

        aPauseModule.setPaused(_pauseParam(1, 5, false));
        assertEq(aPauseModule.pauseConfigCount(), 1);
    }

    function test_pauseConfigCount_RemovesOnZeroConfig() public {
        aPauseModule.setPaused(_pauseParam(1, 5, true));
        assertEq(aPauseModule.pauseConfigCount(), 1);

        aPauseModule.setPaused(_pauseParam(1, 0, false));
        assertEq(aPauseModule.pauseConfigCount(), 0);
        (uint256[] memory ids, ) = aPauseModule.getPauseConfigs(0, 10);
        assertEq(ids.length, 0);
    }

    function test_pauseConfigCount_PartialRemoval() public {
        aPauseModule.setPaused(_pauseParam(1, 5, true));
        aPauseModule.setPaused(_pauseParam(2, 3, false));
        aPauseModule.setPaused(_pauseParam(3, 1, true));
        assertEq(aPauseModule.pauseConfigCount(), 3);

        aPauseModule.setPaused(_pauseParam(2, 0, false));
        assertEq(aPauseModule.pauseConfigCount(), 2);

        (uint256[] memory ids, ) = aPauseModule.getPauseConfigs(0, 10);
        assertEq(ids.length, 2);
    }

    function test_pauseConfigCount_ReAddAfterRemoval() public {
        aPauseModule.setPaused(_pauseParam(1, 5, true));
        aPauseModule.setPaused(_pauseParam(1, 0, false));
        assertEq(aPauseModule.pauseConfigCount(), 0);

        aPauseModule.setPaused(_pauseParam(1, 10, true));
        assertEq(aPauseModule.pauseConfigCount(), 1);
    }

    function test_pauseConfigCount_PriorityZeroPausedTrueNotRemoved() public {
        aPauseModule.setPaused(_pauseParam(1, 0, true));
        assertEq(aPauseModule.pauseConfigCount(), 1);
    }

    // ============ getPauseConfigs Tests ============

    function test_getPauseConfigs_Empty() public view {
        (uint256[] memory ids, INexusPauseModule.PauseConfig[] memory configs) = aPauseModule.getPauseConfigs(0, 10);
        assertEq(ids.length, 0);
        assertEq(configs.length, 0);
    }

    function test_getPauseConfigs_ReturnsAllKeys() public {
        aPauseModule.setPaused(_pauseParam(10, 1, true));
        aPauseModule.setPaused(_pauseParam(20, 2, false));
        aPauseModule.setPaused(_pauseParam(30, 3, true));

        (uint256[] memory ids, INexusPauseModule.PauseConfig[] memory configs) = aPauseModule.getPauseConfigs(0, 10);
        assertEq(ids.length, 3);
        assertEq(configs.length, 3);

        for (uint256 i = 0; i < ids.length; i++) {
            assertTrue(configs[i].priority > 0);
        }
    }

    function test_getPauseConfigs_Pagination() public {
        for (uint256 i = 1; i <= 5; i++) {
            aPauseModule.setPaused(_pauseParam(i, uint128(i), true));
        }

        (uint256[] memory page1, INexusPauseModule.PauseConfig[] memory configs1) = aPauseModule.getPauseConfigs(0, 2);
        assertEq(page1.length, 2);
        assertEq(configs1.length, 2);

        (uint256[] memory page2, ) = aPauseModule.getPauseConfigs(2, 2);
        assertEq(page2.length, 2);

        (uint256[] memory page3, ) = aPauseModule.getPauseConfigs(4, 2);
        assertEq(page3.length, 1);
    }

    // ============ Storage Hash Tests ============

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexuspause")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xd34179d4b7cb188c337b89523bfed55ea9c8d48fd632a0c59dbed502c1b8b800);
    }
}

/**
 * @notice Handler for invariant testing. Holds `PAUSER_ROLE` only, calls `setPaused` with fully fuzzed
 *         params: arbitrary (`eid`, `tokenId`) across all 4 resolution levels, arbitrary priority and
 *         paused values. Tracks `ghostMutations` to prove the fuzzer actually changes underlying config state.
 */
contract PauserInvariantHandler {
    INexusPauseModule private immutable _module;
    uint256 public ghostMutations;

    constructor(INexusPauseModule _pauseModule) {
        _module = _pauseModule;
    }

    function _buildKey(uint32 _eid, uint32 _tokenId, uint8 _level) private pure returns (uint256) {
        uint8 level = _level % 4;
        if (level == 0) return 0;
        if (level == 1) return uint256(_eid);
        if (level == 2) return uint256(_tokenId) << 32;
        return (uint256(_tokenId) << 32) | uint256(_eid);
    }

    function setPaused(uint32 _eid, uint32 _tokenId, uint8 _level, uint128 _priority, bool _paused) external {
        uint256 key = _buildKey(_eid, _tokenId, _level);
        INexusPauseModule.PauseConfig memory before = _module.pauseConfig(key);

        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](1);
        params[0] = INexusPauseModule.SetPausedParam({ id: key, priority: _priority, paused: _paused });

        try _module.setPaused(params) {
            INexusPauseModule.PauseConfig memory after_ = _module.pauseConfig(key);
            if (before.priority != after_.priority || before.paused != after_.paused) ghostMutations++;
        } catch {}
    }

    function setPausedBatch(
        uint32 _eid0,
        uint32 _tokenId0,
        uint8 _level0,
        uint128 _pri0,
        bool _paused0,
        uint32 _eid1,
        uint32 _tokenId1,
        uint8 _level1,
        uint128 _pri1,
        bool _paused1
    ) external {
        uint256 key0 = _buildKey(_eid0, _tokenId0, _level0);
        uint256 key1 = _buildKey(_eid1, _tokenId1, _level1);

        INexusPauseModule.PauseConfig memory before0 = _module.pauseConfig(key0);
        INexusPauseModule.PauseConfig memory before1 = _module.pauseConfig(key1);

        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](2);
        params[0] = INexusPauseModule.SetPausedParam({ id: key0, priority: _pri0, paused: _paused0 });
        params[1] = INexusPauseModule.SetPausedParam({ id: key1, priority: _pri1, paused: _paused1 });

        try _module.setPaused(params) {
            INexusPauseModule.PauseConfig memory after0 = _module.pauseConfig(key0);
            INexusPauseModule.PauseConfig memory after1 = _module.pauseConfig(key1);
            if (before0.priority != after0.priority || before0.paused != after0.paused) ghostMutations++;
            if (before1.priority != after1.priority || before1.paused != after1.paused) ghostMutations++;
        } catch {}
    }
}

/**
 * @notice Invariant: a `PAUSER_ROLE`-only actor cannot change the effective pause state of any paused
 *         pathway, regardless of which keys, priorities, or paused values are used — including arbitrary
 *         `eid`/`tokenId`.
 */
contract NexusPauseModuleInvariantTest is NexusTestHelper {
    PauserInvariantHandler private _handler;
    uint256[] private _trackedPathways;

    function setUp() public override {
        super.setUp();

        // 16 configs across all 4 resolution levels. Unpaused configs at lower priorities
        // create potential escape routes the `PAUSER_ROLE` holder must not be able to exploit.
        //
        //   Level       Key            Pri    Paused  Notes
        //   global      —               30    true    base safety net
        //   dest        eid=1           40    true    beats global
        //   dest        eid=2           50    true    beats global
        //   dest        eid=3           20    false   escape route, weaker than global
        //   dest        eid=4          MAX    true    early-return sentinel
        //   token       token=1         60    true    highest non-MAX paused
        //   token       token=2         20    false   escape route, weaker than global
        //   token       token=3         30    true    tied with global (tiebreak test)
        //   token       token=4         70    true    second-highest non-MAX
        //   composite   (1,1)           25    false   escape route below token=1 @ 60
        //   composite   (2,2)           55    true    only composite-level winner
        //   composite   (3,3)           15    false   weakest escape route
        //   composite   (4,1)           35    false   between global @ 30 and dest=1 @ 40
        //   composite   (1,3)           10    true    low-priority paused, irrelevant
        //   composite   (3,2)           45    false   just below dest=2 @ 50
        //   composite   (2,3)            5    true    lowest-priority paused composite
        INexusPauseModule.SetPausedParam[] memory params = new INexusPauseModule.SetPausedParam[](16);
        params[0] = INexusPauseModule.SetPausedParam({ id: 0, priority: 30, paused: true }); // global
        params[1] = INexusPauseModule.SetPausedParam({ id: 1, priority: 40, paused: true }); // dest eid=1
        params[2] = INexusPauseModule.SetPausedParam({ id: 2, priority: 50, paused: true }); // dest eid=2
        params[3] = INexusPauseModule.SetPausedParam({ id: 3, priority: 20, paused: false }); // dest eid=3
        params[4] = INexusPauseModule.SetPausedParam({ id: 4, priority: type(uint128).max, paused: true }); // dest eid=4 MAX
        params[5] = INexusPauseModule.SetPausedParam({ id: uint256(1) << 32, priority: 60, paused: true }); // token=1
        params[6] = INexusPauseModule.SetPausedParam({ id: uint256(2) << 32, priority: 20, paused: false }); // token=2
        params[7] = INexusPauseModule.SetPausedParam({ id: uint256(3) << 32, priority: 30, paused: true }); // token=3
        params[8] = INexusPauseModule.SetPausedParam({ id: uint256(4) << 32, priority: 70, paused: true }); // token=4
        params[9] = INexusPauseModule.SetPausedParam({ id: (uint256(1) << 32) | 1, priority: 25, paused: false }); // (1,1)
        params[10] = INexusPauseModule.SetPausedParam({ id: (uint256(2) << 32) | 2, priority: 55, paused: true }); // (2,2)
        params[11] = INexusPauseModule.SetPausedParam({ id: (uint256(3) << 32) | 3, priority: 15, paused: false }); // (3,3)
        params[12] = INexusPauseModule.SetPausedParam({ id: (uint256(4) << 32) | 1, priority: 35, paused: false }); // (4,1)
        params[13] = INexusPauseModule.SetPausedParam({ id: (uint256(1) << 32) | 3, priority: 10, paused: true }); // (1,3)
        params[14] = INexusPauseModule.SetPausedParam({ id: (uint256(3) << 32) | 2, priority: 45, paused: false }); // (3,2)
        params[15] = INexusPauseModule.SetPausedParam({ id: (uint256(2) << 32) | 3, priority: 5, paused: true }); // (2,3)
        aPauseModule.setPaused(params);

        // 16 tracked pathways (4×4 grid) covering every resolution mechanism:
        //   Pathway  Winner            Mechanism
        //   (1,1)    token=1 @ 60      beats comp-F@25, dest=1@40, global@30
        //   (1,2)    token=1 @ 60      beats dest=2@50, global@30
        //   (1,3)    token=1 @ 60      beats dest=3-F@20, comp-T@10, global@30
        //   (1,4)    dest=4 @ MAX      early return
        //   (2,1)    dest=1 @ 40       beats token=2-F@20, global@30
        //   (2,2)    comp(2,2) @ 55    beats dest=2@50, token=2-F@20, global@30
        //   (2,3)    global @ 30       beats dest=3-F@20, token=2-F@20, comp-T@5
        //   (2,4)    dest=4 @ MAX      early return
        //   (3,1)    dest=1 @ 40       beats token=3@30 tied with global@30
        //   (3,2)    dest=2 @ 50       beats comp-F@45, token=3@30, global@30
        //   (3,3)    global @ 30       tiebreaks token=3@30; beats dest=3-F@20, comp-F@15
        //   (3,4)    dest=4 @ MAX      early return
        //   (4,1)    token=4 @ 70      beats comp-F@35, dest=1@40, global@30
        //   (4,2)    token=4 @ 70      beats dest=2@50, global@30
        //   (4,3)    token=4 @ 70      beats dest=3-F@20, global@30
        //   (4,4)    dest=4 @ MAX      early return
        for (uint32 tokenId = 1; tokenId <= 4; tokenId++) {
            for (uint32 eid = 1; eid <= 4; eid++) {
                _trackedPathways.push(aNexus.getNexusId(tokenId, eid));
            }
        }

        for (uint256 i = 0; i < _trackedPathways.length; i++) {
            require(aPauseModule.isPaused(_trackedPathways[i]), "setUp: pathway must be paused");
        }

        _handler = new PauserInvariantHandler(INexusPauseModule(address(aPauseModule)));
        aNexus.grantRole(aPauseModule.PAUSER_ROLE(), address(_handler));

        targetContract(address(_handler));
    }

    /**
     * @dev Core security invariant: every initially-paused pathway remains paused after any
     *      sequence of `PAUSER_ROLE`-only calls with arbitrary `eid`, `tokenId`, `level`, `priority`,
     *      and `paused`.
     */
    function invariant_effectivePauseStateUnchanged() public view {
        for (uint256 i = 0; i < _trackedPathways.length; i++) {
            assertTrue(aPauseModule.isPaused(_trackedPathways[i]));
        }
    }

    /**
     * @dev Proves the handler can mutate underlying config state (the invariant test isn't
     *      trivially passing because all module calls revert).
     */
    function test_handler_MutatesUnderlyingState() public {
        assertEq(_handler.ghostMutations(), 0);

        // Strengthen global paused: priority 30 → 50.
        _handler.setPaused(0, 0, 0, 50, true);
        assertEq(_handler.ghostMutations(), 1, "global strengthen should mutate");

        // Add new paused config at an arbitrary dest-only key.
        _handler.setPaused(99, 0, 1, 10, true);
        assertEq(_handler.ghostMutations(), 2, "new dest-only paused should mutate");

        // Weaken composite-unpaused config: priority 25 → 5 (weakening unpaused requires `PAUSER_ROLE`).
        _handler.setPaused(1, 1, 3, 5, false);
        assertEq(_handler.ghostMutations(), 3, "weaken composite-unpaused should mutate");

        for (uint256 i = 0; i < _trackedPathways.length; i++) {
            assertTrue(aPauseModule.isPaused(_trackedPathways[i]));
        }
    }
}
