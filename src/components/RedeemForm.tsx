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
import { VAULT_ABI } from '@/lib/chain';
import { chainRefusalFor, decideRedeem, figure, maxAmountDecimal, type RedeemDecision } from '@/lib/vaultActions';
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
  /** The deployment's chain id, from `api/config`. Every refusal names it, so it is passed, not read. */
  chainId: number;
  /** The deployment's chain name, from the same record. Failure sentences name both. */
  chainName: string;
  vault: `0x${string}`;
  account: `0x${string}` | undefined;
  /**
   * CONNECTED, AND THE WALLET REPORTS NO ACCOUNT. See the same prop in `DepositForm`: measured with a
   * wallet answering `eth_accounts` with an empty array, this page rendered a stale address and
   * offered a write nothing could sign. Named rather than papered over.
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
 * THE ERROR BOX, WITHOUT SAYING THE SAME THING TWICE. The same rule as `DepositForm`'s, for the same
 * reason: a classified failure already renders its class's sentence in `TxStatus`, so repeating the
 * wallet's transport text under it is two messages about one fact. An unclassified error keeps the
 * old behaviour, because for that case the error's own text is all there is. A `4001` returns `null`.
 */
function promptErrorFor(err: unknown, where: { chainId: number; chainName: string }): { message: string | null; detail: string | null } | null {
  const kind = classifyWalletError(err);
  const sentence = walletFailureText(kind, where);
  if (sentence === null && kind !== 'unknown') return null;
  if (sentence !== null) return { message: sentence, detail: null };
  return describeWriteError(err);
}

/**
 * The redeem form: shares in, assets out.
 *
 * ONE TRANSACTION, AND NO APPROVAL STEP.
 *
 * `redeem` burns the caller's own shares, so there is no ERC-20 allowance involved and no
 * approve-then-redeem sequence to get right. The interesting facts on this path are different
 * ones: the input is in SHARES (not assets), the output is priced at the block the redemption
 * lands in, and the vault may not hold enough to pay it out.
 *
 * THE UNIT IS THE THING TO GET RIGHT HERE
 *
 * A `redeem` and a `withdraw` take different units -- shares and assets respectively -- and this
 * app implements only `redeem`. So the field is labelled in shares, the balance beside it is the
 * share balance, and the asset amount the user will receive is shown separately, read from the
 * vault's own `previewRedeem`. Labelling the field with the asset's symbol would make it read as
 * a withdrawal, which this app does not implement.
 *
 * The two units also carry different decimal counts (18 for shares, 6 for this asset), which is
 * why each figure is formatted with its own: one formatter for both is the bug this repository
 * already fixed once.
 *
 * THE HOOKS TAKE NO `config` ARGUMENT
 *
 * They read it from the `WagmiProvider` context. `<Providers>` builds the one config from
 * `api/config` at runtime and gives it to that provider: there is no module-level config left to
 * pass, and building another one here would leave wagmi's hooks reading a store nobody writes to.
 */
export function RedeemForm({
  chainId,
  chainName,
  vault,
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
  const [tx, setTx] = useState<TxState>(IDLE);
  const [promptError, setPromptError] = useState<{ message: string | null; detail: string | null } | null>(null);
  /** The chain guard's answer at the moment a write was asked for. See `chainIsWrongNow`. */
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  /** True while the wallet is being asked which chain it is on, so a second click cannot slip past. */
  const [checkingChain, setCheckingChain] = useState(false);
  const { connector } = useConnection();

  /** The two facts every failure sentence names. Built once, so no call site can name a different pair. */
  const chainWhere = { chainId, chainName };

  const shares = shareDecimals ?? 0;
  const sharesKnown = shareDecimals !== null;

  const shareBalanceRead = useReadContract({
    abi: VAULT_ABI,
    address: vault,
    functionName: 'balanceOf',
    args: account === undefined ? undefined : [account],
  });
  const shareDecimalsRead = useReadContract({
    abi: VAULT_ABI,
    address: vault,
    functionName: 'decimals',
  });

  /**
   * `maxWithdraw(owner)`, in ASSET base units, shown beside the form.
   *
   * It is displayed and NOT used as a gate. OpenZeppelin defines `maxWithdraw` as
   * `previewRedeem(maxRedeem(owner))`, so shares beyond it are a statement about the vault's
   * liquidity rather than about the user's ownership -- and blocking a redemption with a reason
   * derived from a second formula is exactly the kind of duplicated arithmetic this repository
   * forbids. The user is told; the decision stays theirs.
   */
  const maxWithdrawRead = useReadContract({
    abi: VAULT_ABI,
    address: vault,
    functionName: 'maxWithdraw',
    args: account === undefined ? undefined : [account],
  });

  const shareBalance = shareBalanceRead.data ?? null;
  // `decimals()` is read here as well as passed in: the figure has to be formatted with the
  // decimals the CHAIN reports for the shares on this vault, and a prop could be a different
  // vault's. The prop is the fallback for the render before the read lands.
  const shareDecimalsEffective = shareDecimalsRead.data === undefined ? shares : Number(shareDecimalsRead.data);

  const decision: RedeemDecision = useMemo(
    () =>
      decideRedeem({
        chainId,
        walletChainId: account === undefined ? null : walletChainId,
        shareBalance,
        shareDecimals: shareDecimalsEffective,
        input,
      }),
    [chainId, account, walletChainId, shareBalance, shareDecimalsEffective, input],
  );

  const redeemAmount = decision.kind === 'redeem' ? decision.baseUnits : null;

  /** What the user will receive, from the vault's own `previewRedeem`. */
  const previewRead = useReadContract({
    abi: VAULT_ABI,
    address: vault,
    functionName: 'previewRedeem',
    args: redeemAmount === null ? undefined : [redeemAmount],
  });

  const simulation = useSimulateContract({
    abi: VAULT_ABI,
    address: vault,
    functionName: 'redeem',
    // `receiver` and `owner` are both the connected account: this page redeems the reader's own
    // shares to the reader's own address. A third-party redemption is a different feature, and
    // offering it would mean an approval flow this app does not have.
    args: account === undefined || redeemAmount === null ? undefined : [redeemAmount, account, account],
    query: { enabled: decision.kind === 'redeem' && account !== undefined && sharesKnown },
  });

  const {
    mutate: writeContract,
    isPending: isWriting,
    reset: resetWrite,
  } = useWriteContract();

  const receipt = useWaitForTransactionReceipt({
    hash: tx.hash ?? undefined,
  });

  /**
   * Re-read the share balance after the redemption lands.
   *
   * Not for the allowance's reason -- there is no allowance here -- but for the same underlying
   * one: `useReadContract` caches, and a redemption that confirmed a block ago has changed this
   * account's shares. Deciding the next redemption from the pre-redemption balance is how a
   * second submission of the same amount reverts on `ERC4626ExceededMaxRedeem`.
   */
  const refetchShares = shareBalanceRead.refetch;
  const refetchMaxWithdraw = maxWithdrawRead.refetch;
  const receiptStatus = receipt.status;
  useEffect(() => {
    if (receiptStatus === undefined) return;
    void refetchShares();
    void refetchMaxWithdraw();
  }, [receiptStatus, refetchShares, refetchMaxWithdraw]);

  // The fold lives in `txState.ts`: a receipt describes a transaction, so it may only move a write
  // that HAS one. The inline version this replaces fed a refused write -- no hash, no transaction --
  // to a disabled receipt query, which answers "pending", so the page reported an approval that had
  // been rejected in the wallet as on its way to the chain. The same fold is used here for the same
  // reason rather than re-derived: this path shares `mapWriteError` and the five phases with the
  // deposit form, and it shared the defect too.
  const state = txStateFor('redeem', tx, receipt);
  const busy = isWriting || checkingChain || state.phase === 'pending';
  const assetsPreview = previewRead.data === undefined ? null : previewRead.data;

  /**
   * The chain, asked of the wallet at the moment the write is made. See the long note in
   * `DepositForm.chainIsWrongNow` -- the reasoning is one argument about one defect, and the redeem
   * path is exposed to it identically (the render refuses a settled switch; this catches the one
   * that has not settled).
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

  /** Cleared when the wallet is back on the deployment's chain, so the sentence outlives no fact. */
  useEffect(() => {
    if (walletChainId === chainId) setWriteRefusal(null);
  }, [walletChainId, chainId]);

  async function handleRedeem() {
    // `simulateContract` answers with `{ result, request }`. It is `request` that is sent, so what
    // was checked is what goes to the wallet.
    const request = simulation.data?.request;
    if (request === undefined) return;
    if (await chainIsWrongNow()) return;
    setPromptError(null);
    resetWrite();
    try {
      writeContract(request, {
        onSuccess: (hash) => setTx(pendingState('redeem', hash)),
        onError: (error) => {
          // Classified, exactly as the deposit path is: the reader is told which failure it was and
          // what to do, instead of being handed the wallet's transport text.
          setTx(mapWriteError('redeem', error, 'The redemption could not be sent.', chainWhere));
          setPromptError(promptErrorFor(error, chainWhere));
        },
      });
    } catch (cause) {
      setTx(mapWriteError('redeem', cause, 'The redemption could not be sent.', chainWhere));
      setPromptError(promptErrorFor(cause, chainWhere));
    }
  }

  if (decision.kind === 'no-wallet' || decision.kind === 'wrong-chain') {
    return (
      <Panel title="Redeem shares" source="the field is in SHARES; the payout is in ASSETS">
        <div className="grid gap-4">
          <WalletStateNotice
            kind={decision.kind}
            chainId={chainId}
            walletChainId={walletChainId}
            onSwitch={onSwitchChain}
            switching={isSwitching}
            accountMissing={walletAccountMissing}
          />
          {/* Present and disabled, in the unit it will take -- see the same block in DepositForm. */}
          <AmountField
            unit="shares"
            value={input}
            onChange={setInput}
            onMax={() => undefined}
            maxDisabled
            hint={decision.reason}
          />
          <DecisionNote reason={decision.reason} tone="blocked" />
          <ScopeNote step="redeem" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Redeem shares" source="the field is in SHARES; the payout is in ASSETS">
      <div className="grid gap-4">
        <AmountField
          unit="shares"
          value={input}
          onChange={setInput}
          // A DECIMAL STRING, never base units. Same rule as the deposit's Max, same reason.
          onMax={() => setInput(shareBalance === null ? '' : maxAmountDecimal(shareBalance, shareDecimalsEffective))}
          maxDisabled={shareBalance === null || !sharesKnown}
          hint={
            shareBalance === null
              ? shareBalanceRead.isError
                ? 'the share balance could not be read'
                : 'reading the share balance…'
              : `shares held ${figure(shareBalance, shareDecimalsEffective)}`
          }
        />

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>
            assets you would receive{' '}
            <span className="figure text-slate-300">
              {assetsPreview === null ? '—' : figure(assetsPreview, assetDecimals ?? 0)} {assetSymbol}
            </span>{' '}
            <span>via the vault&apos;s previewRedeem</span>
          </span>
          <span>
            vault max withdrawable{' '}
            <span className="figure text-slate-300">
              {maxWithdrawRead.data === undefined
                ? '—'
                : `${figure(maxWithdrawRead.data, assetDecimals ?? 0)} ${assetSymbol}`}
            </span>{' '}
            <span>the vault&apos;s own maxWithdraw, shown not enforced</span>
          </span>
        </div>

        <DecisionNote
          reason={writeRefusal ?? decision.reason}
          tone={
            writeRefusal !== null
              ? 'blocked'
              : decision.kind === 'redeem' || decision.kind === 'empty'
                ? 'neutral'
                : 'blocked'
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          {decision.kind === 'redeem' ? (
            <button
              type="button"
              onClick={handleRedeem}
              disabled={simulation.data?.request === undefined || busy || writeRefusal !== null}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {busy ? 'Waiting for the wallet…' : 'Redeem'}
            </button>
          ) : null}
          {decision.kind === 'redeem' || decision.kind === 'exceeds-shares' ? (
            <button
              type="button"
              onClick={() => {
                setInput('');
                setTx(IDLE);
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

        {simulation.error && decision.kind === 'redeem' ? (
          <p className="rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
            The vault refused a simulated redemption of these shares, so it was not offered:{' '}
            {shortMessageOf(simulation.error)}
          </p>
        ) : null}

        <TxStatus state={state} />

        {promptError?.message ? (
          <p className="rounded-md border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-200">
            {promptError.message}
          </p>
        ) : null}

        {state.phase === 'rejected' ? (
          <p className="rounded-md border border-slate-600/60 bg-slate-800/40 p-3 text-xs text-slate-300">
            You cancelled in the wallet. Nothing was signed and nothing was sent, so no shares were burned. The form
            is back to idle.
          </p>
        ) : null}

        <ScopeNote step="redeem" />
      </div>
    </Panel>
  );
}
