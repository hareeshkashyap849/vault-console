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
| UI-11 | Footer, on `/` and `/vault` | No action | The wording **"Read-only. Nothing on this page writes to the chain, and no wallet is required or requested."** appears on the page. **Scoped to those two routes**: `/vault/manage` does write, so that sentence must NOT appear there — a read-only claim on the page that sends transactions would be false | [CLIENT SIGN-OFF PENDING] |
| UI-12 | Page header · record | No action | The tail of the deployment record's source path appears (`erc4626-vault/deployments/local.json`), so the reader knows which file this set of addresses was read from | [CLIENT SIGN-OFF PENDING] |
| UI-13 | The whole page · `/history` | Open `/history` | Given the index service is running, when the page has finished loading, **three `<table>` elements** appear (`Kind / Events / Assets moved`, `Block / Time / Kind / Account / Assets / Shares / Transaction`, `Block / Time / Total assets / Total shares / Price per share`), and the page states **"Nothing on this page was read from the chain"** | [CLIENT SIGN-OFF PENDING] |
| UI-14 | `Recent events` · its own count label | No action | Given the table renders N rows, when the page renders, the sentence beneath it states **`All N events the index holds.`** or **`The most recent N of M events the index holds.`** — the number in the label **equals the number of rows painted**. A label claiming 50 rows over a table of 18 is the defect this row exists to catch, and only the browser can catch it, because both numbers come from state | [CLIENT SIGN-OFF PENDING] |
| UI-15 | `Event tally` · the sum row | No action | Given the tally shows one row per event kind and then a `Sum of the rows above`, when the page renders, **the printed sum equals the per-kind counts on screen**, and the service's own `totalEvents` is shown beside it only when the two agree. On disagreement the page prints both figures and the sentence saying it cannot tell which is wrong — it never silently prefers one | [CLIENT SIGN-OFF PENDING] |
| UI-16 | `Recent events` · amounts | No action | Given the index has **not** reported the asset and share decimals, when the table renders, the amount cells show **the raw base-unit string** and the page says the index has not reported the decimals — it does **not** format with 6 and 18. Formatting with a guessed value is not a rounding error: `5555075900` is `5,555.0759` at 6 decimals and `0.0000000055550759` at 18 | [CLIENT SIGN-OFF PENDING] |
| UI-17 | `Recent events` · an event with one amount | No action | Given a `YieldReported` event carries `assets` and **no** `shares` field (`null`), when the row renders, the shares cell shows **`—`** and its tooltip says this event carries no amount of this unit. It does **not** show `0`: "zero shares moved" and "this event has no share figure" are different statements | [CLIENT SIGN-OFF PENDING] |
| UI-18 | `/history` · index unreachable | No action | Given the index API is unreachable, when the page renders, it shows **"The index service could not be read."** naming the URL it failed on, **"no second source to fall back on"**, and renders **zero figures** — this page has one source, and substituting the chain's live numbers under a heading that says "read from the index alone" is the failure it must not have | [CLIENT SIGN-OFF PENDING] |
| UI-19 | Nav, on all four routes | Click a nav link | The header links **`/`, `/vault`, `/history`, `/vault/manage`** on every page, so no route is reachable only by typing its URL | [CLIENT SIGN-OFF PENDING] |

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
| Asset contract address | **Not hand-copied**. `scripts/build-runtime-config.mjs` reads the `asset` field of the deployment record — `deployments/base-sepolia.json` for the static build, `../erc4626-vault/deployments/local.json` otherwise — and writes it to `public/api/config`; the browser reads that file at load time through `src/lib/runtimeConfig.ts` | 2026-09-16 | `build-runtime-config.mjs` (the generator) / `runtimeConfig.ts` (the reader) |
| Vault contract address | As above, the `vault` field. The two records (the one the on-chain deploy script writes, the one the indexer reads) are **the same file**, and the generator re-reads its own output and refuses to report success if the address disagrees | 2026-09-16 | `build-runtime-config.mjs` / `runtimeConfig.ts` |
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
| Is it a pure function (no DOM, no network, no global state) | **Yes**. `format.ts` imports nothing beyond `node:assert`; it does not read `process.env`, does not touch `fetch`, and has no module-level mutable state. `src/lib/endpoints.ts` is the only place in `src/` that reads env — it is URL assembly that never touches an amount, and since the static export it is reachable only from tests (`test/api.test.ts`, `test/api-against-real-service.test.ts`); the build-time env read is `scripts/build-runtime-config.mjs`, which is also URL and address assembly and no arithmetic |
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

> **REVISED 2026-09-16, when the wallet page was added.** Eight of these eleven rows were `N/A`
> while this project was a read-only console, and the reason given for all eight was the same: this
> interface requests no wallet and sends no transaction. `/vault/manage` now does both, so those
> verdicts are out of date and are rewritten below.
>
> **What changed and what did not.** Every row now names the copy the interface actually renders, so
> the claim can be checked against the page instead of against this table. But the wallet rows are
> marked `implemented, not measured`: **no transaction has been sent from this page**, because
> MetaMask shows a popup and a person clicks Approve. The pre-flight logic behind them is proven in
> `test/wallet-flow.test.ts` and `test/wallet-amounts.test.ts`; the wallet interaction is not.
> Writing `passed` in that column would be exactly the kind of record this project's discipline
> forbids.
>
> **AMENDED 2026-09-17, and the sentence above is kept because it is what was true when it was
> written.** A person **did** drive the published `/vault/manage` in a real browser that day and two
> transactions landed: the chain shows the allowance moving `0 → 1000000` (1.0 USDC), the vault moving
> 20 USDC / 20 shares → **21 / 21**, and a `Deposit` event on
> `0xbcc9f564938b4b8dc58792a4d47af22e997236ee7492e3ddfa498b263eb36751` (block 46945096). **None of
> the rows below changes from that alone**, because every one of them asserts *wording*, and the
> session captured no page: no screenshot, no rendered text. It also left three things open — the
> deposit's `from` and `to` were neither the connected account nor the vault (an intermediary is
> involved and its role is not established), the approve's own hash was never identified, and the
> `Deposit` log was not decoded. The rows that this touches say `partly measured` in
> `web3-development-execute/projects/vault-console/BROWSER-TEST-PLAN.md` §5, which carries the
> measurement and the open checks; **this file's status column deliberately still reads
> `not measured`**, since wording is what it is about.
>
> **AMENDED 2026-09-18, and the block above is kept because it is what was true when it was written.
> The sentence that block rests on — "the session captured no page: no screenshot, no rendered
> text" — is now false, and a measurement is what made it false.** A person drove the published
> `/vault/manage` through a real MetaMask on **Base Sepolia (84532)** again, and this time the
> page's own rendered text was captured alongside the chain reads: the record is
> `verification/out/manual-wallet-2026-09-18.txt`, and
> `verification/out/screen-metamask-prompt.png` holds the page's pending state (*"Waiting for the
> wallet…"*) and the wallet's own prompt in one frame. Against that record, the wording this file's
> rows are about now has captures behind it: a real `4001` produced *"The chain switch was cancelled
> in the wallet, so the wallet is still not on chain 84532 (Base Sepolia). Nothing is sent until it
> is."*, a real `4902` reached the `chain-not-added` copy, and a rejection at the approval prompt
> rendered the page's cancellation panel with no hash and an unmoved nonce (`6 → 6`) — the `4001`
> measured on the switch path, the panel on the write path. Of the three things the
> block above leaves open, **all three are filled in and the third is narrower rather than closed**:
> the approve has its own hash
> (`0x71b0dfb13ea866d9821c54e0b4e25c582b160f504762cb77d661e866976606e8`, block 46,971,112, USDC
> `Approval(owner = 0x2ae7…E034, spender = the vault, value = 1000000)`), the `Deposit` log decodes
> (`0x8f114b1d30d1373cfab3d0fd2ce35c78221d165b60bce0bf88dad0f784a24551`, block 46,971,145:
> `sender` = `owner` = `0x2ae7…E034`, `assets` = `1000000`, `shares` = `1e18`), and the intermediary
> that block calls unestablished is **named** — an EIP-7702 delegation relay (the approve's receipt
> has `from` `0xb01caea8…`, `to` `0xdb9b1e94…`, the MetaMask `DelegationManager`) — so **why one write
> went through the relay and the next was sent directly by the account is an open question, not a
> mechanism**. The rows below keep the status they have, and for a narrower reason than the block
> above gives: what is still missing is not a capture of the page but the classes no step exercised
> (a wallet with no extension, a forced revert, a replaced transaction, an under-funded wallet, and a
> second deposit in one session).
>
> The three read-path classes remain **measured against the running services**
> (`docs/evidence/scenario-9-*.txt`, `scenario-10-*.txt`, `scenario-11-*.txt`, each with a
> screenshot).

| Failure class | What the interface must display (the exact wording) | Blocked before sending? | How to re-run | Status |
|---|---|---|---|---|
| Wallet not installed | `"No injected wallet was found in this browser. This app uses `injected()` …"`, and the deposit and redeem controls stay inert rather than accepting input that could never be signed | **Yes** — blocked at the control: the form is not rendered without a provider | Open `/vault/manage` in a browser with no wallet extension | implemented, **not measured** |
| User rejects the signature (EIP-1193 `4001`) | A **neutral** line, never a red failure: the form returns to idle and says the user cancelled and nothing was signed. `mapWriteError` checks `4001` **first**, so no later branch can reclassify it | not applicable — it is the user's own decision | Reject at the MetaMask prompt | implemented, **not measured** |
| Wrong chain | The controls are **disabled with a reason naming both chains**: `"Switch the wallet to chain <app> — it is currently on chain <wallet>, where this deployment does not exist. Nothing is sent until it does."` | **Yes** — blocked before the wallet is asked anything | Put the wallet on chain 8453 and open the page | logic proven in `test/wallet-flow.test.ts`; **UI not measured with a real wallet** |
| Insufficient allowance | The **approve step is offered instead of a deposit**, with the reason saying the allowance does not cover it — so a deposit is never sent that would revert with `ERC20InsufficientAllowance` | **Yes** — blocked before sending | A fresh wallet with zero allowance, then deposit | logic proven; **not measured live** |
| Insufficient balance | The reason carries the **real balance, formatted** (`5555.0759` and the symbol), never the bare word "insufficient". Refused **before** any approval, because an approval needs no balance and approving first would make the user pay gas to learn a free fact | **Yes** — blocked before sending | Enter more than the wallet holds | logic proven, including the balance-before-allowance ordering; **not measured live** |
| Insufficient gas | **No special copy.** This app does not pre-compute gas: an under-funded wallet fails at the wallet or the node, and that error is surfaced through the failure path rather than guessed at in advance | **No** — not decidable here without estimating for every chain | Drain the wallet's ETH and attempt a deposit | **not implemented as a pre-flight check** |
| Transaction revert | `"The chain reverted this transaction."` with the hash **kept** so the reader can look it up, and viem's own text in a collapsed `detail`. `mapReceipt` maps `'reverted'` to `failed` — never to `confirmed`, and never to still-pending | not applicable — the chain decides | Force a revert | logic proven in `test/wallet-flow.test.ts`; **not measured live** |
| Transaction replaced | **No dedicated state.** A replaced transaction surfaces as an unread receipt, whose copy is `"The transaction was sent, but its receipt could not be read. It may still be on chain -- the explorer or a node will say which."` — the uncertainty is named rather than reported as a failure, because a local read failure is not a statement about the chain | not applicable | Replace a pending transaction in the wallet | **no dedicated state; recorded as a gap** |
| **RPC unreachable** | **`"The chain could not be read."`** plus the specific message for that failure. The whole `Now` panel is replaced by this error box and **shows no stale number**; the `Then` panel is unaffected and keeps showing history | No (why it cannot be decided before sending: this interface sends nothing, so there is no "before sending". A **read** failure can only be observed) | Start the app with `VAULT_RPC` pointing at a dead port and reload `/vault` — that variable targets the **dev-server rewrite** in `next.config.ts`. Expected: the `Now` panel shows the sentence and the `Then` panel still shows the candlestick chart. **On a static export there is no rewrite**: the browser's endpoint is the config's `rpcUrl`, so the equivalent check is to point the generated config at a dead port and republish | **passed 2026-09-16 on the server-rendered pages** (`scenario-9-chain-down.txt`); **not re-measured for the export** (`docs/STATIC-EXPORT-MIGRATION.md`) |
| **API unreachable** | **`"The index service is not reachable at <actual URL>. It runs as a separate process; start it with \`node --experimental-strip-types src/api/cli.ts\` in the erc4626-vault-dapp repository."`** — the sentence **contains the URL actually requested**, because the word "unreachable" on its own cannot tell "the service was never started" apart from "it was started on the wrong port". **A page with no route to the service must NOT show this sentence**: on a static host `indexApiUrl` is `null`, so the failure kind is `no-route` and the panel says the page has no route — no request is made, nothing about the service is claimed | No (as above: a read failure can only be observed) | Point `VAULT_API` at a dead port and reload `/vault` (dev server, see the row above). Expected: the `Then` panel shows the sentence **and it contains the URL**, while the `Now` panel still shows the real on-chain figures. On the published export, the expected outcome is the `no-route` sentence instead | **passed 2026-09-16 on the server-rendered pages** (`scenario-10-index-down.txt`); the export's `no-route` path is unit-tested (`test/api.test.ts` → `refuses, without asking, when the config says there is no route`) and **not measured in a browser** |
| **Stale data** | An index figure **must state which block it is from**: `Indexed to block <N>`, `Lag <N> blocks`, `indexer last ran <duration> ago`, plus the service's own sentence `lagBlocks is measured against the chain head recorded at the last indexer run, not against the chain now.` (displayed verbatim). Plus the coverage-gap note (UI-09) | No (this interface sends nothing) | Advance the index and reload; the three figures must move together | **passed 2026-09-16 on the server-rendered pages** (`scenario-11-freshness.txt`: 12580 → 12639, lag 0 → 97, last ran 5m 11s → 4s). **RETIRED as evidence for the current code**: that pair proved the *server* re-read per request, and a static export has no server to re-read — the mechanism now is `staleTime: 0` + `refetchOnWindowFocus` plus the `no-store` assertion, which is **weaker** than a measurement. See `docs/STATIC-EXPORT-MIGRATION.md` and `EVIDENCE-MAP.md` |

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
| 3 | Displaying `pending` / `replaced` / `reverted` as "success" | **Now applies.** `/vault/manage` has a write path, so the four states exist and must be distinguishable. `mapReceipt` maps `'reverted'` to `failed` and an unsettled receipt to `pending`; a reverted transaction is never shown as confirmed, and never left looking like it is still in flight | Pure-function layer (`test/wallet-flow.test.ts` → *a reverted receipt is a FAILURE, never a confirmation and never "waiting"*) **+ browser layer** (the wallet page shows no raw integer and no invented figure while disconnected) |
| 4 | An old figure past its expiry that carries no "may be stale" mark | An old value gets taken as the current one. **What this interface does**: chain figures are issued as their own reads on every page load, with `staleTime: 0` and `refetchOnWindowFocus: true` (`src/app/providers.tsx`) — there is no server to re-read and no cache layer between the reader and the endpoint; index figures **always carry the block number** and the lag duration | Unit-test layer (`test/api.test.ts` asserts `cache: 'no-store'` is actually sent) + browser layer (asserts `the history page leads with how current the index is`). **Weaker than the 2026-09-16 claim**: the old evidence here was a measurement against the running server (`dynamic = 'force-dynamic'`, scenario 11); that mechanism no longer exists and the measurement does not cover the published site — `docs/STATIC-EXPORT-MIGRATION.md` |
| 5 | **Drawing a flat series as a blank chart** | With the price at `1.1` throughout, `max === min`, so `(v-min)/(max-min)` = `0/0` → every y coordinate is NaN → **SVG silently draws nothing**. The reader takes that to mean "there is no data", when in fact there are 169 candles | Pure-function layer (`test/chart-geometry.test.ts` asserts no NaN exists and span > 0) **+ browser layer** (`browser-assert.mjs` asserts **0** NaN coordinate attributes among 172 lines / 169 rectangles) |
| 6 | **Drawing "we cannot read it" as "nothing happened during that period"** | The coverage gap (data starts at block 168, but the service has records from block 8 onwards) would, if left unexplained, make the chart read as "the vault had no activity during that period". The truth is that **we cannot read those blocks**, not that there was no activity | The service writes it into `coverage.note`; the page **copies it verbatim** (UI-09). Assertion: `browser-assert.mjs` checks that sentence is on the page, `test/contract.test.ts` asserts the service really sends this field and this exact sentence |

> Items 1–4 are **default items; do not delete them**. Item 3 was N/A while this project was
> read-only and now applies, because `/vault/manage` writes; the row is kept and its verdict updated
> rather than deleted. Items 5 and 6 are additions unique to this interface, coming from this
> project's own two real defects.
>
> **Additions 7 and 8, from the wallet work:**
>
> | # | Never displayed | Why | Which layer's assertion catches a violation |
> |---|---|---|---|
> | 7 | **A raw base-unit integer in an amount field** — the "Max" control must fill a decimal string | The sibling dApp's Max button once filled a base-unit integer into a field that expected a decimal; the transaction was mined and reverted. The field and its Max control are now one shared component with a **required** `unit` prop, so there is no second call site where the label can be forgotten | Pure-function layer (`test/wallet-flow.test.ts` → *maxAmountDecimal produces a decimal string, never a base-unit integer*) + browser layer (the wallet page is checked for a bare 19+ digit run) |
> | 8 | **An approval state remembered in the browser** | The sibling dApp cached it; the deposit consumed the allowance, the memory did not notice, and the next deposit reverted with `ERC20InsufficientAllowance(vault, 0, 5850e6)`. In React this is *easier* to get wrong, because a contract-read hook is itself a cache | Pure-function layer (`test/wallet-flow.test.ts` → *the allowance is not remembered: a consumed allowance brings the approve step back*) + code review: no approval state exists anywhere on the path |

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
