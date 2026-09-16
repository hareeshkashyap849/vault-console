'use client';

import { useEffect, useMemo, useState } from 'react';
import { useReadContract, useSimulateContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { AmountField, DecisionNote, Panel, ScopeNote, TxStatus, WalletStateNotice } from '@/components/WalletPanels';
import { ERC20_ABI, VAULT_ABI } from '@/lib/chain';
import { decideDeposit, figure, maxAmountDecimal, type DepositDecision } from '@/lib/vaultActions';
import {
  describeWriteError,
  IDLE,
  mapReceipt,
  mapWriteError,
  pendingState,
  shortMessageOf,
  type TxState,
} from '@/lib/txState';
import { wagmiConfig } from '@/lib/wagmi';

type WagmiConfig = typeof wagmiConfig;

interface Props {
  chainId: number;
  vault: `0x${string}`;
  asset: `0x${string}`;
  account: `0x${string}` | undefined;
  /** The wallet's chain, or `null` when no wallet is connected. Not the app's chain. */
  walletChainId: number | null;
  assetSymbol: string;
  assetDecimals: number | null;
  shareDecimals: number | null;
  /** Offered on the wrong-chain path, and defined once in `VaultManager`. */
  onSwitchChain: () => void;
  isSwitching: boolean;
}

/**
 * The deposit form: assets in, shares out.
 *
 * THE ALLOWANCE, WHICH IS THE WHOLE POINT OF THIS FILE
 *
 * The allowance is a `useReadContract` result. It is passed to `decideDeposit` on every render.
 * It is `refetch`ed every time an approval or a deposit reaches a terminal state on chain.
 *
 * There is deliberately NO `approvalState`, NO "approvedOnce" and NO ref holding "what the
 * allowance was". The sibling dApp kept exactly that, and after `approve(100)` + `deposit(100)`
 * the remembered state still said "approved" while the chain said zero -- so the next deposit
 * went out unapproved and reverted with `ERC20InsufficientAllowance(vault, 0, 5850e6)`.
 *
 * `useReadContract` DOES cache, and that is why the re-read is an explicit call rather than an
 * assumption that a fresh value will arrive. The brief names this directly: after an approval
 * confirms, the allowance must be re-read via `refetch`.
 *
 * Note the second case, which is the easier one to miss: a *deposit* consumes the approval, so
 * the allowance is refetched after a deposit confirms too. Re-reading only after approvals
 * leaves behind the exact stale value that caused the bug.
 *
 * THE NUMBER OF HOOKS DOES NOT DEPEND ON THE WALLET
 *
 * Every read here is called unconditionally, with `args: undefined` when there is no account. An
 * early `return` before a hook would change the hook order between the connected and
 * disconnected renders, which React reports as a crash rather than as a wrong number.
 *
 * WHAT IS DISABLED, AND WHY IT IS VISIBLE RATHER THAN HIDDEN
 *
 * A disabled button with no explanation is the same failure as a red rejection: the reader
 * cannot tell which of five things is wrong. Every branch below renders `decision.reason`
 * beside the control, and that sentence was written by the pure function that made the decision.
 */
export function DepositForm({
  chainId,
  vault,
  asset,
  account,
  walletChainId,
  assetSymbol,
  assetDecimals,
  shareDecimals,
  onSwitchChain,
  isSwitching,
}: Props) {
  const [input, setInput] = useState('');
  const [approveTx, setApproveTx] = useState<TxState>(IDLE);
  const [depositTx, setDepositTx] = useState<TxState>(IDLE);
  const [promptError, setPromptError] = useState<{ message: string | null; detail: string | null } | null>(null);

  // Belt and braces: a null decimals would otherwise format an amount with a made-up one. Every
  // control below is disabled until the chain has answered.
  const decimals = assetDecimals ?? 0;
  const decimalsKnown = assetDecimals !== null;

  const balanceRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: ERC20_ABI,
    address: asset,
    functionName: 'balanceOf',
    args: account === undefined ? undefined : [account],
  });

  /**
   * THE ALLOWANCE, READ FROM THE CHAIN. Never inferred, never remembered.
   *
   * `args: undefined` while there is no account. `refetchAllowance` is captured below so the
   * re-read can happen from an effect as well as from a click.
   */
  const allowanceRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: ERC20_ABI,
    address: asset,
    functionName: 'allowance',
    args: account === undefined ? undefined : [account, vault],
  });

  const balance = balanceRead.data ?? null;
  const allowance = allowanceRead.data ?? null;

  /** WHAT THE FORM OFFERS, AND WHY: a pure function of the values read above. */
  const decision: DepositDecision = useMemo(
    () =>
      decideDeposit({
        chainId,
        walletChainId: account === undefined ? null : walletChainId,
        assetBalance: balance,
        allowance,
        assetDecimals: decimals,
        assetSymbol,
        input,
      }),
    [chainId, account, walletChainId, balance, allowance, decimals, assetSymbol, input],
  );

  /** The amount the deposit is for, or `null` when this render is not offering a deposit. */
  const depositAmount = decision.kind === 'approve' || decision.kind === 'deposit' ? decision.baseUnits : null;

  /** What the user will receive: the vault's own `previewDeposit`, not arithmetic here. */
  const previewRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: VAULT_ABI,
    address: vault,
    functionName: 'previewDeposit',
    args: depositAmount === null ? undefined : [depositAmount],
  });

  /**
   * `simulateContract` BEFORE `writeContract`, exactly as the brief asks.
   *
   * A revert then arrives as a sentence -- `ERC4626ExceededMaxDeposit`, a paused vault, a
   * receiver the contract rejects -- rather than as a transaction the user has already paid for.
   * A simulation is not a promise: the state can move between it and the write. It is used to
   * explain a refusal, never to claim a success.
   */
  const simulation = useSimulateContract({
    config: wagmiConfig as WagmiConfig,
    abi: VAULT_ABI,
    address: vault,
    functionName: 'deposit',
    args: account === undefined || depositAmount === null ? undefined : [depositAmount, account],
    query: {
      // Only when the decision is already "deposit". Simulating the approve-to-deposit path
      // would produce a revert sentence for a step the user has not been offered yet, which
      // reads as a failure of the thing they are being asked to do first.
      enabled: decision.kind === 'deposit' && account !== undefined && decimalsKnown,
    },
  });

  const {
    mutate: writeContract,
    isPending: isWriting,
    reset: resetWrite,
  } = useWriteContract({ config: wagmiConfig as WagmiConfig });

  /**
   * TWO receipts, one per transaction, because a deposit can genuinely be two transactions and
   * each has its own outcome.
   *
   * `hash: undefined` is the documented "not waiting for anything" form, so the hooks are called
   * unconditionally and the hook ORDER does not depend on how far the flow has got.
   */
  const approveReceipt = useWaitForTransactionReceipt({
    config: wagmiConfig as WagmiConfig,
    hash: approveTx.hash ?? undefined,
  });
  const depositReceipt = useWaitForTransactionReceipt({
    config: wagmiConfig as WagmiConfig,
    hash: depositTx.hash ?? undefined,
  });

  /**
   * THE RE-READ, and the reason this is an effect rather than a stored flag.
   *
   * Captured in locals so the dependency list holds values, not expressions React re-evaluates
   * on every render. The effect fires when a receipt reaches a terminal status -- success OR
   * revert -- because a reverted approval leaves the allowance exactly as it was and a reverted
   * deposit leaves it untouched, and in both cases the form must next decide on what the chain
   * now says rather than on what it said before.
   */
  const refetchAllowance = allowanceRead.refetch;
  const approveStatus = approveReceipt.status;
  const depositStatus = depositReceipt.status;
  useEffect(() => {
    if (approveStatus === undefined && depositStatus === undefined) return;
    void refetchAllowance();
  }, [approveStatus, depositStatus, refetchAllowance]);

  /**
   * The two transactions, folded into the states the panel renders.
   *
   * The hash is added to the receipt object rather than passed beside it, so the mapping function
   * takes ONE thing that describes a transaction. A three-argument version invited the two to
   * disagree -- a hash from one transaction and a status from another is a state that never
   * happened, and it would render as such.
   */
  const approveState = approveTx.phase === 'idle' ? IDLE : mapReceipt('approve', { ...approveReceipt, hash: approveTx.hash });
  const depositState = depositTx.phase === 'idle' ? IDLE : mapReceipt('deposit', { ...depositReceipt, hash: depositTx.hash });

  /** Any write in flight blocks both buttons: two prompts at once is not a state to allow. */
  const busy = isWriting || approveState.phase === 'pending' || depositState.phase === 'pending';

  function handleApprove() {
    if (depositAmount === null) return;
    setPromptError(null);
    resetWrite();
    try {
      writeContract(
        {
          abi: ERC20_ABI,
          address: asset,
          functionName: 'approve',
          // Exactly the deposit's amount. An allowance is a standing grant to a contract, and
          // granting more than the number in front of the user is a decision they did not make.
          args: [vault, depositAmount],
        },
        {
          onSuccess: (hash) => setApproveTx(pendingState('approve', hash)),
          onError: (error) => {
            // A `4001` returns the form to idle with a neutral note -- never the red path.
            setApproveTx(mapWriteError('approve', error, 'The approval could not be sent.'));
            setPromptError(describeWriteError(error));
          },
        },
      );
    } catch (cause) {
      // A synchronous throw -- no injected provider, for instance -- never reaches `onError`.
      setApproveTx(mapWriteError('approve', cause, 'The approval could not be sent.'));
      setPromptError(describeWriteError(cause));
    }
  }

  function handleDeposit() {
    // `simulateContract` answers with `{ result, request }`: `result` is the decoded return value
    // and `request` is the fully-formed write. It is `request` that gets sent -- not `data`, which
    // is the query's wrapper around both, and not a second hand-built argument list, which is how
    // what was simulated and what is sent come to differ.
    const request = simulation.data?.request;
    if (request === undefined) return;
    setPromptError(null);
    resetWrite();
    try {
      writeContract(request, {
        onSuccess: (hash) => setDepositTx(pendingState('deposit', hash)),
        onError: (error) => {
          setDepositTx(mapWriteError('deposit', error, 'The deposit could not be sent.'));
          setPromptError(describeWriteError(error));
        },
      });
    } catch (cause) {
      setDepositTx(mapWriteError('deposit', cause, 'The deposit could not be sent.'));
      setPromptError(describeWriteError(cause));
    }
  }

  const sharesPreview = previewRead.data === undefined ? null : previewRead.data;

  /**
   * The two branches where there is nothing to fill in.
   *
   * This `return` sits AFTER every hook on purpose. Moving it up beside the decision would skip
   * `useSimulateContract` and both receipt hooks on the disconnected render, and React reports a
   * changed hook order as a crash -- which would take the whole page down the moment a wallet
   * connected.
   */
  if (decision.kind === 'no-wallet' || decision.kind === 'wrong-chain') {
    return (
      <Panel title="Deposit assets" source="the field and every figure are in ASSETS">
        <div className="grid gap-4">
          <WalletStateNotice
            kind={decision.kind}
            chainId={chainId}
            walletChainId={walletChainId}
            onSwitch={onSwitchChain}
            switching={isSwitching}
          />
          {/*
            THE FIELD IS PRESENT AND DISABLED, IN THE UNIT IT WILL TAKE.
            A form that vanishes until a wallet appears does not tell the reader what connecting
            would get them -- and, more practically, it makes "the label says assets" unassertable
            without a wallet in the browser. Disabled rather than hidden: the label is the thing
            being communicated.
          */}
          <AmountField
            unit="assets"
            symbol={assetSymbol}
            value={input}
            onChange={setInput}
            onMax={() => undefined}
            maxDisabled
            hint={decision.reason}
          />
          <DecisionNote reason={decision.reason} tone="blocked" />
          <ScopeNote step="deposit" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Deposit assets" source="the field and every figure below are in ASSETS">
      <div className="grid gap-4">
        <AmountField
          unit="assets"
          symbol={assetSymbol}
          value={input}
          onChange={setInput}
          onMax={() => setInput(balance === null ? '' : maxAmountDecimal(balance, decimals))}
          maxDisabled={balance === null || !decimalsKnown}
          hint={
            balance === null
              ? account === undefined
                ? 'connect a wallet to read a balance'
                : balanceRead.isError
                  ? 'the balance could not be read'
                  : 'reading the balance…'
              : `balance ${figure(balance, decimals)} ${assetSymbol}`
          }
        />

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>
            vault allowance{' '}
            <span className="figure text-slate-300">
              {allowance === null ? '—' : `${figure(allowance, decimals)} ${assetSymbol}`}
            </span>{' '}
            {allowanceRead.isFetching ? '(re-reading from the chain…)' : '(read from the chain, never remembered)'}
          </span>
          <span>
            shares you would receive{' '}
            <span className="figure text-slate-300">
              {sharesPreview === null ? '—' : figure(sharesPreview, shareDecimals ?? 0)}
            </span>{' '}
            <span>via the vault&apos;s previewDeposit</span>
          </span>
        </div>

        <DecisionNote
          reason={decision.reason}
          tone={decision.kind === 'deposit' || decision.kind === 'approve' || decision.kind === 'empty' ? 'neutral' : 'blocked'}
        />

        <div className="flex flex-wrap items-center gap-3">
          {decision.kind === 'approve' ? (
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {busy ? 'Waiting for the wallet…' : `1. Approve ${assetSymbol}`}
            </button>
          ) : null}

          {decision.kind === 'deposit' ? (
            <button
              type="button"
              onClick={handleDeposit}
              disabled={simulation.data?.request === undefined || busy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {busy ? 'Waiting for the wallet…' : 'Deposit'}
            </button>
          ) : null}

          {decision.kind === 'approve' || decision.kind === 'deposit' || decision.kind === 'exceeds-balance' ? (
            <button
              type="button"
              onClick={() => {
                setInput('');
                setApproveTx(IDLE);
                setDepositTx(IDLE);
                setPromptError(null);
                resetWrite();
              }}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-400"
            >
              Clear
            </button>
          ) : null}
        </div>

        {simulation.error && decision.kind === 'deposit' ? (
          // The simulation's refusal, shown BEFORE any wallet prompt. This is the
          // "a revert surfaces as a readable reason" half of the simulate-before-write rule.
          <p className="rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
            The vault refused a simulated deposit of this amount, so it was not offered:{' '}
            {shortMessageOf(simulation.error)}
          </p>
        ) : null}

        <TxStatus state={approveState} />
        <TxStatus state={depositState} />

        {promptError?.message ? (
          // The error state, rendered without a <details> dump: the message is already a sentence
          // because `describeTxError` prefers viem's `shortMessage` over its full report.
          <p className="rounded-md border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-200">
            {promptError.message}
          </p>
        ) : null}

        {approveState.phase === 'rejected' || depositState.phase === 'rejected' ? (
          // Neutral tone, and stated as a cancellation rather than as a fault. Nothing was signed,
          // nothing was sent, no gas was spent, and the form is where it was.
          <p className="rounded-md border border-slate-600/60 bg-slate-800/40 p-3 text-xs text-slate-300">
            You cancelled in the wallet. Nothing was signed and nothing was sent, so no allowance and no balance
            changed. The form is back to idle.
          </p>
        ) : null}

        <ScopeNote step="deposit" />
      </div>
    </Panel>
  );
}
