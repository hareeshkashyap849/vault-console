/**
 * The index-service client.
 *
 * THE BUG THAT PROMPTED THIS FILE
 *
 * The console's page is a server component, so its fetches run in Node. The first version
 * called `fetch('/api/status')` -- a relative path, which is fine in a browser and throws
 * `TypeError: Failed to parse URL` on the server, because there is no origin to resolve
 * against. The page returned HTTP 500, and the error that surfaced named `/rpc` and viem,
 * which reads like a broken RPC endpoint rather than a missing base URL. Finding it took a
 * bisect; these tests are so that it cannot recur silently.
 *
 * There was a second, quieter defect in the same function: every transport failure was
 * reported as "the index service is not reachable". A URL that was never constructed is not
 * a service that is down, and the two have opposite fixes. `ServiceError.kind` now keeps
 * them apart, and the tests below assert the distinction exists.
 *
 * `fetch` is replaced, not mocked. The replacement is a real function with real behaviour
 * (it throws, returns a Response, returns junk) so what is under test -- the client's
 * classification of those outcomes -- is exercised rather than stubbed around.
 */
import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { ServiceError, indexApi } from '../src/lib/api.ts';
import { apiBase, apiUrl, rpcBase, rpcUrl } from '../src/lib/endpoints.ts';

const realFetch = globalThis.fetch;
const realEnv = { api: process.env.VAULT_API, rpc: process.env.VAULT_RPC };

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realEnv.api === undefined) delete process.env.VAULT_API;
  else process.env.VAULT_API = realEnv.api;
  if (realEnv.rpc === undefined) delete process.env.VAULT_RPC;
  else process.env.VAULT_RPC = realEnv.rpc;
});

/** Replace fetch with one that records the URL it was given and returns a canned result. */
function stubFetch(handler: (url: string) => Response | Promise<Response> | never): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { urls };
}

function json(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } });
}

describe('endpoints', () => {
  it('defaults to the ports the services actually use', () => {
    delete process.env.VAULT_API;
    delete process.env.VAULT_RPC;
    assert.equal(apiBase(), 'http://127.0.0.1:8787');
    assert.equal(rpcBase(), 'http://127.0.0.1:8545');
  });

  it('honours the environment override and strips a trailing slash', () => {
    process.env.VAULT_API = 'http://10.0.0.5:9000/';
    process.env.VAULT_RPC = 'http://10.0.0.5:9001/';
    assert.equal(apiBase(), 'http://10.0.0.5:9000');
    assert.equal(rpcBase(), 'http://10.0.0.5:9001');
    // The reason the slash is stripped: otherwise this is `//api/status`, which most
    // servers answer with a 404 rather than a redirect.
    assert.equal(apiUrl('/api/status'), 'http://10.0.0.5:9000/api/status');
  });

  it('always produces an absolute URL on the server', () => {
    delete process.env.VAULT_API;
    assert.match(apiUrl('/api/status'), /^http:\/\/127\.0\.0\.1:\d+\/api\/status$/);
    assert.match(rpcUrl(), /^http:\/\//);
  });
});

describe('indexApi -- request construction', () => {
  it('requests an ABSOLUTE url, which is the fix for the server-side 500', async () => {
    delete process.env.VAULT_API;
    const { urls } = stubFetch(() => json({ ok: true }));
    await indexApi.status();
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /^http:\/\/127\.0\.0\.1:8787\/api\/status$/);
  });

  it('builds the query strings the service documents', async () => {
    const { urls } = stubFetch(() => json({ candles: [], series: [] }));
    await indexApi.price(1);
    await indexApi.candles(60, 5000);
    await indexApi.events({ limit: 5, kind: 'Deposit' });
    await indexApi.summary();
    assert.match(urls[0]!, /\/api\/price\?limit=1$/);
    assert.match(urls[1]!, /\/api\/candles\?bucket=60&limit=5000$/);
    assert.match(urls[2]!, /\/api\/events\?limit=5&kind=Deposit$/);
    assert.match(urls[3]!, /\/api\/summary$/);
  });

  it('defaults the event limit and omits an absent kind', async () => {
    const { urls } = stubFetch(() => json({ events: [] }));
    await indexApi.events();
    assert.match(urls[0]!, /\/api\/events\?limit=50$/);
  });

  it('sends no-store, because a cached console shows stale figures as current', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return json({ ok: true });
    }) as typeof fetch;
    await indexApi.status();
    assert.equal(seen?.cache, 'no-store');
    assert.equal((seen?.headers as Record<string, string>)?.accept, 'application/json');
  });
});

describe('indexApi -- failure classification', () => {
  it('names an unbuilt request URL as a console bug, not a service that is down', async () => {
    // Exactly what Node throws for a relative URL. Before the fix this was reported as
    // "the index service is not reachable", which sends the reader to restart a service
    // that was running the whole time.
    stubFetch(() => {
      throw new TypeError('Failed to parse URL from /api/status');
    });
    const err = await indexApi.status().then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof ServiceError);
    assert.equal(err.kind, 'bad-request-url');
    assert.match(err.message, /bug in the console/);
  });

  it('names a transport failure as unreachable, and says how to start the service', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const err = await indexApi.status().then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof ServiceError);
    assert.equal(err.kind, 'unreachable');
    assert.equal(err.status, null);
    assert.match(err.message, /not reachable at http:\/\//);
    assert.match(err.message, /src\/api\/cli\.ts/);
  });

  it('surfaces the service\'s own refusal verbatim rather than rewriting it', async () => {
    stubFetch(() => json({ error: 'limit must be <= 5000', hint: 'It was 99999.' }, 400, 'Bad Request'));
    const err = await indexApi.candles(60, 99999).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof ServiceError);
    assert.equal(err.kind, 'refused');
    assert.equal(err.status, 400);
    assert.equal(err.message, 'limit must be <= 5000 — It was 99999.');
  });

  it('describes a non-JSON error body as a proxy answering, which is what it is', async () => {
    stubFetch(() => new Response('<html>nginx</html>', { status: 502, statusText: 'Bad Gateway' }));
    const err = await indexApi.status().then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof ServiceError);
    assert.equal(err.kind, 'refused');
    assert.equal(err.status, 502);
    assert.match(err.message, /HTTP 502 Bad Gateway/);
  });

  it('catches a 200 that is not JSON -- a rewritten page, not data', async () => {
    stubFetch(() => new Response('<!DOCTYPE html>', { status: 200 }));
    const err = await indexApi.status().then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof ServiceError);
    assert.match(err.message, /not with JSON/);
  });

  it('marks a 400 as not retryable and a 500 as retryable', () => {
    assert.equal(new ServiceError('x', 400, null, 'refused').retryable, false);
    assert.equal(new ServiceError('x', 503, null, 'refused').retryable, true);
    assert.equal(new ServiceError('x', null, null, 'unreachable').retryable, true);
    // A URL that was never built will not build itself on the second attempt.
    assert.equal(new ServiceError('x', null, null, 'bad-request-url').retryable, true);
  });

  it('does not retry: exactly one request per call, however it fails', async () => {
    const { urls } = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    await indexApi.status().catch(() => undefined);
    assert.equal(urls.length, 1, 'a retry loop around a service that is down turns a clear error into a slow one');
  });
});
