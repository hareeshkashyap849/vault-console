/**
 * Types for `scripts/capture-index-snapshot.mjs` -- so the test that exercises it is TYPECHECKED.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A SECOND CONTRACT
 *
 * `tsconfig.json` sets `allowJs: false`, so a `.mjs` script is invisible to `tsc --noEmit` -- and
 * `test/capture-index-snapshot.test.ts` imports this one. Without a declaration that import is
 * `any`, and every assertion in that test would be unchecked: a call to `checkBody('status', body)`
 * would still compile if `checkBody` were renamed, if its arguments were reordered, or if it
 * returned a boolean instead of an array of sentences. The test would fail at runtime with a
 * confusing `undefined is not a function` rather than at typecheck with a name and a line.
 *
 * So this declaration is not a description of the script written for its own sake -- it is what
 * puts the script's public surface under the same `tsc` gate as everything else in `src/` and
 * `test/`. It is deliberately hand-written rather than generated: the alternative is converting
 * the script to `.ts`, which the repository pattern supports
 * (`test/*.test.ts` runs under `--experimental-strip-types`), but the plan and the Pages workflow
 * both name the file as `scripts/capture-index-snapshot.mjs`.
 *
 * HOW DRIFT IS PREVENTED
 *
 * Two declarations can disagree with each other, so the test does not trust this file on its own:
 *
 *   * `ENDPOINTS` is asserted at runtime against the five endpoint names, and each name is used to
 *     run that endpoint's schema, so a name added to the script without a schema fails the test.
 *   * `checkBody` is declared to return `string[]`, and the test asserts on the CONTENTS of those
 *     strings -- a change from "array of problems" to "throws on the first problem" fails the
 *     first test, not the last.
 *
 * The one thing this file could still get wrong is an export the script has and this does not
 * declare, which would be a typecheck error at the import site -- loud, not silent.
 */

/** One captured endpoint: the file name, the path the console requests, and the schema for it. */
export interface Endpoint {
  /** Also the file name written into `--out`: `status` is served at `api/status`. */
  readonly name: 'status' | 'summary' | 'events' | 'price' | 'candles';
  /** The path AND query the page sends. A different query would describe a request nobody makes. */
  readonly path: string;
  /** Which validator runs against the body. */
  readonly schema: Endpoint['name'];
}

/** The sentence appended to `status.note`. Exported so the test and the script cannot disagree. */
export declare const SNAPSHOT_NOTE: string;

/** The five endpoints, in capture order. */
export declare const ENDPOINTS: readonly Endpoint[];

/**
 * Every problem with one body, as sentences. EMPTY MEANS IT CAN BE PUBLISHED.
 *
 * Returns rather than throws so a caller can report all the problems at once; `captureOne` below is
 * what turns a non-empty result into the refusal.
 */
export declare function checkBody(name: Endpoint['name'], body: unknown): string[];

/** The body as it will be written: `status.note` gains one sentence, nothing else changes. */
export declare function withSnapshotNote(name: Endpoint['name'], body: Record<string, unknown>): Record<string, unknown>;

export interface CaptureRequest {
  /** The running service's origin, e.g. `http://127.0.0.1:8787`. A trailing slash is tolerated. */
  service: string;
  endpoint: Endpoint;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** GET one endpoint, verify it, and return the exact text to write. THROWS on any refusal. */
export declare function captureOne(request: CaptureRequest): Promise<string>;

export interface CapturedFile {
  name: Endpoint['name'];
  path: string;
  text: string;
  bytes: number;
  /** What the body holds, where its byte count does not say -- `169 candles over 5000 blocks`, or null. */
  detail: string | null;
}

/**
 * What a body holds, for the endpoints whose SIZE does not say. `null` where a byte count is enough.
 *
 * Declared because the CLI's success line prints it and the test asserts the candle count it
 * reports: a capture that quietly wrote `"candles": []` would otherwise be a success line that
 * looks exactly like the one for a full chart.
 */
export declare function summariseBody(name: Endpoint['name'], body: unknown): string | null;

/**
 * Fetch all five. Resolves only when every one was captured AND verified; throws otherwise,
 * carrying every failure. There is deliberately no partial-success result: a half-valid snapshot
 * is the outcome this script exists to prevent.
 */
export declare function captureAll(options: {
  service: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CapturedFile[]>;

/** The CLI. Exit codes: 0 captured, 1 refused, 2 usage error. */
export declare function main(argv?: string[]): Promise<number>;
