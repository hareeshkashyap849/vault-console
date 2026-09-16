/**
 * Transaction state, as five values rather than a boolean.
 *
 * WHY FIVE AND NOT THREE
 *
 * "Did it work" has three answers -- waiting, yes, no -- and a dApp that ships with those three
 * renders a user's own cancellation as a red failure. It is not a failure: nothing was signed,
 * nothing was sent, no gas was spent, and the state the user was in before is the state they are
 * in now. EIP-1193 gives that case its own code, `4001`, and it means exactly that.
 *
 * So a rejection gets its own phase with its own wording and its own colour, and the tests below
 * assert that it never reaches the failure path. That is the whole shape of this module:
 *
 *   idle       nothing has been sent          neutral, not an error, not a success
 *   pending    the wallet has it, the chain does not yet
 *   confirmed  the chain accepted it
 *   failed     the chain (or the wallet) refused it
 *   rejected   the USER declined it -- neutral, and stated as a cancellation
 *
 * WHY THERE IS NO CLEARED-ON-SUCCESS STATE HELD ANYWHERE
 *
 * This module produces a value from an error or a receipt; it does not store one. The page
 * renders the value for the transaction in flight and nothing else uses it. Approval state in
 * particular is NOT derived from `confirmed` here -- that is the bug the sibling dApp shipped
 * (`ERC20InsufficientAllowance(vault, 0, 5850e6)`), and the rule this app follows is that the
 * allowance is re-read from the chain after every confirmation.
 *
 * No React, no viem import: an error arrives as `unknown` and a receipt as a status string, so
 * this file can be tested by handing it the exact shapes those libraries produce.
 */

export type TxPhase = 'idle' | 'pending' | 'confirmed' | 'failed' | 'rejected';

/** Which of the two implemented write paths the transaction belongs to. */
export type TxStep = 'approve' | 'deposit' | 'redeem';

export interface TxState {
  phase: TxPhase;
  step: TxStep | null;
  /** The transaction hash, once the wallet has returned one. */
  hash: `0x${string}` | null;
  /** One sentence for the reader. Written here so every state says something specific. */
  message: string;
  /** Present only for `failed`. viem's own text, kept so a failure can be diagnosed. */
  detail: string | null;
  /**
   * The failure's own message, or `null` when there is nothing to report.
   *
   * It duplicates `message` on the failure path deliberately, and it exists because a CALLER
   * should not have to know which of the two fields carries the reason: `error` is the field that
   * is non-null exactly when something went wrong, and `message` is the sentence that is always
   * safe to render. Reading "did it fail" off a prose field is how a null-check gets forgotten.
   */
  error: string | null;
}

export const IDLE: TxState = {
  phase: 'idle',
  step: null,
  hash: null,
  message: 'Nothing has been sent.',
  detail: null,
  error: null,
};

/**
 * EIP-1193's "user rejected the request".
 *
 * Named, not inlined, because it appears in two places -- the code and the sentence -- and a
 * second copy of a magic number is how the two drift.
 */
export const USER_REJECTED_CODE = 4001;

/**
 * Every `code` reachable from an error, following `cause` as well as the error's own level.
 *
 * WALKING `cause` IS THE POINT. A wallet's rejection reaches us wrapped: viem's
 * `UserRejectedRequestError` carries `code: 4001`, and outside it there is usually a
 * `ContractFunctionExecutionError` or a `TransactionExecutionError` whose own `code` is 0 or
 * absent. Reading only the outer error is how a rejection gets mislabelled as a failure -- and
 * viem wraps by default in exactly this way.
 *
 * The depth bound is not decoration: an error whose `cause` points back at itself is legal
 * JavaScript and would otherwise be an infinite loop inside an error handler.
 */
export function errorCodes(err: unknown): number[] {
  const codes: number[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current !== 'object') break;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'number') codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

/** Whether an error is a user rejection, from any of the three ways it presents itself. */
export function isUserRejection(err: unknown): boolean {
  if (errorCodes(err).includes(USER_REJECTED_CODE)) return true;
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current !== 'object') break;
    const name = (current as { name?: unknown }).name;
    // viem names the class; MetaMask names the phrase. Both are checked because a rejection that
    // arrives as a plain `Error('User rejected the request.')` has neither a code nor a class.
    if (typeof name === 'string' && /UserRejectedRequest/i.test(name)) return true;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && /user (rejected|denied|cancell?ed)/i.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** The deepest non-empty message in a `cause` chain, which is usually the readable one. */
function rootMessage(err: unknown): string | null {
  let current: unknown = err;
  let last: string | null = null;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current !== 'object') break;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') last = message.trim();
    current = (current as { cause?: unknown }).cause;
  }
  return last;
}

/**
 * A failure, as a sentence rather than a diagnostic dump.
 *
 * viem's `message` is a full report -- request body, raw arguments, a docs link, a version
 * banner -- and this repository has already rendered one of those to a reader once
 * (`src/lib/chain.ts` records it). `shortMessage` is viem's own attempt at the reader-facing
 * line, so it is preferred; the longest message in the chain becomes the detail behind a
 * disclosure. A dump is not withheld, it is just not the headline.
 */
export function describeTxError(err: unknown, fallback: string): { message: string; detail: string | null } {
  const short = typeof (err as { shortMessage?: unknown })?.shortMessage === 'string' ? (err as { shortMessage: string }).shortMessage : null;
  const root = rootMessage(err);
  const message = short ?? root ?? fallback;
  const detail = root !== null && root !== message ? root : null;
  return { message, detail };
}

/** The state a write is in the moment the wallet has accepted it and returned a hash. */
export function pendingState(step: TxStep, hash: `0x${string}` | null): TxState {
  return {
    phase: 'pending',
    step,
    hash,
    message:
      step === 'approve'
        ? 'Approval sent. The wallet prompt is done; this waits for the chain to include it.'
        : `${step === 'deposit' ? 'Deposit' : 'Redemption'} sent. Waiting for the chain to include it.`,
    detail: null,
    error: null,
  };
}

/** The state a write is in once the chain has accepted it. */
export function confirmedState(step: TxStep, hash: `0x${string}` | null): TxState {
  return {
    phase: 'confirmed',
    step,
    hash,
    message:
      step === 'approve'
        ? 'Approval confirmed. The allowance is re-read from the chain before the deposit is offered.'
        : `${step === 'deposit' ? 'Deposit' : 'Redemption'} confirmed on chain.`,
    detail: null,
    error: null,
  };
}

/**
 * A rejection, rendered as what it is.
 *
 * The wording matters as much as the phase: "you cancelled this in the wallet" reports an act
 * the user performed and can repeat, where "transaction failed" reports a fault they did not
 * cause and cannot act on.
 */
export function rejectedState(step: TxStep): TxState {
  return {
    phase: 'rejected',
    step,
    hash: null,
    message:
      'You cancelled this in the wallet, so nothing was signed and nothing was sent. The form is ' +
      'back where it was; no gas was spent.',
    detail: null,
    error: null,
  };
}

export function failedState(step: TxStep, hash: `0x${string}` | null, err: unknown, fallback: string): TxState {
  const { message, detail } = describeTxError(err, fallback);
  return { phase: 'failed', step, hash, message, detail, error: message };
}

/**
 * A failure this app can describe in full, because it knows what went wrong.
 *
 * The difference from `failedState` is whose words the reader gets. `failedState` inherits the
 * error's own sentence, which is right when the cause is unknown and that text is all there is.
 * This one has a sentence of its own and appends the cause rather than deferring to it, because
 * there are failures where the sentence -- not the transport text -- is what the reader's next
 * action depends on.
 */
export function deterministicFailedState(
  step: TxStep,
  hash: `0x${string}` | null,
  sentence: string,
  cause: unknown,
): TxState {
  const text = cause === undefined || cause === null ? null : shortMessageOf(cause);
  const message = text === null ? sentence : `${sentence} The underlying failure was: ${text}`;
  return { phase: 'failed', step, hash, message, detail: text, error: message };
}

/**
 * A transaction that is on chain but whose receipt this app could not read.
 *
 * WHY THIS GETS ITS OWN FUNCTION, AND WHY IT IS NOT `failedState`
 *
 * An `'error'` query status is a LOCAL failure: the RPC call that fetches the receipt failed, which
 * says nothing about the chain. The transaction may be included, and "it may still be on chain" is
 * the fact the reader's next action depends on -- so it must be the sentence, and the transport
 * text must be a cause rather than a replacement.
 *
 * Passing the raw error to `failedState` looks right, because the sentence is written at the call
 * site and `failedState` does have a fallback parameter. It is not: `describeTxError` prefers any
 * readable message it finds, so a transport error of "RPC timeout" becomes the whole headline and
 * the one fact worth stating is dropped. That is what the assertion on `message` catches, and it is
 * a class of mistake -- "the sentence exists in the file" read as "the sentence reaches the user"
 * -- worth naming rather than fixing once.
 */
export function unreadReceiptState(step: TxStep, hash: `0x${string}` | null, err: unknown): TxState {
  return deterministicFailedState(
    step,
    hash,
    'The transaction was sent, but its receipt could not be read. It may still be on chain -- a ' +
      'block explorer or a node will say which.',
    err,
  );
}

/**
 * The one entry point the component uses for a wallet write that threw.
 *
 * The ordering is the content: a rejection is checked FIRST and returns the neutral state, so
 * no later branch can reclassify it. A version that checked "is it an error" first would put
 * `4001` on the red path, which is the defect this file exists to prevent.
 */
export function mapWriteError(step: TxStep, err: unknown, fallback: string): TxState {
  if (isUserRejection(err)) return rejectedState(step);
  return failedState(step, null, err, fallback);
}

/**
 * A settled transaction, as wagmi actually reports it.
 *
 * THE SHAPE IS NOT WHAT IT LOOKS LIKE, WHICH IS WHY THIS TYPE IS WRITTEN OUT.
 *
 * `useWaitForTransactionReceipt().status` is a TanStack QUERY status first: `'pending' |
 * 'error' | 'success'`. When the query succeeds the receipt's own `status` is a TRANSACTION
 * status: `'success' | 'reverted'`. Two fields with the same name and different vocabularies sit
 * on one object, and a version of this that read only the first would treat a reverted
 * transaction as a confirmation -- which is the exact defect the fourth state exists to prevent.
 *
 * `error` therefore means two different things, and both are handled: an `'error'` query status
 * means the receipt could not be fetched, while a `'reverted'` transaction status means the chain
 * refused the call and the query itself succeeded.
 */
export interface ReceiptLike {
  status?: 'pending' | 'error' | 'success' | 'reverted' | undefined;
  error?: unknown;
  hash?: `0x${string}` | null | undefined;
}

export function mapReceipt(step: TxStep, receipt: ReceiptLike): TxState {
  const hash = receipt.hash ?? null;

  if (receipt.status === 'success') return confirmedState(step, hash);

  if (receipt.status === 'reverted') {
    return failedState(step, hash, receipt.error, 'The chain reverted this transaction.');
  }

  if (receipt.status === 'error') {
    // The transaction may well be on chain; what failed is this app's ability to read the
    // receipt. See `unreadReceiptState` for why its sentence is built rather than inherited.
    return unreadReceiptState(step, hash, receipt.error);
  }

  // Still waiting. Reporting anything else here would invent an outcome.
  return pendingState(step, hash);
}

/** A reader-facing sentence about a write that failed before any transaction existed. */
export interface WriteErrorText {
  /** The line to show. `null` means a rejection, where the phase already says everything. */
  message: string | null;
  /** The full text, for the disclosure. */
  detail: string | null;
}

/**
 * One readable sentence from ANY thrown or errored thing.
 *
 * `error.shortMessage` is not safe to reach for directly: the error types a simulation returns
 * include plain viem errors that have no such property, so `error.shortMessage ?? error.message`
 * does not typecheck and a cast to make it do so would be a cast over a real difference. This
 * checks for the property and falls back.
 */
export function shortMessageOf(err: unknown): string {
  if (err !== null && typeof err === 'object') {
    const short = (err as { shortMessage?: unknown }).shortMessage;
    if (typeof short === 'string' && short.trim() !== '') return short;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim() !== '') return name;
    // An object with no message, no shortMessage and no name. `String({})` is `'[object Object]'`,
    // which tells a reader nothing and looks like a rendering bug; the constructor's name is at
    // least a fact ("this was an Error with nothing in it").
    return err.constructor?.name ?? 'an error with no message';
  }
  if (err === null || err === undefined) return 'no error was given';
  return String(err);
}

/**
 * The same error, reduced to what a panel renders.
 *
 * IT DOES NOT CLASSIFY, and that is on purpose. This is only ever called after `mapWriteError`
 * has already decided the phase, so a second opinion about "is this a rejection" here could
 * contradict the first -- and two places deciding one thing is the failure mode this repository
 * is built to avoid. A rejection already carries its own sentence.
 */
export function describeWriteError(err: unknown): WriteErrorText {
  if (isUserRejection(err)) return { message: null, detail: null };
  const { message, detail } = describeTxError(err, 'The wallet refused this request.');
  return { message, detail };
}
