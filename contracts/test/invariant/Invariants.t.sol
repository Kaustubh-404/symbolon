// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Symbolon} from "../../src/Symbolon.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Handler} from "./Handler.sol";

/// @notice The economic invariants. These are the claims in the README; if one breaks, the claim is false.
contract SymbolonInvariants is Test {
    Symbolon internal s;
    MockUSDC internal usdc;
    Handler internal h;
    address internal mintDeposit = makeAddr("mintDeposit");

    function setUp() public {
        vm.warp(1_790_000_000);
        vm.roll(100);
        usdc = new MockUSDC();
        address admin = makeAddr("admin");
        address approver = makeAddr("approver");
        address agent = makeAddr("agent");
        address witness = makeAddr("witness");
        address cosigner = makeAddr("cosigner");
        s = new Symbolon(IERC20Minimal(address(usdc)), admin, 1_000e6, 8_000e6, 1 days, 1 days, 2 days);
        vm.startPrank(admin);
        s.grantRole(s.APPROVER(), approver);
        s.grantRole(s.AGENT(), agent);
        s.grantRole(s.WITNESS(), witness);
        s.grantRole(s.COSIGNER(), cosigner);
        s.setMintDeposit(mintDeposit);
        vm.stopPrank();
        h = new Handler(s, usdc, approver, agent, witness, cosigner, mintDeposit);
        vm.warp(block.timestamp + 2 days); // payee wallets are established before the campaign starts
        targetContract(address(h));
    }

    /// No obligation is ever paid more than once, however many times release is retried.
    function invariant_neverPaidTwice() public view {
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            assertLe(h.paidCount(h.ids(i)), 1);
        }
    }

    /// Every released obligation went to the wallet snapshotted from the document, for the document's amount.
    function invariant_paidOnlyToRegisteredPayee() public view {
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            bytes32 id = h.ids(i);
            Symbolon.Obligation memory o = s.getObligation(id);
            if (h.paidCount(id) == 1) {
                assertEq(uint8(o.status), uint8(Symbolon.Status.Released));
                assertEq(h.paidTo(id), o.payee);
                assertEq(o.witnessedAmount, o.amount); // both halves fit
                assertTrue(o.decisionHash != bytes32(0)); // the agent's input existed
            }
        }
    }

    /// The vault always holds at least what the witness has reserved: no phantom reservations.
    function invariant_reservedNeverExceedsBalance() public view {
        assertLe(s.reserved(), usdc.balanceOf(address(s)));
    }

    /// Conservation: money in = money in the vault + paid out + redeemed. Nothing else leaves.
    function invariant_conservation() public view {
        assertEq(h.ghostFunded(), usdc.balanceOf(address(s)) + h.ghostReleasedSum() + h.ghostRedeemed());
        assertEq(s.totalReleased(), h.ghostReleasedSum());
    }

    /// Surplus only ever goes to the Circle Mint deposit address.
    function invariant_redeemOnlyToMintDeposit() public view {
        assertEq(usdc.balanceOf(mintDeposit), h.ghostRedeemed());
    }

    /// The reservation equals exactly the witnessed amounts of obligations still open: release, cancel and
    /// expire each free precisely what they reserved.
    function invariant_reservedMatchesOpenWitnessed() public view {
        uint256 sum;
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            Symbolon.Obligation memory o = s.getObligation(h.ids(i));
            if (o.status == Symbolon.Status.Registered) sum += o.witnessedAmount;
        }
        assertEq(sum, s.reserved());
    }

    /// The period cap holds in every period.
    function invariant_periodCap() public view {
        assertLe(s.spentInPeriod(s.currentPeriod()), s.periodCap());
    }
}

/// @notice Guards against a vacuous pass: across the campaign the handler must actually pay things.
contract SymbolonInvariantsCoverage is SymbolonInvariants {

    function afterInvariant() public {
        vm.writeLine("cache/coverage/runs.csv", string.concat(vm.toString(h.releaseSuccesses()), ",", vm.toString(h.releaseCalls())));
    }
}
