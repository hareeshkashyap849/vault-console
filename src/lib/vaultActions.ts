/**
 * What the deposit and redeem forms may do next, as pure functions.
 *
 * WHY THIS IS NOT INSIDE THE COMPONENT
 *
 * "Which button is offered, and why" is the decision this page exists to get right, and it is
 * the decision the sibling wallet dApp got wrong. Burying it in JSX would leave it assertable
 * only by rendering a page with a wallet attached -- so it lives here, where a test can state
 * the inputs and read the answer. `src/lib/chartGeometry.ts` is the same move for the chart's
 * arithmetic, and for the same reason.
 *
 * THE BUG THIS DECISION EXISTS TO PREVENT, IN FULL
 *
 * The dApp kept an `ApprovalState` (idle / needs-approval / approved) in memory and
 * short-circuited on it. `approve(100)` then `deposit(100)` leaves an allowance of ZERO,
 * because the deposit consumes the approval -- so the next `deposit(5850)` went out with no
 * approval at all and reverted with `ERC20InsufficientAllowance(vault, 0, 5850e6)`.
 *
 * So there is exactly ONE input here that decides between approve and deposit, and it is the
 * allowance **as the chain reports it at the moment of the decision**. Nothing in this file
 * remembers anything between calls, and there is no parameter through which a remembered
 * approval could arrive. That is deliberate: a function that cannot be handed a stale value
 * cannot act on one.
 *
 * WHAT IS NOT HERE
 *
 * No React, no viem, no fetch. Amounts arrive as `bigint` and as decimal strings, and they
 * leave as strings that have already been through `src/lib/format.ts` -- the one module
 * allowed to know about decimals.
 */
import { displayBaseUnits, formatBaseUnits, formatBigInt, parseAmount } from './format.ts';

/**
 * `type(uint256).max`.
 *
 * An infinite approval is the one allowance that is sufficient for EVERY amount, and comparing
 * it is not safe either: `allowance >= amount` happens to be true for it by magnitude, but
 * anything that ADDS to it -- as a "top up the approval" step naturally would -- wraps to zero,
 * which turns the most permissive approval a user can give into the least.
 *
 * The constant is written here rather than imported from viem because this module is loaded by
 * `node --experimental-strip-types` in the tests, and a value is not worth a runtime dependency.
 */
export const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Whether an approval already covers `amount`.
 *
 * `MAX_UINT256` is answered without arithmetic, for the wrapping reason above. The general case
 * is a comparison and stays one.
 */
export function allowanceCovers(allowance: bigint, amount: bigint): boolean {
  if (allowance === MAX_UINT256) return true;
  return allowance >= amount;
}

/**
 * What the user typed, read as base units -- or a sentence saying why it cannot be.
 *
 * `parseAmount` in `format.ts` is the only thing that turns a decimal string into base units,
 * and it throws for the cases that matter: more fraction digits than the asset has (it refuses
 * to truncate), and anything that is not a plain decimal (`'1e6'`, `'0x10'`, `'1,000'`). This
 * wrapper adds no parsing of its own; it turns the throw into a return value, because a thrown
 * error inside a React event handler is a blank screen rather than a sentence.
 *
 * ZERO AND NEGATIVE ARE REFUSED HERE, not left to the contract. `deposit(0)` does not revert:
 * it succeeds and mints nothing. A zero that reaches the wallet is a transaction the user pays
 * for and gains nothing from, and it looks like it worked.
 */
export type AmountInput =
  | { ok: true; baseUnits: bigint; /** The trimmed input, for echoing back in a message. */ text: string }
  | { ok: false; reason: string };

export function readAmountInput(input: string, decimals: number, unit: string): AmountInput {
  const text = input.trim();
  if (text === '') return { ok: false, reason: `enter an amount in ${unit}` };

  let baseUnits: bigint;
  try {
    baseUnits = parseAmount(text, decimals);
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }

  if (baseUnits <= 0n) return { ok: false, reason: `the amount must be greater than zero ${unit}` };
  return { ok: true, baseUnits, text };
}

/**
 * A base-unit figure, printed with the unit it is in. `null` renders as an em dash.
 *
 * THE `bigint`/`string` BOUNDARY IS CROSSED HERE, ONCE.
 *
 * `format.ts` keeps its two display formatters `string`-only on purpose -- `displayBaseUnits`
 * takes a RAW INTEGER STRING as the chain holds it, and `formatBaseUnits` rejects anything with
 * a decimal point -- and an on-chain read arrives here as a `bigint`. So the conversion happens
 * in this one function rather than at every call site: a bare `bigint` in a template literal
 * prints as digits with no decimal shift (the "5555075900" bug), and spreading that conversion
 * across three components is how one of them comes to do it differently.
 */
export function figure(value: bigint | string | null, decimals: number, unit = ''): string {
  if (value === null) return '—';
  // NO THOUSANDS GROUPING, unlike `displayBaseUnits`. Every caller of this function is a SENTENCE
  // about an amount -- "you hold 5555.0759", "the allowance is 99.999999" -- and a sentence is not
  // a table cell. The ungrouped form is also the form a person can paste back into the field
  // above, which matters because the number in that sentence is the number they will type.
  //
  // The bigint branch goes through `formatBigInt` because `displayBaseUnits` takes the raw integer
  // STRINGS the index service returns; a string is already in that shape and goes straight in.
  const formatted = typeof value === 'bigint' ? formatBigInt(value, decimals) : displayBaseUnits(value, decimals, { group: false });
  return unit === '' ? formatted : `${formatted} ${unit}`;
}

/**
 * A base-unit amount as a DECIMAL STRING, for filling an input.
 *
 * THE "MAX" BUTTON'S WHOLE JOB, and the reason it has a function rather than an inline
 * expression in the component.
 *
 * `maxAmountDecimal(5555075900n, 6)` is `'5555.0759'`. The sibling dApp's Max button filled the
 * raw base units into a field that expects a decimal string, so "5555.0759" arrived as
 * "5555075900" -- a transaction for a million times the balance, which was mined and reverted.
 * A Max control that returns a `bigint` can be misused that way; one whose return type is
 * `string` and whose name says "decimal" cannot.
 *
 * The value is NOT truncated to a display precision: max means max, so the whole balance is
 * offered exactly as the chain holds it. `displayBaseUnits` is not used here because it groups
 * thousands with commas, and a comma in this string would be rejected by `parseAmount`.
 */
export function maxAmountDecimal(baseUnits: bigint | string, decimals: number): string {
  return formatBaseUnits(baseUnits, decimals);
}

/** Which of the two ERC-4626 write paths a form drives. The other two are not implemented. */
export type ActionStep = 'deposit' | 'approve' | 'redeem';

/**
 * What the deposit form offers the user, and the sentence explaining it.
 *
 * `reason` is written to be shown as-is, so it carries the figures rather than referring to
 * them: "you have 5555.0759 aUSDC" is actionable, "insufficient balance" is not. Every figure
 * inside it went through `format.ts`.
 */
export type DepositDecision =
  /** No wallet is connected, so there is no address to read a balance for. */
  | { kind: 'no-wallet'; reason: string }
  /** The wallet is on a chain this app has no deployment for. Disabled, with the reason. */
  | { kind: 'wrong-chain'; reason: string }
  /** The field is empty. Neutral: the user has not asked for anything yet. */
  | { kind: 'empty'; reason: string }
  /** The input cannot be an amount, or a figure it needs has not been read yet. */
  | { kind: 'invalid'; reason: string }
  /** More than the wallet holds. Refused BEFORE a wallet prompt, with the real balance. */
  | { kind: 'exceeds-balance'; reason: string; baseUnits: bigint }
  /** The allowance does not cover it, so the approve step is what is offered. */
  | { kind: 'approve'; reason: string; baseUnits: bigint }
  /** The allowance already covers it, so a single deposit transaction is offered. */
  | { kind: 'deposit'; reason: string; baseUnits: bigint };

export interface DepositInputs {
  /** The chain this app is deployed on: the deployment record's `chainId`. */
  chainId: number;
  /** The chain the wallet is on, or `null` when no wallet is connected. */
  walletChainId: number | null;
  /** The wallet's asset balance in base units, read from the chain. Not remembered. */
  assetBalance: bigint | null;
  /** The vault's allowance from this wallet in base units, read from the chain just now. */
  allowance: bigint | null;
  /** The asset's decimals, read from the chain. */
  assetDecimals: number;
  /** The asset's symbol, read from the chain. Used only to label the figures. */
  assetSymbol: string;
  /** What is in the field, as typed. A decimal string, never a number. */
  input: string;
}

/**
 * THE ORDER OF THE CHECKS IS THE DECISION.
 *
 * Cheapest and most fundamental first, so the sentence the user reads names the first thing
 * that is actually wrong:
 *
 *   1. no wallet        -> nothing can be read for it, so nothing else can be decided
 *   2. wrong chain      -> the figures on screen would be from the wrong deployment
 *   3. empty field      -> neutral, not an error
 *   4. unparseable      -> the parser's own sentence, verbatim
 *   5. over balance     -> refused HERE, before any wallet prompt
 *   6. allowance short  -> the approve step, not a doomed deposit
 *   7. otherwise        -> deposit
 *
 * Steps 5 and 6 are the two the brief requires "before any wallet prompt". Note what step 5
 * must NOT do: approve first and then fail. An approval needs no balance, so `approve(5850)`
 * succeeds and only `deposit(5850)` reverts on the balance -- the user pays gas to be told what
 * was knowable for free.
 */
export function decideDeposit(inputs: DepositInputs): DepositDecision {
  const { chainId, walletChainId, assetBalance, allowance, assetDecimals, assetSymbol, input } = inputs;

  if (walletChainId === null) {
    return {
      kind: 'no-wallet',
      reason: 'Connect a wallet to deposit. Reading this page needs no wallet; writing does.',
    };
  }

  if (walletChainId !== chainId) {
    return {
      kind: 'wrong-chain',
      reason:
        `Switch the wallet to chain ${chainId} -- it is currently on chain ${walletChainId}, where this ` +
        'deployment does not exist. Nothing is sent until it does.',
    };
  }

  if (input.trim() === '') {
    return { kind: 'empty', reason: `Enter the amount of ${assetSymbol} you want to deposit.` };
  }

  const parsed = readAmountInput(input, assetDecimals, assetSymbol);
  if (!parsed.ok) return { kind: 'invalid', reason: parsed.reason };

  // A balance that has not arrived yet is not zero. Saying "you have 0" would be a figure this
  // app invented, and an invented figure is one a user acts on.
  if (assetBalance === null) {
    return { kind: 'invalid', reason: `The wallet's ${assetSymbol} balance has not been read yet.` };
  }

  if (parsed.baseUnits > assetBalance) {
    return {
      kind: 'exceeds-balance',
      reason:
        `That is more ${assetSymbol} than the wallet holds: ${figure(parsed.baseUnits, assetDecimals)} ` +
        `requested, ${figure(assetBalance, assetDecimals)} available.`,
      baseUnits: parsed.baseUnits,
    };
  }

  if (allowance === null) {
    return { kind: 'invalid', reason: 'The current allowance has not been read yet, so the next step is unknown.' };
  }

  if (!allowanceCovers(allowance, parsed.baseUnits)) {
    return {
      kind: 'approve',
      reason:
        `The vault's allowance is ${figure(allowance, assetDecimals)} ${assetSymbol}, which does not ` +
        'cover this deposit. Approving is the next step; the deposit follows it.',
      baseUnits: parsed.baseUnits,
    };
  }

  return {
    kind: 'deposit',
    reason: 'The allowance already covers this deposit, so only the deposit transaction is needed.',
    baseUnits: parsed.baseUnits,
  };
}

/** What the redeem form offers. No approval step exists on this path. */
export type RedeemDecision =
  | { kind: 'no-wallet'; reason: string }
  | { kind: 'wrong-chain'; reason: string }
  | { kind: 'empty'; reason: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'exceeds-shares'; reason: string; baseUnits: bigint }
  | { kind: 'redeem'; reason: string; baseUnits: bigint };

export interface RedeemInputs {
  chainId: number;
  walletChainId: number | null;
  /** The wallet's share balance in base units, read from the chain. */
  shareBalance: bigint | null;
  shareDecimals: number;
  input: string;
}

/**
 * The redeem pre-flight.
 *
 * NO ALLOWANCE CHECK, and that is not an omission: `redeem` burns the caller's own shares, so
 * there is nothing to approve. `maxWithdraw` is read and displayed beside the form, but it does
 * not gate it -- OpenZeppelin defines it as `previewRedeem(maxRedeem(owner))`, so shares beyond
 * it are a statement about the vault's liquidity, not about the user's ownership.
 */
export function decideRedeem(inputs: RedeemInputs): RedeemDecision {
  const { chainId, walletChainId, shareBalance, shareDecimals, input } = inputs;

  if (walletChainId === null) {
    return {
      kind: 'no-wallet',
      reason: 'Connect a wallet to redeem. Reading this page needs no wallet; writing does.',
    };
  }

  if (walletChainId !== chainId) {
    return {
      kind: 'wrong-chain',
      reason:
        `Switch the wallet to chain ${chainId} -- it is currently on chain ${walletChainId}, where this ` +
        'deployment does not exist. Nothing is sent until it does.',
    };
  }

  if (input.trim() === '') {
    return { kind: 'empty', reason: 'Enter the number of shares you want to redeem.' };
  }

  // The unit is SHARES. The field says so and the balance beside it is a share balance. The
  // asset's symbol is deliberately NOT attached to this field: shares of this vault have no
  // token symbol, and labelling them with the asset's would invite reading the field as assets.
  const parsed = readAmountInput(input, shareDecimals, 'shares');
  if (!parsed.ok) return { kind: 'invalid', reason: parsed.reason };

  if (shareBalance === null) {
    return { kind: 'invalid', reason: 'The wallet share balance has not been read yet.' };
  }

  if (parsed.baseUnits > shareBalance) {
    return {
      kind: 'exceeds-shares',
      reason:
        `That is more shares than the wallet holds: ${figure(parsed.baseUnits, shareDecimals)} ` +
        `requested, ${figure(shareBalance, shareDecimals)} available.`,
      baseUnits: parsed.baseUnits,
    };
  }

  return {
    kind: 'redeem',
    reason: 'Shares are priced at the block the redemption lands in, so the assets shown are a preview.',
    baseUnits: parsed.baseUnits,
  };
}

/**
 * The amount to pre-approve: exactly the deposit, never more.
 *
 * An allowance is a standing grant to a contract, and granting more than the amount in front of
 * the user is a decision made on their behalf that they did not ask for. `null` means there is
 * nothing to approve.
 */
export function approvalAmountFor(decision: DepositDecision): bigint | null {
  return decision.kind === 'approve' ? decision.baseUnits : null;
}
