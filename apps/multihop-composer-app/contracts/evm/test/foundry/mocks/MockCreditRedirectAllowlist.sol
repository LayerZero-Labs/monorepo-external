// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ICreditRedirectAllowlist } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirectAllowlist.sol";

/// @dev Allowlists no one, so an OFT with credit redirect enabled redirects every credit to its escrow.
contract MockCreditRedirectAllowlist is ICreditRedirectAllowlist {
    function isAllowlisted(address) external pure returns (bool isUserAllowlisted) {
        return false;
    }
}
