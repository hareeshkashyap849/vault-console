# Plan: give the published `/history` page real data, without a hosted service

> **These repositories moved on 2026-09-19, and the URLs below were not rewritten.** They lived at
> `hareeshkashyap849` and now live at `wuzilin-web3`; the old *repository* URLs still redirect, but
> GitHub Pages does not redirect, so the two published sites now answer at
> <https://wuzilin-web3.github.io/vault-console/> and <https://wuzilin-web3.github.io/erc4626-vault/>.
> Every `hareeshkashyap849` URL in this file is the address a measurement was taken at, and it is left
> as written because rewriting it would make the record say something that was never true.

**Status: steps 1-3 IMPLEMENTED and step 4 VERIFIED LOCALLY; step 5 (publish and check the live
URL) NOT DONE.** Written 2026-09-17, after the static export was published and the page was found
to be the one hole in it. Implemented the same day; the section "What was built, and what was
measured" at the end records the evidence and the two places the implementation deviated from this
plan.

> **Amendment, same day: there are FIVE captured paths now, and `/api/candles` is one of them.**
> The first implementation captured four and left candles out, which made the published `/vault`
> contradict itself (its `Then` panel reported a failed index read under a label saying the figures
> were a snapshot, next to a fully populated `Index health` panel). That is fixed: the capture
> requests `/api/candles?bucket=60&limit=5000`, verifies it with the same `checkBody` machinery the
> other four go through, writes `public/api/candles`, and
> `web3-development-execute/projects/vault-console/tools/check-published-snapshot.mjs` asserts the
> path instead of printing it as a known gap. Deviation (1) below is kept as the record of what was
> wrong and how it was measured, and is marked **FIXED** rather than deleted -- it is the reason the
> fifth entry exists. Nothing else in this plan changed.

## The problem, exactly

The published console is a static export. `/history` reads **one** source -- the index service --
and a static host runs no process, so the page says *this page has no route to the index service*
and shows nothing. That sentence is true, and it is still a page that shows nothing.

The index service itself is not the problem: its output is already committed and current
(`erc4626-vault-dapp`, `data/vault.sqlite`: chain 84532, start block 46,919,124, the real `Deposit`
at 46,919,498, one `vault_snapshots` row per indexed block). What is missing is a way for a static
page to read it.

## The approach, and the one constraint that decides it

Publish a **snapshot of the index service's own answers** as files at the paths the console already
requests. The console's client is then unchanged: it asks for `api/status`, `api/summary`,
`api/events`, `api/price`, `api/candles`, and the static host answers with the files. Same paths,
same shapes, no second code path, no new failure mode.

**The constraint: the snapshot must be produced BY THE SERVICE, not by a script that reimplements
it.** It is tempting to read the SQLite in the Pages workflow and write the JSON directly. That
would work and it would be wrong: `src/api/price.ts` in the service owns the share-price formula,
and the console's central design decision is that it *reads that result rather than computing it*
(`README.md`, `/vault`'s price panel). A second implementation of the formula in a different
repository would be a second source of truth for the vault's most error-prone number, and the two
would agree until one of them was edited -- which is the failure this project keeps writing down.

So the workflow runs the service:

```yaml
- uses: actions/checkout@v4                      # the console
- run: git clone --depth 1 https://github.com/hareeshkashyap849/erc4626-vault-dapp /tmp/index
- name: Take a snapshot from the service itself
  run: |
    cd /tmp/index
    DATABASE_PATH=data/vault.sqlite PORT=8787 \        # the committed snapshot
      DEPLOYMENT_RECORD=deployments/base-sepolia.json \ # fetched by that repo's own workflow, or cloned
      node --experimental-strip-types src/api/cli.ts &
    # wait for /api/status, then capture each endpoint VERBATIM
    node "$GITHUB_WORKSPACE/scripts/capture-index-snapshot.mjs" \
      --service http://127.0.0.1:8787 \
      --out "$GITHUB_WORKSPACE/public/api"
```

`web3-development-execute/projects/vault-console/scripts/capture-index-snapshot.mjs` does one thing: GET five endpoints, write the bodies to
`public/api/status`, `public/api/summary`, `public/api/events`, `public/api/price`,
`public/api/candles`, and **refuse to
report success unless each body parses and the required fields are present**. It never computes
anything. (A file named `status` with no extension is served at `/api/status` -- the same trick
`public/api/config` already uses.)

## The honesty problem, which is the real work

A snapshot is frozen data, and a page that presents frozen figures as current is the exact bug this
console was built to avoid. Three changes, all small:

1. **The config says what it is.** `RuntimeConfig` gains `indexSnapshot: boolean`. The static build
   sets it true; development leaves it false. The generator
   (`web3-development-execute/projects/vault-console/scripts/build-runtime-config.mjs`) writes it, so it cannot drift from the build that produced
   it.
2. **The panel says what it is.** With `indexSnapshot`, the `Then` panel's source label becomes
   *read from a snapshot of the index service, taken when this page was published* instead of *read
   from the index service, which lags by design*. A reader must not have to infer this from a
   timestamp.
3. **The staleness must stay visible, not be reset.** The service computes `staleSeconds` from its
   own `updatedAt`. Captured verbatim, a snapshot taken at build time will show an age that grows
   as the page sits there -- which is true, and is better than a figure that always says "0s ago".
   The snapshot must NOT rewrite that field. It should append one sentence to `status.note`
   saying the figures are a snapshot, because the page renders that note verbatim.

The `Lag` figure deserves a second look during implementation: `lagBlocks` is measured against the
chain head the indexer last saw, so in a snapshot it is frozen at the build. That is correct for the
snapshot and should be labelled with the snapshot's time, not with "now".

## What this does NOT fix, and must not pretend to

- The figures are **as of the last publish**, not live. Anything that needs live index data (a page
  that follows the chain) still needs a hosted service. This is a portfolio artifact, and the page
  will say so.
- If the sibling repository's workflow has never actually run, the snapshot is the state as of the
  commits in this workspace. **Whether that cron fires is still unverified** -- see the README's
  note in `erc4626-vault-dapp`. The captured `updatedAt` will make that visible rather than hiding
  it, which is an improvement.
- `/history` will show the events and price series that exist in the committed snapshot; today that
  is one real `Deposit` and 1,027 price rows. It is real data, and it is a small amount of real
  data. The scale evidence lives in `base-swap-indexer` (200,000 blocks, 96,980 swaps), not here.

## Order of work

1. `web3-development-execute/projects/vault-console/scripts/capture-index-snapshot.mjs` + a unit test for its refusal path (a malformed or partial
   body must fail the build, not publish a half-valid snapshot).
2. `indexSnapshot` through `runtimeConfig.ts` -> `build-runtime-config.mjs` -> the `Then` panel's
   label in `src/app/vault/page.tsx` and `/history`'s header.
3. The workflow step, with the service started from the cloned sibling repository.
4. Verify locally first: run the service against the committed SQLite, capture into `public/api`,
   build the export, serve it as plain files, and check in a real browser that `/history` shows the
   `Deposit` row with its transaction hash and that the panel says it is a snapshot.
5. Then publish and check the same three things on the live URL.

## Why this is worth doing rather than hosting the service

Hosting the service would make `/history` live, and it needs a paid or account-bound host that
keeps a process alive -- which is the constraint the whole design already worked around for the
indexer (`erc4626-vault-dapp/.github/workflows/index.yml` explains the same reasoning). A snapshot
costs one workflow step, needs no account, and states its own limits. If the project ever gets a
host, `indexApiUrl` becomes a URL again and `indexSnapshot` becomes false: the console supports both
without either being a special case.

## What was built, and what was measured

Steps 1-4 of the order of work above are done. The files:

| File | What it does |
|---|---|
| `web3-development-execute/projects/vault-console/scripts/capture-index-snapshot.mjs` | GETs five endpoints, verifies every required field, appends one sentence to `status.note`, writes the bodies verbatim. Refuses and writes NOTHING if any body fails. |
| `web3-development-execute/projects/vault-console/test/capture-index-snapshot.test.ts` | The refusal paths, against a real HTTP server and against the committed fixtures -- including the candle body's (a missing candle field, a `candles` key renamed, a JSON number where a decimal string belongs, an envelope whose counts disagree with its array) and the one acceptance case that keeps the checker from being stricter than the service. |
| `web3-development-execute/projects/vault-console/scripts/capture-index-snapshot.d.mts` | The script's types, so the test that imports it is typechecked (`allowJs: false` makes a `.mjs` invisible to `tsc`). |
| `web3-development-execute/projects/vault-console/test/runtime-config.test.ts` | The loader had no test at all; `indexSnapshot` is validated there and the rejections are pinned. |
| `src/lib/runtimeConfig.ts`, `web3-development-execute/projects/vault-console/scripts/build-runtime-config.mjs`, `src/app/vault/page.tsx`, `src/app/history/page.tsx` | The flag, its generator flag (`--snapshot true`), and the two labels. |
| `.github/workflows/pages.yml` | Clones `erc4626-vault-dapp` and `erc4626-vault`, starts the service against `data/vault.sqlite`, captures into `public/api/`, generates the config with `--index / --snapshot true`, builds, then serves `out/` and checks the captured paths over HTTP. |
| `web3-development-execute/projects/vault-console/tools/check-published-snapshot.mjs` | Fetches the five paths plus `/api/config` from a SERVED export and verifies them, reusing `checkBody` from the capture script so there is no second definition of a valid snapshot. The candle path is ASSERTED, not printed as a known gap: it also requires the chart to have something to draw (a non-empty candle array, 60-second buckets) and that the candle file and the price file start at the same block, so a file copied from an older run fails even though it satisfies the schema. |

**Measured locally (2026-09-17)**, service on `127.0.0.1:8799` against the committed
`data/vault.sqlite`, export served by `toolchain/serve-static.mjs` on `127.0.0.1:8123`:

| Path | Served | Bodies |
|---|---|---|
| `/api/status` | 200 | chain 84532, `lastIndexedBlock` 46920159, `lagBlocks` 0, 1 event, 1027 snapshots, `updatedAt` `2026-09-17T01:30:48.538Z`, `staleSeconds` 46107 |
| `/api/summary` | 200 | `kinds` (Deposit count 1 / assets `20000000`), `totalEvents` 1 |
| `/api/events?limit=50` | 200 | one row: block **46919498**, logIndex 69, `Deposit`, txHash `0x3ec3b305ec60650800f5bca9c7e58c8f428e757956f4c60666c7bed47b5ffbc2` |
| `/api/price?limit=25` | 200 | 25 points, `decimals` 6/18, last block 46920159, price `1` |
| `/api/config` | 200 | chain 84532, vault `0x7941438ee07bea4469ccd4bec583e9fb24037f35`, `indexApiUrl` `/`, **`indexSnapshot` true** |

`web3-development-execute/projects/vault-console/tools/check-published-snapshot.mjs --base http://127.0.0.1:8123`
→ **all 31 checks passed**, exit 0. Against a port with nothing behind it the same tool exits 1 with
five named failures, so it can be seen to fail.

### Amendment: the fifth path, captured and measured

Same machine, same procedure as above (service on `127.0.0.1:8799` against the committed
`data/vault.sqlite`, export built with `STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH= NEXT_SKIP_TYPECHECK=1
NEXT_WORKER_THREADS=1`, served by `toolchain/serve-static.mjs` on `127.0.0.1:8123`), run after the
candles change. The capture reported all five bodies and their sizes:

```
OK   status   /api/status                          1280 bytes
OK   summary  /api/summary                          560 bytes
OK   events   /api/events?limit=50                  553 bytes
OK   price    /api/price?limit=25                  7775 bytes
OK   candles  /api/candles?bucket=60&limit=5000    7757 bytes  28 candles over 811 blocks

5/5 captured into .../vault-console/public/api
```

| Path | Served | Body |
|---|---|---|
| `/api/status` | 200 | chain 84532, `lastIndexedBlock` 46920308, `lagBlocks` 23308, 1 event, 1176 snapshots, `updatedAt` `2026-09-17T14:32:38.747Z`, `staleSeconds` 136 (as captured) |
| `/api/summary` | 200 | `kinds` Deposit count 1 / assets `20000000`, `totalEvents` 1 |
| `/api/events?limit=50` | 200 | the same one row: block **46919498**, logIndex 69, `Deposit`, txHash `0x3ec3b305ec60650800f5bca9c7e58c8f428e757956f4c60666c7bed47b5ffbc2` |
| `/api/price?limit=25` | 200 | 25 points, `decimals` 6/18, `seriesFromBlock` 46919133, last block 46920308, price `1` |
| **`/api/candles?bucket=60&limit=5000`** | **200** | **28 candles**, `bucketSeconds` 60, `pointsPulled` 1176, `pointsSkipped` 365, `seriesFromBlock` 46919133; first candle 28 blocks (46919498-46919525), last 3 (46920306-46920308); every OHLC value is `1` |
| `/api/config` | 200 | chain 84532, vault `0x7941438ee07bea4469ccd4bec583e9fb24037f35`, `indexApiUrl` `/`, **`indexSnapshot` true** |

`web3-development-execute/projects/vault-console/tools/check-published-snapshot.mjs --base http://127.0.0.1:8123`
-> **all 37 checks passed**, exit 0 -- up from 31, and all six of the new ones are the candle path's:
three from the loop every endpoint already goes through (`answers 200`, `is JSON`, `carries every
field the pages read`) and the three facts below it. The tool's own count is the pass/fail count, so
a 404 on this path now fails it instead of printing a note. The three candle facts it printed:

```
  ok    the candle series the chart draws is not empty -- 28 candle(s), 811 block(s)
  ok    the candles are bucketed by the 60 seconds the panel labels its axis with -- 60s
  ok    the candle file and the price file start at the same block -- one series, one snapshot -- candles=46919133 price=46919133
```

**The measurement this whole change was for**, taken from the served export rather than from the
service (`src/lib/api.ts`'s `candles(60, 5000)` builds exactly this URL):

| Request to `http://127.0.0.1:8123` | Result |
|---|---|
| `/api/candles?bucket=60&limit=5000` | **200**, 7757 bytes, JSON, `candles` array of **28** entries (before this change: **404**) |
| `/api/candles` (no query) | 200, the same 7757 bytes -- a static host serves the file whatever the query |
| `/api/price?limit=25` | 200, 7775 bytes, JSON (the control that was already working) |
| `/api/not-captured` | **404** -- the control that shows a 200 above means the file exists, not that this host answers everything with 200 |

`/vault`'s `Then` panel now has a body to read on the published site, so it draws the chart instead
of printing *The index service could not be read* under a label saying the figures are a snapshot.
Not measured here: the rendered panel in a browser (`BROWSER-TEST-PLAN.md` is where that layer
lives, and it was not re-run for this change) -- what was measured is the served body the panel
reads, over HTTP, at the exact path and query it sends.

### Deviations from this plan, recorded rather than smoothed over

1. **FIXED (same day): `/api/candles` is captured, so `/vault`'s `Then` panel has a chart on the
   published site.** As first implemented, this plan's step 1 listed four endpoints and candles was
   not one of them, so the capture wrote four files -- and `/vault` asks for
   `/api/candles?bucket=60&limit=5000`, which a static host answered with a 404 (measured: the served
   export returned 404 for that path while the four captured paths returned 200). The `Then` panel
   therefore showed *The index service could not be read* with the label saying the figures come from
   a snapshot, next to an `Index health` panel that was fully populated -- the page contradicted
   itself in a way this plan's own headline claim ("the console's client is then unchanged") was meant
   to prevent. **`/history`, the page this plan is about, was fully populated throughout, which is why
   this was a deviation rather than a failure of the change.**

   **What fixed it**, exactly as described in the first version of this note: a fifth `ENDPOINTS`
   entry plus a `checkCandles` schema in
   `web3-development-execute/projects/vault-console/scripts/capture-index-snapshot.mjs` (plus
   `checkCandle` for one row and `isFormattedDecimalString` for the OHLC values, which the service
   formats with thousands grouping -- a bare-decimal rule would have refused a real body the first
   time the price passed 1000). The path is asserted rather than merely fetched by
   `web3-development-execute/projects/vault-console/tools/check-published-snapshot.mjs`, and the
   refusal paths are pinned in
   `web3-development-execute/projects/vault-console/test/capture-index-snapshot.test.ts`. The
   measurement after the fix is the amendment section above: served 200 / JSON / 28 candles, and the
   checker's count went 31 -> 37.

   It was NOT added in the first pass because the plan names four paths and the brief said the
   document wins, and because adding a fifth file was a decision about this plan rather than a detail
   of implementing it. That decision has now been taken, in the direction the plan's own "unchanged
   client" claim required. The paragraph above is kept rather than deleted: it is the record of what
   the page did while the path was missing, and it is why the fifth entry exists.

2. **`Lag` is still labelled "indexer last ran — ago", and the plan asked for it to be labelled with
   the snapshot's time.** The plan says the `Lag` figure "should be labelled with the snapshot's time,
   not with 'now'". With the append to `status.note` -- which says the figures are a snapshot and that
   the age above is measured from the snapshot -- that is already stated on both pages, once, in the
   service's own note area. Changing the `Figure` hint as well would have added a second, paraphrased
   statement of the same fact without changing the number. This is a judgement call and it is
   reversible in one line if the paraphrase is wanted.

### Not done, and it is the last step of this plan

**Step 5: publish and check the live URL.** Nothing was committed or pushed, so the Pages workflow
above has never run -- it is written and unexercised, and the commands inside it were checked
locally one at a time (the capture, the config generation, the export, `check-published-snapshot.mjs`
over HTTP) but the YAML has not. Two things in it can only be confirmed by a real run: that
`git clone` reaches both sibling repositories, and that a GitHub runner's `next build` behaves as
the local one did.
