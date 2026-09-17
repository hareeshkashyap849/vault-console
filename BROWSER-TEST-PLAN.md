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
| This project's browser test script | `tools/browser-assert.mjs`. **One command**: `node tools/browser-assert.mjs --url http://127.0.0.1:3121` (the production build; a dev server works too) |
| Who runs it (from outside the restricted shell) | anyone — the script needs only the daemon and a browser, no privilege escalation. **The the author can run it from inside the restricted shell too**, because the daemon starts the browser outside the sandbox |
| Wired into the CI aggregate | **No**, and **deliberately not**. It needs three processes (anvil / the index API / Next dev) plus a real browser. Wiring it in would make the aggregate job's result depend on "did the environment come up", not on the code |
| Browser driven | the user's real Chrome, Profile 3 (with MetaMask 13.48) |
| Date and operator of the most recent real run | **2026-09-16, the author**, result **51/51 passed, 0 failed** (`docs/evidence/browser-assert.txt`) |
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
**Transaction-hash column**: applicable only to rows 3–8, which are the ones that would send a transaction. For rows 9–11, the read paths, it does not apply.

> **Rows 1–8 were rewritten on 2026-09-16, when `/vault/manage` was added.** All eight previously read
> `Not applicable + reason`, and the reason was correct at the time: the interface asked for no wallet and sent
> no transaction. It now does both, so the verdicts are stale.
>
> **The status column distinguishes two things that are easy to run together:**
>
> - `logic proven` — a unit test asserts the decision. `test/wallet-flow.test.ts` and
>   `test/wallet-amounts.test.ts` cover the wrong-chain refusal, the over-balance refusal, the
>   balance-before-allowance ordering, the consumed-allowance case, the four receipt outcomes and the
>   neutrality of a rejection. This is real evidence, and it is evidence about **arithmetic and decisions**.
> - `interaction not measured` — no real wallet has been driven through this case. MetaMask shows a popup and
>   a person clicks Approve, so a program cannot do it. **No row below claims otherwise.**
>
> The wallet available for the browser run was MetaMask on Base mainnet (chain 8453) with **no account
> authorised for the site**, so the page rendered its no-wallet branch throughout. The connected branch
> compiles and typechecks and is asserted for its wording; it has **not been rendered live**.
>
> **Amendment, 2026-09-17: the wallet path was driven by hand against the published console, and two
> transactions landed.** The paragraph directly above is true of the 2026-09-16 runs and false of the
> session recorded here, so it is kept and this amendment is added rather than substituted — the same
> treatment `docs/INDEX-SNAPSHOT-PLAN.md` gives its own superseded text. What follows is the
> measurement, and then the checks that are still open. **No causal account of the session is written
> anywhere below**: the mechanism is not established, and two earlier confident claims from that same
> session had already been disproved by measurement, so a third would be worth less than the two that
> were wrong.
>
> **The measurement — a person drove the published console's wallet page (`/vault/manage`) in a real
> browser, on Base Sepolia (chain 84532), and direct reads of the chain afterwards show:**
>
> - the **allowance moved `0 → 1000000`** base units (1.0 USDC) for the account named below. The
>   approve is confirmed **by state**, not by a receipt captured in the session.
> - the **vault moved from 20 USDC / 20 shares to 21 USDC / 21 shares**, and
>   `0x2aE746C0ff0295c2da1aC338656F247e9758E034` moved from **20 to 21 shares**. That is the result
>   the deposit row asks for, read from the chain rather than read off the page.
> - a **successful transaction
>   `0xbcc9f564938b4b8dc58792a4d47af22e997236ee7492e3ddfa498b263eb36751` (block 46945096) emitted the
>   vault's `Deposit` event**.
> - the account used, `0x2aE746C0ff0295c2da1aC338656F247e9758E034`, is **this workspace's own testnet
>   deploy key**. That identifies whose key was used; it says nothing about how the call was relayed.
>
> **What is NOT resolved, and must not be read as settled by any of the above:**
>
> - **the deposit was executed through an intermediary contract.** The deposit transaction's `from`
>   was `0xC066ac5D385419B1A8c43A0E146fA439837a8B8c` and its `to` was
>   `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`. **Neither is the connected account and neither is
>   the vault**, so the vault's `Deposit` event was not emitted by a direct call from the account the
>   page had connected. What put those two addresses between the page and the vault is **unknown**.
> - **the approve's own transaction hash was never identified.** The allowance change is confirmed by
>   state; the transaction that produced it has not been looked up.
> - **the `Deposit` event's decoded `owner` / `assets` / `shares` have not been read back.** The event
>   is known to have been emitted; its arguments are not recorded.
> - **two different failures were observed earlier in the same session, and are unexplained**:
>   `Chain must support EIP-7702 for sponsored or gas included transaction`, and
>   `insufficient funds for gas * price + value: have 352712045842 want 898152800000`. **Their order
>   and their cause are not established**, and neither is which attempt produced which.
> - **nothing captured the page.** No screenshot, no `tools/browser-assert.mjs` run, and no console
>   capture is behind any of the above. The rendered text of the connected branch — the balance line,
>   the allowance line, the receipt phase, any failure wording — was **not recorded**, so every row
>   below that asserts *wording* is still `not measured` even where the state change it describes is
>   now confirmed by the chain.
>
> **The open checks, in the order they would settle it:**
>
> 1. `eth_getCode` on `0x2aE746C0ff0295c2da1aC338656F247e9758E034` — a `0xef0100` prefix would mean the
>    account carries an **EIP-7702 delegation**, which is one thing that would put a different `from`
>    and a different `to` on a call the page appeared to make.
> 2. identify the two intermediary addresses,
>    `0xC066ac5D385419B1A8c43A0E146fA439837a8B8c` and `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` —
>    whether they hold code, and what they are.
> 3. decode the `Deposit` log of the transaction above (`owner` / `assets` / `shares`).
>
> Until all three are done, the honest reading of the session is: **state changed, a `Deposit` event
> was emitted, and the path from the connected account to that event is not established.**

| # | Failure class | How it is injected | What is asserted (wording + rendered result + state) | Evidence requirement | Status |
|---|---|---|---|---|---|
| 1 | Wallet not installed | Open `/vault/manage` in a browser with no extension | `"No injected wallet was found in this browser. This app uses injected() …"`, and the deposit and redeem controls stay inert rather than accepting input that could never be signed | screenshot: **not run** | **implemented; interaction not measured** |
| 2 | The user refuses to sign (`4001`) | Reject at the MetaMask prompt | A **neutral** line, never a red failure; the form returns to idle and says the user cancelled and nothing was signed. `mapWriteError` checks `4001` first so no later branch can reclassify it | screenshot: **not run** | **logic proven** (`test/wallet-flow.test.ts`: *a user rejection is its own phase, not a failure*, and the nested-cause case); **interaction not measured** |
| 3 | Wrong chain | Wallet on chain 8453, page expecting 31337 | The controls are **disabled with a reason naming both chains** — *"Switch the wallet to chain 31337 — it is currently on chain 8453, where this deployment does not exist. Nothing is sent until it does."* — and **no wallet prompt appears** | screenshot: **not run** + transaction hash: **not applicable, nothing is sent** | **logic proven** (`decideDeposit` → `wrong-chain`, and it outranks an unparseable amount); **interaction not measured** |
| 4 | Insufficient allowance | Fresh wallet, zero allowance, then deposit | The **approve step is offered instead of a deposit**; a deposit that would revert with `ERC20InsufficientAllowance` is never sent | screenshot: **not run** | **logic proven**, including the case where the allowance was consumed and must be re-read; **partly measured 2026-09-17** — a person deposited from a zero allowance and the chain now reports **`1000000`** (1.0 USDC) on the account named in the amendment above, so the approve really did run and change state. **The page's wording was not captured** and the approving transaction's hash was never identified, so the row's own claim about what the form *offers* is still unmeasured |
| 5 | Insufficient balance | Enter more than the wallet holds | The reason carries the **real balance, formatted** (`5555.0759` and the symbol), never the bare word "insufficient"; refused **before** any approval, because an approval needs no balance and approving first would spend gas to learn a free fact | screenshot: **not run** | **logic proven** (`decideDeposit` → `exceeds-balance`, and the balance check is asserted to win over the allowance check); **interaction not measured** |
| 6 | Insufficient gas | Drain the wallet's ETH, then deposit | **No dedicated copy: this is a recorded gap.** The app does not pre-compute gas, so an under-funded wallet fails at the wallet or the node and that error arrives through the failure path | screenshot: **not run** | **not implemented as a pre-flight check**. **One such failure was observed verbatim on 2026-09-17** — `insufficient funds for gas * price + value: have 352712045842 want 898152800000` (see the amendment above) — which is evidence the error does reach the failure path. It is **not** evidence about what this app renders for it: the session left that failure's order and cause unresolved and captured no rendered text |
| 7 | Transaction reverted | Force a revert, or deposit with an allowance that becomes insufficient | `"The chain reverted this transaction."` with the hash **kept** so it can be looked up, and viem's text in a collapsed `detail`. `mapReceipt` maps `'reverted'` to `failed` — **never** to `confirmed`, and never to still-pending | screenshot: **not run** + transaction hash: **not run** | **logic proven**; **interaction not measured** |
| 8 | Transaction replaced (`replaced`) | Replace a pending transaction in the wallet | **No dedicated state: a recorded gap.** It surfaces as an unread receipt — *"The transaction was sent, but its receipt could not be read. It may still be on chain -- the explorer or a node will say which."* — which names the uncertainty instead of claiming a failure | screenshot: **not run** | **no dedicated state; recorded as a gap** |
| **9** | **RPC unreachable** | the console instance's `VAULT_RPC` points at a **port nothing listens on**, `http://127.0.0.1:8547` (the index service stays healthy). Cleaner than stopping anvil: it does not disturb the live chain that other evidence in the same session depends on. Stopping the real anvil is equivalent — either way the console sees a refused connection | ① the `Now` panel shows **"The chain could not be read."**, immediately followed by the sentence **"The chain node at http://127.0.0.1:8547 is not reachable. Check that a node is listening there and that VAULT_RPC points at it."**, and labels it with `endpoint` and `class: unreachable`; ② the page still returns **HTTP 200** (not 500); ③ the **`Then` panel still renders the chart** (one body per candle, no empty state) with `Indexed to block` and `Lag` still shown — this one is the point of the row: it proves the two sources fail independently; ④ the `Two sources` panel shows **"A comparison needs both sources. One of them is unavailable, so this panel does not guess."** | Screenshot: `docs/evidence/scenario-9-chain-down.png`; report: `docs/evidence/scenario-9-chain-down.txt` (exit 0); console: see §7 | **Passed** 2026-09-16 |
| **10** | **API unreachable** | the console instance's `VAULT_API` points at a **port nothing listens on**, `http://127.0.0.1:8788` (the chain stays healthy) | ① the `Then` panel shows **"The index service could not be read."** plus **"The index service is not reachable at http://127.0.0.1:8788/api/candles?bucket=60&limit=5000. It runs as a separate process; start it with \`node --experimental-strip-types src/api/cli.ts\` in the erc4626-vault-dapp repository."** — the sentence **carries the actual request URL**, which is the key to being able to diagnose it; ② the `Now` panel **still shows real on-chain readings** (`944.9241` USDC, `859.021905704231281673` shares, no failure wording); ③ the `Two sources` panel **refuses to answer** | Screenshot: `docs/evidence/scenario-10-index-down.png`; report: `docs/evidence/scenario-10-index-down.txt` (exit 0); console: see §7 | **Passed** 2026-09-16 |
| **11** | **Stale data** | two steps, because **with static readings "a correct implementation" and "a caching implementation" look exactly alike**: ① record `Indexed to block` / `Lag` / `indexer last ran` from the page; ② **actually advance the index** (`node tools/catch-up.mjs --max-runs 1` in `../erc4626-vault-dapp`), then request the same URL again | ① `Indexed to block` moves (**12639 → 12648** in the recorded run); ② `Lag` moves (**97 → 2293 blocks** — the chain head the indexer recorded changed); ③ `indexer last ran` moves (**1h 13m → 0s**); ④ the service's sentence **"lagBlocks is measured against the chain head recorded at the last indexer run, not against the chain now."** is still on the page. **Several values changing at the same time, on a page that was not restarted, is the proof that it re-reads on every request and caches nothing.** The assertion is that each value CHANGED — not what it changed to, since those numbers move with the chain | Screenshot: `docs/evidence/scenario-11-data-freshness.png`; report: `docs/evidence/scenario-11-freshness.txt` (produced by `tools/capture-scenarios.mjs`, which captures both parts, runs the indexer in between, and judges the pair); console: see §7 | **Passed** 2026-09-16 |

> **Why row 11 cannot be run only once**: if the indexer has not moved, a page showing `12580` could be
> either "re-reading on every request" or "caching the first response" — **the two produce identical
> output**. So the evidence has to be **a before/after pair**; a single reading is not evidence.

**The parts that have been run (not among the 11 classes, but facts this file has to record)**

> The 11 classes are classes of failure, not pages. Since the app grew to four routes, one class can
> apply to more than one page and the two do not have to behave the same way — the index being
> unreachable is class 10 on `/vault` (where the chain's figures are still exact and still shown) and
> a different situation on `/history` (which has no second source and must therefore show nothing).
> Both are recorded below rather than folded into one row.

| Scenario | How it was run | Result | Evidence |
|---|---|---|---|
| The full page with both services reachable | `node tools/browser-assert.mjs --url http://127.0.0.1:3121` (the production build) | **51/51 passed**, of which the console's 14 are: HTTP 200, 4 panels, one candle body per candle with **0 NaN** coordinates, `totalSupply` shown as shares, raw uint256 not on the page, the flat-series sentence present, the tooltip carrying the raw strings, no failure wording, no hydration hint. The other 37 cover the landing page, the wallet page and the history page | `docs/evidence/browser-assert.txt` + `docs/evidence/console-live.png` |
| The history page with the index reachable | the same run, section 7d | **17 assertions**: three tables rendered, the count label matches the rows actually painted, the printed tally sum equals the rendered per-kind counts, no raw uint256, no wallet asked for, the nav links all four routes | `docs/evidence/browser-assert.txt` + `docs/evidence/scenario-12-history-up.txt` |
| The history page with the index **unreachable** | `node tools/capture-scenarios.mjs` (server on 3122) | **0 tables rendered.** It says the index could not be read, names the URL, says it has no second source to fall back on, and shows no figures at all — the substitution it exists to avoid | `docs/evidence/scenario-13-history-index-down.txt` |

> **Rows 9, 10 and 11 have all now passed**, and each one has: a measurement report (a re-runnable
> command + its exit code), a screenshot,
> and a statement of "what this row cannot prove". Row 9 additionally caught a real defect; see item 5 in §7.

---

## 6. Path D's I3 / I4 (reusing this file)

**I3 end-to-end (G-I3: the full E2E flow passes in a real environment)**

| Step | Action | Assertion | Evidence | Status |
|---|---|---|---|---|
| 1 | Connect wallet | **Now applicable**: `/vault/manage` offers a connect control, and after connecting it shows the address and the wallet's chain rather than a dash. The connected branch **did render live on 2026-09-17** — a person connected a wallet to the published page and drove a deposit through it (see §5's amendment) — but **nothing captured that render**, so the row's assertion about what the page *shows* is still unmeasured. The 2026-09-16 runs exercised the no-wallet branch only | screenshot: **not run** | **implemented; the connection is confirmed by what followed it, the render is not captured** |
| 2 | Approve | **Now applicable**: a deposit with an insufficient allowance offers the approve step first, and after the approval confirms the allowance is **re-read** rather than remembered | screenshot: **not run** | **logic proven**; **partly measured 2026-09-17** — the allowance moved **`0 → 1000000`** (1.0 USDC), so an approval really was sent and the chain shows its effect. **The approving transaction's hash was never identified**, and "re-read rather than remembered" is a statement about the UI that no capture covers |
| 3 | Deposit | **Now applicable**: `deposit(uint256 assets, address receiver)` with the connected account as receiver. Would be evidenced by a **transaction hash, block number and `Deposit` event**, cross-checked against the chain's `totalAssets` before and after | screenshot: **not run**; transaction hash: **`0xbcc9f564938b4b8dc58792a4d47af22e997236ee7492e3ddfa498b263eb36751` (block 46945096)** | **measured 2026-09-17, on the chain**: the vault moved 20 USDC / 20 shares → **21 / 21**, the account in §5's amendment moved 20 → **21 shares**, and that transaction emitted the vault's `Deposit` event. **What it does not establish**: the transaction's `from` and `to` were neither the connected account nor the vault (so it went through an intermediary), the `Deposit` log's `owner` / `assets` / `shares` were not decoded, and no screenshot of the page was taken — see the amendment above for the open checks |
| 4 | Redeem | **Now applicable**: `redeem(uint256 shares, address receiver, address owner)`, one transaction with no approval | screenshot: **not run** + tx hash: **not run** | **implemented; interaction not measured** |
| 5 | **The page reading exactly equals the chain** | **Applicable and already run**: the assertion reads anvil's `eth_call totalSupply()` (`0x18160ddd`) and compares it with the **share string on the rendered page**. Precision handling: the chain holds a raw uint256, the page holds a decimal string with trailing zeros stripped, and the two are made equivalent through `formatBaseUnits` | **Passed**. Measured: chain `859021905704231281673` ↔ page `859.021905704231281673`. (This row previously printed the chain value as `859021905704281673` — 18 digits, missing `4231`. The raw evidence and a live `eth_call` both give 21 digits; a truncated figure inside a row about exact equality was the worst possible place to have one) | `totalSupply rendered as SHARES…` in `docs/evidence/browser-assert.txt` | **Passed** |

> Steps 1–4 of I3 **were** not applicable while **this project was not the vehicle for an end-to-end
> transaction flow** — that was true when `/vault/manage` did not exist, and the four rows above have
> said "Now applicable" since it arrived, which made this note stale in the opposite direction from
> the rest of the file. **As of 2026-09-17 steps 1–3 are applicable and partly measured** (see §5's
> amendment): the deposit is evidenced by a transaction hash, a block number and a `Deposit` event,
> with the caveats recorded in row 3 above; step 4 (redeem) remains applicable and unmeasured.
> The real end-to-end transaction evidence for a *direct* account-to-vault deposit still lives in
> `erc4626-vault` (real wallet + real chain + a transaction hash you can look up) — what the session
> recorded here adds is that the console's own page was driven at all.
> Step 5 is "exactly equal" — this project **is exact**; it did not settle for "about the same" or "equal after rounding".

**I4 failure scenarios (G-I4: each of the four failure classes has evidence, and the interface must produce a readable error rather than going silent)**

| Failure class | Which row of §5 in this file it reuses | Interface error readability (wording copied verbatim) | Status |
|---|---|---|---|
| RPC down | row 9 | **"The chain could not be read."** + the specific message for that failure (the `Failure` component, `src/components/Panels.tsx` — it moved there from the page when the app grew past one route, so that all four pages render a failure the same way) | **Not run** |
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
- [ ] **none of §5's 11 rows is `not run`** — **NOT SATISFIED as of 2026-09-16, and still not satisfied after 2026-09-17.** Rows 9, 10 and 11 are passed by measurement; rows 1, 2, 3, 5, 7 and 8 have `logic proven` pre-flight decisions and **no measured interaction at all**; row 6 is **not implemented as a pre-flight check** (though one real insufficient-funds error was observed — see §5's amendment); row 8 has **no dedicated state**. **Row 4 and §6's step 2/3 changed on 2026-09-17**: a person drove the published wallet page, and the chain confirms the allowance moved `0 → 1000000` and the vault and the account both moved 20 → 21, with the `Deposit` event on a named transaction — but no screenshot and no decoded log came out of it, so the rows are marked `partly measured` rather than passed, and the amendment in §5 lists what is still open
- [x] every failure case **that has been run** has a screenshot — `scenario-9-chain-down.png`,
      `scenario-10-index-down.png`, `scenario-11-data-freshness.png`, and for the history page
      `scenario-12-history-up.png` (three tables, each stating how much it is showing) and
      `scenario-13-history-index-down.png` (the index gone, and **no** figures rendered at all).
      All five are produced by `node tools/capture-screenshots.mjs`, which names each URL, waits for
      the page's own content, and writes the file — so they can be re-taken after any change. The
      wallet rows have **no screenshot**: rows 1, 2, 3, 5, 7 and 8 have never been run at all, and
      the 2026-09-17 session that did drive rows 4 and 6 (§5's amendment) captured no page at all
- [x] console errors "empty or explainable" — §7 records five items. **Console events are still not captured
      directly** (residual gap, see the end of §7); the substitute is asserting that the page text carries no error and no hydration hint
- [x] §1 records who ran it, how, and on what date (the author, 2026-09-16, run from inside the restricted shell,
      with the browser started by the daemon outside the sandbox, **no privilege escalation**)

**G-F4 conclusion**: **NOT passed — one row is a real gap and four rows need a wallet.** 2026-09-16, the author.
**Amended 2026-09-17, and still NOT passed.** The four wallet rows no longer need a wallet to be
*reached*: a person drove the published wallet page and two transactions landed, which the chain
confirms (§5's amendment). What they still need is a **capture** — a screenshot, the approving
transaction's hash, the decoded `Deposit` log, and an account of how the deposit's `from` and `to`
came to be neither the connected account nor the vault — before any of them can be called passed. Row 6
(insufficient gas) is untouched as a pre-flight gap, and rows 1, 2, 3, 5, 7 and 8 remain unmeasured.

**What is genuinely proven.** 51 browser assertions pass against the **production build** (not just the dev
server), and they are re-runnable with one command: `node tools/browser-assert.mjs --url http://127.0.0.1:3121`.
Fourteen of them are the console's original assertions, unchanged and now at `/vault`; the tool measures how
many of the total are the console's rather than hard-coding the split, so "the console survived the move"
cannot silently become false. Seventeen more cover the history page, including two that read the page's own
arithmetic back off the painted DOM — the count label against the rows actually rendered, and the printed tally
sum against the rendered per-kind counts. The pre-flight decisions behind the wallet rows are proven in unit
tests.

**What is not.** No transaction had been sent from this page when this paragraph was written; **on
2026-09-17 one was, and two transactions landed** (§5's amendment). The four wallet rows in §5 and
the four I3 steps above were `not measured` because MetaMask shows a popup and a person clicks
Approve — a program cannot do it — and for rows 1, 2, 3, 5, 7 and 8 that reasoning still holds
exactly: no person has driven those cases. What changed is rows 4 and 6 and I3's steps 2 and 3, and
what is missing there is not a wallet but a **capture**: the connected branch **did** render live in
that session (the deposit went through it) and **nothing recorded what it rendered**, so every
wording assertion in the wallet rows is still unmeasured even where the chain now confirms the state
change. The paragraph above is kept rather than rewritten because it is the accurate record of the
2026-09-16 position, and the difference between the two is the whole point of this amendment.

**This conclusion was previously `passed`, and that was correct for what the project was.** It was a read-only
console, so the wallet classes genuinely did not exist and rows 9–11 were the whole applicable set. Adding
`/vault/manage` changed what the gate is about, so the verdict moves with it. Changing a recorded verdict
without saying so would be worse than either value.
**Row 9's measurement caught a real defect** (the failure panel smearing viem's whole diagnostic dump
across the screen), which was fixed and covered by 3 regression tests; see item 5 in §7.

**How the conclusion moved, three times.** An earlier round recorded G-F4 as **not passed**, because although rows
9–11 had their implementation ready and their wording settled, they had **not actually been run even once** —
the reason recorded at the time was that stopping the services would interrupt the live services that other
evidence in the same session depended on. That reason held, and the fix was **a different injection method**:
instead of stopping the shared services, start a console instance that points `VAULT_RPC` / `VAULT_API` at a
**port nothing listens on**. For the code under test that is exactly equivalent to "the service process died"
(both are a refused connection), and not one of the shared services was interrupted. That is one concrete
return on "classify, do not abandon": the obstacle was "I have no other way to produce unreachability", when
the way had been there all along.

Then the gate went back to **not passed**, for a different and better reason: the project gained a write path,
so four rows that used to be `not applicable` are now `not measured`. The three read-path rows are unaffected
by that.

**And on 2026-09-17 it stayed not passed for a third and narrower reason.** Someone drove the published wallet
page by hand, so "no person has tried" stopped being the obstacle for two of the rows and for two of I3's steps:
the chain confirms the allowance moved `0 → 1000000` and that the vault and the account both moved 20 → 21 with
the `Deposit` event on a named transaction (§5's amendment). What is still missing is the evidence a reader can
check row by row — no screenshot, no identified hash for the approve, no decoded `Deposit` log, and no
explanation of why the deposit's `from` and `to` were neither the connected account nor the vault. A state change
without a captured interface is a measurement of the **chain**, not of **this page**, and this file does not
count one as the other.

**Residual gaps recorded honestly** (they are separate from the wallet gap above):
- end of §7: **console events are not captured directly**. kimi-webbridge's `evaluate` cannot look back at console
  output that already happened, so the substitute evidence is "assert that the page text carries no error and no hydration hint".
- the remaining unverified items in `EVIDENCE-MAP.md` §3 (the accessibility baseline, a non-flat real dataset, whether the coverage gap is unavoidable).

> Path D's I3/I4 reuse this file: I3's step 5 (exact equality) is **passed**, and steps 1–3 are **applicable**
> (steps 2 and 3 partly measured on 2026-09-17 — see §5's amendment) while step 4 (redeem) is applicable and
> unmeasured — the note at the end of §6 above carries the correction, because an earlier version of this line
> still said steps 1–4 were not applicable after §6's table had begun to say "Now applicable";
> of I4's four classes, two rows are not applicable and two are **not run** (they share their origin with rows 9 and 10 in §5).
