// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ZoneRouter } from "../../../contracts/ZoneRouter.sol";

contract MockZoneRouterV2 is ZoneRouter {
    function version() public pure returns (uint256 value) {
        return 2;
    }
}
