// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IZoneRouter } from "@layerzerolabs/zone-router-evm-contracts/contracts/interfaces/IZoneRouter.sol";
import { ZoneComposerMsgCodec } from "../../contracts/libs/ZoneComposerMsgCodec.sol";
import { ZoneComposerFixture } from "./ZoneComposer.t.sol";

contract ZoneComposerInvariantTest is ZoneComposerFixture {
    struct Credit {
        bytes32 guid;
        bytes message;
        uint256 amount;
        uint8 status;
        uint8 kind;
    }

    Credit[] internal credits;
    uint256 internal landed;
    uint256 internal forwarded;
    uint256 internal rescued;

    function setUp() public virtual override {
        super.setUp();
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = this.act.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
        targetContract(address(this));
    }

    function act(uint8 _operation, uint96 _amount, uint256 _index) public {
        uint256 operation = bound(_operation, 0, 6);
        if (operation < 3) {
            if (landed >= RESERVE - 1 ether) return;
            uint256 amount = bound(_amount, 1e12, 1 ether);
            bool malformed = operation == 1;
            (bytes32 guid, bytes memory message, uint256 credited) = _land(
                amount,
                malformed
                    ? bytes(hex"01")
                    : operation == 2
                        ? ZoneComposerMsgCodec.encode(999, RECIPIENT)
                        : _payload()
            );
            credits.push(Credit(guid, message, credited, 0, uint8(operation)));
            landed += credited;
            return;
        }
        bool routable = router.zonePeers(999).length != 0;
        if (operation == 5) {
            router.setZonePeer(999, routable ? bytes("") : RECIPIENT);
            return;
        }
        if (credits.length == 0) return;
        Credit storage credit = credits[bound(_index, 0, credits.length - 1)];
        if (operation == 3 && credit.status == 0) {
            _deliver(credit.guid, credit.message);
            if (credit.kind == 1 || (credit.kind == 2 && !routable)) {
                credit.status = 1;
            } else {
                credit.status = 2;
                forwarded += credit.amount;
            }
        } else if (operation == 4 && credit.status == 1) {
            composer.rescue(credit.guid, user);
            credit.status = 4;
            rescued += credit.amount;
        } else if (operation == 6 && credit.status == 1 && credit.kind == 2) {
            if (!routable) {
                vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, uint64(999), bytes("")));
            }
            composer.retry(credit.guid, 999, RECIPIENT, "");
            if (routable) {
                credit.status = 2;
                forwarded += credit.amount;
            }
        }
    }

    function invariant_creditConservation() public view {
        uint256 pending;
        uint256 cached;
        for (uint256 i; i < credits.length; ++i) {
            Credit storage credit = credits[i];
            if (credit.status == 0) pending += credit.amount;
            if (credit.status == 1) cached += credit.amount;
            assertEq(composer.rescuableMessages(credit.guid), credit.status == 1 ? credit.amount : 0);
            assertEq(
                composer.retryableMessages(credit.guid),
                credit.status == 1 && credit.kind == 2 ? keccak256(abi.encode(uint64(999), RECIPIENT, "")) : bytes32(0)
            );
            assertEq(
                endpoint.composeQueue(address(oftB), address(composer), credit.guid, 0),
                credit.status == 0 ? keccak256(credit.message) : bytes32(uint256(1))
            );
        }
        assertEq(tokenB.balanceOf(address(composer)), pending + cached);
        assertEq(tokenB.balanceOf(user), rescued);
        assertEq(tokenB.balanceOf(address(router)), forwarded);
        assertEq(tokenB.totalSupply(), landed);
        assertEq(landed, pending + cached + forwarded + rescued);
        assertEq(tokenB.allowance(address(composer), address(router)), type(uint256).max);
    }
}
