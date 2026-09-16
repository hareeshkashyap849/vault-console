# Public deployment runbook: vault on Base Sepolia, front end on Vercel

> **STATUS: NOT RUN YET.** Nothing in this file has been executed against a testnet. It is the
> procedure, written before the fact so that the one step that needs a funded key is the only step that
> has to wait. Every value marked *measured* was checked from this machine on 2026-09-16; everything
> else is *to be filled in when it runs*. When it has been run, this header gets replaced with what
> actually happened — including anything that failed.
>
> **What HAS been retired, so it cannot bite later**: the Vercel configuration path in step 4. The
> console needs `VAULT_DEPLOYMENT` because a host has no sibling `erc4626-vault` checkout, and that was
> an assumption until it was tested. It was tested by building and running the console with the variable
> pointing at a record **outside both repositories** (`next build` → exit 0, four routes, then
> `next start` on port 3131): the page rendered and its own header named the file it had read
> (`toolchain/_vault-record-standin.json`). The stand-in was a copy of the **Anvil** record, not a
> testnet one — a record claiming a Base Sepolia address that does not exist would be a fabricated
> address in the one file three programs treat as the source of truth. On Vercel the same variable will
> point at `deployments/base-sepolia.json` inside this repository, and the mechanism is identical.

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
repository (`toolchain/TESTNET-KEY-README.md` explains where and why). It is a throwaway testnet key
with nothing on any mainnet, which is exactly why the Alchemy route refuses it — the gate is doing its
job, and the honest response is to say so rather than to look for a way around it.

## Step 1 — deploy the vault (needs the funded key)

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

**To fill in when it runs**: vault address, deploy transaction hash, deploy block, deployer address.

## Step 2 — record it, once, in the file both readers use

`deployments/base-sepolia.json` follows the shape of `deployments/local.json`, because three
programs read it: the indexer (for its start block), the console's server components (for the
address), and `next.config.ts` at build time (for the chain id it hands to the browser).

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
nothing caught it; the first real deployment would have produced a record that `loadDeployment()`
refuses — at the end of the process, after the gas was spent. Running the validator against that old
format produces seven specific failures, including one that names the rename
(`the record does not use "address" where the readers expect "vault"`).

## Step 3 — index it

The indexer runs against Base Sepolia the same way it runs against mainnet. What it needs from the
endpoint was an open question when this runbook was written, and it has since been measured rather
than assumed:

```bash
node ../../toolchain/probe-sepolia-ranges.mjs
```

Measured 2026-09-16 against `https://sepolia.base.org` (chainId 84532, head 46,914,896), asking for
`Transfer` logs of the test USDC — a busy permanent contract, so if a range is served for it, it is
served for a vault with a handful of events:

| Window | head-1k | head-50k | head-200k |
|---|---|---|---|
| 2,000 blocks | 3,097 logs | 2,194 logs | 5,433 logs |
| 10,000 blocks | 12,959 logs | 41,377 logs | 26,975 logs |
| 50,000 blocks | `HTTP 413 eth_getLogs is limited to a 10,000 range` | same | same |
| 100,000 blocks | same | same | same |

**Two conclusions, and the second one is the useful one:**

1. **No archive restriction.** 200,000 blocks back answers normally, unlike mainnet where two of three
   public endpoints refuse historical ranges outright.
2. **The per-request cap is 10,000 blocks.** The vault indexer asks for at most **300** blocks per pass
   (`maxCatchupBlocks` in its config, overridable with `MAX_CATCHUP_BLOCKS`), so it is an order of
   magnitude inside the cap — **no change is needed to index Base Sepolia**, only `RPC_URL=https://sepolia.base.org`
   and a record whose `deployBlock` is the real deployment block.

That is the whole difference between "it will probably work" and a number: the failure mode this avoids
is discovering the cap on the deployment day, on a machine that has just spent test ETH.

**To fill in when it runs**: swaps indexed, the block range, and the indexer's own report.

## Step 4 — the front end on Vercel

The console reads its upstreams from environment variables, so the same build runs against local
services or public ones with no code change:

| Variable | Value on Vercel | Why it is needed |
|---|---|---|
| `VAULT_DEPLOYMENT` | `deployments/base-sepolia.json` (committed in this repository) | Vercel has no sibling `erc4626-vault` checkout, and the record is read at request time, not copied into source |
| `NEXT_PUBLIC_VAULT_CHAIN_ID` / `_CHAIN_NAME` | derived by `next.config.ts` from that record | the wallet config is browser code and cannot read a file, so the chain id crosses at build time |
| `VAULT_RPC` | `https://sepolia.base.org` | server-side chain reads |
| `VAULT_API` | the index service's public URL, if one is hosted | server-side index reads |

**The one real design question in this step.** On a public deployment the chain is reachable but the
index service is not, unless something hosts it. The console is built for exactly that case and will
render its `Then` panel as "the index service could not be read" with the `Now` panel still exact —
which is honest, and is also a page whose best feature is missing. There are three answers, and the
choice should be made explicitly rather than by omission:

1. **Host the index service too** (Render's free instance, as the swap indexer does). The whole
   system is public and the local-index failure path is the only thing that shows.
2. **Ship a committed snapshot** of the index output and label it as a snapshot with its capture
   time. Cheaper, and it puts a fabricated-looking number on a page whose entire argument is that
   figures carry their provenance — so the label has to be impossible to miss.
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
  four rows in `vault-console/BROWSER-TEST-PLAN.md` §5 stay `interaction not measured` even after
  this is done — unless someone drives it by hand and records the hash.
- **Free hosting sleeps.** A Render instance and a Vercel cold start both mean the first request
  after a quiet period is slow, which looks like a broken page to whoever opens it first.
