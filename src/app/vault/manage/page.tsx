import { VaultManager } from '@/components/VaultManager';
import { loadDeployment } from '@/lib/deployment';
import { wagmiConfig } from '@/lib/wagmi';

/**
 * `/vault/manage` -- the server half.
 *
 * WHY THE SPLIT. The deployment record is a file on disk, and reading it is server work; the
 * wallet is browser state, and reading it is client work. So this component reads the record and
 * passes the three facts the client cannot obtain (`chainId`, `vault`, `asset`) down as props,
 * and `VaultManager` does everything else.
 *
 * That split is also what keeps the address out of the client bundle. A `NEXT_PUBLIC_*` address
 * would be a copy of the deployment record baked into the build, and a redeploy would leave the
 * page talking to the previous vault while the server rendered the new one -- the exact failure
 * `src/lib/deployment.ts` exists to prevent. Here the address in the props is the address this
 * request read.
 */

// A wallet page renders the current state of a chain that moves. Nothing about it is cacheable,
// for the same reason the console opts out: a cached allowance is the input that decides
// approve-versus-deposit.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Manage position · Vault Console',
  description:
    'Connect a browser wallet to an ERC-4626 vault: deposit assets, redeem shares, and read the allowance from the chain each time it is needed.',
};

export default async function ManagePage() {
  // Throws loudly on a missing or partial record, which is the behaviour the deployment loader
  // was written for: an address that could not be read must not become a page that queries
  // address zero and renders zeros as fact.
  const deployment = loadDeployment();

  return (
    <VaultManager
      chainId={configuredChainId(deployment.chainId)}
      vault={deployment.vault}
      // The asset is an address from the record. Its symbol and decimals are read from the chain
      // by the client, because those belong to the contract rather than to the deployment.
      asset={deployment.asset}
    />
  );
}

/**
 * The record's chain id, checked against the wallet config's own list.
 *
 * `VaultManager` takes the config's chain-id union rather than a plain `number`, because
 * `switchChain` will only accept a chain it can actually switch to -- and a `number` there is
 * what the compiler reports as having no overlap with the union.
 *
 * A DEPLOYMENT ON AN UNCONFIGURED CHAIN FAILS HERE, by name, rather than rendering a page whose
 * every control is silently unusable because the wallet can never be on that chain.
 */
function configuredChainId(chainId: number): (typeof wagmiConfig)['chains'][number]['id'] {
  const known = wagmiConfig.chains.some((chain) => chain.id === chainId);
  if (!known) {
    throw new Error(
      `The deployment record names chain ${chainId}, which is not one of the chains this app is ` +
        `configured for (${wagmiConfig.chains.map((chain) => chain.id).join(', ')}). Refusing to ` +
        'render a wallet page for a chain the wallet cannot be switched to.',
    );
  }
  return chainId as (typeof wagmiConfig)['chains'][number]['id'];
}
