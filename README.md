# vault-console

A read-only React/Next.js console over an ERC-4626 vault.

It shows the vault from **two independent sources at once** and labels every figure with the
one it came from:

| Panel | Source | Answers |
|---|---|---|
| **Now** | the chain, read on this request | what is true right now, exactly |
| **Then** | the index service | what was true at each past block |
| **Two sources** | both | the comparison, and why neither alone is enough |
| **Index health** | the index service's own report | whether the history can be trusted |

The panel pairing is the point. A chain-only screen makes the history invisible; an
index-only screen shows figures that are stale **without saying so**. They fail differently
too — if the chain is down the page must not present the index's old numbers as current, and
if the index is down the current numbers are still exact. So both are fetched, each failure
is caught separately, and each panel carries its own source and its own error.

**Read-only.** No wallet is requested, no key is used, and nothing here writes to a chain.

---

## Running it

Three processes. The console is the third.

```powershell
# 1. a chain with the vault deployed (in ../erc4626-vault)
anvil --port 8545 --state deployments/anvil-state.json

# 2. the index service (in ../erc4626-vault-dapp)
node --experimental-strip-types src/indexer/cli.ts     # catch up
node --experimental-strip-types src/api/cli.ts         # serve on :8787

# 3. this console
npm run dev                                            # http://localhost:3000
```

`VAULT_API` (default `http://127.0.0.1:8787`) and `VAULT_RPC` (default
`http://127.0.0.1:8545`) point it at services running elsewhere. `VAULT_DEPLOYMENT` overrides
where the deployment record is read from.

### Checks

```powershell
npm test                              # 107 tests, 5 files
npm run typecheck                     # tsc --noEmit, must be exit 0
npm run check                         # tests + typecheck + single-source static check
node tools/check-single-source.mjs    # no second implementation of amount arithmetic
node tools/browser-assert.mjs         # live browser assertions; needs all three processes
node tools/capture-fixtures.mjs       # re-capture test/fixtures from the running service
node tools/scenario-report.mjs <file> --expect chain-down|index-down|index-caught-up
                                      # judge a saved page against a failure scenario
```

`tools/browser-assert.mjs` drives a **real** browser through the kimi-webbridge daemon. It is
not part of `npm test`, because it needs three processes and a browser, and a test that can
only pass on one machine is worse than a test that lives where that is obvious.

**Watching a failure on purpose.** Point the console at a port nothing listens on and it
exercises exactly one failure path, without disturbing the shared services:

```powershell
$env:VAULT_RPC='http://127.0.0.1:8547'; $env:VAULT_API='http://127.0.0.1:8787'
npx next start --port 3110            # the chain is "down"; the index still works
$env:VAULT_RPC='http://127.0.0.1:8545'; $env:VAULT_API='http://127.0.0.1:8788'
npx next start --port 3111            # the index is "down"; the chain still works
```

That is how `docs/evidence/scenario-9-chain-down.png` and `scenario-10-index-down.png` were
produced, and it is the reason those two rows are recorded as passing rather than as
implemented-but-unverified.

---

## What this repository is careful about

### Amounts are never JavaScript numbers

`totalSupply` for this vault is `859021905704231281673` base units. As a double that becomes
`859021905704231280000`-ish — a wrong number that prints as a plausible one, with no error and
no warning. So amounts are strings end to end, arithmetic is `BigInt`, and there is exactly
**one** module that knows about decimals: `src/lib/format.ts`. Everything else calls it.

`tools/check-single-source.mjs` enforces that with a program rather than a habit. It scans
every file under `src/` for the ways a second implementation appears — `10 ** n`, `Number()`
on an amount, `toFixed`, `BigInt` division, large literals — and exits non-zero if it finds
one outside the allowed module. It was verified against a deliberately bad file: **7
violations across all 5 rules, exit 1**; with the file removed, exit 0.

### The service answers in TWO amount formats, and they are not interchangeable

This is the mistake the first version of this repository made, and it is worth stating
plainly because it looked correct:

```
RAW BASE UNITS    totalAssets, totalSupply, event.assets   ->  displayBaseUnits(v, decimals)
DECIMAL STRINGS   price, candle OHLC values                ->  displayDecimal(v)
```

`src/api/price.ts` in the index service says `totalAssets` and `totalSupply` are *"RAW uint256
values in BASE UNITS, exactly as"* the chain holds them, while `price` is *"formatted with the
asset decimals"*.

The first version ran both through one formatter, so the page printed `totalSupply` as the raw
integer `859,021,905,704,231,281,673` — a base-unit integer, which is exactly the thing this
interface is not allowed to show. It looked fine for `totalAssets`, because a 6-decimal asset
makes `944924100` read as an ordinary number rather than as a raw count. The two formatters now
have different names so the choice is visible at every call site, and
`tools/browser-assert.mjs` asserts the raw uint256 string **does not appear** on the rendered
page.

### A flat series must not draw as a blank panel

This vault's price is `1.1` at every indexed block: each yield report raises `totalAssets`
proportionally and mints no shares. On such a series `max === min`, so `(v - min) / (max - min)`
is `0/0`, every y coordinate is NaN, and **SVG draws nothing** — no error, no warning, just an
empty box that reads as "there is no history" when there are 169 candles of it.

The guard is in `src/lib/chartGeometry.ts`, promoted out of the component so it can be tested
as arithmetic. It expands a zero range symmetrically, and the live assertion confirms
**0 NaN attributes across 172 lines and 169 bodies**.

### Types are checked against the running service, not against the author's memory

`SummaryResponse` originally declared `counts` and `totals`. The service sends `kinds` and
`totalEvents`. `tsc` was happy, because a wrong type is still a type — it just describes
something nobody sends. Nothing called it, so there was no runtime disagreement either.

`test/contract.test.ts` now asserts the service's real response shape field by field against
fixtures **captured verbatim** by `tools/capture-fixtures.mjs`, and `test/contract-live.test.ts`
re-derives the same expectations from the service as it is right now. One of those tests
reconciles the index's event totals against the chain's `totalAssets()`:

```
deposits - withdrawals + yield reported = totalAssets
1200124097 - 315199997 + 50000000       = 934924100
```

The naive version of that check — summing the per-kind totals — gives `1565324094` and is
**wrong**, because `YieldReported` carries an amount that was already in the vault rather than
an addition to it. That assertion is pinned so the trap cannot be walked into twice.

---

## Layout

```
src/app/page.tsx              the four panels; both sources fetched server-side, failing independently
src/app/layout.tsx            shell and metadata
src/components/PriceChart.tsx   candlestick SVG; layout only, no arithmetic
src/lib/chartGeometry.ts      the scale, the flat-series guard, the doji floor -- pure, tested
src/lib/format.ts             THE single implementation point for amounts
src/lib/endpoints.ts          server uses absolute URLs, browser uses the same-origin rewrites
src/lib/api.ts                typed client; classifies unreachable / refused / malformed-URL
src/lib/chain.ts              live reads through viem
src/lib/deployment.ts         reads the vault address from the deploy record, never a copy
src/lib/types.ts              every amount typed as a string
test/                         104 tests incl. fixtures captured from the service
tools/                        assert + capture + static check + test runner
docs/                         the F1-F5 evidence trail
```

`next.config.ts` rewrites `/api/*` and `/rpc` to the two services so **browser** code stays
same-origin. **Server** code uses absolute URLs, because a relative URL has no origin to
resolve against in Node and `fetch('/api/status')` throws
`TypeError: Failed to parse URL` — which is what made this page return HTTP 500 in its first
version. `src/lib/endpoints.ts` holds that rule and the reason.

---

## Limits, stated rather than implied

- **Not deployed anywhere public.** It runs against a local Anvil chain. No hosted instance,
  so nothing here is evidence about a production environment.
- **Read-only, so most of the write-failure taxonomy does not apply.**
  `前端规格.md` §3 has all 11 classes with an explicit verdict per row; 8 are marked
  `不适用` with the reason. The three that do apply — RPC unreachable, API unreachable, stale
  data — are **implemented and measured**: `docs/evidence/scenario-9-*.txt`,
  `scenario-10-*.txt`, `scenario-11-*.txt`, each with a screenshot. The wallet classes are
  covered by the sibling `erc4626-vault` dApp, not here.
- **The fixtures are one snapshot of one vault.** Every candle is at price `1.1`. The chart's
  flat-series path is therefore the well-exercised one; a moving price is covered by unit
  tests on synthetic candles, not by live data.
- **The chart is SVG, not a charting library.** No zoom, no pan, no crosshair, no time-range
  control. That was a deliberate trade — the arithmetic matters more than the interaction —
  but it is a real gap against a trading-style UI.
- **`lagBlocks` is measured against the head the indexer last saw**, not the chain now, and the
  service says so. The page repeats that note rather than smoothing it over.
- **No accessibility audit.** Semantic landmarks and `role="img"` with `aria-label` are
  present and the chart carries its figures in text, but no screen reader was run against it.
  `支持矩阵与验收.md` §3 records this as untested rather than passing.
- **Only one browser was tested.** Chrome, driven through kimi-webbridge. Firefox, Safari and
  narrow viewports are listed as untested in `支持矩阵与验收.md` §1, not as supported.
- **The console event log is not captured directly.** kimi-webbridge evaluates in the page but
  cannot replay console output that already happened, so the browser assertions check the
  rendered text for error and hydration strings instead. An uncaught exception that leaves no
  textual trace would not be caught.
