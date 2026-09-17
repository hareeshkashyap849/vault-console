/**
 * The snapshot capture, and the refusals that are the whole point of it.
 *
 * WHY THE REFUSAL PATH IS THE TEST
 *
 * `scripts/capture-index-snapshot.mjs` fetches five bodies and writes them to `public/api`,
 * where a static host serves them at the paths the console requests. A capture that SUCCEEDS
 * is a file copy -- there is nothing to get right. The thing that can be got wrong is the
 * FAILURE: if a malformed or partial body is written anyway, the published page renders it.
 *
 * That failure is quiet by construction. The panels read specific fields, so a missing one
 * does not throw, does not log, and does not show an error box:
 *
 *   status.updatedAt missing   -> `` shows `Updated —`, which reads like an empty index
 *   status.lagBlocks missing   -> `String(undefined)` is the word "undefined" on the page
 *   summary.kinds missing      -> the tally panel renders nothing at all (it is guarded on
 *                                 `tally !== null`), so the page looks like an index with no
 *                                 events rather than like a broken snapshot
 *   price.decimals missing     -> `decimalsFrom()` returns null, and every amount on
 *                                 `/history` renders as raw base units
 *   events.filter missing      -> invisible today, and the envelope `EventResponse` was
 *                                 originally written WITHOUT it (`src/lib/types.ts`)
 *   candles[].open missing     -> the chart's scale is built from the four OHLC values, so the
 *                                 panel either draws nothing or draws the wrong picture, and
 *                                 the `Then` panel's own label says the figures are a snapshot
 *                                 either way
 *
 * None of those is an error a reader can see, and all of them are wrong data being presented
 * as right. So the tests below are built to make each one FAIL THE BUILD instead, and each
 * case names the page-level consequence it is preventing.
 *
 * THE `candles` CASES ARE THE FIFTH ENDPOINT'S, AND THEY CARRY ONE EXTRA JOB
 *
 * `/api/candles` was missing from the capture for a while, and the way that showed up was not a
 * failed build: the served export answered 404 for the path `/vault` asks for, so the `Then`
 * panel printed "The index service could not be read." beside a fully populated `Index health`
 * panel (`docs/INDEX-SNAPSHOT-PLAN.md`). The cases below are what stops the fifth entry from
 * being the one that is present but not verified -- including the one that says a candle the
 * SERVICE really produces (a thousands-grouped `"1,234.5"`) is accepted, so the checker cannot
 * become stricter than reality and refuse a good snapshot.
 *
 * THE REAL SERVICE'S BYTES ARE THE ACCEPTANCE CASE
 *
 * `test/fixtures/*.json` are the running service's own responses, captured verbatim by
 * `tools/capture-fixtures.mjs` (see `TEST-DOUBLES.md`: a recorded original, not a
 * hand-written sample). The capture script must accept them -- otherwise the checker is
 * stricter than reality and the build would refuse to publish a perfectly good snapshot. That
 * is the half of this file that stops the refusals from being paranoid.
 *
 * The MISSING cases go through a real HTTP server rather than a stubbed `fetch`, because the
 * script's fetch is not what is under test: what is under test is that a bad BODY stops the
 * run. A stub would test the stub.
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { after, describe, it } from 'node:test';
import { join, resolve } from 'node:path';

import {
  ENDPOINTS,
  SNAPSHOT_NOTE,
  captureAll,
  captureOne,
  checkBody,
  withSnapshotNote,
  type Endpoint,
} from '../scripts/capture-index-snapshot.mjs';

const REPO = resolve(import.meta.dirname, '..');
const FIXTURES = join(REPO, 'test', 'fixtures');

/**
 * The fixture this repository already keeps, one per captured endpoint.
 *
 * `Record<string, unknown>` rather than a per-endpoint interface on purpose: these tests MUTATE
 * the bodies (delete a field, replace a series) to prove the checker refuses them, and a precise
 * type would forbid every one of those mutations at compile time -- the mutations ARE the test.
 */
function fixture(name: Endpoint['name']): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, unknown>;
}

describe('checkBody accepts the bodies the running service actually produces', () => {
  it('accepts all five committed fixtures -- the service output, not a sample', () => {
    for (const endpoint of ENDPOINTS) {
      const found = checkBody(endpoint.name, fixture(endpoint.name));
      assert.deepEqual(found, [], `${endpoint.name} fixture was refused:\n  - ${found.join('\n  - ')}`);
    }
  });

  it('accepts the one candle shape this checker must not be stricter than: the service groups thousands', () => {
    // `formatCandles()` runs every OHLC value through `groupThousands()` (`erc4626-vault-dapp`'s
    // `src/api/chart.ts`), so `"1,234.5"` is a value the service really emits, and the committed
    // fixture does not contain one because this vault's price is `1.1` throughout. A validator that
    // demanded a bare decimal here would refuse a perfectly good snapshot the first time the price
    // passed 1000 -- on the NEXT capture, which is the worst moment to find out.
    const body = structuredClone(fixture('candles'));
    const candles = body.candles as Array<Record<string, unknown>>;
    assert.ok(candles[0], 'the fixture must have at least one candle');
    candles[0].open = '1,234.5';
    candles[0].high = '12,345.6789';
    candles[0].low = '0.5';
    candles[0].close = '10,000.000001';
    assert.deepEqual(checkBody('candles', body), []);

    // ...and it is a SHAPE rule, not "anything goes": a misplaced separator is still refused.
    candles[0].open = '1,23.5';
    assert.match(checkBody('candles', body).join('\n'), /candles\.candles\[0\]\.open is not a decimal string/);
  });

  it('accepts an empty index -- no series, no events, empty tally', () => {
    // A vault that has been deployed and not yet touched is a REAL state, and the snapshot
    // must be publishable for it. The `null`s here are the service's own way of saying "no
    // such row yet", and they are not the same as an absent field.
    const empty = {
      ...fixture('price'),
      series: [],
      count: 0,
      seriesFromBlock: null,
      coverage: {
        vaultStartBlock: 46919124,
        seriesFromBlock: null,
        eventsFromBlock: null,
        coverageBeginsAt: 46919124,
        startsLaterThanDeployment: false,
        note: 'There are no snapshots at all, so the series is empty. This is not a vault with no activity; it is a vault this service has not read yet.',
      },
    };
    assert.deepEqual(checkBody('price', empty), []);
    assert.deepEqual(checkBody('events', { ...fixture('events'), events: [], count: 0 }), []);

    // ...and the same state as `/api/candles` reports it: a service that has read a series in which
    // every point had a null price buckets to NO candles and says so (`skipped === pulled`). That is
    // the body that makes `/vault`'s chart render "No price history in this window.", which is an
    // honest panel for an empty vault rather than a broken one -- so it must be capturable.
    assert.deepEqual(
      checkBody('candles', {
        ...fixture('candles'),
        candles: [],
        count: 0,
        pointsPulled: 12,
        pointsSkipped: 12,
        seriesFromBlock: null,
      }),
      [],
    );
  });
});

describe('checkBody refuses a partial or malformed body', () => {
  it('refuses a missing status field, and names it', () => {
    // THE DEFECT: `String(status.lagBlocks ?? '—')` turns an absent field into a dash, and
    // `Lag — blocks` on the console reads as an index that has never run.
    //
    // More than one line names the same removal -- the presence check and the type check are
    // separate rules and both fire (3 here). That is deliberate: a report that says "missing"
    // AND "not a number" is clearer than one that picks a phrasing. The test asserts the field
    // is NAMED, not how many ways it was described.
    const body = fixture('status');
    delete body.lagBlocks;
    const found = checkBody('status', body);
    assert.ok(found.length > 0);
    assert.ok(
      found.some((problem) => /status\.lagBlocks/.test(problem)),
      `no line named status.lagBlocks: ${found.join(' | ')}`,
    );
    assert.deepEqual(checkBody('status', fixture('status')), [], 'and the same body unedited is accepted');
  });

  it('refuses a status whose age cannot be stated, even though the page would render it', () => {
    // THE DEFECT THIS ONE IS FOR, and it is the plan's honesty requirement: a snapshot from a
    // database with no `indexer_state` row carries `updatedAt: undefined`, which JSON drops.
    // The page would show "Updated —" with nothing saying why, and `staleSeconds` would be a
    // confident 0 -- an always-fresh-looking snapshot. Refusing is the correct outcome.
    for (const value of [undefined, null, '', 'not a date']) {
      const body = { ...fixture('status'), updatedAt: value };
      if (value === undefined) delete body.updatedAt;
      const found = checkBody('status', body);
      assert.ok(
        found.some((problem) => /status\.updatedAt/.test(problem)),
        `updatedAt=${JSON.stringify(value)} was accepted`,
      );
    }
  });

  it('refuses a missing coverage note rather than letting it print as "undefined"', () => {
    // The pages print `coverage.note` VERBATIM (INV-08). Absent, it prints the word
    // "undefined" at a reader in place of the service's statement about its own data gap.
    const body = fixture('status');
    delete (body.coverage as Record<string, unknown>).note;
    assert.match(checkBody('status', body).join('\n'), /status\.coverage\.note/);
  });

  it('refuses a missing decimals pair, because null decimals un-format every amount', () => {
    // `decimalsFrom()` returns null and `amountCell()` falls back to raw base units, so
    // `/history` would show `849930996648200851546` where it means `849.93...` -- a wrong
    // number that looks like a formatting bug and is a missing field.
    const body = fixture('price');
    delete (body.decimals as Record<string, unknown>).share;
    assert.match(checkBody('price', body).join('\n'), /price\.decimals\.share/);
  });

  it('refuses an event row with no transaction hash', () => {
    // The tx hash is the one thing in the events table a reader can check against a block
    // explorer, and it is why that table exists at all.
    const body = fixture('events');
    body.events = [
      { blockNumber: 46919498, logIndex: 69, blockHash: `0x${'ab'.repeat(32)}`, kind: 'Deposit', account: null, assets: '1', shares: '1', timestamp: 1 },
    ];
    assert.match(checkBody('events', body).join('\n'), /events\.events\[0\]\.txHash/);
  });

  it('distinguishes an absent nullable field from an explicit null', () => {
    // `account`, `assets` and `shares` are genuinely null for some event kinds, so `null` must
    // pass. An ABSENT key must not: it renders the same em dash for a different reason, which
    // is the confusion `amountCell()` exists to prevent.
    const withNulls = fixture('events');
    withNulls.events = [
      {
        blockNumber: 1,
        logIndex: 0,
        blockHash: `0x${'ab'.repeat(32)}`,
        txHash: `0x${'cd'.repeat(32)}`,
        kind: 'YieldReported',
        account: null,
        assets: '1',
        shares: null,
        timestamp: 1,
      },
    ];
    assert.deepEqual(checkBody('events', withNulls), []);

    const absent = structuredClone(withNulls);
    const rows = absent.events as Array<Record<string, unknown>>;
    assert.ok(rows[0], 'the fixture must still have its one row');
    delete rows[0].shares;
    assert.match(checkBody('events', absent).join('\n'), /events\.events\[0\]\.shares is missing/);
  });

  it('refuses an amount that arrived as a JSON number', () => {
    // Every amount in this project is a decimal string because a uint256 does not fit a double
    // (`src/lib/types.ts`). A JSON number here means something upstream went through
    // `Number()`, and the digits would already be wrong by the time the page read them.
    const body = fixture('summary');
    const kinds = body.kinds as Record<string, Record<string, unknown>>;
    kinds.Deposit!.assets = 20_000_000;
    assert.match(checkBody('summary', body).join('\n'), /is not a decimal string/);
  });

  it('refuses a filter envelope that is present but empty', () => {
    // `filter: {}` is the shape `EventResponse` was first written with. `filter.kind` would be
    // `undefined`, which is neither "filtered to Deposit" nor "not filtered".
    assert.match(checkBody('events', { ...fixture('events'), filter: {} }).join('\n'), /events\.filter\.kind is missing/);
  });

  it('refuses a candles body with no candle array, and names it', () => {
    // THE DEFECT: `/vault`'s chart reads `candles.data?.candles ?? []`, so an absent or renamed
    // array is not an error -- it is an empty chart, under a panel labelled "read from a snapshot
    // of the index service". A reader would take that for "the vault's price never moved and there
    // is nothing to draw", which is exactly the shape of lie this capture exists to prevent.
    const body = fixture('candles');
    delete body.candles;
    assert.match(checkBody('candles', body).join('\n'), /candles\.candles is not an array/);

    const renamed = { ...fixture('candles'), series: fixture('candles').candles };
    delete (renamed as Record<string, unknown>).candles;
    assert.match(checkBody('candles', renamed).join('\n'), /candles\.candles is not an array/);
  });

  it('refuses a candle missing one of the nine fields the chart reads, and names the row', () => {
    // `startsAt` is the React key AND the time axis; `points`, `firstBlock` and `lastBlock` are
    // printed in every candle's tooltip. Any of them absent renders as `undefined` inside a chart
    // that otherwise looks completely normal.
    for (const key of ['startsAt', 'endsAt', 'points', 'firstBlock', 'lastBlock', 'open', 'high', 'low', 'close']) {
      const body = structuredClone(fixture('candles'));
      const candles = body.candles as Array<Record<string, unknown>>;
      assert.ok(candles[0], 'the fixture must have at least one candle');
      delete candles[0][key];
      const found = checkBody('candles', body);
      assert.ok(
        found.some((problem) => problem.includes(`candles.candles[0].${key}`)),
        `removing ${key} was accepted, or the report did not name it: ${found.join(' | ') || '(no problems)'}`,
      );
    }
  });

  it('refuses a candle value that arrived as a JSON number or a broken decimal', () => {
    // The service aggregates candles in `BigInt` and formats them so a high cannot be reported that
    // the vault never had. A JSON number here means a double got in somewhere upstream, and the
    // digits would already be wrong -- `Number("1,234.5")` is `NaN`, which the chart turns into
    // "no price history" rather than into a wrong bar, so nothing on the page would say so.
    for (const value of [1.1, 1100000, '1.1.1', '', 'NaN']) {
      const body = structuredClone(fixture('candles'));
      (body.candles as Array<Record<string, unknown>>)[0]!.close = value;
      assert.match(
        checkBody('candles', body).join('\n'),
        /candles\.candles\[0\]\.close is not a decimal string/,
        `close=${JSON.stringify(value)} was accepted`,
      );
    }
  });

  it('refuses a candles envelope whose own numbers disagree with its array', () => {
    // Two arithmetic claims the service makes about itself (`formatCandles(...).length` and
    // `bucketsFor`'s "every pulled point is either in a candle or skipped"). A body that fails
    // either has points that vanished, while the chart still draws something plausible.
    const shortCount = structuredClone(fixture('candles'));
    const body = shortCount as Record<string, unknown>;
    body.count = (body.count as number) - 1;
    assert.match(checkBody('candles', body).join('\n'), /candles\.count is \d+ but candles\.candles holds \d+/);

    const lostPoints = structuredClone(fixture('candles')) as Record<string, unknown>;
    lostPoints.pointsSkipped = (lostPoints.pointsSkipped as number) + 3;
    assert.match(checkBody('candles', lostPoints).join('\n'), /candles\.pointsPulled is \d+/);
  });

  it('refuses a candles body whose series is not oldest first', () => {
    // `PriceChart` labels the axis from `candles[0]` and `candles.at(-1)`, so a reversed array
    // prints the window backwards while every individual candle still looks right.
    const body = structuredClone(fixture('candles'));
    body.candles = (body.candles as unknown[]).slice().reverse();
    assert.match(checkBody('candles', body).join('\n'), /does not come after candles\.candles\[0\]\.startsAt/);
  });

  it('refuses a body that is not an object at all', () => {
    for (const value of [null, 'a string', 42, []]) {
      assert.ok(checkBody('status', value).length > 0, `${JSON.stringify(value)} was accepted as a status`);
    }
  });
});

describe('withSnapshotNote', () => {
  it('appends one sentence to status.note and leaves everything else alone', () => {
    const body = fixture('status');
    const after = withSnapshotNote('status', body);
    assert.equal(after.note, `${body.note} ${SNAPSHOT_NOTE}`);
    assert.equal(after.updatedAt, body.updatedAt);
    assert.equal(after.staleSeconds, body.staleSeconds);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(body).sort());
  });

  it('does NOT rewrite staleSeconds or updatedAt', () => {
    // THE PLAN'S EXPLICIT REQUIREMENT. The service computed `staleSeconds` from its own
    // `updatedAt`; captured verbatim, a snapshot shows an age that GROWS as the page sits
    // there, which is true. Rewriting it to 0 would be the console claiming a freshness it
    // does not have -- the exact bug this console exists to avoid.
    const body = { ...fixture('status'), staleSeconds: 46072, updatedAt: '2026-09-17T01:30:48.538Z' };
    const after = withSnapshotNote('status', body);
    assert.equal(after.staleSeconds, 46072);
    assert.equal(after.updatedAt, '2026-09-17T01:30:48.538Z');
  });

  it('leaves the other four bodies untouched', () => {
    for (const name of ['summary', 'events', 'price', 'candles'] as const) {
      const body = fixture(name);
      assert.equal(withSnapshotNote(name, body), body);
    }
  });
});

/**
 * What a test can make the stub service do to one endpoint.
 *
 * `raw:<name>` answers with that text instead of JSON (the proxy/HTML case), and `mutate:<name>`
 * edits the fixture in place before it is serialised (the partial-body case). One record with
 * both kinds of key rather than two parameters, because most of these tests set one of them.
 */
type ServiceOverrides = {
  [K in `${'raw' | 'mutate'}:${Endpoint['name']}`]?: K extends `raw:${string}` ? string : (body: Record<string, unknown>) => void;
};

/**
 * A real HTTP server, so the refusal is exercised through the code path the workflow uses.
 *
 * The name comes out of the request URL rather than from a route table, so the server answers
 * whatever path the script asks for -- which is how a test can notice the script requesting an
 * endpoint that does not exist.
 */
async function withService<T>(overrides: ServiceOverrides, run: (service: string) => Promise<T>): Promise<T> {
  const server = createServer((req, res) => {
    const name = (req.url ?? '').split('?')[0]!.replace(/^\/api\//, '') as Endpoint['name'];
    if (!ENDPOINTS.some((endpoint) => endpoint.name === name)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `no such endpoint: ${req.url}` }));
      return;
    }

    const raw = overrides[`raw:${name}`];
    if (typeof raw === 'string') {
      // 200 with a non-JSON body, which is what a proxy or a misconfigured host actually does.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(raw);
      return;
    }

    const body = fixture(name);
    const mutate = overrides[`mutate:${name}`];
    if (typeof mutate === 'function') mutate(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body, null, 2));
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(`the stub service did not bind a TCP port: ${JSON.stringify(address)}`);
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

/** The error a rejected promise carried, as a message -- `assert.rejects` hands back `unknown`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('the capture itself', () => {
  it('captures all five bodies verbatim when the service answers properly', async () => {
    await withService({}, async (service) => {
      const results = await captureAll({ service });
      assert.deepEqual(
        results.map((result) => result.name),
        ENDPOINTS.map((endpoint) => endpoint.name),
      );
      assert.equal(results.length, ENDPOINTS.length);

      const capturedStatus = results.find((result) => result.name === 'status');
      assert.ok(capturedStatus, 'the capture did not return a status file');
      const status = JSON.parse(capturedStatus.text) as Record<string, unknown>;
      const original = fixture('status');
      assert.equal(status.note, `${original.note} ${SNAPSHOT_NOTE}`);
      // Verbatim means verbatim: every other value is the service's, unchanged.
      for (const [key, value] of Object.entries(original)) {
        if (key === 'note') continue;
        assert.deepEqual(status[key], value, `status.${key} was altered by the capture`);
      }
    });
  });

  it('reports the candle count, so a build log says the chart has something to draw', async () => {
    // THE REASON THE SUCCESS LINE CARRIES A FIGURE FOR THIS ONE ENDPOINT. `"candles": []` is a
    // perfectly valid snapshot body and a 25 KB file either way, so the byte count cannot tell the
    // two apart -- and they are opposite claims about the vault. The capture therefore reports the
    // count it verified, and this asserts the number is the array's, not a re-count of something
    // else.
    await withService({}, async (service) => {
      const results = await captureAll({ service });
      const candles = results.find((result) => result.name === 'candles');
      assert.ok(candles, 'the candle body was not captured');
      const body = JSON.parse(candles.text) as { candles: unknown[] };
      assert.equal(
        candles.detail,
        `${body.candles.length} candles over ${(body.candles as Array<{ points: number }>).reduce((total, candle) => total + candle.points, 0)} blocks`,
      );
      for (const other of results.filter((result) => result.name !== 'candles')) {
        assert.equal(other.detail, null, `${other.name} reported a detail line`);
      }
    });
  });

  it('REFUSES a body that is not JSON -- and writes nothing', async () => {
    // The real shape of this: a static host or a proxy answering a request the service never
    // saw. A `<!doctype html>` error page written to `public/api/status` would be served as
    // `api/status`, and the panels would get a JSON parse failure from `response.json()` and
    // report a service that answered "but not with JSON" -- pointing the reader at the wrong
    // thing entirely, since the service was never reached.
    await withService({ 'raw:status': '<!doctype html><title>502 Bad Gateway</title>' }, async (service) => {
      await assert.rejects(
        () => captureAll({ service }),
        (error: unknown) => /did not answer with JSON/.test(messageOf(error)) && /nothing was written/.test(messageOf(error)),
      );
    });
  });

  it('REFUSES when one body is complete and another is partial', async () => {
    // The failure mode the whole design is aimed at: three good files and one missing field.
    // Everything must fail together, so no half-valid snapshot can reach the host.
    await withService(
      {
        'mutate:summary': (body) => {
          delete body.lastIndexedBlock;
        },
      },
      async (service) => {
        await assert.rejects(
          () => captureAll({ service }),
          (error: unknown) => /summary\.lastIndexedBlock is missing/.test(messageOf(error)) && /nothing was written/.test(messageOf(error)),
        );
      },
    );
  });

  it('REFUSES a partial candles body -- the endpoint that was missing for a while', async () => {
    // The fifth endpoint's own refusal. `/api/candles` was the one path the capture did not write,
    // and the published page showed it as a 404 the `Then` panel reported under a snapshot label
    // (`docs/INDEX-SNAPSHOT-PLAN.md`). Now that the file is written, the same rule has to hold for
    // it as for the other four: a candle body missing a field the chart reads must fail the build
    // rather than be published as a chart that quietly draws the wrong thing.
    await withService(
      {
        'mutate:candles': (body) => {
          const rows = body.candles as Array<Record<string, unknown>>;
          delete rows[0]!.high;
        },
      },
      async (service) => {
        await assert.rejects(
          () => captureAll({ service }),
          (error: unknown) =>
            /candles\.candles\[0\]\.high/.test(messageOf(error)) && /nothing was written/.test(messageOf(error)),
        );
      },
    );
  });

  it('REFUSES a candles body that is not JSON, like every other endpoint', async () => {
    // A static host or a proxy answering where the capture expected JSON. The failure has to be
    // the capture's, naming the URL -- not a chart that renders an HTML error page as no history.
    await withService({ 'raw:candles': '<!doctype html><title>404 Not Found</title>' }, async (service) => {
      await assert.rejects(
        () => captureAll({ service }),
        (error: unknown) =>
          /\/api\/candles\?bucket=60&limit=5000 did not answer with JSON/.test(messageOf(error)) &&
          /nothing was written/.test(messageOf(error)),
      );
    });
  });

  it('reports every failed endpoint at once, not just the first', async () => {
    await withService({ 'raw:price': 'not json', 'raw:events': '<html>' }, async (service) => {
      try {
        await captureAll({ service });
        assert.fail('a capture with two bad bodies must not succeed');
      } catch (error) {
        assert.match(messageOf(error), /2 of 5 endpoint\(s\)/);
      }
    });
  });

  it('throws with the URL in the message when the service is not answering', async () => {
    // The workflow waits for `/api/status` before calling this, so this path means the wait
    // was wrong or the service died. Either way the message has to carry the URL that failed --
    // `fetch`'s own "fetch failed" carries no address at all.
    const status = ENDPOINTS[0];
    assert.ok(status, 'the endpoint list must not be empty');
    await assert.rejects(
      () => captureOne({ service: 'http://127.0.0.1:1', endpoint: status, timeoutMs: 3_000 }),
      (error: unknown) => /127\.0\.0\.1:1\/api\/status/.test(messageOf(error)),
    );
  });

  it('refuses a non-200 rather than writing the error body', async () => {
    await withService({}, async (service) => {
      // The stub service answers 200 for every KNOWN endpoint and 404 for anything else, so a
      // path it does not know takes the same code path a real 503 from the service would
      // (`!response.ok`) -- and is refused rather than written.
      await assert.rejects(
        () => captureOne({ service, endpoint: { name: 'status', path: '/api/nope', schema: 'status' } }),
        (error: unknown) => /answered HTTP 404/.test(messageOf(error)),
      );
    });
  });

  it('the CLI leaves the output directory EMPTY when it refuses', async () => {
    // The refusal is only worth anything if it happens BEFORE the write. `captureAll` cannot
    // write at all -- writing is `main`'s job, after every endpoint verified -- and this asserts
    // that from the outside, through the CLI, because that is how the workflow calls it.
    //
    // A temp directory, not `public/api`: the point is what a refused run does to the directory
    // it was pointed at, and pointing a test at the directory the site is built from would make
    // the test itself the thing that can corrupt the artefact.
    const out = mkdtempSync(join(tmpdir(), 'vault-console-capture-'));
    try {
      await withService({ 'raw:price': 'not json' }, async (service) => {
        const { main } = await import('../scripts/capture-index-snapshot.mjs');
        const code = await main(['--service', service, '--out', out]);
        assert.equal(code, 1, 'a refused capture must exit non-zero');
      });
      assert.deepEqual(readdirSync(out), [], 'a refused capture wrote something');

      // And the same directory DOES receive all five files when the service answers properly, so the
      // assertion above is about the refusal and not about a path that never works.
      await withService({}, async (service) => {
        const { main } = await import('../scripts/capture-index-snapshot.mjs');
        assert.equal(await main(['--service', service, '--out', out]), 0);
      });
      assert.deepEqual(readdirSync(out).sort(), ['candles', 'events', 'price', 'status', 'summary']);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

after(() => {
  // Nothing to clean up: the fixtures are read-only inputs and the temp server is closed in
  // its own `finally`. This hook is here so a future test that writes a file has an obvious
  // place to undo it -- the capture script itself only writes where `--out` says, and the
  // tests above never call the CLI.
});
