// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Symbolon} from "../src/Symbolon.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";

/// @notice Deploys Symbolon and wires one distinct key per role.
/// env: ADMIN_PK, APPROVER, AGENT, WITNESS, COSIGNER, GUARDIAN, MINT_DEPOSIT,
///      COSIGN_THRESHOLD, PERIOD_CAP, PERIOD_LENGTH, PAYEE_COOLDOWN, GRACE
contract Deploy is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (Symbolon s) {
        uint256 adminPk = vm.envUint("ADMIN_PK");
        address admin = vm.addr(adminPk);
        vm.startBroadcast(adminPk);
        s = new Symbolon(
            IERC20Minimal(ARC_USDC),
            admin,
            uint128(vm.envUint("COSIGN_THRESHOLD")),
            vm.envUint("PERIOD_CAP"),
            uint64(vm.envUint("PERIOD_LENGTH")),
            uint64(vm.envUint("PAYEE_COOLDOWN")),
            uint64(vm.envUint("GRACE"))
        );
        s.grantRole(s.APPROVER(), vm.envAddress("APPROVER"));
        s.grantRole(s.AGENT(), vm.envAddress("AGENT"));
        s.grantRole(s.WITNESS(), vm.envAddress("WITNESS"));
        s.grantRole(s.COSIGNER(), vm.envAddress("COSIGNER"));
        s.grantRole(s.GUARDIAN(), vm.envAddress("GUARDIAN"));
        s.setMintDeposit(vm.envAddress("MINT_DEPOSIT"));
        vm.stopBroadcast();

        string memory out = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory j = "d";
        vm.serializeAddress(j, "symbolon", address(s));
        vm.serializeAddress(j, "usdc", ARC_USDC);
        vm.serializeAddress(j, "admin", admin);
        vm.serializeAddress(j, "approver", vm.envAddress("APPROVER"));
        vm.serializeAddress(j, "agent", vm.envAddress("AGENT"));
        vm.serializeAddress(j, "witness", vm.envAddress("WITNESS"));
        vm.serializeAddress(j, "cosigner", vm.envAddress("COSIGNER"));
        vm.serializeAddress(j, "guardian", vm.envAddress("GUARDIAN"));
        vm.serializeAddress(j, "mintDeposit", vm.envAddress("MINT_DEPOSIT"));
        vm.serializeUint(j, "chainId", block.chainid);
        string memory json = vm.serializeUint(j, "deployBlock", block.number);
        vm.writeJson(json, out);
        console2.log("Symbolon", address(s));
    }
}
