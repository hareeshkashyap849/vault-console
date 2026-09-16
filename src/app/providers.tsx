'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';

import { wagmiConfig } from '@/lib/wagmi';

/**
 * The client-side providers.
 *
 * WHY THIS EXISTS AT ALL, WHEN THE CONSOLE NEXT DOOR NEEDS NOTHING
 *
 * `/vault` reads two sources on the server and renders strings. `/vault/manage` talks to a
 * wallet, and a wallet is browser state: `window.ethereum` does not exist in Node, and there is
 * no account to read until the page has run in a browser. So this is the one branch of the app
 * that needs a client tree, and it is confined to the routes that need it.
 *
 * WAGMI NEEDS REACT QUERY, and that is not optional plumbing: every `useReadContract` is a
 * TanStack query under the hood, which is exactly why the allowance must be `refetch`ed rather
 * than trusted. The cache is what makes the stale-approval bug possible; the fix is to re-read,
 * not to pretend the cache is not there.
 *
 * THE QUERY CLIENT IS CREATED IN STATE, NOT AT MODULE SCOPE
 *
 * A module-level `new QueryClient()` is shared by every request the server handles, which leaks
 * one user's cached reads into another's render. `useState` gives the component its own
 * instance and keeps it across re-renders. It is deliberately not re-created on every render
 * either -- that would throw the cache away mid-flight and re-issue reads the user is watching.
 *
 * FRESHNESS IS SET TO ZERO FOR READS
 *
 * `staleTime: 0` is the same decision `src/app/vault/page.tsx` makes with `dynamic =
 * 'force-dynamic'` and `cache: 'no-store'`, expressed in the vocabulary this side of the app
 * uses: a balance on screen is read from the chain for the render that shows it. This is
 * stricter than a dApp needs and it is the right side to err on -- an allowance that is one
 * block stale is the exact input that decides approve-versus-deposit.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Nothing on-chain is served from cache as though it were current. The wallet layer
            // re-reads the figures that decide a transaction (balance, allowance, maxWithdraw)
            // and this is the backstop under that.
            staleTime: 0,
            // A re-read on window focus is what makes a wallet changed in another tab visible
            // here. Turning it off would leave the form deciding on a balance the user changed.
            refetchOnWindowFocus: true,
            retry: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
