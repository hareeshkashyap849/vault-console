# vault-console

A React/Next.js front end over an ERC-4626 vault: a read-only console, an indexed history, and a
wallet page that deposits and redeems.

| Route | What it is | Sources it reads | Touches a wallet |
|---|---|---|---|
| `/` | the landing page: what the vault is, and why there are two sources | the deployment record | no |
| `/vault` | **the console** — the vault from two independent sources at once | the chain **and** the index | no |
| `/history` | **the indexed history** — every indexed event, and the price series as a table | the index only | no |
| `/vault/manage` | **the wallet page** — connect, see your position, deposit, redeem | the chain, through the wallet | yes, to write |

Four routes and one app: the header links them, and the landing page says which one answers which
question. The two read-only pages differ in a way that is the point of both — the console holds two
sources side by side and never lets one stand in for the other, while the history has exactly one
source and says so, which is why it leads with the index's own lag instead of burying it.

## The console at `/vault`

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

## The indexed history at `/history`

One source, and the page says so before it says anything else. It shows what the console only
counts:

| Table | Rows | What makes it checkable |
|---|---|---|
| **Event tally** | one per event kind, then the sum of those rows | the per-kind counts are added up **on the page** and compared with the service's own total, so a disagreement is printed instead of hidden |
| **Recent events** | the newest events the index holds | each row carries its block and its transaction hash — the two facts that let a reader verify it against a block explorer |
| **Price series as a table** | the newest snapshots, newest first | the same numbers the console's chart draws, selectable and searchable, for a reader a chart does not serve |

Four things it is deliberate about, each of which is a defect it exists to avoid:

- **A missing decimals value is not a default.** Amounts arrive as raw base units, and formatting
  them needs the asset's and the share's decimals. When the service has not reported them the
  table shows the raw string and says why, rather than formatting with 6 and 18 and printing a
  confident wrong number.
- **`null` and `"0"` are different facts.** A `YieldReported` event carries one amount, not two,
  so its `shares` is `null`. "Zero shares moved" and "this event has no share figure" are different
  statements and the table does not conflate them.
- **The row order is enforced in the console.** The events endpoint documents "newest first"; this
  page sorts on `(blockNumber, logIndex)` anyway, because two events in one block differ only by
  log index and a sort on block number alone lets the table reorder itself between two requests.
- **It says how much of the history it is showing.** The events endpoint is capped, so the table
  states "the most recent N of M" — and if N ever exceeds M it says the two endpoints disagree
  rather than clamping the sentence into something tidy.

**Reading needs no wallet.** `/`, `/vault` and `/history` never ask for one.

## The wallet page at `/vault/manage`

Deposit and redeem, against a real wallet. Two of the ERC-4626 write paths — `deposit` and
`redeem` — and the page says so in those words rather than implying it offers all four.

Things it is deliberate about, each of which is a defect it exists to avoid:

- **The allowance is read from the chain every time it is needed**, never remembered. The
  sibling wallet dApp cached the approval state, the deposit consumed the allowance, and the
  next deposit went out with an allowance of zero and reverted. In React this is *easier* to
  get wrong, because a contract read hook is itself a cache.
- **Pre-flight before any wallet prompt**: wrong chain, over balance, and insufficient
  allowance are each reported with the real figures before the wallet is asked anything. An
  approval needs no balance, so approving first and failing at the deposit would spend gas to
  learn something that was free to read.
- **Transaction state is five-valued** — idle, pending, confirmed, failed, rejected — and a
  user cancellation is **not** a failure. EIP-1193 `4001` returns the form to idle and says
  nothing was sent.
- **Amounts are decimal strings in the UI and `bigint` in code**, and the "Max" control fills
  a decimal string. The dApp's Max button once filled a base-unit integer into a field that
  expected a decimal, and the transaction reverted after being mined.

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
npm test                              # 203 tests, 8 files
npm run typecheck                     # tsc --noEmit, must be exit 0
npm run check                         # tests + typecheck + single-source static check
node tools/check-single-source.mjs    # no second implementation of amount arithmetic
node tools/browser-assert.mjs         # live browser assertions; needs all three processes
node tools/capture-fixtures.mjs       # re-capture test/fixtures from the running service
node tools/scenario-report.mjs <file> --expect chain-down|index-down|index-caught-up|history-up|history-index-down|index-advanced
                                      # judge a saved page against a failure scenario
node tools/capture-scenarios.mjs      # produce every report in docs/evidence/ from the running servers
node tools/check-single-source.mjs --selftest   # prove the static checker CAN fail (5/5 rules fire)
```

`tools/browser-assert.mjs` drives a **real** browser through the kimi-webbridge daemon. It is
not part of `npm test`, because it needs three processes and a browser, and a test that can only
pass on one machine is worse than a test that lives where that is obvious.

**Watching a failure on purpose.** Point the console at a port nothing listens on and it
exercises exactly one failure path, without disturbing the shared services:

```powershell
$env:VAULT_RPC='http://127.0.0.1:8547'; $env:VAULT_API='http://127.0.0.1:8787'
npx next start --port 3123            # the chain is "down"; the index still works   -> scenarios 9
$env:VAULT_RPC='http://127.0.0.1:8545'; $env:VAULT_API='http://127.0.0.1:8788'
npx next start --port 3122            # the index is "down"; the chain still works  -> scenarios 10, 13
$env:VAULT_RPC='http://127.0.0.1:8545'; $env:VAULT_API='http://127.0.0.1:8787'
npx next start --port 3121            # both up                                     -> scenarios 11, 12
```

Three instances, then one command:

```powershell
node tools/capture-scenarios.mjs      # 5/5 scenarios captured and judged PASS
```

That is how `docs/evidence/scenario-9-chain-down.png` and `scenario-10-index-down.png` were
produced, and it is the reason those rows are recorded as passing rather than as
implemented-but-unverified. `capture-scenarios.mjs` runs the whole sequence — fetch, judge, write
the report — so the committed report is the output of the run that judged it. Scenario 11 is the
one exception to "one page, one report": freshness is a claim about a **change**, so it captures
the console, runs the indexer once, captures the same URL again, and judges the pair.

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

`--selftest` is that verification as a command rather than a memory. It writes a probe file built
to trip every rule, requires each one to fire, removes the probe in a `finally`, and exits
non-zero if a rule stays silent — because "no violations found" and "the rule does not work"
print exactly the same thing. **5/5 rules fire** (`docs/evidence/check-single-source-violation.txt`).

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
as arithmetic. It expands a zero range symmetrically, and the live assertion confirms **0 NaN
attributes**, with one candle body per candle (the counts themselves move as the index grows, so
the assertion is about the two relationships — `rects === groups` and `NaN === 0` — and not about
a number that would be stale a block later; the latest run is in `docs/evidence/browser-assert.txt`).

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
src/app/page.tsx              the landing page; what the vault is, and links to the tools
src/app/vault/page.tsx        the console: four panels, both sources fetched server-side,
                              failing independently
src/app/history/page.tsx      the indexed history: one source, three tables, and the count
                              each table is showing stated rather than implied
src/app/vault/manage/page.tsx the wallet page's server half: reads the deployment record and
                              refuses a chain the wallet config does not contain
src/app/providers.tsx         WagmiProvider + QueryClientProvider; staleTime 0 on purpose
src/app/layout.tsx            shell, nav, and metadata
src/components/Panels.tsx     Panel / Figure / Failure -- the three primitives every page uses,
                              extracted so the "every figure says its source" rule has one home
src/components/PriceChart.tsx   candlestick SVG; layout only, no arithmetic
src/components/VaultManager.tsx connect/disconnect, chain switching, the position panel
src/components/DepositForm.tsx  allowance read -> approve -> deposit, re-read after each receipt
src/components/RedeemForm.tsx   one transaction, no approval, balance re-read after confirmation
src/components/WalletPanels.tsx presentation only: panels, figures, tx status, the amount field
src/lib/chartGeometry.ts      the scale, the flat-series guard, the doji floor -- pure, tested
src/lib/format.ts             THE single implementation point for amounts
src/lib/history.ts            the history view's logic: row order, the tally reconciliation, the
                              decimals-or-nothing decision, the truncation label -- pure, tested
src/lib/wagmi.ts              the wallet config: chains, injected(), no connector dependency
src/lib/vaultActions.ts       the pre-flight decisions, extracted so they are testable without
                              a wallet -- the same move chartGeometry.ts makes for the chart
src/lib/txState.ts            the five-valued transaction state and the mapping into it
src/lib/endpoints.ts          server uses absolute URLs, browser uses the same-origin rewrites
src/lib/api.ts                typed client; classifies unreachable / refused / malformed-URL
src/lib/chain.ts              live reads through viem; the vault ABI lives here and only here
src/lib/deployment.ts         reads the vault address from the deploy record, never a copy
src/lib/types.ts              every amount typed as a string
test/                         203 tests across 8 files, incl. fixtures captured from the service
tools/                        assert + capture + scenarios + static check (with --selftest) + runner
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
- **The wallet page's write path has never been used against a real wallet.** This is the
  largest gap and it is worth stating first. `deposit` and `redeem` are implemented; the
  decisions behind them are proven in unit tests (`test/wallet-flow.test.ts`,
  `test/wallet-amounts.test.ts`), and the page renders and is asserted in a real browser. But
  **no transaction has been sent from this page.** MetaMask cannot be driven by a program — it
  shows a popup and a person clicks Approve — so these four rows in
  `BROWSER-TEST-PLAN.md` §5 remain `not run`:

  | Not proven | What would prove it |
  |---|---|
  | a deposit really happens: transaction hash, block, `Deposit` event, `totalAssets` before/after | a real wallet on chain 31337, funded, approving |
  | the second deposit does not re-prompt for approval | the same, twice in one session |
  | a cancellation is neutral in a real wallet | rejecting at the prompt |
  | the wrong chain disables the control in a real wallet | the wallet on another chain |

  The page's **connected** state has also never rendered live: the browser available for
  testing had no account authorised for the site, so only the no-wallet branch was exercised.
  Both branches compile and typecheck, and the no-wallet branch is asserted.
- **The console's half of the failure taxonomy is measured; the wallet half is not.**
  `FRONTEND-SPEC.md` §3 has all 11 classes with a verdict per row. RPC unreachable, API
  unreachable and stale data are implemented and measured against the running services —
  `docs/evidence/scenario-9-*.txt`, `scenario-10-*.txt`, `scenario-11-*.txt`, each with a
  screenshot — and the history page's own failure path is measured the same way
  (`scenario-13-history-index-down.txt`: with the index gone it renders **no** tables at all,
  rather than substituting the chain's figures). The wallet classes were `N/A` while this was a
  read-only page; that verdict is now out of date for `/vault/manage` and the rows say so, with
  their real status.
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
  `SUPPORT-AND-SIGNOFF.md` §3 records six rows: five untested, one not applicable.
- **Only one browser was tested.** Chrome, driven through kimi-webbridge. Firefox, Safari and
  narrow viewports are listed as untested in `SUPPORT-AND-SIGNOFF.md` §1, not as supported.
- **The console event log is not captured directly.** kimi-webbridge evaluates in the page but
  cannot replay console output that already happened, so the browser assertions check the
  rendered text for error and hydration strings instead. An uncaught exception that leaves no
  textual trace would not be caught.

---

## The verification documents, and where they come from

The seven `F1`–`F5` documents at the repository root are the working record behind the code
above — the requirements each panel must satisfy, the invariants, the evidence map, the
failure-scenario matrix and its results:

| Document | Phase |
|---|---|
| `FRONTEND-SPEC.md` | F1 — user-visible behaviour and the failure classes |
| `STATE-OWNERSHIP.md`, `INVARIANTS.md`, `EVIDENCE-MAP.md`, `TEST-DOUBLES.md` | F2 — correctness designed up front, plus the F3 single-source-of-truth check |
| `BROWSER-TEST-PLAN.md` | F4 — four test layers, and the failure scenarios that were really run |
| `SUPPORT-AND-SIGNOFF.md` | F5 — browser matrix, build reproducibility, accessibility, sign-off |

**On their provenance, stated plainly.** They follow a repeatable delivery process with
numbered phases, gates and required artefacts: a software-delivery blueprint, a frontend
correctness guideline, an environment capability list, and a per-project template. Those
process documents are not part of this repository, so the seven files refer to them by name
and section rather than by path, and every such reference has been rewritten that way. What
is in this repository is the filled-in result, not the skeleton it was filled in from.

**They are honest documents, which is the point of publishing them.** Several rows say
`Untested`, `Not run`, or `N/A + reason`; the invariants ledger has a section recording
invariants that were **falsified** during development, and the browser plan explains why a
gate was first written as not-passed and what changed it. Those are the parts worth reading.
If every row said "passed", the document would be worth nothing.
