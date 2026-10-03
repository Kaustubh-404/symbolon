"""Chain logic without a network: fee policy, log chunking, ABI encoding (vs `cast calldata`), refusal decoding,
log decoding, and the nonce-safe sender's retry rules against a fake RPC."""

import unittest

from eth_account import Account

from symbolon_erpnext import chain as C
from symbolon_erpnext.refusals import decode_refusal

OID = "0x34e4b5eab3451713981cb4f60dd79a244690088c740ae9ac3b815f22cbc2a68c"
DOC = "0x5e585be2e696f1a268ba340d6b38d297ac2a9323d05b8e8e3ff6d198eb639cf1"
PID = "0xa11b374793949d0ea6b7f6f15bf22f460bf04379d29eec0c234987041e1bbf3d"
GWEI = 10**9


class TestFees(unittest.TestCase):
	def test_floor_and_double(self):
		self.assertEqual(C.fee_policy(0), (40 * GWEI, GWEI))  # base clamps to Arc's 20 gwei floor, x2
		self.assertEqual(C.fee_policy(10 * GWEI), (40 * GWEI, GWEI))
		self.assertEqual(C.fee_policy(21 * GWEI), (42 * GWEI, GWEI))
		self.assertEqual(C.fee_policy(100 * GWEI), (200 * GWEI, GWEI))
		self.assertGreaterEqual(C.fee_policy(None)[0], C.FEE_FLOOR)

	def test_bump_is_at_least_25_percent(self):
		mx, pr = C.bump_fees(40 * GWEI, GWEI, 20 * GWEI)
		self.assertGreaterEqual(mx, 50 * GWEI)
		self.assertGreaterEqual(pr, GWEI * 125 // 100)
		mx, _ = C.bump_fees(40 * GWEI, GWEI, 100 * GWEI)  # base fee spiked: fresh quote wins
		self.assertEqual(mx, 200 * GWEI)


class TestChunks(unittest.TestCase):
	def test_chunks_cover_exactly(self):
		r = C.chunk_ranges(100, 20_000)
		self.assertEqual(r[0], (100, 9_099))
		self.assertTrue(all(b - a + 1 <= 9_000 for a, b in r))
		self.assertEqual(r[-1][1], 20_000)
		self.assertTrue(all(r[i][1] + 1 == r[i + 1][0] for i in range(len(r) - 1)))
		self.assertEqual(C.chunk_ranges(5, 4), [])

	def test_chunk_cap(self):
		with self.assertRaises(ValueError):
			C.chunk_ranges(0, 10, 10_000)


class TestAbi(unittest.TestCase):
	def test_register_obligation_matches_cast(self):
		want = (
			"0xf0ba60a7" + OID[2:] + DOC[2:] + PID[2:]
			+ "000000000000000000000000000000000000000000000000000000004a817c80"
			+ "000000000000000000000000000000000000000000000000000000006abda280"
			+ "000000000000000000000000000000000000000000000000000000006ae680ff"
		)
		self.assertEqual(C.encode_call("registerObligation", [OID, DOC, PID, 1_250_000_000, 1790812800, 1793491199]), want)

	def test_register_batch_matches_cast(self):
		want = (
			"0x7b1bf716"
			+ "0000000000000000000000000000000000000000000000000000000000000020"
			+ "0000000000000000000000000000000000000000000000000000000000000001"
			+ OID[2:] + DOC[2:] + PID[2:]
			+ "000000000000000000000000000000000000000000000000000000004a817c80"
			+ "000000000000000000000000000000000000000000000000000000006abda280"
			+ "000000000000000000000000000000000000000000000000000000006ae680ff"
		)
		self.assertEqual(C.encode_call("registerBatch", [[(OID, DOC, PID, 1_250_000_000, 1790812800, 1793491199)]]), want)

	def test_released_topic_matches_cast(self):
		# cast keccak "Released(bytes32,address,uint128,bytes32,bytes32)"
		self.assertEqual(C.event_topic("Released"), "0x651771ec5952edfb6fb3b70710bead26fce0de671d12dc14b5d2a523ba408187")


class TestRefusals(unittest.TestCase):
	def test_payee_changed_recently(self):
		# cast calldata "PayeeChangedRecently(address,uint64)" 0x64C5…D710 1790812800
		r = decode_refusal("0x8d5e4bc000000000000000000000000064c5b8fbc01ba4466ec95b4c3b74efa34922d710000000000000000000000000000000000000000000000000000000006abda280")
		self.assertEqual(r["name"], "PayeeChangedRecently")
		self.assertIn("2026-10-01T00:00:00Z", r["human"])

	def test_already_settled(self):
		r = decode_refusal("0x5d21e815" + OID[2:] + "0" * 63 + "2")
		self.assertEqual(r["name"], "AlreadySettled")
		self.assertIn("released", r["human"])
		self.assertEqual(r["args"][0], OID)

	def test_empty_is_none_and_unknown_is_named(self):
		self.assertIsNone(decode_refusal("0x"))
		self.assertEqual(decode_refusal("0xdeadbeef")["name"], "Unknown")


class TestLogDecode(unittest.TestCase):
	def test_released(self):
		from eth_abi import encode

		payee = "0x64C5B8fbC01bA4466ec95b4C3b74EFa34922D710"
		log = {
			"topics": [C.event_topic("Released"), OID, "0x" + "00" * 12 + payee[2:].lower()],
			"data": "0x" + encode(["uint128", "bytes32", "bytes32"], [5_000_000, b"\x01" * 32, b"\x02" * 32]).hex(),
			"blockNumber": 7,
			"logIndex": 3,
			"transactionHash": "0x" + "ab" * 32,
		}
		d = C.decode_log(log)
		self.assertEqual(d["event"], "Released")
		self.assertEqual(d["args"]["id"], OID)
		self.assertEqual(d["args"]["payee"], payee)
		self.assertEqual(d["args"]["amount"], 5_000_000)

	def test_cancelled(self):
		d = C.decode_log({"topics": [C.event_topic("Cancelled"), OID], "data": "0x", "blockNumber": 1, "logIndex": 0, "transactionHash": "0x" + "cd" * 32})
		self.assertEqual((d["event"], d["args"]["id"]), ("Cancelled", OID))


# ─────────────────────────────────────────────────────────────── sender


class FakeEth:
	"""Mempool model with Arc's wedge: a tx under the base fee is accepted and never mines."""

	def __init__(self, base_fee=20 * GWEI, mine=True):
		self.base = base_fee
		self.mine = mine
		self.mined_nonce = 0  # next nonce to be mined ("latest" count)
		self.pool: dict[int, list[str]] = {}
		self.receipts: dict[str, dict] = {}
		self.sent: list[tuple[int, str, int]] = []  # (nonce, hash, maxFee)
		self.revert_estimate = None

	def nonce(self, addr, tag):
		if tag == "latest":
			return self.mined_nonce
		return max([self.mined_nonce] + [n + 1 for n in self.pool])

	def base_fee(self):
		return self.base

	def estimate_gas(self, tx):
		if self.revert_estimate:
			raise C.Reverted(bytes.fromhex(self.revert_estimate[2:]))
		return 100_000

	def send_raw(self, raw):
		import rlp
		from eth_utils import big_endian_to_int, keccak

		assert raw[0] == 2, "EIP-1559 (type 2) transactions only"
		fields = rlp.decode(raw[1:])  # [chainId, nonce, maxPriorityFee, maxFee, gas, to, value, data, accessList, v, r, s]
		assert big_endian_to_int(fields[0]) == 5042002
		h = "0x" + keccak(raw).hex()
		n, fee = big_endian_to_int(fields[1]), big_endian_to_int(fields[3])
		self.sent.append((n, h, fee))
		self.pool.setdefault(n, []).append(h)
		if self.mine and fee >= self.base and n == self.mined_nonce:
			self.receipts[h] = {"status": 1, "blockNumber": 100 + n, "logs": [], "transactionHash": h}
			self.mined_nonce += 1
			del self.pool[n]
		return h

	def receipt(self, h):
		return self.receipts.get(h)


def make_sender(eth, journal=None, **kw):
	acct = Account.create()  # throwaway key generated in memory, never written anywhere
	clock = {"t": 0.0}
	snd = C.NonceSafeSender(
		eth, acct.key.hex(), 5042002, journal or C.MemoryJournal(), receipt_timeout=3, poll_interval=1,
		sleep=lambda s: clock.__setitem__("t", clock["t"] + s), clock=lambda: clock["t"], **kw
	)
	return snd


TO = "0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9"


class TestSender(unittest.TestCase):
	def test_happy_path_journals_before_signing(self):
		eth, j = FakeEth(), C.MemoryJournal()
		snd = make_sender(eth, j)
		r = snd.send("register:x", TO, "0x1234")
		self.assertEqual(r.status, "Mined")
		self.assertFalse(r.deduplicated)
		# write-ahead order: Signing (no hash) -> Sent (hash recorded before broadcast) -> Mined
		self.assertEqual([w[1:] for w in j.writes], [("Signing", 0), ("Sent", 1), ("Mined", 1)])
		self.assertEqual(eth.sent[0][2], 40 * GWEI)  # 2 x base fee

	def test_retry_of_mined_intent_signs_nothing(self):
		eth, j = FakeEth(), C.MemoryJournal()
		snd = make_sender(eth, j)
		first = snd.send("register:x", TO, "0x1234")
		again = snd.send("register:x", TO, "0x1234")
		self.assertTrue(again.deduplicated)
		self.assertEqual(again.hash, first.hash)
		self.assertEqual(len(eth.sent), 1)

	def test_stuck_tx_replaced_at_same_nonce_with_higher_fee(self):
		eth = FakeEth(base_fee=20 * GWEI)
		j = C.MemoryJournal()
		snd = make_sender(eth, j, max_replacements=0)
		eth.base = 45 * GWEI  # base fee rises above our first quote after we read it
		orig_base = eth.base_fee
		eth.base_fee = lambda: 20 * GWEI  # we quote at 20 -> maxFee 40 < 45: wedged
		with self.assertRaises(C.StuckTransaction):
			snd.send("register:y", TO, "0xabcd")
		self.assertEqual(j.get("register:y").status, "Stuck")
		eth.base_fee = orig_base
		r = snd.send("register:y", TO, "0xabcd")  # retry the SAME intent
		self.assertEqual(r.status, "Mined")
		self.assertTrue(r.deduplicated)
		nonces = {n for n, _, _ in eth.sent}
		self.assertEqual(nonces, {0}, "a retry must never take a new nonce")
		self.assertGreaterEqual(eth.sent[1][2], eth.sent[0][2] * 125 // 100)

	def test_auto_replacement_within_one_call(self):
		eth = FakeEth(base_fee=45 * GWEI)
		snd = make_sender(eth, max_replacements=2)
		eth.base_fee = lambda: 20 * GWEI  # quote low -> 40 gwei; bump 25% -> 50 >= 45 mines
		r = snd.send("register:z", TO, "0x01")
		self.assertEqual(r.status, "Mined")
		self.assertEqual(r.replacements, 1)
		self.assertEqual([n for n, _, _ in eth.sent], [0, 0])

	def test_same_key_different_calldata_refused(self):
		eth = FakeEth()
		snd = make_sender(eth)
		snd.send("register:k", TO, "0x01")
		with self.assertRaises(C.IntentConflict):
			snd.send("register:k", TO, "0x02")

	def test_refusal_consumes_no_nonce_and_journals_nothing(self):
		eth, j = FakeEth(), C.MemoryJournal()
		eth.revert_estimate = "0x5d21e815" + OID[2:] + "0" * 63 + "2"
		snd = make_sender(eth, j)
		with self.assertRaises(C.Reverted) as cm:
			snd.send("register:r", TO, "0x01")
		self.assertEqual(cm.exception.refusal["name"], "AlreadySettled")
		self.assertEqual(eth.sent, [])
		self.assertIsNone(j.get("register:r"))

	def test_orphan_nonce_blocks_new_intents(self):
		eth, j = FakeEth(), C.MemoryJournal()
		snd = make_sender(eth, j)
		# a previous process journaled intent A at nonce 0 and crashed before broadcasting
		j.put(C.Intent(key="register:a", from_address=snd.address, to_address=TO, calldata="0x01", nonce=0, gas=1,
		               max_fee_per_gas=40 * GWEI, max_priority_fee_per_gas=GWEI))
		with self.assertRaises(C.NonceHeld):
			snd.send("register:b", TO, "0x02")
		r = snd.send("register:a", TO, "0x01")  # resuming A broadcasts at nonce 0
		self.assertEqual(r.status, "Mined")
		self.assertEqual(snd.send("register:b", TO, "0x02").status, "Mined")
		self.assertEqual([n for n, _, _ in eth.sent], [0, 1])

	def test_nonce_consumed_elsewhere_is_loud(self):
		eth, j = FakeEth(mine=False), C.MemoryJournal()
		snd = make_sender(eth, j, max_replacements=0)
		with self.assertRaises(C.StuckTransaction):
			snd.send("register:c", TO, "0x01")
		eth.mined_nonce = 1  # someone else used nonce 0 with this key
		with self.assertRaises(C.ChainError):
			snd.send("register:c", TO, "0x01")
		self.assertEqual(j.get("register:c").status, "Failed")


if __name__ == "__main__":
	unittest.main()
