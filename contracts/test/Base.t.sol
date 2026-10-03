// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Symbolon} from "../src/Symbolon.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

abstract contract SymbolonBase is Test {
    MockUSDC internal usdc;
    Symbolon internal s;

    address internal admin = makeAddr("admin");
    address internal approver = makeAddr("approver");
    address internal agent = makeAddr("agent");
    address internal witness = makeAddr("witness");
    address internal cosigner = makeAddr("cosigner");
    address internal guardian = makeAddr("guardian");
    address internal vendor = makeAddr("vendor");
    address internal evil = makeAddr("evil");
    address internal mintDeposit = makeAddr("mintDeposit");

    bytes32 internal constant VENDOR_ID = keccak256("Supplier:ACME-001");
    uint128 internal constant THRESHOLD = 1_000e6; // cosign above $1,000
    uint256 internal constant PERIOD_CAP = 10_000e6; // $10,000 per day
    uint64 internal constant PERIOD = 1 days;
    uint64 internal constant COOLDOWN = 2 days;
    uint64 internal constant GRACE = 3 days;
    uint256 internal constant T0 = 1_790_000_000;

    function setUp() public virtual {
        vm.warp(T0);
        vm.roll(100);
        usdc = new MockUSDC();
        s = new Symbolon(IERC20Minimal(address(usdc)), admin, THRESHOLD, PERIOD_CAP, PERIOD, COOLDOWN, GRACE);
        vm.startPrank(admin);
        s.grantRole(s.APPROVER(), approver);
        s.grantRole(s.AGENT(), agent);
        s.grantRole(s.WITNESS(), witness);
        s.grantRole(s.COSIGNER(), cosigner);
        s.grantRole(s.GUARDIAN(), guardian);
        s.setMintDeposit(mintDeposit);
        vm.stopPrank();

        vm.prank(approver);
        s.setPayee(VENDOR_ID, vendor);
        vm.warp(T0 + COOLDOWN); // the vendor's wallet is long-established
    }

    function _id(string memory erpName) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("Purchase Invoice:", erpName));
    }

    function _register(bytes32 id, uint128 amount) internal {
        vm.prank(approver);
        s.registerObligation(id, keccak256(abi.encode(id, "doc")), VENDOR_ID, amount, uint64(block.timestamp), uint64(block.timestamp + 30 days));
    }

    function _fund(uint256 amount) internal {
        usdc.mint(address(s), amount);
    }

    function _witness(bytes32 id, uint128 amount) internal {
        vm.prank(witness);
        s.attestWitness(id, amount, keccak256(abi.encode("fundingTx", id)), keccak256(abi.encode("mintRecord", id)));
    }

    function _decide(bytes32 id, Symbolon.Action action) internal {
        vm.prank(agent);
        s.commitDecision(id, action, keccak256(abi.encode("decision", id, action)));
        vm.roll(block.number + 1);
    }

    /// @dev register + fund + witness + decide(Pay): the happy path up to release
    function _ready(bytes32 id, uint128 amount) internal {
        _register(id, amount);
        _fund(amount);
        _witness(id, amount);
        _decide(id, Symbolon.Action.Pay);
    }
}
