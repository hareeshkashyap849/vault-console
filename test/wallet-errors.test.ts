/**
 * THE FAILURE CLASSES, ASSERTED WITHOUT A WALLET, A BROWSER OR A CHAIN.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT PINS
 *
 * `BROWSER-TEST-PLAN.md` §5 row 6 records that the taxonomy had a class for "insufficient gas" and
 * the page had no copy for it: the human's own click on 2026-09-17 produced the raw chain text
 * `gas required exceeds allowance (0)`, and the class was thrown away between the classification and
 * the render. Measuring the published console with a stub EIP-1193 provider showed the same shape
 * for three more classes -- a disconnected provider printed `The Provider is disconnected from all
 * chains.`, and the two gas refusals printed the node's own words.
 *
 * THE ERROR SHAPES HERE ARE NOT INVENTED. They are the shapes viem 2.56.5 (the version this app
 * installs) actually builds, captured by driving `viem/actions.writeContract` with a custom
 * transport that answers each call the way a wallet or a node answers it, and printing the
 * constructor names, `code`, `shortMessage` and `cause` chain of what came back
 * (`verification/out/viem-error-shapes-2.56.5.txt`). The two that matter most:
 *
 *   node refuses the send:  ContractFunctionExecutionError
 *                             -> TransactionExecutionError
 *                             -> InsufficientFundsError
 *                             -> InvalidInputRpcError(code -32000, 'insufficient funds for gas ...')
 *   the call would revert:  ContractFunctionExecutionError
 *                             -> TransactionExecutionError
 *                             -> ExecutionRevertedError
 *                             -> InvalidInputRpcError(code -32000, 'gas required exceeds allowance (0)')
 *
 * SAME CODE, SAME WRAPPER, DIFFERENT CLASS -- which is why the classifier reads the CLASS and not
 * just the code, and why this file builds both to prove it can tell them apart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWalletError,
  CODE_CHAIN_NOT_ADDED,
  CODE_DISCONNECTED,
  CODE_DUPLICATE_REQUEST,
  errorChainOf,
  type WalletFailureKind,
} from '../src/lib/walletError.ts';
import { chainSwitchFailureText, walletFailureText } from '../src/lib/walletFailureCopy.ts';
import { mapWriteError, USER_REJECTED_CODE } from '../src/lib/txState.ts';

const WHERE = { chainId: 84532, chainName: 'Base Sepolia' } as const;

/** A viem-style wrapper: a class with a `shortMessage`, wrapping a cause. */
function wrapped(name: string, shortMessage: string, cause: unknown): Error {
  const error = new Error(shortMessage);
  Object.defineProperty(error, 'name', { value: name, configurable: true });
  Object.defineProperty(error, 'shortMessage', { value: shortMessage, configurable: true });
  Object.defineProperty(error, 'cause', { value: cause, configurable: true });
  return error;
}

/** An EIP-1193 provider error: a plain Error with a numeric code, as MetaMask sends it. */
function providerError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

/** The shape viem produced for "the account cannot pay": the class is the fact. */
function insuffientFundsError(message = 'insufficient funds for gas * price + value: have 352712045842 want 898152800000'): Error {
  return wrapped(
    'ContractFunctionExecutionError',
    'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
    wrapped(
      'TransactionExecutionError',
      'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
      wrapped(
        'InsufficientFundsError',
        'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
        wrapped('InvalidInputRpcError', `Missing or invalid parameters.\n\nDetails: ${message}\nVersion: viem@2.56.5`, providerError(message, -32000)),
      ),
    ),
  );
}

/** The shape viem produced for "the chain refused the call as written". */
function preflightRevertError(reason = 'gas required exceeds allowance (0)'): Error {
  return wrapped(
    'ContractFunctionExecutionError',
    `Execution reverted with reason: ${reason}.`,
    wrapped(
      'TransactionExecutionError',
      `Execution reverted with reason: ${reason}.`,
      wrapped(
        'ExecutionRevertedError',
        `Execution reverted with reason: ${reason}.\n\nDetails: ${reason}\nVersion: viem@2.56.5`,
        wrapped('InvalidInputRpcError', `Missing or invalid parameters.\n\nDetails: ${reason}\nVersion: viem@2.56.5`, providerError(reason, -32000)),
      ),
    ),
  );
}

/** The shape viem produced for a declined prompt: 4001, three levels down. */
function userRejectedError(): Error {
  return wrapped(
    'ContractFunctionExecutionError',
    'User rejected the request.',
    wrapped('TransactionExecutionError', 'User rejected the request.', wrapped('UserRejectedRequestError', 'User rejected the request.', providerError('User rejected the request.', USER_REJECTED_CODE))),
  );
}

// ---- the classes, one by one ----------------------------------------------------------------

test('the reader declining is ALWAYS `rejected`, even when the wording suggests otherwise', () => {
  // The ordering rule, asserted where it can be broken: 4001 is checked first, so a wallet that
  // wraps a cancellation in text mentioning gas or a chain cannot be reclassified by it.
  assert.equal(classifyWalletError(userRejectedError()), 'rejected');
  assert.equal(
    classifyWalletError(wrapped('ContractFunctionExecutionError', 'gas required exceeds allowance (0)', providerError('User rejected the request.', USER_REJECTED_CODE))),
    'rejected',
    'a cancellation that mentions gas is still a cancellation',
  );
  assert.equal(classifyWalletError(providerError('Unrecognized chain ID "0x14a34"', 4902)), 'chain-not-added');
  assert.equal(
    classifyWalletError(wrapped('ProviderRpcError', 'User rejected the request.', providerError('Unrecognized chain ID "0x14a34"', 4902))),
    'chain-not-added',
    'a wallet error whose own code is 4902 stays a chain problem',
  );
});

test('INSUFFICIENT FUNDS AND A PRE-FLIGHT REVERT ARE THE SAME CODE AND DIFFERENT CLASSES', () => {
  // The whole reason the classifier reads class names: viem uses -32000 for both, with the same two
  // wrappers above them, so a code-only classifier would give one sentence for two problems whose
  // next actions are different (fund the account / change the request).
  const funds = insuffientFundsError();
  const revert = preflightRevertError();
  assert.equal(classifyWalletError(funds), 'insufficient-funds');
  assert.equal(classifyWalletError(revert), 'preflight-reverted');
  assert.notEqual(classifyWalletError(funds), classifyWalletError(revert));
});

test('§5 ROW 6: `gas required exceeds allowance (0)` -- the raw chain text -- is classified too', () => {
  // The exact string the human's click produced on 2026-09-17, and the class the page had no copy
  // for. viem reports it as `ExecutionRevertedError`, and the class it must land on is the one whose
  // next action fits: the chain refused the call as written, and the node's wording mentions gas
  // only as the reason the call could not be run.
  assert.equal(classifyWalletError(preflightRevertError('gas required exceeds allowance (0)')), 'preflight-reverted');
  // The other wording -- an actual balance shortfall -- is the other class, and the two must not be
  // reachable from each other's text:
  assert.equal(classifyWalletError(insuffientFundsError()), 'insufficient-funds');
  // Both, however, are ALSO reachable as a bare provider error carrying the node's sentence, with no
  // viem class in sight. That path is wording-only, and these two are the pair that proves wording
  // alone can separate them.
  assert.equal(classifyWalletError(providerError('gas required exceeds allowance (0)', -32000)), 'insufficient-funds');
  assert.equal(
    classifyWalletError(providerError('insufficient funds for gas * price + value: have 1 want 2', -32000)),
    'insufficient-funds',
  );
  assert.equal(classifyWalletError(providerError('execution reverted: ERC4626ExceededMaxDeposit', -32000)), 'preflight-reverted');
});

test('a disconnected wallet is named as disconnected, not as a generic failure', () => {
  // `The Provider is disconnected from all chains.` is what the published page printed, verbatim,
  // as the whole headline. It is the worst of the four to leave raw: the reader's next action
  // (reconnect) is in the class and nowhere in the text.
  assert.equal(
    classifyWalletError(wrapped('ProviderDisconnectedError', 'The Provider is disconnected from all chains.', providerError('The provider is disconnected from all chains.', CODE_DISCONNECTED))),
    'disconnected',
  );
  assert.equal(classifyWalletError(providerError('The Provider is disconnected from all chains.', CODE_DISCONNECTED)), 'disconnected');
  assert.equal(classifyWalletError(providerError('The chain is disconnected.', 4901)), 'chain-not-added');
  assert.equal(classifyWalletError(providerError('The provider is disconnected from all chains.', -32000)), 'disconnected', 'the wording alone is enough when the code has been rewritten');
});

test('a wallet that has never heard of the deployment chain is its own class', () => {
  assert.equal(
    classifyWalletError(providerError('Unrecognized chain ID "0x14a34". Try adding the chain using wallet_addEthereumChain first.', CODE_CHAIN_NOT_ADDED)),
    'chain-not-added',
  );
  // Some wallets answer with the bare requirement rather than a code.
  assert.equal(classifyWalletError(new Error('wallet_addEthereumChain is required for this chain')), 'chain-not-added');
});

test('a wallet already holding a request is its own class', () => {
  assert.equal(classifyWalletError(providerError('Already processing eth_requestAccounts.', CODE_DUPLICATE_REQUEST)), 'already-pending');
  assert.equal(classifyWalletError(new Error('Request already pending')), 'already-pending');
});

test('an error this app cannot name is `unknown`, never a guess', () => {
  assert.equal(classifyWalletError(new Error('something nobody has seen before')), 'unknown');
  assert.equal(classifyWalletError({}), 'unknown');
  assert.equal(classifyWalletError(null), 'unknown');
  // A cyclic cause chain is legal JavaScript and must not hang the classifier.
  const loop: { message: string; cause?: unknown } = { message: 'a loop' };
  loop.cause = loop;
  assert.equal(classifyWalletError(loop), 'unknown');
  assert.equal(errorChainOf(loop).length <= 8, true);
});

// ---- the sentences, and what they must contain ----------------------------------------------

test('EVERY CLASS WITH A SENTENCE NAMES THE FACT AND THE NEXT ACTION, AND NONE IS THE RAW TEXT', () => {
  const kinds: WalletFailureKind[] = ['disconnected', 'chain-not-added', 'chain-switch-rejected', 'insufficient-funds', 'preflight-reverted'];
  for (const kind of kinds) {
    const text = walletFailureText(kind, WHERE);
    assert.ok(text !== null && text.length > 40, `${kind} must have a sentence, got ${JSON.stringify(text)}`);
    assert.doesNotMatch(text ?? '', /viem@|Request body|Raw Call Arguments|Version:/, `${kind} must not carry a diagnostic dump`);
    assert.match(text ?? '', /^[A-Z]/, `${kind} must read as a sentence`);
  }
  // The two that are `null` are `null` because the page says them elsewhere -- asserted so that
  // "no copy" cannot silently become the answer for a class that needs some.
  assert.equal(walletFailureText('rejected', WHERE), null, 'the neutral cancellation box states this');
  assert.equal(walletFailureText('unknown', WHERE), null, 'the caller falls back to the error text');
});

test('the gas sentence carries the CHAIN, because gas is a different coin on each one', () => {
  const text = walletFailureText('insufficient-funds', WHERE) ?? '';
  assert.match(text, /84532/, 'the chain id');
  assert.match(text, /Base Sepolia/, 'and its name');
  assert.match(text, /gas/i);
  assert.match(text, /nothing was sent/i, 'and it says what did not happen');
  // No figure: this app does not pre-compute gas, so a number here would be invented.
  assert.doesNotMatch(text, /\d+\s*ETH|\d{6,}/, 'no invented gas figure');
});

test('the pre-flight revert sentence does not claim the transaction failed on chain', () => {
  const text = walletFailureText('preflight-reverted', WHERE) ?? '';
  assert.match(text, /no transaction was sent/i);
  assert.doesNotMatch(text, /reverted on chain|was mined/i);
});

// ---- the seam: what the page actually renders ------------------------------------------------

test('A GAS REFUSAL NO LONGER RENDERS THE NODE\'S OWN WORDS AS THE HEADLINE', () => {
  const raw = 'insufficient funds for gas * price + value: have 352712045842 want 898152800000';
  const state = mapWriteError('approve', insuffientFundsError(raw), 'The approval could not be sent.', WHERE);
  assert.equal(state.phase, 'failed');
  assert.notEqual(state.message, raw, 'the raw chain text must not BE the headline');
  assert.match(state.message, /cannot pay the gas/i, 'the class leads');
  assert.match(state.message, /nothing was sent/i);
  // What must not be lost: the reason, so the reader can tell this apart from a revert.
  assert.match(state.message, /underlying failure/i);
  assert.ok(state.error !== null, '`error` is non-null exactly when something went wrong');
});

test('a disconnected provider no longer renders as a nameless failure', () => {
  const err = wrapped('ProviderDisconnectedError', 'The Provider is disconnected from all chains.', providerError('The provider is disconnected from all chains.', CODE_DISCONNECTED));
  const state = mapWriteError('approve', err, 'The approval could not be sent.', WHERE);
  assert.equal(state.phase, 'failed');
  assert.match(state.message, /disconnected while this request was in flight/i);
  assert.match(state.message, /Reconnect it to chain 84532/i, 'the next action names the chain');
  assert.doesNotMatch(state.message, /^The Provider is disconnected/);
});

test('an unclassified failure still uses the caller\'s fallback, exactly as before', () => {
  const state = mapWriteError('deposit', new Error('who knows'), 'The deposit could not be sent.', WHERE);
  assert.equal(state.phase, 'failed');
  assert.match(state.message, /who knows/, 'the error text is all there is, so it is used');
  assert.equal(state.detail, null, 'and the disclosure does not repeat the headline');
  const bare = mapWriteError('deposit', {}, 'The deposit could not be sent.', WHERE);
  assert.equal(bare.message, 'The deposit could not be sent.', 'nothing readable -> the fallback verbatim');
});

test('a cancellation is still neutral, through the classifier and through the map', () => {
  const state = mapWriteError('approve', userRejectedError(), 'The approval could not be sent.', WHERE);
  assert.equal(state.phase, 'rejected');
  assert.equal(state.error, null);
  assert.equal(state.hash, null);
  // No sentence about a fault: nothing was signed, nothing was sent, and the reader's own act is not
  // one of the six failures. ("no gas was spent" is the cancellation's own promise about cost, which
  // is why the assertion is about the failure SENTENCES rather than about the word "gas".)
  assert.doesNotMatch(state.message, /cannot pay the gas|disconnected|refused this call/i, 'a cancellation must not borrow a failure sentence');
  assert.doesNotMatch(state.message, /^The Provider is disconnected/);
});

// ---- the chain switch, which had no message at all -------------------------------------------

test('A REFUSED CHAIN SWITCH IS SAID AS A REFUSED CHAIN SWITCH', () => {
  // Measured on the published page with a stub wallet: the switch control was clicked, the wallet
  // answered 4902, and the page re-rendered the same refusal it had shown before -- nothing about
  // the attempt, so a reader saw no change and no reason.
  const unsupported = providerError('Unrecognized chain ID "0x14a34". Try adding the chain using wallet_addEthereumChain first.', CODE_CHAIN_NOT_ADDED);
  const kind = classifyWalletError(unsupported);
  assert.equal(kind, 'chain-not-added');
  const text = chainSwitchFailureText(unsupported, WHERE, kind);
  assert.ok(text !== null);
  assert.match(text ?? '', /does not recognise chain 84532/);
  assert.match(text ?? '', /Base Sepolia/);
  assert.match(text ?? '', /nothing could be sent/i);
});

test('a cancelled switch says the wallet is STILL not on the chain, unlike a cancelled write', () => {
  // The one place a cancellation gets a sentence: `4001` here leaves the wallet on a chain where the
  // deployment does not exist, and the neutral transaction box is not rendered at all -- no
  // transaction was asked for. So `null` here would mean the reader is told nothing at all.
  const cancelled = providerError('User rejected the request.', USER_REJECTED_CODE);
  const kind = classifyWalletError(cancelled);
  assert.equal(kind, 'rejected', '4001 is a rejection whatever it was answering');
  const text = chainSwitchFailureText(cancelled, WHERE, kind);
  assert.ok(text !== null, 'and for a SWITCH it still has to be said');
  assert.match(text ?? '', /switch was cancelled in the wallet/i);
  assert.match(text ?? '', /still not on chain 84532/);
  assert.match(text ?? '', /nothing is sent until it is/i);
  // Whereas the write path, told the same thing, renders the neutral box and no extra sentence.
  assert.equal(walletFailureText('rejected', WHERE), null);
});

test('a switch failure with no error is not a notice', () => {
  assert.equal(chainSwitchFailureText(null, WHERE, 'unknown'), null);
  assert.equal(chainSwitchFailureText(undefined, WHERE, 'unknown'), null);
});
