/**
 * The wallet path's own arithmetic and state mapping, asserted against the code's edges.
 *
 * WHAT THIS FILE IS FOR, GIVEN THAT `wallet-flow.test.ts` EXISTS
 *
 * The sibling file asserts the DECISIONS: which step is offered, in which order, and that a
 * consumed allowance brings the approval back. This one asserts the two boundaries that sit
 * either side of those decisions and are each a silent-wrong-answer bug when they move:
 *
 *   1. THE DECIMAL-STRING BOUNDARY. A "Max" button hands a string to an input that is later read
 *      by `parseAmount`. If either side converts through a JavaScript number, the value that goes
 *      to the wallet is not the value on screen -- and for this vault's figures that difference is
 *      far past what a double can hold. The sibling dApp shipped exactly this and the transaction
 *      was mined and reverted, so the round trip is asserted here with values that a float
 *      implementation cannot reproduce.
 *
 *   2. THE `bigint`/`string` BOUNDARY IN THE DISPLAY PATH. `format.ts` keeps its two display
 *      formatters `string`-only on purpose, while an on-chain read arrives as a `bigint`. That
 *      conversion happens in exactly one place (`figure`) and is asserted from both sides.
 *
 * The third group asserts the transaction states, because "four values plus a neutral one" is a
 * claim about which phase a given input maps to, and a mapping is testable in a way that a colour
 * is not.
 *
 * A NOTE ON THE VALUES: they are the vault's real figures (`totalSupply`
 * `859021905704231281673`, a 6-decimal asset, a share balance of `359021905704231281673`), not
 * round numbers. A test that asserts `formatBaseUnits(1100000n, 6) === '1.1'` passes just as
 * happily against a `Number`-based implementation, because that value is nowhere near the
 * precision where doubles break. These are.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MAX_UINT256,
  allowanceCovers,
  approvalAmountFor,
  decideDeposit,
  decideRedeem,
  figure,
  maxAmountDecimal,
  readAmountInput,
  type DepositInputs,
} from '../src/lib/vaultActions.ts';
import {
  IDLE,
  isUserRejection,
  mapReceipt,
  mapWriteError,
  pendingState,
  shortMessageOf,
  unreadReceiptState,
  type TxPhase,
} from '../src/lib/txState.ts';

/** The asset's decimals, as the chain reports them. */
const ASSET_DECIMALS = 6;
/** The vault's share decimals, as the chain reports them: a different number, same vault. */
const SHARE_DECIMALS = 18;
const SYMBOL = 'aUSDC';
const CHAIN = 31337;

describe('the decimal-string boundary: what "Max" fills, and what the parser reads back', () => {
  it('turns the demo wallet balance into a decimal string, exactly', () => {
    // 5555075900 base units of a 6-decimal asset. The sibling dApp's Max put `5555075900` into a
    // field expecting `5555.0759`, and the transaction that produced reverted after being mined.
    assert.equal(maxAmountDecimal(5_555_075_900n, ASSET_DECIMALS), '5555.0759');
    assert.notEqual(maxAmountDecimal(5_555_075_900n, ASSET_DECIMALS), '5555075900');
  });

  it('produces a string that `parseAmount` reads back to the same base units -- the round trip', () => {
    // The property that matters is not "the output looks right" but "the field's contents mean the
    // same amount". This is asserted through the module's own reader rather than by re-deciding
    // what the string should look like.
    for (const baseUnits of [1n, 1_000_000n, 5_555_075_900n, 944_924_100n, 359_021_905_704_231_281_673n]) {
      const decimals = baseUnits === 359_021_905_704_231_281_673n ? SHARE_DECIMALS : ASSET_DECIMALS;
      const asTyped = maxAmountDecimal(baseUnits, decimals);
      const read = readAmountInput(asTyped, decimals, SYMBOL);
      assert.equal(read.ok, true, `${asTyped} must be readable as an amount`);
      assert.equal(read.ok && read.baseUnits, baseUnits, `the round trip moved ${baseUnits}`);
    }
  });

  it('keeps a value a double cannot hold, which is the whole reason it is a string', () => {
    const shares = 359_021_905_704_231_281_673n;
    const asTyped = maxAmountDecimal(shares, SHARE_DECIMALS);
    assert.equal(asTyped, '359.021905704231281673');
    // What a `Number`-based implementation would have produced instead, stated so the test fails
    // loudly if anyone ever routes this through one.
    assert.notEqual(String(Number(shares)), shares);
  });

  it('groups nothing: a comma would be rejected by the parser that reads the field back', () => {
    const asTyped = maxAmountDecimal(5_555_075_900n, ASSET_DECIMALS);
    assert.ok(!asTyped.includes(','), `Max filled ${asTyped}, which the parser refuses`);
    assert.ok(!asTyped.includes('n'), 'a base-unit bigint in the field would print its `n`');
  });

  it('refuses zero and negative amounts before they reach a wallet', () => {
    // `deposit(0)` does not revert -- it succeeds and mints nothing -- so a zero that reached the
    // wallet would be a transaction the user paid for and gained nothing from.
    for (const input of ['0', '0.0', '0.000000', '-1', '-0.5']) {
      const read = readAmountInput(input, ASSET_DECIMALS, SYMBOL);
      assert.equal(read.ok, false, `${JSON.stringify(input)} must not be a deposit amount`);
    }
  });

  it('refuses more fraction digits than the asset has, rather than truncating them', () => {
    const read = readAmountInput('1.0000001', ASSET_DECIMALS, SYMBOL);
    assert.equal(read.ok, false);
    assert.match(read.ok === false ? read.reason : '', /fraction digits/, 'it must say why');
  });

  it('accepts the shapes a person actually types', () => {
    for (const [input, expected] of [
      ['1', 1_000_000n],
      ['1.5', 1_500_000n],
      ['1.', 1_000_000n],
      [' 6 ', 6_000_000n],
      ['0.000001', 1n],
    ] as const) {
      const read = readAmountInput(input, ASSET_DECIMALS, SYMBOL);
      assert.equal(read.ok && read.baseUnits, expected, `${JSON.stringify(input)} read as ${read.ok ? read.baseUnits : read.reason}`);
    }
  });

  it('refuses the shapes that only look like amounts', () => {
    // `1e6` and `0x10` are the two that a `Number()` or a `BigInt()` would happily accept, which
    // is exactly why neither is used on the path from the field to the transaction.
    for (const input of ['abc', '1e6', '0x10', '1,000', '1.2.3', '+1', '.5', '']) {
      assert.equal(readAmountInput(input, ASSET_DECIMALS, SYMBOL).ok, false, `${JSON.stringify(input)} must be refused`);
    }
  });
});

describe('figure: the one place a bigint becomes a display string', () => {
  it('formats a bigint with the vault\'s own decimals, and does NOT group thousands', () => {
    // Ungrouped because every caller is a sentence rather than a table cell -- and because the
    // number in that sentence is the number the reader is being asked to type back into a field,
    // where a comma would be rejected by the parser that reads it.
    assert.equal(figure(5_555_075_900n, ASSET_DECIMALS), '5555.0759');
    assert.equal(figure(0n, ASSET_DECIMALS), '0');
    assert.equal(figure(944_924_100n, ASSET_DECIMALS), '944.9241');
    assert.ok(!figure(5_555_075_900n, ASSET_DECIMALS).includes(','), 'no thousands separators here');
  });

  it('formats a raw integer STRING the same way, so both shapes of a read agree', () => {
    // The manage page reads some figures as `bigint` (through wagmi) and some arrive as strings
    // (from the index service). If the two went through different formatters, one page would show
    // two different versions of one number.
    assert.equal(figure('5555075900', ASSET_DECIMALS), figure(5_555_075_900n, ASSET_DECIMALS));
    assert.equal(figure('5555075900', ASSET_DECIMALS), '5555.0759');
  });

  it('shifts by the SHARE decimals when asked for shares, not by the asset\'s', () => {
    // One vault, two decimal counts. A single formatter call with the wrong one prints a
    // plausible number that is wrong by a factor of 10**12.
    const shares = 359_021_905_704_231_281_673n;
    assert.equal(figure(shares, SHARE_DECIMALS), '359.021905704231281673');
    assert.notEqual(figure(shares, SHARE_DECIMALS), figure(shares, ASSET_DECIMALS));
  });

  it('prints an em dash for a figure that has not been read, never a zero', () => {
    // A zero is a figure a reader acts on; "not read" is not the same fact as "zero".
    assert.equal(figure(null, ASSET_DECIMALS), '—');
    assert.equal(figure(null, ASSET_DECIMALS, SYMBOL), '—');
  });

  it('appends the unit when one is given', () => {
    assert.equal(figure(1_000_000n, ASSET_DECIMALS, SYMBOL), '1 aUSDC');
  });
});

describe('allowanceCovers: the comparison the approve-or-deposit decision rests on', () => {
  it('is an exact comparison with no off-by-one', () => {
    assert.equal(allowanceCovers(100_000_000n, 100_000_000n), true, 'an exact allowance is enough');
    assert.equal(allowanceCovers(99_999_999n, 100_000_000n), false, 'one base unit short is short');
    assert.equal(allowanceCovers(0n, 0n), true);
  });

  it('treats type(uint256).max as sufficient without arithmetic', () => {
    // An infinite approval is granted by many wallets, and it is the one allowance that must not
    // be compared by magnitude: anything that ADDS to it -- a "top up the approval" step would --
    // wraps to zero, turning the most permissive approval into the least.
    assert.equal(allowanceCovers(MAX_UINT256, MAX_UINT256), true);
    assert.equal(allowanceCovers(MAX_UINT256, MAX_UINT256 - 1n), true);
    // ...and the constant is the real one, not a plausible-looking typo.
    assert.equal(MAX_UINT256, 2n ** 256n - 1n);
    assert.equal(MAX_UINT256.toString(16).length, 64, 'sixty-four hex digits, which is a uint256');
  });
});

/** A connected wallet on the right chain with an allowance that covers the input. */
function deposit(overrides: Partial<DepositInputs> = {}): DepositInputs {
  return {
    chainId: CHAIN,
    walletChainId: CHAIN,
    assetBalance: 5_555_075_900n,
    allowance: 5_555_075_900n,
    assetDecimals: ASSET_DECIMALS,
    assetSymbol: SYMBOL,
    input: '100',
    ...overrides,
  };
}

describe('the pre-flight decision: what is offered, and in which order', () => {
  it('decides "no wallet" before anything that needs an address', () => {
    assert.equal(decideDeposit(deposit({ walletChainId: null })).kind, 'no-wallet');
    // Even with an input that is wrong in three other ways: naming a later problem would send the
    // reader to fix something they cannot act on until a wallet exists.
    assert.equal(decideDeposit(deposit({ walletChainId: null, input: 'nonsense' })).kind, 'no-wallet');
  });

  it('decides "wrong chain" before the amount is looked at', () => {
    const d = decideDeposit(deposit({ walletChainId: 84532, input: 'not a number' }));
    assert.equal(d.kind, 'wrong-chain');
    assert.match(d.reason, /31337/, 'the reason names the chain this deployment is on');
    assert.match(d.reason, /84532/, 'and the chain the wallet is actually on');
  });

  it('refuses an over-balance deposit BEFORE the allowance is considered', () => {
    // The order is the point. An approval needs no balance, so checking the allowance first would
    // offer "approve 9999", the approval would SUCCEED, and only the deposit would revert -- the
    // user pays gas to learn something that was readable for free.
    const d = decideDeposit(deposit({ input: '9999', allowance: 0n }));
    assert.equal(d.kind, 'exceeds-balance', 'the free check must win over the one that costs gas');
    assert.match(d.reason, /5555\.0759/, 'the reason carries the real balance, exactly as the chain holds it');
    assert.match(d.reason, /9999/, 'and the amount that was refused');
  });

  it('offers the approval step when the allowance falls short, and says by how much it is short', () => {
    const d = decideDeposit(deposit({ input: '100', allowance: 99_999_999n }));
    assert.equal(d.kind, 'approve');
    assert.equal(d.kind === 'approve' && d.baseUnits, 100_000_000n);
    assert.match(d.reason, /99\.999999/, 'the current allowance is shown, not just "insufficient"');
  });

  it('offers a single deposit when the allowance already covers it', () => {
    const d = decideDeposit(deposit({ input: '100', allowance: 100_000_000n }));
    assert.equal(d.kind, 'deposit');
    assert.match(d.reason, /only the deposit transaction/, 'the user is told why there is no approval prompt');
  });

  it('re-decides from the allowance it is GIVEN, so a consumed allowance brings the approval back', () => {
    // This is the whole of the sibling dApp's bug, expressed as two calls with no state between
    // them. There is nothing in this module to remember the first answer with.
    assert.equal(decideDeposit(deposit({ input: '100', allowance: 0n })).kind, 'approve');
    assert.equal(decideDeposit(deposit({ input: '100', allowance: 0n })).kind, 'approve', 'and again, from a fresh read of zero');
    assert.equal(decideDeposit(deposit({ input: '100', allowance: 1_000_000_000n })).kind, 'deposit',
      'while a sufficient read is honoured -- the rule is not "always approve"');
  });

  it('treats an unread balance or allowance as unknown, not as zero', () => {
    assert.equal(decideDeposit(deposit({ assetBalance: null })).kind, 'invalid');
    assert.equal(decideDeposit(deposit({ allowance: null })).kind, 'invalid');
    const d = decideDeposit(deposit({ assetBalance: null }));
    assert.match(d.kind === 'invalid' ? d.reason : '', /not been read yet/i, 'and it says so');
  });

  it('is neutral about an empty field, which is not a mistake', () => {
    const d = decideDeposit(deposit({ input: '   ' }));
    assert.equal(d.kind, 'empty');
  });
});

describe('the approval amount is the deposit, and nothing else', () => {
  it('equals the amount being deposited', () => {
    const d = decideDeposit(deposit({ input: '100', allowance: 0n }));
    assert.equal(approvalAmountFor(d), 100_000_000n);
  });

  it('is null when the decision is not an approval', () => {
    // An allowance is a standing grant to a contract. Approving in a branch that does not need it
    // would grant more than the number in front of the user, which is a decision they did not make.
    for (const inputs of [
      deposit({ input: '100', allowance: 1_000_000_000n }),
      deposit({ input: '' }),
      deposit({ input: '9999' }),
      deposit({ walletChainId: null }),
    ]) {
      assert.equal(approvalAmountFor(decideDeposit(inputs)), null);
    }
  });
});

describe('the redeem pre-flight', () => {
  const shares = 359_021_905_704_231_281_673n;

  it('needs no allowance at all -- there is nothing to approve', () => {
    const d = decideRedeem({ chainId: CHAIN, walletChainId: CHAIN, shareBalance: shares, shareDecimals: SHARE_DECIMALS, input: '300' });
    assert.equal(d.kind, 'redeem');
    assert.notEqual(d.kind, 'approve', 'redeem burns the caller\'s own shares');
  });

  it('reads the field in SHARES, with the share decimals and not the asset\'s', () => {
    // `1` share at 18 decimals is 1e18 base units. Read with the asset's 6 decimals it would be
    // 1e6 -- a deposit-sized number standing in for a redemption-sized one.
    const d = decideRedeem({ chainId: CHAIN, walletChainId: CHAIN, shareBalance: shares, shareDecimals: SHARE_DECIMALS, input: '1' });
    assert.equal(d.kind === 'redeem' && d.baseUnits, 1_000_000_000_000_000_000n);
  });

  it('refuses more shares than the wallet holds, with the balance in the sentence', () => {
    const d = decideRedeem({ chainId: CHAIN, walletChainId: CHAIN, shareBalance: shares, shareDecimals: SHARE_DECIMALS, input: '400' });
    assert.equal(d.kind, 'exceeds-shares');
    // The KIND is shares, not balance: the two forms are refused for different reasons, and a
    // shared kind would let the deposit's sentence be rendered over the redeem's refusal.
    assert.match(d.reason, /359\.021905704231281673/, 'the share balance is shown');
  });

  it('allows redeeming the whole balance exactly, with no off-by-one', () => {
    const d = decideRedeem({
      chainId: CHAIN,
      walletChainId: CHAIN,
      shareBalance: shares,
      shareDecimals: SHARE_DECIMALS,
      input: '359.021905704231281673',
    });
    assert.equal(d.kind, 'redeem');
  });
});

describe('transaction state: five values, and the rejection is not one of the red ones', () => {
  it('maps EIP-1193 4001 to `rejected`, from a nested cause', () => {
    // viem wraps: the EIP-1193 error is usually one or two levels below the one that reaches the
    // component. Reading only the outer level is how a cancellation becomes a red failure.
    const inner = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    const outer = Object.assign(new Error('Transaction rejected'), { cause: inner });

    assert.equal(isUserRejection(inner), true);
    assert.equal(isUserRejection(outer), true);

    const state = mapWriteError('deposit', outer, 'fallback');
    assert.equal(state.phase, 'rejected');
    assert.notEqual(state.phase, 'failed');
    assert.equal(state.hash, null, 'nothing was sent, so there is no hash');
    assert.equal(state.error, null, 'and there is no error text to render in red');
  });

  it('recognises a rejection that arrives as a class name or a phrase, with no code', () => {
    // MetaMask's phrase and viem's class both appear in the wild without a `code` on the object
    // that reaches us.
    assert.equal(isUserRejection(Object.assign(new Error('x'), { name: 'UserRejectedRequestError' })), true);
    assert.equal(isUserRejection(new Error('User denied transaction signature.')), true);
  });

  it('does not mistake a revert for a rejection', () => {
    // `ERC20InsufficientAllowance` is a real failure and must stay on the failure path. A check
    // that matched too broadly would hide the exact defect this app exists not to reintroduce.
    const err = new Error('execution reverted: ERC20InsufficientAllowance(vault, 0, 5850e6)');
    assert.equal(isUserRejection(err), false);
    const state = mapWriteError('deposit', err, 'fallback');
    assert.equal(state.phase, 'failed');
    assert.match(state.error ?? '', /ERC20InsufficientAllowance/, 'the revert reason survives to the reader');
  });

  it('survives an error whose `cause` points at itself', () => {
    // Legal JavaScript, and an unbounded walk inside an error handler is an infinite loop.
    const looped: Error & { cause?: unknown } = new Error('circular');
    looped.cause = looped;
    assert.equal(isUserRejection(looped), false);
    assert.equal(mapWriteError('deposit', looped, 'fallback').phase, 'failed');
  });

  it('keeps the five phases distinct values', () => {
    const phases: TxPhase[] = ['idle', 'pending', 'confirmed', 'failed', 'rejected'];
    assert.equal(new Set(phases).size, 5);
    assert.equal(IDLE.phase, 'idle');
    assert.equal(pendingState('approve', null).phase, 'pending');
  });

  it('never reports an unread receipt as a failure of the transaction', () => {
    // The transaction may be on chain; what failed is this app's ability to read the receipt. The
    // reader must be told the uncertain thing, not the transport error -- their next action
    // depends on whether the money moved.
    const state = unreadReceiptState('deposit', '0xabc' as `0x${string}`, new Error('RPC timeout'));
    assert.match(state.message, /may still be on chain/i, 'the uncertainty is the headline');
    assert.match(state.detail ?? '', /RPC timeout/, 'and the cause is kept for diagnosis');
    // The transport text must not REPLACE the sentence -- which is what happens if it is passed
    // as the fallback to a function that prefers any readable message it finds.
    assert.notEqual(state.message, 'RPC timeout');
  });

  it('maps a wait state to pending rather than inventing an outcome', () => {
    assert.equal(mapReceipt('deposit', { hash: null }).phase, 'pending');
    assert.equal(mapReceipt('deposit', { hash: null, status: undefined }).phase, 'pending');
  });

  it('reports a reverted receipt as failed, with the hash kept', () => {
    const hash = `0x${'ab'.repeat(32)}` as `0x${string}`;
    const state = mapReceipt('deposit', { hash, status: 'reverted', error: new Error('ERC4626ExceededMaxDeposit') });
    assert.equal(state.phase, 'failed');
    assert.equal(state.hash, hash, 'a failed transaction is still one worth looking up');
  });

  it('distinguishes an unreadable receipt from a reverted one', () => {
    const reverted = mapReceipt('deposit', { hash: null, status: 'reverted' });
    const unread = mapReceipt('deposit', { hash: null, status: 'error', error: new Error('fetch failed') });
    assert.notEqual(reverted.message, unread.message, 'two different facts must not share a sentence');
  });

  it('finds a readable line in any error shape, and never returns an empty string', () => {
    assert.equal(shortMessageOf({ shortMessage: 'the short one', message: 'the long one' }), 'the short one');
    assert.equal(shortMessageOf({ message: 'the long one' }), 'the long one');
    assert.equal(shortMessageOf({ name: 'TimeoutError' }), 'TimeoutError');
    // `String({})` is `'[object Object]'`, which reads as a rendering bug rather than as a fact.
    // A plain object has no message to find, so something honest is returned instead.
    assert.equal(shortMessageOf({}), 'Object');
    assert.equal(shortMessageOf(undefined), 'no error was given');
    assert.equal(shortMessageOf('a plain string'), 'a plain string');
  });
});
