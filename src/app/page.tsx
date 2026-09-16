import { indexApi, ServiceError } from '@/lib/api';
import { loadDeployment, chainConfig } from '@/lib/deployment';
import { ChainError, readDeployment } from '@/lib/chain';
import { PriceChart } from '@/components/PriceChart';
import { displayBaseUnits, displayDecimal, duration, timeLabel } from '@/lib/format';
import type { Candle, Status } from '@/lib/types';

/**
 * The console.
 *
 * Both sources are fetched here, on the server, and BOTH ARE ALLOWED TO FAIL INDEPENDENTLY.
 *
 * That independence is the point of the page. The chain and the index are separate
 * systems with separate failure modes:
 *
 *   chain down  -> the page knows nothing current, and must say so rather than showing
 *                  the index's stale figures as if they were now
 *   index down  -> the history is unavailable, and the current figures are still exact
 *
 * A page that required both would be down whenever either was, and a page that silently
 * fell back to one would label stale data as live. So each panel carries its own source
 * and its own error.
 *
 * THE TWO AMOUNT FORMATS, WHICH THE PAGE HAS TO KEEP STRAIGHT
 *
 * The service answers in two shapes and they are not interchangeable:
 *
 *   RAW BASE UNITS      `live.totalAssets`, `live.totalSupply` -- render with
 *                       `displayBaseUnits(value, decimals)`.
 *   DECIMAL STRINGS     `price.series[].price`, candle OHLC -- render with
 *                       `displayDecimal(value)`.
 *
 * Getting this backwards is not a cosmetic bug: the first version of this page ran both
 * through one formatter and printed `totalSupply` as the raw integer
 * `849,930,996,648,200,851,546`, which is item 2 on the list of things this interface must
 * never show. It looked plausible for `totalAssets` only because a 6-decimal asset makes
 * `934924100` read as an ordinary number. The two formatters now have different names so
 * that the choice is visible at every call site.
 */

// The page must reflect the chain and the index as they are at request time. Caching is
// opted out explicitly: Next caches `fetch` by default, and a cached console is a console
// showing figures that were true a moment ago while claiming to be current.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Panel({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        <span className="text-xs text-slate-500">{source}</span>
      </header>
      {children}
    </section>
  );
}

function Figure({ label, value, suffix, hint }: { label: string; value: string; suffix?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="figure text-lg text-slate-100">
        {value}
        {suffix ? <span className="ml-1 text-sm text-slate-400">{suffix}</span> : null}
      </dd>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * A failure, rendered as a sentence rather than a stack trace.
 *
 * THREE THINGS A FAILURE PANEL MUST NOT DO, each learned from this page's own output:
 *
 *   1. COLLAPSE DIFFERENT FAILURES INTO ONE MESSAGE. "not reachable" is a process that is
 *      not running; "refused" is a process that answered and said no. They have opposite
 *      fixes, so they are labelled differently -- and so are the chain's own classes, which
 *      is what `ChainError.kind` is for.
 *
 *   2. PRINT THE ERROR OBJECT. The first version rendered `error.message`, and for a chain
 *      failure viem puts the URL, the JSON-RPC request body, `Raw Call Arguments`, a docs
 *      link and a version number in there. A screenshot of the failure path showed a full
 *      screen of JSON where the specification promises two lines. The technical text is kept
 *      and shown, but behind a disclosure, because a reader needs the sentence and whoever
 *      debugs it needs the dump.
 *
 *   3. SAY "fetch failed" AND STOP. The sentence has to name the endpoint, since "the chain
 *      is unreachable" is unactionable when three services and two env vars are in play.
 */
function Failure({ title, error }: { title: string; error: unknown }) {
  const service = error instanceof ServiceError ? error : null;
  const chain = error instanceof ChainError ? error : null;
  const headline = error instanceof Error ? error.message : String(error);
  const detail = service?.detail ?? chain?.detail ?? null;
  const showDetail = detail !== null && detail !== headline;

  return (
    <div className="rounded-md border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-200">
      <p className="font-medium">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-amber-200/80">{headline}</p>
      {chain !== null ? (
        <p className="mt-2 text-xs text-amber-200/60">
          endpoint: <span className="figure">{chain.rpcUrl}</span> · class: {chain.kind}
        </p>
      ) : null}
      {showDetail ? (
        // Deliberately collapsed. It is here so a failure can be diagnosed without a
        // terminal, and out of the way so it cannot bury the sentence above.
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-amber-200/60">
            technical detail (the raw error, for debugging)
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/60 p-2 text-xs text-amber-200/50">
            {detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export default async function Page() {
  const deployment = loadDeployment();

  // Independent: neither await can prevent the other panel from rendering.
  const [liveResult, statusResult, candleResult, priceResult] = await Promise.allSettled([
    readDeployment(chainConfig(deployment)),
    indexApi.status(),
    indexApi.candles(60, 5000),
    indexApi.price(1),
  ]);

  const live = liveResult.status === 'fulfilled' ? liveResult.value : null;
  const status: Status | null = statusResult.status === 'fulfilled' ? statusResult.value : null;
  const candles: Candle[] = candleResult.status === 'fulfilled' ? candleResult.value.candles : [];

  /**
   * The share price comes from the SERVICE, not from arithmetic here.
   *
   * The first draft derived it in this file from `totalAssets` and `totalSupply`. That is a
   * second source of truth for the vault's most error-prone number, and the value would
   * have had to be formatted as a bigint rather than the decimal string the rest of the
   * page uses -- which is exactly how two representations of one quantity start to drift.
   * `src/api/price.ts` in the service owns that formula and tests it; the console reads
   * the result.
   *
   * When the service is unavailable there is no price to show, and the panel says so
   * rather than computing one that could disagree with the index it sits next to.
   */
  const price = priceResult.status === 'fulfilled' ? (priceResult.value.series.at(-1)?.price ?? null) : null;

  const assetDecimals = live?.assetDecimals ?? 6;
  const shareDecimals = live?.shareDecimals ?? 18;
  const symbol = live?.assetSymbol ?? 'asset';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-slate-100">Vault Console</h1>
        <p className="mt-1 text-sm text-slate-400">
          An ERC-4626 vault, read from two independent sources. Each panel says which one it came from, because
          they answer different questions and fail in different ways.
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <div className="flex gap-1.5">
            <dt>vault</dt>
            <dd className="figure text-slate-400" title={deployment.vault}>
              {deployment.vault}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>chain</dt>
            <dd className="figure text-slate-400">
              {deployment.chainName} ({deployment.chainId})
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>record</dt>
            <dd className="text-slate-400">{deployment.recordPath.split(/[\\/]/).slice(-3).join('/')}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6">

        {/* Current state: the chain */}
        <Panel title="Now" source="read from the chain, this request">
          {live === null ? (
            <Failure title="The chain could not be read." error={(liveResult as PromiseRejectedResult).reason} />
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Figure
                label="Total assets"
                value={displayBaseUnits(live.totalAssets, assetDecimals)}
                suffix={symbol}
                hint={`${assetDecimals} decimals`}
              />
              <Figure
                label="Total shares"
                value={displayBaseUnits(live.totalSupply, shareDecimals)}
                hint={`${shareDecimals} decimals`}
              />
              <Figure
                label="Price per share"
                value={price !== null ? displayDecimal(price) : '—'}
                suffix={price !== null ? symbol : undefined}
                hint={price === null ? 'the index service is unavailable' : 'from the index service'}
              />
            </dl>
          )}
        </Panel>

        {/* History: the index */}
        <Panel title="Then" source="read from the index service, which lags by design">
          {candleResult.status === 'rejected' ? (
            <Failure title="The index service could not be read." error={candleResult.reason} />
          ) : (
            <PriceChart candles={candles} assetSymbol={symbol} bucketSeconds={60} />
          )}

          {status !== null && (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-800 pt-4 text-sm sm:grid-cols-4">
              <Figure label="Indexed to block" value={String(status.lastIndexedBlock ?? '—')} />
              <Figure
                label="Lag"
                value={String(status.lagBlocks ?? '—')}
                suffix="blocks"
                hint={`indexer last ran ${duration(status.staleSeconds)} ago`}
              />
              <Figure label="Events" value={String(status.eventCount)} hint="deposits, withdrawals, yield" />
              <Figure label="Snapshots" value={String(status.snapshotCount)} hint="one per indexed block" />
            </dl>
          )}

          {status !== null && status.coverage.startsLaterThanDeployment && (
            // Printed verbatim. This is the service's own statement that part of the vault's
            // life is not in the data, and paraphrasing it would soften a real gap.
            <p className="mt-4 rounded-md border border-slate-700/60 bg-slate-800/30 p-3 text-xs text-slate-400">
              {status.coverage.note}
            </p>
          )}
        </Panel>

        {/* The comparison this page exists for */}
        <Panel title="Two sources, checked against each other" source="the reason both are on this page">
          {live !== null && status !== null ? (
            <div className="space-y-2 text-sm">
              <p className="text-slate-300">
                The chain says the vault holds{' '}
                <span className="figure text-slate-100">
                  {displayBaseUnits(live.totalAssets, assetDecimals)} {symbol}
                </span>
                . The index has a record for every block up to{' '}
                <span className="figure text-slate-100">{status.lastIndexedBlock ?? '—'}</span>, currently{' '}
                <span className="figure text-slate-100">{status.lagBlocks ?? '—'}</span> blocks behind the head it
                last saw.
              </p>
              <p className="text-xs text-slate-500">
                A figure from the chain is exact and current. A figure from the index is exact for the block it
                names and no later. Neither is wrong; using one while saying the other is what would be wrong.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              A comparison needs both sources. One of them is unavailable, so this panel does not guess.
            </p>
          )}
        </Panel>

        {/* The index's own health */}
        {status !== null && (
          <Panel title="Index health" source="the index service's own report">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Figure label="Healthy" value={status.healthy ? 'yes' : 'no'} />
              <Figure label="Series from block" value={String(status.seriesFromBlock ?? '—')} />
              <Figure label="Events from block" value={String(status.eventsFromBlock ?? '—')} />
              <Figure
                label="Updated"
                value={status.updatedAt ? timeLabel(Math.floor(Date.parse(status.updatedAt) / 1000)) : '—'}
                hint={duration(status.staleSeconds) + ' ago'}
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500">{status.note}</p>
          </Panel>
        )}

        <footer className="border-t border-slate-800 pt-4 text-xs text-slate-500">
          Read-only. Nothing on this page writes to the chain, and no wallet is required or requested.
          {' '}
          Amounts are rendered from the exact strings the services return. Raw base units go through BigInt and the
          asset&apos;s own decimals; nothing is routed through a JavaScript number, which would silently round a
          uint256.
        </footer>
      </div>
    </main>
  );
}
