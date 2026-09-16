# Browser test plan (path B · F4) — vault-console

> **F4 deliverable. Gate G-F4: everything passes in a real browser; the evidence includes a screenshot + console errors + a transaction hash.**
> Basis: the delivery blueprint, §12.2 and §12.5 (path B's four layers);
> methodology: the workspace's frontend correctness guideline, sections 3 and 4 (structure).
>
> **This file is a plan plus a record of what was measured.** A row that has not been run must have its status written as `not run` — **not run must never be written as passed**.
>
> **Where this project's evidence layers differ from what the template assumes, stated up front**:
> 8 of the 11 failure classes in the template's §4 (the F1-F5 frontend delivery-path skeleton in the
> private workspace) belong to a **writable dApp** (wallet, approval, gas, revert, replacement).
> This project is **read-only**, so those 8 do not apply, and each row states its reason and the covering
> project. **Not applicable is not the same as left blank.**
> Separately, the template's §5 requirement for a "transaction hash" as evidence does not apply to **any**
> row here (no transaction is sent) — that too is stated in the table, so it is not read as a field left unfilled.

---

## 0. Path B's four layers (missing one layer does not count as done)

| Layer | What runs | Real or double | What evidence it produces | Who runs it | The cost of missing this layer |
|---|---|---|---|---|---|
| **L1 pure-function unit** | amount conversion / formatting / chart geometry / client-side failure classification | no external dependency (**1 `fetch` double, see `TEST-DOUBLES.md`**) | `docs/evidence/tests.txt` (**107 tests, 5 files, all green** — the count was 104/4 before `test/chain-errors.test.ts` was added) | anyone / agent | precision bugs go through unchecked. This project caught **4** with this layer alone: INV-01/02/05/07 |
| **L2 real browser** | server-side rendering + client hydration + SVG coordinates + rendered text | **real browser** (the user's real Chrome, driven through kimi-webbridge CDP) | `docs/evidence/browser-assert.txt` (**14/14 passed**) + `docs/evidence/console-live.png` | the author (see the privilege note in §1) | **one** of this project's two formatting bugs could only be caught by this layer (L1 catches the other), and "did the SVG actually draw" is a question **only** this layer can answer |
| **L3 wallet interaction, real or as a double** | connect, switch chain, approve, sign, report the four states | **Not applicable + reason**: this interface connects no wallet, signs nothing and sends no transaction | Not applicable | — | **this project does not carry this layer's risk**; the sibling `erc4626-vault` project covers it (measured with a real MetaMask 13.48: transaction hash `0xbdeb4044…`, block 8320, gas 55384; a refused signature is rendered neutrally) |
| **L4 UI computed-style assertions** | real element visibility, layout assertions | real browser | see §5 | the author | reproduces "the attribute assertion kept passing while the banner stayed on screen". This project **has no** assertion target of the "ought to be invisible" kind (the page has no conditional banner); see §5 for how that is handled |

> **L3 is marked "not applicable" rather than "skipped"**: wallet interaction does not exist in this
> project by construction, so this is not "it should have been run and was not", it is "there is no such
> object here".
> And the class of bug L3 exists to prevent (a revert reported as success) has real-wallet evidence in the sibling project.

---

## 1. Sandbox facts and the privilege record

**Measured on this machine** (recorded in the workspace's environment capability list, section 3):
starting headless Chromium inside the restricted sandbox crashes within about 3.5 seconds:

```
FATAL:mojo\public\cpp\platform\platform_channel.cc:108
Check failed: . : 拒绝访问。 (0x5)
```

(The Chinese in that line is `拒绝访问。` — "access denied"; `(0x5)` is the code that came with it.)

**Root cause**: Chromium needs mojo IPC (named pipes), and the restricted sandbox forbids a program from
creating named pipes.
**Parameters such as `--no-sandbox` and `--disable-dev-shm-usage` make no difference** — the thing doing the refusing is the operating-system sandbox.

**What this project does**: it does not stand up a browser of its own. It uses
**`kimi-webbridge` to drive the user's real Chrome** (CDP), which is the preferred path recorded in the
workspace's environment capability list, section 3.4, and the same route the sibling project
`erc4626-vault`'s `web/tools/browser-test.mjs` (76/76 passed) takes. The advantage of that route is that
it is **extra credible**: it runs against **the browser the user has MetaMask installed in**, not a
headless environment "too clean to be real".

| Item | Value |
|---|---|
| This project's browser test script | `tools/browser-assert.mjs`. **One command**: `node tools/browser-assert.mjs --url http://127.0.0.1:3103` (default `http://127.0.0.1:3100`) |
| Who runs it (from outside the restricted shell) | anyone — the script needs only the daemon and a browser, no privilege escalation. **The the author can run it from inside the restricted shell too**, because the daemon starts the browser outside the sandbox |
| Wired into the CI aggregate | **No**, and **deliberately not**. It needs three processes (anvil / the index API / Next dev) plus a real browser. Wiring it in would make the aggregate job's result depend on "did the environment come up", not on the code |
| Browser driven | the user's real Chrome, Profile 3 (with MetaMask 13.48) |
| Date and operator of the most recent real run | **2026-09-16, the author**, result 14/14 passed (`docs/evidence/browser-assert.txt`) |
| Did that run require privilege escalation | **No escalation** (the daemon runs the browser outside the sandbox). Running `next dev` and `next build` in the same period **needed one escalation** — not because of the browser, but because Next 16's Turbopack has to spawn worker processes (`spawn EPERM`). That is recorded in the workspace's environment capability list |

---

## 2. Real / double wallet decision table

**The whole table is not applicable + reason**: this project is a read-only console with no wallet
integration, so the decision "real wallet or double" does not exist.

| Test target | Real wallet or double | Why | Who runs it | What this choice cannot prove |
|---|---|---|---|---|
| The main flow of connect / switch chain / approve / deposit / redeem | **Not applicable** | this interface has no wallet | — | this project does not carry that risk; `erc4626-vault` covers it with a real MetaMask |
| How a refused signature (`4001`) is presented | **Not applicable** | there is no signature request | — | same as above |
| A transaction being replaced (`replaced`) | **Not applicable** | there is no transaction | — | same as above |
| Pre-send blocking for wrong chain / insufficient balance / insufficient allowance | **Not applicable** | nothing is sent, there is no wallet | — | same as above |
| Extreme errors (RPC timeout, 429 rate limiting) | **Partly applicable** — and the cross-reference was wrong: unreachability of the RPC and the API is covered by rows 9 and 10 in **§5** (the failure-scenario matrix), not §6, which holds the I3/I4 tables; **timeout and 429 are not covered** | this interface really does face RPC/API failures, so "not applicable" would not hold here | the author | only one form of unavailability has been verified so far: "the service process is not there". **Timeouts, rate limiting and TLS errors are all untested**, logged in `EVIDENCE-MAP.md` §3 |

---

## 3. Mandatory assertion style: assert the rendered result, not a constant in the source

**The wrong way (must be forbidden)**

```js
// ❌ Attribute assertion: the `hidden` attribute is overridden by a CSS `display:flex`
assert.equal(banner.hidden, true);

// ❌ Existence assertion: being in the DOM is not the same as being visible to the user
assert.notEqual(document.querySelector('#wrong-chain-banner'), null);

// ❌ Source assertion: grepping a string out of the source does not mean it appears on the page
assert.ok(source.includes('the price did not move'));
```

**A real bug (in this workspace)**: the wrong-chain banner was on screen the whole time while the
attribute assertion kept passing, because a CSS `display:flex` overrode the `hidden` attribute.

**What this project does instead** (`tools/browser-assert.mjs`)

What is asserted is the **rendered DOM**, not the source and not "the element exists":

```js
// ✅ Assert that no NaN appears in the SVG's coordinate attributes — this is the machine-decidable form of "did it draw".
//    A NaN coordinate in SVG is silent: no exception, no log line, it just does not draw. The attribute is the only entry point.
const attrs = ['x','y','width','height','x1','x2','y1','y2'];
const nan = [];
for (const el of svg.querySelectorAll('rect,line'))
  for (const a of attrs) { const v = el.getAttribute(a); if (v && v.includes('NaN')) nan.push(el.tagName + '.' + a); }
assert.equal(nan.length, 0);

// ✅ Assert the rendered TEXT, not a string in the source
const text = document.body.innerText;
assert.match(text, /the price did not move in this window/);

// ✅ Assert that a raw uint256 string does NOT appear in the rendered text — a negative assertion, harder to fake than a positive one
assert.ok(!new RegExp(`(^|[^\\d.,])${rawUint256}([^\\d.,]|$)`).test(text.replace(/,/g, '')));
```

**A better step still: assert that the on-chain value equals the value on the page** (cross-component consistency, not self-verification)

```js
// ✅ The expected value comes from a real anvil `eth_call`, not from the page and not hardcoded.
//    A hardcoded value stops holding the next time someone deposits, and when it fails the reason is "the data changed", not "the code is wrong".
const onChain = await rpc('eth_call', { to: VAULT, data: '0x18160ddd' }); // totalSupply()
assert.equal(displayedShares, formatBaseUnits(onChain, 18));
```

**The false-evidence list (check each one against yourself)**

| Forbidden form | Why it is false evidence | What this project does instead |
|---|---|---|
| Asserting `el.hidden` / a custom attribute | CSS can override an attribute | **this project has no such assertion target** (the page has no conditional banner). If one is added later it must use `getComputedStyle` + §5 |
| Asserting the element exists in the DOM | existing is not the same as visible | assert the rendered text + the SVG coordinate attributes; a visual conclusion gets a screenshot of its own |
| Deriving the expected value from the code under test | that tests determinism, not correctness | `totalSupply`'s expected value comes from **anvil's `eth_call`**; the fixtures come from **bytes captured from the service** |
| Using `value.length < 20` to decide "is this a base unit" | with 18 decimals **right and wrong are both 23 characters**, so the test is invalid on its face | assert the **property**: the raw uint256 string must not appear as a standalone number in the rendered text (the regex uses word boundaries, not length) |
| Advancing a fake timer by hand and then asserting "the periodic refresh happened" | real timers crowd each other out | **this project has no timers** (`STATE-OWNERSHIP.md` §0 rule 1) — the item is not applicable, not undone |
| Screenshotting only, not capturing the console | crashes and uncaught exceptions only show up in the console | the `_out` capture: assert that the page text carries no failure wording and no hydration hint, and record the presence of `nextjs-portal` (see the known items in §7) |

---

## 4. L4 computed-style assertion list (which elements this project asserts)

**Where this differs from what the template assumes**: the template's §4 targets defects of the
"**ought to be invisible but stays on screen**" kind (the wrong-chain banner). This project has **no**
element that ought to be invisible —
every element on the page either ought to be present or is not rendered at all (on failure the whole
block is replaced by an error box).

So this project's L4 targets are replaced by three **equivalent, machine-decidable** things:

| Element / selector | Under what condition | Expected computed style / rendered result | Corresponding F1 statement id |
|---|---|---|---|
| `svg[role="img"] > rect` (each candle) | the page has loaded and hydration has finished | the number of `rect` **== the number of `g`** (every candle drew a body, none was silently lost), and `x/y/width/height` all contain **no `NaN`** | UI-07 |
| `svg[role="img"]` (the figure itself) | same as above | present and **not** the "No price history in this window." empty state — existence alone is not evidence, it has to be paired with `rect > 0` | UI-07 |
| `svg[role="img"] rect > title` (the tooltip) | same as above | the text carries **the raw strings the service returned** (`open  1.1` and so on), plus the block range | UI-10 |
| `document.body.innerText` | the page has finished rendering | contains `the price did not move in this window` and the coverage-gap sentence verbatim | UI-08 / UI-09 |
| `document.body.innerText` | same as above | does **not** contain the raw uint256 string as a standalone number | UI-02 |
| `document.querySelectorAll('section').length` | both services are reachable | `=== 4` | UI-01 |

> A true "element visibility" assertion has **no target** in this project.
> That is an honest record, not an evasion: if a conditionally displayed banner is ever added,
> the assertion must be added in the template's §4 `getComputedStyle` form, and **must not** use the `hidden` attribute.

---

## 5. Failure-scenario matrix (the same 11 classes as `FRONTEND-SPEC.md` §3; the numbering must line up)

**Evidence requirements**: the screenshot path is the **relative path the file actually landed at** (for a row that has not been run, write `not run`);
the console column means "the console errors and uncaught exceptions this page produced during this case, which must be empty or explainable".
**Transaction-hash column: not applicable to all 11 rows in this project** (read-only, no transaction is sent) — not repeated row by row.

| # | Failure class | How it is injected | What is asserted (wording + rendered result + state) | Evidence requirement | Status |
|---|---|---|---|---|---|
| 1 | Wallet not installed | **Not applicable + reason**: this interface does not ask for a wallet (UI-11 says plainly "no wallet is required or requested"), so a missing wallet changes no visible behaviour. **Covering project**: `erc4626-vault` | — | Not applicable | **Not applicable + reason** |
| 2 | The user refuses to sign (`4001`) | **Not applicable + reason**: there is no signature request. **Covering project**: `erc4626-vault` (measured with a real MetaMask, presented neutrally) | — | Not applicable | **Not applicable + reason** |
| 3 | Wrong chain | **Not applicable + reason**: with no wallet there is no "chain the wallet is on". The chain this console reads is decided by `VAULT_RPC` plus the `chainId` in the deployment record, and the page header shows it | — | Not applicable | **Not applicable + reason** |
| 4 | Insufficient allowance | **Not applicable + reason**: read-only, there is no allowance. **Covering project**: `erc4626-vault` | — | Not applicable | **Not applicable + reason** |
| 5 | Insufficient balance | **Not applicable + reason**: read-only, nothing is spent. **Covering project**: `erc4626-vault` (measured: an over-balance input is not sent) | — | Not applicable | **Not applicable + reason** |
| 6 | Insufficient gas | **Not applicable + reason**: there is no transaction. **Covering project**: `erc4626-vault` | — | Not applicable | **Not applicable + reason** |
| 7 | Transaction reverted | **Not applicable + reason**: there is no transaction. **Covering project**: `erc4626-vault` | — | Not applicable | **Not applicable + reason** |
| 8 | Transaction replaced (`replaced`) | **Not applicable + reason**: no transaction, no pending state. **Covering project**: `erc4626-vault` | — | Not applicable | **Not applicable + reason** |
| **9** | **RPC unreachable** | the console instance's `VAULT_RPC` points at a **port nothing listens on**, `http://127.0.0.1:8547` (the index service stays healthy). Cleaner than stopping anvil: it does not disturb the live chain that other evidence in the same session depends on. Stopping the real anvil is equivalent — either way the console sees a refused connection | ① the `Now` panel shows **"The chain could not be read."**, immediately followed by the sentence **"The chain node at http://127.0.0.1:8547 is not reachable. Check that a node is listening there and that VAULT_RPC points at it."**, and labels it with `endpoint` and `class: unreachable`; ② the page still returns **HTTP 200** (not 500); ③ the **`Then` panel still renders 174 candles** (`Indexed to block 12580`, `Lag 0`, `Events 18`) — this one is the point of the row: it proves the two sources fail independently; ④ the `Two sources` panel shows **"A comparison needs both sources. One of them is unavailable, so this panel does not guess."** | Screenshot: `docs/evidence/scenario-9-chain-down.png`; report: `docs/evidence/scenario-9-chain-down.txt` (exit 0); console: see §7 | **Passed** 2026-09-16 |
| **10** | **API unreachable** | the console instance's `VAULT_API` points at a **port nothing listens on**, `http://127.0.0.1:8788` (the chain stays healthy) | ① the `Then` panel shows **"The index service could not be read."** plus **"The index service is not reachable at http://127.0.0.1:8788/api/candles?bucket=60&limit=5000. It runs as a separate process; start it with \`node --experimental-strip-types src/api/cli.ts\` in the erc4626-vault-dapp repository."** — the sentence **carries the actual request URL**, which is the key to being able to diagnose it; ② the `Now` panel **still shows real on-chain readings** (`944.9241` USDC, `859.021905704231281673` shares, no failure wording); ③ the `Two sources` panel **refuses to answer** | Screenshot: `docs/evidence/scenario-10-index-down.png`; report: `docs/evidence/scenario-10-index-down.txt` (exit 0); console: see §7 | **Passed** 2026-09-16 |
| **11** | **Stale data** | two steps, because **with static readings "a correct implementation" and "a caching implementation" look exactly alike**: ① record `Indexed to block` / `Lag` / `indexer last ran` from the page; ② **actually advance the index** (run the indexer once; it scans 59 blocks and writes 59 snapshots), then request the same page again | ① `Indexed to block` goes from **12580 → 12639**; ② `Lag` goes from **0 → 97 blocks** (the chain head the indexer recorded changed); ③ `indexer last ran` goes from **5m 11s → 4s**; ④ the service's sentence **"lagBlocks is measured against the chain head recorded at the last indexer run, not against the chain now."** is still on the page. **Four values changing at the same time is the proof that the page re-reads on every request and caches nothing** | Screenshot: `docs/evidence/scenario-11-data-freshness.png`; report: `docs/evidence/scenario-11-freshness.txt` (two parts, before/after, exit 0); console: see §7 | **Passed** 2026-09-16 |

> **Why row 11 cannot be run only once**: if the indexer has not moved, a page showing `12580` could be
> either "re-reading on every request" or "caching the first response" — **the two produce identical
> output**. So the evidence has to be **a before/after pair**; a single reading is not evidence.

**The parts that have been run (not among the 11 classes, but facts this file has to record)**

| Scenario | How it was run | Result | Evidence |
|---|---|---|---|
| The full page with both services reachable | `node tools/browser-assert.mjs --url http://127.0.0.1:3103` | **14/14 passed**: HTTP 200, 4 panels, 169 rects / 169 `g`, 172 lines with 0 NaN, `totalSupply` shown as shares, raw uint256 not on the page, the flat-series sentence present, the tooltip carrying the raw strings, no failure wording, no hydration hint | `docs/evidence/browser-assert.txt` + `docs/evidence/console-live.png` |

> **Rows 9, 10 and 11 have all now passed**, and each one has: a measurement report (a re-runnable
> command + its exit code), a screenshot,
> and a statement of "what this row cannot prove". Row 9 additionally caught a real defect; see item 5 in §7.

---

## 6. Path D's I3 / I4 (reusing this file)

**I3 end-to-end (G-I3: the full E2E flow passes in a real environment)**

| Step | Action | Assertion | Evidence | Status |
|---|---|---|---|---|
| 1 | Connect wallet | **Not applicable + reason**: this project is read-only, there is no wallet | — | **Not applicable** |
| 2 | Approve | **Not applicable + reason**: same as above | — | **Not applicable** |
| 3 | Deposit | **Not applicable + reason**: same as above. **Covering project**: `erc4626-vault` (real MetaMask, tx `0xbdeb4044…`, block 8320) | — | **Not applicable** |
| 4 | Redeem | **Not applicable + reason**: same as above | — | **Not applicable** |
| 5 | **The page reading exactly equals the chain** | **Applicable and already run**: the assertion reads anvil's `eth_call totalSupply()` (`0x18160ddd`) and compares it with the **share string on the rendered page**. Precision handling: the chain holds a raw uint256, the page holds a decimal string with trailing zeros stripped, and the two are made equivalent through `formatBaseUnits` | **Passed**. Measured: chain `859021905704231281673` ↔ page `859.021905704231281673`. (This row previously printed the chain value as `859021905704281673` — 18 digits, missing `4231`. The raw evidence and a live `eth_call` both give 21 digits; a truncated figure inside a row about exact equality was the worst possible place to have one) | `totalSupply rendered as SHARES…` in `docs/evidence/browser-assert.txt` | **Passed** |

> Steps 1–4 of I3 are not applicable because **this project is not the vehicle for an end-to-end
> transaction flow**.
> The real end-to-end transaction evidence lives in `erc4626-vault` (real wallet + real chain + a transaction hash you can look up).
> Step 5 is "exactly equal" — this project **is exact**; it did not settle for "about the same" or "equal after rounding".

**I4 failure scenarios (G-I4: each of the four failure classes has evidence, and the interface must produce a readable error rather than going silent)**

| Failure class | Which row of §5 in this file it reuses | Interface error readability (wording copied verbatim) | Status |
|---|---|---|---|
| RPC down | row 9 | **"The chain could not be read."** + the specific message for that failure (already implemented in the `Failure` component in `src/app/page.tsx`) | **Not run** |
| API down | row 10 | **"The index service is not reachable at \<URL\>. It runs as a separate process; start it with \`node --experimental-strip-types src/api/cli.ts\` in the erc4626-vault-dapp repository."** (already implemented in `src/lib/api.ts`) | **Not run** |
| Wallet refuses to sign | row 2 | **Not applicable + reason**: there is no signature. **Covering project**: `erc4626-vault` (neutral wording, measured) | **Not applicable** |
| Transaction replaced | row 8 | **Not applicable + reason**: there is no transaction. **Covering project**: `erc4626-vault` | **Not applicable** |

---

## 7. Known issues (console and rendering)

| Item | Symptom | Judgement | Disposition |
|---|---|---|---|
| A `nextjs-portal` element is present | `document.querySelector('nextjs-portal')` is truthy | **Not an error**: it is Next.js 16's development-mode indicator (the dev-tools mount point). It does not appear in a production build | the assertion does **not** treat it as a failure signal; this project's assertion instead checks that the page text carries no failure wording and no hydration hint |
| The page text is about 2,000 characters long | the length of `body.innerText` | **Normal**: the candle figures all live in SVG `<title>` elements (`innerText` does not include non-rendered SVG text), and there are 169–174 of those `<title>` elements | none |
| `Lag 0 blocks` appears together with "indexer last ran 1h 38m ago" | looks contradictory | **Not contradictory, and the service's note explains it**: `lagBlocks` is relative to **the chain head recorded at the last indexer run**, not to the chain head now. The chain produced no block after that run, so lag is 0 | the page shows the service's note **verbatim**, adding no explanation and rewriting nothing |
| No uncaught exceptions, no hydration hint | `no hydration mismatch text on the page` in `browser-assert.mjs` passes | clean | none |
| **Item 5 (the failure panel used to be smeared with viem's diagnostic dump)** | on scenario 9's first measurement, the `Now` panel rendered `URL: http://127.0.0.1:8547/`, a full JSON-RPC `Request body`, `Raw Call Arguments`, `Docs: https://viem.sh/docs/contract/readContract`, `Version: viem@2.56.5` — **a whole screen of JSON instead of two sentences** | **A real defect, fixed.** The `Failure` component only turned the project's own `ServiceError` into wording; the chain side threw viem's `ContractFunctionExecutionError`, whose `message` is that dump, and it passed straight through. **In the source that line is just `error.message`; reading the code does not show it** — it was found by screenshotting the failure path | added `ChainError` (`src/lib/chain.ts`): it classifies viem errors as `unreachable` / `timeout` / `call-failed` / `unknown`, produces **one sentence + the endpoint + the class**, and puts the raw dump in `detail`. The `Failure` component folds `detail` into `<details>` (measured: `open: false`, dump 1091 characters). Regression test `test/chain-errors.test.ts`, 3 cases, one of which **explicitly asserts that `message` must not contain `Raw Call Arguments` or `viem@`** and must be under 300 characters |

> The template requires "console errors empty or explainable". This project **does not capture console
> events directly**
> (kimi-webbridge's `evaluate` evaluates in the page context and cannot look back at console output that
> already happened).
> The substitute is asserting that the page text carries no error and no hydration hint, plus the table above.
> **This is a residual gap**, recorded in §8.

---

## 8. The G-F4 gate

- [x] all four layers L1–L4 have a report; L2 is a **real browser** (the user's real Chrome driven by kimi-webbridge, not jsdom)
- [x] **none of §5's 11 rows is `not run`** — 8 rows are marked "not applicable + reason" (legitimately),
      **rows 9, 10 and 11 are all "passed"** 2026-09-16, each with a measurement report + a screenshot
- [x] every failure case has a screenshot — `docs/evidence/scenario-9-chain-down.png`,
      `scenario-10-index-down.png`, `scenario-11-data-freshness.png`
      (a transaction hash is **not applicable to all 11 rows**: this project is read-only and sends no transaction)
- [x] console errors "empty or explainable" — §7 records five items. **Console events are still not captured
      directly** (residual gap, see the end of §7); the substitute is asserting that the page text carries no error and no hydration hint
- [x] §1 records who ran it, how, and on what date (the author, 2026-09-16, run from inside the restricted shell,
      with the browser started by the daemon outside the sandbox, **no privilege escalation**)

**G-F4 conclusion**: **passed** — 2026-09-16, the author.

All three applicable rows passed by measurement, each with a re-runnable report and a screenshot. **And row 9's measurement caught a real defect**
(the failure panel smearing viem's whole diagnostic dump across the screen), which was fixed and covered by 3 regression tests; see item 5 in §7.

**How this conclusion changed from "not passed"**: the previous round recorded G-F4 as **not passed**, because although all three rows had their implementation ready
and their wording settled, they had **not actually been run even once** — the reason recorded at the time was "stopping the services would interrupt the live services that other evidence in the same session
depends on". That reason held, and the fix was **a different injection method**: instead of stopping the shared services,
start a console instance that points `VAULT_RPC` / `VAULT_API` at a **port nothing listens on**.
For the code under test that is exactly equivalent to "the service process died" (both are a refused connection),
and not one of the three shared services was interrupted. **This is one concrete return on "classify, do not abandon"**:
the original obstacle was "I have no other way to produce unreachability", when in fact the way had been there all along.

**Residual gaps still recorded honestly** (they do not affect the passing verdict on those three rows):
- end of §7: **console events are not captured directly**. kimi-webbridge's `evaluate` cannot look back at console
  output that already happened, so the substitute evidence is "assert that the page text carries no error and no hydration hint".
- the remaining unverified items in `EVIDENCE-MAP.md` §3 (the accessibility baseline, a non-flat real dataset, whether the coverage gap is unavoidable).

> Path D's I3/I4 reuse this file: I3's step 5 (exact equality) is **passed**, steps 1–4 are not applicable;
> of I4's four classes, two rows are not applicable and two are **not run** (they share their origin with rows 9 and 10 in §5).
