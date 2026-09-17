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
>
> **Second amendment, 2026-09-17 (later the same day): all three of those checks were run, and a
> fourth question was answered while running them. This block is added, not substituted — the list
> above is the record of what was open when it was written, and item 4 below is a check that list did
> not name.**
>
> Everything here is a direct read of Base Sepolia (chain `84532`, `https://sepolia.base.org`) at
> head **46946111** or later, by `eth_getCode`, `cast receipt`, `cast call` and a topic-filtered
> `eth_getLogs`. Each raw value is quoted as it came back.
>
> **1. The account carries an EIP-7702 delegation — the check that was open resolves YES.** The 7702
> story this file has twice declined to assert is now established by measurement rather than guessed.
>
> - `eth_getCode 0x2aE746C0ff0295c2da1aC338656F247e9758E034` → **23 bytes** of code, exactly the
>   length of a delegation designator, and the whole value is
>   `0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b`.
> - First four bytes: **`0xef0100`** — the EIP-7702 designator. The 20 bytes after it are the
>   delegate: **`0x63c0c19a282a1b52b07dd5a65b58948a07dae32b`**.
> - What that means, in the form the EIP states it: that account's code is not bytecode, it is a
>   pointer. Any call to `0x2aE7…E034` executes the delegate's code **in that account's storage
>   context**. This account is not a plain EOA at `latest`, and the address that appears in the log
>   below is an account that behaves like a contract.
> - What the delegate is, from its own answers: `NAME()` → `"EIP7702StatelessDeleGator"`,
>   `VERSION()` → `"1.3.0"`, `delegationManager()` → `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`
>   (the address in check 2), `entryPoint()` → `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. It is
>   11,185 bytes of code, not a designator.
> - The same delegation is visible in the deposit transaction's own envelope: `cast tx
>   0xbcc9f564…` reports `type: 0x4` (a SetCode transaction, the EIP-7702 transaction type) and an
>   `authorizationList` whose single entry names chain `0x14a34` (84532) and address
>   `0x63c0c19a282a1b52b07dd5a65b58948a07dae32b` — the same delegate the account's code points at,
>   with tuple nonce `0x5`. That tuple nonce is a second, independent corroboration, because EIP-7702
>   requires the authorisation's nonce to equal the account's: `eth_getTransactionCount
>   0x2aE7…E034 latest` is now **`0x6` (6)** — exactly that 5 plus this one transaction. The
>   delegation in the account's code and the delegation in this transaction's envelope are therefore
>   the same delegation, and the account was a delegated account when the deposit ran, not merely
>   afterwards.
>
> **2. The two intermediary addresses, each from the chain rather than from its shape.**
>
> - `0xC066ac5D385419B1A8c43A0E146fA439837a8B8c` → `eth_getCode` returns **`0x`**, zero bytes. It is
>   an **EOA**. It was the `from` of the deposit transaction, so the account that paid for and
>   submitted that transaction holds no code of its own; nothing in the chain data says more about it
>   than that.
> - `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` → **11,503 bytes** of code, runtime starting
>   `0x60806040…`. It is a **contract**, and it identifies itself: `NAME()` →
>   `"DelegationManager"`, `VERSION()` → `"1.3.0"`. Its function selectors include
>   `redeemDelegations(bytes[],bytes32[],bytes[])` (`0xcef6d209`), `getDelegationHash`, `ROOT_AUTHORITY`,
>   `disableDelegation`, `enableDelegation`, `disabledDelegations`, `getDomainHash`, `pause`/`paused`,
>   `NAME`, `VERSION` and `eip712Domain` — the MetaMask **Delegation Framework**'s manager, 1.3.0.
>   (Independent check: the selector and event-signature lookups resolve to those names, and
>   `etherscan.io/address/0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` is labelled *MetaMask:
>   Delegation Manager*.) The deposit transaction's `to` is this contract, and its input begins
>   `0xcef6d209` — **`redeemDelegations`**, with three `bytes[]`-shaped offsets. So the transaction
>   asked the delegation manager to redeem a delegation; it did not call the vault.
> - Neither address is the connected account and neither is the vault. What the chain shows is that
>   the call reached the vault **through** the delegation manager, from an account that had delegated
>   its execution to `EIP7702StatelessDeleGator`.
>
> **3. The `Deposit` log decodes, and it explains the state change that was measured.** From
> `cast receipt 0xbcc9f564938b4b8dc58792a4d47af22e997236ee7492e3ddfa498b263eb36751`
> (`status 0x1`, block `0x2cc5348` = **46945096**, `from` `0xC066ac5D…`, `to` `0xdb9B1e94…`,
> `type 0x4`, five logs). The vault's `Deposit(address indexed sender, address indexed owner,
> uint256 assets, uint256 shares)` is `log[3]`, `address 0x7941438ee07bea4469ccd4bec583e9fb24037f35`,
> with `topic[0]` = `0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7`, and
> `cast keccak "Deposit(address,address,uint256,uint256)"` returns exactly that hash — so the
> signature above is the one this log actually carries, not the one it was assumed to carry:
>
> | Field | Raw value | Read as |
> |---|---|---|
> | `sender` | topic[1] `0x0000000000000000000000002ae746c0ff0295c2da1ac338656f247e9758e034` | **`0x2aE746C0ff0295c2da1aC338656F247e9758E034`** |
> | `owner` | topic[2] `0x0000000000000000000000002ae746c0ff0295c2da1ac338656f247e9758e034` | **`0x2aE746C0ff0295c2da1aC338656F247e9758E034`** |
> | `assets` | data first word `0x…000f4240` | **`1000000`** (1.0 USDC at 6 decimals) |
> | `shares` | data second word `0x…0de0b6b3a7640000` | **`1000000000000000000`** (1e18 = 1 share) |
>
> So **yes**: `owner` **is** `0x2aE7…E034`, and `assets` **is** `1000000`. That is the check the
> session was missing, and it closes the loop this file was previously unable to close: the deposit
> really credited the account this workspace's key controls, for exactly the 1.0 USDC the allowance
> had been raised by, and for 1 share — which is the 20 → 21 the account and the vault each moved.
> Two answers from the same receipt corroborate it independently of the event: `log[1]` is USDC's
> `Transfer` (`0xddf252ad…`) `0x2aE7…E034 → 0x7941438e…` of `0xf4240` = 1000000, and `log[2]` is the
> vault's own share `Transfer` minting `0xde0b6b3a7640000` = 1e18 to `0x2aE7…E034` from the zero
> address. `log[4]`'s topic[0] is the delegation manager's own redemption event, whose 4-byte lookup
> is `RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))`
> — the delegation manager saying so.
>
> **4. The approve transaction's hash, which the first amendment recorded as never identified.**
> Topic-filtered `eth_getLogs` on USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) for
> `Approval(address indexed owner, address indexed spender, uint256 value)` with `owner` =
> `0x2aE7…E034` and `spender` = the vault `0x7941438ee07bea4469ccd4bec583e9fb24037f35` returns
> **exactly two** logs in blocks 46919124–46946111 (taken in ≤9,000-block windows: this endpoint caps
> `eth_getLogs` at 10,000 blocks, measured — `-32614 eth_getLogs is limited to a 10,000 range`):
>
> | When | `transactionHash` | `blockNumber` | `value` |
> |---|---|---|---|
> | earlier | `0x1cb6d5dd76145f8d89eb4588bac64dd0c642162ef6cc605ccfd1b6c2bfaf9275` | **46919479** (`0x2cbef37`) | `20000000` |
> | **the one whose result this session measured** | **`0xac558a4be8b234374e64a6be08fc9532fe2488f28dbc46cf495cfeeb7dd00ffc`** | **46945057** (`0x2cc5321`) | **`1000000`** |
>
> The second one is the allowance the measurement saw, and `cast receipt` on it says `status 0x1`,
> `from 0x2ae746c0ff0295c2da1ac338656f247e9758e034`, `to 0x036cbd53842c5426634e7929541ec2318f3dcf7e`,
> `type 0x2` (an ordinary transaction), one log — the `Approval` above. **That is a second transaction
> type in the same session: this approve was a direct call from the account to the token, while the
> deposit went through `0xdb9B1e94…` as a `0x4`.** The first row is recorded because it is the
> difference between the two, and the file would otherwise imply the allowance was zero before: the
> account had approved **20 USDC** at block 46919479, and the 20 → 21 deposit consumed that grant
> (20 USDC is exactly its size). The grant this session's measurement observed is the later, separate
> **1.0 USDC** approval, 2,578 blocks after it.
>
> **What this settles, and what it does not.** Settled, as measurements: the account carries a 7702
> delegation to `EIP7702StatelessDeleGator` 1.3.0; the deposit reached the vault via the MetaMask
> Delegation Manager's `redeemDelegations`; the vault's `Deposit` names that account as `sender` and
> `owner` for `assets = 1000000` and `shares = 1e18`; and the erc20 approval that produced the
> measured allowance is `0xac558a4b…` at block 46945057. Not settled, and named so that it is not
> read as settled by anything above: **who or what submitted the two transactions.** The chain shows
> the 7702 delegation being *used*, and shows it is not what *sent* the deposit — the deposit's
> `from` has no code. Nothing in the data above establishes which program or wallet built either
> transaction, and no rendered page was captured, so every row below that asserts *wording* remains
> exactly as unmeasured as it was before this amendment.
>
> **Third amendment, 2026-09-18 (local clock read `2026-09-18 00:1x +08:00`; this is the same working
> session as the two amendments above, which ran past local midnight, and the date is written as the
> clock gave it rather than rounded to match theirs). The page capture that the two amendments above
> record as missing now exists. It is POST-HOC, and that word is the whole of its limitation, so it is
> stated here rather than left for a reader to discover.** This block is added, not substituted.
> **No row below is upgraded to `passed` on its strength**, and §8's verdict is unchanged; the reason it
> is unchanged is set out at the end of this block.
>
> **The session.** The user's real Chrome, driven through kimi-webbridge over CDP, against the
> **published** console at `https://hareeshkashyap849.github.io/vault-console/vault/manage/` — not a
> local build. The browser offered **the account that actually made the two transactions**:
> `window.ethereum.selectedAddress` was `0x2ae746c0ff0295c2da1ac338656f247e9758e034`, with
> `0xa0ee7a142d267c1f36714e4a8f75612f20a79720` the other account authorised in the same wallet. The
> page therefore rendered the **connected** branch, and everything transcribed below is that branch.
> The account is named in full here rather than in the shortened `0x2aE7…E034` form the page itself
> uses, because the page's abbreviation is a rendering and this line is not.
>
> **Where the capture is.** Four files, all workspace-level evidence and deliberately **not** part of
> this repository (they are not client deliverables):
>
> | File | What it is |
> |---|---|
> | `verification/out/wallet-manage-connected-posthoc-2026-09-18.png` | the viewport screenshot: the wallet panel, the position panel and the deposit panel |
> | `verification/out/wallet-manage-connected-posthoc-2026-09-18-fullpage.png` | the same page captured whole (both forms, below the fold), taken through CDP `Page.captureScreenshot` with `captureBeyondViewport`, because the daemon's own `screenshot` action captures the viewport only |
> | `verification/out/wallet-manage-connected-posthoc-2026-09-18.txt` | the **rendered text** of that capture, as the page produced it |
> | `verification/out/wallet-manage-approve-step-offered-2026-09-18.png` / `.txt` | the second capture below, which is the one that speaks to row 4 |
>
> **What the page actually said, transcribed verbatim.** Left column is the page's own label; right
> column is what it rendered, copied as rendered (including `19USDC` and `21shares` running together,
> which is how `innerText` returns the value and its unit when they share a line):
>
> | The page's own wording | What it rendered |
> |---|---|
> | `Address` | `0x2aE7…E034` |
> | `Wallet chain` | `84532` — and directly beneath it, `matches the deployment` |
> | `Asset` | `USDC` `6 decimals` — `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
> | the wallet controls | `Disconnect`, `switch connection`, `Injected`, `MetaMask` |
> | `Asset balance` | `19` `USDC` — captioned `the asset, 6 decimals -- what a deposit spends` |
> | `Share balance` | `21` `shares` — captioned `the vault's shares, 18 decimals -- what a redemption spends` |
> | `Max withdrawable` | `21` `USDC` — `the vault's own \`maxWithdraw\`, in the asset's units` |
> | deposit field | `Amount in assets (USDC)`, a `Max` control, and `balance 19 USDC` |
> | deposit allowance | **`vault allowance 0 USDC (read from the chain, never remembered)`** |
> | redeem field | `Amount in shares (the vault’s shares)`, a `Max` control, and `shares held 21` |
> | redeem payout | `vault max withdrawable 21 USDC the vault's own maxWithdraw, shown not enforced` |
>
> **The four figures the page rendered agree with a direct read of the chain the page reads**, taken
> during the same session from `https://sepolia.base.org` (chain `84532`), vault
> `0x7941438ee07bea4469ccd4bec583e9fb24037f35`, asset `0x036CbD53842c5426634e7929541eC2318f3dCF7e`:
> `totalSupply` `21000000000000000000` (21 shares), `totalAssets` `0x1406f40` (21000000 = 21 USDC), the
> account's share balance `21000000000000000000`, its USDC balance `0x121eac0` (19000000 = 19 USDC), and
> its allowance to the vault **`0`**. So `19`, `21`, `21` and `0` on the page are the chain's own values
> for that account, not a rendering of something else. This is a corroboration and **not** a substitute
> for the capture: it is a chain fact, and the reason these rows were open is that a chain fact is not a
> measurement of an interface.
>
> **An honest wrinkle, recorded because it decides whether a reader can repeat the capture.** The *first*
> read after navigation caught the page **before `wagmi` had reconnected**: address `—`, `no wallet
> connected`, `connect a wallet to read it`, and `No wallet is connected, so there is nothing to sign
> with...`. The connected branch above appeared on the same tab a few seconds later **with no
> interaction**, and the screenshot is of that later state. The earlier state is recorded because
> "reload it and look" does not reproduce this page — its shape changes after load — and a reader who
> did not know that would take the no-wallet text for the page's answer.
>
> **The second capture, and the claim in row 4 it closes.** Row 4 says *the approve step is offered
> instead of a deposit*, and recorded that claim as unmeasured because nothing had captured the form.
> In the same session, with the allowance at `0`, an amount was **typed** into the deposit field — typed,
> never clicked, because a click is what asks a wallet to sign and no wallet prompt was opened — and the
> deposit panel then rendered, verbatim:
>
> - `The vault's allowance is 0 USDC, which does not cover this deposit. Approving is the next step; the deposit follows it.`
> - `shares you would receive 5 via the vault's previewDeposit` (the `5` being the amount typed)
> - and the form's controls became **`1. Approve USDC`** and `Clear`
>
> That is the row's own claim, read off the published page: with a zero allowance the form offers the
> **approval** and says the deposit follows it, rather than offering a deposit that would revert. The
> field was cleared afterwards, and no transaction was sent by this capture.
>
> **What the capture establishes, and what it does not — in the same breath, because the second half is
> the reason no row moves.**
>
> - It **establishes** that the connected branch renders, on the published site, for the account named
>   above, and it fixes what that branch *says*: the address, chain `84532`, balance `19 USDC`, shares
>   `21`, allowance `0 USDC`, and the two forms' unit labels. Every row that asserted *wording* was
>   previously unmeasured; the wording in the table above is now transcribed from a rendered page.
> - It **does not establish** anything about the moment of signing. It is **after** both transactions
>   had been mined: the deposit `0xbcc9f564…` (block 46945096) and the approval `0xac558a4b…` (block
>   46945057) were already on chain when this page was opened, and nothing in the capture is a wallet
>   prompt, a pending phase, a rejection, a gas refusal, a receipt, or a failure of any kind. The
>   allowance reads `0` because the approval's grant had been consumed, not because an approval was
>   pending.
> - It therefore **cannot move row 4, row 6 or I3's steps 2 and 3 to `passed`**, and does not. Row 4's
>   remaining unmeasured half is the interaction itself: that a reverting deposit is never sent is
>   proven in a unit test and is **not** what this capture shows. Row 6 (insufficient gas) is untouched —
>   no under-funded wallet was driven. The capture also does not touch rows 1, 2, 3, 5, 7 and 8, whose
>   conditions were not injected at any point in this session.

| # | Failure class | How it is injected | What is asserted (wording + rendered result + state) | Evidence requirement | Status |
|---|---|---|---|---|---|
| 1 | Wallet not installed | Open `/vault/manage` in a browser with no extension | `"No injected wallet was found in this browser. This app uses injected() …"`, and the deposit and redeem controls stay inert rather than accepting input that could never be signed | screenshot: **not run** | **implemented; interaction not measured** |
| 2 | The user refuses to sign (`4001`) | Reject at the MetaMask prompt | A **neutral** line, never a red failure; the form returns to idle and says the user cancelled and nothing was signed. `mapWriteError` checks `4001` first so no later branch can reclassify it | screenshot: **not run** | **logic proven** (`test/wallet-flow.test.ts`: *a user rejection is its own phase, not a failure*, and the nested-cause case); **interaction not measured** |
| 3 | Wrong chain | Wallet on chain 8453, page expecting 31337 | The controls are **disabled with a reason naming both chains** — *"Switch the wallet to chain 31337 — it is currently on chain 8453, where this deployment does not exist. Nothing is sent until it does."* — and **no wallet prompt appears** | screenshot: **not run** + transaction hash: **not applicable, nothing is sent** | **logic proven** (`decideDeposit` → `wrong-chain`, and it outranks an unparseable amount); **interaction not measured** |
| 4 | Insufficient allowance | Fresh wallet, zero allowance, then deposit | The **approve step is offered instead of a deposit**; a deposit that would revert with `ERC20InsufficientAllowance` is never sent | screenshot: `verification/out/wallet-manage-approve-step-offered-2026-09-18.png` — **post-hoc; it does not show the signing** (third amendment) | **logic proven**, including the case where the allowance was consumed and must be re-read; **partly measured 2026-09-17** — a person deposited from a zero allowance and the chain now reports **`1000000`** (1.0 USDC) on the account named in the amendment above, so the approve really did run and change state. **The approving transaction is now identified**: `0xac558a4be8b234374e64a6be08fc9532fe2488f28dbc46cf495cfeeb7dd00ffc`, block **46945057**, `Approval` value **`1000000`**, spender the vault, `from` the account itself (see the second amendment). **The page's offer is now measured too** (third amendment): with the allowance at `0` and an amount typed in, the published form rendered *"The vault's allowance is 0 USDC, which does not cover this deposit. Approving is the next step; the deposit follows it."* and offered **`1. Approve USDC`** — so the row's central claim, *the approve step is offered instead of a deposit*, is read off the page rather than inferred. **Still not `passed`**: the half of the row about a reverting deposit never being sent is proven only in a unit test, and the capture is after both transactions, so it shows the form's decision and not the interaction |
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
| **The same assertions against the PUBLISHED export** — a different target, and not to be read as the row above | `node --import web3-development-execute/toolchain/fetch-via-socks.mjs tools/browser-assert.mjs --url https://hareeshkashyap849.github.io/vault-console/`, run 2026-09-18 | **37/51 passed, 14 failed** (exit 1). **None of the 14 is a defect in the exported page**: 4 are the tool reading before the client renders, 5 are the site being mounted at `/vault-console/` with trailing slashes while the tool compares against `/vault`, 2 are copy the index-snapshot work changed, 2 are the wallet-connected state the tool does not model, 1 is a tooltip expected to carry the local fixture's value. The full classification is in `docs/STATIC-EXPORT-MIGRATION.md`. **Two cross-checks in the tool are aimed at the wrong chain** and pass vacuously against the published site; see that file | `verification/out/browser-assert-against-export-2026-09-18-proxied.txt` (the run) + `verification/out/browser-assert-read-timing-2026-09-18.txt` (the read-timing measurement) + `verification/out/published-render-phases-2026-09-18.json` (the render phases) |
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
| 1 | Connect wallet | **Now applicable**: `/vault/manage` offers a connect control, and after connecting it shows the address and the wallet's chain rather than a dash. The connected branch **rendered live on 2026-09-17** and was **captured on 2026-09-18** (see §5's third amendment): the published page rendered `Address` `0x2aE7…E034` and `Wallet chain` `84532` with `matches the deployment`, which is this row's assertion read off the page — **post-hoc**, like every capture in that amendment, and from a wallet that was already connected rather than one connecting during the capture. The 2026-09-16 runs exercised the no-wallet branch only | screenshot: `verification/out/wallet-manage-connected-posthoc-2026-09-18.png` | **measured for that render (post-hoc); the act of connecting is not captured and was not re-driven** |
| 2 | Approve | **Now applicable**: a deposit with an insufficient allowance offers the approve step first, and after the approval confirms the allowance is **re-read** rather than remembered | screenshot: **not run** | **logic proven**; **partly measured 2026-09-17** — the allowance moved **`0 → 1000000`** (1.0 USDC), so an approval really was sent and the chain shows its effect. **The approving transaction is now identified**: `0xac558a4be8b234374e64a6be08fc9532fe2488f28dbc46cf495cfeeb7dd00ffc` at block **46945057** (`0x2cc5321`), `status 0x1`, `from` the account, `to` the USDC contract, `type 0x2`, one log — `Approval(owner = 0x2aE7…E034, spender = 0x7941438e…, value = 1000000)`. That closes the gap this row recorded. What it does not close: "re-read rather than remembered" is a statement about the UI, and what the 2026-09-18 capture shows about it is the **page's own words** — `vault allowance 0 USDC (read from the chain, never remembered)` — plus the allowance actually reading `0` against the chain's `0`. That is the claim rendered, not the re-read observed: no capture shows two successive reads disagreeing |
| 3 | Deposit | **Now applicable**: `deposit(uint256 assets, address receiver)` with the connected account as receiver. Would be evidenced by a **transaction hash, block number and `Deposit` event**, cross-checked against the chain's `totalAssets` before and after | screenshot: **not run**; transaction hash: **`0xbcc9f564938b4b8dc58792a4d47af22e997236ee7492e3ddfa498b263eb36751` (block 46945096)** | **measured 2026-09-17, on the chain, and the log now decodes**: the vault moved 20 USDC / 20 shares → **21 / 21**, the account in §5's amendment moved 20 → **21 shares**, and that transaction's vault `Deposit` names `sender` = `owner` = **`0x2aE746C0ff0295c2da1aC338656F247e9758E034`**, `assets` = **`1000000`**, `shares` = **`1000000000000000000`** — i.e. the event explains the state change exactly, for 1.0 USDC against the 1.0 USDC allowance. The vault still reads `totalAssets()` **`21000000`** and `totalSupply()` **`21000000000000000000`** (21 / 21). **What it still does not establish**: the transaction's `from` was an EOA with no code (`0xC066ac5D…`) and its `to` was the MetaMask Delegation Manager contract (`0xdb9B1e94…`, `redeemDelegations`), **not** the vault — so the deposit reached the vault through a delegation redemption, from a submitter the chain data does not name; and **the page was captured only after the fact** — the 2026-09-18 screenshot shows this account's rendered position (`19 USDC`, `21 shares`, allowance `0 USDC`) with no prompt, no receipt and no pending phase in it, so it is evidence about the page and not about the deposit's execution (see §5's third amendment) |
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
- [ ] **none of §5's 11 rows is `not run`** — **NOT SATISFIED as of 2026-09-16, and still not satisfied after 2026-09-17.** Rows 9, 10 and 11 are passed by measurement; rows 1, 2, 3, 5, 7 and 8 have `logic proven` pre-flight decisions and **no measured interaction at all**; row 6 is **not implemented as a pre-flight check** (though one real insufficient-funds error was observed — see §5's amendment); row 8 has **no dedicated state**. **Row 4 and §6's step 2/3 changed on 2026-09-17**: a person drove the published wallet page, and the chain confirms the allowance moved `0 → 1000000` and the vault and the account both moved 20 → 21, with the `Deposit` event on a named transaction. **Which of that session's gaps are now closed, and which are not** (second amendment, same day): the decoded `Deposit` log, the approving transaction's hash, and what the two intermediary addresses are were all measured — so "no decoded log came out of it" is no longer true — but **no screenshot and no rendered-text capture exist for any wallet row**, which is why the rows stay `partly measured` rather than passed. **Third amendment, 2026-09-18: that last clause is no longer true of rows 4 and 6, and the bullet still does not close.** A page capture of the published wallet page now exists, and it transcribes the rendered account, chain, balance, allowance and shares (§5's third amendment) — so "no capture exists" is retired. What replaces it as the reason is narrower and is the reason this box stays unticked: **the capture is post-hoc, taken after both transactions were mined, so it shows no prompt, no pending phase, no receipt and no failure**, and rows 1, 2, 3, 5, 7 and 8 have no capture and no measured interaction at all
- [x] every failure case **that has been run** has a screenshot — `scenario-9-chain-down.png`,
      `scenario-10-index-down.png`, `scenario-11-data-freshness.png`, and for the history page
      `scenario-12-history-up.png` (three tables, each stating how much it is showing) and
      `scenario-13-history-index-down.png` (the index gone, and **no** figures rendered at all).
      All five are produced by `node tools/capture-screenshots.mjs`, which names each URL, waits for
      the page's own content, and writes the file — so they can be re-taken after any change. The
      wallet rows had **no screenshot** when this line was written: rows 1, 2, 3, 5, 7 and 8 have never
      been run at all, and the 2026-09-17 session that drove rows 4 and 6 (§5's amendment) captured no
      page. **Rows 4, 6 and I3's step 1 now have one — `verification/out/wallet-manage-connected-posthoc-2026-09-18.png`
      and its full-page and text companions, plus `verification/out/wallet-manage-approve-step-offered-2026-09-18.png`
      — taken on 2026-09-18 against the published site.** They are **post-hoc** captures, and they are
      listed here as screenshots of the interface, not as evidence of the moments the rows describe
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

**That paragraph is kept as written, because two of the four things it lists were measured later the same
day.** The `Deposit` log now decodes (`owner` = `0x2aE7…E034`, `assets` = `1000000`, `shares` = `1e18`), the
approving transaction is `0xac558a4b…` at block 46945057, and the two intermediaries are settled from the
chain: `0xC066ac5D…` is an EOA with **no code**, and `0xdb9B1e94…` is the MetaMask **DelegationManager** 1.3.0
that the deposit called (`redeemDelegations`). What the paragraph is still right about is the capturing: the
verdict **remains NOT passed**, now for one reason only — **no screenshot and no rendered-text capture of any
wallet row**, plus rows 1, 2, 3, 5, 6, 7 and 8 as before. §5's second amendment is the measurement.

**What is genuinely proven.** 51 browser assertions pass against the **production build** (not just the dev
server), and they are re-runnable with one command: `node tools/browser-assert.mjs --url http://127.0.0.1:3121`.
Fourteen of them are the console's original assertions, unchanged and now at `/vault`; the tool measures how
many of the total are the console's rather than hard-coding the split, so "the console survived the move"
cannot silently become false. Seventeen more cover the history page, including two that read the page's own
arithmetic back off the painted DOM — the count label against the rows actually rendered, and the printed tally
sum against the rendered per-kind counts. The pre-flight decisions behind the wallet rows are proven in unit
tests. **Against the published static export the same tool scores 37/51, and every one of the 14 failures is
traceable to the tool's own assumptions rather than to the page** — four to reading before the client renders,
five to the site's `/vault-console/` mount and trailing slashes, two to copy the index-snapshot work changed,
two to the wallet-connected state the tool does not model, and one to a tooltip expected to carry the local
fixture's value. The classification, and the two cross-checks that are aimed at the wrong chain, are in
`docs/STATIC-EXPORT-MIGRATION.md`; the run itself is the last row of §5's table above. **That 37 is not a
regression of the 51** — different target, and the 51 is still the local production build.

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

**The reason narrowed again later on 2026-09-17, and this time three of the four items it names are gone.**
The "no identified hash for the approve" and "no decoded `Deposit` log" items were both measured (the approve
is `0xac558a4b…`, block 46945057; the log decodes to `owner = 0x2aE7…E034`, `assets = 1000000`,
`shares = 1e18`), and "why the deposit's `from` and `to` were neither the connected account nor the vault" is
now an answer rather than a question: the account carries an **EIP-7702 delegation** (`0xef0100` + the
`EIP7702StatelessDeleGator` at `0x63c0c19a…`), and the deposit called the MetaMask **DelegationManager**'s
`redeemDelegations`. What is left, and it is the whole of the remaining reason: **nothing captured the page.**
No screenshot, no rendered text, no `browser-assert.mjs` run behind the two transactions — so a state change
that is now fully explained on the chain is still **not** a measurement of this interface. The verdict does not
move, and the reason it does not move is narrower than it was.

**2026-09-18: the item that paragraph names — "nothing captured the page" — is the one thing that changed,
and the verdict still does not move.** A screenshot, a full-page capture and the rendered text of the
published wallet page now exist, and they show the connected branch for the account that made the two
transactions: `Address 0x2aE7…E034`, `Wallet chain 84532`, `Asset balance 19 USDC`, `Share balance 21 shares`,
`vault allowance 0 USDC (read from the chain, never remembered)` (§5's third amendment transcribes all of it).
A second capture in the same session shows the form with a zero allowance offering **`1. Approve USDC`** rather
than a deposit. So this paragraph's last sentence is now false and is left standing as the record of what was
true when it was written. **Why the box above is still unticked is not "no capture" any more, and saying it were
would be the same error in the other direction: the capture is post-hoc.** It was taken after both transactions
had been mined and after the approval's grant had been consumed — which is why the allowance reads `0` — so it
contains no wallet prompt, no pending state, no receipt, no rejection and no failure. It documents what this
page shows for that account; it does not document the moment of signing, and rows 1, 2, 3, 5, 7 and 8 have
neither a capture nor a measured interaction. A post-hoc capture is a real measurement of the interface and it
is not the measurement those rows need, and this file does not let the first stand in for the second — which is
the same rule §5 applies to the chain facts it has been offered.

**Residual gaps recorded honestly** (they are separate from the wallet gap above):
- end of §7: **console events are not captured directly**. kimi-webbridge's `evaluate` cannot look back at console
  output that already happened, so the substitute evidence is "assert that the page text carries no error and no hydration hint".
- the remaining unverified items in `EVIDENCE-MAP.md` §3 (the accessibility baseline, a non-flat real dataset, whether the coverage gap is unavoidable).

> Path D's I3/I4 reuse this file: I3's step 5 (exact equality) is **passed**, and steps 1–3 are **applicable**
> (steps 2 and 3 partly measured on 2026-09-17 — see §5's amendment) while step 4 (redeem) is applicable and
> unmeasured — the note at the end of §6 above carries the correction, because an earlier version of this line
> still said steps 1–4 were not applicable after §6's table had begun to say "Now applicable";
> of I4's four classes, two rows are not applicable and two are **not run** (they share their origin with rows 9 and 10 in §5).
>
> **Addendum, later on 2026-09-17**: I3's step 3 now has its decoded event and its named intermediaries, and
> step 2 has its approving transaction — see §5's second amendment. Step 3's remaining gap is **the page
> capture, not the chain**: what it lacks is a screenshot of the interface, not evidence of the deposit. It is
> therefore still `partly measured`, and calling it `passed` on chain evidence alone is exactly the substitution
> §8 refuses.
>
> **Addendum, 2026-09-18**: step 3's remaining gap is no longer "no screenshot of the interface" — the capture
> exists (`verification/out/wallet-manage-connected-posthoc-2026-09-18.png`), and it shows this account's
> rendered position. It is **post-hoc**, so it still does not show the deposit being executed, and step 3 stays
> `partly measured` for the reason §8 gives rather than for the absence of a capture. Step 1's render is captured
> too (§6); step 4 (redeem) is untouched and remains unmeasured.

---

## 9. Amendment, 2026-09-19: the tool was mended to measure the export, and the export was re-measured

> **This is an amendment, not a replacement.** §5's rows, §8's verdict and the four earlier amendments above
> stand exactly as written. What changed is the **tool**, not the record: the assertions that were aimed at
> the server-rendered pages, and the two that were aimed at the wrong chain, now measure the published export
> for the deployment the page itself reads. Two of them are stricter than the versions they replace, and one
> new check fails — on the page.

### 9.1 The situation this responds to

`node tools/browser-assert.mjs --url https://hareeshkashyap849.github.io/vault-console/` scored **37/51 with
14 failures** on 2026-09-18, and `web3-development-execute/projects/vault-console/docs/STATIC-EXPORT-MIGRATION.md`
recorded the diagnosis: all 14 traceable to the tool's own assumptions — four from reading before the client
renders, five from the `/vault-console/` mount, two from copy the index-snapshot work changed, two from a
wallet state the tool did not model, one from a tooltip expecting the local fixture's `1.1`. **Two further
checks PASSED VACUOUSLY**: `index service is reachable` asked a local process the published page never
contacts, and the chain cross-checks read Anvil's vault on chain 31337 while the page read Base Sepolia 84532
at `0x7941438ee07bea4469ccd4bec583e9fb24037f35`. A check that cannot fail for the reason it exists is worse
than no check, so mending those two was the point of the work and the tooltip was the easy part.

### 9.2 What the tool does now, and why each change is not cosmetic

| What changed | Why, in one line |
|---|---|
| `visit()` waits for the page to **settle** — the route's own ready selector/text, plus the text length unchanged three polls running (three, not two: two polls returned a measured mid-load page at 1,949 chars), plus, on the console, that `Total shares` has actually rendered | the served document is a 159-character loading screen and `main` is in it; the chain figure and the chart are separate races |
| Routes are joined to a **base path** derived from `--url`, with the trailing slash sent rather than relied on, and href/path comparisons normalise it | the site answers at `/vault-console/`; the tool was written for a root-mounted origin |
| The **deployment under test is read from the page's own `api/config`** — chain id, vault, RPC URL, `indexApiUrl`, `indexSnapshot` — and every cross-check is aimed through it | no constants, and a PASS can only come from the deployment the page is reading |
| `totalSupply` is compared against a **second implementation** of the base-unit rule, written here from the rule rather than imported from `src/lib/format.ts` | importing the app's formatter would compare the page with itself and pass whatever it did |
| The raw-uint256 checks use `!(19+ digit run)` **without the `|| text.includes(',')` escape hatch** | that `||` was true for every page in this app, so it could not fail; demonstrated below |
| The tooltip's expected strings come from **the first candle of the deployment the page reads** | the tool asks the page's own dataset, not the local fixture's |
| The wallet page models **three** states — no wallet, connected-with-nothing-entered, connected-with-an-amount | the middle one legitimately renders no submit control and does not say "Connect a wallet to deposit" |
| The source-label assertions accept the **snapshot** sentence when `indexSnapshot` is true, and require the live one when it is false | two different true sentences; demanding the old one failed a page that was more accurate |
| `index service is reachable` is replaced by **two target-specific checks** (local: ask the URL the config names; export: no service is named **and** the snapshot files are served by the page's own host) | the old one was a health report on a process the published page never contacts |
| The landing page's "names the deployment it read" check requires **the identity the config names** | its old `/Anvil/` arm passed on copy that contradicts the page's own deployment table |
| `tools/fetch-via-socks.mjs` sends a **body-carrying request directly** instead of through the tunnel | measured: the tunnel implements one proxied HTTPS GET, so a POST left as a GET and `sepolia.base.org` answered `405 Method not allowed` |

Findings from the mending itself, each measured rather than reasoned about:

- **Two polls is not "settled."** The first version of the settle wait required the text length to be
  unchanged twice, and it returned at **1,949 characters** with the `Then` panel still absent. Three
  consecutive rounds is the cheapest condition a two-phase render cannot satisfy by accident.
- **A probe cannot read Node's globals.** The first version of the landing-page check referred to a Node
  variable from inside a page-context function; that is a `ReferenceError` in the browser, and it would have
  failed a correct page. The two facts a probe needs cross the boundary as an injected JSON literal.
- **`--import` takes a URL on Windows.** `node --import D:\...\fetch-via-socks.mjs` dies with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`; the working form is `--import file:///D:/1/11111/deepseek/web3-development/web3-development-execute/toolchain/fetch-via-socks.mjs`.

### 9.3 The run (2026-09-19)

```
node --import file:///D:/1/11111/deepseek/web3-development/web3-development-execute/toolchain/fetch-via-socks.mjs \
  tools/browser-assert.mjs --url https://hareeshkashyap849.github.io/vault-console/
```

**57 passed / 1 failed / 0 skipped, of 58 assertions run, exit 1.** (The skipping machinery exists and is
exercised by construction — a target whose config named a live index service, or an unfunded vault whose
`totalSupply` is `0`, would each report a SKIP with its reason — but against this target every check that runs
is one that can fail here, so nothing is skipped.) Full output:
`verification/out/browser-assert-against-export-2026-09-19.txt`.

The one remaining failure, verbatim:

```
FAIL  the landing page names no deployment it is not reading  -- the page says "Anvil" while its own config
reads chain 84532 -- copy or fixture, either way a claim about a deployment that is not this one
```

**Judgement: a defect in the PAGE, not in the tool, and not previously visible to any check.** The cause is
one hard-coded sentence at `web3-development-execute/projects/vault-console/src/app/page.tsx` line 121:

```
and offers a deposit and a redemption. Two write paths, on the local Anvil chain this
deployment record describes.
```

The page's own deployment table, 105 lines below in the same file, renders `Base Sepolia (84532)` and
`0x7941438e…f35` from the runtime config, so the landing page contradicts itself. It is **not** a static-render
artefact: the phrase is absent from the published `index.html` and present in the client chunk
(`out/_next/static/chunks/34st6rkau_64e.js`), i.e. it is what the reader sees once the page has hydrated. The
sentence is the local-stack copy from before the deployment moved to Base Sepolia, and the old assertion could
not see it because `/Anvil/.test(text)` was precisely what made it pass. The fix is one line — say
`{runtime.chainName}` where the copy says "the local Anvil chain" — and it is **deliberately not applied in
this amendment**, because the task is to measure the page rather than to repair it and because the failing
check is the only thing currently standing between this page and a self-contradiction nobody would notice.

### 9.4 What this run establishes

- The export **serves every route**; a real browser renders all four, and each **settles** out of the loading
  screen (measured: 3,433 / 2,285 / 2,138 / 2,406 characters; the console's own settle line reports 6 polls).
- The console draws its chart with **zero NaN coordinates**, one body per candle, four panels.
- **`totalSupply` on the page equals what the chain holds** for the vault the page's config names:
  the page renders `21`, and `0x7941438e…` on chain 84532 reports `21000000000000000000` base units with 18
  decimals. This is the check that used to compare against Anvil and pass for the wrong reason.
- The page **never shows a raw base-unit integer** on any route — this time asserted in a form that can fail.
- The **lag the page renders (26,700 blocks) is the lag in the snapshot file the page fetched**, read from the
  same host; and the host serves all five snapshot endpoints, which is what would break if the capture step
  were dropped from the build.
- The history page's own arithmetic still matches its painted rows, and **the page asks for no wallet**.
- The wallet page's three states are modelled, and the state this browser is in — **connected with nothing
  entered** — is now asserted to say what it is (`Enter the amount of USDC you want to deposit.`) rather than
  treated as a missing control.
- `fetch-via-socks.mjs` lets the page be read over the SOCKS route **and** lets the JSON-RPC cross-check run,
  without either pretending to be the other.

### 9.5 What it still does not establish

- **Nothing about a wallet action.** This run sends no transaction and opens no prompt. The manage page is
  read in its default state, so §5's rows 1–8 and I3's steps 1–4 are exactly as unmeasured as they were.
- **Nothing about the published snapshot's freshness.** `status.updatedAt` says `2026-09-17T14:32:38.747Z`
  and the page agrees with it; nothing here proves the Pages workflow re-captures on its six-hour cron.
- **Nothing about the interactive tooltip.** The tooltip is asserted from the DOM's `<title>` text, not by
  hovering a candle, so "the tooltip appears on hover and is positioned legibly" is still unasserted.
- **Nothing about the local stack, this time round.** The local-only branches (the live index-service check,
  the live-service tooltip fetch, the `totalSupply`-against-Anvil path) were not re-run: no dev server was
  started for this amendment, because the target of record is the export. They are covered by code inspection
  and by `check-published-snapshot.mjs`, not by a browser run.
- **Console events are still not captured directly** (§7's residual gap, unchanged).
- G-F4's verdict is **unchanged**: still **not passed**, for the same reason §8 gives.

