// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Symbolon} from "../../src/Symbolon.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Drives Symbolon with every actor, in any order, including the adversarial ones:
///         retries, payee swaps, short witnesses, out-of-window releases, surplus grabs.
contract Handler is Test {
    Symbolon public s;
    MockUSDC public usdc;
    address public approver;
    address public agent;
    address public witness;
    address public cosigner;
    address public mintDeposit;

    bytes32[] public ids;
    bytes32[3] public payeeIds = [keccak256("P0"), keccak256("P1"), keccak256("P2")];
    address[4] public wallets;

    // ghost accounting
    mapping(bytes32 => uint256) public paidCount;
    mapping(bytes32 => address) public paidTo;
    mapping(address => uint256) public ghostReceived;
    uint256 public ghostReleasedSum;
    uint256 public ghostRedeemed;
    uint256 public ghostFunded;
    uint256 public releaseCalls;
    uint256 public releaseSuccesses;

    constructor(Symbolon s_, MockUSDC usdc_, address approver_, address agent_, address witness_, address cosigner_, address mintDeposit_)
    {
        s = s_;
        usdc = usdc_;
        approver = approver_;
        agent = agent_;
        witness = witness_;
        cosigner = cosigner_;
        mintDeposit = mintDeposit_;
        wallets = [makeAddr("w0"), makeAddr("w1"), makeAddr("w2"), makeAddr("attacker")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(approver);
            s.setPayee(payeeIds[i], wallets[i]);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function register(uint256 payeeSeed, uint128 amount, uint32 nbOffset, uint32 window) external {
        amount = uint128(bound(amount, 1, 3_000e6));
        uint64 nb = uint64(block.timestamp) + uint64(bound(nbOffset, 0, 5 days));
        uint64 due = nb + uint64(bound(window, 0, 20 days));
        bytes32 id = keccak256(abi.encode("inv", ids.length));
        vm.prank(approver);
        try s.registerObligation(id, keccak256(abi.encode(id)), payeeIds[payeeSeed % 3], amount, nb, due) {
            ids.push(id);
        } catch {}
    }

    /// @notice The honest end-to-end flow in one step, so the campaign reaches real payments and then
    ///         attacks them (retries, swaps, cancels) with the other actions.
    function payInFull(uint256 payeeSeed, uint128 amount, uint8 retries) external {
        amount = uint128(bound(amount, 1, 1_000e6));
        bytes32 id = keccak256(abi.encode("inv", ids.length));
        bytes32 pid = payeeIds[payeeSeed % 3];
        vm.prank(approver);
        try s.registerObligation(id, keccak256(abi.encode(id)), pid, amount, uint64(block.timestamp), uint64(block.timestamp) + 10 days) {
            ids.push(id);
        } catch {
            return;
        }
        usdc.mint(address(s), amount);
        ghostFunded += amount;
        vm.prank(witness);
        s.attestWitness(id, amount, bytes32(payeeSeed), keccak256(abi.encode(id, amount)));
        vm.prank(agent);
        s.commitDecision(id, Symbolon.Action.Pay, keccak256(abi.encode("pay", id)));
        vm.roll(block.number + 1);
        this.release(ids.length - 1, retries);
    }

    function fund(uint128 amount) external {
        amount = uint128(bound(amount, 0, 5_000e6));
        usdc.mint(address(s), amount);
        ghostFunded += amount;
    }

    function attest(uint256 seed, uint128 amount, bool exact) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        uint128 owed = s.getObligation(id).amount;
        uint128 a = exact ? owed : uint128(bound(amount, 1, 6_000e6));
        vm.prank(witness);
        try s.attestWitness(id, a, bytes32(seed), keccak256(abi.encode(id, a))) {} catch {}
    }

    function decide(uint256 seed, uint8 action) external {
        if (ids.length == 0) return;
        vm.prank(agent);
        try s.commitDecision(_pick(seed), Symbolon.Action(bound(action, 1, 3)), keccak256(abi.encode(seed, action))) {} catch {}
    }

    function cosign(uint256 seed) external {
        if (ids.length == 0) return;
        vm.prank(cosigner);
        try s.cosign(_pick(seed)) {} catch {}
    }

    function release(uint256 seed, uint8 retries) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        uint256 n = bound(retries, 1, 4); // the retry storm
        for (uint256 i; i < n; ++i) {
            Symbolon.Obligation memory o = s.getObligation(id);
            uint256 before = usdc.balanceOf(o.payee);
            releaseCalls++;
            vm.prank(agent);
            try s.release(id) {
                releaseSuccesses++;
                paidCount[id]++;
                paidTo[id] = o.payee;
                ghostReceived[o.payee] += o.amount;
                ghostReleasedSum += o.amount;
                require(usdc.balanceOf(o.payee) - before == o.amount, "paid wrong amount");
            } catch {}
        }
    }

    function swapPayee(uint256 payeeSeed, uint256 walletSeed) external {
        vm.prank(approver);
        s.setPayee(payeeIds[payeeSeed % 3], wallets[walletSeed % 4]);
    }

    function cancel(uint256 seed) external {
        if (ids.length == 0) return;
        vm.prank(approver);
        try s.cancel(_pick(seed)) {} catch {}
    }

    function expire(uint256 seed) external {
        if (ids.length == 0) return;
        try s.expire(_pick(seed)) {} catch {}
    }

    function redeem(uint256 amount) external {
        amount = bound(amount, 0, 10_000e6);
        vm.prank(agent);
        try s.redeemSurplus(amount, bytes32(amount)) {
            ghostRedeemed += amount;
        } catch {}
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 3 days));
        vm.roll(block.number + 1);
    }

    function roll() external {
        vm.roll(block.number + 1);
    }
}
