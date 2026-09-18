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
> The doubles in it come to **two**: the replacement of `fetch` in `test/api.test.ts`, and — **added
> 2026-09-18, and the sentence above is kept because it was true when it was written** — a **stub
> EIP-1193 provider** in `tools/wallet-double-assert.mjs`. There is also **one thing that is not a
> double but needs explaining** (the fixtures), see §2.
>
> **Why the second one was added, in the terms this file uses.** The write path was asserted as
> `logic proven, interaction not measured` (`BROWSER-TEST-PLAN.md` §5, rows 2–8) *because* a wallet
> prompt cannot be driven by a program. Then a person clicked the published page and found two
> defects in that unmeasured seam: a rejected prompt was reported as a sent transaction, and the
> wrong-chain guard could not fire, so an `approve` was put in front of a wallet on a chain the
> deployment is not on (the fourth amendment in that file records both, and commit `413ce8e` fixes
> them). **"Unmeasured" was not a neutral state; it was where the defects lived.** The stub is the
> smallest double that closes it: the four EIP-1193 methods the write path actually depends on, with
> the two answers the defects need. What it still cannot do is in §3, and it is not a small caveat.

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
| **The stub EIP-1193 provider** (`tools/wallet-double-assert.mjs`, installed into the page with CDP `Page.addScriptToEvaluateOnNewDocument` before any page script runs) | **the wallet itself** — MetaMask, as `window.ethereum`: its account, its chain, and its answer to a send | **① that a prompt is shown at all** — the stub answers `eth_requestAccounts` immediately, where a real wallet waits for a person; **② signing** — there is no key and no signature; **③ the relay** — a real wallet may submit through its own RPC and its own account abstraction (this browser's MetaMask, on 2026-09-17, put a **delegation manager** between the page and the vault), and the stub does none of that; **④ every method this app does not call**, which the stub answers `-32601` and records | **The behaviour under assertion is the PAGE's**, not the wallet's: what the page renders after a `4001`, whether it offers a control while the wallet is on another chain, and whether it asks the wallet to send. For those three the stub is not a simplification — it is the wallet's own half of the exchange, and it is **stricter** than a real wallet in the one place that matters here: it records every call, so "no write was attempted" is a measurement rather than an absence. What it cannot hide: it cannot make a wrong page look right, because the assertions read the rendered DOM | **A hand-written copy** (the stub is inside `tools/wallet-double-assert.mjs`, next to the assertions it serves) | Trigger: when **the injected connector's method set changes** (wagmi's `injected()` calls `wallet_requestPermissions`/`eth_requestAccounts`/`eth_chainId`), or when **viem changes how a send is issued** (`eth_sendTransaction` vs `wallet_sendTransaction`). Owner: the author. The log the stub returns names every method it was asked for, so a change shows up in the run's own output | **Acceptable (for the page-level claims it is used for)**. See §2 and §3 for what is compared and what stays unverified |
| **The fixture files** (`test/fixtures/*.json`) — **strictly speaking not a double** | the index service's **live** response | temporality: it is a response snapshot from **one moment**, and the service changes afterwards | **It hides nothing**: it is not hand-written, it is the service's output **captured verbatim** by `tools/capture-fixtures.mjs` (only re-indented to make diffing easier). So it does not, like a hand-written sample, "encode the author's misunderstanding twice". And the risk of "going stale" is covered by `test/contract-live.test.ts` re-fetching directly from the **live service** | **A product of the real implementation** (the service's real bytes) | Trigger: when **the service's response shape changes**, run `node tools/capture-fixtures.mjs` to re-capture. Owner: the author | **Acceptable** — under the template's source-priority ordering it is tier 1, "the recorded original of a real response", not tiers 2 or 3 |
| **No fake chain / no fake RPC / no fake timer / no DOM stub** | — | — | — | — | — | **Not applicable**: the console's only on-chain interaction is `eth_call`, and where a real dependency can be run it is run rather than faked (a real anvil in the local runs, `https://sepolia.base.org` against the export); the interface layer is not verified by jsdom (**there is no jsdom dependency**), it is covered by real browser assertions; there are no timers that would need a fake timer |

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
| the stub EIP-1193 provider — **the method set** | **The comparison that CAN be made, and it was made**: the stub was written from the connector's own source (wagmi's `injected()` calls `wallet_requestPermissions`, then `eth_requestAccounts`, then `eth_chainId`; viem issues `eth_sendTransaction` for a JSON-RPC account), and the calls it received on the **published page** are exactly those — `eth_accounts, eth_accounts, eth_chainId, eth_chainId, eth_chainId, eth_sendTransaction` in the rejection run. So "the stub answers what the app asks" is a measurement of the app, not an assumption about the wallet (`verification/out/wallet-double-assert-LIVE-after-deploy.txt`) | the author | **Built** |
| the stub EIP-1193 provider — **prompt, signature, relay** | **Cannot be done as a double**: a real prompt needs a person and a funded key, and this repository's rule is that no script sends a transaction. **What the stub covers instead, so this list is as short as it can be** — every one asserted in `tools/wallet-double-assert.mjs`: a declined send (`4001`), a wallet that drops mid-flight (`4900`), a wallet reporting no account (`eth_accounts` → `[]`), and both ways a chain switch fails (`4902` "unrecognized chain", which the app answers by OFFERING the chain, and `4001` "declined"). **What is left for a person is §2a, and it is four steps** | the author | **Partly unverified** — the rendered wording is measured for every class the stub can produce; the real prompt, the real signature and the real chain are not |

**The priority order for where a double is loaded from** (higher is better):

1. **The real implementation** ← the fixtures belong here (the recorded original of a real response)
2. **A shared hand-written double** ← none
3. **A one-off double specific to this test** ← `stubFetch` belongs here. **The reason**: it is reused
   by 6 tests, but only **within one file**; promoting it to a shared location needs a second
   consumer, and there is not one. It carries dense comments (every rule says "why"), which meets
   the "write it once, comment it densely" requirement.

---

## 2a. THE MANUAL LIST — what genuinely needs a person and a wallet, and nothing else

> **A person can do all four steps in a few minutes, and these are the only rows left that no
> automation reaches.** Everything the stub can now produce was REMOVED from this list when the stub
> learned to produce it: a declined send, a mid-flight disconnect, and both chain-switch failures are
> measured by `node tools/wallet-double-assert.mjs` (40 assertions in its default run, all passing on
> the published site, 5 of them failing on the code before the fix). See `BROWSER-TEST-PLAN.md` §5's
> fifth amendment.
>
> **Each step says three things**: what to do in MetaMask, what the page must show, and what to
> record. Record into `verification/out/manual-wallet-<date>.txt` (a workspace path, not a client
> deliverable) — one line per step, plus a screenshot of the page after the step.
>
> **Preconditions, once**: MetaMask on **Base Sepolia (84532)** with a USDC balance and a little ETH
> for gas; `https://hareeshkashyap849.github.io/vault-console/vault/manage/` open; and the vault
> allowance at `0` (the page shows it; if it is not `0`, deposit once first, which consumes it).
> **Steps 1, 2 and 4 send no transaction.** Step 3 sends two, deliberately — an approve, and then the
> deposit it enables — and it is the only step in this file that sends anything.
>
> **STATUS, 2026-09-18: all four were driven by a person and measured, and ONE OF THEM HAD TO CHANGE
> SHAPE TO BE RUNNABLE AT ALL.** Steps 1, 3 and 4 ran against the published site; step 2 could not be
> run as written — see its row, which now states the executable form and the measurement that says why
> the old one was impossible. Everything measured, including the transaction hashes, the decoded events
> and the captures, is in `verification/out/manual-wallet-2026-09-18.txt`; `BROWSER-TEST-PLAN.md` §5's
> sixth amendment is the record in the project's own files.
>
> **What the four still do not establish, said plainly and unchanged in spirit:** none of them shows the
> **code** a real wallet returns on the write path. The switch path's `4001` was captured from an
> instrumented `window.ethereum.request`; on the write path the page's rendered cancellation panel is
> what was read, and that panel is the branch `4001` alone reaches. Nor do they explain why the wallet
> relayed this session's approve through the EIP-7702 delegation path and sent the deposit directly —
> the 2026-09-17 session had it the other way round, so both routes are now identified for both writes
> and the choice between them is still open.

| # | What to do in MetaMask | What the page must show | What to record |
|---|---|---|---|
| **1** | Enter `1` in the deposit field, click **`1. Approve USDC`**, and at the prompt click **Reject**. | The write panel headed **`You cancelled this(approve)`** and the sentence **"You cancelled this in the wallet, so nothing was signed and nothing was sent. The form is back where it was; no gas was spent."**, with the control back to **`1. Approve USDC`** and enabled, and **no transaction hash anywhere**. | The panel's text verbatim; a screenshot; and the account's nonce from `https://sepolia.basescan.org/address/<your address>` **before and after**, which proves no transaction was created. |
| **2** | **THIS STEP CANNOT BE RUN AS ORIGINALLY WRITTEN, AND THE WALLET'S OWN PERMISSION STORE SAYS WHY (measured 2026-09-18).** Approving MetaMask's **connect** prompt grants the site `endowment:permitted-chains` covering **every network the wallet holds** — on this wallet, eleven of them, `0x14a34` among them — and a site that already holds a chain is switched to it **silently**, so there is no prompt to reject. **The executable form**, which is what was driven: make a **switch request, not a connect, the origin's first approval**. That grants exactly the chain it names, leaving `84532` as the one chain that still needs a window. On a fresh origin (same build, served from `out/`): approve the first window (a switch to another network — this also connects the account), and the app's own `Switch to chain 84532` then raises the real prompt. | Under the wallet panel: **"The chain switch was cancelled in the wallet, so the wallet is still not on chain 84532 (Base Sepolia). Nothing is sent until it is."** Both chains are named, the switch control is still offered, and **no write control is offered**. | That sentence verbatim; the wallet's chain and its permitted-chain list **before and after** (it must not gain `0x14a34`); the account's nonce before and after (it must not move); and a capture of the request in flight. **Measured**: the app sent `wallet_switchEthereumChain {"chainId":"0x14a34"}`, MetaMask answered `4001 "User rejected the request."`, the page rendered the sentence, the wallet stayed on its chain, `84532` was not added to the permitted list, and the nonce read `6 → 6`. Captures: `verification/out/step2-switch-pending-2026-09-18.png` and `verification/out/manual-wallet-step2-cancelled-2026-09-18.png`. **This is the only step that measures a real switch refusal** — the stub can produce the error, but not the prompt |
| **3** | Switch back to **84532**, enter `1`, click **`1. Approve USDC`**, **Approve**, wait for `Confirmed`, then click **`Deposit`** and **Confirm**. | After the approval: **"Approval confirmed. The allowance is re-read from the chain before the deposit is offered."** and the form offering the **deposit alone**, under *"The allowance already covers this deposit, so only the deposit transaction is needed."* After the deposit: **"Deposit confirmed on chain."** with a `transaction 0x…` line. | Both transaction hashes, then re-open the page and record the rendered allowance and share balance, cross-checked against the chain. **This is the only step that measures a real signature, a real broadcast and a real receipt. MEASURED 2026-09-18 on the published site**: approve `0x71b0dfb1…` (block 46,971,112, USDC `Approval` = `1000000`, spender the vault); deposit `0x8f114b1d…` (block 46,971,145, `type 0x2`, nonce 6, `deposit(1000000, 0x2aE7…E034)`, logs: USDC transfer, share mint, `Deposit(sender = owner = 0x2aE7…E034, assets = 1000000, shares = 1e18)`). Chain before → after: nonce `6 → 7`, account USDC `18 → 17`, shares `22 → 23`, allowance `0 → 1000000 → 0`, vault `22 → 23`; the reloaded page reads `17 USDC / 23 shares / allowance 0`. **The approval was relayed** (`from 0xb01caea8…`, `to 0xdb9b1e94…` the `DelegationManager`, with the encoded `approve` inside its event) **while the deposit was sent directly**, which is why the nonce moved by one and not two — the route is named, the reason for it is not |
| **4** | With MetaMask **open and unlocked**, enter an amount, click the approve, and **press Reject with the extension window in the foreground**. | As step 1. | The panel text and a screenshot **of the MetaMask window beside the page** — the one thing no script can capture: that MetaMask's own prompt was on screen when the page said what it said. **MEASURED 2026-09-18 for the prompt half**: `verification/out/screen-metamask-prompt.png` is a full screen showing MetaMask's spending-cap request (1 USDC, spender the vault, network Base Sepolia, "请求来自 hareeshkashyap849.github.io") with the page behind it in its pending state, `Waiting for the wallet…`, and `vault allowance 0 USDC (read from the chain, never remembered)`. **What it is not** is a capture of the rejection being clicked: the two wallet captures in the set are the pending state and the state after the refusal, and photographing the click itself is not something any tool here can do |

**Why these four and no more.** Each needs something no program has: a person's decision at a prompt
(1, 2, 4), or a signature from a funded key and a chain's acceptance of it (3). Every other row in
§5's matrix is either a read-only path (rows 9–11, passed by measurement) or an error class the stub
now emits — and a class the stub emits is a class already asserted, so asking a person to repeat it
by hand would be asking them to re-measure evidence this repository already holds.

**What these four still do NOT prove**, said plainly, and **narrowed rather than retired on 2026-09-18**:
the **switch** path's refusal is now a real MetaMask `4001` captured from the page's own wallet traffic,
so "the stub can produce the error but not the prompt" is answered for that one path. What is still not
on record is the **write** path's code — there the page's rendered cancellation panel is the evidence,
and the panel is the branch `4001` alone reaches — and the underlying question the whole file is about
stands where it stood: **no run here shows the full set of codes a wallet produces for each failure**,
only that this page words the ones it receives correctly. Nor do these four explain the relay route
(step 3). None of that is a reason to stop: it is the list a reader should assume is still open.

---

## 3. Consistency check against `EVIDENCE-MAP.md` §3

The template requires: **no "claim about the real chain" may be supported by a double alone.**

| Claim about the real chain / real environment | The evidence supporting it | Is it supported by a double alone |
|---|---|---|
| the interface's reading equals the on-chain value | a real browser + the real anvil `eth_call` (`browser-assert.mjs`) | **No** |
| coordinates under real rendering are not NaN | a real browser reading the SVG attributes of the rendered DOM | **No** |
| the service response's real field names and shape | live re-fetch (`contract-live.test.ts`, `api-against-real-service.test.ts`) | **No** |
| the page answers 200 over HTTP, and the HTML is not an error page | a real HTTP request (`fetch(PAGE)`) in `browser-assert.mjs` | **No** |
| the page's own JavaScript really reads `api/config` and the chain — **not** what it reads on the server | `browser-assert.mjs` drives a real browser; the static export has no server-side render to assert against, and the 51 assertions written for the server-rendered pages have **not been re-run against the export** (`docs/STATIC-EXPORT-MIGRATION.md`, "Also not done") | **No**, but also **not yet re-measured for the export** |
| `fetch` failures are split into three classes | the double (`stubFetch`) + the comparison against a real 4xx | **No** (there is a comparison) |
| the page answers a **rejected** prompt as a cancellation, and refuses to write while the wallet is on another chain | the stub provider injecting the wallet's answer, into the **published page**, in a real browser (`tools/wallet-double-assert.mjs`, 40/40 in its default run after the fix; **5 of the 40 fail on the code before it**, from a local build with only the source fix stashed) | **Yes, and the claim is about the PAGE rather than about the chain** — the stub is what supplies `4001` and the foreign `chainId`, and the assertion reads the rendered DOM. Stated plainly: **no double here can show that MetaMask produces those answers**, and none is claimed to. **Updated 2026-09-18, and this verdict now splits in two.** For the **switch** path a real wallet's answer was measured rather than stubbed — the app sent `wallet_switchEthereumChain {"chainId":"0x14a34"}`, an instrumented `window.ethereum.request` recorded MetaMask's reply as `code 4001, "User rejected the request."`, and the page rendered the sentence this row is about — so that half is **not** supported by a double. For the **write** path the row stands exactly as written: what is measured there is the page's rendered cancellation panel, and that panel is the branch `4001` alone reaches, which implies the code without having recorded it. **The verdict for this row is therefore split: No for the switch refusal** (the wallet's own reply was captured rather than stubbed), **and Yes, unchanged, for every other class in it** — those still come from the stub, and from `test/wallet-errors.test.ts` against the shapes real viem builds |
| **a disconnected wallet and a failed chain switch are NAMED as themselves** (added 2026-09-19) | the stub emitting EIP-1193 `4900` and `4902`/`4001` on `wallet_switchEthereumChain`, into the page, in a real browser — **5 of these assertions fail on the code before the fix from a local build with only the source fix stashed**, and 9 fail against the published page | **Yes, for the page's own rendering** — the classes come from the stub, so what is proven is that *this app* classifies and words them (`src/lib/walletError.ts`, `src/lib/walletFailureCopy.ts`), not that a wallet emits them. **The classes themselves are separately asserted against the error shapes viem 2.56.5 actually builds** (`test/wallet-errors.test.ts`), captured by driving viem's own `writeContract` against a transport that refuses (`verification/out/viem-error-shapes-2.56.5.txt`) |
| **`cache: 'no-store'` really is sent** | the double captures the `init` object | **Yes — supported by a double alone**. Explicitly marked "partly unverified", with real-environment check steps given |
| **the "insufficient gas" class is classified, not printed raw** (`BROWSER-TEST-PLAN.md` §5 row 6) | `test/wallet-errors.test.ts` against **the error shapes viem builds** | **Partly — and this is the honest limit of the whole taxonomy double.** The class is proven from real viem error objects; that a WALLET produces them in a browser is not. Measured why: driven in Node against viem 2.56.5 the refusal reaches `mapWriteError`, but driven in the browser through this stub the same refusal is answered by the app's own RPC instead (`eth_call` in the app's transport log, no error at the wallet), so the stub cannot make the page report a gas refusal. A real under-funded wallet is the only instrument that can — which is why §5 row 6 stays open |
| **a wallet that reports no account renders no address** (added 2026-09-19) | **nothing — and this row is the double's own failure, recorded as such.** The scenario was written, run against the published page, and it FAILED there, which was first read as a third defect. Four further runs and a probe of the page's own providers showed the truth: **on the published origin the stub loses `window.ethereum` to the user's real MetaMask extension**, so the wallet answering `[]` is not the wallet wagmi reconnected from. The instrument was measuring the wrong wallet. **No defect is claimed, no run reproduces one, and the code change first written for it was reverted** after an A/B showed the guard passes without it | **No — explicitly not supported.** The guard's assertions pass on the old code too, so they prove nothing about a fix; they can only fail if the invariant breaks later |
| ~~`dynamic = 'force-dynamic'` takes effect~~ | **RETIRED 2026-09-17 — and it now has an assertion, which is not the same as the evidence it had.** The mechanism is gone: the pages are client components in a static export and no longer export `dynamic = 'force-dynamic'` (`docs/STATIC-EXPORT-MIGRATION.md`). What covers "nothing between the reader and the service is cached" instead: the `no-store` row above (a unit test, **supported by a double alone**) plus `staleTime: 0` / `refetchOnWindowFocus: true` in the `QueryClient`'s `defaultOptions` (`src/app/providers.tsx`) and four `useQuery` reads in `src/app/vault/page.tsx` | **No — and no longer "no evidence" either**. It is structural (a configuration in the source) plus the double-backed `no-store` row. The 2026-09-16 measurement that used to stand here (scenario 11, a before/after pair against the running server) measured a mechanism that no longer exists, so it is **not** evidence for the current code |

> Both claims supported only by a double (or with no evidence at all) are called out in the table
> above, and neither one is written as "verified". The second row changed shape on 2026-09-17: the
> `force-dynamic` declaration it was about is gone, and what replaced it is the `no-store` unit test
> above plus a setting in the source — **a weaker form of evidence than the measurement it replaced,
> and marked as such rather than counted as an improvement** (`docs/STATIC-EXPORT-MIGRATION.md`).

---

## 4. Gate G-F2 (this file's part)

- [x] Every double says what it simplified, and none of them simplified away behaviour an assertion depends on
  — what `stubFetch` simplified away is **the real transport**, while what is asserted is **URL construction** and **failure classification**; the two are not at the same level (see the note in §1). The `no-store` item genuinely was simplified away and is marked unverified
- [x] The verdict column has no empty "unacceptable"; unacceptable ones were fixed or recorded as risk (no "unacceptable" entries)
- [x] Every double has a comparison test, or a written reason why it cannot + manual check steps (§2 has all three rows)
- [x] All the example rows are deleted (the placeholder used by the document template)
- [x] Consistent with `EVIDENCE-MAP.md` §3: checked row by row, the two "supported by a double alone" claims are named

**G-F2 conclusion**: **passing (self-assessed)** — 2026-09-16, the author; **re-assessed 2026-09-18 for the
second double** (the stub EIP-1193 provider), which was added after a person found two defects in the
write path's unmeasured seam; **re-assessed again 2026-09-19, when that double was extended to every
failure class a wallet's EIP-1193 surface can produce without a signature.** The extension found two
more defects in the same seam — a disconnected wallet printed as a nameless failure, and a failed
chain switch that rendered no message at all — and both are fixed in `src/lib/walletError.ts` and
`src/lib/walletFailureCopy.ts`.
2 doubles in total + 1 "recorded real response", each with a comparison test or an explicit unverified
record — the wallet double's prompt/signature half is the explicit unverified record, and its method
set is the comparison test.
**Not client acceptance**; the reason is in `SUPPORT-AND-SIGNOFF.md` §5.

> **Addendum, 2026-09-19: the manual list was cut from "the two outcomes the stub asserts, written
> down as a repeatable check" to four steps in §2a, and the stub absorbed the difference.** The
> current split is: the stub measures every error class a wallet's EIP-1193 surface produces without
> a signature; a person measures the prompt, the signature and the chain's acceptance of it. The
> unverified record is therefore narrower than it was — not by moving a claim, but by removing three
> of the acts from the manual list after they became automatable.
>
> **And the limit of the extension, recorded where it costs something to write rather than where it
> is flattering**: the stub cannot make the page report a gas refusal or a revert. Measured, not
> assumed — in Node, viem's own `writeContract` forwards the refusal to `mapWriteError`; in the
> browser through this stub, the app's own RPC answers that call instead (the app's transport log
> shows `eth_call`s where the wallet's answer was expected), so the wallet's refusal is never the one
> the page reports. That is why §5 row 6 (insufficient gas) and row 7 (reverted) stay
> `interaction not measured` for their browser half, while their CLASSES are asserted against real
> viem error shapes in `test/wallet-errors.test.ts`.

**THE MEASUREMENT THAT FAILED, KEPT BECAUSE A DOUBLE THAT OVERCLAIMS IS THE THING THIS FILE EXISTS
TO PREVENT.** The "wallet reports no account" scenario (`tools/wallet-double-assert.mjs` scenario E)
was written, run against the published page, and it failed there. That was written up as a third
defect — and then withdrawn: four further runs and a probe of the page's own providers showed that on
that origin **the stub loses `window.ethereum` to the user's real MetaMask extension**, so the wallet
answering `[]` was not the wallet wagmi had reconnected from. The instrument was measuring the wrong
wallet, which is the failure mode a double is most likely to have and the least likely to announce.
The scenario is kept as a **guard**, **no defect is claimed for it anywhere**, and the code change
first written for it (`walletAccountsNow`, one `eth_accounts` per mount to confirm the account before
rendering it) was **reverted**: an A/B on a fresh origin showed the guard passes every assertion
without it, so it was a change no measurement asked for — and shipping it would have meant reporting a
fix on the strength of a measurement about the wrong wallet.

**The double's real limit, measured.** It cannot make the page report a **gas refusal** or a
**revert**: driven in Node against viem 2.56.5 the refusal reaches `mapWriteError`, but driven in the
browser through this stub the same refusal is answered by the app's own RPC instead (the app's
transport log shows `eth_call`s where the wallet's error was expected, and a synthetic
`eth_getTransactionReceipt` never reaches `mapReceipt` either). Those classes are therefore proven
where they can be — `test/wallet-errors.test.ts` asserts them against real viem error shapes — and
their browser half stays with a person.

> Companions: `INVARIANTS.md` (what has to be proved), `EVIDENCE-MAP.md` (what the evidence can and
> cannot prove).
