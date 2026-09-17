import { createPublicClient, http, parseAbi } from 'viem';

/**
 * Live chain reads.
 *
 * WHY THE CONSOLE READS THE CHAIN AND THE INDEX AT ALL
 *
 * These answer different questions and neither can answer the other's:
 *
 *   the CHAIN  knows what is true NOW, and nothing about the past -- asking a node for
 *              "every deposit since deployment" is either refused or ruinously slow.
 *   the INDEX  knows what WAS true at each block, and is always behind by design,
 *              because it runs on a schedule rather than watching the chain.
 *
 * A console that shows only one of them is misleading in a specific way: chain-only makes
 * the history invisible, index-only makes the current figures stale without saying so.
 * So the page shows both and labels which is which.
 *
 * THE TRANSPORT URL IS ABSOLUTE, AND THAT IS NOT A STYLE CHOICE
 *
 * These reads run in the BROWSER. They used to run on the server, where the first version
 * pointed the transport at `/rpc` and relied on the rewrite in `next.config.ts`: on the server
 * that throws `TypeError: Failed to parse URL`, and the resulting 500 named `/rpc` as though the
 * endpoint were unhealthy.
 *
 * The absolute requirement outlived the move, for a different reason. A browser has no
 * request-time environment, so there is no `VAULT_RPC` for the page to read, and on a static
 * host there is no server in front of it to turn a path into the real service -- a relative
 * `/rpc` would be answered by whatever serves the HTML, not by a node. So the endpoint arrives
 * as an already-absolute string from the runtime config, which is generated from the same
 * deployment record the addresses come from. `readDeployment` below is where that is spelled
 * out; `./endpoints.ts` still holds the two defaults, but only the tests read it now.
 *
 * WHY THE WRITE PATHS AND THE ALLOWANCE READS LIVE IN THIS FILE TOO
 *
 * `/vault/manage` needs `previewDeposit`, `previewRedeem`, `deposit`, `redeem` and the ERC-20
 * `allowance`. Declaring a second ABI beside the component would put the interface contract in
 * two places, and the two copies would agree until one of them was edited. Nothing here reads
 * env at module scope or touches Node built-ins, so a client component may import it.
 *
 * The signatures are FUNCTION SIGNATURES, not compiler output, and that is the deliberate
 * choice this repository already records: a signature is an interface contract that can be
 * checked against the text of ERC-4626, whereas an address is a deployment instance that must
 * be read.
 */
export const VAULT_ABI = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function previewRedeem(uint256 shares) view returns (uint256 assets)',
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  // The two write paths this app implements, with the signatures the vault's own front end
  // was read for. `deposit` takes ASSETS and `redeem` takes SHARES -- reading the two the
  // other way round is the mistake the field labels on `/vault/manage` exist to prevent.
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
]);

export const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  // Allowance is a READ, and that is the point: it is read from the chain every time a deposit
  // decision is made, never remembered. `approve` is here so the amount granted is exactly the
  // amount in front of the user.
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export interface ChainConfig {
  chainId: number;
  vault: `0x${string}`;
  asset: `0x${string}`;
}

/**
 * A chain read that failed, described in a sentence instead of a stack trace.
 *
 * THE BUG THIS FIXES
 *
 * When the RPC endpoint is down, viem throws `ContractFunctionExecutionError` and its
 * `message` is an entire diagnostic dump: the URL, the JSON-RPC request body, `Raw Call
 * Arguments`, a link to `https://viem.sh/docs/contract/readContract`, and the viem version.
 * The page rendered all of it inside the failure panel -- a full screen of JSON-RPC payload
 * where the specification says there should be "The chain could not be read." plus the
 * specific reason. It was found by screenshotting the failure path rather than by reading it,
 * because in source the line is only `error.message`.
 *
 * The text is useful to a DEVELOPER and useless to a reader, and it buries the one fact that
 * matters: which endpoint was unreachable. So the class of failure is named, the endpoint is
 * quoted, and the full text is kept in `detail` for whoever has to debug it.
 *
 * `cause` is walked as well as `name`, because viem wraps: the interesting error (the
 * `fetch failed` / `ECONNREFUSED`) is usually one or two levels down from the one that
 * reaches us.
 */
export class ChainError extends Error {
  readonly rpcUrl: string;
  readonly detail: string;
  readonly kind: 'unreachable' | 'timeout' | 'call-failed' | 'unknown';

  constructor(message: string, rpcUrl: string, detail: string, kind: ChainError['kind']) {
    super(message);
    this.name = 'ChainError';
    this.rpcUrl = rpcUrl;
    this.detail = detail;
    this.kind = kind;
  }
}

/** The deepest message in a `cause` chain, which is where the transport error lives. */
function rootCause(err: unknown): string {
  let current: unknown = err;
  let last = '';
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    last = current.message;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return last;
}

function describeChainFailure(err: unknown, url: string): ChainError {
  const name = err instanceof Error ? err.name : 'UnknownError';
  const message = err instanceof Error ? err.message : String(err);
  const root = rootCause(err);
  // viem's own message is the dump; it goes to `detail`, not to the reader.
  const detail = root && root !== message ? `${message}\n--- root cause ---\n${root}` : message;

  if (name === 'TimeoutError') {
    return new ChainError(
      `The chain node at ${url} did not answer in time. The vault's figures cannot be shown, because a ` +
        'stale reading presented as current is worse than no reading.',
      url,
      detail,
      'timeout',
    );
  }

  if (name === 'HttpRequestError' || /fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|network/i.test(`${message} ${root}`)) {
    return new ChainError(
      `The chain node at ${url} is not reachable. Check that a node is listening there and that VAULT_RPC ` +
        'points at it.',
      url,
      detail,
      'unreachable',
    );
  }

  if (name === 'ContractFunctionExecutionError' || name === 'ContractFunctionRevertedError') {
    return new ChainError(
      `The vault contract did not answer a read call. That usually means the deployment record's address ` +
        `has no contract on the chain VAULT_RPC points at (${url}), which happens after a redeploy.`,
      url,
      detail,
      'call-failed',
    );
  }

  return new ChainError(`The chain could not be read: ${name}.`, url, detail, 'unknown');
}

/** Run a chain read, turning any failure into a `ChainError`. */
async function withChainErrors<T>(rpcUrl: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw describeChainFailure(err, rpcUrl);
  }
}

/**
 * The addresses come from the deployment record, so they are not typed twice.
 *
 * The console reads the SAME record the deploy script wrote and the indexer reads. A
 * hand-copied address here would be correct until the next deployment and then silently
 * wrong -- the page would query an address with no code and report zeros.
 *
 * THE RPC URL IS AN ARGUMENT, AND THAT IS THE STATIC-EXPORT CHANGE
 *
 * These reads used to run on the server, so the endpoint came from `endpoints.ts`, which reads
 * `VAULT_RPC` at request time. They now run in the browser, and there is no request-time env
 * there: `process.env.VAULT_RPC` in a client bundle is not the operator's value, it is
 * `undefined`, and the fallback would quietly read the wrong chain. So the endpoint is passed in
 * from the runtime config, which is generated from the same deployment record -- one source, and
 * no way for the browser to fall back to a default that points somewhere else.
 */
export async function readDeployment(config: ChainConfig, rpcUrl: string) {
  return withChainErrors(rpcUrl, async () => {
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
    });

    // Read in one round trip. These are all `view` calls, so nothing here can change state.
    const [totalAssets, totalSupply, assetAddress, shareDecimals, assetSymbol, assetDecimals] = await Promise.all([
      client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'totalAssets' }),
      client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'totalSupply' }),
      client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'asset' }),
      client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'decimals' }),
      client.readContract({ address: config.asset, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address: config.asset, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);

    return {
      totalAssets: totalAssets.toString(),
      totalSupply: totalSupply.toString(),
      assetAddress,
      shareDecimals: Number(shareDecimals),
      assetSymbol,
      assetDecimals: Number(assetDecimals),
    };
  });
}

/** One holder's position, for the address the reader asks about. */
export async function readPosition(config: ChainConfig, account: `0x${string}`, rpcUrl: string) {
  return withChainErrors(rpcUrl, async () => {
    const client = createPublicClient({ transport: http(rpcUrl, { batch: true }) });
    const [shares, maxWithdraw, balance] = await Promise.all([
      client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'balanceOf', args: [account] }),
      client.readContract({ address: config.vault, abi: VAULT_ABI, functionName: 'maxWithdraw', args: [account] }),
      client.readContract({ address: config.asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [account] }),
    ]);
    return {
      shares: shares.toString(),
      maxWithdraw: maxWithdraw.toString(),
      assetBalance: balance.toString(),
    };
  });
}

export type LiveRead = Awaited<ReturnType<typeof readDeployment>>;
export type LivePosition = Awaited<ReturnType<typeof readPosition>>;
