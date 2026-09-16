# Support matrix and sign-off (path B · F5) — vault-console

> **F5 deliverable. Gate G-F5: the client confirms the F1 statements one by one.**
> Basis: the delivery blueprint, §12.2.
>
> **Section 5 of this file has one thing to deal with, stated up front**: this workspace is a
> **portfolio**, not a client project, and **there is no external client**. The template (the F1-F5
> frontend delivery-path skeleton in the private workspace) requires "the client confirms the F1
> statements one by one"; this project cannot do that,
> and will not pretend to. §5 lays the statements out as a sign-off table, signed by the author in the
> double role of "implementer + verifier",
> and the header states plainly **that this is a self-assessment, not sign-off**.

---

## 1. Browser support matrix

**What was measured**: this project has been **measured in exactly one browser** (the user's real Chrome,
driven through kimi-webbridge/CDP).
The other browsers are untested. `untested` and `unsupported` are two different things, and this table keeps them apart.

| Browser | Version | Measured? | Measured result | Note |
|---|---|---|---|---|
| Chrome (the user's real profile, with MetaMask 13.48) | Chromium family, version follows the user's environment | **Yes** | **51/51 assertions passed, 0 failed** | see `docs/evidence/browser-assert.txt` and `console-live.png`. The console's original 14 are unchanged; 17 of the rest cover `/history`, including two that read the page's own arithmetic back off the painted DOM |
| Edge | untested | **No** | — | same Chromium engine, so the behaviour should match in theory, but **without a measurement it is not written as "supported"** |
| Firefox | untested | **No** | — | not installed, not run |
| Safari | untested | **No** | — | no macOS on this machine; `preserveAspectRatio="none"` and SVG behaviour on WebKit are **unverified** |
| Mobile browsers | untested | **No** | — | responsive class names (`sm:` breakpoints) are written in, but **nothing has been measured at any narrow viewport** |

**Unsupported / explicitly not covered**

| Item | Explanation |
|---|---|
| IE / legacy Edge | **unsupported**: it uses `BigInt` (ES2020), `Array.prototype.at`, `??` and `AbortSignal.timeout`, none of them polyfilled |
| No JavaScript | **unsupported**: the page relies on server-side rendering plus client hydration (the chart is `'use client'`). The server-rendered HTML carries the full text of all four panels, but the SVG chart needs hydration |
| **Rendering many candles** | no verified upper bound. 169 measured; the width clamp in `horizontalLayout` at 5000 candles has a unit test, but **the performance of rendering 5000 candles is untested**. (The row previously read, in the source, "candle counts beyond 14 panels" — there is no object in this project that has 14 panels, so the phrase meant nothing. The 14 appears to be a leftover from an earlier draft; the limit that actually exists is candle COUNT, and that is what this row now states) |

---

## 2. Build reproducibility

**One trap has to be stated honestly here**: `next build`'s output **contains timestamps and
content-hashed chunk names**,
so the artifact hash of two builds **cannot be identical in the first place**. Using an artifact hash as
evidence of "reproducibility" is an invalid test.
This project uses **input hashes**:

| Input | Value (measured 2026-09-16) | How it is obtained |
|---|---|---|
| sha256 of `package-lock.json` | `08aedc3ad4dc7c736f503090fcb5a23ad86cb22a5e275ef6a2d19a1b678a2676` | `node tools/build-inputs.mjs` |
| the whole `src/` tree (paths sorted + per-file sha256 folded) | `cbb143131a7d431354492582355c110b52917727516af72f4385ce72bb572449` (11 files) | same as above |
| the whole `test/` + `tools/` tree | `13908126a5b96aca157c7ccecb73cab2bd54bb140d00db974a005d3ffdb88dbd` (17 files) | same as above |
| the four config files (`next.config.ts` / `tsconfig.json` / `tailwind.config.ts` / `postcss.config.mjs`) | `93d0e7c61a3fed6e0b96c2cbc923060481069bcbafacec9ab143273848dfefb6` | same as above |
| Node version | `v24.9.0` | `node --version` |
| npm package-manager version | `11.13.0` (invoked through `node <npm-cli.js>`) | see the workspace's environment capability list |

> **These values go stale the moment the code changes, and they already have once.** The `src/`
> and `test/tools` hashes recorded here originally were `c7513336…` and `41eb52c5…`; they were
> taken before `src/lib/chain.ts` grew its error classification and before
> `test/chain-errors.test.ts` and `tools/scenario-report.mjs` were added. Nobody noticed until a
> later change made the file think about its own numbers again.
>
> **That is worth stating in the document rather than quietly fixing**, because it is the exact
> failure this document exists to catch: a recorded value that no longer matches reality, in a
> section about verifying things. It is also the argument for reading this row as a
> **method**, not as a fact — the durable claim is "run the tool twice and the output matches",
> and the hashes below are one dated instance of it. Re-run to check, do not quote to trust.

**Were the two runs actually done**: **yes, and the results are identical.** Run twice 2 seconds apart, the four hashes are **identical character for character**:

```
lockfile    08aedc3ad4dc7c736f503090fcb5a23ad86cb22a5e275ef6a2d19a1b678a2676
src         cbb143131a7d431354492582355c110b52917727516af72f4385ce72bb572449   (11 files)
checks      13908126a5b96aca157c7ccecb73cab2bd54bb140d00db974a005d3ffdb88dbd   (17 files: test/ + tools/)
config      93d0e7c61a3fed6e0b96c2cbc923060481069bcbafacec9ab143273848dfefb6   (4 files)
```

**So the status of the "build is reproducible" item is `verified (at the input-hash level)`**, with the
evidence in `docs/evidence/build-inputs.txt`.

**What this evidence can prove**: the same source, the same lockfile and the same toolchain → the same set of hashes.
**What this evidence cannot prove**: ① **determinism of the output bytes** — `.next/` contains timestamps and
content-hashed chunk names, so two builds **cannot produce identical artifacts in the first place**, which
is why this check deliberately does not compare artifacts;
② **that the dependencies really were installed from the lockfile** — this check reads the contents of
`package-lock.json`,
not the actual contents of `node_modules/`. If someone edited `node_modules` by hand, the hash would not change.
(`npm ci` would guarantee that, but this project uses `npm install`.)

**Known build constraints** (environment-related, not project defects):

| Symptom | Nature | Explanation |
|---|---|---|
| `next build` reports `spawn EPERM` inside the restricted sandbox, and `.next/BUILD_ID` is missing | **③ environment constraint** | Next 16's Turbopack spawns worker processes at the "Collecting page data" stage, and the restricted sandbox forbids creating named pipes. **With privilege escalation the same command completes successfully**. This is **not** a code problem and **not** a Next defect |
| `npm test` cannot use `node --test test/*.test.ts` | **③ environment constraint** | `node --test` spawns one child process per file and **captures its output through a named pipe**, which under the restricted sandbox is a straight `EPERM`. **Running the test files directly instead** works (the tests then run in-process and spawn nothing); see the comment in `tools/run-tests.mjs`. The same command works outside the sandbox |

---

## 3. Accessibility baseline

**Status: `untested`.** This project has **never run any accessibility audit tool, and has never been verified with a screen reader**.
What is written into the code is **not** evidence.

| Item | What is implemented | Verification status |
|---|---|---|
| Semantic landmarks | `<main>` / `<header>` / `<section>` / `<footer>` / `<dl>/<dt>/<dd>` / `<figure>/<figcaption>` | **untested** (written in, but how assistive technology renders it was never verified) |
| The chart's alternative text | `role="img"` + `aria-label`, whose content is "169 candles of 60 seconds, from 1.1 to 1.1 USDC. Latest close 1.1. The price did not move in this window." | **untested** |
| Colour contrast | dark background + `slate-100`/`slate-400`/`slate-500` text. `slate-500` (`#64748b`) on `slate-950` **may not reach WCAG AA's 4.5:1** | **untested, with a specific suspicion** — this one is not "not measured", it is "by the rule-of-thumb values common tools use, it may not pass". No conclusion is written before a tool has measured it |
| Keyboard reachability | the page **has no interactive controls** (no button, no input, no link), so there is no tab-order problem; the candle tooltip is a `<title>`, **reachable neither by keyboard nor by touch** | **untested**, and the tooltip's reachability is **known to be limited** |
| Reduced-motion preference | there is no animation, so `prefers-reduced-motion` does not apply | **Not applicable + reason** |
| Text scaling | Tailwind relative units are used (`text-lg` and so on) | **untested** |

> This section **has to say something**, and it says **six rows: five marked `untested`, one not applicable with a reason**.
> (The sentence previously read "seven rows, six of which are `untested`" — counted from memory, not from the table.
> It is corrected here to the measured values. In a document whose whole purpose is that claims match evidence,
> a wrong count is not a typo: it is the failure mode the document exists to prevent.)
> Writing "accessibility support is implemented" would be exactly the kind of record this project's discipline forbids.

---

## 4. Error-wording review

Each row copies the wording out of the implementation verbatim and checks whether it **points at the right fix**.

| Scenario | Wording, copied from the source | Review conclusion |
|---|---|---|
| Chain unreadable | `The chain could not be read.` + the specific message for that failure | ✅ it points at "the chain is the problem", and attaches the raw message for further diagnosis |
| Index service unreachable | `The index service is not reachable at <URL>. It runs as a separate process; start it with \`node --experimental-strip-types src/api/cli.ts\` in the erc4626-vault-dapp repository.` | ✅ **carries the actual URL** (otherwise "unreachable" cannot distinguish "not started" from "started on the wrong port"), and gives the command that starts it |
| The index service refuses | the service's own `error` + `hint`, **verbatim**, joined with ` — ` | ✅ no rewriting, no wrapping. The service knows better than the console why it refused |
| The index returns non-JSON | `The index service answered, but not with JSON. That is usually a proxy answering instead of the service.` | ✅ it names the most common real cause (a proxy answering) instead of a vague "malformed response" |
| **The URL was never constructed at all** | `The console built an invalid URL for the index service: <URL>. This is a bug in the console, not a problem with the service -- relative paths only resolve in a browser.` | ✅ **this project added this one on purpose**. The first version filed this case under "the service is unreachable" and sent the reader off to restart a service that had been **running the whole time** |
| Deployment record missing | `No deployment record found. … Tried:\n  <path>\n  <path>\nSet VAULT_DEPLOYMENT to point at one.` | ✅ it lists **which paths were tried**, so the reader can compare directly |
| A field is missing from the deployment record | `The deployment record at <path> has no "<field>". Refusing to guess an address.` | ✅ it says "refusing to guess" — which is exactly why this error exists |
| Amount not parseable | **the string is displayed as it is** (no `—`) | ✅ deliberate: showing `—` would **hide the disagreement in data shape between the service and the console**, and the raw string is what someone debugging needs to see. `EVIDENCE-MAP.md` records this as one of its "what it can prove / what it cannot prove" rows |
| No price history | `No price history in this window.` | ✅ **different wording** from "the price did not move" (the latter being `the price did not move in this window`). The two must be distinguishable: one is no data, the other is data that is very flat |
| The two sources are not both available | `A comparison needs both sources. One of them is unavailable, so this panel does not guess.` | ✅ it says plainly "does not guess", rather than padding a comparison out of one-sided data |

> All 10 were read out of the source and copied verbatim. Item 5 is **new** in this project (a direct product of the original defect).

---

## 5. Statement-by-statement sign-off table

> ⚠️ **This table is the author's self-assessment, not client sign-off.**
> This workspace is a portfolio and **has no external client**. The template requires "the client confirms the F1 statements one by one";
> this project **cannot** do that, and does not write a self-assessment as a client signature — that would be a record this project's discipline forbids.
> The header states the verification method, so a reader can judge the weight of each piece of evidence themselves.

| F1 id | Acceptable statement (summary) | Verification method | Where the evidence is | Status | Signed (who / when) |
|---|---|---|---|---|---|
| UI-01 | all 4 panels are present and there is no failure wording | **real browser** (the rendered DOM) | `browser-assert.txt` → `the four panels rendered`, `no service-failure panel is showing` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-02 | `totalSupply` is shown as shares, the raw uint256 is not on the page | **real browser + real chain** (the expected value comes from `eth_call`) | `browser-assert.txt` → the two entries | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-03 | `totalAssets` is shown as `944.9241` and not as `944,924,100` | pure functions + browser | `tests.txt` (the format group) + `console-live.png` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-04 | when the two sources are not both available, `Two sources` refuses to answer | **measured** (once in scenario 9 and once in scenario 10) | `docs/evidence/scenario-9-chain-down.txt`, `scenario-10-index-down.txt` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-05 | the chain is unreachable and `Then` still works | **measured**: `VAULT_RPC` points at the dead port 8547 | `scenario-9-chain-down.txt` (`Now` errors, `Then` still renders 174 candles), `scenario-9-chain-down.png` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-06 | the index is unreachable and `Now` still works | **measured**: `VAULT_API` points at the dead port 8788 | `scenario-10-index-down.txt` (`Then` errors **with the actual URL**, `Now` still shows `944.9241` / `859.021905704231281673`), `scenario-10-index-down.png` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-07 | a flat series draws as a horizontal line down the middle, with 0 NaN coordinates | **real browser + pure functions** | `browser-assert.txt` → `NO NaN coordinates`; `tests.txt` (the chart-geometry group) | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-08 | the flat series is stated outright | **real browser** | `browser-assert.txt` → `the page says the price did not move` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-09 | the coverage-gap sentence appears verbatim | contract (the service really does send that field) + the source rendering it verbatim. **the browser assertion covers only the "flat series" sentence, not this one** | `tests.txt` (the contract group) | **Partially passed** | the author / 2026-09-16 (self-assessed) |
| UI-10 | the tooltip carries the service's raw strings | **real browser** | `browser-assert.txt` → `a candle tooltip carries the exact stored strings` | **Passed** | the author / 2026-09-16 (self-assessed) |
| UI-11 | the read-only statement appears in the footer | the source renders it + visual inspection of `console-live.png` | `docs/evidence/console-live.png` | **Passed** (visual inspection, not an assertion) | the author / 2026-09-16 (self-assessed) |
| UI-12 | the header shows the deployment record path | same as above | `console-live.png` | **Passed** (visual inspection, not an assertion) | the author / 2026-09-16 (self-assessed) |
| **Added** | **Data freshness** (not listed in F1, but required by `FRONTEND-SPEC.md` §4 item 4 and iron rule 2) | **measured**: after advancing the index, the same page request returns new values | `scenario-11-freshness.txt` (`Indexed to block` 12580→**12639**, `Lag` 0→**97**, `last ran` 5m11s→**4s**) | **Passed** | the author / 2026-09-16 (self-assessed) |

**Count**: 12 rows + 1 added = **11 passed** (2 of them by visual inspection only), **1 partially passed** (UI-09), **0 not run**.

> How UI-04 / UI-05 / UI-06 went from "not run" to "passed" is worth recording:
> the injection method changed from "stop the shared service" to "start an instance pointed at a dead port".
> For the code under test the two are equivalent (a refused connection), but the latter does not interrupt
> the live services that other evidence in the same session depends on.
> **The original obstacle was not a capability problem; it was "how to inject" thought about too narrowly** —
> and the three long-unverified items in `EVIDENCE-MAP.md` §3 all trace back to the same narrow idea of injection.

---

## 6. Outstanding items and risk acceptance

| # | Item | Why it was not done | Risk | Accepted by |
|---|---|---|---|---|
| ~~1~~ | ~~**measured independent failure of the two sources** (covers UI-04/05/06)~~ | **resolved 2026-09-16**: the injection switched to "an instance pointed at a dead port", and scenarios 9 and 10 passed by measurement | — | — |
| ~~2~~ | ~~**build reproducibility** (two builds compared by input hash)~~ | **resolved 2026-09-16**: `tools/build-inputs.mjs` run twice, the four hashes identical character for character | — | — |
| ~~6~~ | ~~**`dynamic = 'force-dynamic'` takes effect**~~ | **resolved 2026-09-16**: scenario 11 proves it with a before/after pair (`Indexed to block` 12580→12639, `Lag` 0→97, `last ran` 5m11s→4s) | — | — |
| 3 | **the accessibility baseline** | no audit tool installed, no screen reader used | medium. the contrast of `slate-500` on the dark background **may not reach AA**; the tooltip is not keyboard-reachable | the author |
| 4 | **only an indirect check of the real browser's console** | kimi-webbridge's `evaluate` cannot look back at console output that already happened in the page context | low — the substitute is "the page text carries no error and no hydration hint". But **an uncaught exception that leaves no textual trace would not be found** | the author |
| 5 | **a non-flat price dataset** | the price in the local vault is `1.1` throughout (each yield report raises `totalAssets` proportionally and mints no shares) | low — the non-flat path is covered by unit tests on synthetic candles. But **no real data has gone down that path** | the author |
| 7 | **whether the coverage gap is unavoidable** | no archive node was swapped in to check the service's claim | low — but this **rests on the service's own statement**, which this project has not verified independently | the author |
| 8 | **timeouts / 429 rate limiting / TLS errors** | the local environment (an unstable SOCKS5 proxy, local ports that require `NO_PROXY`) makes experiments of that kind unreliable | medium — only one form of unavailability has been measured: "the connection was refused". **Note**: that is exactly the form scenarios 9/10 measured; timeouts and rate limiting are still untested | the author |

> Of the original 8 items, **three are resolved** (1, 2, 6), and the remaining **5** are accepted by the author in the role of **portfolio author**.
> **There is no written client acceptance** — because there is no client. This is the largest difference between this file and the template, and it is written in the most visible place.
> One other significant change: **the error wording on the failure path was found to be unreadable under measurement** (the viem diagnostic dump smearing the screen),
> which was fixed and covered by 3 regression tests. **That one is the classic "only measurement finds it" case** —
> in the source it is just `error.message`, and reading the code shows nothing.

---

## 7. The G-F5 gate

- [x] browser support matrix: `untested` and `unsupported` kept apart (§1), and the single browser that was measured is named
- [x] build reproducibility: **the right test was chosen** (input hashes, not artifact hashes) and it **was run twice** → the four hashes identical character for character
- [x] accessibility baseline: §3 writes `untested` honestly and names the two **specific suspicions**, contrast and the tooltip
- [x] error-wording review: 10 rows copy the source verbatim (§4), **and item 5 was added because of a measurement** (classifying and wording the chain-side error)
- [ ] **the client confirms the F1 statements one by one** — **cannot be satisfied**: there is no external client. §5 is self-assessed by the author, with its nature stated explicitly
- [x] outstanding items and risk acceptance: 3 of the original 8 are resolved, and each of the remaining 5 has "why it was not done" and an acceptor written out (§6)

**G-F5 conclusion**: **passed (self-assessed)** — 2026-09-16, the author.

**Of the three conditions listed in the previous round, two are now satisfied**:
1. ~~the 4 `not run` rows in §5 must be re-run and changed to passed or to an explicit not-applicable~~ → **done**: UI-04/05/06 passed by measurement,
   and §5 now has **no row that is "not run"**, plus one added data-freshness row.
2. ~~the build reproducibility in §2 must actually be run twice with both input hashes recorded~~ → **done**: the two runs produced identical hashes.
3. the accessibility in §3 **still needs** one measurement with a tool, answering at least "does `slate-500` on `slate-950` reach AA".
   **This condition is not satisfied**, so this file's "passed" carries that reservation.

**On the "client confirmation" item**: the template lists it as one of G-F5's criteria, and this workspace **cannot satisfy it by construction**.
Following the delivery blueprint's §12.1 discipline ("anything not applicable must still be written out with a reason; **a blank does not count as a declaration**"),
it is marked here explicitly as unsatisfiable, with its reason, rather than left blank or filled in with a forged signature.

> What comes after this step is outside this file's scope: after F5, path B of the blueprint's §12.2 moves into
> path D's I1–I5 (integration/deployment). The status of this project's I phases is in `BROWSER-TEST-PLAN.md` §6.
