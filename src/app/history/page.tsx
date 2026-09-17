'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useRuntimeConfig } from '@/app/providers';
import { createIndexApi } from '@/lib/api';
import { Failure, Figure, Panel } from '@/components/Panels';
import { duration, displayBaseUnits, shortenAddress, timeLabel } from '@/lib/format';
import { amountCell, decimalsFrom, newestFirst, priceRows, tallyKinds, truncationLabel } from '@/lib/history';
import type { PriceResponse, Status, SummaryResponse, VaultEvent } from '@/lib/types';

/**
 * The indexed history, at `/history`.
 *
 * ONE SOURCE, AND THE PAGE SAYS SO ON EVERY PANEL
 *
 * `/vault` reads two independent sources and is careful never to present one as the other.
 * This page reads exactly one -- the index service -- and that difference has to be visible,
 * because it changes what every figure here MEANS:
 *
 *   A figure from the chain is exact and current.
 *   A figure from the index is exact for the block it names and no later.
 *
 * The page therefore leads with the index's own lag and staleness rather than burying them,
 * and it does not show a single number read from the chain. If someone wants the current
 * totals, they are one link away on `/vault`, where they are read live; putting them here
 * would mean two numbers on one screen that were true at different moments, with nothing but
 * a caption to separate them.
 *
 * WHY THE EVENTS ARE WORTH A PAGE
 *
 * The console shows a price chart and four counters. The events themselves -- which account
 * deposited how much, in which block, in which transaction -- are the part of the index a
 * reader can actually check against a block explorer. That is the point: every row carries
 * the hash that proves it.
 *
 * THE TABLE SHOWS THE NEWEST N, AND SAYS SO
 *
 * `GET /api/events` is capped (500, per the service's own limit table), so this table is
 * never the whole history and must not read as if it were. The count comes from
 * `/api/summary`, the label is built from both, and a `shown > total` disagreement is
 * reported rather than clamped. See `truncationLabel` in `src/lib/history.ts`.
 */
/**
 * THE READ MOVED TO THE BROWSER, AND THE INDEPENDENCE MOVED WITH IT
 *
 * This was a server component that read four endpoints per request with `dynamic =
 * 'force-dynamic'` and `cache: 'no-store'`. The published console is a static export and a static
 * host runs no server, so the four reads are four client queries with `staleTime: 0` -- which is
 * the same freshness decision, made where the reads now happen.
 *
 * Four queries rather than one means four independent failures, which is what the `Promise.allSettled`
 * below used to guarantee: the tally and the rows come from different endpoints of the same service,
 * and one failing must not blank the page.
 */

/** How many rows each table asks for. Named here so the label and the request cannot drift. */
const EVENT_ROWS = 50;
const PRICE_ROWS = 25;

export default function Page() {
  const runtime = useRuntimeConfig();
  const api = useMemo(() => createIndexApi(runtime), [runtime]);

  // Independent, for the same reason `/vault` keeps its two sources apart: the tally and the
  // rows come from different endpoints of the same service, and one of them failing should
  // not blank the page. All four are allowed to fail on their own.
  const statusQuery = useQuery({ queryKey: ['status', runtime.indexApiUrl], queryFn: () => api.status() });
  const summaryQuery = useQuery({ queryKey: ['summary', runtime.indexApiUrl], queryFn: () => api.summary() });
  const eventsQuery = useQuery({
    queryKey: ['events', EVENT_ROWS, runtime.indexApiUrl],
    queryFn: () => api.events({ limit: EVENT_ROWS }),
  });
  const priceQuery = useQuery({
    queryKey: ['price', PRICE_ROWS, runtime.indexApiUrl],
    queryFn: () => api.price(PRICE_ROWS),
  });

  const status: Status | null = statusQuery.data ?? null;
  const summary: SummaryResponse | null = summaryQuery.data ?? null;
  const events: VaultEvent[] = eventsQuery.data?.events ?? [];
  const price: PriceResponse | null = priceQuery.data ?? null;

  const decimals = decimalsFrom(price);
  const tally = summary === null ? null : tallyKinds(summary);
  const rows = newestFirst(events);
  const series = price === null ? [] : priceRows(price.series, PRICE_ROWS);

  const loading = statusQuery.isPending || summaryQuery.isPending || eventsQuery.isPending;

  /** The first failure to reach the page, in the order a reader would look for it. */
  const failure: unknown | null = statusQuery.error ?? summaryQuery.error ?? eventsQuery.error ?? null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-slate-100">Indexed History</h1>
        {/*
          WHAT "READ FROM THE INDEX SERVICE" MEANS ON THIS BUILD.

          The paragraph below makes the page's central claim -- one source, no chain reads -- and
          `indexSnapshot` changes what that source IS. On the published export the answers were
          captured by the build and served as files, so "read from the index service" would be
          true about the PROVENANCE and misleading about the AGE: nothing is running behind this
          page, and the figures stop at the moment it was published. The `source` row in the
          list underneath says `index service snapshot` for the same reason, so the header does
          not contain one label that says snapshot next to another that does not.
        */}
        <p className="mt-1 text-sm text-slate-400">
          {runtime.indexSnapshot
            ? 'Read from a snapshot of the index service, taken when this page was published. Nothing is live here: ' +
              'the figures are frozen at that moment, and the age of the snapshot is below. Nothing on this page was ' +
              'read from the chain, so every figure is exact for the block it names and no later — including the ' +
              'counters at the top.'
            : 'Read from the index service alone. Nothing on this page was read from the chain, so every figure is ' +
              'exact for the block it names and no later — including the counters at the top.'}
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <div className="flex gap-1.5">
            <dt>vault</dt>
            <dd className="figure text-slate-400" title={runtime.vault}>
              {runtime.vault}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>source</dt>
            <dd className="text-slate-400">{runtime.indexSnapshot ? 'index service snapshot' : 'index service'}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>record</dt>
            <dd className="text-slate-400">{runtime.recordPath.split(/[\\/]/).slice(-3).join('/')}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6">
        {loading && failure === null ? (
          // A first render has no data and no error, which is not the same as an empty index. The
          // tables below are guarded on their values, so without this the page would look like a
          // service with nothing in it for as long as the first read takes.
          <Panel title="Index" source="the only source this page reads">
            <p className="text-sm text-slate-500">Reading the index service…</p>
          </Panel>
        ) : null}

        {failure !== null ? (
          <Panel title="Index" source="the only source this page reads">
            <Failure title="The index service could not be read." error={failure} />
            <p className="mt-3 text-sm text-slate-400">
              This page has no second source to fall back on, so it shows nothing rather than figures of unknown
              age. The index runs as a separate process from{' '}
              <span className="figure">erc4626-vault-dapp</span>.
            </p>
          </Panel>
        ) : null}

        {/* How current the data is. Shown FIRST, because everything below inherits it. */}
        {status !== null && (
          <Panel title="How current this is" source="the index service's own report">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Figure label="Indexed to block" value={String(status.lastIndexedBlock ?? '—')} />
              <Figure
                label="Lag"
                value={String(status.lagBlocks ?? '—')}
                suffix="blocks"
                hint={`indexer last ran ${duration(status.staleSeconds)} ago`}
              />
              <Figure label="Healthy" value={status.healthy ? 'yes' : 'no'} />
              <Figure
                label="Updated"
                value={status.updatedAt ? timeLabel(Math.floor(Date.parse(status.updatedAt) / 1000)) : '—'}
                hint={`chain head it last saw: ${status.chainHeadAtLastRun ?? '—'}`}
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500">{status.note}</p>
          </Panel>
        )}

        {/* The tally, with the service's two totals reconciled rather than both printed. */}
        {tally !== null && (
          <Panel title="Event tally" source="the index service's own summary">
            {tally.rows.length === 0 ? (
              <p className="text-sm text-slate-400">
                The index holds no events yet. That is a statement about the index, not about the vault: the
                indexer may not have reached the first event&apos;s block.
              </p>
            ) : (
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 font-medium">Kind</th>
                    <th className="py-2 text-right font-medium">Events</th>
                    <th className="py-2 text-right font-medium">Assets moved</th>
                  </tr>
                </thead>
                <tbody>
                  {tally.rows.map((row) => (
                    <tr key={row.kind} className="border-b border-slate-900 last:border-0">
                      <td className="py-2 text-slate-300">{row.label}</td>
                      <td className="figure py-2 text-right text-slate-100">{row.count.toLocaleString('en-US')}</td>
                      <td className="figure py-2 text-right text-slate-100">
                        {amountCell(row.assets, decimals, 'asset').text}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-800">
                    <td className="py-2 text-xs uppercase tracking-wide text-slate-500">Sum of the rows above</td>
                    <td className="figure py-2 text-right text-slate-100">
                      {tally.summedCount.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 text-right text-xs text-slate-500">
                      {tally.agrees
                        ? 'matches the service’s own total'
                        : `the service reports ${tally.reportedTotal.toLocaleString('en-US')}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {tally.disagreement !== null && (
              // Not a warning style. It is a statement of fact about the data, and the page
              // shows both figures rather than choosing -- see `tallyKinds`.
              <p className="mt-4 rounded-md border border-slate-700/60 bg-slate-800/30 p-3 text-xs text-slate-400">
                {tally.disagreement}
              </p>
            )}

            {summary !== null && summary.unknownKinds.length > 0 && (
              // Named, not folded away. A log the decoder does not understand is a gap in the
              // index's coverage, and the service's own kind list is the searchable fact.
              <p className="mt-4 text-xs text-slate-500">
                The index saw event kinds it has no decoder for:{' '}
                <span className="figure text-slate-400">{summary.unknownKinds.join(', ')}</span>. Their logs are
                stored but not counted above.
              </p>
            )}
          </Panel>
        )}

        {/* The rows a reader can check against a block explorer. */}
        <Panel title="Recent events" source="the index service, newest first">
          {eventsQuery.error !== null ? (
            <Failure title="The events could not be read." error={eventsQuery.error} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">
              No events are indexed in this range. An empty table here is not evidence that nothing happened — check
              <span className="figure"> Indexed to block</span> above.
            </p>
          ) : (
            <>
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 font-medium">Block</th>
                    <th className="py-2 font-medium">Time</th>
                    <th className="py-2 font-medium">Kind</th>
                    <th className="py-2 font-medium">Account</th>
                    <th className="py-2 text-right font-medium">Assets</th>
                    <th className="py-2 text-right font-medium">Shares</th>
                    <th className="py-2 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const assets = amountCell(row.assets, decimals, 'asset');
                    const shares = amountCell(row.shares, decimals, 'share');
                    return (
                      <tr
                        key={`${row.blockNumber}-${row.logIndex}`}
                        className="border-b border-slate-900 last:border-0"
                      >
                        <td className="figure py-2 text-slate-300">{row.blockNumber}</td>
                        <td className="figure py-2 text-slate-500">{timeLabel(row.timestamp)}</td>
                        <td className="py-2 text-slate-300">{row.kind}</td>
                        <td className="figure py-2 text-slate-400" title={row.account ?? undefined}>
                          {shortenAddress(row.account)}
                        </td>
                        {/* The title carries WHY a cell is an em dash, so the difference between
                            "no such amount" and "zero" is available without a legend. */}
                        <td className="figure py-2 text-right text-slate-100" title={assets.hint}>
                          {assets.text}
                        </td>
                        <td className="figure py-2 text-right text-slate-100" title={shares.hint}>
                          {shares.text}
                        </td>
                        <td className="figure py-2 text-slate-500" title={row.txHash}>
                          {shortenAddress(row.txHash)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <p className="mt-3 text-xs text-slate-500">
                {tally === null
                  ? `Showing ${rows.length} events. The service's own total is unavailable, so this table cannot say how many it is showing out of.`
                  : truncationLabel(rows.length, tally.reportedTotal, 'events').text}
                {decimals === null && (
                  <>
                    {' '}
                    The index has not reported the asset decimals, so the two amount columns are raw base units
                    rather than formatted amounts.
                  </>
                )}
              </p>
            </>
          )}
        </Panel>

        {/* The same series the console draws, as text: selectable, searchable, and readable
            without a chart. It is also the honest fallback for a reader the SVG fails. */}
        {price !== null && (
          <Panel title="Price series as a table" source="the index service, newest first">
            {series.length === 0 ? (
              <p className="text-sm text-slate-400">
                The index holds no price snapshots. The vault&apos;s price is computed from{' '}
                <span className="figure">totalAssets</span> and <span className="figure">totalSupply</span> at each
                indexed block, so this is empty only when no block has been indexed.
              </p>
            ) : (
              <>
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 font-medium">Block</th>
                      <th className="py-2 font-medium">Time</th>
                      <th className="py-2 text-right font-medium">Total assets</th>
                      <th className="py-2 text-right font-medium">Total shares</th>
                      <th className="py-2 text-right font-medium">Price per share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((row) => (
                      <tr key={row.blockNumber} className="border-b border-slate-900 last:border-0">
                        <td className="figure py-2 text-slate-300">{row.blockNumber}</td>
                        <td className="figure py-2 text-slate-500">{timeLabel(row.timestamp)}</td>
                        <td className="figure py-2 text-right text-slate-100">
                          {amountCell(row.totalAssets, decimals, 'asset').text}
                        </td>
                        <td className="figure py-2 text-right text-slate-100">
                          {amountCell(row.totalSupply, decimals, 'share').text}
                        </td>
                        <td className="figure py-2 text-right text-slate-100">{row.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-500">
                  {status === null
                    ? `Showing the most recent ${series.length} snapshots.`
                    : truncationLabel(series.length, status.snapshotCount, 'snapshots').text}{' '}
                  The chart on{' '}
                  <a className="underline decoration-slate-600 underline-offset-2 hover:text-slate-300" href="/vault">
                    the console
                  </a>{' '}
                  draws the same series over a longer window.
                </p>
              </>
            )}
          </Panel>
        )}

        <footer className="border-t border-slate-800 pt-4 text-xs text-slate-500">
          Read-only, and no wallet is required or requested. Every amount is rendered from the exact string the
          index stored; raw base units go through BigInt and the decimals the service reports, and nothing is
          routed through a JavaScript number, which would silently round a uint256.
        </footer>
      </div>
    </main>
  );
}
