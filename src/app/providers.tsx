'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, type Config } from 'wagmi';

import { loadRuntimeConfig, type RuntimeConfig } from '@/lib/runtimeConfig';
import { createWagmiConfig } from '@/lib/wagmi';

/**
 * The client-side providers, and the one thing that has to happen before any of them.
 *
 * THE ORDER IS THE DESIGN
 *
 *   1. `api/config` is fetched. Everything below needs it: the chain id and RPC the wallet is
 *      configured with, and the vault address every panel reads.
 *   2. wagmi is built from that config. It cannot be built earlier and it must not be built
 *      twice -- a second `createConfig` would give the components a different instance from the
 *      one the provider holds, and wagmi's hooks would read a store nobody writes to.
 *   3. The children render.
 *
 * Until step 1 finishes there is nothing truthful to render, so the tree shows a loading state
 * rather than an empty console. A page that renders panels with no address in them looks exactly
 * like a page whose chain is broken, and the reader would debug the chain.
 *
 * WHY REACT QUERY IS REQUIRED AND NOT PLUMBING
 *
 * Every wagmi read is a TanStack query underneath, which is exactly why an allowance must be
 * `refetch`ed rather than trusted: the cache is what makes the stale-approval bug possible, and
 * the fix is to re-read rather than to pretend the cache is not there.
 *
 * `staleTime: 0` is the same decision the pages used to make with `dynamic = 'force-dynamic'` and
 * `cache: 'no-store'`, expressed in the vocabulary this side of the app uses now that the reads
 * happen here: a balance on screen was read from the chain for the render that shows it.
 *
 * THE QUERY CLIENT IS CREATED IN STATE, NOT AT MODULE SCOPE
 *
 * A module-level `new QueryClient()` is shared by every request a server handles. That mattered
 * when these pages were server components; it still matters for correctness across a remount, and
 * `useState` costs nothing.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Nothing on-chain is served from cache as though it were current. The wallet layer
            // re-reads the figures that decide a transaction (balance, allowance, maxWithdraw) and
            // this is the backstop under that.
            staleTime: 0,
            // A re-read on window focus is what makes a wallet changed in another tab visible
            // here. Turning it off would leave the form deciding on a balance the user changed.
            refetchOnWindowFocus: true,
            retry: false,
          },
        },
      }),
  );

  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeConfig()
      .then((config) => {
        if (cancelled) return;
        setRuntime(config);
        // Built once, here, from the fetched config. See the order note above.
        setWagmiConfig(createWagmiConfig(config));
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailure(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure !== null) {
    return (
      <main className="shell">
        <h1>The console could not start</h1>
        <p>
          It reads its addresses at runtime from <code>api/config</code>, which is generated from the
          deployment record. Nothing on this page can be shown without it, so it stops here rather
          than rendering panels with no address in them.
        </p>
        <pre>{failure}</pre>
      </main>
    );
  }

  if (runtime === null || wagmiConfig === null) {
    return (
      <main className="shell">
        <h1>Loading the deployment record…</h1>
        <p>Reading the addresses this console is pointed at. One small file, then the chain.</p>
      </main>
    );
  }

  return (
    <RuntimeConfigContext.Provider value={runtime}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </RuntimeConfigContext.Provider>
  );
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

/**
 * The runtime config, for anything under `Providers`.
 *
 * Throws when used outside the provider rather than returning `null`: every caller needs the
 * vault address, and a hook that hands back `null` pushes the same check into a dozen components,
 * where one of them will forget it.
 */
export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (config === null) {
    throw new Error('useRuntimeConfig must be used inside <Providers>, which is what loads api/config.');
  }
  return config;
}
