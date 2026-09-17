/**
 * Capture the index service's own answers as files, for the static export to serve.
 *
 * WHAT THIS IS FOR
 *
 * The published console is a static export, so there is no process to answer `/api/status`
 * and friends. This script asks the RUNNING SERVICE for those five answers and writes the
 * bodies to `public/api/status`, `public/api/summary`, `public/api/events`,
 * `public/api/price` and `public/api/candles`. The client is unchanged: it requests those
 * paths, the static host answers with these files. (A file with no extension is served at
 * its own path -- the same trick `public/api/config` already uses.)
 *
 * THE CONSTRAINT THIS SCRIPT EXISTS TO KEEP
 *
 * IT NEVER COMPUTES ANYTHING. It is tempting to read `data/vault.sqlite` in the workflow and
 * write the JSON directly. That would work and it would be wrong: `src/api/price.ts` in
 * `erc4626-vault-dapp` owns the share-price formula, and this console's central design
 * decision is that it READS that result rather than recomputing it (`README.md`, the `/vault`
 * price panel). A second implementation of the formula in a second repository would be a
 * second source of truth for the vault's most error-prone number, and the two would agree
 * until one of them was edited. So this script only GETs and writes; the one thing it adds
 * is one sentence appended to `status.note` (see below).
 *
 * WHY IT REFUSES RATHER THAN PUBLISHING WHAT IT GOT
 *
 * A half-valid snapshot is worse than no snapshot. A missing field does not render as a gap
 * on the page -- the panels read `status.lagBlocks`, `summary.kinds`, `events[].txHash`,
 * `candles[].open` and so on -- it renders as `—`, or as an empty table, or as a `NaN`, which
 * reads exactly like a working page that found no data. Publishing that is a lie with a
 * plausible face. So every body must parse as JSON and carry every field the pages read, or
 * this exits non-zero and writes nothing.
 *
 * WHAT "REQUIRED" MEANS HERE, FIELD BY FIELD
 *
 * The list below is not a copy of `src/lib/types.ts`; it is the subset of it the PAGES
 * actually read, and each entry is one of those reads. The types are the source -- they were
 * themselves read off the running service (`test/contract.test.ts` pins them) -- and the
 * rationale for what the pages consume is in `src/app/history/page.tsx` and
 * `src/app/vault/page.tsx`. The fields the pages read, and the consequence of a missing one:
 *
 *   status    `lastIndexedBlock`, `lagBlocks`, `eventCount`, `snapshotCount`,
 *             `seriesFromBlock`, `eventsFromBlock`, `healthy`, `updatedAt`, `staleSeconds`,
 *             `note`            -> the four counters, the coverage paragraphs, and the
 *                                  status note the page prints verbatim
 *             `coverage.*`      -> `startsLaterThanDeployment` gates a paragraph, and
 *                                  `coverage.note` is printed VERBATIM; a missing note
 *                                  would print the word `undefined` at a reader
 *             `chainId`, `vault`, `asset`, `startBlock` -> not rendered, but they are how
 *                                  anyone can tell WHICH deployment this snapshot describes,
 *                                  and the console's config names the same three. A snapshot
 *                                  of another vault's index would otherwise look identical
 *   summary   `kinds[].count/assets`, `totalEvents`, `firstEventBlock`, `lastEventBlock`,
 *             `lastIndexedBlock`, `unknownKinds`, `note`
 *                             -> the whole `/history` tally table
 *   events    `events[]` with `blockNumber`, `logIndex`, `blockHash`, `txHash`, `kind`,
 *             `account`, `assets`, `shares`, `timestamp`; plus `count`, `limit`, `maxLimit`,
 *             `filter`
 *                             -> every column of the recent-events table, which is the part
 *                                of the index a reader can check against a block explorer; the
 *                                `txHash` is the point. `filter` is asserted because it is the
 *                                envelope that `EventResponse` was once written WITHOUT
 *                                (`src/lib/types.ts` records that near-miss)
 *   price     `series[].blockNumber/blockHash/timestamp/totalAssets/totalSupply/price`,
 *             `decimals.asset/share`, `count`, `limit`, `maxLimit`, `seriesFromBlock`,
 *             `coverage.note`, `note`
 *                             -> the price table and the `decimalsFrom()` guard: a missing
 *                                `decimals` makes `decimalsFrom` return null and the amounts
 *                                render as raw base units, which looks like a formatting bug
 *   candles   `candles[].startsAt/endsAt/open/high/low/close/points/firstBlock/lastBlock`
 *                             -> the whole candlestick chart in `/vault`'s `Then` panel, which
 *                                is the panel this endpoint was added for. `startsAt` is the
 *                                React key and the time axis, `points`/`firstBlock`/`lastBlock`
 *                                are printed in each candle's tooltip, and the four OHLC values
 *                                ARE the picture. They are FORMATTED decimal strings (`"1.1"`),
 *                                NOT base units: `candleGeometry()` converts them to pixel rows
 *                                and `displayDecimal()` prints them as they stand. A JSON number
 *                                here would be a double, and the service aggregates these in
 *                                `BigInt` precisely so a high cannot be reported that the vault
 *                                never had. (`endsAt` is the one field of the nine nothing on the
 *                                page reads; see `checkCandle` for why it is required anyway.)
 *             `decimals.asset/share`, `count`, `pointsPulled`, `pointsSkipped`, `bucketSeconds`,
 *             `limit`, `maxLimit`, `seriesFromBlock`, `coverage.note`, `note`
 *                             -> the envelope `CandleResponse` declares, asserted for the same
 *                                reason `events.filter` is (see `src/lib/types.ts`): a type that
 *                                describes something nobody sends is worse than no type. It is
 *                                also the service's own account of the answer -- `count` must
 *                                equal the array it labels, and `pointsSkipped` is the service
 *                                saying it LEFT OUT the points it could not price rather than
 *                                plotting them at zero. `bucketSeconds` is the width the panel's
 *                                axis label uses ("N x 60s"), so a body bucketed some other way
 *                                would make that label describe a chart it is not
 *
 * `updatedAt` and `staleSeconds` are REQUIRED even though the service emits them from a row
 * that could be absent. That is deliberate, and it is the one place this script is stricter
 * than the page: the plan's whole point is that the STALENESS OF THE SNAPSHOT MUST STAY
 * VISIBLE. A capture taken from a database with no `indexer_state` row would produce a
 * status with no `updatedAt` at all (the service returns `undefined`, which
 * `JSON.stringify` drops), and the page would then show "Updated —" with nothing saying
 * why. Refusing here turns that into a failed build, which is the correct outcome: a
 * snapshot whose age cannot be stated must not be published.
 *
 * WHAT IT DOES NOT REWRITE, AND WHY
 *
 * `staleSeconds` and `updatedAt` are written EXACTLY as captured. The service computed
 * `staleSeconds` from its own `updatedAt`; a snapshot taken at build time therefore shows an
 * age that grows as the page sits there. That is true, and it is better than a figure that
 * always says "0s ago" -- rewriting it would be the console inventing a freshness it does not
 * have, which is the exact bug this console exists to avoid.
 *
 * The single addition is ONE SENTENCE appended to `status.note`. The page renders that note
 * verbatim, so it is where the page can say "these figures are a snapshot" without a second
 * code path in the client. Nothing else in any body is touched.
 *
 * Usage:
 *
 *   node scripts/capture-index-snapshot.mjs \
 *     --service http://127.0.0.1:8787 \
 *     --out public/api
 *
 * Exit codes: 0 captured and every field verified; 1 refused (see the report on stderr);
 * 2 usage error, including a service that did not answer.
 *
 * CI note: the workflow starts the service and waits for `/api/status` before calling this.
 * This script makes no attempt to start anything -- starting a process is the workflow's job,
 * and a script that started things would hide the case where the service never came up.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The one sentence this script adds, in one place so the test and the script cannot disagree.
 *
 * It says three things on purpose: that these are a snapshot, WHEN it was taken, and that the
 * age the page shows is measured from the snapshot rather than from now. The third is what
 * makes the `staleSeconds` figure honest instead of confusing.
 */
export const SNAPSHOT_NOTE =
  'These figures are a snapshot of the index service, taken when this page was built ' +
  '(not a live reading), which is why the age above is measured from the snapshot rather than from now.';

/**
 * The five things captured, at the paths the console requests.
 *
 * `name` is also the file name written into `--out`: the console fetches `api/status` and a
 * file named `status` is served there. The query strings are the ones the pages send
 * (`src/app/history/page.tsx`: `EVENT_ROWS = 50`, `PRICE_ROWS = 25`; `src/app/vault/page.tsx`:
 * `api.candles(60, 5000)`), so a limit in a file is the limit the page actually asked for.
 * `candles` is the fifth entry and it is the one whose absence was visible: `/vault` asks for it
 * and the four files that used to be written here left the `Then` panel reporting a failed index
 * read next to a fully populated `Index health` panel (`docs/INDEX-SNAPSHOT-PLAN.md`).
 */
export const ENDPOINTS = [
  { name: 'status', path: '/api/status', schema: 'status' },
  { name: 'summary', path: '/api/summary', schema: 'summary' },
  { name: 'events', path: '/api/events?limit=50', schema: 'events' },
  { name: 'price', path: '/api/price?limit=25', schema: 'price' },
  { name: 'candles', path: '/api/candles?bucket=60&limit=5000', schema: 'candles' },
];

// ------------------------------------------------------------------ small type guards

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A decimal string. Amounts are uint256s and MUST NOT pass through a double (see types.ts). */
const isDecimalString = (value) => typeof value === 'string' && value.length > 0 && /^[0-9]+$/.test(value);

const isHexString = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

/** A block number, a timestamp or a count. Small enough to be a JS number by definition. */
const isInteger = (value) => typeof value === 'number' && Number.isInteger(value);

/** A string, or an explicit `null`. NOT `undefined`: an absent field is a malformed body. */
const isStringOrNull = (value) => typeof value === 'string' || value === null;
const isIntegerOrNull = (value) => isInteger(value) || value === null;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Collect problems instead of throwing on the first one.
 *
 * A build log that reports all six missing fields at once is a five-minute fix; one that
 * reports them across six CI runs is not. Every report line names the path (`status.coverage.note`)
 * because "note is missing" is ambiguous between five endpoints and three nested objects.
 */
function problems(where, checks) {
  const found = [];
  for (const [label, ok, expected] of checks) {
    if (!ok) found.push(`${where}: ${label} -- expected ${expected}`);
  }
  return found;
}

/** `required` must be present and non-null; `nullable` may be null but must not be absent. */
function checkKeys(where, value, { required = [], nullable = [], booleans = [] }) {
  const found = [];
  for (const key of required) {
    if (!has(value, key)) found.push(`${where}.${key} is missing`);
    else if (value[key] === null || value[key] === undefined) {
      found.push(`${where}.${key} is ${value[key] === null ? 'null' : 'undefined'}, which is not a value the page can render`);
    }
  }
  for (const key of nullable) {
    if (!has(value, key)) found.push(`${where}.${key} is missing (an explicit null is allowed; an absent field is not)`);
  }
  for (const key of booleans) {
    if (typeof value[key] !== 'boolean') found.push(`${where}.${key} is not a boolean: ${JSON.stringify(value[key])}`);
  }
  return found;
}

/**
 * The shared `coverage` object, which three of the five service responses carry (`status`,
 * `price` and `candles`; `summary` and `events` have none).
 *
 * `startsLaterThanDeployment` needs no type check beyond `typeof boolean` because JSON has no
 * way to spell `undefined`: if the key is there, the service computed it.
 */
function checkCoverage(where, value) {
  if (!isPlainObject(value)) return [`${where} is not an object`];
  const found = checkKeys(where, value, {
    nullable: ['vaultStartBlock', 'seriesFromBlock', 'eventsFromBlock', 'coverageBeginsAt'],
    booleans: ['startsLaterThanDeployment'],
  });
  if (typeof value.note !== 'string' || value.note.length === 0) {
    // Printed verbatim by the pages, so an absent note is the word "undefined" at a reader.
    found.push(`${where}.note is not a non-empty string: ${JSON.stringify(value.note)}`);
  }
  return found;
}

// ------------------------------------------------------------------ the five schemas

function checkStatus(body) {
  if (!isPlainObject(body)) return ['status is not a JSON object'];
  const found = checkKeys('status', body, {
    required: ['healthy', 'chainId', 'vault', 'asset', 'startBlock', 'lastIndexedBlock', 'chainHeadAtLastRun', 'lagBlocks'],
    nullable: [
      'lastIndexedBlock',
      'chainHeadAtLastRun',
      'lagBlocks',
      'eventCount',
      'snapshotCount',
      'seriesFromBlock',
      'eventsFromBlock',
      'updatedAt',
      'staleSeconds',
      'note',
      'coverage',
    ],
    booleans: ['healthy'],
  });

  if (!isInteger(body.chainId)) found.push(`status.chainId is not an integer: ${JSON.stringify(body.chainId)}`);
  if (!isInteger(body.startBlock)) found.push(`status.startBlock is not a block number: ${JSON.stringify(body.startBlock)}`);
  if (!isAddress(body.vault)) found.push(`status.vault is not an address: ${JSON.stringify(body.vault)}`);
  if (!isAddress(body.asset)) found.push(`status.asset is not an address: ${JSON.stringify(body.asset)}`);

  // The three the status panel counts with. `eventCount` reaches `String(...)`, which turns
  // an absent value into the string "undefined" rather than a dash -- worth refusing.
  for (const key of ['eventCount', 'snapshotCount']) {
    if (!isInteger(body[key])) found.push(`status.${key} is not a count: ${JSON.stringify(body[key])}`);
  }
  for (const key of ['lastIndexedBlock', 'chainHeadAtLastRun', 'lagBlocks', 'seriesFromBlock', 'eventsFromBlock']) {
    if (!isIntegerOrNull(body[key])) found.push(`status.${key} is not a number or null: ${JSON.stringify(body[key])}`);
  }

  // THE STALENESS MUST BE STATABLE. See the header: this is the strictness that keeps a
  // snapshot whose age cannot be reported from being published.
  if (typeof body.updatedAt !== 'string' || body.updatedAt === '') {
    found.push(`status.updatedAt is not an ISO timestamp: ${JSON.stringify(body.updatedAt)} (a snapshot whose age cannot be stated must not be published)`);
  } else if (Number.isNaN(Date.parse(body.updatedAt))) {
    found.push(`status.updatedAt does not parse as a date: ${JSON.stringify(body.updatedAt)}`);
  }
  if (!isInteger(body.staleSeconds) || body.staleSeconds < 0) {
    found.push(`status.staleSeconds is not a non-negative integer: ${JSON.stringify(body.staleSeconds)}`);
  }
  if (typeof body.note !== 'string' || body.note.length === 0) {
    found.push(`status.note is not a non-empty string: ${JSON.stringify(body.note)}`);
  }

  found.push(...checkCoverage('status.coverage', body.coverage));
  return found;
}

function checkSummary(body) {
  if (!isPlainObject(body)) return ['summary is not a JSON object'];
  const found = checkKeys('summary', body, {
    nullable: ['totalEvents', 'firstEventBlock', 'lastEventBlock', 'lastIndexedBlock', 'unknownKinds', 'note'],
  });

  if (!isPlainObject(body.kinds)) {
    found.push('summary.kinds is not an object (the keyed tally is what the whole Event tally panel is built from)');
  } else {
    for (const [kind, entry] of Object.entries(body.kinds)) {
      if (!isPlainObject(entry)) {
        found.push(`summary.kinds.${kind} is not an object`);
        continue;
      }
      if (!isInteger(entry.count)) found.push(`summary.kinds.${kind}.count is not a count: ${JSON.stringify(entry.count)}`);
      if (!isDecimalString(entry.assets)) {
        // Summed as BigInt by the service and emitted as a decimal string; a JSON number here
        // would mean a uint256 went through a double somewhere upstream.
        found.push(`summary.kinds.${kind}.assets is not a decimal string: ${JSON.stringify(entry.assets)}`);
      }
    }
  }

  if (!isInteger(body.totalEvents)) found.push(`summary.totalEvents is not a count: ${JSON.stringify(body.totalEvents)}`);
  for (const key of ['firstEventBlock', 'lastEventBlock', 'lastIndexedBlock']) {
    if (!isIntegerOrNull(body[key])) found.push(`summary.${key} is not a number or null: ${JSON.stringify(body[key])}`);
  }
  if (!Array.isArray(body.unknownKinds) || body.unknownKinds.some((k) => typeof k !== 'string')) {
    found.push(`summary.unknownKinds is not an array of strings: ${JSON.stringify(body.unknownKinds)}`);
  }
  if (typeof body.note !== 'string' || body.note.length === 0) {
    found.push(`summary.note is not a non-empty string: ${JSON.stringify(body.note)}`);
  }
  return found;
}

/**
 * One event row.
 *
 * `account`, `assets` and `shares` are checked for PRESENCE separately from their contents,
 * because `null` is a real value for all three: a `YieldReported` carries no share amount, and
 * the page renders those as an em dash with the reason in a title attribute. An ABSENT
 * `shares` key would render the same em dash for a different reason, which is exactly the
 * confusion `amountCell()` in `src/lib/history.ts` exists to prevent.
 */
function checkEventRow(where, row) {
  if (!isPlainObject(row)) return [`${where} is not an object`];
  const found = checkKeys(where, row, {
    nullable: ['account', 'assets', 'shares'],
  });
  for (const key of ['blockNumber', 'logIndex', 'timestamp']) {
    if (!isInteger(row[key])) found.push(`${where}.${key} is not an integer: ${JSON.stringify(row[key])}`);
  }
  for (const key of ['blockHash', 'txHash']) {
    if (!isHexString(row[key])) {
      // The transaction hash is the whole point of the events table: it is what a reader
      // checks against a block explorer.
      found.push(`${where}.${key} is not a hex string: ${JSON.stringify(row[key])}`);
    }
  }
  if (typeof row.kind !== 'string' || row.kind.length === 0) {
    found.push(`${where}.kind is not a non-empty string: ${JSON.stringify(row.kind)}`);
  }
  if (!isStringOrNull(row.account)) found.push(`${where}.account is neither a string nor null: ${JSON.stringify(row.account)}`);
  for (const key of ['assets', 'shares']) {
    if (row[key] !== null && !isDecimalString(row[key])) {
      found.push(`${where}.${key} is neither a decimal string nor null: ${JSON.stringify(row[key])}`);
    }
  }
  return found;
}

function checkEvents(body) {
  if (!isPlainObject(body)) return ['events is not a JSON object'];
  const found = checkKeys('events', body, { nullable: ['maxLimit', 'filter'] });

  if (!Array.isArray(body.events)) {
    found.push('events.events is not an array');
  } else {
    body.events.forEach((row, index) => found.push(...checkEventRow(`events.events[${index}]`, row)));
  }
  for (const key of ['count', 'limit']) {
    if (!isInteger(body[key])) found.push(`events.${key} is not a count: ${JSON.stringify(body[key])}`);
  }
  if (!isInteger(body.maxLimit)) found.push(`events.maxLimit is not a count: ${JSON.stringify(body.maxLimit)}`);

  // The envelope `EventResponse` was first written without. `null` means "not filtered", which
  // is a different statement from "no match", so an absent `filter` cannot be read as one.
  if (!isPlainObject(body.filter)) {
    found.push(`events.filter is not an object: ${JSON.stringify(body.filter)}`);
  } else {
    for (const key of ['kind', 'account']) {
      if (!has(body.filter, key)) found.push(`events.filter.${key} is missing (null is the value for "not filtered")`);
      else if (!isStringOrNull(body.filter[key])) {
        found.push(`events.filter.${key} is neither a string nor null: ${JSON.stringify(body.filter[key])}`);
      }
    }
  }
  return found;
}

/** One point of the price series. `price` is null when the vault held no shares. */
function checkPricePoint(where, point) {
  if (!isPlainObject(point)) return [`${where} is not an object`];
  const found = checkKeys(where, point, { nullable: ['price'] });
  if (!isInteger(point.blockNumber)) found.push(`${where}.blockNumber is not an integer: ${JSON.stringify(point.blockNumber)}`);
  if (!isInteger(point.timestamp)) found.push(`${where}.timestamp is not an integer: ${JSON.stringify(point.timestamp)}`);
  if (!isHexString(point.blockHash)) found.push(`${where}.blockHash is not a hex string: ${JSON.stringify(point.blockHash)}`);
  for (const key of ['totalAssets', 'totalSupply']) {
    // RAW uint256 base units as decimal strings. This is the pair `price.ts` divides, and the
    // reason every amount in this project is a string.
    if (!isDecimalString(point[key])) found.push(`${where}.${key} is not a decimal string: ${JSON.stringify(point[key])}`);
  }
  if (point.price !== null && typeof point.price !== 'string') {
    found.push(`${where}.price is neither a string nor null: ${JSON.stringify(point.price)}`);
  }
  return found;
}

function checkPrice(body) {
  if (!isPlainObject(body)) return ['price is not a JSON object'];
  const found = checkKeys('price', body, { nullable: ['maxLimit', 'seriesFromBlock', 'coverage', 'note'] });

  if (!Array.isArray(body.series)) {
    found.push('price.series is not an array');
  } else {
    body.series.forEach((point, index) => found.push(...checkPricePoint(`price.series[${index}]`, point)));
  }

  // `decimalsFrom()` in `src/lib/history.ts` returns null when either count is missing, and
  // null makes every amount on `/history` render as raw base units -- which looks like a
  // formatting bug rather than a missing field.
  if (!isPlainObject(body.decimals)) {
    found.push(`price.decimals is not an object: ${JSON.stringify(body.decimals)}`);
  } else {
    for (const key of ['asset', 'share']) {
      if (!isInteger(body.decimals[key])) {
        found.push(`price.decimals.${key} is not an integer: ${JSON.stringify(body.decimals[key])}`);
      }
    }
  }

  for (const key of ['count', 'limit', 'maxLimit']) {
    if (!isInteger(body[key])) found.push(`price.${key} is not a count: ${JSON.stringify(body[key])}`);
  }
  if (!isIntegerOrNull(body.seriesFromBlock)) {
    found.push(`price.seriesFromBlock is not a number or null: ${JSON.stringify(body.seriesFromBlock)}`);
  }
  if (typeof body.note !== 'string' || body.note.length === 0) {
    found.push(`price.note is not a non-empty string: ${JSON.stringify(body.note)}`);
  }

  found.push(...checkCoverage('price.coverage', body.coverage));
  return found;
}

/**
 * A decimal string in the form the SERVICE formats candles in.
 *
 * THIS IS NOT A SECOND SPELLING OF `isDecimalString`. That one is for RAW BASE UNITS, which the
 * service emits with no grouping by construction; this one is for candle OHLC, which the service
 * runs through `groupThousands()` in `erc4626-vault-dapp/src/api/chart.ts`, so `"1,234.5"` is a
 * value this service really produces and `isDecimalString` would refuse a perfectly good body.
 * The rule that matters is the one both share: it must be a STRING. A JSON number here would be a
 * double, and the digits would already be wrong by the time the page read them.
 *
 * Grouping is allowed but not required, and it is checked for shape (`1,23.5` is refused) rather
 * than for policy: a validator that recomputed the grouping would be a second implementation of
 * `groupThousands`.
 */
const isFormattedDecimalString = (value) =>
  typeof value === 'string' && /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);

/**
 * One candle -- all nine fields of `Candle` in `src/lib/types.ts`.
 *
 * EIGHT OF THE NINE ARE READ BY THE PAGE (`PriceChart` and `chartGeometry`: `startsAt` as the React
 * key and the time axis, the OHLC values as the picture, `points`/`firstBlock`/`lastBlock` in the
 * tooltip). `endsAt` is the ninth and nothing draws it -- it is required because the type declares
 * it and `test/contract.test.ts` pins the field set one by one, so a body without it is a body from
 * a different version of the service. It is deliberately checked only as `endsAt > startsAt` and NOT
 * as `endsAt - startsAt === bucketSeconds`: the panel's axis label reads `bucketSeconds`, nothing on
 * the page reads `endsAt`, and a rule that refused a body the page renders perfectly would be this
 * checker being stricter than the thing it protects.
 *
 * The other three cross-field rules (`points >= 1`, `firstBlock <= lastBlock`, and that one) are true
 * by construction in `chart.ts`: a candle is only created when a point falls in its bucket, with
 * `points: 1`. They are asserted rather than assumed because each one, broken, draws a candle that is
 * a picture of nothing -- a body with no blocks in it, or a range that runs backwards.
 */
function checkCandle(where, candle) {
  if (!isPlainObject(candle)) return [`${where} is not an object`];
  const found = [];

  for (const key of ['startsAt', 'endsAt', 'points', 'firstBlock', 'lastBlock']) {
    if (!isInteger(candle[key])) found.push(`${where}.${key} is not an integer: ${JSON.stringify(candle[key])}`);
  }
  if (isInteger(candle.startsAt) && isInteger(candle.endsAt) && candle.endsAt <= candle.startsAt) {
    found.push(`${where}.endsAt (${candle.endsAt}) is not after startsAt (${candle.startsAt})`);
  }
  if (isInteger(candle.points) && candle.points < 1) {
    found.push(`${where}.points is ${candle.points}: a candle exists only because at least one price point fell in it`);
  }
  if (isInteger(candle.firstBlock) && isInteger(candle.lastBlock) && candle.firstBlock > candle.lastBlock) {
    found.push(`${where}.firstBlock (${candle.firstBlock}) is after lastBlock (${candle.lastBlock})`);
  }

  for (const key of ['open', 'high', 'low', 'close']) {
    // Formatted decimal strings, so the tooltip prints `1.1` and the chart can place a pixel.
    if (!isFormattedDecimalString(candle[key])) {
      found.push(`${where}.${key} is not a decimal string: ${JSON.stringify(candle[key])}`);
    }
  }
  return found;
}

function checkCandles(body) {
  if (!isPlainObject(body)) return ['candles is not a JSON object'];
  const found = checkKeys('candles', body, {
    nullable: ['seriesFromBlock', 'coverage', 'note'],
  });

  if (!Array.isArray(body.candles)) {
    found.push('candles.candles is not an array');
  } else {
    body.candles.forEach((candle, index) => found.push(...checkCandle(`candles.candles[${index}]`, candle)));

    // OLDEST FIRST, and the panel depends on it: `PriceChart` reads `candles[0]` and
    // `candles.at(-1)` to label the axis, so a reversed array would print the window backwards
    // while every individual candle still looked right. `chart.ts` sorts before bucketing, so
    // this holds by construction.
    for (let index = 1; index < body.candles.length; index += 1) {
      const previous = body.candles[index - 1];
      const current = body.candles[index];
      if (isInteger(previous?.startsAt) && isInteger(current?.startsAt) && current.startsAt <= previous.startsAt) {
        found.push(
          `candles.candles[${index}].startsAt (${current.startsAt}) does not come after candles.candles[${index - 1}].startsAt (${previous.startsAt}): the series must be oldest first`,
        );
      }
    }
  }

  // `decimalsFrom()` is not what makes this one matter -- nothing on `/vault` formats a candle
  // with it -- but `CandleResponse` declares it, and the same pair is what `price` carries, so a
  // body without it is a body from a different endpoint or a different version of the service.
  if (!isPlainObject(body.decimals)) {
    found.push(`candles.decimals is not an object: ${JSON.stringify(body.decimals)}`);
  } else {
    for (const key of ['asset', 'share']) {
      if (!isInteger(body.decimals[key])) {
        found.push(`candles.decimals.${key} is not an integer: ${JSON.stringify(body.decimals[key])}`);
      }
    }
  }

  for (const key of ['count', 'limit', 'maxLimit', 'pointsPulled', 'pointsSkipped']) {
    if (!isInteger(body[key])) found.push(`candles.${key} is not a count: ${JSON.stringify(body[key])}`);
  }
  if (isInteger(body.pointsSkipped) && body.pointsSkipped < 0) {
    found.push(`candles.pointsSkipped is negative: ${body.pointsSkipped}`);
  }
  if (!isInteger(body.bucketSeconds)) {
    found.push(`candles.bucketSeconds is not an integer: ${JSON.stringify(body.bucketSeconds)}`);
  } else if (body.bucketSeconds <= 0) {
    // `bucket=0` is refused by the service for the same reason: there is no zero-second candle.
    found.push(`candles.bucketSeconds is not a positive number of seconds: ${body.bucketSeconds}`);
  }
  if (!isIntegerOrNull(body.seriesFromBlock)) {
    found.push(`candles.seriesFromBlock is not a number or null: ${JSON.stringify(body.seriesFromBlock)}`);
  }

  /*
   * THE BODY HAS TO AGREE WITH ITSELF, and these two are the arithmetic of that.
   *
   * `count` labels the array beside it -- `formatCandles(...).length` in the service -- so a body
   * where the two disagree is a body whose own numbers say two different things, and the page
   * would print one of them (`candles.length` in the figcaption) while the envelope said the
   * other. The second is `pointsPulled = sum(candles[].points) + pointsSkipped`, which is exactly
   * what `bucketsFor()` guarantees: every pulled point is either counted in one candle or counted
   * as skipped, never both and never neither. A body that fails it has points that vanished.
   */
  if (Array.isArray(body.candles) && isInteger(body.count) && body.count !== body.candles.length) {
    found.push(`candles.count is ${body.count} but candles.candles holds ${body.candles.length}`);
  }
  if (Array.isArray(body.candles) && isInteger(body.pointsPulled) && isInteger(body.pointsSkipped)) {
    const inCandles = body.candles.reduce((total, candle) => total + (isInteger(candle?.points) ? candle.points : 0), 0);
    if (inCandles + body.pointsSkipped !== body.pointsPulled) {
      found.push(
        `candles.pointsPulled is ${body.pointsPulled} but the candles account for ${inCandles} and pointsSkipped for ${body.pointsSkipped}`,
      );
    }
  }

  if (typeof body.note !== 'string' || body.note.length === 0) {
    found.push(`candles.note is not a non-empty string: ${JSON.stringify(body.note)}`);
  }

  found.push(...checkCoverage('candles.coverage', body.coverage));
  return found;
}

const SCHEMAS = { status: checkStatus, summary: checkSummary, events: checkEvents, price: checkPrice, candles: checkCandles };

/**
 * Every problem with one body, as an array of sentences. Empty means it can be published.
 *
 * Exported (with the schema above) so `test/capture-index-snapshot.test.ts` can exercise each
 * refusal directly, rather than only through a subprocess.
 */
export function checkBody(name, body) {
  const schema = SCHEMAS[name];
  if (!schema) return [`no schema is registered for "${name}"`];
  return schema(body);
}

/**
 * The body as it will be written: the service's bytes, with one sentence added to `status.note`.
 *
 * Nothing else is touched. `updatedAt` and `staleSeconds` in particular are passed through
 * exactly as captured -- the header explains why they must not be rewritten.
 */
export function withSnapshotNote(name, body) {
  if (name !== 'status') return body;
  const note = typeof body.note === 'string' ? body.note : '';
  return { ...body, note: note === '' ? SNAPSHOT_NOTE : `${note} ${SNAPSHOT_NOTE}` };
}

// ------------------------------------------------------------------------- the capture

/**
 * GET one endpoint, verify it, and return the text to write.
 *
 * Throws on any refusal, so the caller decides how to report -- there is deliberately no
 * "continue on failure" path, because a partial capture is the outcome this script exists to
 * prevent.
 */
export async function captureOne({ service, endpoint, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const url = `${service.replace(/\/+$/, '')}${endpoint.path}`;

  // The transport failure is re-thrown with the URL attached. `fetch`'s own `TypeError: fetch
  // failed` carries no address, so a workflow log would say the capture failed without saying
  // WHICH request failed -- and the URL is the one fact that distinguishes "the service is not
  // up yet" from "the service is up on another port".
  let response;
  let text;
  try {
    response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await response.text();
  } catch (cause) {
    throw new Error(
      `${url} could not be read: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        'Is the index service running? The workflow waits for /api/status before calling this; ' +
        'this script never starts anything.',
    );
  }

  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}. Body: ${text.slice(0, 300)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${url} did not answer with JSON: ${cause instanceof Error ? cause.message : String(cause)}. First 200 bytes: ${text.slice(0, 200)}`);
  }

  const found = checkBody(endpoint.name, body);
  if (found.length > 0) {
    throw new Error(`${url} answered, but the body is not usable as a ${endpoint.name} snapshot:\n  - ${found.join('\n  - ')}`);
  }

  return `${JSON.stringify(withSnapshotNote(endpoint.name, body), null, 2)}\n`;
}

/**
 * What a body holds, for the endpoints whose SIZE does not say.
 *
 * A byte count answers "did the file arrive". For the four bodies whose content is a fixed
 * envelope it also answers "is there anything in it": `status` is one object, `summary` one tally,
 * `events` and `price` a handful of rows. `candles` is the exception -- 24 KB of candles and 24 KB
 * of `"candles": []` are the same size, and they mean opposite things (a chart with 169 bars, or a
 * panel that says there is no price history in this window). So the capture reports the count it
 * verified, which is the figure a reader of the build log actually needs.
 *
 * Returns null for the endpoints that need no such line, so the success line stays uniform.
 */
export function summariseBody(name, body) {
  if (name !== 'candles' || !isPlainObject(body) || !Array.isArray(body.candles)) return null;
  const count = body.candles.length;
  const blocks = body.candles.reduce((total, candle) => total + (isInteger(candle?.points) ? candle.points : 0), 0);
  return `${count} candle${count === 1 ? '' : 's'} over ${blocks} block${blocks === 1 ? '' : 's'}`;
}

/**
 * Fetch all five. Resolves to `[{ name, path, text, bytes, detail }]`, or throws with every
 * failure. `detail` is `summariseBody`'s sentence, for the success line; it is `null` where a byte
 * count already says everything.
 */
export async function captureAll({ service, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const results = [];
  const failures = [];

  for (const endpoint of ENDPOINTS) {
    try {
      const text = await captureOne({ service, endpoint, fetchImpl, timeoutMs });
      // Re-parsed rather than returned by `captureOne`, which is deliberately narrow: it hands
      // back the exact bytes to write and nothing else, so there is one place that decides what
      // a body means. This parse cannot fail -- `captureOne` refused anything that does not
      // parse, and refused anything whose schema does not pass.
      const detail = summariseBody(endpoint.name, JSON.parse(text));
      results.push({ name: endpoint.name, path: endpoint.path, text, bytes: Buffer.byteLength(text), detail });
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // Reported together, and written only if every one succeeded. See the module header.
  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${ENDPOINTS.length} endpoint(s) could not be captured; nothing was written:\n\n${failures.join('\n\n')}`);
  }
  return results;
}

// ------------------------------------------------------------------------------- the CLI

function flag(name, args) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(argv = process.argv.slice(2)) {
  const service = flag('--service', argv);
  const out = flag('--out', argv);
  const timeoutMs = flag('--timeout', argv) === undefined ? 30_000 : Number(flag('--timeout', argv));

  if (!service || !out) {
    console.error(
      'usage: node scripts/capture-index-snapshot.mjs --service <url> --out <dir>\n' +
        '  --service  the RUNNING index service (erc4626-vault-dapp), e.g. http://127.0.0.1:8787\n' +
        '  --out      the directory to write status/summary/events/price/candles into, e.g. public/api',
    );
    return 2;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`--timeout must be a positive number of milliseconds, got ${JSON.stringify(flag('--timeout', argv))}`);
    return 2;
  }

  const outDir = resolve(out);
  console.log(`capturing from ${service}`);
  console.log(`writing to     ${outDir}\n`);

  let results;
  try {
    results = await captureAll({ service, timeoutMs });
  } catch (cause) {
    console.error(`REFUSED: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    console.error('Nothing was written. A partial snapshot is worse than none: a missing field renders as a dash or an empty table, which reads like a working page with no data.');
    return 1;
  }

  mkdirSync(outDir, { recursive: true });
  // The path column is as wide as the longest path, so `/api/candles?bucket=60&limit=5000` does
  // not push its byte count out of the column every other line keeps it in.
  const pathWidth = Math.max(...ENDPOINTS.map((endpoint) => endpoint.path.length));
  for (const result of results) {
    writeFileSync(join(outDir, result.name), result.text, 'utf8');
    console.log(
      `OK   ${result.name.padEnd(8)} ${result.path.padEnd(pathWidth)} ${String(result.bytes).padStart(7)} bytes` +
        (result.detail === null ? '' : `  ${result.detail}`),
    );
  }

  console.log(`\n${results.length}/${ENDPOINTS.length} captured into ${outDir}`);
  console.log('Every body parsed as JSON and carried every field the pages read.');
  console.log(`status.note has one sentence appended: "${SNAPSHOT_NOTE.slice(0, 60)}..."`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      console.error(`capture failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}

export { main };
