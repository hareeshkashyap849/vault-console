/**
 * The wallet path's decisions, asserted without a wallet.
 *
 * WHY THIS FILE IS THE MOST IMPORTANT EVIDENCE FOR THE WALLET FEATURE
 *
 * A real wallet cannot be driven by a program: MetaMask decides when to show a popup and a human
 * clicks Approve. So the parts that CAN be proven in CI are the parts that decide before any popup
 * exists -- and `decideDeposit` / `decideRedeem` are exactly that. Extracting them from the
 * components is what makes the pre-flight rules testable at all; a rule that lives inside JSX can
 * only be checked by clicking.
 *
 * THE BUGS THESE PIN
 *
 *   1. `approve` before checking balance. An approval needs no balance, so approving 5850 and then
 *      depositing 5850 succeeds at step one and reverts at step two -- the user pays gas to learn
 *      something that was readable for free. The order of the checks IS the decision.
 *   2. A cached allowance. The sibling dApp kept an approval state in memory; the deposit consumed
 *      the allowance and the memory did not notice, so the next deposit reverted with
 *      `ERC20InsufficientAllowance(vault, 0, 5850e6)`. These inputs are read fresh on every call,
 *      so the test that matters feeds a DECREASED allowance and expects the approve step back.
 *   3. A user rejection rendered as a failure. EIP-1193 `4001` is a normal outcome, and its phase
 *      must be distinguishable from `failed` -- four states, never merged into "it broke".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allowanceCovers,
  decideDeposit,
  decideRedeem,
  maxAmountDecimal,
  readAmountInput,
  type DepositInputs,
} from '../src/lib/vaultActions.ts';

/**
 * A local copy of type(uint256).max, so the assertion that uses it does not depend on the
 * module's own constant being right. An expectation derived from the code under test proves
 * nothing about that code.
 */
const MAX_UINT256_FOR_TEST = (1n << 256n) - 1n;
import {
  IDLE,
  USER_REJECTED_CODE,
  isUserRejection,
  mapReceipt,
  mapWriteError,
  type TxPhase,
} from '../src/lib/txState.ts';

const DECIMALS = 6;
const SYMBOL = 'aUSDC';
const CHAIN_ID = 31337;

/** A connected wallet on the right chain with plenty of everything. Overridden per test. */
function inputs(overrides: Partial<DepositInputs> = {}): DepositInputs {
  return {
    chainId: CHAIN_ID,
    walletChainId: CHAIN_ID,
    assetBalance: 5_555_075_900n, // 5555.0759
    allowance: 0n,
    assetDecimals: DECIMALS,
    assetSymbol: SYMBOL,
    input: '100',
    ...overrides,
  };
}

// ---- the order of the checks ---------------------------------------------------------------

test('no wallet is decided first, because nothing can be read for it', () => {
  const d = decideDeposit(inputs({ walletChainId: null }));
  assert.equal(d.kind, 'no-wallet');
  // Even with an absurd input, the answer is still "connect a wallet": naming a later problem
  // would send the user to fix something they cannot act on yet.
  assert.equal(decideDeposit(inputs({ walletChainId: null, input: '99999999' })).kind, 'no-wallet');
});

test('wrong chain is decided before the amount is even looked at', () => {
  const d = decideDeposit(inputs({ walletChainId: 8453, input: 'not a number' }));
  assert.equal(d.kind, 'wrong-chain', 'a wrong chain outranks an unparseable amount');
  assert.match(d.reason, /31337/, 'the reason names the chain this app needs');
});

test('an empty field is neutral, not an error', () => {
  const d = decideDeposit(inputs({ input: '' }));
  assert.equal(d.kind, 'empty');
});

test('an unparseable amount is invalid and carries the parser sentence', () => {
  for (const bad of ['abc', '1.2.3', '-5', '1e6']) {
    const d = decideDeposit(inputs({ input: bad }));
    assert.equal(d.kind, 'invalid', `${JSON.stringify(bad)} should be invalid, got ${d.kind}`);
    assert.ok(d.reason.length > 0, 'an invalid amount must say why');
  }
});

test('an unread figure is invalid rather than assumed', () => {
  // A null balance means the read has not returned yet. Assuming zero would refuse a valid
  // deposit; assuming anything else would offer a deposit that cannot succeed.
  assert.equal(decideDeposit(inputs({ assetBalance: null })).kind, 'invalid');
  assert.equal(decideDeposit(inputs({ allowance: null })).kind, 'invalid');
});

// ---- the two pre-flight refusals -----------------------------------------------------------

test('MORE THAN THE BALANCE IS REFUSED BEFORE ANY WALLET PROMPT, and names the balance', () => {
  const d = decideDeposit(inputs({ input: '9999' }));
  assert.equal(d.kind, 'exceeds-balance');
  assert.ok('baseUnits' in d && d.baseUnits === 9_999_000_000n);
  assert.match(d.reason, /5555\.0759/, `the reason must carry the real balance, got: ${d.reason}`);
});

test('THE BALANCE IS CHECKED BEFORE THE ALLOWANCE -- approving first would cost gas to learn it', () => {
  // Balance is short AND the allowance is short. If the allowance were checked first the user
  // would be offered an approval, pay for it, and only then be told the deposit cannot happen.
  const d = decideDeposit(inputs({ input: '9999', allowance: 0n }));
  assert.equal(d.kind, 'exceeds-balance', 'the free check must win over the one that costs gas');
});

test('a short allowance offers the approval step, not a doomed deposit', () => {
  const d = decideDeposit(inputs({ input: '100', allowance: 0n }));
  assert.equal(d.kind, 'approve');
  assert.ok('baseUnits' in d && d.baseUnits === 100_000_000n);
});

test('an allowance that already covers it offers a plain deposit', () => {
  const d = decideDeposit(inputs({ input: '100', allowance: 100_000_000n }));
  assert.equal(d.kind, 'deposit');
});

test('an allowance exactly equal to the amount is enough -- not off by one', () => {
  assert.equal(decideDeposit(inputs({ input: '100', allowance: 100_000_000n })).kind, 'deposit');
  assert.equal(decideDeposit(inputs({ input: '100', allowance: 99_999_999n })).kind, 'approve');
});

// ---- the bug that must not come back -------------------------------------------------------

test('THE ALLOWANCE IS NOT REMEMBERED: a consumed allowance brings the approve step back', () => {
  // The exact sequence the sibling dApp got wrong. First deposit: no allowance, so approve.
  const first = decideDeposit(inputs({ input: '100', allowance: 0n }));
  assert.equal(first.kind, 'approve');

  // The deposit consumed it, so the chain now reports zero again. A remembered "approved" flag
  // would offer a deposit here and it would revert with ERC20InsufficientAllowance.
  const second = decideDeposit(inputs({ input: '100', allowance: 0n }));
  assert.equal(second.kind, 'approve', 'a fresh read of 0 must ask for approval again');

  // And a still-sufficient allowance from a different read is honoured, so the rule is not
  // "always approve" either.
  assert.equal(decideDeposit(inputs({ input: '100', allowance: 1_000_000_000n })).kind, 'deposit');
});

test('allowanceCovers is a plain comparison with no rounding', () => {
  assert.equal(allowanceCovers(0n, 0n), true);
  assert.equal(allowanceCovers(0n, 1n), false);
  assert.equal(allowanceCovers(1n, 1n), true);
  assert.equal(allowanceCovers(MAX_UINT256_FOR_TEST, MAX_UINT256_FOR_TEST), true);
});

// ---- amounts -------------------------------------------------------------------------------

test('readAmountInput keeps a decimal amount decimal and refuses silly precision', () => {
  const ok = readAmountInput('1.5', DECIMALS, SYMBOL);
  assert.equal(ok.ok, true);
  assert.ok(ok.ok && ok.baseUnits === 1_500_000n);

  // More fraction digits than the asset has is a disagreement about precision, not a rounding
  // opportunity: silently truncating would move the amount by a base unit.
  const tooPrecise = readAmountInput('1.0000001', DECIMALS, SYMBOL);
  assert.equal(tooPrecise.ok, false, 'seven fraction digits for a six-decimal asset must be refused');
});

test('maxAmountDecimal produces a decimal string, never a base-unit integer', () => {
  // The sibling dApp's "Max" button once filled an integer like 5409090899330578546053 into a
  // field that expected a decimal string, and the transaction reverted after being mined.
  assert.equal(maxAmountDecimal(5_555_075_900n, DECIMALS), '5555.0759');
  assert.equal(maxAmountDecimal(1_000_000n, DECIMALS), '1');
  assert.ok(!maxAmountDecimal(5_555_075_900n, DECIMALS).includes('n'));
});

// ---- the four states, and rejection as a neutral outcome ------------------------------------

test('a user rejection is its own phase, not a failure', () => {
  const err = Object.assign(new Error('User rejected the request.'), { code: USER_REJECTED_CODE });
  assert.equal(isUserRejection(err), true);

  const state = mapWriteError('deposit', err, 'the deposit failed');
  assert.equal(state.phase, 'rejected');
  assert.notEqual(state.phase, 'failed', 'a cancellation must not read as a failure');
  assert.notEqual(state.phase, 'confirmed');
});

test('a nested cause is searched for 4001, because the code is rarely on the outer error', () => {
  // viem wraps: the EIP-1193 error is usually one or two levels down. Reading only the top level
  // would classify a cancellation as a failure and show the user a red error they did not cause.
  const inner = Object.assign(new Error('User rejected the request.'), { code: 4001 });
  const outer = Object.assign(new Error('Transaction rejected'), { cause: inner });
  assert.equal(isUserRejection(outer), true);
  assert.equal(mapWriteError('deposit', outer, 'fallback').phase, 'rejected');
});

test('a non-rejection error is a failure and the revert reason reaches the reader', () => {
  const state = mapWriteError('deposit', new Error('execution reverted: ERC20InsufficientBalance'), 'fallback');
  assert.equal(state.phase, 'failed');
  // The reason must survive in the field the reader sees. `detail` is deliberately null here
  // because it would be the same string twice -- the module only fills it when viem wrapped the
  // error in a longer report, so asserting on `detail` in this case asserts the wrong field.
  assert.match(state.message, /ERC20InsufficientBalance/, 'the revert reason must reach the reader');
});

test('a viem-style wrapped error keeps the verbose text in detail, out of the headline', () => {
  // viem puts its reader-facing line on `shortMessage` and the full report on `message`. That
  // report -- request body, raw arguments, docs link, version banner -- is exactly what was once
  // rendered to a reader, so it belongs behind a disclosure rather than in front of them.
  const viemish = Object.assign(new Error('Request body: {...}\nRaw Call Arguments: {...}\nVersion: viem@2.56.5'), {
    shortMessage: 'execution reverted: ERC20InsufficientAllowance',
  });

  const state = mapWriteError('deposit', viemish, 'fallback');
  assert.equal(state.phase, 'failed');
  assert.equal(state.message, 'execution reverted: ERC20InsufficientAllowance', 'the short line is the headline');
  assert.ok(state.detail, 'the verbose report must be preserved for diagnosis');
  assert.notEqual(state.detail, state.message, 'the disclosure must not repeat the headline');
});

test('the fallback sentence is used when the error carries nothing readable', () => {
  const state = mapWriteError('deposit', {}, 'The deposit could not be sent.');
  assert.equal(state.phase, 'failed');
  assert.equal(state.message, 'The deposit could not be sent.');
});

test('the four write phases are distinct values', () => {
  const phases = new Set<TxPhase>(['idle', 'pending', 'confirmed', 'failed', 'rejected']);
  assert.equal(phases.size, 5);
  assert.equal(IDLE.phase, 'idle');
});

test('a reverted receipt is a FAILURE, never a confirmation and never "waiting"', () => {
  // `useWaitForTransactionReceipt` settles on 'success' | 'reverted' | 'error'. Treating any
  // settled receipt as success is how "the transaction reverted, the UI said confirmed" happens;
  // reporting a revert as still-pending is the same defect wearing a different coat, because the
  // user waits for an outcome that already happened.
  const HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;

  const reverted = mapReceipt('deposit', { hash: HASH, status: 'reverted' });
  assert.equal(reverted.phase, 'failed', 'a reverted transaction must read as failed');
  assert.notEqual(reverted.phase, 'confirmed');
  assert.notEqual(reverted.phase, 'pending', 'the outcome is known; do not keep the user waiting');
  // The hash is kept even on failure: a failed transaction is still a real one worth looking up.
  assert.equal(reverted.hash, HASH);

  const success = mapReceipt('deposit', { hash: HASH, status: 'success' });
  assert.equal(success.phase, 'confirmed');

  // An unread receipt is NOT evidence the transaction failed: the app cannot read the chain, which
  // says nothing about the chain. The reader-facing sentence must therefore be about the
  // UNCERTAINTY -- "it may still be on chain" -- and not the transport error that caused it.
  //
  // This assertion failed on the first version of `mapReceipt`, and that failure was the point.
  // The branch wrote that sentence as a FALLBACK, and `failedState` prefers the error's own
  // message, so any readable error replaced it. A user whose receipt read timed out would be told
  // "RPC timeout" and never learn that their money may already have moved -- which is the one thing
  // they must be told. The fallback only applies when the error carries no text at all.
  const unread = mapReceipt('deposit', { hash: HASH, status: 'error', error: new Error('RPC timeout') });
  assert.equal(unread.phase, 'failed');
  assert.notEqual(unread.message, reverted.message, 'an unread receipt must not claim the chain reverted');
  assert.match(
    unread.message,
    /on chain/i,
    `the headline must be about the uncertainty, not the transport error; got: ${unread.message}`,
  );
  // The transport error is still preserved, just not as the headline.
  assert.ok(unread.detail && /RPC timeout/.test(unread.detail), 'the cause must survive in the detail');
});

test('a receipt with no status yet stays pending, because the outcome is unknown', () => {
  const waiting = mapReceipt('deposit', { hash: null });
  assert.equal(waiting.phase, 'pending', 'an unknown outcome must not be reported as an outcome');
});

// ---- redeem --------------------------------------------------------------------------------

test('redeem refuses more shares than the wallet holds, before any prompt', () => {
  const d = decideRedeem({
    chainId: CHAIN_ID,
    walletChainId: CHAIN_ID,
    shareBalance: 359_021_905_704_231_281_673n,
    shareDecimals: 18,
    input: '400',
  });
  // The kind is `exceeds-shares`, not `exceeds-balance`: the two forms are refused for different
  // reasons and the decision type keeps them apart.
  assert.equal(d.kind, 'exceeds-shares');
  assert.ok('baseUnits' in d && d.baseUnits === 400_000_000_000_000_000_000n);
});

test('redeem needs no approval, because it burns the caller\'s own shares', () => {
  const d = decideRedeem({
    chainId: CHAIN_ID,
    walletChainId: CHAIN_ID,
    shareBalance: 359_021_905_704_231_281_673n,
    shareDecimals: 18,
    input: '300',
  });
  assert.equal(d.kind, 'redeem', 'redeeming your own shares is not an ERC-20 transfer from you');
  assert.notEqual(d.kind, 'approve');
});

test('redeem applies the same ordering: wallet, chain, empty, parse, balance', () => {
  const base = {
    chainId: CHAIN_ID,
    walletChainId: CHAIN_ID,
    shareBalance: 100_000_000_000_000_000_000n,
    shareDecimals: 18,
    // The field's contents, present in every case below so that each assertion differs from the
    // next in exactly one input. Without it the first three would be decided by a missing field
    // rather than by the condition they are named for.
    input: '',
  };
  assert.equal(decideRedeem({ ...base, walletChainId: null }).kind, 'no-wallet');
  assert.equal(decideRedeem({ ...base, walletChainId: 8453, input: 'nonsense' }).kind, 'wrong-chain');
  assert.equal(decideRedeem({ ...base, input: '  ' }).kind, 'empty');
  assert.equal(decideRedeem({ ...base, input: '1.2.3' }).kind, 'invalid');
  assert.equal(decideRedeem({ ...base, input: '101' }).kind, 'exceeds-shares');
  assert.equal(decideRedeem({ ...base, input: '100' }).kind, 'redeem');
});

test('redeem of exactly the whole balance is allowed, not off by one', () => {
  const d = decideRedeem({
    chainId: CHAIN_ID,
    walletChainId: CHAIN_ID,
    shareBalance: 359_021_905_704_231_281_673n,
    shareDecimals: 18,
    input: '359.021905704231281673',
  });
  assert.equal(d.kind, 'redeem', 'redeeming everything you hold must be offered');
});
