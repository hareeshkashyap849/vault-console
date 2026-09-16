/**
 * Cross-check: the SAME assertions as `test/api.test.ts`, against the REAL service.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `test/api.test.ts` replaces `fetch` with a function I wrote. That replacement is a test
 * double, and `TEST-DOUBLES.md` requires every double to have a cross-check: the same input fed
 * to both the double and the real object, asserting the same conclusion.
 *
 * For a URL-construction client that cross-check is available in its strongest form. The
 * double proves "the client builds this URL and reads this field". This file proves the same
 * client, unchanged, gets a real answer from the real service at that URL -- so the URL was
 * not merely well-formed, it was CORRECT. A stub cannot tell you that: it answers whatever it
 * was told to answer, including for a URL no server would recognise.
 *
 * WHAT IT COMPARES
 *
 *   the double says   ->  this file checks
 *   -----------------     ------------------------------------------------------------
 *   `/api/status`         the real service answers 200 with the declared field names
 *   `/api/price?limit=1`  the same
 *   `/api/candles?...`    the same, and `bucket`/`limit` are accepted (not rejected as
 *                         malformed) -- which is the part a stub cannot verify at all
 *   `/api/summary`        the same
 *   `cache: 'no-store'`   NOT verifiable here: the header is transport-level and this file
 *                         cannot observe what the client sent. Recorded as a residual gap.
 *
 * Run it with the index service up:
 *
 *   node --experimental-strip-types test/api-against-real-service.test.ts
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ServiceError, indexApi } from '../src/lib/api.ts';
import { apiBase } from '../src/lib/endpoints.ts';

const reachable = await fetch(`${apiBase()}/api/status`, { signal: AbortSignal.timeout(3000) })
  .then((r) => r.ok)
  .catch(() => false);

if (!reachable) {
  console.log(
    `\n  SKIPPED: no index service at ${apiBase()}.\n` +
      '  This file cross-checks the `fetch` double in test/api.test.ts against the real\n' +
      '  service, so it needs the real service. Skipping verifies nothing.\n',
  );
}

describe('the real client against the real service', { skip: reachable ? false : 'no service' }, () => {
  it('indexApi.status() resolves and returns the declared shape', async () => {
    // THE POINT: the same call the stubbed test makes, with the same code path, getting a
    // real answer. If the URL were subtly wrong the stub would still have passed.
    const status = await indexApi.status();
    assert.equal(typeof status.healthy, 'boolean');
    assert.equal(typeof status.chainId, 'number');
    assert.match(status.vault, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(status.coverage && typeof status.coverage.note === 'string');
  });

  it('indexApi.price(1) resolves -- so `?limit=1` is a request the service accepts', async () => {
    const price = await indexApi.price(1);
    assert.ok(Array.isArray(price.series));
    assert.equal(price.series.length, 1, 'limit=1 must actually limit');
    assert.equal(price.limit, 1);
    assert.equal(price.maxLimit, 5000);
  });

  it('indexApi.candles(60, 5000) resolves -- so `?bucket=60&limit=5000` is accepted', async () => {
    // A stub cannot verify this AT ALL: the parameter names, the units of `limit` (blocks
    // pulled, not candles returned), and the service's own clamp are all server-side facts.
    const candles = await indexApi.candles(60, 5000);
    assert.ok(Array.isArray(candles.candles));
    assert.equal(candles.bucketSeconds, 60);
    assert.equal(candles.limit, 5000);
    // The live vault buckets 5000 blocks into a six-figure number of candles only if the
    // chain is dense; here it is 169. The invariant that matters is that `count` is the
    // number of candles actually returned, whatever that number is.
    assert.equal(candles.candles.length, candles.count);
  });

  it('indexApi.events() resolves and the query string is accepted', async () => {
    const events = await indexApi.events({ limit: 5, kind: 'Deposit' });
    assert.ok(Array.isArray(events.events));
    assert.ok(events.events.length <= 5);
  });

  it('indexApi.summary() resolves -- the endpoint whose TYPE was fiction for a while', async () => {
    // `SummaryResponse` declared `counts`/`totals`; the service sends `kinds`/`totalEvents`.
    // Nothing called this method, so the wrong type never produced a runtime error. This
    // assertion is the call that would have caught it.
    const summary = await indexApi.summary();
    assert.ok(summary.kinds && typeof summary.kinds === 'object');
    assert.equal(typeof summary.totalEvents, 'number');
    assert.deepEqual(summary.unknownKinds, []);
  });

  it('an over-cap `limit` is CLAMPED and the clamp is DISCLOSED, not an error', async () => {
    // The service's contract, read off the running service because a stub cannot reveal it:
    // `?limit=99999` is CLAMPED to the cap and answered 200, not refused. `src/api/server.ts`
    // says why -- "`?limit=100000` is a request this API cannot serve in full, but it is not
    // an error -- as long as the answer says so, which `limit` and `maxLimit` in the response
    // do." The trio `limit` / `maxLimit` / `count` is how a client detects that it was capped.
    const capped = await indexApi.candles(60, 99999);
    assert.equal(capped.limit, 5000, 'the response must report the limit actually applied');
    assert.equal(capped.maxLimit, 5000, 'the response must disclose the cap so a client can compare');
    assert.ok(capped.count <= capped.limit, 'count can never exceed the applied limit');

    // THE ASSERTION THAT MATTERS FOR THIS CONSOLE: a caller can TELL it was capped. Without
    // this, a client bug that asked for too much would look like success and the console
    // would plot a truncated window as if it were the whole thing.
    //
    // The test is the pair: ask for the cap and ask for double the cap. If the service
    // answered both the same way without disclosure, these two would be indistinguishable.
    const atCap = await indexApi.candles(60, 5000);
    assert.equal(atCap.limit, capped.limit, 'the applied limit is the same either way');
    assert.notEqual(
      99999,
      capped.limit,
      'the requested 99999 is NOT echoed back as the applied limit -- that is the disclosure',
    );
  });

  it('`limit=0` is accepted and returns nothing, which is a different thing from an error', async () => {
    const zero = await indexApi.candles(60, 0);
    assert.equal(zero.limit, 0);
    assert.deepEqual(zero.candles, []);
    assert.equal(zero.count, 0);
  });

  it('a NON-NUMERIC parameter IS refused, and classified as refused', async () => {
    // The other half of the contract: `intParam` rejects a value it cannot parse rather than
    // treating it as zero. This is the reachable real refusal, so it is what the console's
    // `refused` branch is cross-checked against.
    const err = await indexApi
      .candles(Number('abc'), 10)
      .then(
        () => null,
        (e: unknown) => e,
      );
    // `Number('abc')` is NaN and serialises to `bucket=NaN`, which the service refuses.
    assert.ok(err instanceof ServiceError, `expected a ServiceError, got ${String(err)}`);
    assert.equal(err.kind, 'refused', 'a served error must never be classified as unreachable');
    assert.ok(typeof err.status === 'number' && err.status >= 400 && err.status < 500, `status was ${String(err.status)}`);
    assert.ok(err.message.length > 0, 'the service must supply its own explanation, surfaced verbatim');
    assert.equal(err.retryable, false, 'a 4xx will not get better on its own');
  });
});

describe('what this cross-check still cannot show', () => {
  it('records the residual gaps rather than implying full coverage', () => {
    // Written as a test so it appears in the output rather than only in a document.
    const gaps = [
      "the client's `cache: 'no-store'` header is NOT observable from here",
      'transport failures (timeout, TLS, DNS) are NOT exercised -- only a 400 was',
      'the double supports string | URL | Request inputs, but only string is exercised',
      'Node version changes can alter TypeError wording, which the client string-matches',
    ];
    assert.equal(gaps.length, 4);
    console.log(`\n  Residual gaps in the fetch double's cross-check:\n    - ${gaps.join('\n    - ')}\n`);
  });
});
