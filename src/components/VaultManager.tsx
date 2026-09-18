'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useConfig,
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
import { addChainParameterFor } from '@/lib/wagmi';
import { classifyWalletError } from '@/lib/walletError';
import { chainSwitchFailureText } from '@/lib/walletFailureCopy';

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
 * The id in the `chainId` prop is the deployment's own chain, which the page above reads from
 * `api/config` through `useRuntimeConfig()`. The other fact is the chain the WALLET is on, and it
 * comes from the CONNECTION -- `useConnection().chainId` -- not from `useChainId()`.
 *
 * THAT IS THE FIX FOR A MEASURED DEFECT, AND THE LINE IT REPLACES IS WORTH NAMING. This component
 * used `useChainId()` for the wallet's chain, with a comment asserting it "is the chain the wallet
 * is actually on". It is not. `useChainId()` returns `config.state.chainId`, and `createConfig` only
 * copies a connection's chain into it when that chain is one of `config.chains`:
 *
 *     // If chain is not configured, then don't switch over to it.
 *     if (!chains.getState().some((x) => x.id === chainId)) return;
 *
 * This app configures ONE chain, so a wallet on any other chain left `state.chainId` equal to the
 * deployment's chain -- and `decideDeposit`'s wrong-chain branch, whose whole input is that value,
 * compared the app's chain with itself and could never fire. Measured on the published console with
 * a wallet reporting chain `0x2105` (Base mainnet, 8453): the page read "Wallet chain 84532" beside
 * "matches the deployment", offered `1. Approve USDC`, and the click put an `approve` in front of
 * the wallet on a chain this deployment does not exist on. The failure that came back was the
 * chain's, not this app's: `gas required exceeds allowance (0)` from `0x2105`.
 *
 * The connection's `chainId` IS updated for an unconfigured chain -- the connector's `chainChanged`
 * listener writes it into the connection -- so it is the value the guard was always meant to read.
 * The chain is asked of the WALLET again immediately before every write (`src/lib/wagmi.ts`,
 * `walletChainNow`), because a chain switch can land between a render and a click.
 *
 * THE WAGMI v3 SHAPE, WHICH IS NOT THE v2 SHAPE THE SKILL LIBRARY DOCUMENTS
 *
 *   - These hooks take no `config` argument. They read the one config there is from the
 *     `WagmiProvider` context -- built at runtime from `api/config` by `<Providers>` -- so the
 *     `config: wagmiConfig as WagmiConfig` this file used to pass to every one of them is gone
 *     along with the module-level config it named.
 *   - The ABI is still what types the call: `functionName` and `args` are checked against the ABI
 *     literal passed beside them, so a wrong argument type is a compiler error and not something
 *     this file has to assert by hand.
 *   - `config` is not a `mutate` argument either. `mutate({ connector })`, never
 *     `mutate({ config, connector })` -- `ConnectVariables` has no `config` field, which is what
 *     the compiler reports as "'config' does not exist in type 'ConnectVariables'".
 *   - The mutations are `mutate` / `mutateAsync`. `connect`, `disconnect`, `switchChain` and
 *     `writeContract` still exist on the returned objects but are marked `@deprecated`, and this
 *     app does not build on a deprecation.
 *   - The connector LIST comes from `useConnectors()`. It was removed from `useConnect()`,
 *     `useDisconnect()` and `useSwitchConnection()`.
 *   - `switchChain`'s `chainId` is typed from the config's chains. While the config listed two
 *     chains it was a two-link literal union, which is why the prop was narrowed to that union
 *     and a comparison against a plain `number` produced the compiler's "'1' and '0' have no
 *     overlap". The config now holds ONE chain, chosen at runtime, so the id is `number` and
 *     there is no union left to narrow.
 */

/** The vault's asset, read from the chain rather than typed: symbol and decimals both. */
interface AssetIdentity {
  symbol: string | null;
  decimals: number | null;
}

export function VaultManager({
  chainId,
  chainName,
  vault,
  asset,
}: {
  /** The deployment's chain id from `api/config`, via the page's `useRuntimeConfig()`. */
  chainId: number;
  /** The deployment's chain name from the same record. Used to name the chain in failure sentences. */
  chainName: string;
  vault: `0x${string}`;
  asset: `0x${string}`;
}) {
  // The one config instance, built by `<Providers>` from the runtime config and held in React
  // context. It is read here only for `addChainParameterFor`, which needs the chain object the
  // config was built from rather than a second, hand-written description of the same chain.
  const config = useConfig();
  const connection = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, error: connectError, isPending: isConnecting } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  // Used when more than one injected provider is present: switching connections is a different
  // act from switching chains, and the two are labelled differently below.
  const { mutate: switchConnection } = useSwitchConnection();
  const { mutate: switchChain, isPending: isSwitching, error: switchChainError, reset: resetSwitchError } = useSwitchChain();

  // The wallet's chain, from the CONNECTION. See the header: this is the value the pre-flight check
  // reads, and `useChainId()` is not it -- that one is the app's chain and cannot see a wallet on a
  // chain this app has no deployment for.
  const walletChainId = connection.chainId ?? null;
  const account = connection.isConnected ? connection.address : undefined;
  /**
   * CONNECTED, AND NO ACCOUNT TO SHOW.
   *
   * `getConnection()` takes `address` from `connection.accounts[0]`, and `isConnected` from the
   * config's status -- so a wallet that answers `eth_accounts` with an empty array produces
   * `isConnected: true` with `address: undefined`, and a wallet that has not answered at all
   * (`status: 'reconnecting'`) produces `isConnected: false` with `address: undefined`. Both are
   * "the page cannot read this wallet's account", which is one fact with one notice, and neither is
   * "no wallet is connected" -- which is what the page used to render, beside a connection control
   * and a stale address.
   */
  const walletAccountMissing = account === undefined && (connection.isConnected || connection.status === 'reconnecting');
  const isWrongChain = account !== undefined && walletChainId !== chainId;

  /**
   * THE CHAIN SWITCH'S OWN FAILURE, RENDERED WHERE THE SWITCH IS.
   *
   * `useSwitchChain` was fired and its error went nowhere: measured with a stub wallet refusing
   * `wallet_switchEthereumChain` with MetaMask's `4902` sentence, the page re-rendered the same
   * "Switch the wallet to chain …" refusal and said nothing about the attempt, so a reader who
   * clicked the control saw no change and no reason. The sentence comes from the failure taxonomy
   * (`src/lib/walletFailureCopy.ts`), and a cancelled switch is said as a cancelled switch.
   */
  const chainWhere = { chainId, chainName };
  const switchFailure = chainSwitchFailureText(switchChainError, chainWhere, classifyWalletError(switchChainError));

  /**
   * `useConnectors()` returns a readonly array whose element type is only `Connector` when the
   * length is known to be non-zero, so the emptiness is answered ONCE and the answer is used
   * everywhere below. Reading `connectors.length` at two call sites produced a comparison the
   * compiler called unintentional -- and it was right: the two reads can disagree.
   */
  const firstConnector = connectors[0];
  const hasConnector = firstConnector !== undefined;

  const assetRead = useReadContract({
    abi: ERC20_ABI,
    address: asset,
    functionName: 'symbol',
  });
  const assetDecimalsRead = useReadContract({
    abi: ERC20_ABI,
    address: asset,
    functionName: 'decimals',
  });
  // The vault's share decimals. Read here rather than passed down as a prop because the chain is
  // the source: the deployment record names addresses, not precision.
  const shareDecimalsRead = useReadContract({
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
    // Cleared first: a refusal from a moment ago must not sit under a switch the reader has just
    // asked for again, for the same reason the write path clears its own refusal when the wallet
    // comes back to the deployment's chain.
    resetSwitchError();
    switchChain({
      chainId,
      // A wallet that has never seen this chain cannot switch to it, and the default failure is an
      // opaque error from the extension. Handing it the parameter built from the config's own
      // chain object is what makes the prompt say what it is about to add -- and `config` is the
      // instance every hook above is using, not a second description of the same chain.
      addEthereumChainParameter: addChainParameterFor(config, chainId),
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
              {account === undefined ? (
                <p className={`text-xs ${walletAccountMissing ? 'text-amber-400/90' : 'text-slate-500'}`}>
                  {walletAccountMissing ? 'the wallet reports no account' : 'no wallet connected'}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-500">Wallet chain</dt>
              <dd className="figure text-lg text-slate-100">
                {account === undefined ? '—' : walletChainId}
              </dd>
              <p className={`text-xs ${isWrongChain ? 'text-amber-400/90' : 'text-slate-500'}`}>
                {account === undefined
                  ? walletAccountMissing
                    ? 'nothing can be read or signed for it until it reports one'
                    : 'connect a wallet to read it'
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
                    // `config` is not a variable of the mutation -- `ConnectVariables` has no
                    // such field; `useConnect` reads it from the provider -- so the connector is
                    // the only thing named here.
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

          {/*
            THE SWITCH'S OWN FAILURE, beside the control that produced it.
            A wrong chain and a REFUSED switch are different facts: the first is the state, the
            second is an attempt that did not change it, and the second was previously not rendered
            anywhere at all -- the page re-drew the same refusal and the reader saw no change.
          */}
          {switchFailure !== null ? (
            <p className="mt-3 rounded-md border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-200">
              {switchFailure}
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
          chainName={chainName}
          vault={vault}
          asset={asset}
          account={account}
          walletAccountMissing={walletAccountMissing}
          walletChainId={account === undefined ? null : walletChainId}
          assetSymbol={symbol}
          assetDecimals={identity.decimals}
          shareDecimals={shareDecimals}
          onSwitchChain={switchToAppChain}
          isSwitching={isSwitching}
        />

        <RedeemForm
          chainId={chainId}
          chainName={chainName}
          vault={vault}
          account={account}
          walletAccountMissing={walletAccountMissing}
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
  const maxWithdraw = useReadContract({
    abi: VAULT_ABI,
    address: vault,
    functionName: 'maxWithdraw',
    args: account === undefined ? undefined : [account],
  });
  const assetBalance = useReadContract({
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
