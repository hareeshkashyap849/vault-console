/**
 * The runtime config loader, and the `indexSnapshot` field it gained.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `loadRuntimeConfig` had no test. It was not an oversight in the sense of being unnoticed: the
 * function is reached by every page before anything renders, so it was "obviously covered" -- by
 * the browser assertions in `tools/browser-assert.mjs`, which need a real browser, a real chain
 * and a real export, and which nobody runs in this sandbox. Between them there was nothing that
 * ran on a plain `npm test`.
 *
 * That gap matters more now, because this module's validation is where the SNAPSHOT is described
 * to the rest of the application. `indexSnapshot` decides whether two pages tell the reader their
 * figures are live or frozen, and the failure mode of getting it wrong is not a crash: it is a
 * page that says "read from the index service" over numbers that stopped moving at build time.
 * That is the exact bug this console exists to avoid, so the field is validated here rather than
 * defaulted.
 *
 * THE LOADER IS CALLED THE WAY THE PAGE CALLS IT -- `fetch` is replaced, and the replacement
 * returns a real `Response`. See `TEST-DOUBLES.md`: the double's job is to produce the outcomes
 * (200 with a body, a thrown TypeError, a non-JSON body) precisely, which a real server cannot be
 * asked to do on demand.
 */
import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { indexApiUrlFor, loadRuntimeConfig, runtimeConfigPath } from '../src/lib/runtimeConfig.ts';
import type { RuntimeConfig } from '../src/lib/runtimeConfig.ts';

/** A config exactly as `scripts/build-runtime-config.mjs` writes one, for the dev server. */
const VALID: RuntimeConfig = {
  chainId: 84532,
  chainName: 'Base Sepolia',
  vault: '0x7941438ee07bea4469ccd4bec583e9fb24037f35',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  owner: '0x2ae746c0ff0295c2da1ac338656f247e9758e034',
  deployBlock: 46919124,
  note: 'Testnet only: no real funds, not audited.',
  recordPath: 'deployments/base-sepolia.json',
  rpcUrl: 'https://sepolia.base.org',
  walletRpcUrl: 'https://sepolia.base.org',
  indexApiUrl: '/',
  indexSnapshot: false,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the config path with `body`, and record the URL that was asked for. */
function serveConfig(body: unknown, { status = 200, raw }: { status?: number; raw?: string } = {}): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (raw !== undefined) return new Response(raw, { status, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { urls };
}

describe('runtimeConfigPath', () => {
  it('is `api/config` under the build\'s base path', () => {
    // No `NEXT_PUBLIC_BASE_PATH` is set when this test runs, so the prefix is empty. The prefix
    // itself is Next's `basePath`, inlined at build time (see `next.config.ts`); what this pins
    // is that the path is relative to the page rather than to the domain root.
    assert.equal(runtimeConfigPath(), '/api/config');
  });
});

describe('loadRuntimeConfig accepts a generated config', () => {
  it('returns the config the generator wrote, field for field', async () => {
    const { urls } = serveConfig(VALID);
    const config = await loadRuntimeConfig();
    assert.deepEqual(config, VALID);
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /\/api\/config$/);
  });

  it('accepts a snapshot config -- indexSnapshot true with a path to the captured files', async () => {
    // The published shape: `--index / --snapshot`. The files are served at `/api/status` and
    // friends under the base path, so the URL is a path and the flag says what is behind it.
    serveConfig({ ...VALID, indexSnapshot: true });
    const config = await loadRuntimeConfig();
    assert.equal(config.indexSnapshot, true);
  });
});

describe('loadRuntimeConfig refuses a config it cannot act on', () => {
  it('refuses an indexSnapshot that is not a boolean, rather than defaulting it', async () => {
    // THE DEFECT THIS PREVENTS: `if (config.indexSnapshot)` on a MISSING field is falsy, so a
    // config written before this field existed (or one whose generator was not re-run) would be
    // read as "the figures are live" -- an understatement of the page's own age, and the one
    // direction of this flag that is dangerous. A default is a guess; this refuses instead.
    for (const value of [undefined, null, 'true', 1, 0]) {
      const body: Record<string, unknown> = { ...VALID };
      if (value === undefined) delete body.indexSnapshot;
      else body.indexSnapshot = value;
      serveConfig(body);
      await assert.rejects(
        () => loadRuntimeConfig(),
        (error: Error) => /indexSnapshot is not a boolean/.test(error.message),
        `indexSnapshot=${JSON.stringify(value)} was accepted`,
      );
    }
  });

  it('names every problem at once, so one build log is one fix', async () => {
    serveConfig({ ...VALID, vault: 'not-an-address', chainId: 'base', rpcUrl: 'sepolia.base.org', indexSnapshot: 'yes' });
    await assert.rejects(
      () => loadRuntimeConfig(),
      (error: Error) => {
        for (const field of ['vault', 'chainId', 'rpcUrl', 'indexSnapshot']) {
          assert.match(error.message, new RegExp(field), `${field} was not named in the report`);
        }
        return true;
      },
    );
  });

  it('refuses a config that claims a snapshot with nothing to have read it from', async () => {
    // `indexApiUrl: null` means the client makes NO request at all -- the `no-route` case. Saying
    // "read from a snapshot" there would describe figures the page cannot have. Both halves of
    // that pair are refused by the generator too (`--index null --snapshot`); this is the client
    // half, for a config that reached the browser some other way.
    serveConfig({ ...VALID, indexApiUrl: null, indexSnapshot: true });
    await assert.rejects(
      () => loadRuntimeConfig(),
      (error: Error) => /indexSnapshot is true but indexApiUrl is null/.test(error.message),
    );
  });

  it('still ACCEPTS indexApiUrl: null with indexSnapshot false -- the no-route config stays valid', async () => {
    // The regression guard on the rule above: `--index null` alone must keep working, because it
    // is what the console published before the snapshot existed and what a page without a route
    // must still be able to say.
    serveConfig({ ...VALID, indexApiUrl: null, indexSnapshot: false });
    const config = await loadRuntimeConfig();
    assert.equal(config.indexApiUrl, null);
    assert.equal(config.indexSnapshot, false);
  });

  it('reports a non-200 as a config that was not generated, not as a page failure', async () => {
    serveConfig({}, { status: 404 });
    await assert.rejects(
      () => loadRuntimeConfig(),
      (error: Error) => /answered 404/.test(error.message) && /build-runtime-config\.mjs/.test(error.message),
    );
  });

  it('reports a body that is not JSON, naming the path and the generator', async () => {
    // Found by this test, not written for it: the loader used to let `response.json()` throw
    // undici's own `SyntaxError: Unexpected token '<' ...`, which names neither the file nor the
    // fact that this is a generated artefact. The realistic cause is a static host answering a
    // missing `/api/config` with its 404 HTML page, and the reader has to be told that the
    // config was never generated -- not that their JSON is broken.
    serveConfig(undefined, { raw: '<!doctype html>' });
    await assert.rejects(
      () => loadRuntimeConfig(),
      (error: Error) =>
        /\/api\/config/.test(error.message) &&
        /not with JSON/.test(error.message) &&
        /build-runtime-config\.mjs/.test(error.message),
    );
  });
});

describe('indexApiUrlFor', () => {
  it('joins a same-origin base to a service path without doubling the slash', () => {
    assert.equal(indexApiUrlFor({ ...VALID, indexApiUrl: '/' }, '/api/status'), '/api/status');
    assert.equal(indexApiUrlFor({ ...VALID, indexApiUrl: '/api' }, '/api/status'), '/api/api/status');
  });

  it('keeps an absolute base absolute', () => {
    assert.equal(
      indexApiUrlFor({ ...VALID, indexApiUrl: 'https://index.example:9443/' }, '/api/status'),
      'https://index.example:9443/api/status',
    );
  });

  it('returns null -- never a request against this page -- when there is no service', () => {
    // The one place "there is no service" could turn into a request against the static host,
    // which would answer 404 and be reported as a broken service.
    assert.equal(indexApiUrlFor({ ...VALID, indexApiUrl: null }, '/api/status'), null);
  });

  it('does not care whether the snapshot flag is set, because it is about the URL only', () => {
    assert.equal(
      indexApiUrlFor({ ...VALID, indexApiUrl: '/', indexSnapshot: true }, '/api/status'),
      indexApiUrlFor({ ...VALID, indexApiUrl: '/', indexSnapshot: false }, '/api/status'),
    );
  });
});
