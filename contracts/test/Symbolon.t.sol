// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {SymbolonBase} from "./Base.t.sol";
import {Symbolon} from "../src/Symbolon.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";

contract SymbolonTest is SymbolonBase {
    // ═════════════════════════════════════════════════════════ happy path

    function test_release_paysRegisteredPayeeRegisteredAmount() public {
        bytes32 id = _id("PINV-0001");
        _ready(id, 500e6);
        vm.prank(agent);
        s.release(id);
        assertEq(usdc.balanceOf(vendor), 500e6);
        assertEq(usdc.balanceOf(address(s)), 0);
        assertEq(s.reserved(), 0);
        assertEq(s.totalReleased(), 500e6);
        assertEq(s.releasedCount(), 1);
        assertEq(uint8(s.getObligation(id).status), uint8(Symbolon.Status.Released));
    }

    function test_release_emitsBothHalves() public {
        bytes32 id = _id("PINV-0002");
        _ready(id, 10e6);
        Symbolon.Obligation memory o = s.getObligation(id);
        vm.expectEmit(true, true, false, true, address(s));
        emit Symbolon.Released(id, vendor, 10e6, o.decisionHash, o.witnessDigest);
        vm.prank(agent);
        s.release(id);
    }

    function test_check_isEmptyWhenReleasable() public {
        bytes32 id = _id("PINV-0003");
        _ready(id, 10e6);
        assertEq(s.check(id).length, 0);
    }

    // ═════════════════════════════════════════════════════════ refusal: idempotency

    function test_refuse_AlreadySettled_onRetry() public {
        bytes32 id = _id("PINV-0010");
        _ready(id, 100e6);
        _fund(100e6); // even with spare money sitting in the vault
        vm.prank(agent);
        s.release(id);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.AlreadySettled.selector, id, Symbolon.Status.Released));
        vm.prank(agent);
        s.release(id);
        assertEq(usdc.balanceOf(vendor), 100e6);
    }

    function test_retryStorm_onlyOnePays() public {
        bytes32 id = _id("PINV-0011");
        _ready(id, 100e6);
        _fund(1_000e6);
        uint256 ok;
        for (uint256 i; i < 5; ++i) {
            vm.prank(agent);
            try s.release(id) {
                ok++;
            } catch {}
        }
        assertEq(ok, 1);
        assertEq(usdc.balanceOf(vendor), 100e6);
    }

    function test_register_isIdempotent_sameTerms() public {
        bytes32 id = _id("PINV-0012");
        bytes32 doc = keccak256("doc");
        uint64 nb = uint64(block.timestamp);
        uint64 due = nb + 7 days;
        vm.startPrank(approver);
        assertTrue(s.registerObligation(id, doc, VENDOR_ID, 50e6, nb, due));
        assertFalse(s.registerObligation(id, doc, VENDOR_ID, 50e6, nb, due));
        vm.stopPrank();
    }

    function test_refuse_ConflictingRegistration() public {
        bytes32 id = _id("PINV-0013");
        bytes32 doc = keccak256("doc");
        uint64 nb = uint64(block.timestamp);
        vm.startPrank(approver);
        s.registerObligation(id, doc, VENDOR_ID, 50e6, nb, nb + 7 days);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.ConflictingRegistration.selector, id));
        s.registerObligation(id, doc, VENDOR_ID, 51e6, nb, nb + 7 days);
        vm.stopPrank();
    }

    function test_registerBatch_returnsPerRowSignal() public {
        Symbolon.Registration[] memory rows = new Symbolon.Registration[](3);
        uint64 nb = uint64(block.timestamp);
        rows[0] = Symbolon.Registration(_id("B-1"), keccak256("1"), VENDOR_ID, 1e6, nb, nb + 1 days);
        rows[1] = Symbolon.Registration(_id("B-2"), keccak256("2"), VENDOR_ID, 2e6, nb, nb + 1 days);
        rows[2] = rows[0]; // duplicate row in the same sync
        vm.prank(approver);
        bool[] memory created = s.registerBatch(rows);
        assertTrue(created[0]);
        assertTrue(created[1]);
        assertFalse(created[2]);
    }

    // ═════════════════════════════════════════════════════════ refusal: the agent's input

    function test_refuse_NotRegistered() public {
        bytes32 id = _id("GHOST");
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotRegistered.selector, id));
        vm.prank(agent);
        s.release(id);
    }

    function test_refuse_NoDecisionCommitted() public {
        bytes32 id = _id("PINV-0020");
        _register(id, 10e6);
        _fund(10e6);
        _witness(id, 10e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NoDecisionCommitted.selector, id));
        vm.prank(agent);
        s.release(id);
    }

    function test_refuse_DecisionNotPay_hold() public {
        bytes32 id = _id("PINV-0021");
        _register(id, 10e6);
        _fund(10e6);
        _witness(id, 10e6);
        _decide(id, Symbolon.Action.Hold);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.DecisionNotPay.selector, id, Symbolon.Action.Hold));
        vm.prank(agent);
        s.release(id);
    }

    function test_refuse_DecisionSameBlock() public {
        bytes32 id = _id("PINV-0022");
        _register(id, 10e6);
        _fund(10e6);
        _witness(id, 10e6);
        vm.startPrank(agent);
        s.commitDecision(id, Symbolon.Action.Pay, keccak256("d"));
        vm.expectRevert(abi.encodeWithSelector(Symbolon.DecisionSameBlock.selector, id, uint64(block.number)));
        s.release(id);
        vm.stopPrank();
    }

    function test_recommit_resetsDelay() public {
        bytes32 id = _id("PINV-0023");
        _ready(id, 10e6);
        vm.startPrank(agent);
        s.commitDecision(id, Symbolon.Action.Pay, keccak256("changed my mind"));
        vm.expectRevert(abi.encodeWithSelector(Symbolon.DecisionSameBlock.selector, id, uint64(block.number)));
        s.release(id);
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════ refusal: the witness half

    function test_refuse_WitnessMissing_phantomPayment() public {
        bytes32 id = _id("PINV-0030");
        _register(id, 10e6);
        _fund(10e6); // the money is even there; nobody independent saw it arrive for this bill
        _decide(id, Symbolon.Action.Pay);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.WitnessMissing.selector, id));
        vm.prank(agent);
        s.release(id);
    }

    function test_refuse_WitnessMismatch_shortFunded() public {
        bytes32 id = _id("PINV-0031");
        _register(id, 5_000e6);
        _fund(4_900e6);
        _witness(id, 4_900e6);
        _decide(id, Symbolon.Action.Pay);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.WitnessMismatch.selector, id, uint128(4_900e6), uint128(5_000e6)));
        vm.prank(agent);
        s.release(id);
    }

    function test_refuse_Unfunded_witnessCannotAttestMoneyTheVaultLacks() public {
        bytes32 id = _id("PINV-0032");
        _register(id, 10e6);
        _fund(9e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.Unfunded.selector, uint256(9e6), uint256(10e6)));
        vm.prank(witness);
        s.attestWitness(id, 10e6, bytes32(0), keccak256("x"));
    }

    function test_refuse_Unfunded_reservationsDoNotDoubleCount() public {
        bytes32 a = _id("PINV-0033a");
        bytes32 b = _id("PINV-0033b");
        _register(a, 10e6);
        _register(b, 10e6);
        _fund(10e6);
        _witness(a, 10e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.Unfunded.selector, uint256(10e6), uint256(20e6)));
        vm.prank(witness);
        s.attestWitness(b, 10e6, bytes32(0), keccak256("x"));
    }

    function test_refuse_AlreadyWitnessed() public {
        bytes32 id = _id("PINV-0034");
        _register(id, 10e6);
        _fund(20e6);
        _witness(id, 10e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.AlreadyWitnessed.selector, id));
        vm.prank(witness);
        s.attestWitness(id, 10e6, bytes32(0), keccak256("again"));
    }

    // ═════════════════════════════════════════════════════════ refusal: the window

    function test_refuse_TooEarly_readsTheTimestampArcEscrowIgnores() public {
        bytes32 id = _id("PINV-0040");
        uint64 nb = uint64(block.timestamp + 10 days);
        vm.prank(approver);
        s.registerObligation(id, keccak256("doc"), VENDOR_ID, 10e6, nb, nb + 20 days);
        _fund(10e6);
        _witness(id, 10e6);
        _decide(id, Symbolon.Action.Pay);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.TooEarly.selector, id, nb));
        vm.prank(agent);
        s.release(id);
        vm.warp(nb);
        vm.prank(agent);
        s.release(id);
        assertEq(usdc.balanceOf(vendor), 10e6);
    }

    function test_refuse_PastDue_andExpire() public {
        bytes32 id = _id("PINV-0041");
        _ready(id, 10e6);
        Symbolon.Obligation memory o = s.getObligation(id);
        uint64 deadline = o.dueBy + GRACE;
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotYetExpirable.selector, id, deadline));
        s.expire(id);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.PastDue.selector, id, deadline));
        vm.prank(agent);
        s.release(id);
        vm.prank(makeAddr("anyone"));
        s.expire(id);
        assertEq(s.reserved(), 0);
        assertEq(s.surplus(), 10e6);
    }

    function test_refuse_InvalidWindow() public {
        vm.expectRevert(abi.encodeWithSelector(Symbolon.InvalidWindow.selector, uint64(200), uint64(100)));
        vm.prank(approver);
        s.registerObligation(_id("W"), keccak256("doc"), VENDOR_ID, 1e6, 200, 100);
    }

    // ═════════════════════════════════════════════════════════ refusal: the payee

    function test_refuse_PayeeMismatch_bankDetailsChangedScam() public {
        bytes32 id = _id("PINV-0050");
        _ready(id, 10e6);
        // "URGENT: our bank details have changed" — someone gets the approver to update the wallet
        vm.prank(approver);
        s.setPayee(VENDOR_ID, evil);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.PayeeMismatch.selector, id, vendor, evil));
        vm.prank(agent);
        s.release(id);
        assertEq(usdc.balanceOf(evil), 0);
    }

    function test_refuse_PayeeChangedRecently_newObligationAfterChange() public {
        vm.prank(approver);
        s.setPayee(VENDOR_ID, evil);
        bytes32 id = _id("PINV-0051");
        _ready(id, 10e6);
        uint64 ends = uint64(block.timestamp) + COOLDOWN;
        vm.expectRevert(abi.encodeWithSelector(Symbolon.PayeeChangedRecently.selector, evil, ends));
        vm.prank(agent);
        s.release(id);
        vm.warp(ends);
        vm.prank(agent);
        s.release(id); // after the cooldown a human had time to notice; it pays
        assertEq(usdc.balanceOf(evil), 10e6);
    }

    function test_setPayee_noopDoesNotRestartCooldown() public {
        (, uint64 before) = s.payees(VENDOR_ID);
        vm.warp(block.timestamp + 1 days);
        vm.prank(approver);
        s.setPayee(VENDOR_ID, vendor);
        (, uint64 afterwards) = s.payees(VENDOR_ID);
        assertEq(before, afterwards);
    }

    function test_refuse_UnknownPayee() public {
        bytes32 unknown = keccak256("Supplier:NOBODY");
        vm.expectRevert(abi.encodeWithSelector(Symbolon.UnknownPayee.selector, unknown));
        vm.prank(approver);
        s.registerObligation(_id("U"), keccak256("doc"), unknown, 1e6, 0, 1);
    }

    // ═════════════════════════════════════════════════════════ refusal: humans above the threshold

    function test_refuse_NeedsCosign_aboveThreshold() public {
        bytes32 id = _id("PINV-0060");
        _ready(id, 5_000e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NeedsCosign.selector, id, uint128(5_000e6), THRESHOLD));
        vm.prank(agent);
        s.release(id);
        vm.prank(cosigner);
        s.cosign(id);
        vm.prank(agent);
        s.release(id);
        assertEq(usdc.balanceOf(vendor), 5_000e6);
    }

    function test_refuse_NeedsCosign_whenAgentEscalates() public {
        bytes32 id = _id("PINV-0061");
        _register(id, 10e6);
        _fund(10e6);
        _witness(id, 10e6);
        _decide(id, Symbolon.Action.Escalate);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NeedsCosign.selector, id, uint128(10e6), THRESHOLD));
        vm.prank(agent);
        s.release(id);
        vm.prank(cosigner);
        s.cosign(id);
        vm.prank(agent);
        s.release(id);
    }

    function test_atThreshold_noCosignNeeded() public {
        bytes32 id = _id("PINV-0062");
        _ready(id, THRESHOLD);
        vm.prank(agent);
        s.release(id);
    }

    // ═════════════════════════════════════════════════════════ refusal: the budget

    function test_refuse_OverPeriodCap() public {
        for (uint256 i; i < 10; ++i) {
            bytes32 id = keccak256(abi.encode("cap", i));
            _ready(id, 1_000e6);
            vm.prank(agent);
            s.release(id);
        }
        bytes32 last = _id("PINV-0070");
        _ready(last, 1e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.OverPeriodCap.selector, PERIOD_CAP + 1e6, PERIOD_CAP));
        vm.prank(agent);
        s.release(last);
        vm.warp(block.timestamp + PERIOD); // the next day's budget
        vm.prank(agent);
        s.release(last);
    }

    // ═════════════════════════════════════════════════════════ surplus redemption

    function test_redeemSurplus_onlyToMintDeposit_onlyUnreserved() public {
        bytes32 id = _id("PINV-0080");
        _register(id, 300e6);
        _fund(1_000e6);
        _witness(id, 300e6);
        assertEq(s.surplus(), 700e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.RedeemExceedsSurplus.selector, uint256(701e6), uint256(700e6)));
        vm.prank(agent);
        s.redeemSurplus(701e6, keccak256("d"));
        vm.prank(agent);
        s.redeemSurplus(700e6, keccak256("d"));
        assertEq(usdc.balanceOf(mintDeposit), 700e6);
        assertEq(usdc.balanceOf(address(s)), 300e6);
    }

    // ═════════════════════════════════════════════════════════ authority: who may do what

    function test_refuse_agentCannotRegister() public {
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.APPROVER(), agent));
        vm.prank(agent);
        s.registerObligation(_id("X"), keccak256("doc"), VENDOR_ID, 1e6, 0, 1);
    }

    function test_refuse_agentCannotWitness() public {
        bytes32 id = _id("PINV-0090");
        _register(id, 1e6);
        _fund(1e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.WITNESS(), agent));
        vm.prank(agent);
        s.attestWitness(id, 1e6, bytes32(0), keccak256("self-attest"));
    }

    function test_refuse_agentCannotCosign() public {
        bytes32 id = _id("PINV-0091");
        _register(id, 1e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.COSIGNER(), agent));
        vm.prank(agent);
        s.cosign(id);
    }

    function test_refuse_agentCannotChangePayee() public {
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.APPROVER(), agent));
        vm.prank(agent);
        s.setPayee(VENDOR_ID, evil);
    }

    function test_refuse_onlyAgentReleases() public {
        bytes32 id = _id("PINV-0092");
        _ready(id, 1e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.AGENT(), approver));
        vm.prank(approver);
        s.release(id);
    }

    function test_refuse_RoleConflict_agentCannotBecomeWitness() public {
        bytes32 witnessRole = s.WITNESS();
        bytes32 agentRole = s.AGENT();
        vm.expectRevert(abi.encodeWithSelector(Symbolon.RoleConflict.selector, witnessRole, agentRole, agent));
        vm.prank(admin);
        s.grantRole(witnessRole, agent);
    }

    function test_refuse_RoleConflict_witnessCannotBecomeApprover() public {
        bytes32 approverRole = s.APPROVER();
        bytes32 witnessRole = s.WITNESS();
        vm.expectRevert(abi.encodeWithSelector(Symbolon.RoleConflict.selector, approverRole, witnessRole, witness));
        vm.prank(admin);
        s.grantRole(approverRole, witness);
    }

    function test_refuse_RoleConflict_adminCannotBeAgent() public {
        bytes32 agentRole = s.AGENT();
        bytes32 adminRole = s.ADMIN();
        vm.expectRevert(abi.encodeWithSelector(Symbolon.RoleConflict.selector, agentRole, adminRole, admin));
        vm.prank(admin);
        s.grantRole(agentRole, admin);
    }

    // ═════════════════════════════════════════════════════════ pause

    function test_pause_guardianStops_onlyAdminRestarts() public {
        bytes32 id = _id("PINV-0100");
        _ready(id, 1e6);
        vm.prank(guardian);
        s.setPaused(true);
        vm.expectRevert(Symbolon.Paused.selector);
        vm.prank(agent);
        s.release(id);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.ADMIN(), guardian));
        vm.prank(guardian);
        s.setPaused(false);
        vm.prank(admin);
        s.setPaused(false);
        vm.prank(agent);
        s.release(id);
    }

    // ═════════════════════════════════════════════════════════ cancel

    function test_cancel_freesReservation_andBlocksRelease() public {
        bytes32 id = _id("PINV-0110");
        _ready(id, 10e6);
        vm.prank(approver);
        s.cancel(id);
        assertEq(s.reserved(), 0);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.AlreadySettled.selector, id, Symbolon.Status.Cancelled));
        vm.prank(agent);
        s.release(id);
    }

    function test_refuse_TransferFailed_rollsBackState() public {
        bytes32 id = _id("PINV-0120");
        _ready(id, 10e6);
        usdc.setFailTransfers(true);
        vm.expectRevert(Symbolon.TransferFailed.selector);
        vm.prank(agent);
        s.release(id);
        assertEq(uint8(s.getObligation(id).status), uint8(Symbolon.Status.Registered));
        usdc.setFailTransfers(false);
        vm.prank(agent);
        s.release(id);
    }

    // ═════════════════════════════════════════════════════════ dry run == release

    function test_check_matchesReleaseRevert_everyRefusal() public {
        bytes32 id = _id("PINV-0130");
        _register(id, 5_000e6);
        _fund(5_000e6);
        _assertCheckEqualsRevert(id); // NoDecisionCommitted
        _decide(id, Symbolon.Action.Pay);
        _assertCheckEqualsRevert(id); // WitnessMissing
        _witness(id, 5_000e6);
        _assertCheckEqualsRevert(id); // NeedsCosign
    }

    function _assertCheckEqualsRevert(bytes32 id) internal {
        bytes memory expected = s.check(id);
        assertGt(expected.length, 0);
        vm.prank(agent);
        (bool ok, bytes memory got) = address(s).call(abi.encodeCall(Symbolon.release, (id)));
        assertFalse(ok);
        assertEq(got, expected);
    }

    // ═════════════════════════════════════════════════════════ fuzz

    function testFuzz_neverPaysMoreThanRegistered(uint128 amount, uint128 extraFunding) public {
        amount = uint128(bound(amount, 1, THRESHOLD));
        extraFunding = uint128(bound(extraFunding, 0, 1e15));
        bytes32 id = _id("FUZZ");
        _ready(id, amount);
        _fund(extraFunding);
        vm.prank(agent);
        s.release(id);
        assertEq(usdc.balanceOf(vendor), amount);
        assertEq(usdc.balanceOf(address(s)), extraFunding);
    }

    function testFuzz_witnessMustMatchExactly(uint128 owed, uint128 witnessed) public {
        owed = uint128(bound(owed, 1, THRESHOLD));
        witnessed = uint128(bound(witnessed, 1, THRESHOLD));
        vm.assume(owed != witnessed);
        bytes32 id = _id("FUZZW");
        _register(id, owed);
        _fund(witnessed);
        _witness(id, witnessed);
        _decide(id, Symbolon.Action.Pay);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.WitnessMismatch.selector, id, witnessed, owed));
        vm.prank(agent);
        s.release(id);
    }

    function testFuzz_onlyAgentMayRelease(address caller) public {
        vm.assume(caller != agent);
        bytes32 id = _id("FUZZA");
        _ready(id, 1e6);
        vm.expectRevert(abi.encodeWithSelector(Symbolon.NotAuthorized.selector, s.AGENT(), caller));
        vm.prank(caller);
        s.release(id);
    }

    function testFuzz_releaseTiming(uint64 nbOffset, uint64 warpTo) public {
        nbOffset = uint64(bound(nbOffset, 0, 365 days));
        uint64 nb = uint64(block.timestamp) + nbOffset;
        uint64 due = nb + 30 days;
        warpTo = uint64(bound(warpTo, block.timestamp, uint256(due) + GRACE + 30 days));
        bytes32 id = _id("FUZZT");
        vm.prank(approver);
        s.registerObligation(id, keccak256("doc"), VENDOR_ID, 1e6, nb, due);
        _fund(1e6);
        _witness(id, 1e6);
        _decide(id, Symbolon.Action.Pay);
        vm.warp(warpTo);
        vm.prank(agent);
        (bool ok,) = address(s).call(abi.encodeCall(Symbolon.release, (id)));
        assertEq(ok, warpTo >= nb && warpTo <= due + GRACE);
    }
}
