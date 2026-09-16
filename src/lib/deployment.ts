import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChainConfig } from './chain.ts';

/**
 * Where the vault is.
 *
 * READ FROM THE DEPLOYMENT RECORD, NOT TYPED HERE.
 *
 * The address is written once, by the deploy script, into
 * `erc4626-vault/deployments/<chain>.json` -- and the indexer reads the same file. If the
 * console kept its own copy, then after the next deployment the console would query an
 * address with no contract on it, get zeros back, and display them as fact. That failure
 * is silent: `eth_call` to an empty address returns `0x`, viem decodes it as zero, and the
 * page renders "total assets: 0".
 *
 * So the record is the source, and the console reads it. `VAULT_DEPLOYMENT` overrides the
 * path for a deployment elsewhere; the chain shape comes from the record either way.
 */
export interface Deployment {
  chainId: number;
  vault: `0x${string}`;
  asset: `0x${string}`;
  deployBlock: number;
  chainName: string;
  note?: string;
  /** Where this was read from, so the page can say which deployment it is showing. */
  recordPath: string;
}

/**
 * The record lives in the sibling repository. The path is resolved from the workspace root
 * rather than from this file, because `process.cwd()` for `next dev` and `next build` are
 * the same (the project directory) but a bundled build should not depend on that.
 */
function candidatePaths(): string[] {
  const env = process.env.VAULT_DEPLOYMENT;
  const project = process.cwd();
  const fromEnv = env ? [resolve(env)] : [];
  return [
    ...fromEnv,
    // projects/vault-console -> projects/erc4626-vault/deployments
    resolve(project, '..', 'erc4626-vault', 'deployments', 'local.json'),
    resolve(project, '..', '..', 'projects', 'erc4626-vault', 'deployments', 'local.json'),
  ];
}

export function loadDeployment(): Deployment {
  const tried: string[] = [];
  for (const path of candidatePaths()) {
    tried.push(path);
    if (!existsSync(path)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new Error(
        `The deployment record at ${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    const r = raw as Partial<Deployment>;
    // Fail loudly on a partial record. A missing `vault` would otherwise become `undefined`
    // and reach viem as an invalid address much further downstream, where the error names
    // viem rather than the record.
    for (const field of ['chainId', 'vault', 'asset'] as const) {
      if (r[field] === undefined) {
        throw new Error(`The deployment record at ${path} has no "${field}". Refusing to guess an address.`);
      }
    }
    return {
      chainId: r.chainId as number,
      vault: r.vault as `0x${string}`,
      asset: r.asset as `0x${string}`,
      deployBlock: r.deployBlock ?? 0,
      chainName: r.chainName ?? `Chain ${r.chainId}`,
      note: r.note,
      recordPath: path,
    };
  }

  throw new Error(
    'No deployment record found. The console reads the vault address from the deploy ' +
      'script\'s output rather than keeping its own copy, because a stale copy would ' +
      'query an empty address and display zeros as fact.\n' +
      'Tried:\n' +
      tried.map((t) => `  ${t}`).join('\n') +
      '\nSet VAULT_DEPLOYMENT to point at one.',
  );
}

export function chainConfig(d: Deployment): ChainConfig {
  return { chainId: d.chainId, vault: d.vault, asset: d.asset };
}
