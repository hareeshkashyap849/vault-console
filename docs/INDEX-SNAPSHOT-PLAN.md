# Plan: give the published `/history` page real data, without a hosted service

**Status: proposed, not started.** Written 2026-09-17, after the static export was published and
the page was found to be the one hole in it.

## The problem, exactly

The published console is a static export. `/history` reads **one** source -- the index service --
and a static host runs no process, so the page says *this page has no route to the index service*
and shows nothing. That sentence is true, and it is still a page that shows nothing.

The index service itself is not the problem: its output is already committed and current
(`erc4626-vault-dapp`, `data/vault.sqlite`: chain 84532, start block 46,919,124, the real `Deposit`
at 46,919,498, one `vault_snapshots` row per indexed block). What is missing is a way for a static
page to read it.

## The approach, and the one constraint that decides it

Publish a **snapshot of the index service's own answers** as files at the paths the console already
requests. The console's client is then unchanged: it asks for `api/status`, `api/summary`,
`api/events`, `api/price`, and the static host answers with the files. Same paths, same shapes, no
second code path, no new failure mode.

**The constraint: the snapshot must be produced BY THE SERVICE, not by a script that reimplements
it.** It is tempting to read the SQLite in the Pages workflow and write the JSON directly. That
would work and it would be wrong: `src/api/price.ts` in the service owns the share-price formula,
and the console's central design decision is that it *reads that result rather than computing it*
(`README.md`, `/vault`'s price panel). A second implementation of the formula in a different
repository would be a second source of truth for the vault's most error-prone number, and the two
would agree until one of them was edited -- which is the failure this project keeps writing down.

So the workflow runs the service:

```yaml
- uses: actions/checkout@v4                      # the console
- run: git clone --depth 1 https://github.com/hareeshkashyap849/erc4626-vault-dapp /tmp/index
- name: Take a snapshot from the service itself
  run: |
    cd /tmp/index
    DATABASE_PATH=data/vault.sqlite PORT=8787 \        # the committed snapshot
      DEPLOYMENT_RECORD=deployments/base-sepolia.json \ # fetched by that repo's own workflow, or cloned
      node --experimental-strip-types src/api/cli.ts &
    # wait for /api/status, then capture each endpoint VERBATIM
    node "$GITHUB_WORKSPACE/scripts/capture-index-snapshot.mjs" \
      --service http://127.0.0.1:8787 \
      --out "$GITHUB_WORKSPACE/public/api"
```

`scripts/capture-index-snapshot.mjs` does one thing: GET four endpoints, write the bodies to
`public/api/status`, `public/api/summary`, `public/api/events`, `public/api/price`, and **refuse to
report success unless each body parses and the required fields are present**. It never computes
anything. (A file named `status` with no extension is served at `/api/status` -- the same trick
`public/api/config` already uses.)

## The honesty problem, which is the real work

A snapshot is frozen data, and a page that presents frozen figures as current is the exact bug this
console was built to avoid. Three changes, all small:

1. **The config says what it is.** `RuntimeConfig` gains `indexSnapshot: boolean`. The static build
   sets it true; development leaves it false. The generator
   (`scripts/build-runtime-config.mjs`) writes it, so it cannot drift from the build that produced
   it.
2. **The panel says what it is.** With `indexSnapshot`, the `Then` panel's source label becomes
   *read from a snapshot of the index service, taken when this page was published* instead of *read
   from the index service, which lags by design*. A reader must not have to infer this from a
   timestamp.
3. **The staleness must stay visible, not be reset.** The service computes `staleSeconds` from its
   own `updatedAt`. Captured verbatim, a snapshot taken at build time will show an age that grows
   as the page sits there -- which is true, and is better than a figure that always says "0s ago".
   The snapshot must NOT rewrite that field. It should append one sentence to `status.note`
   saying the figures are a snapshot, because the page renders that note verbatim.

The `Lag` figure deserves a second look during implementation: `lagBlocks` is measured against the
chain head the indexer last saw, so in a snapshot it is frozen at the build. That is correct for the
snapshot and should be labelled with the snapshot's time, not with "now".

## What this does NOT fix, and must not pretend to

- The figures are **as of the last publish**, not live. Anything that needs live index data (a page
  that follows the chain) still needs a hosted service. This is a portfolio artifact, and the page
  will say so.
- If the sibling repository's workflow has never actually run, the snapshot is the state as of the
  commits in this workspace. **Whether that cron fires is still unverified** -- see the README's
  note in `erc4626-vault-dapp`. The captured `updatedAt` will make that visible rather than hiding
  it, which is an improvement.
- `/history` will show the events and price series that exist in the committed snapshot; today that
  is one real `Deposit` and 1,027 price rows. It is real data, and it is a small amount of real
  data. The scale evidence lives in `base-swap-indexer` (200,000 blocks, 96,980 swaps), not here.

## Order of work

1. `scripts/capture-index-snapshot.mjs` + a unit test for its refusal path (a malformed or partial
   body must fail the build, not publish a half-valid snapshot).
2. `indexSnapshot` through `runtimeConfig.ts` -> `build-runtime-config.mjs` -> the `Then` panel's
   label in `src/app/vault/page.tsx` and `/history`'s header.
3. The workflow step, with the service started from the cloned sibling repository.
4. Verify locally first: run the service against the committed SQLite, capture into `public/api`,
   build the export, serve it as plain files, and check in a real browser that `/history` shows the
   `Deposit` row with its transaction hash and that the panel says it is a snapshot.
5. Then publish and check the same three things on the live URL.

## Why this is worth doing rather than hosting the service

Hosting the service would make `/history` live, and it needs a paid or account-bound host that
keeps a process alive -- which is the constraint the whole design already worked around for the
indexer (`erc4626-vault-dapp/.github/workflows/index.yml` explains the same reasoning). A snapshot
costs one workflow step, needs no account, and states its own limits. If the project ever gets a
host, `indexApiUrl` becomes a URL again and `indexSnapshot` becomes false: the console supports both
without either being a special case.
