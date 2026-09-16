import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Vault Console',
  description:
    'Console and wallet over an ERC-4626 vault: what the chain says now, what the index says happened, and which of the two each figure came from.',
};

/**
 * The four routes, in the order a reader needs them.
 *
 * The nav moved into the layout when this app grew past one page. Before that, each page was
 * reachable only from the landing page, which is fine for a demo and wrong for an app: three
 * routes with no way between them read as three demos. It is a `<nav>` and not a `<section>`
 * deliberately -- the console's assertions count its four panels, and a wrapper that changed
 * that count would make an unrelated check fail for a layout reason.
 */
const ROUTES = [
  { href: '/', label: 'Overview' },
  { href: '/vault', label: 'Console' },
  { href: '/history', label: 'History' },
  { href: '/vault/manage', label: 'Wallet' },
];

/**
 * The shell.
 *
 * `Providers` wraps everything because a provider has to be an ancestor of the components that
 * consume it, and Next gives no per-route layout boundary that would keep it off `/`, `/vault`
 * and `/history`. The cost of that is nothing here: the Wagmi and React Query contexts hold no
 * figures, and neither one issues a read until a component calls a hook. `/vault` and `/history`
 * are still server components whose sources are fetched on the server -- a read-only page does
 * not become a client page because a provider is above it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-slate-950 text-slate-200 antialiased">
        <nav className="border-b border-slate-900">
          <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-5 gap-y-1 px-6 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Vault Console</span>
            {ROUTES.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className="text-xs text-slate-400 underline decoration-slate-700 underline-offset-2 hover:text-slate-100"
              >
                {route.label}
              </Link>
            ))}
          </div>
        </nav>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
