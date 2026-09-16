# Test-double inventory (path B · F2) — vault-console

> **The third of the F2 deliverables.** Gate G-F2 requires all three to be present; this file is
> the third. Definitions: the workspace's frontend correctness guideline, §2.3 (its section on the
> structural failure modes); basis: the delivery blueprint, §12.2 (its frontend path, F1-F5).
>
> **A test double = anything that is not the real object**: a fake chain, a fake RPC, a DOM stub,
> an injected fake wallet, a hand-written API response sample, a fake timer.
> **They always drift from the real object** — the real object evolves and the double does not.
> The job of this table is to put "what it simplified away" in the open, rather than letting it
> quietly swallow a bug.
>
> **This project has very few doubles, and that is the result of design rather than of omission.**
> A read-only console needs no wallet harness, no fake chain and no DOM stub (because there is
> **no** jsdom test layer — the whole interface layer is covered by real browser assertions).
> The doubles in it come to **one**: the replacement of `fetch` in `test/api.test.ts`. There is
> also **one thing that is not a double but needs explaining** (the fixtures), see §2.

---

## 0. Two hard rules (checked one by one)

1. **A double must be stricter than the real object, or at least equally strict — never more
   permissive.**
   → this project's double is compared item by item in §2. **Conclusion: equally strict within the
   range it is used to verify, and explicitly marked "cannot do it" in the range it cannot cover**
   (§3), rather than pretending to cover it.
2. **If a double derives its expected value from the code under test, that test is invalid.**
   → this project's double has **hand-written** expected values (literals like
   `'http://127.0.0.1:8787/api/status'`), not values computed by the client. This matters: if the
   expected value came from `apiUrl()` itself, then when the client built the URL wrong the
   assertion would be wrong along with it.

---

## 1. This project's doubles (filled in row by row)

| Double | The real object it replaces | What it simplified away | Why that simplification does not hide the behaviour being verified | Where it is loaded from | Who updates it when the real object changes | Verdict |
|---|---|---|---|---|---|---|
| **The `globalThis.fetch` replacement** (`test/api.test.ts`'s `stubFetch`) | Node's real `fetch` (undici) + the real network stack + the real index service | **① DNS / TCP / TLS / proxy** — there is no real connection; **② the server's parameter validation** — the double answers on command and does not know `bucket` or `limit`; **③ real timeout and flow-control behaviour**; **④ streaming reads of `Response`** — Node's built-in `Response` is used, but the content is one I construct | **It does not hide the two things this project really needs to verify**: ① **whether the URL is absolute** — which is exactly the original defect (the server's `fetch('/api/status')` threw `TypeError`), and the double **records and asserts the URL string it received**, which is more direct than the real service: a real service receiving a wrong URL only fails to connect, and you cannot see what was sent; ② **how failures are classified** — the double can construct the four shapes `TypeError('Failed to parse URL …')`, `TypeError('fetch failed')`, 502 non-JSON and 200 non-JSON precisely, and **the real service can construct none of them**. Both of these are verified more strictly on the double than on the real service | **A hand-written copy** (inlined in `test/api.test.ts`) | Trigger: when **the failure-classification logic in `src/lib/api.ts` changes**, or when **Node changes `fetch`'s TypeError wording**. Owner: the author | **Acceptable (for this use only)**. See also §3 for the comparison test and the residual gaps |
| **The fixture files** (`test/fixtures/*.json`) — **strictly speaking not a double** | the index service's **live** response | temporality: it is a response snapshot from **one moment**, and the service changes afterwards | **It hides nothing**: it is not hand-written, it is the service's output **captured verbatim** by `tools/capture-fixtures.mjs` (only re-indented to make diffing easier). So it does not, like a hand-written sample, "encode the author's misunderstanding twice". And the risk of "going stale" is covered by `test/contract-live.test.ts` re-fetching directly from the **live service** | **A product of the real implementation** (the service's real bytes) | Trigger: when **the service's response shape changes**, run `node tools/capture-fixtures.mjs` to re-capture. Owner: the author | **Acceptable** — under the template's source-priority ordering it is tier 1, "the recorded original of a real response", not tiers 2 or 3 |
| **No fake chain / no fake RPC / no fake wallet / no fake timer / no DOM stub** | — | — | — | — | — | **Not applicable**: this project is read-only, there is no write path needing a fake chain; the interface layer is not verified by jsdom (**there is no jsdom dependency**), it is covered by real browser assertions; there are no timers that would need a fake timer |

**Why there is no fake chain**: the console's only on-chain interaction is `eth_call` (six
`readContract` calls issued as a batch). To verify it, **a real anvil is both easier and more
credible than a fake chain** — anvil is running right here on 8545, and `browser-assert.mjs` sends
real `eth_call`s to it. **Wherever a real dependency can be run, never put a double in its place.**

---

## 2. Double against real value (to stop the double drifting quietly)

> Every double needs at least one **comparison test**: the same input fed to the double and to the
> real object separately, asserting that the conclusions agree.

| Double | Where the comparison test is (file:test name) | Or: why it cannot be done + manual check steps | Reviewer | Status |
|---|---|---|---|---|
| the `fetch` replacement | **`test/api-against-real-service.test.ts`** (9 tests, running **the same client class** against the **running real service**). Compared item by item:<br>· the double says `/api/status` received the request → the real service answers 200 with matching field names<br>· the double says `/api/price?limit=1` → the real service answers `series.length === 1`, `limit === 1`<br>· the double says `/api/candles?bucket=60&limit=5000` → the real service **accepts** that query string (this is the part the double **cannot** verify at all)<br>· the double says illegal input takes the `refused` branch → the real service answers 4xx for a non-numeric `bucket`, the client classifies it as `refused` with `retryable === false` | — | the author | **Built** (9/9 passing, `docs/evidence/api-against-real-service.txt`) |
| the `fetch` replacement — **the `cache: 'no-store'` item** | **Cannot be done**: `no-store` is a **parameter** the client sends to `fetch`, not a response characteristic the server can observe; and the real service cannot distinguish "the client asked not to cache" from "the client happened to get an uncached copy".<br>**Manual check steps**: ① read the `LIVE` constant in `src/lib/api.ts` and every `indexApi.*` call, confirm they all pass it; ② open the page twice in a real browser, changing on-chain state in between (send a transfer on anvil), and confirm the numbers changed on the second refresh — **this step has not been executed**, see `BROWSER-TEST-PLAN.md` §5's "data freshness" row | the author | **Partly unverified** |
| the `fetch` replacement — **transport failures (timeout / TLS / DNS)** | **Cannot be done, and it is recorded as a residual gap**: constructing a real timeout needs a server that hangs; constructing a TLS error needs an HTTPS endpoint with a bad certificate. This workspace's environment constraints (an unstable SOCKS5 proxy, local ports needing `NO_PROXY`) make this class of experiment unreliable in itself, and the result could not distinguish "the client classified it right" from "the proxy ate the request".<br>**Manual check steps**: point at a port that **exists but is not listening** (e.g. `VAULT_API=http://127.0.0.1:9`), and confirm an `unreachable` classification appears rather than something else | the author | **Unverified** (recorded in `EVIDENCE-MAP.md` §3) |

**The priority order for where a double is loaded from** (higher is better):

1. **The real implementation** ← the fixtures belong here (the recorded original of a real response)
2. **A shared hand-written double** ← none
3. **A one-off double specific to this test** ← `stubFetch` belongs here. **The reason**: it is reused
   by 6 tests, but only **within one file**; promoting it to a shared location needs a second
   consumer, and there is not one. It carries dense comments (every rule says "why"), which meets
   the "write it once, comment it densely" requirement.

---

## 3. Consistency check against `EVIDENCE-MAP.md` §3

The template requires: **no "claim about the real chain" may be supported by a double alone.**

| Claim about the real chain / real environment | The evidence supporting it | Is it supported by a double alone |
|---|---|---|
| the interface's reading equals the on-chain value | a real browser + the real anvil `eth_call` (`browser-assert.mjs`) | **No** |
| coordinates under real rendering are not NaN | a real browser reading the SVG attributes of the rendered DOM | **No** |
| the service response's real field names and shape | live re-fetch (`contract-live.test.ts`, `api-against-real-service.test.ts`) | **No** |
| the page's server-side render returns 200 | a real HTTP request (`fetch(PAGE)`) | **No** |
| `fetch` failures are split into three classes | the double (`stubFetch`) + the comparison against a real 4xx | **No** (there is a comparison) |
| `cache: 'no-store'` really is sent | the double captures the `init` object | **Yes — supported by a double alone**. Explicitly marked "partly unverified", with real-environment check steps given |
| `dynamic = 'force-dynamic'` takes effect | **no evidence** | **Yes — it does not even have a double**. Recorded in `EVIDENCE-MAP.md` §3 |

> Both claims supported only by a double (or with no evidence at all) are called out in the table
> above, and neither one is written as "verified". The second of them has neither a double nor an
> assertion, just one line of declaration in the source code.

---

## 4. Gate G-F2 (this file's part)

- [x] Every double says what it simplified, and none of them simplified away behaviour an assertion depends on
  — what `stubFetch` simplified away is **the real transport**, while what is asserted is **URL construction** and **failure classification**; the two are not at the same level (see the note in §1). The `no-store` item genuinely was simplified away and is marked unverified
- [x] The verdict column has no empty "unacceptable"; unacceptable ones were fixed or recorded as risk (no "unacceptable" entries)
- [x] Every double has a comparison test, or a written reason why it cannot + manual check steps (§2 has all three rows)
- [x] All the example rows are deleted (the placeholder used by the document template)
- [x] Consistent with `EVIDENCE-MAP.md` §3: checked row by row, the two "supported by a double alone" claims are named

**G-F2 conclusion**: **passing (self-assessed)** — 2026-09-16, the author.
1 double in total + 1 "recorded real response", both with comparison tests or an explicit unverified
record.
**Not client acceptance**; the reason is in `SUPPORT-AND-SIGNOFF.md` §5.

> Companions: `INVARIANTS.md` (what has to be proved), `EVIDENCE-MAP.md` (what the evidence can and
> cannot prove).
