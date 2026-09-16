import { ChainError } from '@/lib/chain';
import { ServiceError } from '@/lib/api';

/**
 * The three presentational primitives every page in this app is built from.
 *
 * WHY THEY MOVED OUT OF THE PAGE
 *
 * They started inside `src/app/vault/page.tsx`, which was the whole app. Adding a second and
 * third page made them the obvious thing to copy, and a copied `Panel` is a panel that can
 * drift -- most importantly about the `source` label, which is not decoration: this app's
 * central claim is that **every figure says which of the two independent sources it came
 * from**, and a reader has to be able to check that claim panel by panel. Enforcing it by
 * convention, page by page, is how a claim like that quietly stops being true. Here the
 * `source` prop is required, so a page cannot render a panel without stating one.
 *
 * `Failure` moved for the same reason and with more at stake. Its three rules are below and
 * they were each learned from this app's own output; a second copy would be a second chance
 * to get them wrong, on the page least likely to be re-read.
 */

/**
 * A bordered section with a heading and the source it came from.
 *
 * `source` is required and not optional. See the note above: it is the claim, not a subtitle.
 */
export function Panel({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
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

/** A labelled figure with an optional unit and an optional line of context. */
export function Figure({ label, value, suffix, hint }: { label: string; value: string; suffix?: string; hint?: string }) {
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
 * THREE THINGS A FAILURE PANEL MUST NOT DO, each learned from this app's own output:
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
export function Failure({ title, error }: { title: string; error: unknown }) {
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
