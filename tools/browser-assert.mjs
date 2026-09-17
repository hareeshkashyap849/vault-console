/**
 * Assert the RENDERED pages, from a real browser, against the deployment they actually read.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A TEST FILE
 *
 * `test/*.test.ts` proves the arithmetic and the client's error classification. It cannot
 * prove that a browser paints the result: a NaN y coordinate draws nothing and raises
 * nothing, and a hydration mismatch is invisible from Node. Those are browser facts, so they
 * are checked in a browser.
 *
 * It is not under `test/` because it needs a running dev server, a running index service and
 * a running chain, and it needs a REAL browser to attach to. Making `npm test` depend on
 * three processes and a browser would mean the suite is skipped or flaky in every other
 * environment -- and a skipped test in the suite is worse than a test that lives somewhere
 * honest.
 *
 * HOW IT TALKS TO THE BROWSER
 *
 * Through the kimi-webbridge daemon, which drives the user's actual browser over CDP. That
 * is the same route `../erc4626-vault/web/tools/browser-test.mjs` uses, and it is the only
 * route available here: Chromium cannot start inside the restricted sandbox at all.
 *
 *   node tools/browser-assert.mjs                      # default http://127.0.0.1:3100
 *   node tools/browser-assert.mjs --url http://127.0.0.1:3103
 *   node tools/browser-assert.mjs --keep               # leave the tab open
 *
 * Against the published export, from inside the sandbox, the tool has to reach `github.io` and this
 * sandbox MITMs it -- so Node's `fetch` is routed through the workspace's SOCKS tunnel. `--import`
 * takes a URL on Windows, not a path:
 *
 *   node --import file:///D:/1/11111/deepseek/web3-development/web3-development-execute/toolchain/fetch-via-socks.mjs \
 *     tools/browser-assert.mjs --url https://<user>.github.io/<repo>/
 *
 * TWO TARGETS, ONE TOOL, AND WHAT THAT COSTS
 *
 * This tool is pointed at two very different things and the difference is not cosmetic:
 *
 *   LOCAL STACK (`127.0.0.1:31xx`)  Next server components, a live index service at
 *     `127.0.0.1:8787` reached through the `/api/*` rewrite, and a local chain at
 *     `127.0.0.1:8545` (Anvil, chain 31337).
 *
 *   PUBLISHED EXPORT (`https://<user>.github.io/<repo>/`)  A static export. The served HTML
 *     is a loading screen (measured: exactly 159 characters) and the page settles later. The
 *     site is mounted at `/<repo>/` with trailing slashes, so every href carries the base
 *     path. `indexApiUrl` is `/`, so the index figures come from `public/api/*` -- build-time
 *     snapshot FILES served by the same static host, not from any running service. The chain
 *     is Base Sepolia (84532), read from `https://sepolia.base.org`.
 *
 * WHICH CHECKS MEAN ANYTHING AGAINST WHICH TARGET -- read this before trusting a count
 *
 *   MEANINGFUL AGAINST BOTH (the page asserts a fact about a deployment in both):
 *     1. the HTTP response and the document served;
 *     2. everything that drives the browser -- the chart, the NaN guard, the flat-series
 *        caption, hydration, the route copy, the tables' own arithmetic, the wallet page's
 *        units and states, and the raw-base-unit scans;
 *     3. the CHAIN CROSS-CHECKS, which read the deployment the page's own `api/config`
 *        names and compare the rendered figure against it. They are meaningful against
 *        whichever deployment that is, and they are VACUOUS if aimed anywhere else -- which
 *        is exactly the defect this file was rewritten to remove.
 *
 *   MEANINGFUL ONLY AGAINST A TARGET WITH A LIVE INDEX SERVICE (local stack):
 *     4. `the index service answers at the URL the page config names`. A static host has
 *        no service to answer, so against the export this is reported SKIPPED -- an
 *        assertion that cannot fail for the reason it exists is worse than no assertion;
 *     5. the export-side substitute, which asserts the property that IS checkable there:
 *        no live service is named, the snapshot files it does read are served by the page's
 *        own host, and the lag the page renders is the lag in the file it fetched.
 *
 *   MEANINGFUL ONLY AGAINST THE LOCAL FIXTURE:
 *     6. nothing, any more. The tooltip check used to demand the local fixture's `1.1`; it
 *        now takes the expected strings from the deployment the page is reading.
 *
 *   A THIRD KIND OF CHECK IS A DESIGN DEFECT AND IS NOT WRITTEN HERE: one whose PASS is
 *   guaranteed by the shape of the comparison rather than by the page. `no raw base-unit
 *   integer anywhere in the page` was one -- it read `!<19+ digits> || page text contains a
 *   comma`, and every page in this app contains a comma, so it could not fail. See the note
 *   at that check for the demonstration and for the tightened form.
 *
 * WHAT IT ASSERTS, AND WHY EACH ONE IS NOT OBVIOUS
 *
 *   1. The page returns 200 and renders the shell. A 500 here was the original bug.
 *   2. The SVG has one <rect> and one <line> per candle, and ZERO NaN attributes. The
 *      flat-series guard is otherwise invisible: a NaN draws nothing without erroring.
 *   3. `totalSupply` is rendered as SHARES, not as a raw base-unit integer -- on the
 *      deployment the page's own config names. Read from that chain, never hard-coded.
 *   4. The flat-series caption is present, because the price did not move and the page is
 *      required to say so rather than leaving the reader to infer it from a flat line.
 *   5. No console errors and no hydration mismatch.
 *   6. The other two routes render, link to each other, and SAY what they are.
 *   7. The wallet page labels its two fields with their UNITS and states that `mint` and
 *      `withdraw` are not implemented here, in the wallet state the browser is actually in.
 *   8. The history page's count label matches the rows it actually rendered, and its tally's
 *      printed sum equals the per-kind counts on screen.
 *
 * Sections 1-6 are the console, which now lives at `/vault`. They were written when it lived
 * at `/` and they are asserted exactly as they were; only the URL moved, because the claims
 * were always about the console and not about a path.
 */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const PAGE = flag('--url', 'http://127.0.0.1:3100');
const SESSION = 'vault-console-assert';
const DAEMON = 'http://127.0.0.1:10086/command';

/**
 * WHICH STACK IS BEING MEASURED, and it is DERIVED rather than configured.
 *
 * A flag defaulting to `local` would be wrong the first time somebody pointed this at the export
 * and forgot it, and the failure that produces is silent: the local-stack-only checks would run
 * against a host that has no index service, and the two cross-checks would pass against the wrong
 * chain. So the target is read off the URL, and `--stack` exists to override it when the host is
 * not what it looks like (a tunnel, a LAN address, a preview deployment).
 */
const target = new URL(PAGE);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
const derivedStack = LOOPBACK_HOSTS.has(target.hostname) ? 'local' : 'export';
const STACK = flag('--stack', derivedStack);
if (STACK !== 'local' && STACK !== 'export') {
  console.error(`--stack must be local or export, got ${JSON.stringify(STACK)}`);
  process.exit(2);
}

/**
 * THE SITE'S ROOT, WITH A TRAILING SLASH.
 *
 * The published console is a GitHub Pages PROJECT site: it answers at `/vault-console/`, and the
 * host redirects `/vault-console` to `/vault-console/`. The tool used to build `${PAGE}/vault`,
 * which is right at a domain root and wrong everywhere else -- and the manifest of that bug was
 * five failures whose own detail text listed the CORRECT hrefs. So routes are joined to the base
 * path, and where the host may append a slash the tool sends the slash itself rather than
 * depending on a redirect to land on the right document.
 */
const ORIGIN = `${target.protocol}//${target.host}`;
const BASE_PATH = (() => {
  const path = target.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : `${path}/`;
})();
/** The base path with no trailing slash, and never just `/` -- so joining it cannot double a slash. */
const BASE_ROOT = BASE_PATH === '/' ? '' : BASE_PATH.replace(/\/$/, '');
/**
 * The absolute URL of a route, with the trailing slash the export emits.
 *
 * `BASE_ROOT` is empty at a domain root, which is why this is not `${BASE_ROOT}/x`: that form gives
 * `//x` on the local stack, and `//vault/` is a protocol-relative URL to a different host.
 */
const pageUrl = (route) => {
  const path = route === '/' || route === '' ? '/' : `/${route.replace(/^\/+|\/+$/g, '')}/`;
  return `${ORIGIN}${BASE_ROOT}${path}`;
};
/** The `href` the page must use for a route, as Next's `<Link>` emits it. */
const routeHref = (route) => {
  const path = route === '/' ? '/' : `/${route.replace(/^\/+|\/+$/g, '')}`;
  return `${BASE_ROOT}${path}` || '/';
};
/**
 * Compare two hrefs as ROUTES rather than as strings.
 *
 * The export emits `/vault-console/vault/` -- base path plus a trailing slash -- while the app's
 * source writes `href="/vault"`. Both name the same route, and an assertion about "this page links
 * to the wallet page" must not depend on which of the two spellings the router chose. The old form
 * compared against `'/vault/manage'` exactly, so on a root-mounted server-rendered page it passed
 * and under a project-site base path it failed on a page that links every route correctly.
 */
const sameHref = (a, b) => typeof a === 'string' && a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
/** The pathname a route must have rendered at, base path included. */
const expectedPath = (route) => pageUrl(route).replace(ORIGIN, '');
const samePath = (rendered, route) => rendered.replace(/\/+$/, '') === expectedPath(route).replace(/\/+$/, '');

const results = [];
const skipped = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};
/**
 * NOT APPLICABLE, WITH THE REASON, AND COUNTED SEPARATELY.
 *
 * A check that cannot fail for the reason it exists must not be counted as a pass: it teaches a
 * reader that the count means something it does not. It is recorded as skipped, it never affects
 * the exit code, and the reason says what the check would have proved and why this target cannot
 * answer it. Nothing skipped is allowed to disappear from the summary.
 */
const skip = (name, reason) => {
  skipped.push({ name, reason });
  console.log(`SKIP  ${name}  -- NOT APPLICABLE HERE: ${reason}`);
};
async function wb(action, actionArgs = {}) {
  const res = await fetch(DAEMON, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args: actionArgs, session: SESSION }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${action} failed: ${JSON.stringify(body)}`);
  return body.data;
}

/** Run JS in the page and JSON-parse the result. */
async function evaluate(code) {
  const { value, type } = await wb('evaluate', { code });
  if (type !== 'string') throw new Error(`evaluate returned ${type}, expected string: ${JSON.stringify(value)}`);
  return JSON.parse(value);
}

/**
 * THE BASE-UNIT FORMATTER, REIMPLEMENTED HERE ON PURPOSE -- SO IT CAN DISAGREE.
 *
 * `src/lib/format.ts` owns this rule for the app, and `test/*.test.ts` proves the app's copy is
 * right. If this file imported that one, the cross-check below would compare the page against
 * ITSELF and pass whatever the page did: `formatBaseUnits(x) === formatBaseUnits(x)`. The whole
 * point of a cross-check is a second implementation that can say no, so this is that second
 * implementation, written from the rule rather than from the app's code.
 *
 * The rule: a raw uint256 and the decimals the chain reports become a decimal string with the
 * trailing fraction zeros trimmed, and the integer part grouped with commas for display.
 */
function formatRaw(raw, decimals) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString();
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  const decimal = fraction === '' ? whole : `${whole}.${fraction}`;
  const [int, rest] = decimal.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest === undefined ? grouped : `${grouped}.${rest}`;
}

/** Compare two decimal strings by value: `21.0` and `21` are the same figure spelled twice. */
function sameFigure(a, b) {
  const norm = (s) => {
    if (s === null || s === undefined) return null;
    const t = String(s).trim();
    if (!/^-?\d+(\.\d*)?$/.test(t)) return null; // not a figure at all -- never "equal" by accident
    return t.replace(/\.$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  };
  const na = norm(a);
  const nb = norm(b);
  return na !== null && nb !== null && na === nb;
}

// ---- 0. THE CONFIG THE PAGE READS, WHICH IS WHERE "THE RIGHT DEPLOYMENT" COMES FROM --------
//
// THE CENTRAL FIX. The two cross-checks used to be aimed at this machine -- `127.0.0.1:8787` for
// the index and Anvil's `0x9fE4...` for the chain -- while the published page reads Base Sepolia
// at `0x7941...`. A check aimed at a deployment the page is not reading cannot fail for the reason
// it exists: the page could have been printing a raw uint256 on a different chain and the
// assertion would still have passed. So the deployment is READ OFF THE PAGE'S OWN RUNTIME CONFIG
// -- the same file the browser reads, and the single source of the addresses -- and every
// cross-check below is aimed at it. On the local stack that resolves to Anvil and the local
// service; on the export it resolves to Base Sepolia and the static snapshot. No constants.

const configPath = `${BASE_ROOT}/api/config`;
const configRes = await fetch(`${ORIGIN}${configPath}`, { headers: { accept: 'application/json' } }).catch((e) => ({
  ok: false,
  status: 0,
  json: async () => null,
  statusText: String(e),
}));
const config = configRes.ok ? await configRes.json().catch(() => null) : null;
check(
  'the page publishes the runtime config its own pages read',
  config !== null && /^0x[0-9a-fA-F]{40}$/.test(config.vault ?? ''),
  config === null
    ? `${configPath} did not answer with JSON (HTTP ${configRes.status})`
    : `vault ${config.vault}, chain ${config.chainId}`,
);

/** Everything below is aimed through these, so a missing config fails loudly instead of silently. */
const CHAIN_ID = config?.chainId ?? null;
const VAULT = config?.vault ?? null;
const RPC = config?.rpcUrl ?? null;
const CHAIN_NAME = config?.chainName ?? null;
const INDEX_URL = config?.indexApiUrl ?? null;
const IS_SNAPSHOT = config?.indexSnapshot === true;

/**
 * WHICH `fetch` THE CHAIN READS USE, AND WHY IT IS NOT ALWAYS `globalThis.fetch`.
 *
 * `--import .../fetch-via-socks.mjs` is necessary here because this sandbox MITMs `github.io`, and
 * it is enough for READING PAGES. It is not enough for a JSON-RPC call, and that is a property of
 * the tunnel rather than of the tool or of the chain: the proxy module implements one proxied HTTPS
 * **GET** (`httpsRequest` + `decodeChunked`) and ignores the method and the body, so a proxied POST
 * goes out as a GET and `sepolia.base.org` answers **405 Method not allowed**. Measured both ways,
 * 2026-09-19:
 *
 *   without the import   POST https://sepolia.base.org  ->  HTTP 200  {"jsonrpc":"2.0","result":"0x14a34"}
 *   with the import      POST https://sepolia.base.org  ->  HTTP 405  "Method not allowed"
 *
 * So the chain reads use the REAL `fetch` when the routing module exposes it, and the cross-check
 * reports which one it used. The browser is unaffected either way -- it reads the chain itself --
 * and the assertion is the same one in both cases: the page's rendered figure against the chain its
 * own config names. What would be dishonest is a SKIP caused by the transport, because the chain is
 * in fact reachable from this process.
 *
 * If a future version of the routing module loses or renames the global, the tool falls back to
 * whatever `fetch` is in front of it, and the report says so in its detail text rather than
 * pretending the check ran the same way.
 */
const REAL_FETCH = globalThis.__fetchViaSocksRealFetch ?? globalThis.fetch;
const CHAIN_FETCH_ROUTE =
  REAL_FETCH === globalThis.fetch
    ? 'globalThis.fetch (no routing module installed, or it exposes no real-fetch handle)'
    : 'globalThis.__fetchViaSocksRealFetch (routing module is installed; POST cannot go through it)';

/** `eth_call` against the endpoint the page's config names, over the route that can carry a POST. */
async function ethCall(to, data) {
  if (RPC === null || to === null) return { ok: false, reason: 'no rpcUrl/vault in the page config' };
  let body;
  try {
    const res = await REAL_FETCH(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    body = await res.json();
  } catch (e) {
    return { ok: false, reason: `${RPC} could not be reached: ${String(e)}` };
  }
  if (body.error) return { ok: false, reason: `${RPC} answered ${JSON.stringify(body.error)}` };
  if (typeof body.result !== 'string' || body.result === '0x') {
    return { ok: false, reason: `${RPC} answered ${JSON.stringify(body.result)}` };
  }
  return { ok: true, raw: BigInt(body.result).toString(), hex: body.result };
}

const chainIdCall = RPC === null
  ? { ok: false, reason: 'no rpcUrl in the page config' }
  : await REAL_FETCH(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    })
      .then((r) => r.json())
      .then((r) => (typeof r.result === 'string' ? { ok: true, id: BigInt(r.result).toString() } : { ok: false, reason: JSON.stringify(r) }))
      .catch((e) => ({ ok: false, reason: String(e) }));

/**
 * The snapshot files, when this target has them. Declared here rather than inside the branch that
 * fills it so the tooltip and lag checks below can use them without depending on declaration order.
 */
let snapshotBodies = null;

// ---- 1. the services, and the page must answer -------------------------------------------
//
// THE INDEX CHECK IS THE ONE THAT CHANGED THE MOST, and it changed because it was lying.
// `index service is reachable` fetched `http://127.0.0.1:8787/api/status` and reported PASS while
// the published page was rendering figures from a build-time snapshot of a service it never
// contacted -- it passed with `lag 538 blocks` while the page rendered `Lag 26418 blocks`. A PASS
// from that check said nothing about the artefact under test. There are now checks in its place,
// and each target gets the ones that can actually fail.

if (STACK === 'local') {
  const liveUrl =
    INDEX_URL === null
      ? null
      : /^https?:\/\//i.test(INDEX_URL)
        ? `${INDEX_URL.replace(/\/+$/, '')}/api/status`
        : `${ORIGIN}${BASE_ROOT}${INDEX_URL.replace(/\/+$/, '')}/api/status`;
  if (liveUrl === null) {
    check('the index service answers at the URL the page config names', false,
      'the page config names no index service, so there is nothing for the page to read -- and this target is supposed to have one');
  } else {
    const health = await fetch(liveUrl, { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .catch((e) => ({ error: String(e) }));
    check('the index service answers at the URL the page config names', !health.error,
      health.error ?? `${liveUrl} reports lag ${health.lagBlocks} blocks on chain ${health.chainId}`);
    if (health.chainId !== undefined && CHAIN_ID !== null) {
      check('the index service is indexing the chain the page reads',
        String(health.chainId) === String(CHAIN_ID),
        `service chain ${health.chainId}, page config chain ${CHAIN_ID}`);
    }
  }
} else if (INDEX_URL !== null && !IS_SNAPSHOT) {
  // A remote target that claims a LIVE service is making a claim this tool cannot check from
  // here, and saying nothing would be the same vacuity in a new place.
  skip('the index service answers at the URL the page config names',
    `this target's config names a live index service (indexApiUrl ${JSON.stringify(INDEX_URL)}, indexSnapshot false); ` +
      'the tool cannot reach it from Node, so it does not get to report PASS on it');
} else {
  check('the page names NO live index service, which is what a static host can have',
    INDEX_URL === null || IS_SNAPSHOT,
    `indexApiUrl ${JSON.stringify(INDEX_URL)}, indexSnapshot ${IS_SNAPSHOT}`);
  // The other half: the service is gone, and the files it was replaced by must be there. This is
  // the check that would fail if the snapshot step were dropped from the build -- which is
  // exactly what makes it worth having.
  const snapshotPaths = ['/api/status', '/api/price', '/api/candles', '/api/summary', '/api/events'];
  const missing = [];
  snapshotBodies = {};
  for (const p of snapshotPaths) {
    const res = await fetch(`${ORIGIN}${BASE_ROOT}${p}`, { headers: { accept: 'application/json' } }).catch(() => null);
    if (res === null || !res.ok) {
      missing.push(`${p} (${res === null ? 'unreachable' : res.status})`);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (json === null) missing.push(`${p} (not JSON)`);
    else snapshotBodies[p] = json;
  }
  check('the snapshot files the page reads instead of a service are served by the same host',
    missing.length === 0,
    missing.length === 0
      ? `${snapshotPaths.length} endpoints under ${BASE_ROOT}/api/`
      : `missing: ${missing.join(', ')}`);
}

let pageRes;
try {
  pageRes = await fetch(PAGE, { headers: { accept: 'text/html' } });
} catch (e) {
  check('page is reachable', false, String(e));
  console.log(`\nIs the dev server running at ${PAGE}?  npm run dev`);
  process.exit(1);
}
const html = await pageRes.text();
// Fetched without a browser: these two are about the HTTP response and the document served.
check('the page URL answers 200', pageRes.status === 200, `HTTP ${pageRes.status}`);
check('the served HTML is not a framework error page', !html.includes('Internal Server Error'), `${html.length} bytes`);
/**
 * The served document is a LOADING SCREEN, and printing that is the measurement which makes the
 * rest of this file's waiting honest. It used to be an unstated assumption that `main` implied
 * content; on an export `main` is in the static HTML and the client fills it afterwards.
 */
console.log(
  `      the served document is ${html.length} bytes and ` +
    `${/Loading the deployment record/.test(html) ? 'IS' : 'is not'} the pre-client loading screen`,
);

// ---- 2. drive the real browser ----------------------------------------------------------

await wb('navigate', { url: pageUrl('/vault'), newTab: true, group_title: 'Vault console + wallet assertions' });

/**
 * THE SETTLE WAIT, which replaces `wait({selector: 'main'})`.
 *
 * On a server-rendered page `main` implies the content. On an export it does not: the served
 * document is a 159-character loading screen, `main` is in it, and the figures arrive when the
 * client has fetched `api/config`, built wagmi and finished its queries. Measured on the published
 * routes: 159 characters at the moment `main` exists, settling to 3,433 / 2,285 / 2,406. A probe
 * taken at the first of those reads a page that has not finished becoming itself and reports the
 * client-rendered parts as missing -- which is what four of the tool's failures were.
 *
 * THREE CONDITIONS, AND EACH ONE WAS ADDED BECAUSE ITS ABSENCE PRODUCED A MEASURED FALSE READING:
 *
 *   1. the route's own `ready` selector / `readyText`, where they exist;
 *   2. the text length UNCHANGED THREE POLLS RUNNING. Two was the first version and it returns a
 *      mid-load page: on the console route the first two reads were the loading screen (a length
 *      that has not changed yet), and the probe then fired at 1,949 characters with the `Then`
 *      panel not yet rendered. Three consecutive rounds is the cheapest condition a two-phase
 *      render cannot satisfy by accident -- measured, the console settles on round 5 and the other
 *      routes on rounds 3-4;
 *   3. `needsFigure` for the console only: the CHAIN figures are a separate race from the layout.
 *      The chart comes from the index (a same-origin file on the export) while `Total shares` comes
 *      from `sepolia.base.org`, and one recorded run saw the panels and the chart with the chain
 *      figure still absent -- so a length alone says nothing about whether the figure being
 *      asserted on has arrived.
 *
 * The PROBE IS TAKEN INSIDE THE LOOP, on the poll that satisfies all three. Returning a length and
 * then probing in a separate round-trip leaves a window in which the page can re-render, which is
 * the same race in a smaller form.
 *
 * `predicate` is page-context source, so it may use `document`, `text` and `$ctx`; `$ctx` is for the
 * two facts a probe needs from THIS side of the boundary -- the deployment the page's config names
 * and the base path its hrefs must carry -- injected as a JSON literal because a page-context
 * function cannot see Node's globals.
 */
async function waitUntilSettled({ ready = null, readyText = null, needsFigure = false, ctx = {} }, predicate) {
  if (ready) await wb('wait', { selector: ready, timeout_ms: 20000 });
  if (readyText) await wb('wait', { text: readyText, timeout_ms: 20000 });
  const source = String(predicate);
  const read = async () =>
    evaluate(`(() => {
      const $ctx = ${JSON.stringify(ctx)};
      const text = document.body.innerText;
      const figure = (${source})(document, text, $ctx);
      return JSON.stringify({ url: location.pathname, text, html: document.body.innerHTML.length, probe: figure.probe, figure: figure.figure });
    })()`);

  let stable = 0;
  let last = -1;
  for (let poll = 1; poll <= 60; poll += 1) {
    const snapshot = await read();
    stable = snapshot.text.length === last ? stable + 1 : 0;
    last = snapshot.text.length;
    const figureOk = !needsFigure || snapshot.figure === 'rendered';
    if (stable >= 3 && snapshot.text.length > 200 && figureOk) {
      return { ...snapshot, settle: { settled: true, chars: snapshot.text.length, polls: poll, figure: snapshot.figure } };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const last_ = await read();
  return { ...last_, settle: { settled: false, chars: last_.text.length, polls: 60, figure: last_.figure } };
}

/** The console probe: the chart, the NaN guard, the figure and the tooltip, in one read. */
function consoleProbe(document, text) {
  const svg = document.querySelector('svg[role="img"]');
  const attrs = ['x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2'];
  const nan = [];
  if (svg) {
    for (const el of svg.querySelectorAll('rect,line')) {
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v && v.includes('NaN')) nan.push(`${el.tagName}.${a}`);
      }
    }
  }
  return {
    // `figure` decides whether the settle loop has waited long enough: a dash or the "Reading the
    // chain…" placeholder is a page that has not finished, and asserting on it reports the page's
    // own loading state as a missing figure.
    figure: /Reading the chain…/.test(text)
      ? 'reading'
      : /Total shares\s*\n?\s*([\d,\.]+)/.test(text)
        ? 'rendered'
        : 'absent',
    probe: {
      title: document.title,
      rects: svg ? svg.querySelectorAll('rect').length : -1,
      lines: svg ? svg.querySelectorAll('line').length : -1,
      groups: svg ? svg.querySelectorAll('g').length : -1,
      nanCount: nan.length,
      nanSamples: nan.slice(0, 5),
      panels: document.querySelectorAll('section').length,
      firstTitle: svg && svg.querySelector('rect > title') ? svg.querySelector('rect > title').textContent : null,
    },
  };
}

const consoleVisit = await waitUntilSettled({ needsFigure: true }, consoleProbe);
const settle = consoleVisit.settle;
const page = { ...consoleVisit.probe, text: consoleVisit.text };

check('the console route settles out of its loading screen before it is read',
  settle.settled && page.text.length > 200,
  `text was ${settle.chars} chars after ${settle.polls} polls, with the chain figure ${settle.figure}${settle.settled ? '' : ' and the page DID NOT SETTLE'}`);
check('a chart SVG is present after hydration', page.rects > 0, `${page.rects} rects`);
check('every candle drew a body', page.rects === page.groups, `${page.rects} bodies / ${page.groups} candles`);
check('NO NaN coordinates -- the flat-series guard works in a real browser', page.nanCount === 0,
  page.nanCount === 0 ? `${page.lines} lines, ${page.rects} rects all finite` : `NaN in ${page.nanSamples.join(', ')}`);
check('the four panels rendered', page.panels === 4, `${page.panels} sections`);

// ---- 3. the amount formats, which only the browser can confirm ---------------------------
//
// AIMED, AND THE AIM IS THE POINT. The old version called Anvil's `0x9fE4...` address and compared
// against `onChain.toLocaleString('en-US')`. Against the published export that reads a DIFFERENT
// CHAIN's vault, so:
//
//   * the old third clause (`rendered !== onChain.toLocaleString(...)`) was trivially true whatever
//     the page rendered, because the page was on Base Sepolia and the constant was Anvil's; and
//   * `the raw uint256 string does NOT appear as a standalone figure` searched the page for Anvil's
//     `859021905704231281673` when the page's own raw supply was `21000000000000000000` -- a check
//     that could not detect the defect it exists to detect.
//
// Both now run against the chain the PAGE'S OWN CONFIG names, and against the figure the page
// itself must print for it. `formatRaw` above is a second implementation, on purpose: importing
// the app's formatter would compare the page with itself.
const shareDecimalsCall = await ethCall(VAULT, '0x313ce567');
const totalSupplyCall = await ethCall(VAULT, '0x18160ddd');
const shareDecimals = shareDecimalsCall.ok ? Number(BigInt(shareDecimalsCall.raw)) : null;
check('the chain the page reads answered, at the address the page reads',
  shareDecimalsCall.ok && totalSupplyCall.ok && chainIdCall.ok,
  shareDecimalsCall.ok && totalSupplyCall.ok && chainIdCall.ok
    ? `${RPC} reports chain ${chainIdCall.id}; vault ${VAULT} answered totalSupply and decimals`
    : `${shareDecimalsCall.reason ?? totalSupplyCall.reason ?? chainIdCall.reason}`);
check('the chain the page reads is the chain the page config names',
  chainIdCall.ok && String(chainIdCall.id) === String(CHAIN_ID),
  chainIdCall.ok ? `${RPC} is chain ${chainIdCall.id}; the page config says ${CHAIN_ID} (${CHAIN_NAME})` : String(chainIdCall.reason));

const supplyRendered = /Total shares\s*\n?\s*([\d,\.]+)/.exec(page.text)?.[1] ?? null;
const expectedSupply = totalSupplyCall.ok && shareDecimals !== null ? formatRaw(totalSupplyCall.raw, shareDecimals) : null;

check('totalSupply rendered as SHARES, not as the raw uint256',
  expectedSupply !== null && sameFigure(supplyRendered, expectedSupply),
  `the page shows ${supplyRendered ?? 'NOTHING'}; ${VAULT} on chain ${CHAIN_ID} holds ` +
    `${totalSupplyCall.ok ? totalSupplyCall.raw : 'UNREAD'} base units with ${shareDecimals ?? '?'} decimals, which this page must print as ${expectedSupply ?? '?'}` +
    (settle.figure !== 'rendered' ? ` [the chain figure was still ${settle.figure} when the page was read]` : ''));

/**
 * THE RAW-INTEGER CHECK, AND THE COMMA THAT MADE IT UNFALSIFIABLE.
 *
 * It used to be `!/\\b\\d{19,}\\b/.test(text.replace(/,/g,'')) || text.includes(',')` -- an `||`
 * whose right side is true for every page in this app, because the amount columns and the block
 * figures all carry commas. The left side could therefore never decide the result. Demonstrated
 * rather than argued: with the text `21,000,000,000,000,000,000` the old form reports PASS while
 * a raw uint256 is on the screen.
 *
 * What the check is FOR is `21000000000000000000` reaching the DOM unformatted. After commas are
 * removed, that survives as a run of 19+ digits; a comma-GROUPED number does not, and no
 * comma-grouped number can contain such a run because every third digit is a comma. So the
 * tightened form is the left side alone, and it is falsifiable. Passing says only that the obvious
 * form of the defect is absent -- which is what its name claims, and no more -- and it is the
 * negative form of the stronger, aimed check above.
 */
const rawRuns = (page.text.replace(/,/g, '').match(/(?<!\d)\d{19,}(?!\d)/g) ?? []).slice(0, 5);
check('no raw base-unit integer anywhere in the page on the console route',
  rawRuns.length === 0,
  rawRuns.length === 0
    ? 'no run of 19+ digits survives removing the thousands separators'
    : `unformatted integer(s) on screen: ${rawRuns.join(', ')}`);

// The page must never show the raw uint256 for supply -- THE FIGURE THIS DEPLOYMENT'S PAGE WOULD
// PRINT IF THE FORMATTER WERE BYPASSED. On a real chain that string is 21 digits; on an unfunded
// vault it would be `0`, which is a figure that legitimately appears everywhere and cannot be
// searched for. That case is reported rather than counted as a pass, and the supply check above
// still applies to it: a page printing `0` shares for a funded vault is caught there.
if (totalSupplyCall.ok && totalSupplyCall.raw.length >= 8) {
  const asRaw = totalSupplyCall.raw;
  check('the raw uint256 string does NOT appear as a standalone figure',
    !new RegExp(`(^|[^\\d.,])${asRaw}([^\\d.,]|$)`).test(page.text.replace(/,/g, '')),
    `${asRaw} (${VAULT}, chain ${CHAIN_ID})`);
} else {
  skip('the raw uint256 string does NOT appear as a standalone figure',
    totalSupplyCall.ok
      ? `this deployment's totalSupply is ${totalSupplyCall.raw}, too short to be distinguishable from an ordinary figure -- the check would be vacuous in the other direction`
      : `the chain could not be read (${totalSupplyCall.reason})`);
}

// ---- 4. the flat series is declared, not implied ----------------------------------------

check('the page says the price did not move',
  /the price did not move in this window/.test(page.text),
  'a flat line must be labelled, not left to inference');

// ---- 5. the chart tooltip carries the EXACT stored strings -------------------------------
//
// WHERE THE EXPECTED VALUE COMES FROM, AND WHY IT CHANGED.
//
// The old check demanded `/open\s+1\.1/`. `1.1` is the LOCAL fixture's price and the published
// export's own snapshot has `1`, so the assertion failed against a page whose tooltip was exactly
// right -- and the only ways to make it pass were to weaken it to "some number", which would stop
// it testing anything, or to hard-code the export's value, which would break the local stack the
// same way in reverse. Instead the expected strings come from THE DEPLOYMENT THE PAGE IS READING:
// the first candle of the page's own `api/candles`, through the same format the chart's `<title>`
// uses. On the export that is the snapshot served by the same host; on the local stack it is the
// live service. It is the property the old check was reaching for -- "the tooltip carries the
// stored strings" -- asserted against the right dataset, and it is STRICTER than the old one:
// every field must match, not just `open`.
{
  const fromSnapshot = STACK === 'export' ? (snapshotBodies?.['/api/candles']?.candles?.[0] ?? null) : null;
  let firstCandle = fromSnapshot;
  let sourceLabel = "the export's own snapshot (api/candles on this host)";
  if (firstCandle === null && STACK === 'local' && INDEX_URL !== null) {
    const served = await fetch(
      `${ORIGIN}${BASE_ROOT}${INDEX_URL.replace(/\/+$/, '')}/api/candles?bucketSeconds=60&limit=5000`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    firstCandle = served?.candles?.[0] ?? null;
    sourceLabel = 'the live index service the page reads';
  }
  const expectedTitle =
    firstCandle === null
      ? null
      : `${new Date(firstCandle.startsAt * 1000).toISOString()}\n` +
        `open  ${firstCandle.open}\nhigh  ${firstCandle.high}\nlow   ${firstCandle.low}\nclose ${firstCandle.close}\n` +
        `${firstCandle.points} block${firstCandle.points === 1 ? '' : 's'} (${firstCandle.firstBlock}-${firstCandle.lastBlock})`;
  if (expectedTitle === null) {
    skip('a candle tooltip carries the exact stored strings',
      `the candle series the page reads could not be fetched from ${sourceLabel}, so there is nothing to compare the tooltip against`);
  } else {
    check('a candle tooltip carries the exact stored strings',
      page.firstTitle === expectedTitle,
      page.firstTitle === expectedTitle
        ? `the first candle of ${sourceLabel}: ${JSON.stringify(page.firstTitle.split('\n').slice(1, 3).join(' / '))}`
        : `tooltip ${JSON.stringify(page.firstTitle)}; ${sourceLabel} holds ${JSON.stringify(expectedTitle)}`);
  }
}

// ---- 6. no console errors, no hydration mismatch ----------------------------------------

const errs = await evaluate(`(() => {
  return JSON.stringify({ hasOverlay: !!document.querySelector('nextjs-portal'),
    hydration: /Hydration|hydrat/i.test(document.body.innerText),
    errorText: (document.body.innerText.match(/(could not be read|not reachable|refused)/gi) || []) });
})()`);
check('no service-failure panel is showing', errs.errorText.length === 0, errs.errorText.join(', ') || 'none');
check('no hydration mismatch text on the page', errs.hydration === false, String(errs.hydration));

/**
 * How many checks were the console's -- that is, everything above section 7, which is what this
 * tool asserted before the page moved from `/` to `/vault`.
 *
 * MEASURED, NOT WRITTEN DOWN. A hard-coded number beside the summary would drift silently the
 * first time a check above was deleted, and the line that exists to prove "the console's
 * assertions survived the move" would then be proving nothing.
 */
const CONSOLE_ASSERTIONS = results.length;

// ---- 7. the other two routes, and what each one must say --------------------------------
//
// EVERYTHING ABOVE THIS LINE IS UNCHANGED and still points at the console -- which is now at
// `/vault` instead of `/`. The move is why the checks were re-scoped by URL: the assertions are
// about the console, so they follow it, and the console's behaviour is asserted exactly as it
// was. Section 7 then covers what the move ADDED.
//
// Why a browser and not a unit test: these are claims about rendered text on real routes. A route
// that 500s, a component that throws during hydration, or a page whose copy silently disappears
// are all invisible from Node -- and the last one is the easiest of the three to ship without
// noticing.

/**
 * Navigate, wait for the page to settle, and return the rendered text plus the probe's own result.
 *
 * `predicate` is a FUNCTION, not a string of source, and it is `String(predicate)` that crosses into
 * the page. That is not style: a predicate written as a template literal is a template literal
 * INSIDE a template literal, so a backtick anywhere in it -- including inside a comment, which is
 * exactly where one was -- terminates the outer string and the file stops parsing. A function cannot
 * have that problem, and it is also checked by the editor that wrote it.
 *
 * The predicate returns `{ probe, figure }`: `probe` is whatever the checks below need, and `figure`
 * (optional) says whether a not-yet-arrived client figure has arrived, which is what lets the settle
 * loop wait for content rather than for a text length. `ctx` carries the facts a page-context
 * function cannot get from Node -- see `waitUntilSettled`.
 */
async function visit(route, { ready = null, readyText = null, needsFigure = false, ctx = {} } = {}, predicate) {
  await wb('navigate', { url: pageUrl(route) });
  const outcome = await waitUntilSettled({ ready, readyText, needsFigure, ctx }, predicate);
  return { url: outcome.url, text: outcome.text, html: outcome.html, probe: outcome.probe, settle: outcome.settle };
}

const DEPLOYMENT_CTX = { vault: VAULT, chainName: CHAIN_NAME, chainId: CHAIN_ID, baseRoot: BASE_ROOT };

// ---- 7a. `/` -- the landing page --------------------------------------------------------

const landing = await visit('/', { ctx: DEPLOYMENT_CTX }, (document, text, ctx) => {
  const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  /**
   * TRAILING SLASHES ARE NORMALISED IN THE PAGE, because that is where the page's own spelling is
   * observed. The export writes `/vault-console/vault/`; the source writes `href="/vault"`. Both are
   * the same route, and an assertion about "this page links to the wallet page" must not depend on
   * which spelling the router chose. The comparison cannot use a Node-side helper from inside a
   * page-context function -- the first attempt did, and it would have been a `ReferenceError` in the
   * browser -- so the normalisation is written out here, once, and the detail text prints both forms.
   */
  const bare = (h) => (typeof h === 'string' ? h.replace(/\/+$/, '') : h);
  const has = (route) => hrefs.some((h) => bare(h) === `${ctx.baseRoot}${route}`.replace(/\/+$/, ''));
  return {
    figure: 'n/a',
    probe: {
      hrefs,
      hasConsoleLink: has('/vault'),
      hasManageLink: has('/vault/manage'),
      hasHistoryLink: has('/history'),
      mentionsBothSources: /two independent sources|Why two sources/i.test(text),
      /**
       * The landing page shows the deployment it read, or says why it could not read one. A page
       * that showed neither would be claiming a deployment it does not have.
       *
       * THE OLD FORM WAS VACUOUS AND THIS ONE IS NOT. It read `/Anvil/.test(text) || /No deployment
       * record could be read/`. Against the published export the first arm matched -- not because
       * the page was showing an Anvil deployment, but because the page contains the sentence "on
       * the local Anvil chain this deployment record describes", hard-coded copy that is WRONG for a
       * Base Sepolia deployment. So the check passed on text that contradicts the page's own
       * deployment table: the substitution this file exists to prevent, one level down. It now
       * requires the identity the page's own `api/config` names -- the vault address, the chain's
       * name, or the chain id -- which is a fact about THIS deployment, and a page showing a
       * different one fails.
       */
      showsDeployment:
        (ctx.vault !== null && text.includes(ctx.vault)) ||
        (ctx.chainName !== null && text.includes(ctx.chainName)) ||
        (ctx.chainId !== null && new RegExp(`\\b${ctx.chainId}\\b`).test(text)) ||
        /No deployment record could be read/.test(text),
      /** The same question from the other side: does the page name a chain that is not this one? */
      namesAnvilOnANonAnvilDeployment: String(ctx.chainId) !== '31337' && /\bAnvil\b/.test(text),
    },
  };
});

check('the landing page is reachable and renders',
  /Vault Console/.test(landing.text) && landing.settle.settled,
  `${landing.text.length} chars${landing.settle.settled ? '' : ' and DID NOT SETTLE'}`);
check('the landing page links to the console', landing.probe.hasConsoleLink, landing.probe.hrefs.join(', '));
check('the landing page links to the wallet page', landing.probe.hasManageLink, landing.probe.hrefs.join(', '));
check('the landing page links to the history page', landing.probe.hasHistoryLink,
  'a route nobody links to is a route nobody reaches');
check('the landing page explains the two sources', landing.probe.mentionsBothSources, 'the pairing is the point of the console');
check('the landing page names the deployment it read', landing.probe.showsDeployment,
  `the page's own config names vault ${VAULT}, chain ${CHAIN_NAME} (${CHAIN_ID}); the check requires the page to show that ` +
    'identity -- or to say no record could be read, never a guessed address');
check('the landing page names no deployment it is not reading',
  !landing.probe.namesAnvilOnANonAnvilDeployment,
  landing.probe.namesAnvilOnANonAnvilDeployment
    ? `the page says "Anvil" while its own config reads chain ${CHAIN_ID} -- copy or fixture, either way a claim about a deployment that is not this one`
    : 'no chain named on the page disagrees with the config');
check('the landing page is not the error page', !/Internal Server Error|Application error/.test(landing.text), String(landing.html));

// ---- 7b. the console at `/vault`, after the assertions above ran on it -------------------
//
// Navigated to explicitly rather than read off the current page: the landing page above left the
// browser at `/`, so "the console answered at /vault" has to be established by asking for
// `/vault`, not by looking at wherever the last check happened to leave the tab. The first version
// of this read `location.pathname` and reported `/`, which was true and was not the question. The
// second compared `location.pathname` against `'/vault'` and reported `/vault-console/vault/` --
// the right path, at a project-site mount.

const consoleAgain = await visit('/vault', { ready: 'svg[role="img"]' }, (document) => ({
  figure: 'n/a',
  probe: {
    heading: document.querySelector('h1') ? document.querySelector('h1').textContent : null,
    panels: document.querySelectorAll('section').length,
    sources: Array.from(document.querySelectorAll('section > header > span')).map((el) => el.textContent),
  },
}));

check('the console answered at its own route', samePath(consoleAgain.url, '/vault'),
  `rendered at ${consoleAgain.url}; the route is ${expectedPath('/vault')}`);
check('the console still renders its four panels after the move',
  consoleAgain.probe.panels === 4,
  `${consoleAgain.probe.panels} sections, heading ${JSON.stringify(consoleAgain.probe.heading)}`);
/**
 * THE SOURCE LABEL, WHICH IS TWO DIFFERENT TRUE SENTENCES.
 *
 * The panel that counts events reads from the index. With a live service it says "read from the
 * index service, which lags by design"; on a build that captured the service's own answers it says
 * "read from a snapshot of the index service, taken when this page was published". The snapshot
 * work changed the copy and the old assertion kept demanding the first -- failing a page whose
 * label was MORE accurate than the one it wanted, and inviting exactly the wrong repair.
 *
 * The requirement is that the panel states where its figures came from, so the assertion accepts
 * either sentence but requires the one that matches the config's `indexSnapshot`, and it requires
 * the CHAIN panel to still say it read the chain. Accepting both unconditionally would let a
 * snapshot build claim a live index, which is the mislabelling this app's provenance rule exists
 * to prevent.
 */
const indexSource = consoleAgain.probe.sources.find((s) => /read from (a snapshot of )?the index service/.test(s)) ?? null;
const chainSource = consoleAgain.probe.sources.find((s) => /read from the chain/.test(s)) ?? null;
check('the console still labels its panels with the source the figures came from',
  indexSource !== null && chainSource !== null &&
    (IS_SNAPSHOT
      ? /snapshot of the index service, taken when this page was published/.test(indexSource)
      : !/snapshot/.test(indexSource)),
  `${JSON.stringify(indexSource)} / ${JSON.stringify(chainSource)}; the config says indexSnapshot ${IS_SNAPSHOT}`);

// ---- 7c. `/vault/manage` -- the wallet page ---------------------------------------------

/**
 * The manage page must be MEASURED AFTER ITS CLIENT COMPONENT HAS RENDERED.
 *
 * `main` exists in the served HTML; the wallet panel and the two forms do not -- they are client
 * components, and `wagmi` reports `reconnecting` on the first client render when a wallet is
 * present, so the page genuinely changes shape a moment after the HTML arrives. Waiting for the
 * panel's own text is waiting for the component tree rather than for the network.
 */
const managed = await visit(
  '/vault/manage',
  // "Deposit assets" is the deposit panel's title, and it is rendered in EVERY wallet state --
  // connected, waiting for one, and with nothing entered -- so waiting for it waits for the client
  // tree without assuming which state the browser is in. Nothing in the served HTML contains it.
  { readyText: 'Deposit assets' },
  (document, text) => {
    const inputs = Array.from(document.querySelectorAll('input')).map((el) => el.getAttribute('aria-label'));
    const buttons = Array.from(document.querySelectorAll('button')).map((el) => el.innerText.trim());

    /**
     * THE UNIT LABELS, MATCHED AGAINST WHAT THE PAGE ACTUALLY SAYS.
     *
     * The first version of this probe looked for the literal strings "Amount in assets" and
     * "Amount in shares". Neither exists: the page labels the panels `DEPOSIT ASSETS` and `REDEEM
     * SHARES` and explains each beneath. So the assertion failed while the requirement was
     * satisfied, which is the worst kind of failure -- it trains a reader to ignore the tool.
     *
     * What the assertion is FOR is the defect where the two units get swapped or dropped, because a
     * deposit takes ASSETS and a redeem takes SHARES and an unlabelled field is how those two get
     * confused. So it checks that each panel names its own unit, case-insensitively, in the panel's
     * own words -- and it checks the two are DIFFERENT, which catches a copy-paste where both say
     * the same thing.
     */
    const depositNamesAssets = /deposit\s+assets|field[^.]{0,40}\bin assets\b/i.test(text);
    const redeemNamesShares = /redeem\s+shares|field[^.]{0,40}\bin shares\b/i.test(text);
    const unitsDiffer = depositNamesAssets && redeemNamesShares;

    /**
     * THE THREE WALLET STATES, AND THE THIRD ONE IS THE FIX.
     *
     * The old probe knew two states: a wallet is connected and the form offers `Approve`/`Deposit`,
     * or no wallet is connected and the page says "Connect a wallet to deposit". The browser this
     * was measured in had a wallet connected AND an empty amount field, in which that second
     * sentence is legitimately absent and the form legitimately renders NO submit control --
     * `decideDeposit` returns `kind: 'empty'`, whose sentence is "Enter the amount of USDC you want
     * to deposit." The probe therefore reported "no deposit control and no stated absence" and the
     * check failed a page doing exactly the right thing.
     *
     * So the empty-input state is modelled, and it is asserted to say what it is: no deposit
     * control on screen AND the page asking for an amount. "Which state is this page in" becomes a
     * value the checks are written against rather than an assumption they are written on.
     */
    const walletConnected = /matches the deployment|this app is deployed on chain/.test(text);
    const asksForAnAmount = /Enter the amount of [\w$]* ?you want to deposit/.test(text);
    const asksForShares = /Enter the number of shares you want to redeem/.test(text);
    const offersDepositControl = /\b(Approve|Deposit)\b/.test(buttons.join(' '));
    const offersRedeemControl = /\bRedeem\b/.test(buttons.join(' '));
    const saysConnectToDeposit = /Connect a wallet to deposit/i.test(text);
    const saysConnectToRedeem = /Connect a wallet to redeem/i.test(text);

    return {
      figure: 'n/a',
      probe: {
      inputs,
      buttons,
      depositIsInAssets: depositNamesAssets,
      redeemIsInShares: redeemNamesShares,
      unitsAreDistinguished: unitsDiffer,
      walletConnected,
      /** Which of the three states the page is in, so a failure names the state it was judged in. */
      walletState: !walletConnected
        ? 'no wallet connected'
        : offersDepositControl || offersRedeemControl
          ? 'connected, an amount is entered'
          : 'connected, nothing entered yet',
      /**
       * A deposit control, or a statement of why there is none. Three states, each with its own
       * true sentence: no wallet -> "Connect a wallet to deposit"; connected with an empty field ->
       * "Enter the amount of USDC you want to deposit."; an amount entered -> the control itself.
       * The control is also accepted in the connected state because the check is about the page,
       * not about what this run happened to type.
       */
      hasDepositControl: offersDepositControl || saysConnectToDeposit || (walletConnected && asksForAnAmount),
      hasRedeemControl: offersRedeemControl || saysConnectToRedeem || (walletConnected && asksForShares),
      /**
       * The honest statement about which of the four ERC-4626 write paths exist here.
       *
       * `ScopeNote` renders in EVERY wallet state -- it sits outside the `no-wallet`/`wrong-chain`
       * early return in both forms -- so this sentence is on the page whether or not a wallet is
       * connected. The old probe treated it as wallet-gated and excused its absence with
       * `awaitingWallet`, which could not distinguish "the sentence is there" from "the form is
       * not"; it is asserted directly now, and the excusing arm is gone.
       */
      declaresScope:
        /does not implement[\s\S]{0,140}(mint|withdraw)/i.test(text) &&
        /\bmint\b/.test(text) &&
        /\bwithdraw\b/.test(text),
      saysNoWallet: /Connect a wallet|no wallet connected|No wallet is connected|matches the deployment/i.test(text),
      hasWallet: window.ethereum !== undefined,
      awaitingWallet: saysConnectToDeposit,
      connected: walletConnected,
      },
    };
  },
);
const manage = managed;

check('the wallet page is reachable and renders',
  /Manage your position/.test(managed.text) && managed.settle.settled,
  `${managed.text.length} chars${managed.settle.settled ? '' : ' and DID NOT SETTLE'}`);
check('the wallet page is not the error page', !/Internal Server Error|Application error/.test(managed.text), String(managed.html));
check('the deposit panel names its unit as ASSETS', manage.probe.depositIsInAssets, 'a deposit takes assets');
check('the redeem panel names its unit as SHARES', manage.probe.redeemIsInShares, 'a redeem takes shares');
check(
  'the two panels name DIFFERENT units',
  manage.probe.unitsAreDistinguished,
  'a copy-paste leaving both panels saying "assets" is how the units get swapped',
);
check("a deposit control, or the page's own statement of why there is none, is on the page",
  manage.probe.hasDepositControl,
  `state: ${manage.probe.walletState}; buttons: ${manage.probe.buttons.join(' | ') || '(none)'}`);
check("a redeem control, or the page's own statement of why there is none, is on the page",
  manage.probe.hasRedeemControl,
  `state: ${manage.probe.walletState}; buttons: ${manage.probe.buttons.join(' | ') || '(none)'}`);
check(
  'the page states it does NOT implement mint or withdraw',
  manage.probe.declaresScope,
  'two of the four write paths exist here, and the page says which -- in every wallet state, not only a connected one',
);
check('the page states the wallet situation rather than showing invented figures',
  manage.probe.saysNoWallet, `state: ${manage.probe.walletState}; window.ethereum present: ${manage.probe.hasWallet}`);
check('no hydration mismatch text on the wallet page',
  !/Hydration|hydrat/i.test(manage.text), 'the wallet context renders on the client, which is where mismatches appear');

// The manage page's figures ARE amounts: a share balance for a vault is a raw uint256, and a
// connected wallet that is not formatted would put the whole integer on screen. Same rule the
// console is held to, on the page that has real balances rather than vault totals -- and the same
// tightening: no comma escape hatch.
const manageRawRuns = manage.text.replace(/,/g, '').match(/(?<!\d)\d{19,}(?!\d)/g) ?? [];
check('the wallet page never shows a raw base-unit integer', manageRawRuns.length === 0,
  manageRawRuns.length === 0
    ? 'no run of 19+ digits survives removing the thousands separators'
    : `unformatted integer(s) on screen: ${manageRawRuns.slice(0, 5).join(', ')}`);

// ---- 7d. `/history` -- the indexed history ----------------------------------------------
//
// THE TWO ASSERTIONS HERE THAT A NODE TEST CANNOT MAKE
//
// 1. THE TABLE'S COUNT LABEL MATCHES THE ROWS ACTUALLY PAINTED. The page claims "the most recent N
//    of M events" and then renders a table. If those two disagree -- a truncated label beside a
//    full table, or a full label beside a truncated one -- the page is lying about its own
//    contents, and that is invisible from the code because both numbers come from state.
//
// 2. THE TALLY'S OWN ARITHMETIC, READ OFF THE RENDERED DOM. The summary panel prints one row per
//    event kind and then a "sum of the rows above" line. This adds the rendered per-kind counts up
//    and compares. `test/history.test.ts` proves `tallyKinds` adds correctly; only the browser can
//    prove the page RENDERS the result rather than a second number fetched from somewhere else.
//
// The rest are the same class of claim section 7c makes: a route that 500s or whose copy quietly
// disappears is invisible from Node, and "the page is up" is not "the page says what it exists to
// say".

const history = await visit(
  '/history',
  { ready: 'table' },
  (document, text) => {
    /**
     * Every table, with its header cells and its body cells, so the arithmetic can be re-done.
     *
     * `textContent` AND NOT `innerText`, which is the opposite of what the rest of this tool uses
     * and cost a debugging round to find. `innerText` reflects RENDERED styling, and these headers
     * carry Tailwind's `uppercase`, so `innerText` returns `"TRANSACTION"` while the source string
     * is `"Transaction"` -- and a check for the column it names failed against a page that rendered
     * it correctly. `textContent` is the source text, which is what a check about CONTENT should
     * read. Where the rendered form matters it is asserted separately.
     *
     * Both are then compared case-insensitively below, for the same reason: the column is the same
     * column whatever CSS has done to its case.
     */
    const cellText = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    const tables = Array.from(document.querySelectorAll('table')).map((table) => ({
      headers: Array.from(table.querySelectorAll('thead th')).map(cellText),
      rows: Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map(cellText),
      ),
    }));

    return {
      figure: 'n/a',
      probe: {
      tables,
      navHrefs: Array.from(document.querySelectorAll('nav a')).map((a) => a.getAttribute('href')),
      // The page's footer promises no wallet is required. A Connect button here would break that
      // promise, and a read-only page that asks for a wallet is the defect this checks.
      connectControls: Array.from(document.querySelectorAll('button'))
        .map((b) => b.textContent.trim())
        .filter((label) => /connect/i.test(label)),
      claim: /All (\d+) events the index holds\.|The most recent (\d+) of (\d+) events the index holds\./.exec(text),
      saysOneSource: /Nothing on this page was read from the chain/i.test(text),
      /**
       * THE SOURCE SENTENCE, WHICH IS NOW ONE OF TWO AND HAS TO MATCH THE CONFIG.
       *
       * The page said "Read from the index service alone." until the index-snapshot work changed
       * it, on a snapshot build, to "Read from a snapshot of the index service, taken when this
       * page was published. Nothing is live here: … Nothing on this page was read from the
       * chain…". The old assertion demanded the first string and failed a page that was saying
       * something MORE precise. The two are not interchangeable -- "the index service" claims a
       * running service and "a snapshot … taken when this page was published" claims a file -- so
       * the check requires the one the config's `indexSnapshot` says is true, and it always
       * requires the page to say it read no chain.
       */
      sourceSentence: /Read from (a snapshot of )?the index service[^.]*\./.exec(text)?.[0] ?? null,
      claimsSnapshot: /Read from a snapshot of the index service, taken when this page was published/.test(text),
      showsLag: /Lag\s*\n?\s*(\d+)\s*\n?\s*blocks/.exec(text)?.[1] ?? null,
      saysCurrentnessFirst: /How current this is/i.test(text),
      },
    };
  },
);

const historyTables = history.probe.tables;
const hasHeader = (table, header) =>
  table !== null && table.headers.some((h) => h.toLowerCase() === header.toLowerCase());
const eventsTable = historyTables.find((t) => hasHeader(t, 'Transaction')) ?? null;
const tallyTable = historyTables.find((t) => hasHeader(t, 'Assets moved')) ?? null;
const priceTable = historyTables.find((t) => hasHeader(t, 'Price per share')) ?? null;

check('the history page is reachable and renders',
  /Indexed History/.test(history.text) && history.settle.settled,
  `${history.text.length} chars${history.settle.settled ? '' : ' and DID NOT SETTLE'}`);
check('the history page is not the error page',
  !/Internal Server Error|Application error/.test(history.text), String(history.html));
check('the history page says it reads ONE source, and which one it is',
  history.probe.saysOneSource &&
    history.probe.sourceSentence !== null &&
    (IS_SNAPSHOT ? history.probe.claimsSnapshot : !/snapshot/.test(history.probe.sourceSentence)),
  `${JSON.stringify(history.probe.sourceSentence)}; the config says indexSnapshot ${IS_SNAPSHOT}`);
check('the history page leads with how current the index is',
  history.probe.saysCurrentnessFirst && history.probe.showsLag !== null,
  `lag ${history.probe.showsLag ?? 'ABSENT'} blocks`);

check('the events table rendered with its seven columns',
  eventsTable !== null && eventsTable.headers.length === 7,
  eventsTable ? eventsTable.headers.join(' | ') : 'no table with a Transaction column');
check('the events table has at least one row',
  (eventsTable?.rows.length ?? 0) > 0,
  `${eventsTable?.rows.length ?? 0} rows, each carrying the block and hash that prove it`);

/**
 * The claim must match the table. `All N events` or `The most recent N of M events` -- either way
 * the first captured number is the number of rows the label claims, and it has to equal the rows
 * painted.
 */
const claimedRows = history.probe.claim === null ? null : Number(history.probe.claim[1] ?? history.probe.claim[2]);
check('the count label matches the rows actually rendered',
  claimedRows !== null && claimedRows === (eventsTable?.rows.length ?? -1),
  `the label claims ${claimedRows ?? 'NOTHING'}, the table rendered ${eventsTable?.rows.length ?? 0}`);

/** The tally's own arithmetic, re-done from the rendered cells. */
if (tallyTable !== null) {
  const sumRow = tallyTable.rows.find((cells) => /sum of the rows above/i.test(cells[0] ?? '')) ?? null;
  const kindRows = tallyTable.rows.filter((cells) => !/sum of the rows above/i.test(cells[0] ?? ''));
  const renderedSum = kindRows.reduce((total, cells) => total + Number((cells[1] ?? '0').replace(/,/g, '')), 0);
  const printedSum = sumRow === null ? null : Number((sumRow[1] ?? '').replace(/,/g, ''));

  check('the tally prints a sum of its own rows',
    printedSum !== null && Number.isFinite(printedSum), `printed ${sumRow?.[1] ?? 'ABSENT'}`);
  check('the printed sum equals the rendered per-kind counts',
    printedSum === renderedSum,
    `${kindRows.length} kind rows add to ${renderedSum}, the page printed ${printedSum}`);
  check('the tally does not show a raw uint256 for "assets moved"',
    !kindRows.some((cells) => /\d{19,}/.test((cells[2] ?? '').replace(/,/g, ''))),
    kindRows.map((cells) => cells[2]).join(' | '));
} else {
  check('the tally panel rendered', false, 'no table with an "Assets moved" column');
}

check('the price series is readable as a table, not only as a chart',
  priceTable !== null && priceTable.rows.length > 0,
  priceTable ? `${priceTable.rows.length} rows` : 'the table is absent -- the chart would be the only form');
check('the price table shows shares as decimals, never as raw base units',
  priceTable !== null && !priceTable.rows.some((cells) => /\d{19,}/.test((cells[3] ?? '').replace(/,/g, ''))),
  'the share supply is an 18-decimal uint256; unformatted it would be 21 digits');
const historyRawRuns = history.text.replace(/,/g, '').match(/(?<!\d)\d{19,}(?!\d)/g) ?? [];
check('the history page never shows a raw base-unit integer', historyRawRuns.length === 0,
  historyRawRuns.length === 0
    ? 'no run of 19+ digits survives removing the thousands separators'
    : `unformatted integer(s) on screen: ${historyRawRuns.slice(0, 5).join(', ')}`);
check('the history page asks for no wallet',
  history.probe.connectControls.length === 0,
  history.probe.connectControls.length === 0
    ? 'no connect control, which is what its own footer promises'
    : `found: ${history.probe.connectControls.join(', ')}`);
check('the nav links every route from the history page',
  ['/', '/vault', '/history', '/vault/manage'].every((href) => history.probe.navHrefs.some((h) => sameHref(h, routeHref(href)))),
  `${history.probe.navHrefs.join(', ')} -- every one under the base path ${BASE_PATH}`);
check('no hydration mismatch text on the history page',
  !/Hydration|hydrat/i.test(history.text), 'the layout carries the wallet providers, so this page is inside them too');

/**
 * THE INDEX-SIDE CROSS-CHECK, AIMED AT THE FILES THE PAGE ACTUALLY READS.
 *
 * The old check on this side was `index service is reachable`, which asked a LOCAL service and
 * reported PASS while the published page rendered a build-time snapshot it never contacted. There
 * is no service to ask on the export, so instead the page's rendered index figure is compared
 * against the snapshot file served by the page's own host -- the same bytes the browser fetched. A
 * snapshot is a fixed file, so there is no race: if these disagree, the page is not showing the
 * data it says it is showing.
 */
if (STACK === 'export' && snapshotBodies?.['/api/status'] !== undefined) {
  const snapStatus = snapshotBodies['/api/status'];
  check('the lag on the page is the lag in the snapshot the page fetched',
    String(snapStatus.lagBlocks) === history.probe.showsLag,
    `the snapshot at ${BASE_ROOT}/api/status says ${snapStatus.lagBlocks}, the page renders ${history.probe.showsLag ?? 'NOTHING'}`);
} else {
  skip('the lag on the page is the lag in the snapshot the page fetched',
    STACK === 'export'
      ? 'the snapshot could not be fetched from this host, so there is nothing to compare against'
      : "this target reads a LIVE index service, whose lag moves between the page's read and this one -- the comparison would be a race, not a check");
}

// ---- summary ---------------------------------------------------------------------------

if (!args.includes('--keep')) {
  await wb('close_session', {}).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
console.log(`\ntarget: ${PAGE}  (stack: ${STACK}, base path ${BASE_PATH})`);
console.log(
  `deployment under test, read from the page's own api/config: chain ${CHAIN_ID} (${CHAIN_NAME ?? '?'}), ` +
    `vault ${VAULT}, rpc ${RPC}, index ${JSON.stringify(INDEX_URL)}${IS_SNAPSHOT ? ' (snapshot)' : ''}`,
);
console.log(
  `${results.length - failed.length} passed / ${failed.length} failed / ${skipped.length} skipped  ` +
    `(${results.length} assertions ran)`,
);
console.log(
  `(the console accounts for the first ${CONSOLE_ASSERTIONS} of the ${results.length} -- the same assertions this ` +
    'tool made before the page moved, at a new URL)',
);
if (skipped.length > 0) {
  console.log('');
  console.log('SKIPPED, and why each one cannot be answered by this target:');
  for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
}
if (failed.length > 0) {
  console.log('');
  console.log(`FAILED: ${failed.map((f) => f.name).join(' | ')}`);
  process.exit(1);
}
console.log('');
console.log('all green');
console.log(`(page text was ${page.text.length} chars; tooltip sample: ${JSON.stringify(page.firstTitle)})`);
