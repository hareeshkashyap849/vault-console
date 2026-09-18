'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useConnection,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';

import { AmountField, DecisionNote, Panel, ScopeNote, TxStatus, WalletStateNotice } from '@/components/WalletPanels';
import { ERC20_ABI, VAULT_ABI } from '@/lib/chain';
import { chainRefusalFor, decideDeposit, figure, maxAmountDecimal, type DepositDecision } from '@/lib/vaultActions';
import { classifyWalletError } from '@/lib/walletError';
import { walletFailureText } from '@/lib/walletFailureCopy';
import { walletChainNow } from '@/lib/wagmi';
import {
  describeWriteError,
  IDLE,
  mapWriteError,
  pendingState,
  shortMessageOf,
  txStateFor,
  type TxState,
} from '@/lib/txState';

interface Props {
  /** The deployment's chain id, from `api/config`. Every refusals names it, so it is passed, not read. */
  chainId: number;
  /** The deployment's chain name, from `api/config`. Passed so every failure sentence can name it. */
  chainName: string;
  vault: `0x${string}`;
  asset: `0x${string}`;
  account: `0x${string}` | undefined;
  /**
   * THE WALLET SAYS IT IS CONNECTED AND REPORTS NO ACCOUNT.
   *
   * Measured on the published console with a stub wallet answering `eth_accounts` with an empty
   * array: `getConnection()` returns `isConnected: true` with `address: undefined` (wagmi reads
   * `connection.accounts[0]`), and the page rendered a stale address, a balance read for it, and a
   * write control — then answered a click with `Waiting for the wallet…` and stayed there for ever,
   * because `eth_sendTransaction` on a wallet holding no account can only fail. This form's whole
   * job is to not offer a write that cannot happen, so the state is named rather than papered over.
   */
  walletAccountMissing: boolean;
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
 * THE ERROR BOX, WITHOUT SAYING THE SAME THING TWICE.
 *
 * A classified failure already has a sentence, and that sentence is rendered by `TxStatus` from the
 * transaction state itself. Rendering `describeWriteError` beside it printed the wallet's transport
 * text directly under the taxonomy's sentence -- measured: the panel said the class's line and the
 * box under it repeated `The Provider is disconnected from all chains.` A failure this app can name
 * therefore gets its CLASS's sentence and nothing else; one it cannot name keeps the old behaviour,
 * because for that case the error's own text is the only thing there is to show.
 *
 * A `4001` returns `null` already (the neutral box below the form states the cancellation), so the
 * ordering here cannot turn a cancellation into a failure.
 */
function promptErrorFor(err: unknown, where: { chainId: number; chainName: string }): { message: string | null; detail: string | null } | null {
  const kind = classifyWalletError(err);
  const sentence = walletFailureText(kind, where);
  if (sentence === null && kind !== 'unknown') return null;
  if (sentence !== null) return { message: sentence, detail: null };
  return describeWriteError(err);
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
 * NO `config` ARGUMENT ON THE HOOKS BELOW
 *
 * They read it from the `WagmiProvider` context, which holds the only config there is: `<Providers>`
 * builds it at runtime from `api/config` and hands it to that provider. There is no module-level
 * config left to pass, and building a second one here would give wagmi's hooks a store nobody
 * writes to.
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
  chainName,
  vault,
  asset,
  account,
  walletAccountMissing,
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
  /**
   * The chain guard's answer at the moment a write was asked for. See `chainIsWrongNow`.
   *
   * It holds a SENTENCE rather than a boolean so the page can say which chain it is on and which it
   * needs -- a refusal the reader cannot act on is the same defect as a red failure.
   */
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  /** True while the wallet is being asked which chain it is on, so a second click cannot slip past. */
  const [checkingChain, setCheckingChain] = useState(false);

  /**
   * THE CONNECTOR, WHICH IS HOW THIS FORM ASKS THE WALLET A QUESTION RATHER THAN ASSUMING AN ANSWER.
   * The chain it is on is asked again immediately before every write -- see `walletChainNow` in
   * `src/lib/wagmi.ts` for why the React value is not enough.
   */
  const { connector } = useConnection();

  /**
   * The two facts every failure sentence names, built once per render.
   *
   * A sentence that says "the account cannot pay the gas" without naming the chain is a sentence the
   * reader cannot act on -- gas is a different coin on every chain -- and writing the pair at each
   * call site is how one of them comes to name the wrong chain.
   */
  const chainWhere = { chainId, chainName };

  // Belt and braces: a null decimals would otherwise format an amount with a made-up one. Every
  // control below is disabled until the chain has answered.
  const decimals = assetDecimals ?? 0;
  const decimalsKnown = assetDecimals !== null;

  const balanceRead = useReadContract({
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
  } = useWriteContract();

  /**
   * TWO receipts, one per transaction, because a deposit can genuinely be two transactions and
   * each has its own outcome.
   *
   * `hash: undefined` is the documented "not waiting for anything" form, so the hooks are called
   * unconditionally and the hook ORDER does not depend on how far the flow has got.
   */
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approveTx.hash ?? undefined,
  });
  const depositReceipt = useWaitForTransactionReceipt({
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
   * `txStateFor` IS THE WHOLE OF THIS, AND IT IS NOT A TERNARY HERE ON PURPOSE. The version this
   * replaces read `phase === 'idle' ? IDLE : mapReceipt(step, { ...receipt, hash })`, so a write
   * that the wallet had REFUSED -- no hash, no transaction -- was still fed to the receipt watch;
   * a disabled receipt query reports "pending", and the published page therefore answered a click
   * on Reject with "Approval sent. The wallet prompt is done; this waits for the chain to include
   * it." The rule ("a receipt describes a transaction, so it may only move a write that has one")
   * lives in `txState.ts`, where it can be tested without a wallet, a browser or a chain.
   */
  const approveState = txStateFor('approve', approveTx, approveReceipt);
  const depositState = txStateFor('deposit', depositTx, depositReceipt);

  /** Any write in flight blocks both buttons: two prompts at once is not a state to allow. */
  const busy = isWriting || checkingChain || approveState.phase === 'pending' || depositState.phase === 'pending';

  /**
   * THE CHAIN, CHECKED WHERE THE WRITE IS MADE RATHER THAN ONLY WHERE IT IS OFFERED.
   *
   * `decision` is computed for a render; a write is created by a click. When the wallet has moved to
   * another chain the render already refuses (the form renders the wrong-chain notice and no
   * control), and that is what the published page did NOT do -- it offered `1. Approve USDC` while
   * the wallet was on Base mainnet, and the click put an `approve` in front of the wallet on a chain
   * where this deployment does not exist (`0x2105` in the wallet's own error).
   *
   * A settled switch is caught by the render. A switch that has NOT settled is caught here, and the
   * two are not the same case: React commits a re-render on its own schedule, and a click can be
   * delivered in the same task as the wallet's `chainChanged` event, while the button that is about
   * to be removed is still on screen. So the chain is asked of the wallet, not read from the tree.
   *
   * A refusal does NOT become a transaction state: nothing was sent, so there is no transaction to
   * describe. It is the same sentence the decision produces, and it is rendered where the decision
   * is rendered.
   */
  async function chainIsWrongNow(): Promise<boolean> {
    if (connector === undefined) {
      setWriteRefusal(chainRefusalFor(chainId, null));
      return true;
    }
    setCheckingChain(true);
    const liveChainId = await walletChainNow(connector);
    setCheckingChain(false);
    const refusal = chainRefusalFor(chainId, liveChainId);
    setWriteRefusal(refusal);
    return refusal !== null;
  }

  /**
   * The refusal is cleared when the wallet is back on the deployment's chain.
   *
   * Without this the sentence would outlive the fact: the reader switches back to the right chain,
   * the form re-renders, and a refusal from a moment ago would keep the buttons disabled and the
   * page telling them to do what they have just done.
   */
  useEffect(() => {
    if (walletChainId === chainId) setWriteRefusal(null);
  }, [walletChainId, chainId]);

  async function handleApprove() {
    if (depositAmount === null) return;
    if (await chainIsWrongNow()) return;
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
            // A `4001` returns the form to idle with a neutral note -- never the red path. Anything
            // else is CLASSIFIED (`walletError.ts`) so the reader is told which failure it was and
            // what to do, rather than being handed the wallet's transport text.
            setApproveTx(mapWriteError('approve', error, 'The approval could not be sent.', chainWhere));
            setPromptError(promptErrorFor(error, chainWhere));
          },
        },
      );
    } catch (cause) {
      // A synchronous throw -- no injected provider, for instance -- never reaches `onError`.
      setApproveTx(mapWriteError('approve', cause, 'The approval could not be sent.', chainWhere));
      setPromptError(promptErrorFor(cause, chainWhere));
    }
  }

  async function handleDeposit() {
    // `simulateContract` answers with `{ result, request }`: `result` is the decoded return value
    // and `request` is the fully-formed write. It is `request` that gets sent -- not `data`, which
    // is the query's wrapper around both, and not a second hand-built argument list, which is how
    // what was simulated and what is sent come to differ.
    const request = simulation.data?.request;
    if (request === undefined) return;
    if (await chainIsWrongNow()) return;
    setPromptError(null);
    resetWrite();
    try {
      writeContract(request, {
        onSuccess: (hash) => setDepositTx(pendingState('deposit', hash)),
        onError: (error) => {
          setDepositTx(mapWriteError('deposit', error, 'The deposit could not be sent.', chainWhere));
          setPromptError(promptErrorFor(error, chainWhere));
        },
      });
    } catch (cause) {
      setDepositTx(mapWriteError('deposit', cause, 'The deposit could not be sent.', chainWhere));
      setPromptError(promptErrorFor(cause, chainWhere));
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
            accountMissing={walletAccountMissing}
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
          reason={writeRefusal ?? decision.reason}
          tone={
            writeRefusal !== null
              ? 'blocked'
              : decision.kind === 'deposit' || decision.kind === 'approve' || decision.kind === 'empty'
                ? 'neutral'
                : 'blocked'
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          {decision.kind === 'approve' ? (
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy || writeRefusal !== null}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {busy ? 'Waiting for the wallet…' : `1. Approve ${assetSymbol}`}
            </button>
          ) : null}

          {decision.kind === 'deposit' ? (
            <button
              type="button"
              onClick={handleDeposit}
              disabled={simulation.data?.request === undefined || busy || writeRefusal !== null}
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
                setWriteRefusal(null);
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
