// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {TestingGas} from "../contracts/TestingGas.sol";

contract DeployTestingGas is Script {
    address constant FEE_RECIPIENT = 0x5Bce25397eEfbc76f6479e6838c00a5115dbEA4c;

    function run() external returns (TestingGas deployed) {
        vm.startBroadcast();
        deployed = new TestingGas(FEE_RECIPIENT);
        vm.stopBroadcast();
    }
}
