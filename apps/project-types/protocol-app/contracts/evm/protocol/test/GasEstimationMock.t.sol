// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import { OAppMock } from "./mocks/AppMock.sol";
import { EndpointV2lzReceiveGasMeasuringFixture } from "./utils/GasEstimation.t.sol";

contract GasEstimationMock is EndpointV2lzReceiveGasMeasuringFixture {
    OAppMock internal oapp;

    function setUp() public override {
        super.setUp();

        oapp = new OAppMock(address(endpoint));
    }

    function getMessage() internal pure override returns (bytes memory) {
        return "foo";
    }

    function getContractAddress() internal view override returns (address) {
        return address(oapp);
    }
}
