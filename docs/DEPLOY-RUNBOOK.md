# Public deployment runbook: vault on Base Sepolia, front end on Vercel

> **STATUS: NOT RUN YET.** Nothing in this file has been executed. It is the procedure, written
> before the fact so that the one step that needs a funded key is the only step that has to wait.
> Every value marked *measured* was checked from this machine on 2026-09-16; everything else is
> *to be filled in when it runs*. When it has been run, this header gets replaced with what
> actually happened — including anything that failed.

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

**Getting test ETH** (Base's own docs, re-checked 2026-09-16): [Bware Labs](https://bwarelabs.com/faucets)
and [Ethereum Ecosystem](https://www.ethereum-ecosystem.com/faucets/base-sepolia) need no account;
[thirdweb](https://thirdweb.com/base-sepolia-testnet), [Alchemy](https://basefaucet.com/) and
[Coinbase CDP](https://portal.cdp.coinbase.com/products/faucet) (0.1 ETH/24h) need one. The account
is a **throwaway, testnet-only key**, and it must never be the same key as anything else.

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

## Step 3 — index it

The indexer runs against Base Sepolia the same way it runs against mainnet, but the range it can
read is governed by what the endpoint will serve. Measure that first rather than assuming:

```powershell
cd ..\base-swap-indexer
node --experimental-strip-types tools\probe-rpc-range.mjs     # what will this endpoint answer?
```

**Open question, to be answered by measurement rather than guessed**: whether the vault project's
own indexer (`erc4626-vault-dapp`, which indexes `Deposit`/`Withdraw`/`YieldReported`) needs the same
historical-range treatment. It reads a narrow event set from a single vault, so its ranges are far
smaller than the swap indexer's — but "smaller" is not "served", and the probe is how that gets
settled.

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
