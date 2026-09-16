/**
 * What the services return, and the one rule that shapes every type here.
 *
 * EVERY AMOUNT IS A STRING, AND THAT IS NOT NEGOTIABLE
 *
 * `totalSupply` for this vault is `849930996648200851546`, which is a uint256 in base
 * units. It is far past `Number.MAX_SAFE_INTEGER` (9007199254740991). Passing it through
 * `Number()` gives 849930996648200900000 -- a number that looks right, converts back to
 * something right-ish, and is WRONG by about 40000000000000 base units of share supply.
 * Nothing throws. Nothing logs. The console would just display a slightly different
 * number than the chain.
 *
 * So the API hands out decimal strings, these types keep them as strings, and any
 * arithmetic worth doing goes through BigInt (see `src/lib/format.ts`). `Number` is
 * allowed only where the value is genuinely small: block numbers, timestamps, counts,
 * decimal-place counts.
 *
 * The sibling projects learned this the same way; it is written down again here because
 * the failure is silent in a new codebase every time.
 */

/** One point of the price series. `price` is null when the vault held no shares. */
export interface PricePoint {
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  totalAssets: string;
  totalSupply: string;
  price: string | null;
}

/** One OHLC candle. All four values are decimal strings in asset units. */
export interface Candle {
  startsAt: number;
  endsAt: number;
  open: string;
  high: string;
  low: string;
  close: string;
  /** How many blocks fell in this bucket. 1 means the candle is a single block. */
  points: number;
  firstBlock: number;
  lastBlock: number;
}

export interface VaultEvent {
  blockNumber: number;
  logIndex: number;
  blockHash: string;
  txHash: string;
  kind: string;
  account: string | null;
  assets: string | null;
  shares: string | null;
  timestamp: number;
}

/**
 * How much of the vault's life the series actually covers.
 *
 * This exists because a chart drawn without it reads as "the vault did nothing for those
 * blocks" when the truth is "we could not read those blocks". The note is displayed
 * verbatim rather than paraphrased: it is the service's own statement about its data.
 */
export interface Coverage {
  vaultStartBlock: number | null;
  seriesFromBlock: number | null;
  eventsFromBlock: number | null;
  coverageBeginsAt: number | null;
  startsLaterThanDeployment: boolean;
  note: string;
}

export interface Status {
  healthy: boolean;
  chainId: number;
  vault: string;
  asset: string;
  startBlock: number;
  lastIndexedBlock: number | null;
  chainHeadAtLastRun: number | null;
  lagBlocks: number | null;
  eventCount: number;
  snapshotCount: number;
  seriesFromBlock: number | null;
  eventsFromBlock: number | null;
  coverage: Coverage;
  updatedAt: string | null;
  staleSeconds: number | null;
  note: string;
}

export interface PriceResponse {
  series: PricePoint[];
  decimals: { asset: number; share: number };
  count: number;
  limit: number;
  maxLimit: number;
  seriesFromBlock: number | null;
  coverage: Coverage;
  note: string;
}

/**
 * What `GET /api/events` returns.
 *
 * READ OFF THE RUNNING SERVICE, like `SummaryResponse` above and for the same reason: this
 * interface was first written from the route table's one-line description, which does not
 * mention the `filter` envelope. Nothing called it, so nothing noticed -- `tsc` accepted the
 * wrong shape and the page would have silently mis-typed its own data. `test/contract.test.ts`
 * now pins the envelope field by field against the live service.
 */
export interface EventResponse {
  /** Newest first, per the service. The page re-sorts rather than trusting this. */
  events: VaultEvent[];
  count: number;
  limit: number;
  maxLimit: number;
  /** The filter the service actually applied. `null` means "not filtered", not "no match". */
  filter: { kind: string | null; account: string | null };
}

export interface CandleResponse {
  candles: Candle[];
  decimals: { asset: number; share: number };
  count: number;
  pointsPulled: number;
  pointsSkipped: number;
  bucketSeconds: number;
  limit: number;
  maxLimit: number;
  seriesFromBlock: number | null;
  coverage: Coverage;
  note: string;
}

/**
 * The event tally, keyed by event kind.
 *
 * CORRECTED AGAINST THE RUNNING SERVICE. The first version of this interface declared
 * `counts` and `totals`; the service answers with `kinds`, `totalEvents`, and the block
 * range. Nothing called it, so nothing caught it -- `tsc` was happy and the type was
 * wrong. The shape below was read off `GET /api/summary` and is asserted field by field in
 * `test/contract.test.ts`, which fails if the service and this file drift apart.
 */
export interface SummaryResponse {
  /** Event kind -> how many, and the exact sum of their `assets` as a uint256 string. */
  kinds: Record<string, { count: number; assets: string }>;
  totalEvents: number;
  firstEventBlock: number | null;
  lastEventBlock: number | null;
  lastIndexedBlock: number | null;
  /** Kinds the service saw in the logs but does not have a decoder for. */
  unknownKinds: string[];
  note: string;
}
