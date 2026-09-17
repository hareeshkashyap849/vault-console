# Public deployment runbook: vault on Base Sepolia, front end on Vercel

> **STATUS: STEP 1 AND 2 ARE DONE. Step 4 is verified but not deployed; step 3 has no host yet.**
>
> The vault is live on Base Sepolia:
>
> | | |
> |---|---|
> | vault | `0x7941438ee07bea4469ccd4bec583e9fb24037f35` |
> | deploy tx | `0x91cf6315b578512db189f8429a0dc76f8131328e9a14e4b5dd522699b69c663d` |
> | deploy block | 46,919,124 |
> | owner / deployer | `0x2aE746C0ff0295c2da1aC338656F247e9758E034` |
> | asset | Circle test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals |
> | actual cost | ~0.0000095 ETH (the fork rehearsal predicted 0.0000224; the estimate is the max fee) |
>
> All six chain checks pass against the live chain (the sibling repository's own checker,
> `web3-development-execute/projects/erc4626-vault/scripts/check-deployment-record.mjs` — paths in this
> runbook that start with `web3-development-execute/` are workspace paths, not paths in this repository):
> chain id, bytecode at the address, `asset()`, `owner()`, `decimals()`, `symbol()`.
>
> **The vault is deployed and unfunded**: `totalAssets` and `totalSupply` are 0, and it has no events. That
> is stated here rather than left to be discovered, and the deployment record says it too.
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
> **That transcript is kept as the record of what was measured, with one line now out of date**: it
> comes from the **server-built** console, where a failed index read produced "the index service could
> not be read". The console is a **static export** as of 2026-09-17 (`STATIC-EXPORT-MIGRATION.md`, beside this file),
> `indexApiUrl` is `null` on a static host, and the same panel now reports that the **page has no route
> to the index service** and makes no request at all. The addresses, chain and `Now` line above are
> unaffected — the record they came from is still the single source.
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
| `--index null` | no index service | `null` is a value, not a gap: the panels say the page has no route to the index service (`no-route`) and make **no request**, instead of reporting a service they never asked |
| `NEXT_PUBLIC_BASE_PATH=/<repo>` | the GitHub Pages project subpath | Next rewrites `<Link>` and the router for a `basePath`; it cannot rewrite a `fetch` written by hand, so the config loader adds it itself (`src/lib/runtimeConfig.ts`) |
| ~~`VAULT_DEPLOYMENT`~~ · ~~`NEXT_PUBLIC_VAULT_CHAIN_ID` / `_CHAIN_NAME`~~ · ~~`VAULT_API`~~ | **all three retired** | nothing in `src/` reads them: the record path is the generator's `--record` flag, the chain identity comes from the generated config (`src/lib/wagmi.ts` builds the wallet config from it), and the index URL is the config's `indexApiUrl`. `VAULT_RPC` / `VAULT_API` still configure the **dev server's** rewrites in `next.config.ts`, which is why the scenario scripts use them — a static host has no rewrite |

**The one real design question in this step.** On a public deployment the chain is reachable but the
index service is not, unless something hosts it. The console is built for exactly that case: the
published page reports that it has **no route** to the index service, with the `Now` panel still
exact — which is honest, and is also a page whose best feature is missing. There are three answers, and the
choice should be made explicitly rather than by omission:

1. **Host the index service too.** Then point `--index` at it (an absolute URL) and rebuild, so the
   whole system is public and only the genuine index-down path shows.
2. **Ship a committed snapshot** of the index output and point `--index` at it, labelled as a
   snapshot with its capture time. Cheaper, and it puts a fabricated-looking number on a page whose
   entire argument is that figures carry their provenance — so the label has to be impossible to miss.
   `STATIC-EXPORT-MIGRATION.md`, beside this file, records this as the natural next step.
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
  four rows in `../BROWSER-TEST-PLAN.md` §5 stay `interaction not measured` even after
  this is done — unless someone drives it by hand and records the hash.
- **Free hosting sleeps.** A Render instance and a Vercel cold start both mean the first request
  after a quiet period is slow, which looks like a broken page to whoever opens it first.
