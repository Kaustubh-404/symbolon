// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

/// @title Symbolon
/// @notice A treasury that pays an obligation only when two independent halves fit:
///         the document (registered by a human approver from the system of record) and
///         the witness (an attestation, signed by a key the agent does not hold, that the
///         funding for this obligation really arrived).
///
///         The agent decides *whether*, *when* and *how* to pay. Its decision is committed
///         as a hash before any money moves and is an INPUT to release, never the release
///         condition. Everything the agent cannot be trusted with is enforced here.
///
/// @dev    USDC on Arc is read through its ERC-20 view (6 decimals). Native USDC (18 decimals)
///         is never handled by this contract. There is no payable function.
contract Symbolon {
    // ─────────────────────────────────────────────────────────────── types

    enum Status {
        None,
        Registered,
        Released,
        Cancelled,
        Expired
    }

    enum Action {
        None,
        Pay,
        Hold,
        Escalate
    }

    struct Obligation {
        // the document half
        bytes32 docHash; // keccak of the canonical system-of-record document + attachment hash
        bytes32 payeeId; // vendor / employee id in the system of record
        address payee; // payee wallet snapshotted at registration; must still match at release
        uint128 amount; // USDC, 6 decimals
        uint64 notBefore; // earliest pay time (unix seconds)
        uint64 dueBy; // latest pay time; after dueBy + grace anyone may expire it
        Status status;
        // the agent's input
        Action action;
        uint64 decidedBlock;
        bytes32 decisionHash; // keccak of the full decision record served off-chain
        // the witness half
        bytes32 witnessDigest; // sha256 of the raw ledger evidence (e.g. the Circle Mint API record)
        bytes32 fundingRef; // e.g. the on-chain tx hash that delivered the funds
        uint128 witnessedAmount;
        // the human above the threshold
        bool cosigned;
    }

    struct Payee {
        address wallet;
        uint64 changedAt;
    }

    // ─────────────────────────────────────────────────────────────── errors
    // Every refusal is named. `check(id)` returns exactly the error `release(id)` would revert with.

    error NotAuthorized(bytes32 role, address account);
    error RoleConflict(bytes32 role, bytes32 heldRole, address account);
    error ZeroAddress();
    error Paused();

    error ConflictingRegistration(bytes32 id);
    error InvalidWindow(uint64 notBefore, uint64 dueBy);
    error ZeroAmount();
    error UnknownPayee(bytes32 payeeId);

    error NotRegistered(bytes32 id);
    error AlreadySettled(bytes32 id, Status status);
    error NoDecisionCommitted(bytes32 id);
    error DecisionNotPay(bytes32 id, Action action);
    error DecisionSameBlock(bytes32 id, uint64 decidedBlock);
    error WitnessMissing(bytes32 id);
    error WitnessMismatch(bytes32 id, uint128 witnessed, uint128 owed);
    error AlreadyWitnessed(bytes32 id);
    error Unfunded(uint256 balance, uint256 reservedAfter);
    error TooEarly(bytes32 id, uint64 notBefore);
    error PastDue(bytes32 id, uint64 deadline);
    error NotYetExpirable(bytes32 id, uint64 deadline);
    error PayeeMismatch(bytes32 id, address registered, address current);
    error PayeeChangedRecently(address payee, uint64 cooldownEnds);
    error NeedsCosign(bytes32 id, uint128 amount, uint128 threshold);
    error OverPeriodCap(uint256 spentAfter, uint256 cap);
    error RedeemExceedsSurplus(uint256 amount, uint256 surplus);
    error TransferFailed();

    // ─────────────────────────────────────────────────────────────── events

    event RoleGranted(bytes32 indexed role, address indexed account);
    event RoleRevoked(bytes32 indexed role, address indexed account);
    event PayeeSet(bytes32 indexed payeeId, address indexed wallet, uint64 cooldownEnds);
    event ObligationRegistered(
        bytes32 indexed id, bytes32 indexed payeeId, address payee, uint128 amount, uint64 notBefore, uint64 dueBy, bytes32 docHash
    );
    event DecisionCommitted(bytes32 indexed id, Action action, bytes32 decisionHash);
    event WitnessAttested(bytes32 indexed id, uint128 amount, bytes32 fundingRef, bytes32 witnessDigest);
    event Cosigned(bytes32 indexed id, address indexed cosigner);
    event Released(bytes32 indexed id, address indexed payee, uint128 amount, bytes32 decisionHash, bytes32 witnessDigest);
    event Cancelled(bytes32 indexed id);
    event Expired(bytes32 indexed id);
    event SurplusRedeemed(address indexed to, uint256 amount, bytes32 decisionHash);
    event ParamsSet(uint128 cosignThreshold, uint256 periodCap, uint64 periodLength, uint64 payeeCooldown, uint64 grace);
    event MintDepositSet(address indexed mintDeposit);
    event PausedSet(bool paused);

    // ─────────────────────────────────────────────────────────────── roles

    bytes32 public constant ADMIN = keccak256("ADMIN"); // the owner: sets params and roles
    bytes32 public constant APPROVER = keccak256("APPROVER"); // a human, via the system of record
    bytes32 public constant AGENT = keccak256("AGENT"); // the model's signer
    bytes32 public constant WITNESS = keccak256("WITNESS"); // reads the ledger the agent does not own
    bytes32 public constant COSIGNER = keccak256("COSIGNER"); // a human above the threshold
    bytes32 public constant GUARDIAN = keccak256("GUARDIAN"); // may pause, may not move funds

    mapping(bytes32 role => mapping(address => bool)) public hasRole;

    // ─────────────────────────────────────────────────────────────── state

    IERC20Minimal public immutable usdc;

    mapping(bytes32 id => Obligation) internal _obligations;
    mapping(bytes32 payeeId => Payee) public payees;

    uint256 public reserved; // witnessed and not yet released/cancelled/expired
    uint256 public totalReleased;
    uint256 public releasedCount;

    uint128 public cosignThreshold;
    uint256 public periodCap;
    uint64 public periodLength;
    uint64 public payeeCooldown;
    uint64 public grace;
    address public mintDeposit; // the only address surplus may be redeemed to (a Circle Mint deposit address)
    bool public paused;

    mapping(uint256 period => uint256) public spentInPeriod;

    // ─────────────────────────────────────────────────────────────── setup

    constructor(
        IERC20Minimal usdc_,
        address admin,
        uint128 cosignThreshold_,
        uint256 periodCap_,
        uint64 periodLength_,
        uint64 payeeCooldown_,
        uint64 grace_
    ) {
        if (address(usdc_) == address(0) || admin == address(0)) revert ZeroAddress();
        usdc = usdc_;
        hasRole[ADMIN][admin] = true;
        emit RoleGranted(ADMIN, admin);
        _setParams(cosignThreshold_, periodCap_, periodLength_, payeeCooldown_, grace_);
    }

    modifier only(bytes32 role) {
        if (!hasRole[role][msg.sender]) revert NotAuthorized(role, msg.sender);
        _;
    }

    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    /// @notice Separation of duties is enforced here, not by convention: the agent can never also be
    ///         the approver, the witness or the cosigner, and the witness can never approve or cosign.
    function grantRole(bytes32 role, address account) external only(ADMIN) {
        if (account == address(0)) revert ZeroAddress();
        _assertNoConflict(role, account);
        hasRole[role][account] = true;
        emit RoleGranted(role, account);
    }

    function revokeRole(bytes32 role, address account) external only(ADMIN) {
        hasRole[role][account] = false;
        emit RoleRevoked(role, account);
    }

    function setParams(uint128 cosignThreshold_, uint256 periodCap_, uint64 periodLength_, uint64 payeeCooldown_, uint64 grace_)
        external
        only(ADMIN)
    {
        _setParams(cosignThreshold_, periodCap_, periodLength_, payeeCooldown_, grace_);
    }

    function setMintDeposit(address mintDeposit_) external only(ADMIN) {
        if (mintDeposit_ == address(0)) revert ZeroAddress();
        mintDeposit = mintDeposit_;
        emit MintDepositSet(mintDeposit_);
    }

    function setPaused(bool paused_) external {
        // a guardian may stop the agent; only the admin may restart it
        if (paused_) {
            if (!hasRole[GUARDIAN][msg.sender] && !hasRole[ADMIN][msg.sender]) revert NotAuthorized(GUARDIAN, msg.sender);
        } else if (!hasRole[ADMIN][msg.sender]) {
            revert NotAuthorized(ADMIN, msg.sender);
        }
        paused = paused_;
        emit PausedSet(paused_);
    }

    // ─────────────────────────────────────────────────────────────── the document half (humans)

    /// @notice Set or change a payee's wallet. A change starts a cooldown during which nothing
    ///         may be released to this payee: the "our bank details have changed" defence.
    function setPayee(bytes32 payeeId, address wallet) external only(APPROVER) {
        if (wallet == address(0)) revert ZeroAddress();
        Payee storage p = payees[payeeId];
        if (p.wallet == wallet) return; // idempotent: no new cooldown for a no-op
        p.wallet = wallet;
        p.changedAt = uint64(block.timestamp);
        emit PayeeSet(payeeId, wallet, uint64(block.timestamp) + payeeCooldown);
    }

    /// @notice Register an obligation from the system of record. Idempotent: re-registering the same
    ///         id with identical terms returns `false` and changes nothing; different terms revert.
    /// @return created true if this call created the obligation (the per-row idempotency signal)
    function registerObligation(bytes32 id, bytes32 docHash, bytes32 payeeId, uint128 amount, uint64 notBefore, uint64 dueBy)
        public
        only(APPROVER)
        notPaused
        returns (bool created)
    {
        Obligation storage o = _obligations[id];
        address wallet = payees[payeeId].wallet;
        if (o.status != Status.None) {
            if (o.docHash == docHash && o.payeeId == payeeId && o.amount == amount && o.notBefore == notBefore && o.dueBy == dueBy)
            {
                return false;
            }
            revert ConflictingRegistration(id);
        }
        if (amount == 0) revert ZeroAmount();
        if (dueBy < notBefore) revert InvalidWindow(notBefore, dueBy);
        if (wallet == address(0)) revert UnknownPayee(payeeId);

        o.docHash = docHash;
        o.payeeId = payeeId;
        o.payee = wallet;
        o.amount = amount;
        o.notBefore = notBefore;
        o.dueBy = dueBy;
        o.status = Status.Registered;
        emit ObligationRegistered(id, payeeId, wallet, amount, notBefore, dueBy, docHash);
        return true;
    }

    struct Registration {
        bytes32 id;
        bytes32 docHash;
        bytes32 payeeId;
        uint128 amount;
        uint64 notBefore;
        uint64 dueBy;
    }

    /// @notice Batch registration for a sync from the system of record; one idempotency signal per row.
    function registerBatch(Registration[] calldata rows) external returns (bool[] memory created) {
        created = new bool[](rows.length);
        for (uint256 i; i < rows.length; ++i) {
            Registration calldata r = rows[i];
            created[i] = registerObligation(r.id, r.docHash, r.payeeId, r.amount, r.notBefore, r.dueBy);
        }
    }

    function cancel(bytes32 id) external only(APPROVER) {
        Obligation storage o = _obligations[id];
        if (o.status == Status.None) revert NotRegistered(id);
        if (o.status != Status.Registered) revert AlreadySettled(id, o.status);
        o.status = Status.Cancelled;
        reserved -= o.witnessedAmount;
        emit Cancelled(id);
    }

    function cosign(bytes32 id) external only(COSIGNER) {
        Obligation storage o = _obligations[id];
        if (o.status == Status.None) revert NotRegistered(id);
        if (o.status != Status.Registered) revert AlreadySettled(id, o.status);
        o.cosigned = true;
        emit Cosigned(id, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────── the agent's input

    /// @notice The agent commits its decision before money moves. Recommitting is allowed (the agent may
    ///         change its mind), and resets the one-block delay. `Escalate` forces a human cosign.
    function commitDecision(bytes32 id, Action action, bytes32 decisionHash) external only(AGENT) notPaused {
        Obligation storage o = _obligations[id];
        if (o.status == Status.None) revert NotRegistered(id);
        if (o.status != Status.Registered) revert AlreadySettled(id, o.status);
        o.action = action;
        o.decisionHash = decisionHash;
        o.decidedBlock = uint64(block.number);
        emit DecisionCommitted(id, action, decisionHash);
    }

    // ─────────────────────────────────────────────────────────────── the witness half

    /// @notice The witness attests that funding for this obligation arrived, citing the evidence.
    ///         The attested amount is reserved against the vault's real balance, so a witness cannot
    ///         attest money the contract does not hold.
    function attestWitness(bytes32 id, uint128 amount, bytes32 fundingRef, bytes32 witnessDigest) external only(WITNESS) {
        Obligation storage o = _obligations[id];
        if (o.status == Status.None) revert NotRegistered(id);
        if (o.status != Status.Registered) revert AlreadySettled(id, o.status);
        if (o.witnessDigest != bytes32(0)) revert AlreadyWitnessed(id);
        if (amount == 0) revert ZeroAmount();
        uint256 reservedAfter = reserved + amount;
        uint256 bal = usdc.balanceOf(address(this));
        if (bal < reservedAfter) revert Unfunded(bal, reservedAfter);
        reserved = reservedAfter;
        o.witnessedAmount = amount;
        o.fundingRef = fundingRef;
        o.witnessDigest = witnessDigest;
        emit WitnessAttested(id, amount, fundingRef, witnessDigest);
    }

    // ─────────────────────────────────────────────────────────────── release

    /// @notice Dry run: returns the exact revert data `release(id)` would produce now, or empty bytes.
    function check(bytes32 id) external view returns (bytes memory reason) {
        return _check(id);
    }

    /// @notice Pay the registered payee the registered amount. The agent chooses the moment; the
    ///         contract decides whether the moment is allowed.
    function release(bytes32 id) external only(AGENT) {
        bytes memory err = _check(id);
        if (err.length != 0) {
            assembly {
                revert(add(err, 32), mload(err))
            }
        }
        Obligation storage o = _obligations[id];
        uint128 amount = o.amount;
        o.status = Status.Released; // effects before the transfer: a reentrant or retried call sees AlreadySettled
        reserved -= o.witnessedAmount;
        spentInPeriod[_period()] += amount;
        totalReleased += amount;
        releasedCount += 1;
        if (!usdc.transfer(o.payee, amount)) revert TransferFailed();
        emit Released(id, o.payee, amount, o.decisionHash, o.witnessDigest);
    }

    /// @notice Anyone may expire an obligation nobody paid by `dueBy + grace`, freeing its reservation.
    function expire(bytes32 id) external {
        Obligation storage o = _obligations[id];
        if (o.status == Status.None) revert NotRegistered(id);
        if (o.status != Status.Registered) revert AlreadySettled(id, o.status);
        uint64 deadline = o.dueBy + grace;
        if (block.timestamp <= deadline) revert NotYetExpirable(id, deadline);
        o.status = Status.Expired;
        reserved -= o.witnessedAmount;
        emit Expired(id);
    }

    /// @notice The agent may return unreserved surplus, and only to the Circle Mint deposit address
    ///         (where it is redeemed to dollars). It cannot send surplus anywhere else.
    function redeemSurplus(uint256 amount, bytes32 decisionHash) external only(AGENT) notPaused {
        uint256 s = surplus();
        if (amount > s) revert RedeemExceedsSurplus(amount, s);
        if (mintDeposit == address(0)) revert ZeroAddress();
        if (!usdc.transfer(mintDeposit, amount)) revert TransferFailed();
        emit SurplusRedeemed(mintDeposit, amount, decisionHash);
    }

    // ─────────────────────────────────────────────────────────────── views

    function getObligation(bytes32 id) external view returns (Obligation memory) {
        return _obligations[id];
    }

    function surplus() public view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        return bal > reserved ? bal - reserved : 0;
    }

    function currentPeriod() external view returns (uint256) {
        return _period();
    }

    // ─────────────────────────────────────────────────────────────── internals

    function _check(bytes32 id) internal view returns (bytes memory) {
        if (paused) return abi.encodeWithSelector(Paused.selector);
        Obligation storage o = _obligations[id];
        if (o.status == Status.None) return abi.encodeWithSelector(NotRegistered.selector, id);
        if (o.status != Status.Registered) return abi.encodeWithSelector(AlreadySettled.selector, id, o.status);

        // the agent's input must exist, say Pay (or Escalate), and predate this block
        if (o.decisionHash == bytes32(0)) return abi.encodeWithSelector(NoDecisionCommitted.selector, id);
        if (o.action != Action.Pay && o.action != Action.Escalate) {
            return abi.encodeWithSelector(DecisionNotPay.selector, id, o.action);
        }
        if (block.number <= o.decidedBlock) return abi.encodeWithSelector(DecisionSameBlock.selector, id, o.decidedBlock);

        // the two halves must fit
        if (o.witnessDigest == bytes32(0)) return abi.encodeWithSelector(WitnessMissing.selector, id);
        if (o.witnessedAmount != o.amount) {
            return abi.encodeWithSelector(WitnessMismatch.selector, id, o.witnessedAmount, o.amount);
        }

        // the window the agent may choose inside
        if (block.timestamp < o.notBefore) return abi.encodeWithSelector(TooEarly.selector, id, o.notBefore);
        uint64 deadline = o.dueBy + grace;
        if (block.timestamp > deadline) return abi.encodeWithSelector(PastDue.selector, id, deadline);

        // the payee is the one the document named, and has not just been changed
        Payee storage p = payees[o.payeeId];
        if (p.wallet != o.payee) return abi.encodeWithSelector(PayeeMismatch.selector, id, o.payee, p.wallet);
        uint64 cooldownEnds = p.changedAt + payeeCooldown;
        if (block.timestamp < cooldownEnds) return abi.encodeWithSelector(PayeeChangedRecently.selector, o.payee, cooldownEnds);

        // a human above the threshold, or whenever the agent itself escalated
        if ((o.amount > cosignThreshold || o.action == Action.Escalate) && !o.cosigned) {
            return abi.encodeWithSelector(NeedsCosign.selector, id, o.amount, cosignThreshold);
        }

        // the budget the agent cannot talk its way past
        uint256 spentAfter = spentInPeriod[_period()] + o.amount;
        if (spentAfter > periodCap) return abi.encodeWithSelector(OverPeriodCap.selector, spentAfter, periodCap);

        return "";
    }

    function _period() internal view returns (uint256) {
        return block.timestamp / periodLength;
    }

    function _setParams(uint128 cosignThreshold_, uint256 periodCap_, uint64 periodLength_, uint64 payeeCooldown_, uint64 grace_)
        internal
    {
        if (periodLength_ == 0) revert InvalidWindow(0, 0);
        cosignThreshold = cosignThreshold_;
        periodCap = periodCap_;
        periodLength = periodLength_;
        payeeCooldown = payeeCooldown_;
        grace = grace_;
        emit ParamsSet(cosignThreshold_, periodCap_, periodLength_, payeeCooldown_, grace_);
    }

    function _assertNoConflict(bytes32 role, address account) internal view {
        bytes32[4] memory others;
        uint256 n;
        if (role == AGENT) {
            (others[0], others[1], others[2], others[3]) = (APPROVER, WITNESS, COSIGNER, ADMIN);
            n = 4;
        } else if (role == WITNESS) {
            (others[0], others[1], others[2]) = (AGENT, APPROVER, COSIGNER);
            n = 3;
        } else if (role == APPROVER || role == COSIGNER) {
            (others[0], others[1]) = (AGENT, WITNESS);
            n = 2;
        } else if (role == ADMIN) {
            others[0] = AGENT;
            n = 1;
        }
        for (uint256 i; i < n; ++i) {
            if (hasRole[others[i]][account]) revert RoleConflict(role, others[i], account);
        }
    }
}
