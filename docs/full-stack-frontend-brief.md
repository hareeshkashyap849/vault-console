# Full-stack front end: verified facts and decisions

> **STATUS: carried out.** All four routes exist, all three read-only pages take the same
> `force-dynamic` / `no-store` route, and the values in §2 were re-checked against the installed
> packages and the running services rather than trusted from this document. What was measured:
>
> | Claim | Evidence |
> |---|---|
> | four routes, one app, nav between them | 51/51 browser assertions against the **production build** (`evidence/browser-assert.txt`), including `the nav links every route from the history page` |
> | the wallet path is React, not the dApp's vanilla JS | `/vault/manage` — `WagmiProvider` + `useAccount`/`useReadContract`/`useWriteContract`; 65 unit tests on the decisions (`test/wallet-flow.test.ts`, `test/wallet-amounts.test.ts`) |
> | every figure in the new tables is rendered from exact strings | `test/history.test.ts` (31 tests) + `the history page never shows a raw base-unit integer` |
> | the read-only console's 14 assertions survived the move from `/` to `/vault` | the tool counts them rather than hard-coding the split; `51/51` |
> | failure paths, measured not assumed | scenarios 9, 10, 11, 12, 13 — `node tools/capture-scenarios.mjs`, 5/5 PASS |
>
> **One thing in this brief was NOT built as written**: §4's "prove the wallet rows end to end" is
> still not done, because MetaMask requires a person to click Approve. Those four rows stay
> `interaction not measured` in `BROWSER-TEST-PLAN.md` §5. The brief is kept as the work order it
> was, with this status block added, so a reader can see what the plan was and what the outcome was
> rather than inferring either from the code.

This is the work order for turning `vault-console` from one read-only page into a multi-page
front end with wallet connection, and for folding in the wallet operations that the sibling
`erc4626-vault` dApp proves but does not implement in React.

Everything below was measured against the running system or the installed packages. Where a
value came from a source that can rot, the source is named so it can be re-checked.

---

## 1. What is being built, and why

The portfolio's stated gap is **front-end breadth**: one page, no routing, no wallet connection
in React, and two unrelated apps (a vanilla-JS wallet dApp and a Next.js read-only console)
sitting side by side. A reviewer hiring for full-stack or dApp work sees either wallet
operations without React, or React without wallet operations.

So: one Next.js app, several routes, with the wallet path built in React against live chains.

| Route | What it is | Source of its data |
|---|---|---|
| `/` | Landing: what the vault is, the two-source explanation, links to the tools | deployment record |
| `/vault` | The read-only console that already exists | chain + index API |
| `/vault/manage` | Connect a wallet, deposit, redeem, see your position | chain + wallet |
| `/history` | Indexed events and the price series as a table | index API |

`/history` was built last and earned its place along the way: it is the page where the index's
numbers stop being counters and become **rows a reader can check** — each event with its block and
transaction hash — and it is the only page in the app with a single source, which makes its failure
behaviour the opposite of the console's (show nothing, rather than fall back to the chain).

The existing `/` content moves to `/vault`. Nothing about the read-only console's behaviour
changes: it keeps its two independent sources and its refusal to answer when only one is
available. That behaviour is asserted by `tools/browser-assert.mjs` and those assertions must
keep passing.

## 2. Verified facts — do not re-derive these, and do not contradict them

### The deployment

From the `erc4626-vault` repository's `deployments/local.json`, which is the single source the deploy script
writes and the indexer reads. **Read it at runtime; never copy an address into source.**

```
chainId 31337, rpc http://127.0.0.1:8545
vault 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
asset 0x5FbDB2315678afecb367f032d93F642f64180aa3
owner 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
```

`src/lib/deployment.ts` already loads this and throws loudly on a partial record. Extend it; do
not bypass it.

### The contract's write paths

`YieldVault` inherits OpenZeppelin's `ERC4626`, so four write paths exist. This app implements
**two of them** and says so in the UI rather than implying it implements all four:

| Path | Signature | In this app |
|---|---|---|
| `deposit` | `deposit(uint256 assets, address receiver) -> uint256 shares` | **yes** |
| `redeem` | `redeem(uint256 shares, address receiver, address owner) -> uint256 assets` | **yes** |
| `mint` | `mint(uint256 shares, address receiver) -> uint256 assets` | no — stated in the UI |
| `withdraw` | `withdraw(uint256 assets, address receiver, address owner) -> uint256 shares` | no — stated in the UI |

Note `redeem`, not `withdraw`. The exact ABI entries are in
the `erc4626-vault` repository's `web/app/vault.js` and were read from there, not recalled.

Reads available and used: `asset`, `totalAssets`, `totalSupply`, `balanceOf`, `decimals`,
`convertToAssets`, `previewDeposit`, `previewRedeem`, `maxWithdraw`.
ERC-20 side: `balanceOf`, `allowance`, `decimals`, `symbol`, `approve`.

### THE BUG THIS APP MUST NOT REINTRODUCE

The vanilla dApp cached the approval state in memory (`ApprovalState` = idle / needs-approval /
approved). After a deposit consumed the allowance, the cached state still said approved, so the
next deposit went out with an allowance of zero and reverted with
`ERC20InsufficientAllowance(vault, 0, 5850e6)`.

**The allowance is read from the chain every time it is needed, and no approval state is stored
anywhere.** This is the workspace's "structural failure mode 1": one fact in two places, one of
which necessarily goes stale. A React app makes this easy to get wrong, because
`useReadContract` *is* a cache — so the flow must re-read allowance after an approval confirms,
via `refetch`, rather than trusting a previous read.

### The installed packages

| Package | Version | Notes |
|---|---|---|
| `wagmi` | **3.7.7** | the skill library documents **v2**; the registry serves v3 |
| `@tanstack/react-query` | 5.103.0 | required peer of wagmi |
| `viem` | 2.56.5 | required peer of wagmi |
| `react` | 19.1.1 | |
| `next` | 16.3.5 | |
| `typescript` | 5.9.3 | wagmi v3 requires **>= 5.9.3** |

**wagmi v3 differences that matter here**, checked against
<https://wagmi.sh/react/guides/migrate-from-v2-to-v3> and then against the installed
`node_modules/wagmi/dist/types/exports/index.d.ts`:

- Connector dependencies are **optional peer dependencies** now. `metaMask()` would require
  `@metamask/connect-evm`, which is **not installed**. `injected()` needs nothing extra, so
  **use `injected()`**.
- Account hooks were renamed: `useConnection`, `useConnectionEffect`, `useSwitchConnection`.
  The old names still exist as aliases in 3.7.7, but **the new names are used here** so the code
  does not depend on a deprecation.
- **`config` is a HOOK argument, not a `connect()` argument.** The migration guide does not
  mention this, and it is the change most likely to cost an hour:
  ```ts
  useConnect<config>(parameters?: ConfigParameter<config> & ConnectOptions<config>)
  // so: useConnect({ config })            <- config here
  // then: connect({ connector })          <- and NOT here
  ```
  `ConnectVariables` is an alias of `ConnectParameters`, which contains no `config` field.
- **`mutate` / `mutateAsync` replaced the per-hook names.** `useConnect()` now returns
  `mutate` and `mutateAsync`; `connect` and `connectAsync` still exist but are marked
  `@deprecated use \`mutate\` instead`. Same for `useWriteContract` (`mutate`, not
  `writeContract`). Use the new names.
- **`connectors` was removed from `useConnect()`, `useReconnect()`, `useDisconnect()` and
  `useSwitchConnection()`.** It survives on `useConnect()` only as a deprecated alias. The
  replacement is `useConnectors()`, or `useConnections()` when the connector per connection is
  what is wanted. **`chains` was removed from `useSwitchChain()`** the same way.
- **`useSwitchChain().switchChain({ chainId })` requires a chain id from the configured
  chains**, not a loose `number`. The declared type is
  `chainId: chainId | config['chains'][number]['id']`, so passing a value typed as `number`
  where the config declares a literal union produces errors like
  *"This comparison appears to be unintentional because the types '1' and '0' have no overlap"*.
  Derive the id from the config rather than widening it to `number`.

These were read out of the shipped `.d.ts` files after a build failed on them, not recalled.

### Chains

The app must work against **two** chains and make the difference visible:

- `31337` — the local Anvil chain the deployment record describes. This is where the wallet
  operations are verified with a real wallet.
- `84532` — Base Sepolia. Configured so the app is not local-only, and the target for the
  deployment work that follows.

Chain id `84532` and its RPC URL must be **checked against a primary source** before being
written down, per the workspace rule that facts in skills get stale. Do not copy them from this
document without re-checking.

## 3. Decisions already made

- **No RainbowKit.** It is a wagmi-v2-era UI package; installing it reintroduces a version
  coupling that v3 deliberately removed, for a wallet button that is thirty lines of React.
  The wallet UI is written here, which also means it can be asserted by the browser tests.
- **`injected()` only.** One connector, no extra peer dependency. The extension is MetaMask.
- **The four transaction states are distinct in the UI**: `idle` / `pending` / `confirmed` /
  `failed`, plus `rejected` for a user cancellation, which is **neutral, not an error** —
  EIP-1193 code `4001` returns the UI to idle and says the user cancelled.
- **Pre-flight checks before sending**: wrong chain, insufficient asset balance, insufficient
  allowance. Each is reported before a wallet prompt appears, never as a post-hoc revert.
- **Amounts stay decimal strings in the UI and `bigint` in code.** `src/lib/format.ts` is the
  only module that knows about decimals and it already has 46 tests. Use it.
- **`simulateContract` before `writeContract`** where it is cheap, so a revert surfaces as a
  readable reason instead of a failed transaction.

## 4. What must be proven, and how

The evidence rules are the same ones the read-only console is held to.

| Claim | How it is proven |
|---|---|
| The pages render and route | `tools/browser-assert.mjs` extended to visit each route and assert rendered text |
| Wallet connection works | Real MetaMask in the user's browser via kimi-webbridge, as the sibling dApp does |
| A deposit really happens | **Transaction hash, block number, and the `Deposit` event**, cross-checked against the chain's `totalAssets` before and after |
| The approval flow is correct | The second deposit in a session must **not** prompt for approval again, and must succeed — this is the exact case the cached-state bug broke |
| Cancellation is neutral | Rejecting in the wallet leaves the UI at idle with a neutral message, and no transaction exists |
| Wrong chain is caught early | With the wallet on another chain, the deposit control is disabled with a reason, and no wallet prompt appears |
| The read-only console still works | The existing 14 browser assertions still pass, unchanged |

Every scenario above is recorded in `BROWSER-TEST-PLAN.md` §5 where it belongs, with the actual
result. Anything not run is written as not run.

## 5. Discipline this work is subject to

- Amounts never pass through a JavaScript number. `totalSupply` is `859021905704231281673`;
  as a double it becomes a different number with no error.
- No hard-coded addresses, ABI fragments, chain ids or decimals. Each is read from the chain,
  the deployment record, or a primary source that is named.
- A new test file must be picked up by the runner. `tools/run-tests.mjs` discovers `test/*.test.ts`,
  so a test added there runs; do not add a file with another extension.
- The single-source-of-truth check (`tools/check-single-source.mjs`) must keep passing: no
  precision constants and no amount arithmetic outside `src/lib/format.ts`.
- `npm test`, `tsc --noEmit` and `node tools/check-single-source.mjs` must all pass before any
  claim of completion.
