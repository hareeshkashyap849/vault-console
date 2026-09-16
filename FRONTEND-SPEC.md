# Frontend spec (path B · F1) — vault-console

> **F1 deliverable. Gate G-F1: user-visible behaviour and the failure list are written down, and the client confirms them.**
> Basis: the delivery blueprint's frontend path (F1-F5), §12.2; methodology: the workspace's frontend correctness guideline.
> **This file states claims only; it carries no evidence.** Where the evidence for each claim lives is written in `EVIDENCE-MAP.md`.
>
> **What is special about this project (said up front, because it changes the shape of §3)**:
> this is a **read-only console**. It does not connect a wallet, does not sign, does not send a transaction.
> So of the 11 failure classes the template assumes, **only 3 exist in this interface**.
> The other 8 are written out row by row as **`N/A + reason`** — by the skeleton's discipline, a blank = incomplete,
> and "not applicable" must come with a reason; two words are not enough.
> The implementation and verification of those 8 classes live in the sibling project `erc4626-vault`
> (the wallet dApp, the write side of path B); this file states on the relevant row "which project covers it",
> rather than pretending they do not exist.

---

## 0. Metadata

| Item | Value |
|---|---|
| Project | vault-console (read-only ERC-4626 console, path B) |
| Version / date of this file | v1 / 2026-09-16 |
| Filled in by | the author (execution area) |
| Client sign-off (person / date) | **[CLIENT SIGN-OFF PENDING]** This workspace is a self-built portfolio with no external client; see §5 for how the "sign-off person" is handled |
| Target chain chainId | **31337** (a local Anvil chain). Checked against the primary source: the `chainId` field of `../erc4626-vault/deployments/local.json`, consistent with `eth_chainId` measured as `0x7a69` = 31337. **Not** filled in from memory; the local anvil default port is 8545 |
| Authoritative source for the figures on screen | **Both, and they are not merged**: the `Now` panel = **read straight from the chain** (this request); the `Then` / `Index health` panels = **the index API**; `Price per share` = **the index API**; the `Two sources` panel = the two shown side by side. **On a conflict neither is believed** — that panel refuses to answer when only one of the two is present (see UI-04) |
| Wallet connection | **N/A + reason**: this interface is read-only; it injects no provider, does not detect `window.ethereum`, and requests no account. The reason is "reading a figure needs no authorisation": an interface that only needs to read, but demands a wallet connection, would put the user through an authorisation popup before they have seen a single number |

---

## 1. Screen inventory and verifiable statements

**How a statement is written**: given <precondition>, when <user action or system event>, <observable outcome> appears / does not appear on the screen.
Every one of the following has a matching assertion in `tools/browser-assert.mjs` (see `EVIDENCE-MAP.md`),
or is explicitly marked "not verified".

| ID | Screen / component | What the user does here | Verifiable statement (observable outcome) | Client confirmation (person / date) |
|---|---|---|---|---|
| UI-01 | The whole page | Open `/` | Given the chain and the index service are both running, when the page has finished loading, **4 `<section>` panels** appear (titled, in order, `Now` / `Then` / `Two sources, checked against each other` / `Index health`), and **none** of the wording `could not be read` / `not reachable` / `refused` appears | [CLIENT SIGN-OFF PENDING] |
| UI-02 | `Now` panel · Total shares | No action (passive display) | Given the chain's `totalSupply()` returns `859021905704231281673` (raw base unit), when the page renders, that cell shows **a share count with a decimal point** (of the form `859.021905704231281673`), **and that raw uint256 string does not appear anywhere on the page in full** | [CLIENT SIGN-OFF PENDING] |
| UI-03 | `Now` panel · Total assets | No action | Given the chain's `totalAssets()` returns `944924100` (raw base unit, the asset has 6 decimals), when the page renders, that cell shows `944.9241 USDC`, and **not** `944,924,100` | [CLIENT SIGN-OFF PENDING] |
| UI-04 | `Two sources` panel | No action | Given the chain **or** the index service is unavailable, when the page renders, that panel shows **"A comparison needs both sources. One of them is unavailable, so this panel does not guess."**, and shows **no** comparison conclusion derived from a single source | [CLIENT SIGN-OFF PENDING] |
| UI-05 | `Now` panel · chain unreachable | No action | Given the RPC is unreachable, when the page renders, the `Now` panel shows the heading **"The chain could not be read."** plus the specific error sentence, **while the `Then` panel still shows history normally** (the two sources fail independently) | [CLIENT SIGN-OFF PENDING] |
| UI-06 | `Then` panel · index unreachable | No action | Given the index API is unreachable, when the page renders, the `Then` panel shows **"The index service could not be read."**, **while the `Now` panel still shows the current on-chain figures** | [CLIENT SIGN-OFF PENDING] |
| UI-07 | `Then` panel · candlestick chart | Hover one candle | Given the whole price series is `1.1` (a zero range), when the chart renders, **a horizontal line across the middle of the panel** appears (not a blank panel), and **no coordinate attribute in the SVG contains `NaN`** | [CLIENT SIGN-OFF PENDING] |
| UI-08 | `Then` panel · chart caption | No action | Given the price never moved, when the chart renders, the caption contains the wording **"the price did not move in this window"** — a flat series must be **said out loud**, not left for the reader to infer from a flat line | [CLIENT SIGN-OFF PENDING] |
| UI-09 | `Then` panel · coverage-gap note | No action | Given the index service's `coverage.startsLaterThanDeployment === true`, when the page renders, the service's own sentence appears: **"This is a gap in the data, NOT a period of zero activity -- do not draw or read it as one."** (**copied verbatim, not reworded**) | [CLIENT SIGN-OFF PENDING] |
| UI-10 | Candle tooltip | Hover | Given a candle's OHLC are all `1.1`, when hovering, the tooltip shows **the raw strings the service returned** (`open  1.1` / `high  1.1` / `low   1.1` / `close 1.1`) and the block range (of the form `25 blocks (1249-1273)`) | [CLIENT SIGN-OFF PENDING] |
| UI-11 | Footer | No action | The wording **"Read-only. Nothing on this page writes to the chain, and no wallet is required or requested."** appears on the page | [CLIENT SIGN-OFF PENDING] |
| UI-12 | Page header · record | No action | The tail of the deployment record's source path appears (`erc4626-vault/deployments/local.json`), so the reader knows which file this set of addresses was read from | [CLIENT SIGN-OFF PENDING] |

### Where UI-02 / UI-03 come from (two real defects, not hypotheticals)

These two statements come from two bugs in this repository **itself**, both caught by the browser assertions:

1. **UI-02's raw base unit**: the first version ran `totalAssets` and `totalSupply` through the same
   formatting function, while the service returns **raw uint256 base units** for both of them
   (`../erc4626-vault-dapp/src/api/price.ts`, verbatim: *"RAW uint256 values in BASE UNITS, exactly as"*).
   So the page printed the shares as `859,021,905,704,231,281,673` — **exactly item 2 of the "never display" list**.
   It looked completely normal on `totalAssets`, purely because the asset has 6 decimals and
   `944924100` reads like an ordinary number.
2. **UI-03's defect, same root**: the same function printed `944924100` as-is as `944,924,100`,
   that is, it showed 944.9241 USDC as nine hundred forty-four million. **It looks more "like money" than the
   true value**, which makes it the more dangerous of the two.

The fix was to split "raw base unit" and "already formatted by the service" into two functions
(`displayBaseUnits` / `displayDecimal`), and to make `formatBaseUnits` **reject** input containing a decimal point.
`FRONTEND-SPEC.md` §2.2 and `STATE-OWNERSHIP.md` §3 record this single implementation point.

---

## 2. The single source for amounts and decimal places

### 2.1 Precision parameters (every one must be read from the chain, never hardcoded)

| Parameter | Value / where it is read from | Primary-source check date | Who fills it in |
|---|---|---|---|
| Asset contract address | **Not hand-copied**. `src/lib/deployment.ts` reads the `asset` field of `../erc4626-vault/deployments/local.json` (read from the file at runtime) | 2026-09-16 | `deployment.ts` |
| Vault contract address | As above, the `vault` field. The two records (the one the on-chain deploy script writes, the one the indexer reads) are **the same file** | 2026-09-16 | `deployment.ts` |
| `assetDecimals` | **Read at runtime from the ERC-20 `decimals()`** (`readDeployment` in `src/lib/chain.ts`, via `ERC20_ABI`). The `live?.assetDecimals ?? 6` in the UI is only a fallback for when the chain is unreachable, and in that case the whole `Now` panel shows an error instead of showing numbers | 2026-09-16 | `chain.ts` |
| Share `decimals` | **Read at runtime from the vault's `decimals()`** (`VAULT_ABI.decimals`, in the same batched call) | 2026-09-16 | `chain.ts` |
| Virtual shares / the offset term | **N/A in this interface + reason**: `_decimalsOffset()` is only needed when converting base units into a "price per share", and **this interface does not do that conversion** — the share price is computed by the index service (`sharePrice()` in `../erc4626-vault-dapp/src/api/price.ts`, where it has its own tests and where the use of the offset has been checked). The console reads the result only. This is deliberate: the same error-prone formula implemented in two places is bound to diverge | 2026-09-16 | — (owned by the service) |
| Rounding rules in each direction | **N/A in this interface + reason**: a read-only console does no `convertToShares` / `convertToAssets` and has no write operation at all, so there is no "round up / round down" choice to make. Amounts undergo only **string conversion between decimal and base unit**, which is exact integer arithmetic and involves no rounding. `sharePercent()` is the only division, and it is **deliberately truncated** rather than rounded (truncating keeps the displayed value from ever exceeding the true one) | 2026-09-16 | — |

### 2.2 The single implementation point (G-F3's "only one place may compute money")

| Item | Value |
|---|---|
| The single implementation point (file) | **`src/lib/format.ts`** |
| Function: base unit → decimal string | `formatBaseUnits(baseUnits: string \| bigint, decimals: number): string` (internally goes through `formatBigInt`) |
| Function: decimal string → base unit | `parseAmount(value: string, decimals: number): bigint` |
| Function: decimal already formatted by the service → display string | `formatDecimal(value: string): string` |
| Function: shares ↔ assets conversion | **N/A + reason**: see the last two rows of §2.1. The console does no conversion; it reads the `price` the service has already computed |
| Is it a pure function (no DOM, no network, no global state) | **Yes**. `format.ts` imports nothing beyond `node:assert`; it does not read `process.env`, does not touch `fetch`, and has no module-level mutable state. `endpoints.ts` is the only place that reads env, and it is URL assembly that never touches an amount |
| Its tests | `test/format.test.ts` (46 tests) and `test/contract.test.ts` (21 tests) |
| Input convention | Amounts are always `bigint` or a **decimal string**; `formatBaseUnits` takes a **raw integer string**. A string never contains scientific notation and never carries thousands separators. `Number` is allowed only for block numbers / timestamps / counts / the number of decimals |
| Output convention | Decimal places = that asset's `decimals`, with **trailing zeros removed** (so `1.1` is assertable, instead of `1.100000000000000000`); **thousands grouping** by default, switchable off with `{ group: false }`; there is **no truncation and no rounding** (the conversion is exact); `sharePercent` is the one exception — two decimals, **truncated** |

**Rules (a violation means G-F3 does not pass)**

- Across the whole repository, these are **allowed only** in `src/lib/format.ts`: `10 ** decimals`,
  `BigInt` division, `toFixed`, and any `Number(...)` that takes part in an amount computation.
- Everywhere else may only **call** it. Arithmetic appearing inside a UI component = a second source of truth.
- Every amount sent to a wallet must go through the single implementation point: **N/A + reason** — this
  interface sends no amount to any wallet (read-only). That requirement applies in the sibling project
  `erc4626-vault` under `web/app/*`, and is implemented there (the Max button fills in a decimal string).
- Static check command (re-runnable, **not "it was checked"**):

  ```powershell
  node tools/check-single-source.mjs
  # expected output:
  #   Scanned 9 source files (excluding 1 allowed and all tests/tools).
  #   Amount module: src/lib/format.ts
  #
  #   No second source of truth found.
  # exit code 0
  ```

  **The checker itself has been tested against a deliberately bad file**: after placing a file containing
  all 5 classes of violation in `src/lib/`, it reported **7 violations, exit code 1**; with that file
  deleted it is back to exit code 0. The raw output of both runs is recorded in `docs/evidence/`.
  See `EVIDENCE-MAP.md` §3.

---

## 3. Failure classes (11, every row must be filled in)

> **This project is read-only, so 8 of the 11 classes are N/A.** This section gives an **explicit
> applicability verdict** for every row, and for the ones that do not apply it writes the reason and
> "which project covers it". **An empty cell = incomplete.**
>
> Only 3 classes exist in this interface: **RPC unreachable** / **API unreachable** / **stale data**.
> All three have an implementation and browser assertions.

| Failure class | What the interface must display (the exact wording) | Blocked before sending? | How to re-run |
|---|---|---|---|
| Wallet not installed | **N/A + reason**: this interface requests no wallet, detects no provider and sends no transaction, so "wallet not installed" changes no visible behaviour (UI-11 states explicitly *"no wallet is required or requested"*). **Covering project**: `erc4626-vault` (the wallet dApp) | N/A | N/A |
| User rejects the signature (EIP-1193 `4001`) | **N/A + reason**: this interface issues no signature request, so `4001` does not exist here. **Covering project**: `erc4626-vault` (measured there: a rejected signature reports `message neutral`, neutral rather than an error, and produces no on-chain spend) | N/A | N/A |
| Wrong chain | **N/A + reason**: with no wallet connected there is no "chain the wallet is on". The chain the console reads is decided by `VAULT_RPC` and the deployment record's `chainId`, and the record's `chainId` is displayed in the page header | N/A | N/A |
| Insufficient allowance | **N/A + reason**: read-only, no ERC-20 allowance concept. **Covering project**: `erc4626-vault` | N/A | N/A |
| Insufficient balance | **N/A + reason**: read-only, nothing is spent. **Covering project**: `erc4626-vault` (measured there: an over-balance input sends no transaction) | N/A | N/A |
| Insufficient gas | **N/A + reason**: read-only, no transaction is sent. **Covering project**: `erc4626-vault` | N/A | N/A |
| Transaction revert | **N/A + reason**: read-only, no transaction is sent. **Covering project**: `erc4626-vault` | N/A | N/A |
| Transaction replaced | **N/A + reason**: read-only, no transaction is sent, no pending state. **Covering project**: `erc4626-vault` | N/A | N/A |
| **RPC unreachable** | **`"The chain could not be read."`** plus the specific message for that failure. The whole `Now` panel is replaced by this error box and **shows no stale number**; the `Then` panel is unaffected and keeps showing history | No (why it cannot be decided before sending: this interface sends nothing, so there is no "before sending". A **read** failure can only be observed) | Stop anvil, reload `http://localhost:3000`. Expected: the `Now` panel shows `"The chain could not be read."`, the page is still 200, and the `Then` panel still shows the candlestick chart |
| **API unreachable** | **`"The index service is not reachable at <actual URL>. It runs as a separate process; start it with \`node --experimental-strip-types src/api/cli.ts\` in the erc4626-vault-dapp repository."`** — the sentence **contains the URL actually requested**, because the word "unreachable" on its own cannot tell "the service was never started" apart from "it was started on the wrong port" | No (as above: a read failure can only be observed) | Stop the index API (`Ctrl-C` that process), reload the page. Expected: the `Then` panel shows the sentence above **and it contains the URL**, while the `Now` panel still shows the real on-chain figures |
| **Stale data** | An index figure **must state which block it is from**: `Indexed to block <N>`, `Lag <N> blocks`, `indexer last ran <duration> ago`, plus the service's own sentence `lagBlocks is measured against the chain head recorded at the last indexer run, not against the chain now.` (displayed verbatim). Plus the coverage-gap note (UI-09) | No (this interface sends nothing) | Leave the indexer stopped for a while (without re-running catch-up), reload the page. Expected: `Lag` and "indexer last ran … ago" increase with time, and that note is still on the page |

**Three rules that must be followed when filling this in (from F3 iron rules 4 and 5) — checked one by one**

1. **A `4001` rejection is a neutral event** → **N/A in this interface** (nothing is signed). The rule
   applies in `erc4626-vault`, where it has been measured.
2. **Wrong chain / insufficient allowance / insufficient balance must be "blocked before sending"** →
   **all three are N/A in this interface** (nothing is sent, no wallet).
   The **only** thing in this interface that could be "blocked" by analogy is **malformed data**:
   `formatBaseUnits` **throws** on input containing a decimal point rather than guessing
   (see the forbidden-pattern list in `STATE-OWNERSHIP.md` §3).
3. **`revert` and `replaced` must not share wording with `success`** → **N/A in this interface**
   (no four states, no write operation). The corresponding requirement in this interface, that things must
   be distinguishable, is that **the two sources' error texts must differ**: `"The chain could not be read."`
   and `"The index service is not reachable at …"` are two different sentences pointing at two different
   fixes — and this one **is measured in this interface** (UI-05 / UI-06).

> This table and the failure-scenario matrix in `BROWSER-TEST-PLAN.md` §5 are **the same 11 classes, and
> the numbering must match**. `BROWSER-TEST-PLAN.md` §5 restates the same applicability verdicts row by row.

---

## 4. What this interface never displays

| # | Never displayed | Why | Which layer's assertion catches a violation |
|---|---|---|---|
| 1 | Unconfirmed balance (treating pending as arrived) | The user would make decisions on a wrong balance. **In this interface this is strengthened to**: no figure is displayed **without its source and its block stated** | Browser layer (every panel carries a source label, `browser-assert.mjs` asserts the 4 panels exist and no failure wording appears) |
| 2 | **A raw base-unit integer (the `859021905704231281673` kind)** | **This repository really did make this mistake**: shares were printed as a raw uint256 (see the explanation in §1). It looks like a legitimate grouped number, so it passed one reading | Pure-function layer (`test/format.test.ts`) **+ browser layer** (`browser-assert.mjs` asserts the raw uint256 string does not appear in the rendered text) |
| 3 | Displaying `pending` / `replaced` / `reverted` as "success" | **N/A + reason**: no write operation, no transaction state. **Covering project**: `erc4626-vault` | N/A |
| 4 | An old figure past its expiry that carries no "may be stale" mark | An old value gets taken as the current one. **What this interface does**: chain figures are re-read on every request (`dynamic = 'force-dynamic'` + `cache: 'no-store'`); index figures **always carry the block number** and the lag duration | Pure-function layer (`test/api.test.ts` asserts `cache: 'no-store'` is actually sent) + browser layer (asserts `Indexed to block` is visible) |
| 5 | **Drawing a flat series as a blank chart** | With the price at `1.1` throughout, `max === min`, so `(v-min)/(max-min)` = `0/0` → every y coordinate is NaN → **SVG silently draws nothing**. The reader takes that to mean "there is no data", when in fact there are 169 candles | Pure-function layer (`test/chart-geometry.test.ts` asserts no NaN exists and span > 0) **+ browser layer** (`browser-assert.mjs` asserts **0** NaN coordinate attributes among 172 lines / 169 rectangles) |
| 6 | **Drawing "we cannot read it" as "nothing happened during that period"** | The coverage gap (data starts at block 168, but the service has records from block 8 onwards) would, if left unexplained, make the chart read as "the vault had no activity during that period". The truth is that **we cannot read those blocks**, not that there was no activity | The service writes it into `coverage.note`; the page **copies it verbatim** (UI-09). Assertion: `browser-assert.mjs` checks that sentence is on the page, `test/contract.test.ts` asserts the service really sends this field and this exact sentence |

> Items 1–4 are **default items; do not delete them**. Item 3 is marked N/A in this project with the
> covering project named (the row is not deleted). Items 5 and 6 are additions unique to this interface,
> coming from this project's own two real defects.

---

## 5. The G-F1 gate

- [x] Every screen has a verifiable statement, written as an observable "given… when… then…" result (UI-01…UI-12)
- [x] The single source for amounts and decimal places is pinned to a **specific file + specific function names** (`src/lib/format.ts` §2.2)
- [x] All 11 failure classes filled in row by row, no empty rows, no "to be decided" (3 implemented, 8 written up as N/A + reason + covering project)
- [x] The default items of "what this interface never displays" are still present (items 1–4 kept, item 3 marked N/A)
- [ ] **Client confirmation in writing** (the line-by-line sign-off table is in `SUPPORT-AND-SIGNOFF.md` §5)

**G-F1 conclusion**: **[CLIENT SIGN-OFF PENDING]** — every technical item is filled in, but this
workspace is a portfolio rather than a client project, so there is no external client signature.
`SUPPORT-AND-SIGNOFF.md` §5 tabulates "who verified it / what it was verified with" for each statement,
signed by **the author himself** in the dual role of implementer + verifier, and states explicitly in
that file that this is a portfolio self-assessment and **not client acceptance**. Writing a
self-assessment as client acceptance would be exactly the kind of record this workspace's discipline forbids.

> Next: F2 — `INVARIANTS.md`, `EVIDENCE-MAP.md`, `TEST-DOUBLES.md`, `STATE-OWNERSHIP.md`.
