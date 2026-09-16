'use client';

import Link from 'next/link';

import type { TxState } from '@/lib/txState';

/**
 * The pieces the manage page is assembled from.
 *
 * These are presentation only: they receive strings and state and render them. Every decision
 * about what to show lives in `src/lib/vaultActions.ts` and `src/lib/txState.ts`, where it can be
 * asserted without a browser -- the same split `src/lib/chartGeometry.ts` makes with the chart.
 */

export function Panel({
  title,
  source,
  children,
}: {
  title: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        <span className="text-xs text-slate-500">{source}</span>
      </header>
      {children}
    </section>
  );
}

export function Figure({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="figure text-lg text-slate-100">
        {value}
        {suffix ? <span className="ml-1 text-sm text-slate-400">{suffix}</span> : null}
      </dd>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * A row of figures whose figures have not been read yet, or whose read failed.
 *
 * A failed read renders as a dash with the reason beside it, never as zero. A zero is a figure,
 * and a figure a reader will act on.
 */
export function ReadState({ label, error }: { label: string; error: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="figure text-lg text-slate-500">—</dd>
      <p className="text-xs text-amber-400/80">{error ? 'the chain could not be read' : 'not read yet'}</p>
    </div>
  );
}

/**
 * THE FOUR STATES, PLUS THE NEUTRAL ONE.
 *
 * `rejected` is deliberately not red. A user cancelling in their wallet is not a fault: nothing
 * was signed, nothing was sent, no gas was spent, and the state they were in is the state they
 * are in. Rendering it in the failure colour tells them something went wrong when nothing did --
 * which is what makes people retry a transaction they had decided against.
 *
 * The wording, not just the colour, carries the difference, because a colour is not a message.
 */
export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === 'idle') return null;

  const tone = {
    pending: 'border-sky-800/60 bg-sky-950/30 text-sky-200',
    confirmed: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200',
    failed: 'border-rose-800/60 bg-rose-950/30 text-rose-200',
    rejected: 'border-slate-600/60 bg-slate-800/40 text-slate-300',
    idle: '',
  }[state.phase];

  const heading = {
    pending: 'Waiting for the chain',
    confirmed: 'Confirmed',
    failed: 'The transaction failed',
    rejected: 'You cancelled this',
    idle: '',
  }[state.phase];

  return (
    <div className={`rounded-md border p-3 text-sm ${tone}`} role="status">
      <p className="font-medium">
        {heading}
        {state.step ? <span className="ml-1 font-normal opacity-70">({state.step})</span> : null}
      </p>
      <p className="mt-1 text-sm opacity-90">{state.message}</p>
      {state.hash ? (
        <p className="mt-2 text-xs opacity-70">
          transaction <span className="figure break-all">{state.hash}</span>
        </p>
      ) : null}
      {state.detail ? (
        // Kept, and kept out of the way. The console's failure panel learned this: the reader
        // needs the sentence above, whoever debugs it needs the dump, and one must not bury the
        // other.
        <details className="mt-2">
          <summary className="cursor-pointer text-xs opacity-70">
            technical detail (the raw error, for debugging)
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/60 p-2 text-xs opacity-70">
            {state.detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/**
 * What the form is about to offer, and why.
 *
 * This block is on screen at all times, including when the answer is "nothing yet". A form whose
 * only feedback is a disabled button gives the reader no way to tell "you have not typed
 * anything" from "you cannot afford this" -- and those two need different actions.
 */
export function DecisionNote({ reason, tone }: { reason: string; tone: 'neutral' | 'blocked' }) {
  return (
    <p
      className={`rounded-md border p-3 text-xs ${
        tone === 'blocked'
          ? 'border-amber-800/60 bg-amber-950/30 text-amber-200'
          : 'border-slate-700/60 bg-slate-800/30 text-slate-400'
      }`}
    >
      {reason}
    </p>
  );
}

/**
 * The amount field, with its unit.
 *
 * SHARED BETWEEN THE TWO FORMS, AND THAT IS THE POINT.
 *
 * A deposit takes ASSETS and a redeem takes SHARES. That is the one thing about these two fields
 * that must never be got wrong, and it is the reason the sibling dApp's Max button could fill a
 * base-unit integer into a field expecting a decimal string and produce a transaction that
 * reverted. One field component with a required `unit` prop means the label is written once and
 * cannot be omitted: there is no second call site where someone forgets it.
 *
 * `onMax` fills a DECIMAL STRING. The prop is typed as a string because the value goes into the
 * input the reader is looking at, and a `bigint` there is the bug this whole path exists to avoid.
 */
export function AmountField({
  unit,
  symbol,
  value,
  onChange,
  onMax,
  maxDisabled,
  hint,
}: {
  unit: 'assets' | 'shares';
  /** The asset's symbol, shown for assets. Shares of this vault have no symbol, and pretending
   *  they do is how a share field comes to read as an asset field. */
  symbol?: string;
  value: string;
  onChange: (next: string) => void;
  onMax: () => void;
  maxDisabled: boolean;
  hint: string;
}) {
  const label = unit === 'assets' ? `assets (${symbol ?? '—'})` : 'shares (the vault’s shares)';
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">
          Amount in <strong className="text-slate-400">{label}</strong>
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.0"
          aria-label={unit === 'assets' ? `Deposit amount in ${symbol ?? 'assets'}` : 'Redeem amount in shares'}
          className="figure w-64 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
        />
      </label>
      <button
        type="button"
        // Fills a DECIMAL STRING. See the prop type above: this is the sibling dApp's bug, and the
        // only defense that survives a refactor is a return type that cannot be a base-unit
        // integer in the first place.
        onClick={onMax}
        disabled={maxDisabled}
        className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
      >
        Max
      </button>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/**
 * WHAT THIS APP IMPLEMENTS, SAID BESIDE THE FORM IN EVERY WALLET STATE.
 *
 * Four write paths exist on an ERC-4626 vault and this app implements two of them. That is a
 * statement about the product, not about the connection: it has to be on screen whether or not a
 * wallet is present, because a reader deciding whether to connect one is exactly who needs to know
 * which operations they will get. It lives in one component for the same reason the amount field
 * does -- two copies of a scope statement is one copy that drifts.
 */
export function ScopeNote({ step }: { step: 'deposit' | 'redeem' }) {
  return (
    <p className="text-xs text-slate-500">
      This form implements{' '}
      <span className="figure">
        {step === 'deposit'
          ? 'deposit(uint256 assets, address receiver)'
          : 'redeem(uint256 shares, address receiver, address owner)'}
      </span>{' '}
      only, and it does not implement <span className="figure">mint</span> or{' '}
      <span className="figure">withdraw</span> — the other two of the vault&apos;s four write paths are not offered
      anywhere in this interface.
      {step === 'deposit'
        ? ' A deposit is one transaction when the allowance already covers the amount and two when it does not; the allowance is the only thing that decides which, and it is read from the chain for each decision.'
        : ' It does not implement withdraw, which takes assets and is a different operation.'}
    </p>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300">
      {children}
    </Link>
  );
}

/**
 * A wallet that needs a prompt, rendered where the ControlPanel is.
 *
 * The two sentences are different on purpose. "Not connected" and "wrong chain" have different
 * fixes -- connect, or switch -- and collapsing them into one disabled control leaves the reader
 * to guess which. Both are neutral boxes rather than warning boxes: neither is a fault, and the
 * wallet page has two panels either way.
 */
export function WalletStateNotice({
  kind,
  chainId,
  walletChainId,
  onSwitch,
  switching,
}: {
  kind: 'no-wallet' | 'wrong-chain';
  chainId: number;
  walletChainId: number | null;
  onSwitch: () => void;
  switching: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-800/30 p-3 text-xs text-slate-300">
      {kind === 'no-wallet' ? (
        <p>
          No wallet is connected, so there is nothing to sign with and no address to read a position for. Use the
          wallet panel above to connect one. Reading this page needs no wallet.
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          <span>
            The wallet is on chain <span className="figure">{walletChainId ?? '—'}</span> and this deployment is on
            chain <span className="figure">{chainId}</span>, so the figures here would come from a different chain.
            Nothing is sent until they agree.
          </span>
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching}
            className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white disabled:bg-slate-700"
          >
            {switching ? 'Switching…' : `Switch to chain ${chainId}`}
          </button>
        </p>
      )}
    </div>
  );
}
