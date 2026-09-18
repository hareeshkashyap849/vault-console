/**
 * A WALLET FAILURE, CLASSIFIED -- the reason behind the `failed` phase.
 *
 * WHY THIS IS PART OF THE TAXONOMY RATHER THAN A SECOND TAXONOMY
 *
 * `txState.ts` already answers "what SHAPE is this write in" with five phases, and it already
 * classifies EIP-1193 `4001` -- the phase that must never be read as a failure. A phase is a shape,
 * not a reason: every failure that is not a cancellation lands on `failed`, and measured on the
 * published console through a stub EIP-1193 provider, a non-cancellation failure carried the
 * transport's own words:
 *
 *   EIP-1193 4900    -> `The Provider is disconnected from all chains.`
 *   a chain refusal  -> `gas required exceeds allowance (0)`   (the raw text §5 row 6 records)
 *   not enough funds -> `insufficient funds for gas * price + value: have 352712045842 want 898152800000`
 *
 * Each of those is a DIFFERENT problem with a different next action (reconnect, add the chain, fund
 * the account, retry), and the wallet already said which one it was -- EIP-1193 gives each its own
 * code. The render threw the difference away. This is the same classification `mapWriteError`
 * already performs for `4001`, extended to the rest of the class, and the sentences live in
 * `src/lib/walletFailureCopy.ts` so that nothing here is about wording.
 *
 * NO CLASS IS INVENTED FOR A CASE THAT CANNOT ARISE, and the two that look similar are kept apart by
 * the error CLASS viem puts in the chain rather than by wording that happens to be present:
 * `preflight-reverted` (the chain refused the call as written -- the account's next move is to
 * change the request) is not `insufficient-funds` (the account cannot pay -- the next move is to
 * fund it).
 */

/** EIP-1193 / JSON-RPC codes this app classifies. Named, because a bare number is how they drift. */
export const CODE_UNAUTHORIZED = 4100;
export const CODE_UNSUPPORTED_METHOD = 4200;
export const CODE_DISCONNECTED = 4900;
export const CODE_CHAIN_DISCONNECTED = 4901;
export const CODE_CHAIN_NOT_ADDED = 4902;
export const CODE_DUPLICATE_REQUEST = -32002;
/** The node's catch-all. It carries gas refusals, so the MESSAGE decides for that code, not the code. */
export const CODE_INVALID_INPUT = -32000;

export type WalletFailureKind =
  /** The reader declined in the wallet. Neutral, not a fault; `txState.ts` owns the phase. */
  | 'rejected'
  /** The wallet is already asking about a request. A second click does not replace it. */
  | 'already-pending'
  /** The wallet is on another chain, or on none. */
  | 'disconnected'
  /** The wallet does not know the deployment's chain at all. */
  | 'chain-not-added'
  /** The wallet declined the chain switch itself. */
  | 'chain-switch-rejected'
  /** The account cannot pay for gas. §5 row 6: the class the page had no copy for. */
  | 'insufficient-funds'
  /** The chain refused the call as written, before any transaction existed. */
  | 'preflight-reverted'
  /** Something else. The error's own text is the only thing there is to show. */
  | 'unknown';

/** Every error object reachable from an error, itself first, then its `cause` chain. */
export function errorChainOf(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    if (typeof current !== 'object') break;
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** Every readable message in the chain -- viem puts the reader-facing line on `shortMessage`. */
function textsOf(err: unknown): string[] {
  const texts: string[] = [];
  for (const level of errorChainOf(err)) {
    if (typeof level === 'string') {
      texts.push(level);
      continue;
    }
    if (level === null || typeof level !== 'object') continue;
    for (const field of ['shortMessage', 'message', 'details', 'reason'] as const) {
      const value = (level as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim() !== '') texts.push(value);
    }
  }
  return texts;
}

/**
 * Every class name in the chain.
 *
 * VIEM ENCODES THE CLASS, AND THE CLASS IS THE FACT. Measured on viem 2.56.5 (the version this app
 * installs): a JSON-RPC account's failed send produces
 * `ContractFunctionExecutionError` -> `TransactionExecutionError` -> `InsufficientFundsError` ->
 * `InvalidInputRpcError(-32000)`, while a revert produces `... -> ExecutionRevertedError ->
 * InvalidInputRpcError(-32000)`. Same code, same wrapper, different class -- so reading only codes
 * would make one sentence for two different problems.
 */
function classNamesOf(err: unknown): string[] {
  const names: string[] = [];
  for (const level of errorChainOf(err)) {
    if (level === null || typeof level !== 'object') continue;
    const name = (level as { name?: unknown }).name;
    if (typeof name === 'string' && name !== '') names.push(name);
    const ctor = (level as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof ctor === 'string' && ctor !== '' && ctor !== 'Object') names.push(ctor);
  }
  return names;
}

/** Every numeric `code` in the chain. */
function codesOf(err: unknown): number[] {
  const codes: number[] = [];
  for (const level of errorChainOf(err)) {
    if (level === null || typeof level !== 'object') continue;
    const code = (level as { code?: unknown }).code;
    if (typeof code === 'number') codes.push(code);
  }
  return codes;
}

/**
 * WHAT KIND OF FAILURE THIS IS.
 *
 * THE ORDER IS THE DECISION, most specific fact first. A wallet's refusal and a node's refusal can
 * arrive wrapped in each other, and the outer object is usually the least specific one.
 *
 * `chain-switch-rejected` IS READ FROM THE WORDING, AND THAT IS A DELIBERATE, LIMITED EXCEPTION.
 * MetaMask answers a declined chain switch with plain `4001`, exactly as it answers a declined
 * transaction -- the wallet does not distinguish them. The only signal is what was being asked for
 * when the error came back, so the caller supplies that context (see `chainSwitchFailureText`) and
 * this function is not asked to guess it: `4001` alone is always `rejected`.
 */
export function classifyWalletError(err: unknown): WalletFailureKind {
  const codes = codesOf(err);
  const names = classNamesOf(err);
  const joined = textsOf(err).join('\n');

  if (codes.includes(4001)) return 'rejected';

  if (
    codes.includes(CODE_CHAIN_NOT_ADDED) ||
    codes.includes(CODE_CHAIN_DISCONNECTED) ||
    /unrecognized chain|unknown chain|chain .*not (added|supported)|wallet_addEthereumChain/i.test(joined)
  ) {
    return 'chain-not-added';
  }

  if (
    names.some((name) => /ProviderDisconnected|ChainDisconnected/.test(name)) ||
    codes.includes(CODE_DISCONNECTED) ||
    /disconnected from all chains/i.test(joined)
  ) {
    return 'disconnected';
  }

  if (codes.includes(CODE_DUPLICATE_REQUEST) || /already pending|request already/i.test(joined)) {
    return 'already-pending';
  }

  /**
   * VIEM'S CLASS FIRST, THE WORDING SECOND, AND THE ORDER WITHIN EACH IS THE DECISION.
   *
   * VIEM NAMES THE CLASS AND THE CLASS IS THE FACT. `gas required exceeds allowance (0)` -- the exact
   * text §5 row 6 records from the human's click -- is reported by viem inside an
   * `ExecutionRevertedError`, while `insufficient funds for gas * price + value: have X want Y` is
   * reported inside an `InsufficientFundsError`. Both mention gas; only the class separates them.
   *
   * SO A CLASS THE READER'S ACTION DEPENDS ON IS LOOKED FOR ACROSS THE WHOLE CHAIN, and the two
   * classes that need that treatment are named here rather than left to whichever check happens to
   * come first: a `ContractFunctionExecutionError` can carry BOTH wordings -- viem puts the node's
   * sentence in the outer `message` and inside every wrapper -- so "is there a revert in there" must
   * be answered before "is there a funding sentence in there", or a revert whose text mentions gas
   * is reported as "fund the account", an instruction the reader may not be able to act on.
   */
  const revertNamed = names.some((name) => /ExecutionReverted/.test(name));
  const fundsNamed = names.some((name) => /InsufficientFunds/.test(name));

  if (revertNamed) return 'preflight-reverted';
  if (fundsNamed) return 'insufficient-funds';

  if (/execution reverted|reverted with reason/i.test(joined)) return 'preflight-reverted';
  if (/insufficient funds|exceeds the balance of the account|gas required exceeds allowance/i.test(joined)) {
    return 'insufficient-funds';
  }

  return 'unknown';
}
