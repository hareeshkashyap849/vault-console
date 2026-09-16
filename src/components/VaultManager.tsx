'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useChainId,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useSwitchConnection,
} from 'wagmi';

import { BackLink, Panel, ReadState } from '@/components/WalletPanels';
import { DepositForm } from '@/components/DepositForm';
import { RedeemForm } from '@/components/RedeemForm';
import { figure } from '@/lib/vaultActions';
import { shortenAddress } from '@/lib/format';
import { ERC20_ABI, VAULT_ABI } from '@/lib/chain';
import { addChainParameterFor, wagmiConfig } from '@/lib/wagmi';

/**
 * The wallet page: connect, read your position, deposit, redeem.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO DECIDE
 *
 * Nothing. Every "what is offered next" question goes to `src/lib/vaultActions.ts`, and every
 * transaction state to `src/lib/txState.ts`. This file reads the chain, passes the values into
 * those functions, and renders what they return -- which is what makes the decisions assertable
 * without a wallet, a browser or a chain.
 *
 * THE ONE THING THIS COMPONENT MUST NOT DO
 *
 * It must not remember an approval. There is no `approvalState`, no `approvedOnce`, no ref, and
 * no module-level variable anywhere on this path. The allowance is a `useReadContract` result,
 * it is passed to `decideDeposit` on every render, and it is `refetch`ed after any write
 * confirms -- because a `useReadContract` result IS a cache, and the bug this app exists not to
 * reintroduce came from trusting a cache over the chain.
 *
 * Note also what happens after a *deposit* confirms: the allowance is re-read as well, not just
 * after an approval. That is the missing half of the sibling dApp's bug -- `deposit` CONSUMES
 * the approval, so the allowance that made the last deposit possible is gone by the time the
 * next one is typed.
 *
 * TWO CHAIN IDS, AND THEY ARE DIFFERENT FACTS
 *
 * `useChainId()` is the chain the wallet is actually on, and it is the one the pre-flight check
 * uses: deciding "is this wallet on the right chain" from the configured chain would answer
 * `true` always, and the check would never fire. The id in the `chainId` prop is the deployment
 * the server read. The page shows both, because "you are on chain 1" is only actionable beside
 * "this app is on chain 31337".
 *
 * THE WAGMI v3 SHAPE, WHICH IS NOT THE v2 SHAPE THE SKILL LIBRARY DOCUMENTS
 *
 *   - `config` is a HOOK argument, not a `mutate` argument. `mutate({ connector })`, never
 *     `mutate({ config, connector })` -- `ConnectVariables` has no `config` field, which is what
 *     the compiler reports as "'config' does not exist in type 'ConnectVariables'".
 *   - The mutations are `mutate` / `mutateAsync`. `connect`, `disconnect`, `switchChain` and
 *     `writeContract` still exist on the returned objects but are marked `@deprecated`, and this
 *     app does not build on a deprecation.
 *   - The connector LIST comes from `useConnectors()`. It was removed from `useConnect()`,
 *     `useDisconnect()` and `useSwitchConnection()`.
 *   - `switchChain`'s `chainId` is typed as the union of the config's chain ids, not `number`. So
 *     the prop is narrowed to that union below rather than widened, and a comparison against a
 *     plain `number` is the "'1' and '0' have no overlap" error the compiler reports for it.
 */

/**
 * The config's own type, so a hook's `functionName` and `args` are checked against the ABI
 * literal and `switchChain` accepts only a chain this config knows. Without it every call site
 * needs a hand-written annotation, which is how a wrong argument type gets asserted away by hand
 * instead of by the compiler.
 */
type WagmiConfig = typeof wagmiConfig;

/** One of the chain ids this app is configured for. Derived, never written out. */
type SupportedChainId = (typeof wagmiConfig)['chains'][number]['id'];

/** The vault's asset, read from the chain rather than typed: symbol and decimals both. */
interface AssetIdentity {
  symbol: string | null;
  decimals: number | null;
}

export function VaultManager({
  chainId,
  vault,
  asset,
}: {
  chainId: SupportedChainId;
  vault: `0x${string}`;
  asset: `0x${string}`;
}) {
  const connection = useConnection({ config: wagmiConfig as WagmiConfig });
  const connectors = useConnectors({ config: wagmiConfig as WagmiConfig });
  const { mutate: connect, error: connectError, isPending: isConnecting } = useConnect({
    config: wagmiConfig as WagmiConfig,
  });
  const { mutate: disconnect } = useDisconnect({ config: wagmiConfig as WagmiConfig });
  // Used when more than one injected provider is present: switching connections is a different
  // act from switching chains, and the two are labelled differently below.
  const { mutate: switchConnection } = useSwitchConnection({ config: wagmiConfig as WagmiConfig });
  const { mutate: switchChain, isPending: isSwitching } = useSwitchChain({ config: wagmiConfig as WagmiConfig });

  // The wallet's chain. See the header: this is what the pre-flight check reads.
  const walletChainId = useChainId({ config: wagmiConfig as WagmiConfig });
  const account = connection.isConnected ? connection.address : undefined;
  const isWrongChain = account !== undefined && walletChainId !== chainId;

  /**
   * `useConnectors()` returns a readonly array whose element type is only `Connector` when the
   * length is known to be non-zero, so the emptiness is answered ONCE and the answer is used
   * everywhere below. Reading `connectors.length` at two call sites produced a comparison the
   * compiler called unintentional -- and it was right: the two reads can disagree.
   */
  const firstConnector = connectors[0];
  const hasConnector = firstConnector !== undefined;

  const assetRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: ERC20_ABI,
    address: asset,
    functionName: 'symbol',
  });
  const assetDecimalsRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: ERC20_ABI,
    address: asset,
    functionName: 'decimals',
  });
  // The vault's share decimals. Read here rather than passed down from the server because the
  // chain is the source: the deployment record names addresses, not precision.
  const shareDecimalsRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: VAULT_ABI,
    address: vault,
    functionName: 'decimals',
  });

  const identity: AssetIdentity = {
    symbol: assetRead.data ?? null,
    decimals: assetDecimalsRead.data === undefined ? null : Number(assetDecimalsRead.data),
  };
  const shareDecimals = shareDecimalsRead.data === undefined ? null : Number(shareDecimalsRead.data);

  /**
   * Switching the wallet's chain is one act, so it has one implementation, here.
   *
   * Both forms render a switch control when the wallet is on the wrong chain, and both call
   * this. Two copies of the `addEthereumChainParameter` payload would be two chances for one of
   * them to omit it, and the failure that produces -- a wallet that cannot be switched to the
   * very chain the page is reading -- looks like a wallet bug.
   */
  function switchToAppChain() {
    switchChain({
      chainId,
      // A wallet that has never seen chain 31337 cannot switch to it, and the default failure is
      // an opaque error from the extension. Handing it the parameter built from the app's own
      // chain object is what makes the prompt say what it is about to add.
      addEthereumChainParameter: addChainParameterFor(chainId),
    });
  }

  /** The symbol to print. A dash when the chain has not answered -- never an invented name. */
  const symbol = identity.symbol ?? '—';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Manage your position</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Connect a wallet, see what it holds in this vault, and deposit or redeem. Every figure here is read
          from the chain for the render that shows it, and the allowance is read again whenever it is needed
          rather than remembered.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <BackLink href="/vault">the read-only console</BackLink>
          <BackLink href="/">what this is</BackLink>
        </p>
      </header>

      <div className="grid gap-6">
        <Panel title="Wallet" source="the wallet, and the chain the app is deployed on">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Address</dt>
              <dd className="figure text-lg text-slate-100" title={account ?? undefined}>
                {account === undefined ? '—' : shortenAddress(account)}
              </dd>
              {account === undefined ? <p className="text-xs text-slate-500">no wallet connected</p> : null}
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Wallet chain</dt>
              <dd className="figure text-lg text-slate-100">
                {account === undefined ? '—' : walletChainId}
              </dd>
              <p className={`text-xs ${isWrongChain ? 'text-amber-400/90' : 'text-slate-500'}`}>
                {account === undefined
                  ? 'connect a wallet to read it'
                  : isWrongChain
                    ? `this app is deployed on chain ${chainId}`
                    : 'matches the deployment'}
              </p>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Asset</dt>
              <dd className="figure text-lg text-slate-100">
                {symbol}
                <span className="ml-1 text-sm text-slate-400">
                  {identity.decimals === null ? '' : `${identity.decimals} decimals`}
                </span>
              </dd>
              <p className="figure text-xs text-slate-500">{asset}</p>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {account === undefined ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (firstConnector === undefined) return;
                    // `config` was given to `useConnect` above. It is NOT a variable of the
                    // mutation -- `ConnectVariables` has no such field.
                    connect({ connector: firstConnector });
                  }}
                  disabled={isConnecting || !hasConnector}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {isConnecting ? 'Connecting…' : 'Connect wallet'}
                </button>
                {!hasConnector ? (
                  <p className="text-xs text-amber-400/90">
                    No injected wallet was found in this browser. This app uses <span className="figure">injected()</span>{' '}
                    only -- a browser extension such as MetaMask. Nothing here can send a transaction without one.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-300"
                >
                  Disconnect
                </button>
                {isWrongChain ? (
                  <button
                    type="button"
                    onClick={switchToAppChain}
                    disabled={isSwitching}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-700"
                  >
                    {isSwitching ? 'Switching…' : `Switch to chain ${chainId}`}
                  </button>
                ) : null}
                {connectors.length > 1 ? (
                  // Only when there is a choice. With one injected provider this control would
                  // be a button that can only do what is already done.
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">switch connection</span>
                    {connectors.map((connector) => (
                      <button
                        key={connector.uid}
                        type="button"
                        onClick={() => switchConnection({ connector })}
                        className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300"
                      >
                        {connector.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {connectError ? (
            <p className="mt-3 rounded-md border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-200">
              The wallet did not connect: {connectError.message}
            </p>
          ) : null}
        </Panel>

        <PositionPanel
          vault={vault}
          asset={asset}
          assetSymbol={symbol}
          assetDecimals={identity.decimals}
          account={account}
        />

        <DepositForm
          chainId={chainId}
          vault={vault}
          asset={asset}
          account={account}
          walletChainId={account === undefined ? null : walletChainId}
          assetSymbol={symbol}
          assetDecimals={identity.decimals}
          shareDecimals={shareDecimals}
          onSwitchChain={switchToAppChain}
          isSwitching={isSwitching}
        />

        <RedeemForm
          chainId={chainId}
          vault={vault}
          account={account}
          walletChainId={account === undefined ? null : walletChainId}
          assetSymbol={symbol}
          assetDecimals={identity.decimals}
          shareDecimals={shareDecimals}
          onSwitchChain={switchToAppChain}
          isSwitching={isSwitching}
        />
      </div>
    </main>
  );
}

/**
 * The reader's position.
 *
 * Three figures, each read from the chain, each labelled with the unit it is in -- because
 * `maxWithdraw` is in ASSET base units while a share balance is in SHARE base units, and the two
 * are formatted with different decimal counts. One formatter for both is precisely the bug this
 * repository already fixed once (`displayBaseUnits` vs `displayDecimal`), and calling the wrong
 * one here would print a plausible wrong number.
 */
function PositionPanel({
  vault,
  asset,
  assetSymbol,
  assetDecimals,
  account,
}: {
  vault: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number | null;
  account: `0x${string}` | undefined;
}) {
  const shares = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: VAULT_ABI,
    address: vault,
    functionName: 'balanceOf',
    args: account === undefined ? undefined : [account],
  });
  const shareDecimalsRead = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: VAULT_ABI,
    address: vault,
    functionName: 'decimals',
  });
  const maxWithdraw = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: VAULT_ABI,
    address: vault,
    functionName: 'maxWithdraw',
    args: account === undefined ? undefined : [account],
  });
  const assetBalance = useReadContract({
    config: wagmiConfig as WagmiConfig,
    abi: ERC20_ABI,
    address: asset,
    functionName: 'balanceOf',
    args: account === undefined ? undefined : [account],
  });

  const shareDecimals = shareDecimalsRead.data === undefined ? null : Number(shareDecimalsRead.data);
  const anyError = shares.isError || maxWithdraw.isError || assetBalance.isError || shareDecimalsRead.isError;

  return (
    <Panel title="Your position" source="read from the chain, for this account">
      {account === undefined ? (
        <p className="text-sm text-slate-400">
          Connect a wallet and its balances appear here. Nothing is read until there is an address to read them
          for, and no figure is shown as zero in the meantime.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          {assetBalance.data === undefined ? (
            <ReadState label={`${assetSymbol} balance`} error={assetBalance.isError} />
          ) : (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Asset balance</dt>
              <dd className="figure text-lg text-slate-100">
                {figure(assetBalance.data, assetDecimals ?? 0)}
                <span className="ml-1 text-sm text-slate-400">{assetSymbol}</span>
              </dd>
              <p className="text-xs text-slate-500">
                the asset, {assetDecimals ?? '—'} decimals -- what a deposit spends
              </p>
            </div>
          )}

          {shares.data === undefined ? (
            <ReadState label="Share balance" error={shares.isError} />
          ) : (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Share balance</dt>
              <dd className="figure text-lg text-slate-100">
                {figure(shares.data, shareDecimals ?? 0)}
                <span className="ml-1 text-sm text-slate-400">shares</span>
              </dd>
              <p className="text-xs text-slate-500">
                the vault&apos;s shares, {shareDecimals ?? '—'} decimals -- what a redemption spends
              </p>
            </div>
          )}

          {maxWithdraw.data === undefined ? (
            <ReadState label="Max withdrawable" error={maxWithdraw.isError} />
          ) : (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Max withdrawable</dt>
              <dd className="figure text-lg text-slate-100">
                {figure(maxWithdraw.data, assetDecimals ?? 0)}
                <span className="ml-1 text-sm text-slate-400">{assetSymbol}</span>
              </dd>
              <p className="text-xs text-slate-500">
                the vault&apos;s own `maxWithdraw`, in the asset&apos;s units
              </p>
            </div>
          )}
        </dl>
      )}

      {anyError ? (
        <p className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          One of these reads failed, so its cell shows a dash rather than a number. A failed read is not a zero.
        </p>
      ) : null}
    </Panel>
  );
}
