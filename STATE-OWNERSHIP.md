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
> - but it has **one stricter requirement**: `dynamic = 'force-dynamic'` + `cache: 'no-store'`,
>   that is, **the figures on screen are not cached under any circumstance**. This is not a choice, it is a
>   precondition of the page being correct — a cached console would present a number that was true a minute
>   ago as true now.
>
> Every "N/A" in the row-by-row table comes with a reason; N/A ≠ left blank.

---

## 0. Three hard rules (checked one by one against this project)

1. **Do not cache on-chain state.** Every figure on screen is fetched from the chain or the API each time.
   An old value that genuinely must stay in memory **must have an explicit expiry (TTL)**, and the interface
   must make it visible that it may be stale.

   **What this project does is harder than a "TTL"**: there is **no TTL at all**, because nothing is kept.
   - **all three read-only pages** — `src/app/page.tsx`, `src/app/vault/page.tsx` and
     `src/app/history/page.tsx` — export `dynamic = 'force-dynamic'` and `revalidate = 0`. Declared per
     page rather than inherited, deliberately: a new page that forgets it becomes cacheable, nothing in
     the type system prevents that, and the first symptom would be a page showing a number that was
     true a minute ago while claiming to be current;
   - `LIVE = { cache: 'no-store' }` in `src/lib/api.ts` is applied to **every single** `fetch`;
   - the pages have **no** client-side timer, no polling, no SWR/React Query cache.
     Reload = browser reload = one completely fresh server-side fetch.
   - there is an assertion: `test/api.test.ts` → `sends no-store, because a cached console shows stale figures as current`;
   - and the claim itself is **measured**, not just asserted in source: scenario 11 captures the page,
     advances the index, captures the same URL again, and requires `Indexed to block`, `Lag` and
     `indexer last ran` to have changed (`docs/evidence/scenario-11-freshness.txt`).

   **Why there is no timed polling**: the first version of this project (the candlestick chart in the
   sibling project `erc4626-vault`) did use a 15-second `setInterval` poll, and rule 3 of §0 of the
   guideline records the real defect of exactly that structure (the read timer and the countdown timer
   starving each other). The console is a page **for looking at the current state**, so a server-side
   fetch plus an explicit reload is enough, and there is **no cache that could go stale**.

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
| Vault address `vault` | **in-memory declarative UI state** (read from the deployment record file at startup, unchanged for the life of the process) | **Yes, and deliberately permanent** | Never invalidated. It comes from the deployment record file (`src/lib/deployment.ts`) and **only a redeploy changes it**, and a redeploy means restarting the console | `loadDeployment()` in `src/lib/deployment.ts`, **called on every request** in `page.tsx` (no module-level cache, see the note below) | Event (process lifetime: the file is re-read on every request) |
| Asset address `asset` | Same as above | Same as above | Same as above | Same as above | Same as above |
| `deployment.chainId` / `chainName` / `recordPath` | Same as above | Same as above | Same as above | Same as above | Same as above |
| `totalAssets` | **chain** (`totalAssets()`, `src/lib/chain.ts`) | **No** | N/A (re-read on every request, no copy retained) | The caller of `readDeployment()` (`page.tsx`), **not** any component | Event (one `Promise.allSettled` per HTTP request) |
| `totalSupply` | **chain** (`totalSupply()`) | **No** | Same as above | Same as above | Same as above |
| `assetDecimals` | **chain** (ERC-20 `decimals()`) | **No** | Same as above | Same as above | Same as above |
| `shareDecimals` | **chain** (vault `decimals()`) | **No** | Same as above | Same as above | Same as above |
| `assetSymbol` | **chain** (ERC-20 `symbol()`) | **No** | Same as above | Same as above | Same as above |
| Share price `price` | **API** (the `series.at(-1).price` of `/api/price?limit=1`) | **No** | N/A. **And deliberately not recomputed in the page** — see the second item of §2 | The caller of `indexApi.price(1)` | Event (once per HTTP request) |
| Candle series `candles` | **API** (`/api/candles?bucket=60&limit=5000`) | **No** | N/A | The caller of `indexApi.candles(60, 5000)` | Event (once per HTTP request) |
| Index health `status` (including `lagBlocks` / `staleSeconds` / `eventCount` / `snapshotCount` / `coverage`) | **API** (`/api/status`) | **No** | N/A | The caller of `indexApi.status()` | Event (once per HTTP request) |
| Chain failure `liveResult.reason` | **in-memory declarative UI state** (one result of `Promise.allSettled`) | **No** | N/A (same lifetime as this request, gone the moment the request ends) | The `Promise.allSettled` in `page.tsx` | Event (re-settled on every request) |
| Index failure `statusResult` / `candleResult` / `priceResult.reason` | Same as above, **each one independent** | **No** | Same as above | Same as above | Same as above |
| Chart geometry (`range` / `scale` / `cols`) | **in-memory declarative UI state** (the `useMemo` inside `PriceChart`, **derived from props**) | **Yes, TTL = the lifetime of that set of props** | Recomputed by React when the `candles` array reference changes; gone when the component unmounts | React's `useMemo` (dependency array `[candles]`) | Event (props change) |
| Addressable chain entry `candles[i].startsAt` (used as the React `key`) | **API** (the service guarantees buckets align to the epoch, so the same bucket has the same `startsAt` across queries) | N/A (it is a render key, not state) | — | — | — |

**Note: why `loadDeployment()` is called on every request and not once at module top level**

A module-level `const DEPLOYMENT = loadDeployment()` would turn it into a **process-level cache**, and
"redeploy → restart the process" is an **assumption**, not a guarantee (a `next start` process can outlive
the deployment). The cost of reading a few-hundred-byte JSON on every request is negligible, and what it
buys is that "the address shown in the page header is definitely the address this request read".
This is a concrete example of "rather read the file one time too many than hold a copy that can go stale".

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

`Promise.allSettled` (not `Promise.all`) is structural, not a style choice:

- With `Promise.all`: any one source dies → the whole page 500s. **This was exactly the symptom of this project's first version.**
- With `Promise.allSettled` but "take the first successful result": a stale number gets labelled as the current one.
- With `Promise.allSettled` plus per-panel independent rendering (what it does now): `Now` can fail while
  `Then` still shows history, and vice versa, and the `Two sources` panel **refuses to answer** when the two
  are not both present.

---

## 3. F3 check record (G-F3 requires two pieces of evidence: a static check + a code review)

| Evidence | Who did it | Date | Command / scope | Conclusion | Where the raw output is |
|---|---|---|---|---|---|
| Static check (repo-wide search for forbidden patterns) | the author | 2026-09-16 | `node tools/check-single-source.mjs` (scans every `.ts/.tsx/.mts/.js/.jsx/.mjs` under `src/` and `tools/`, excluding `node_modules` and `.next`; the allow-list is the single file `src/lib/format.ts`) | **0 violations, exit code 0** | `docs/evidence/check-single-source-clean.txt` |
| **The static checker's falsification test** (proving it reports what it should) | the author | 2026-09-16 | Place `src/lib/_violation-probe.ts` (a constructed sample containing all 5 classes of violation) and run the same command | **7 violations, exit code 1**, all 5 rules hit; back to exit code 0 once deleted | `docs/evidence/check-single-source-violation.txt` |
| Code review (a human reading the source, confirming there is no second source of truth) | the author | 2026-09-16 | Read through `src/lib/format.ts`, `src/lib/api.ts`, `src/lib/chain.ts`, `src/lib/chartGeometry.ts`, `src/lib/endpoints.ts`, `src/lib/deployment.ts`, `src/app/page.tsx`, `src/components/PriceChart.tsx` | The single implementation point is `format.ts`; inside `chartGeometry.ts` the only `Number` is for **pixel geometry** (it never touches an amount, and its own file header says so); `PriceChart.tsx` has no arithmetic; `page.tsx` has no arithmetic | This table + `EVIDENCE-MAP.md` §2 |

**Forbidden-pattern list** (none of these may appear anywhere in the repository; their presence is a "second source of truth")

- `10 ** decimals` (a precision constant in any form) — allowed only in `src/lib/format.ts` ✅ enforced by the checker
- Amount arithmetic inside a component (`BigInt` division, `toFixed`, a `Number(...)` that takes part in an amount) ✅ enforced by the checker
- **Hand-copied contract addresses, chainId, ABI** — an address/ABI may only come from the deployment output or from runtime configuration
  - Addresses: `src/lib/deployment.ts` reads them from the **deployment record file** — `VAULT_DEPLOYMENT`
    when it is set, otherwise the sibling repository's `../erc4626-vault/deployments/local.json` (**no**
    hardcoded address). Both fallbacks point outside this repository, so a hosted build sets
    `VAULT_DEPLOYMENT` to the in-repository copy `deployments/base-sepolia.json`
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
