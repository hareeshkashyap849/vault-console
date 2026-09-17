'use client';

import Link from 'next/link';

import { useRuntimeConfig } from '@/app/providers';

/**
 * The landing page.
 *
 * WHY THIS IS A PAGE AND NOT A REDIRECT TO `/vault`
 *
 * The console answers "what is the vault worth now, and what did the index record". It does not
 * answer "what is this, and what are the things I can do here" -- and a reader arriving at a
 * URL with a candlestick chart and four panels has to reverse-engineer that from the panels. So
 * `/` states the shape of the app in one screen: what the vault is, why there are two sources,
 * and which of the three tools to open. `/vault` is then the console and nothing else, which is
 * also what lets its 14 browser assertions keep asserting exactly the console.
 *
 * The rule the rest of this repository holds to applies here too: every figure shown is read,
 * never asserted. The chain id, the name and the addresses below come from the deployment record
 * -- the same file the deploy script writes and the indexer reads -- through the generated runtime
 * config, and the page names the record it came from, so a reader can tell which deployment they
 * are looking at. Nothing on this page is a constant in the source.
 *
 * It is a client component now, like the rest of the app: the published console is a static export
 * and the addresses arrive at load time rather than at request time. Nothing here needs the chain,
 * so the page renders as soon as the config is read.
 */

function Card({ title, href, children }: { title: string; href: string | null; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        {href !== null && (
          <Link href={href} className="text-xs text-sky-400 underline underline-offset-2 hover:text-sky-300">
            open {href}
          </Link>
        )}
      </header>
      <div className="space-y-3 text-sm text-slate-300">{children}</div>
    </section>
  );
}

export default function LandingPage() {
  /**
   * The deployment identity, from the runtime config.
   *
   * This page used to read the deployment record itself, in a `try`/`catch`, and render the
   * loader's message when there was none. Every page did that, in its own way, which meant every
   * page had its own idea of what "no record" looks like. There is now ONE place: `Providers`
   * fetches `api/config` before any page renders, and shows that message instead of the app. So
   * this page can state the addresses it was given and nothing else -- and there is no dead
   * branch here that looks like a live fallback.
   */
  const runtime = useRuntimeConfig();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-slate-100">Vault Console</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          An ERC-4626 vault, read from two independent sources, with a wallet path for the two write
          operations this app implements.
        </p>
      </header>

      <div className="grid gap-6">
        <Card title="What the vault is" href={null}>
          <p>
            An ERC-4626 tokenised vault. It holds one ERC-20 asset and issues shares against it. The
            share price is not a parameter anyone sets: it follows from{' '}
            <span className="figure text-slate-200">totalAssets ÷ totalSupply</span>, plus the
            virtual-shares term the standard adds. Depositing gives assets to the vault and mints
            shares; redeeming burns shares and returns assets.
          </p>
          <p className="text-xs text-slate-500">
            Four write paths exist on the contract. This app implements <strong>two</strong> of them
            -- <span className="figure">deposit</span> and <span className="figure">redeem</span> --
            and does not implement <span className="figure">mint</span> or{' '}
            <span className="figure">withdraw</span>. The manage page says so beside the form as
            well, rather than leaving it to be discovered.
          </p>
        </Card>

        <Card title="Why two sources" href="/vault">
          <p>
            The <strong>chain</strong> knows what is true now and nothing about the past. The{' '}
            <strong>index</strong> has a record for every block and is always behind by design.
            Neither can answer the other&apos;s question, and they fail differently: if the chain is
            down the page must not present the index&apos;s old numbers as current, and if the index
            is down the current numbers are still exact.
          </p>
          <p className="text-xs text-slate-500">
            So the console fetches both, labels every figure with the source it came from, and
            refuses to draw a comparison when only one of the two is available.
          </p>
        </Card>

        <Card title="The indexed history" href="/history">
          <p>
            The console draws the price over time and counts the events. The history page lists them: every
            deposit, redemption and yield report the index holds, newest first, each with the block and the
            transaction hash that proves it — plus the same price series as a table, for a reader the chart does
            not serve.
          </p>
          <p className="text-xs text-slate-500">
            One source only. That page reads nothing from the chain, so it leads with the index&apos;s own lag and
            says so on every panel, rather than mixing a current figure with a historical one.
          </p>
        </Card>

        <Card title="What you can do here" href="/vault/manage">
          <p>
            <strong>Read.</strong> The console shows the vault from the chain and from the index at
            the same time. It asks for no wallet, uses no key, and writes nothing.
          </p>
          <p>
            <strong>Write.</strong> The manage page connects a browser wallet, shows your position,
            and offers a deposit and a redemption. Two write paths, on the chain this deployment
            record describes: <span className="figure text-slate-200">{runtime.chainName}</span> (
            {runtime.chainId}).
          </p>
          <p className="text-xs text-slate-500">
            A deposit is one or two transactions depending on the allowance the chain currently
            reports -- an approval first when it does not cover the deposit. The allowance is read
            from the chain every time it is needed and is never remembered between renders.
          </p>
        </Card>

        <Card title="Which deployment this is" href={null}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">chain</dt>
              <dd className="figure text-slate-200">
                {runtime.chainName} ({runtime.chainId})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">record</dt>
              <dd className="figure text-slate-400">
                {runtime.recordPath.split(/[\\/]/).slice(-3).join('/')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">vault</dt>
              <dd className="figure text-slate-400">{runtime.vault}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">asset</dt>
              <dd className="figure text-slate-400">{runtime.asset}</dd>
            </div>
            {runtime.note ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">the record&apos;s own note</dt>
                <dd className="text-xs text-slate-400">{runtime.note}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <footer className="border-t border-slate-800 pt-4 text-xs text-slate-500">
          The addresses above are generated from the deployment record by{' '}
          <span className="figure">scripts/build-runtime-config.mjs</span> and read by this page at
          load time; none of them is written into the source. One chain is configured -- the one the
          record names -- because this console reads one deployment, and a second chain in the wallet
          configuration would only offer to connect where the vault does not exist.
        </footer>
      </div>
    </main>
  );
}
