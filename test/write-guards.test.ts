/**
 * The two guards on the WRITE path, asserted without a wallet.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT IS AIMED AT
 *
 * A person drove the published console and found two defects that every unit test in this
 * repository passed through. Both of them live in the seam between a pure decision and the render
 * that uses it, which is exactly the seam these tests now pin:
 *
 *   1. A REJECTED PROMPT WAS REPORTED AS A SENT TRANSACTION. The reader clicked Reject in the
 *      wallet; the page answered with `Waiting for the chain(approve)` and
 *      `Approval sent. The wallet prompt is done; this waits for the chain to include it.` The
 *      allowance stayed `0` and the account's nonce did not move. The taxonomy in `txState.ts` was
 *      right -- `mapWriteError` returned `rejected` -- and it was then OVERWRITTEN by the receipt
 *      watch, which reports TanStack's `'pending'` for a query that is disabled because there is no
 *      hash to watch. So the fold is asserted here: `txStateFor` is the only thing allowed to
 *      combine the two, and this file states what it may and may not do.
 *
 *   2. THE WRONG-CHAIN GUARD COULD NOT FIRE. `decideDeposit` refuses a wallet that is not on the
 *      deployment's chain, and the value it was given came from `useChainId()` -- the app's own
 *      chain, which wagmi deliberately does not update when the wallet moves to a chain outside
 *      `config.chains`. The guard compared the app's chain with itself. `chainRefusalFor` is the
 *      same refusal, applied at the moment a write is asked for, and its assertions are about the
 *      two facts a reader needs: which chain the wallet is on, and which one it must be on.
 *
 * Both defects were reproduced on the published export with a stub EIP-1193 provider, and both
 * fixes are re-measured there by `tools/wallet-double-assert.mjs`. This file is the part that runs
 * in CI, where there is no wallet and no chain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  chainRefusalFor,
  decideDeposit,
  wrongChainReason,
  type DepositInputs,
} from '../src/lib/vaultActions.ts';
import { IDLE, mapWriteError, pendingState, txStateFor, USER_REJECTED_CODE, type TxState } from '../src/lib/txState.ts';

const HASH = `0x${'ab'.repeat(32)}` as const;
const DEPLOYMENT_CHAIN = 84532; // Base Sepolia: the chain this console's deployment record names.
const FOREIGN_CHAIN = 8453; // Base mainnet: the chain the wallet was measured on.

/** The receipt watch's value while it has nothing to watch -- `{ hash: undefined }` on the hook. */
const RECEIPT_NOT_WATCHING = { hash: undefined, status: undefined } as const;

// ---- 1. the fold: a receipt describes a transaction, so it may only move a write that has one ---

test('A REJECTED WRITE STAYS REJECTED: the receipt watch does not get to answer for it', () => {
  // The exact error shape viem produces for EIP-1193 4001, one level down a wrapper -- which is how
  // it arrives: `ContractFunctionExecutionError` with the provider's error as its `cause`.
  const inner = Object.assign(new Error('User rejected the request.'), { code: USER_REJECTED_CODE });
  const outer = Object.assign(new Error('The contract function "approve" reverted'), { cause: inner });

  const local = mapWriteError('approve', outer, 'The approval could not be sent.');
  assert.equal(local.phase, 'rejected', 'the taxonomy classifies 4001 as a rejection');

  const rendered = txStateFor('approve', local, RECEIPT_NOT_WATCHING);

  assert.equal(rendered.phase, 'rejected', 'the phase the reader sees must still be the rejection');
  assert.equal(rendered.hash, null, 'nothing was signed, so there is no hash to show');
  // THE LINE THE PUBLISHED PAGE PRINTED, asserted by value rather than by phase: a phase check
  // alone would pass if the pending sentence were attached to some other state.
  assert.doesNotMatch(
    rendered.message,
    /Approval sent\. The wallet prompt is done/,
    'a rejected prompt must never be described as an approval that has been sent',
  );
  assert.doesNotMatch(rendered.message, /Waiting for the chain/i);
  // And it must not be dressed as a failure either: nothing was signed, nothing was sent, no gas
  // was spent, and "it broke" names a fault the reader did not cause.
  assert.notEqual(rendered.phase, 'failed');
  assert.equal(rendered.error, null);
});

test('a failed write is not overwritten by the receipt watch either', () => {
  // The same fold, the other invisible phase. The wallet refused the request for a reason that is
  // not a cancellation (`The wallet refused this request.`), so there is no transaction -- and the
  // published page would have reported it as sent, exactly as it did the rejection.
  const local = mapWriteError('deposit', new Error('execution reverted: ERC4626ExceededMaxDeposit'), 'fallback');
  assert.equal(local.phase, 'failed');

  const rendered = txStateFor('deposit', local, RECEIPT_NOT_WATCHING);
  assert.equal(rendered.phase, 'failed');
  assert.match(rendered.message, /ERC4626ExceededMaxDeposit/, 'the reason must survive the fold');
});

test('idle is idle, and a receipt cannot invent a transaction for it', () => {
  const rendered = txStateFor('approve', IDLE, RECEIPT_NOT_WATCHING);
  assert.equal(rendered.phase, 'idle');
  assert.equal(rendered.hash, null);
  // The idle sentence itself, not merely "something that is not an approval": `Nothing has been
  // sent.` is the only sentence that is true of a write nobody has started.
  assert.equal(rendered.message, IDLE.message);
  assert.doesNotMatch(rendered.message, /Approval sent|Waiting for the chain/i);
});

test('a receipt DOES move a write the wallet returned a hash for, in all four of its outcomes', () => {
  // The fold must not be a "return the local state" function: the phase it exists to let through is
  // the one with a transaction behind it, and all four receipt outcomes still have to land.
  const local = pendingState('approve', HASH);

  const confirmed = txStateFor('approve', local, { hash: HASH, status: 'success' });
  assert.equal(confirmed.phase, 'confirmed');
  assert.equal(confirmed.hash, HASH);

  const reverted = txStateFor('approve', local, { hash: HASH, status: 'reverted' });
  assert.equal(reverted.phase, 'failed', 'a reverted transaction is not a confirmation');
  assert.equal(reverted.hash, HASH, 'a reverted transaction is still a real one worth looking up');

  const unread = txStateFor('approve', local, { hash: HASH, status: 'error', error: new Error('RPC timeout') });
  assert.equal(unread.phase, 'failed');
  assert.match(unread.message, /on chain/i, 'an unreadable receipt says nothing about the chain');

  const waiting = txStateFor('approve', local, { hash: HASH, status: 'pending' });
  assert.equal(waiting.phase, 'pending');
  assert.match(waiting.message, /Approval sent/, 'this is the case the sentence is FOR');
});

test('the hash the receipt is given is the one the wallet returned, never the receipt\'s own', () => {
  // A hash from one transaction beside a status from another is a state that never happened. The
  // receipt object the hook hands over here carries a DIFFERENT hash on purpose: the fold must use
  // the local one, because that is the transaction the wallet actually returned.
  const local = pendingState('deposit', HASH);
  const other = `0x${'cd'.repeat(32)}` as const;
  const rendered = txStateFor('deposit', local, { hash: other, status: 'success' });
  assert.equal(rendered.hash, HASH, 'the receipt cannot rename the transaction');
});

test('a pending write with NO hash is left alone, because the receipt cannot describe it', () => {
  // `pendingState` accepts `hash: null`: a wallet that returns no hash still has a prompt
  // outstanding. There is nothing for `useWaitForTransactionReceipt` to watch, so its `'pending'`
  // is not evidence about this write.
  const local: TxState = pendingState('approve', null);
  const rendered = txStateFor('approve', local, RECEIPT_NOT_WATCHING);
  assert.deepEqual(rendered, local, 'with no hash there is nothing to fold, so nothing changes');
});

// ---- 2. the chain guard, at the moment of the write -------------------------------------------

test('the wrong-chain sentence names BOTH numbers, and is the one sentence there is', () => {
  const reason = wrongChainReason(DEPLOYMENT_CHAIN, FOREIGN_CHAIN);
  assert.match(reason, /84532/, 'the reader must be told which chain this app needs');
  assert.match(reason, /8453/, 'and which chain the wallet is on, or the sentence cannot be acted on');
  assert.match(reason, /Nothing is sent/i, 'the refusal is also a promise about what was not done');

  // One sentence, one source: the decision and the write-time guard must not be able to disagree.
  const inputs: DepositInputs = {
    chainId: DEPLOYMENT_CHAIN,
    walletChainId: FOREIGN_CHAIN,
    assetBalance: 22_000_000n,
    allowance: 0n,
    assetDecimals: 6,
    assetSymbol: 'USDC',
    input: '1',
  };
  const decision = decideDeposit(inputs);
  assert.equal(decision.kind, 'wrong-chain');
  assert.equal(decision.reason, reason, 'the decision and the guard produce the same sentence');
});

test('chainRefusalFor refuses a wallet on another chain, and allows the deployment\'s', () => {
  assert.equal(chainRefusalFor(DEPLOYMENT_CHAIN, DEPLOYMENT_CHAIN), null, 'the right chain is not refused');
  assert.equal(chainRefusalFor(DEPLOYMENT_CHAIN, FOREIGN_CHAIN), wrongChainReason(DEPLOYMENT_CHAIN, FOREIGN_CHAIN));
});

test('AN UNREAD CHAIN IS NOT A PASSING CHAIN', () => {
  // `null` means the wallet's chain has not been read -- the connector could not answer, or there is
  // no wallet. It must NOT be treated as "matches": that is the whole shape of the defect this
  // guard was rewritten for, one layer down.
  const refusal = chainRefusalFor(DEPLOYMENT_CHAIN, null);
  assert.notEqual(refusal, null, 'a chain nobody has read must not authorise a write');
  assert.match(refusal ?? '', /has not been read/i);
  // Not "sent", not "waiting": a refusal is about a write that did not happen, and the one sentence
  // this test is really guarding against is the defect's own line.
  assert.doesNotMatch(refusal ?? '', /Approval sent|Waiting for the chain/i, 'and it must not describe a transaction');
});
