# Public deployment runbook: vault on Base Sepolia, front end on Vercel

> **STATUS: STEP 1 AND 2 ARE DONE. Step 4 is verified but not deployed; step 3 has no host yet.**
>
> The vault is live on Base Sepolia:
>
> | | |
> |---|---|
> | vault | `0x7941438ee07bea4469ccd4bec583e9fb24037f35` |
> | deploy tx | `0x91cf6315b578512db189f8429a0dc76f8131328e9a14e4b5dd522699b69c663d` |
> | deploy block | 46,919,125 — the block **containing** the deploy tx above (46,919,124 is the deployment script's `DeployValidation` library, one block earlier) |
> | owner / deployer | `0x2aE746C0ff0295c2da1aC338656F247e9758E034` |
> | asset | Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals |
> | actual cost | ~0.0000095 ETH (the fork rehearsal predicted 0.0000224; the estimate is the max fee) |
>
> All six chain checks pass against the live chain (the sibling repository's own checker,
> `web3-development-execute/projects/erc4626-vault/scripts/check-deployment-record.mjs` — paths in this
> runbook that start with `web3-development-execute/` are workspace paths, not paths in this repository):
> chain id, bytecode at the address, `asset()`, `owner()`, `decimals()`, `symbol()`.
>
> **The vault is deployed and funded** — 21 USDC of test assets (`totalAssets` `21000000`,
> `totalSupply` `21000000000000000000`, read at block 46,947,044), with one real `Deposit` at block
> 46,919,498. Those totals move with every deposit or withdrawal, so read them from the chain rather
> than from this line; the deployment record's note says the same. (An earlier version of this
> paragraph said the vault was unfunded with no events. It was true when written and false by the
> time anyone read it — the same failure mode the record's note had.)
>
> **Step 4 was verified end to end without a host (2026-09-16, server build).** The console was built with the exact variables Vercel
> will use — `VAULT_DEPLOYMENT=deployments/base-sepolia.json` (a copy inside this repository, because a
> host has no sibling checkout), `VAULT_RPC=https://sepolia.base.org`, and **no index service** — and it
> rendered:
>
> ```
> vault    0x7941438ee07bea4469ccd4bec583e9fb24037f35
> chain    Base Sepolia ( 84532 )
> record   vault-console/deployments/base-sepolia.json
> Now      Total assets 0 USDC · Total shares 0
> Then     The index service could not be read. (names the URL and says it is a separate process)
> ```
>
> **That transcript is kept as the record of what was measured, with two lines now out of date**: it
> comes from the **server-built** console, where a failed index read produced "the index service could
> not be read". The console is a **static export** as of 2026-09-17 (`STATIC-EXPORT-MIGRATION.md`, beside this file),
> `indexApiUrl` is `null` on a static host, and the same panel now reports that the **page has no route
> to the index service** and makes no request at all. The other is the `Now` line: `Total assets 0 USDC ·
> Total shares 0` was the chain on 2026-09-16, and the vault has held 21 USDC of test assets since
> 2026-09-17 — the page reads the chain, so it now prints those figures instead. The addresses, the chain
> and the panel behaviour above are unaffected — the record they came from is still the single source.
>
> So the `Now` panel reads the real deployed vault from the real chain, and the `Then` panel fails
> honestly because nothing hosts the index. Shipping it is now a matter of the account, not of
> the code.
>
> **What the real deployment found, which no local run could.** The indexer crashed on its first block
> with `Cannot convert 0x to a BigInt`: a public node asked for the vault's totals *at the deployment
> block* answers `result: "0x"`, because the contract is not in the state it serves for that height. Anvil
> answers with a zero word, so every local run passed. Fixed and tested in `../erc4626-vault-dapp`
> (`decodeUintResult`). Two further hazards came out of the same session and are recorded in step 2 and
> step 3 below.

## What is being deployed, and why it is worth doing

Every project in this portfolio runs against a local Anvil chain. That is honest and it is also a
gap: a reviewer cannot open a URL and see the system working, and "it runs on my machine" is not
evidence about anything else. This runbook puts one instance of the whole stack on public
infrastructure, so the claim becomes **"there is a vault on Base Sepolia, here is the address, here
is the transaction that deployed it, and here is the front end reading it"**.

What it does **not** claim: no mainnet deployment, no audit, no real funds. Testnet only, and the
documentation says so.

## Facts measured before writing this (2026-09-16)

| Fact | Value | How it was measured |
|---|---|---|
| Base Sepolia RPC, official | `https://sepolia.base.org` → chainId **84532**, 506 ms | `fetch` with `eth_chainId` |
| Base Sepolia RPC, fallback | `https://base-sepolia.publicnode.com` → chainId **84532**, 662 ms | same |
| Test USDC on Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals, symbol USDC | recorded in `script/Deploy.s.sol`; re-read by the script from chain before it deploys |
| The deploy script's interface | `PRIVATE_KEY`, optional `BASE_SEPOLIA_RPC_URL`, `ASSET_ADDRESS`, `OWNER_ADDRESS` | `script/Deploy.s.sol` |
| Gas needed | well under 0.01 ETH — one `YieldVault` deployment, plus one ERC-20 if a custom asset is used | the contract is ~30 lines on top of OpenZeppelin; the faucet drips are 0.1–0.5 ETH, i.e. 10–50× what is needed |

**Getting test ETH — measured, and the documented list is stale.** Base's own docs point at eight
faucets; on 2026-09-16 six of them were tried from a real browser and **not one worked without an
account or a funded mainnet address**:

| Faucet | What the page actually said |
|---|---|
| [Ethereum Ecosystem](https://www.ethereum-ecosystem.com/faucets/base-sepolia) (documented as no login) | **"This deployment is temporarily paused"** |
| [Bware Labs](https://bwarelabs.com/faucets) (documented as no registration) | Cloudflare **origin DNS error** — the domain no longer resolves |
| [Blast API](https://blastapi.io/faucets) (Bware's successor) | **service deprecation notice**, redirects to Alchemy |
| [ethfaucet.com](https://ethfaucet.com/networks/base) | the form works and the address is accepted, then the claim **redirects to an Alchemy signup page** |
| [Alchemy / basefaucet.com](https://basefaucet.com/) | the form is usable without signing in, and on submit: **"Insufficient balance! You need at least 0.001 ETH on Ethereum Mainnet."** |
| [Coinbase CDP](https://portal.cdp.coinbase.com/products/faucet) | loads, then **hangs on a spinner** — it needs an interactive sign-in to a Coinbase account |

**So the practical requirement is a Coinbase/CDP account, or ≥0.001 ETH on Ethereum mainnet at the
receiving address.** That is a real cost and it is stated here rather than discovered after an hour of
clicking: the two documented "no account needed" faucets are the two that are gone, and every surviving
one has an anti-bot gate.

The deployer key for this attempt was generated with the project's own toolchain and kept outside every
repository (`web3-development-execute/toolchain/TESTNET-KEY-README.md` explains where and why). It is a throwaway testnet key
with nothing on any mainnet, which is exactly why the Alchemy route refuses it — the gate is doing its
job, and the honest response is to say so rather than to look for a way around it.

## Step 1 — deploy the vault (needs the funded key)

**Rehearsed on a fork before anything real was at stake.** The whole of step 1 and step 2 was run
against an `anvil --fork-url https://sepolia.base.org` — real Base Sepolia state, fake ETH — and the
resulting record was validated with the same script:

```
Estimated total gas used for script: 2038355
Estimated amount required: 0.000022421905 ETH
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL
```

```
PASS  the endpoint is on the record's chain (record says 84532)  (endpoint says 84532)
PASS  there is bytecode at the vault address  (5070 bytes)
PASS  the vault's asset() equals the recorded asset  (0x036CbD53842c5426634e7929541eC2318f3dCF7e)
PASS  the vault's owner() equals the recorded owner  (0x52787b9F96fCc1fCbCE34f4F0E4e363D9F05352e)
PASS  the asset reports the recorded decimals  (6 on chain, record says 6)
PASS  the asset reports the recorded symbol  (USDC on chain, record says USDC)
```

**So the real deployment costs about 0.0000224 ETH** — four orders of magnitude below the smallest
faucet drip. That number is worth having in advance: it means a shortage of gas is never the problem,
and it turns "I need test ETH" into "I need a dust-sized amount".

```powershell
cd web3-development-execute\projects\erc4626-vault
$env:PRIVATE_KEY='0x...'                       # throwaway, Base Sepolia only
$env:BASE_SEPOLIA_RPC_URL='https://sepolia.base.org'
forge script script/Deploy.s.sol --rpc-url $env:BASE_SEPOLIA_RPC_URL --broadcast --slow
```

The script validates before it broadcasts (`DeployValidation.validateInputs`: the asset must have
code, must not be the zero address, and its decimals must be the expected 6) and asserts afterwards
that the vault's `asset()`, `owner()` and starting totals are what was intended. A deployment that
passes those checks is still only *probably* right — the on-chain evidence is the transaction hash
and the block number, which the next step records.

`record-from-broadcast.mjs` builds the record from the forge broadcast file rather than from the
console output, because the console is easy to mistype and the JSON is what the tool actually did.

**To fill in when it runs**: vault address, deploy transaction hash, deploy block, deployer address.

## Step 2 — record it, once, in the file both readers use

`deployments/base-sepolia.json` follows the shape of the sibling repository's
`../../erc4626-vault/deployments/local.json`, because three
programs read it: the indexer (for its start block, from `deployBlock`), the console — through
`web3-development-execute/projects/vault-console/scripts/build-runtime-config.mjs`, which turns the record into the browser's `public/api/config` at
build time — and `next.config.ts` at build time (for the chain id it hands to the browser).

```json
{
  "chainId": 84532,
  "chainName": "Base Sepolia",
  "vault": "0x…",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "deployBlock": 0,
  "note": "Testnet deployment. No real funds; not audited."
}
```

`deployBlock` is not decoration — the indexer's start block has to be the block the vault was
deployed in, and being wrong fails **silently** in both directions: too early finds no events, too
late misses the early ones.

**Then validate the record before pointing anything else at it:**

```powershell
cd ..\erc4626-vault
node scripts\check-deployment-record.mjs deployments\base-sepolia.json --rpc https://sepolia.base.org
```

Three programs read this file and each reads a different subset of it, so a record that is merely
well-formed is not a deployment: the check requires the keys each reader actually needs, and with
`--rpc` it compares the record against the chain — code at the vault address, `asset()` and `owner()`
on the vault, and the asset's `decimals()` and `symbol()`.

**This step exists because the mistake already happened once, in the documentation.** An earlier
version of `deployments/README.md` documented the testnet record with `address` where the console reads
`vault`, and with `asset` as an object where the console reads a string. Nothing had been deployed, so
nothing caught it; the first real deployment would have produced a record that the console refuses —
at the end of the process, after the gas was spent. **What performs that refusal changed on
2026-09-17, and the check did not get weaker**: it used to be `loadDeployment()` at request time
(deleted in the static export — `STATIC-EXPORT-MIGRATION.md`, beside this file), and it is now
`web3-development-execute/projects/vault-console/scripts/build-runtime-config.mjs` at build time, which validates `vault` / `asset` / `chainId` /
`deployBlock` and exits before writing a config, plus `src/lib/runtimeConfig.ts`, which re-validates
the file the browser got back. Running the validator against that old
format produces seven specific failures, including one that names the rename
(`the record does not use "address" where the readers expect "vault"`).

**A SECOND HAZARD, FOUND BY THE REAL DEPLOYMENT: the record is read by three programs, and all three
must be given the SAME one.** The indexer, the API and the console each resolve it separately
(`DEPLOYMENT_RECORD`, `VAULT_DEPLOYMENT`, and — for the console, since the static export — the
`--record` flag of the config generator, whose output the browser reads), and getting one
wrong does not produce an error — it produces a service that reports a different vault than the one it
indexed. Measured: an API started with the right database and the wrong record answered
`chainId: 31337` with the *local* vault address while serving a Base Sepolia index, and `/api/price`
returned `503 share decimals are unknown` because it tried to read `decimals()` from an address with no
code on that chain. It failed loudly, which is why it was a five-minute fix rather than a wrong chart.

**And a third: the default database path is shared.** The indexer writes `data/vault.sqlite` unless
`DATABASE_PATH` says otherwise, so a local run and a testnet run against the same file produce a
database whose rows come from two chains — with a plausible row count and nothing in the schema
recording which chain a row came from. `web3-development-execute/toolchain/check-index-single-chain.mjs`
detects it by the
one precise fact available: rows below the start block the indexer itself recorded. Index each chain
into its own file (`DATABASE_PATH=data/vault-<chain>.sqlite`).

## Step 3 — index it

**The whole path has been rehearsed on a Base Sepolia fork** (`anvil --fork-url https://sepolia.base.org`):
a vault deployed at chain 84532, a real `Deposit` of 10 USDC, the indexer run against it, the index API
serving it, and a console **built for chain 84532** rendering it — all in one sequence, with the same
record and the same configuration shape the public deployment will use:

```
Now    Total assets 10 USDC · Total shares 10 · Price per share 1 USDC (from the index service)
Then   2026-09-16T23:27:00.000Z  open 1 …
index  healthy, lastIndexed 46916401, 1 event, 4 snapshots
       Deposit  block 46916401  assets 10000000  shares 10000000000000000000
```

**And it found a real defect — in the rehearsal itself, which is where it belongs.**

The index API takes `chainId` and `vault` from the **deployment record**, not from the database it
serves. The first rehearsal run started the API with the fork's database but without
`DEPLOYMENT_RECORD`, so it reported `chainId: 31337` and the *local Anvil* vault address while serving
fork events — and `/api/price` answered `503 share decimals are unknown`, because it tried to read
`decimals()` from an address that has no code on that chain.

Two things are worth keeping from that:

1. **Every component that reads the vault must be given the same record.** The indexer, the API and the
   console each resolve it separately (`DEPLOYMENT_RECORD`, `VAULT_DEPLOYMENT`, and the console's
   generator `--record` flag), and getting one of them
   wrong does not produce an error — it produces a service that reports a different vault than the one
   it indexed. On the real deployment there is one record and one set of variables, and this is the
   failure to check for first.
2. **The API failed loudly rather than serving a wrong number.** A 503 naming the missing decimals is a
   better outcome than a price derived from nothing, and it is the reason this was a five-minute fix
   instead of a wrong chart nobody questioned.

**Measured endpoint limits, so the indexer's settings are not guesses.** Against
`https://sepolia.base.org` (chainId 84532, head 46,914,896), asking for `Transfer` logs of the test USDC:

| Window | head-1k | head-50k | head-200k |
|---|---|---|---|
| 2,000 blocks | 3,097 logs | 2,194 logs | 5,433 logs |
| 10,000 blocks | 12,959 logs | 41,377 logs | 26,975 logs |
| 50,000 blocks | `HTTP 413 eth_getLogs is limited to a 10,000 range` | same | same |

**No archive restriction** (200,000 blocks back answers normally, unlike mainnet where two of three
public endpoints refuse historical ranges), and a **10,000-block per-request cap**. The vault indexer
asks for at most **300** blocks per pass (`maxCatchupBlocks`), so it is an order of magnitude inside the
cap — **no change is needed to index Base Sepolia**, only `RPC_URL=https://sepolia.base.org` and a record
whose `deployBlock` is real.

**To fill in when it runs**: swaps indexed, the block range, and the indexer's own report.

## Step 4 — the front end: a static export, not a Vercel server

**This step's shape changed on 2026-09-17, and this section is what it looks like now.** The console
is published as a **static export** (`STATIC_EXPORT=1 next build`) on GitHub Pages, so there is no
server to read environment variables at request time. The upstreams are decided **at build time** by
`web3-development-execute/projects/vault-console/scripts/build-runtime-config.mjs`, which writes the browser-readable `public/api/config`:

| Input | Value for the published build | Why it is needed |
|---|---|---|
| `--record deployments/base-sepolia.json` | the record committed in this repository | the published host has no sibling `erc4626-vault` checkout. The generator **fails the build** on a record missing `vault` / `asset` / `chainId` / `deployBlock` |
| `--rpc https://sepolia.base.org` | the chain the **browser** reads | chain reads happen in the browser now, and `process.env.VAULT_RPC` in a bundle is `undefined` — a fallback there would silently read the wrong chain |
| `--index /` | the index answers are **same-origin files** | the build captures the service's own responses into `public/api/` (see below), and the client fetches `api/status` and friends from the page's own directory. `null` remains the value for a page with **no** route, which says so and makes **no request** |
| `--snapshot true` | the index answers are a **snapshot**, not a live service | the published figures are frozen at build time and the panels must say so. The generator **refuses** `--snapshot true --index null` and refuses `--snapshot` with a non-boolean, because neither describes a page that can exist |
| `NEXT_PUBLIC_BASE_PATH=/<repo>` | the GitHub Pages project subpath | Next rewrites `<Link>` and the router for a `basePath`; it cannot rewrite a `fetch` written by hand, so the config loader adds it itself (`src/lib/runtimeConfig.ts`) |
| ~~`VAULT_DEPLOYMENT`~~ · ~~`NEXT_PUBLIC_VAULT_CHAIN_ID` / `_CHAIN_NAME`~~ · ~~`VAULT_API`~~ | **all three retired** | nothing in `src/` reads them: the record path is the generator's `--record` flag, the chain identity comes from the generated config (`src/lib/wagmi.ts` builds the wallet config from it), and the index URL is the config's `indexApiUrl`. `VAULT_RPC` / `VAULT_API` still configure the **dev server's** rewrites in `next.config.ts`, which is why the scenario scripts use them — a static host has no rewrite |

**The one real design question in this step, and it has been decided.** On a public deployment the
chain is reachable but the index service is not, unless something hosts it. Three answers were on the
table, and the second was chosen:

1. **Host the index service too.** Makes `/history` live; needs a host that keeps a process alive,
   which is the constraint the indexer's own design already worked around.
2. **Ship a snapshot of the index output.** ✅ **Chosen and implemented** — and, importantly, the
   snapshot is produced **by the service**, not by a script that reads the SQLite and rewrites the
   JSON: `src/api/price.ts` owns the share-price formula and a second implementation here would be a
   second source of truth for the vault's most error-prone number. The workflow clones
   `erc4626-vault-dapp`, starts it against its committed `data/vault.sqlite`, captures its answers
   into `public/api/`, and labels them as a snapshot on the page. `/history` on the published site
   therefore shows the real `Deposit` at block 46,919,498 with its transaction hash, and the
   snapshot's age grows visibly rather than being reset to zero. The engineering record, the measured
   evidence and the one endpoint not covered are in
   `web3-development-execute/projects/vault-console/docs/INDEX-SNAPSHOT-PLAN.md`.
3. **Show only what the chain supports**: link to the console but stand the wallet page at the
   front. Fewer moving parts, and a smaller claim.

## Step 5 — evidence for the claim "there is a publicly running system"

Recorded in the repository, not just in a chat message:

- the deploy transaction hash and block, checkable on a Base Sepolia explorer;
- the vault address, and a `cast call` of `asset()`, `owner()`, `totalAssets()` against it;
- the public URL, and a screenshot of it rendering chain data with the URL visible;
- the same browser assertions that run locally, run against the public URL, with the failures (there
  will be some — the index panels) kept rather than hidden.

## What this does not fix

- **No audit, no mainnet, no real funds.** A testnet deployment is evidence that the system runs
  publicly; it is not evidence that the contracts are safe to hold value.
- **The wallet write path still needs a human.** MetaMask requires a person to click Approve, so the
  four rows in `web3-development-execute/projects/vault-console/BROWSER-TEST-PLAN.md` §5 stayed
  `interaction not measured` after this runbook was written.
  **Updated 2026-09-17**: a person did drive the published wallet page by hand and recorded the hash —
  the allowance moved `0 → 1000000` (1.0 USDC) and the vault and the account both moved 20 → **21**,
  with a `Deposit` event on
  `0xbcc9f564938b4b8dc58792a4d47af22e997236ee7492e3ddfa498b263eb36751` (block 46945096). So
  "unless someone drives it by hand and records the hash" has happened; what has **not** happened is the
  rest of the evidence set (no screenshot, the approve's own hash unidentified, the `Deposit` log not
  decoded, and the deposit's `from`/`to` neither the connected account nor the vault). §5's 2026-09-17
  amendment is the record, and it is written without a causal account of the session.
  **Amendment, 2026-09-18.** That sentence's list was true of the 2026-09-17 session; the items it
  names are now filled in — the `from`/`to` item as far as naming is concerned — by a session rather
  than by an argument, so the sentence is corrected here instead of left standing. A person drove the
  **published** wallet page through a real MetaMask again
  (`verification/out/manual-wallet-2026-09-18.txt`): the screenshot now exists
  (`verification/out/screen-metamask-prompt.png`, the page in its *"Waiting for the wallet…"* pending
  state with MetaMask's spending-cap prompt in the foreground); the approve has its own hash,
  `0x71b0dfb13ea866d9821c54e0b4e25c582b160f504762cb77d661e866976606e8` (block 46,971,112, USDC
  `Approval(owner = 0x2ae7…E034, spender = the vault, value = 1000000)`); the `Deposit` log now decodes
  (`0x8f114b1d30d1373cfab3d0fd2ce35c78221d165b60bce0bf88dad0f784a24551`, block 46,971,145, type `0x2`,
  nonce `6`, `deposit(1000000, 0x2ae7…E034)` → `Deposit(sender = owner = 0x2ae7…E034, assets =
  1000000, shares = 1e18)`, and it is the read that verifies the `Deposit` topic used elsewhere); and
  the intermediary **is now named**: the 2026-09-18 approve's own receipt shows `from`
  `0xb01caea8c6c47bbf4f4b4c5080ca642043359c2e`, `to` `0xdb9b1e94b5b69df7e401ddbede43491141047db3` (the
  MetaMask `DelegationManager`) — neither the connected account — with the account carrying an EIP-7702
  delegation, i.e. the approval was executed **on behalf of** the account through that relay, while the
  deposit was sent directly by the account. **What is left is narrower, and it is not a mechanism**: the
  relay's existence is measured, and **why one write took the relay route and the other the direct route
  is not explained by anything measured** — the record at
  `verification/out/manual-wallet-2026-09-18.txt` states that as an open question rather than as a
  mechanism. The **published** index snapshot also reports `"count": 4` events now, the newest being that
  deposit at block 46,971,145, so the write is visible end to end through the public system.
- **Free hosting sleeps.** A Render instance and a Vercel cold start both mean the first request
  after a quiet period is slow, which looks like a broken page to whoever opens it first.
