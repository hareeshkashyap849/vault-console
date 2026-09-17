# State ownership (path B · F2 / F3) — vault-console

> **One of the F2 deliverables, and at the same time the object of the G-F3 "no second source of truth" check.**
> The G-F2 gate's criterion: **"who owns each state" has an answer, item by item** (the delivery blueprint's frontend path (F1-F5), §12.2).
>
> The cause of this file is a structure that is bound to fail: **the same fact exists in two places, one of
> which will inevitably go stale, and you wrote no synchronisation code** (the frontend correctness guideline, §Structure 1).
>
> **This project's shape differs from what the template assumes; stated up front**: the template is aimed at a
> **writable dApp**, with allowance, the four transaction states and a local cache. This interface is
> **read-only**, so:
> - no allowance, no transaction state, no "blocked before sending";
> - but it has **one stricter requirement**: `staleTime: 0` + `refetchOnWindowFocus` on every read,
>   that is, **the figures on screen are not cached under any circumstance**. This is not a choice, it is a
>   precondition of the page being correct — a cached console would present a number that was true a minute
>   ago as true now.
>
> **The mechanism behind that requirement changed on 2026-09-17, and this file records the change in
> place rather than silently**: the pages are client components in a static export now, so there is no
> server to re-read per request and no `dynamic = 'force-dynamic'` to declare. `staleTime: 0` (set once,
> globally, in `src/app/providers.tsx`) is the same freshness decision expressed where the reads happen.
> `docs/STATIC-EXPORT-MIGRATION.md` is the authoritative record; where a row below cites evidence that
> only existed under the old mechanism, it says so instead of reading as evidence for the current code.
>
> Every "N/A" in the row-by-row table comes with a reason; N/A ≠ left blank.

---

## 0. Three hard rules (checked one by one against this project)

1. **Do not cache on-chain state.** Every figure on screen is fetched from the chain or the API each time.
   An old value that genuinely must stay in memory **must have an explicit expiry (TTL)**, and the interface
   must make it visible that it may be stale.

   **What this project does is harder than a "TTL"**: there is **no TTL at all**, because nothing is kept.
   - **every read on all three read-only pages** — `src/app/page.tsx`, `src/app/vault/page.tsx` and
     `src/app/history/page.tsx` — goes through a TanStack Query whose `staleTime` is `0`. The value is set
     **once, globally**, in the `QueryClient`'s `defaultOptions` in `src/app/providers.tsx`, so a page
     cannot forget it and a new page inherits it by construction. `staleTime: 0` means what `no-store`
     meant: a figure on screen was read for the render that shows it;
   - the same `defaultOptions` sets `refetchOnWindowFocus: true`, so a value read in another tab cannot be
     what the form decides on, and `retry: false`, so a failing read is reported rather than retried into a
     slow one. **There is no `refetchInterval`**: no timed polling exists, which is the point of §0 rule 3;
   - `LIVE = { cache: 'no-store' }` in `src/lib/api.ts` is applied to **every single** index-service `fetch`;
     `loadRuntimeConfig` sends `cache: 'no-store'` for `api/config` as well, and viem's browser transport
     issues JSON-RPC `POST`s, which an HTTP cache does not serve;
   - the pages hold **no figure-shaped component state**: nothing but the queries above. Reload = browser
     reload = every query re-issues its read;
   - the only assertion over any of this is `test/api.test.ts` →
     `sends no-store, because a cached console shows stale figures as current`. It is a **unit test
     against a replaced `fetch`**: it asserts the header is sent, not that anything respects it.

   **What was measured, and is now retired.** Scenario 11 captured the page, advanced the index, captured
   the same URL again, and required `Indexed to block`, `Lag` and `indexer last ran` to have changed
   (`docs/evidence/scenario-11-freshness.txt`). That proved the **server** re-read per request, which is
   what `dynamic = 'force-dynamic'` did. The pages are client components in a static export now: there is no
   server to re-read, the `force-dynamic` export is gone, and a static host serves the same bytes to every
   reader. **So the file is kept as the record of what was measured, and it is not evidence for the current
   code.** The replacement is weaker than what it replaced, and saying so is the point: a unit test that the
   `no-store` header is sent, plus a structural argument (no server, no proxy, no cache layer on the path,
   JSON-RPC `POST`s are not cacheable) — **not** a measurement against the running system. Re-measuring it
   means loading the published page twice and capturing the RPC requests each load issues; until that is
   done the row in `EVIDENCE-MAP.md` is marked unproven, and `docs/STATIC-EXPORT-MIGRATION.md` records it.

   **Why there is no timed polling**: the first version of this project (the candlestick chart in the
   sibling project `erc4626-vault`) did use a 15-second `setInterval` poll, and rule 3 of §0 of the
   guideline records the real defect of exactly that structure (the read timer and the countdown timer
   starving each other). The console is a page **for looking at the current state**, so a read on load
   plus a re-read on window focus is enough, and there is **no `refetchInterval` that a countdown could
   starve** — the hazard is avoided by not having the structure, not by scheduling it carefully.

2. **A manual refresh control must perform one real re-read.**
   **N/A + reason**: this interface has **no** "refresh" button — refreshing is the browser's own reload,
   which necessarily issues a new HTTP request, so there is no entry point at all for the defect
   "the button resets the timer without re-reading".
   **Where it is covered**: `erc4626-vault` (the wallet dApp) has a real refresh control, and it carries the
   matching assertion that "a manual refresh must produce one new read".

3. **A timed refresh must not be starved by its own UI countdown.**
   **N/A + reason**: this interface has **no timer at all** (see rule 1). No timer, no starvation.
   **Where it is covered**: the candlestick chart in `erc4626-vault` has exactly one `setInterval`,
   separated from the rendering logic, and `stopLive()` clears it; it carries the assertion that
   "at least one real read happens within N seconds".

> In the template these three are "the three things that must be done". In this project **all three are
> N/A**, but for different reasons each: rule 1 is **met by a stronger means** (no caching, rather than
> caching + TTL), and rules 2 and 3 **do not exist structurally**. The difference between these three cases
> is written down here so that whoever comes later does not read "N/A" as "not done".

---

## 1. State ownership table (filled in row by row)

The **authoritative source** takes only three values: `chain` / `API` / `in-memory declarative UI state`.

| State | Authoritative source (chain / API / in-memory declarative UI state) | Cacheable in a dApp? | Cache invalidation condition | Who is responsible for refresh | Refresh trigger (manual button / timer / event) |
|---|---|---|---|---|---|
| Vault address `vault` | **in-memory declarative UI state** (read once from the generated runtime config at page load, unchanged for the life of the page) | **Yes, and deliberately permanent** | Never invalidated while the page is open. It comes from the deployment record (`deployments/<chain>.json`), which `scripts/build-runtime-config.mjs` turns into `public/api/config` — and **only a redeploy plus a rebuild changes it**, because the same build that writes the config is the one that publishes the page | `loadRuntimeConfig()` in `src/lib/runtimeConfig.ts`, called **once** by `Providers` before any page renders (not per read, and not per component) | Event (page load: the config is fetched once, and every panel below reads the same object) |
| Asset address `asset` | Same as above | Same as above | Same as above | Same as above | Same as above |
| `deployment.chainId` / `chainName` / `recordPath` | Same as above | Same as above | Same as above | Same as above | Same as above |
| `totalAssets` | **chain** (`totalAssets()`, `src/lib/chain.ts`) | **No** | N/A (re-read on every page load and on window focus, no copy retained between renders) | The caller of `readDeployment()` (`page.tsx`), **not** any component | Event (one `useQuery` per page load, re-armed by window focus) |
| `totalSupply` | **chain** (`totalSupply()`) | **No** | Same as above | Same as above | Same as above |
| `assetDecimals` | **chain** (ERC-20 `decimals()`) | **No** | Same as above | Same as above | Same as above |
| `shareDecimals` | **chain** (vault `decimals()`) | **No** | Same as above | Same as above | Same as above |
| `assetSymbol` | **chain** (ERC-20 `symbol()`) | **No** | Same as above | Same as above | Same as above |
| Share price `price` | **API** (the `series.at(-1).price` of `/api/price?limit=1`) | **No** | N/A. **And deliberately not recomputed in the page** — see the second item of §2 | The caller of `indexApi.price(1)` | Event (one query per page load, re-armed by window focus) |
| Candle series `candles` | **API** (`/api/candles?bucket=60&limit=5000`) | **No** | N/A | The caller of `indexApi.candles(60, 5000)` | Event (one query per page load, re-armed by window focus) |
| Index health `status` (including `lagBlocks` / `staleSeconds` / `eventCount` / `snapshotCount` / `coverage`) | **API** (`/api/status`) | **No** | N/A | The caller of `indexApi.status()` | Event (one query per page load, re-armed by window focus) |
| Chain failure `live.error` | **in-memory declarative UI state** (the `error` of that one query) | **No** | N/A (same lifetime as the page, gone on reload) | The `live` query in `page.tsx` | Event (re-issued on every page load) |
| Index failure `status.error` / `candles.error` / `priceSeries.error` | Same as above, **each one independent — four queries, four errors, no shared fate** | **No** | Same as above | Same as above | Same as above |
| Chart geometry (`range` / `scale` / `cols`) | **in-memory declarative UI state** (the `useMemo` inside `PriceChart`, **derived from props**) | **Yes, TTL = the lifetime of that set of props** | Recomputed by React when the `candles` array reference changes; gone when the component unmounts | React's `useMemo` (dependency array `[candles]`) | Event (props change) |
| Addressable chain entry `candles[i].startsAt` (used as the React `key`) | **API** (the service guarantees buckets align to the epoch, so the same bucket has the same `startsAt` across queries) | N/A (it is a render key, not state) | — | — | — |

**Note: why the record is read once per page load by `Providers` and not held at module scope**

This used to be the opposite question — why `loadDeployment()` was *not* hoisted into a module-level
`const DEPLOYMENT = loadDeployment()`. That would have turned it into a **process-level cache**, and
"redeploy → restart the process" is an **assumption**, not a guarantee (a `next start` process can outlive
the deployment). The address in the header then could not be shown to be the address *this* request read.

The static export removes the server half and keeps the reasoning, which is why the read did not move to
module scope when it moved to the browser:

- `Providers` fetches `api/config` **once per page load**, with `cache: 'no-store'` (see
  `loadRuntimeConfig` in `src/lib/runtimeConfig.ts`), and publishes it through a React context. Every page
  and every panel reads **that one object**, so there is no second answer to "which vault is this page
  pointed at" and no page can invent a fallback;
- it is deliberately **not** a module-level `const`: a module-scope fetch would resolve once per browser
  session rather than once per load, which is the same process-lifetime cache in a new place. A reader who
  loads the page after a redeploy would keep reading the vault that no longer exists;
- the cost is one small JSON file per page load. What that buys is the same thing the per-request read
  bought: the address shown in the page header is definitely the address this page load read.

Note where the honest limit is, because the guarantee is weaker than it was: `api/config` is a **file on
the same host as the page**, generated by the build that published it. `Providers` reads it once per page
load with `cache: 'no-store'`, so nothing between the reader and that file is cached — but a static host
does not re-read the deployment record per request, so what a reader gets is the config **as of the last
publish**, not the newest record that exists. The page does not hide this: it prints the record path it
came from (`recordPath`) beside the addresses, so which deployment a reader is looking at is stated rather
than assumed. `docs/STATIC-EXPORT-MIGRATION.md` is the authoritative record of that trade.

---

## 2. Two places that deliberately "neither cache nor recompute"

### 2.1 The share price is not recomputed in the page

The page **used to** compute the share price itself from `totalAssets` and `totalSupply`. That is a
**second source of truth**: the service implements and tests the same formula in `sharePrice()` in
`../erc4626-vault-dapp/src/api/price.ts`, including that error-prone virtual-shares term
(`10 ** _decimalsOffset()`, which is 1e12, not 1e18 — that project's `test/price.test.ts` records a 4%
error arising from it). Two implementations are bound to diverge.

The page now **only reads** the service's `price` (`priceResult.value.series.at(-1)?.price`).
When the service is unavailable it shows `—` and notes "the index service is unavailable",
**rather than** computing a number on the spot that could disagree with the index right next to it.

### 2.2 The two sources fail independently of each other

The reads are four **separate** queries in `src/app/vault/page.tsx` — `live` (the chain), `status`,
`candles`, `priceSeries` (the index service) — each with its own `error`, each rendered by its own panel.
Separate is structural, not a style choice, and each of the three alternatives below is a real defect this
page would have:

- With one read for everything (`Promise.all`): any one source dies → the whole page 500s. **This was
  exactly the symptom of this project's first version.**
- With four reads but "take the first successful result": a stale number gets labelled as the current one.
- With four reads plus per-panel independent rendering (what it does now): `Now` can fail while
  `Then` still shows history, and vice versa, and the `Two sources` panel **refuses to answer** when the two
  are not both present.

**What this replaced, and what that means for the evidence.** Under the server components the same
independence was guaranteed by `Promise.allSettled` plus a per-panel `status === 'rejected'` branch. That
mechanism is gone; the four-query structure is what carries the property now, and the property itself has
not changed. The measurement that stood behind it (scenarios 9 and 10, `docs/evidence/scenario-9-*.txt` /
`scenario-10-*.txt`) injected the failure through `VAULT_RPC` / `VAULT_API`, which configure a **dev-server
proxy** — a static export has neither. So those files remain the record of what was measured and are not
evidence for the published pages: for the export, this independence is asserted structurally and has not
been re-measured. `EVIDENCE-MAP.md` §1 carries the same correction on its row for this property.

---

## 3. F3 check record (G-F3 requires two pieces of evidence: a static check + a code review)

| Evidence | Who did it | Date | Command / scope | Conclusion | Where the raw output is |
|---|---|---|---|---|---|
| Static check (repo-wide search for forbidden patterns) | the author | 2026-09-16 | `node tools/check-single-source.mjs` (scans every `.ts/.tsx/.mts/.js/.jsx/.mjs` under `src/` and `tools/`, excluding `node_modules` and `.next`; the allow-list is the single file `src/lib/format.ts`) | **0 violations, exit code 0** | `docs/evidence/check-single-source-clean.txt` |
| **The static checker's falsification test** (proving it reports what it should) | the author | 2026-09-16 | Place `src/lib/_violation-probe.ts` (a constructed sample containing all 5 classes of violation) and run the same command | **7 violations, exit code 1**, all 5 rules hit; back to exit code 0 once deleted | `docs/evidence/check-single-source-violation.txt` |
| Code review (a human reading the source, confirming there is no second source of truth) | the author | 2026-09-16, re-read 2026-09-17 after the static export | Read through `src/lib/format.ts`, `src/lib/api.ts`, `src/lib/chain.ts`, `src/lib/chartGeometry.ts`, `src/lib/runtimeConfig.ts`, `src/app/vault/page.tsx`, `src/app/history/page.tsx`, `src/components/PriceChart.tsx` — plus the files the export introduced, `src/app/providers.tsx` and `scripts/build-runtime-config.mjs` | The single implementation point is `format.ts`; inside `chartGeometry.ts` the only `Number` is for **pixel geometry** (it never touches an amount, and its own file header says so); `PriceChart.tsx` has no arithmetic; neither page component has any arithmetic; `runtimeConfig.ts` and `build-runtime-config.mjs` move addresses and integers around and compute no amount | This table + `EVIDENCE-MAP.md` §2 |

**Forbidden-pattern list** (none of these may appear anywhere in the repository; their presence is a "second source of truth")

- `10 ** decimals` (a precision constant in any form) — allowed only in `src/lib/format.ts` ✅ enforced by the checker
- Amount arithmetic inside a component (`BigInt` division, `toFixed`, a `Number(...)` that takes part in an amount) ✅ enforced by the checker
- **Hand-copied contract addresses, chainId, ABI** — an address/ABI may only come from the deployment output or from runtime configuration
  - Addresses: nothing in `src/` knows a contract address. `scripts/build-runtime-config.mjs` reads the
    **deployment record file** — `--record`, defaulting to the sibling repository's
    `../erc4626-vault/deployments/local.json`, and the static build passes
    `deployments/base-sepolia.json` (the in-repository copy, because a host has no sibling checkout).
    It writes `public/api/config`, and `src/lib/runtimeConfig.ts` is what the browser reads. **No
    hardcoded address** anywhere on that path — and `src/lib/deployment.ts`, which used to read the
    record per request, was deleted in the static export (`docs/STATIC-EXPORT-MIGRATION.md`)
  - ABI: `VAULT_ABI` / `ERC20_ABI` in `src/lib/chain.ts` are **function signatures** written with `parseAbi([...])`,
    not the JSON from a compiler artifact. This is a deliberate choice: a function signature is an
    **interface contract** (human-readable, checkable against the text of the ERC-4626 standard), whereas an
    address is a **deployment instance** (it must be read). The two differ in nature, so they are handled
    differently — this is not "the ABI was hand-copied too, so it is a violation".
  - `chainId`: does not appear in the source; `ChainConfig` in `src/lib/chain.ts` carries only `vault`/`asset`,
    and `chainId` is decided by the RPC target in `next.config.ts` and by the deployment record
- A component field holding an on-chain value long-term (with no TTL and no invalidation condition) ✅ does not exist: there is no client-side state container

**The grep command here is written out and has been re-run** (see the first row of the table above), not merely "it was checked".

---

## 4. The six iron rules → where this file answers each

| F3 iron rule | Which section of this file owns it | Where the evidence is | Status |
|---|---|---|---|
| 1 Only one place may compute money | §3 forbidden-pattern list | `docs/evidence/check-single-source-clean.txt` + the falsification file | **Built** |
| 2 Do not cache on-chain state | §0 rule 1 + the §1 table | `test/api.test.ts` → `sends no-store`; `force-dynamic` in all three read-only pages (`/`, `/vault`, `/history`) | **Built** |
| 3 A read must refresh itself | §0 rules 2, 3 | **N/A** (no refresh control, no timer); covered by `erc4626-vault` | **N/A + reason** |
| 4 A write must distinguish four states | the "transaction state" row in the §1 table | **N/A** (no write operation); covered by `erc4626-vault` | **N/A + reason** |
| 5 A failure must not be silent | the §3 failure list in `FRONTEND-SPEC.md` | 3 classes have an implementation + browser assertions; 8 are written up as N/A | **Partly applicable, built** |
| 6 "Looks right" is not allowed | the enforced assertion style of §3 in `BROWSER-TEST-PLAN.md` | `tools/browser-assert.mjs` (it asserts the rendered DOM and coordinate attributes, not constants in the source) | **Built** |

> **Iron rules 3 and 4 are marked "N/A" rather than "built"** because the capabilities they describe
> genuinely do not exist in this interface. Writing N/A as "built" would be exactly the kind of record this
> project's discipline forbids.

---

## 5. Gates

- [x] Every row of the §1 table has an answer for "who is responsible for refresh" and "refresh trigger" (**a blank means it does not pass**) — no empty rows
- [x] Every row marked "cacheable = yes" has a TTL value and an invalidation condition (only two are marked "yes", the deployment-record-derived values and the chart geometry, and both state the condition)
- [x] Both pieces of evidence in §3 are present, and the static check command is re-runnable (with a **falsification test** attached)
- [x] All example rows have been deleted (no `[EXAMPLE]` in the table)

**G-F2 / G-F3 conclusion**: **Passed (self-assessment)** — 2026-09-16, verifier: the author (the implementer is also the verifier).
**This is not client acceptance**; `SUPPORT-AND-SIGNOFF.md` §5 records how each item was verified and the nature of this declaration.
