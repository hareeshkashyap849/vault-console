import { apiUrl } from './endpoints.ts';
import type { CandleResponse, EventResponse, PriceResponse, Status, SummaryResponse } from './types.ts';

/**
 * The index service, as a typed client.
 *
 * EVERY CALL TURNS A FAILURE INTO A SENTENCE.
 *
 * The service answers with a JSON `error` field for its own refusals, and with nothing at
 * all when it is not running. Both have to become something a reader can act on -- "fetch
 * failed" tells you nothing about which of the two happened, and those two have different
 * fixes. So the distinction is preserved rather than collapsed:
 *
 *   reachable + refused  -> the service's own message, verbatim
 *   not reachable        -> said so, with the hint that it is a separate process
 *
 * A THIRD CASE THAT MUST NOT BE COLLAPSED INTO THE SECOND
 *
 * A request that could not even be CONSTRUCTED is not a request that failed to arrive.
 * `fetch('/api/status')` in Node throws `TypeError: Failed to parse URL`, because a
 * relative URL has no origin to resolve against on the server. Reporting that as "the
 * service is not reachable" sends the reader to restart a service that was running the
 * whole time. So a URL parse failure is named as one.
 *
 * Nothing here retries. A retry loop around a service that is simply down turns a clear
 * error into a slow one.
 */
export class ServiceError extends Error {
  readonly status: number | null;
  readonly detail: string | null;
  /** Which of the three failure kinds this is. The page renders them differently. */
  readonly kind: 'unreachable' | 'refused' | 'bad-request-url';

  constructor(
    message: string,
    status: number | null,
    detail: string | null = null,
    kind: 'unreachable' | 'refused' | 'bad-request-url' = status === null ? 'unreachable' : 'refused',
  ) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.detail = detail;
    this.kind = kind;
  }

  /** Whether a retry could plausibly succeed. A 400 will not get better on its own. */
  get retryable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

/**
 * Turn a service-relative path into an absolute URL.
 *
 * On the SERVER this is the whole point: `http://127.0.0.1:8787/api/status`. In the
 * BROWSER a relative path is already correct and must be left alone, so it stays relative
 * and the rewrite in `next.config.ts` forwards it same-origin. See `endpoints.ts`.
 */
function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return typeof window === 'undefined' ? apiUrl(path) : path;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = resolveUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    // NAMED SEPARATELY. A malformed URL is a bug in this repository, not a service that is
    // down, and the two have opposite fixes. Letting this fall through to "not reachable"
    // is exactly the misdiagnosis this comment exists to prevent.
    if (/Failed to parse URL|Invalid URL/i.test(message)) {
      throw new ServiceError(
        `The console built an invalid URL for the index service: ${url}. This is a bug in the ` +
          'console, not a problem with the service -- relative paths only resolve in a browser.',
        null,
        message,
        'bad-request-url',
      );
    }

    // A transport failure. The service is a separate process and this is what it looks
    // like when it is not running -- worth saying outright, because a reader who does not
    // know that will assume the console is broken.
    throw new ServiceError(
      `The index service is not reachable at ${url}. It runs as a separate process; start it with ` +
        '`node --experimental-strip-types src/api/cli.ts` in the erc4626-vault-dapp repository.',
      null,
      message,
      'unreachable',
    );
  }

  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.json()) as { error?: string; hint?: string };
      detail = [body.error, body.hint].filter(Boolean).join(' — ') || null;
    } catch {
      // A non-JSON error body is itself information: the proxy answered, not the service.
      detail = `HTTP ${res.status} ${res.statusText}`.trim();
    }
    throw new ServiceError(detail ?? `the index service answered ${res.status}`, res.status, detail, 'refused');
  }

  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new ServiceError(
      'The index service answered, but not with JSON. That is usually a proxy answering ' +
        'instead of the service.',
      res.status,
      cause instanceof Error ? cause.message : String(cause),
      'refused',
    );
  }
}

/** Cache policy in one place, because a missed `no-store` is invisible until it is wrong. */
const LIVE: RequestInit = { cache: 'no-store' };

export const indexApi = {
  status: () => getJson<Status>('/api/status', LIVE),
  price: (limit = 500) => getJson<PriceResponse>(`/api/price?limit=${limit}`, LIVE),
  candles: (bucketSeconds: number, limit = 5000) =>
    getJson<CandleResponse>(`/api/candles?bucket=${bucketSeconds}&limit=${limit}`, LIVE),
  events: (opts: { limit?: number; kind?: string } = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.kind) q.set('kind', opts.kind);
    return getJson<EventResponse>(`/api/events?${q.toString()}`, LIVE);
  },
  summary: () => getJson<SummaryResponse>('/api/summary', LIVE),
};
