/**
 * Assert the WRITE PATH's two guards on a real, published page -- with a STUB EIP-1193 PROVIDER
 * standing in for a wallet, so no transaction is signed and no prompt is opened.
 *
 * WHY A STUB WALLET, AND WHY IT IS NOT A LOWER STANDARD OF EVIDENCE HERE
 *
 * A wallet prompt cannot be driven by a program: MetaMask decides when to show it and a person
 * clicks Approve. That is why the write path was `logic proven, interaction not measured` in
 * `BROWSER-TEST-PLAN.md` §5 for two days -- and then a person clicked, and the page answered a
 * rejected prompt with "Approval sent", and offered an `approve` on a chain the deployment is not
 * on. Both of those are facts about what the PAGE does with what the wallet says, and the wallet's
 * part of that exchange is four methods. A stub that answers exactly those four is not a
 * simplification of the wallet; it is the wallet's own EIP-1193 surface, with the two outcomes the
 * defects need (`4001` on a send, and a `chainId` that is not the deployment's).
 *
 * WHAT IT CANNOT DO, WRITTEN HERE RATHER THAN LEFT TO BE ASSUMED: it cannot show that MetaMask
 * renders this prompt, that a real signature is produced, or that a real chain accepts a
 * transaction. Those need a person and real funds, and nothing below claims otherwise.
 *
 * HOW IT DRIVES THE BROWSER
 *
 * Through the kimi-webbridge daemon, the same route `tools/browser-assert.mjs` uses (Chromium
 * cannot start inside the restricted sandbox). The stub is installed with a raw CDP call --
 * `Page.addScriptToEvaluateOnNewDocument` -- so it is in place BEFORE any page script runs: a stub
 * installed afterwards would be racing the app's own reconnect, and the measurement would depend on
 * which won.
 *
 *   node tools/wallet-double-assert.mjs
 *   node tools/wallet-double-assert.mjs --url http://127.0.0.1:3100
 *   node tools/wallet-double-assert.mjs --account 0x... --wrong-chain 8453
 *
 * Against the published export from inside this sandbox, Node's `fetch` must be routed through the
 * workspace's SOCKS tunnel for the `api/config` read (github.io is MITM'd here):
 *
 *   node --import file:///D:/1/11111/deepseek/web3-development/web3-development-execute/toolchain/fetch-via-socks.mjs \
 *     tools/wallet-double-assert.mjs --url https://<user>.github.io/<repo>/
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const PAGE = flag('--url', 'https://hareeshkashyap849.github.io/vault-console/');
/** The account the stub answers with. The default is the account the measured episodes used. */
const ACCOUNT = flag('--account', '0x2aE746C0ff0295c2da1aC338656F247e9758E034');
/**
 * The chain the stub moves the wallet TO. 8453 is Base mainnet: the chain the wallet was measured
 * on when the published page offered an `approve` this deployment does not exist on, and the chain
 * `0x2105` in the error the reader saw.
 */
const WRONG_CHAIN = Number(flag('--wrong-chain', '8453'));
const SESSION = process.env.WB_SESSION ?? 'vault-wallet-double';
const DAEMON = 'http://127.0.0.1:10086/command';

const target = new URL(PAGE);
const ORIGIN = `${target.protocol}//${target.host}`;
const BASE_PATH = (() => {
  const path = target.pathname.replace(/\/+$/, '');
  return path === '' ? '/' : `${path}/`;
})();
const BASE_ROOT = BASE_PATH === '/' ? '' : BASE_PATH.replace(/\/$/, '');
const manageUrl = (query) => `${ORIGIN}${BASE_ROOT}/vault/manage/${query === undefined ? '' : `?${query}`}`;
/**
 * A fresh query string for every load, so a scenario can never measure a CACHED document.
 *
 * The exported HTML is a loading screen that names the build's own hashed chunk files, and a host
 * may serve it from cache for minutes (GitHub Pages sends `max-age=600`): a cached document from the
 * previous deployment loads the previous deployment's code, which would turn "did the fix work?"
 * into a question about the CDN. The parameter is ignored by the router and by the app; the stub
 * reads only `stubChain`.
 */
const freshQuery = (chainId) =>
  `stubChain=${hexChain(chainId)}&run=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

async function wb(action, actionArgs = {}) {
  const res = await fetch(DAEMON, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args: actionArgs, session: SESSION }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${action} failed: ${JSON.stringify(body.error ?? body)}`);
  return body.data;
}

/** Run JS in the page and JSON-parse the result. */
async function evaluate(code) {
  const { value, type } = await wb('evaluate', { code });
  if (type !== 'string') throw new Error(`evaluate returned ${type}, expected string: ${JSON.stringify(value)}`);
  return JSON.parse(value);
}

/** Poll a page-context boolean until it is true, or give up and say how long it waited. */
async function until(source, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await evaluate(`(() => { const read = (${source}); return JSON.stringify({ ok: !!read, read }); })()`);
    if (last.ok) return { ok: true, waitedMs: Date.now() - started, read: last.read };
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, waitedMs: Date.now() - started, read: last?.read ?? null };
}

/**
 * Where the deposit panel is, in the page's own terms.
 *
 * Every probe below is scoped to it. A page-wide text search would find the REDEEM form's copy and
 * the wallet panel's, and this tool is about the deposit form's write path -- an assertion that can
 * be satisfied by text somewhere else on the page is the vacuity this repository keeps removing.
 */
const DEPOSIT = `(Array.from(document.querySelectorAll('section')).find((s) => /Deposit assets/.test(s.textContent)) || null)`;
const DEPOSIT_TEXT = `((${DEPOSIT}) ? (${DEPOSIT}).innerText : '')`;
/**
 * The write controls the deposit form offers: the approve step, the deposit itself, or the same
 * control while it is disabled and waiting.
 *
 * THAT LAST FORM IS IN THE MATCHER ON PURPOSE. On the page this tool was written against, a
 * rejected prompt left the button reading `Waiting for the wallet…` for ever -- so a matcher that
 * knew only the two enabled labels would report "no control" and hide the defect behind a probe
 * that could not see it. `Waiting for the wallet…` appears on no other control in this app.
 */
const WRITE_BUTTON = `((${DEPOSIT}) ? Array.from((${DEPOSIT}).querySelectorAll('button')).find((b) => {
  const label = b.textContent.trim();
  return /^1\\. Approve /.test(label) || label === 'Deposit' || label === 'Waiting for the wallet…';
}) || null : null)`;
/** The outcome panel the form renders for a write (`TxStatus`), inside the deposit panel. */
const TX_PANEL = `((${DEPOSIT}) ? Array.from((${DEPOSIT}).querySelectorAll('[role="status"]')).map((el) => el.innerText).join('\\n') || null : null)`;

const hexChain = (id) => `0x${id.toString(16)}`;

/**
 * THE STUB, AS SOURCE INSTALLED BEFORE ANY PAGE SCRIPT.
 *
 * `stubChain` comes from the query string so one registered script serves every scenario: the app's
 * routes are path-based and a query parameter is not part of the route, so the page renders the
 * same document with a different wallet chain.
 *
 * The four methods are the wallet's half of the exchange the write path depends on:
 *
 *   eth_requestAccounts / eth_accounts   the account
 *   eth_chainId                          the chain, and NOT the app's
 *   eth_sendTransaction                  recorded, then refused with EIP-1193 4001
 *
 * Everything else answers `-32601` (method not found) and is recorded, so an unexpected call is
 * visible in the log rather than silent.
 */
const STUB_SOURCE = (appChainHex) => `(() => {
  const params = new URLSearchParams(location.search);
  const ACCOUNT = ${JSON.stringify(ACCOUNT)};
  const state = { chainId: params.get('stubChain') || ${JSON.stringify(appChainHex)} };
  const log = [];
  const listeners = new Map();

  const provider = {
    __vaultStub: true,
    isMetaMask: false,
    request: async ({ method, params: callParams }) => {
      log.push({ method, params: callParams === undefined ? null : callParams });
      if (method === 'eth_chainId') return state.chainId;
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT];
      if (method === 'wallet_requestPermissions') {
        // Not every provider implements it; wagmi's injected connector swallows anything that is
        // not a 4001 or a -32002 and falls through to eth_requestAccounts.
        throw Object.assign(new Error('Method not found'), { code: -32601 });
      }
      if (method === 'wallet_revokePermissions') return null;
      if (method === 'wallet_switchEthereumChain') {
        state.chainId = callParams[0].chainId;
        for (const handler of listeners.get('chainChanged') || []) handler(state.chainId);
        return null;
      }      if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
        // THE READER'S REJECTION. Nothing is signed, nothing is broadcast, no gas is spent.
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      }
      throw Object.assign(new Error('the stub has no ' + method), { code: -32601 });
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return provider;
    },
    removeListener(event, handler) {
      const list = listeners.get(event) || [];
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
      return provider;
    },
  };

  const install = () => {
    try {
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true });
    } catch (error) {
      window.__vaultStubError = String(error);
    }
  };
  install();
  // Re-asserted once the document has parsed: an extension's provider can inject after this script,
  // and a run where the stub lost that race must not be read as a run about this app.
  document.addEventListener('DOMContentLoaded', install);

  /**
   * The switch, as the WALLET performs it: the chain changes and every registered listener is told.
   *
   * The app learns the wallet's chain from the EIP-1193 chainChanged event, so a scenario that only
   * changed the answer to eth_chainId would be testing something no wallet does. This is the event.
   * (No backticks in this source: it is a template literal, and one would end it here -- including
   * inside a comment, which is how this file first failed to parse.)
   */
  window.__vaultStubSetChain = (hex) => {
    state.chainId = hex;
    for (const handler of listeners.get('chainChanged') || []) handler(hex);
    return state.chainId;
  };

  window.__vaultStubLog = log;
  window.__vaultStubState = state;
  window.__vaultStubAccount = ACCOUNT;
})()`;

/** Every method the stub was asked for, in order, plus the send attempts. */
const READ_LOG = `(() => {
  const log = window.__vaultStubLog || [];
  return JSON.stringify({
    methods: log.map((entry) => entry.method),
    sends: log.filter((entry) => entry.method === 'eth_sendTransaction' || entry.method === 'wallet_sendTransaction'),
    stubInstalled: !!(window.ethereum && window.ethereum.__vaultStub === true),
    stubChainId: window.__vaultStubState ? window.__vaultStubState.chainId : null,
    stubError: window.__vaultStubError || null,
  });
})()`;

// ---- 0. the deployment the page reads, which is where the two chain numbers come from ----------

const configPath = `${BASE_ROOT}/api/config`;
const configRes = await fetch(`${ORIGIN}${configPath}`, { headers: { accept: 'application/json' } }).catch(() => null);
const config = configRes !== null && configRes.ok ? await configRes.json().catch(() => null) : null;
check(
  'the page publishes the runtime config the write path is aimed at',
  config !== null && Number.isInteger(config.chainId) && config.chainId !== WRONG_CHAIN,
  config === null
    ? `${configPath} did not answer with JSON (HTTP ${configRes === null ? 'unreachable' : configRes.status})`
    : `chain ${config.chainId} (${config.chainName}), vault ${config.vault}; the foreign chain is ${WRONG_CHAIN}`,
);
if (config === null) {
  console.log('\nNothing below can be aimed without the config. Is the site reachable (and, from this sandbox, is the SOCKS route installed)?');
  process.exit(1);
}
const APP_CHAIN = config.chainId;
const VAULT = config.vault;

// ---- 1. the tab, and the stub that must be in place before anything loads ----------------------

// A session that reports a stale tab is a session whose `navigate` lands somewhere unexpected.
await wb('close_session').catch(() => undefined);
await wb('navigate', { url: manageUrl(), newTab: true, group_title: 'Wallet write-path assertions (stub wallet)' });
const registered = await wb('cdp', {
  method: 'Page.addScriptToEvaluateOnNewDocument',
  params: { source: STUB_SOURCE(hexChain(APP_CHAIN)) },
});
check('the stub provider is registered to install before any page script', typeof registered?.identifier === 'string', `CDP script identifier ${registered?.identifier}`);

/**
 * Load the manage route with the stub set to `chainId`, then CONNECT -- explicitly.
 *
 * THE CONNECT STEP IS NOT OPTIONAL AND IT IS NOT DECORATION. wagmi only reconnects on load when its
 * `injected.connected` shim is in `localStorage` for THIS origin, so a page that had never been
 * connected here renders its disconnected state -- and every "no write control" assertion below
 * would then pass because there is nothing on the page at all. Measured on a local export: a version
 * of this tool that waited for a connection instead of making one reported four green checks about
 * a page with no wallet. So the wallet is connected by clicking the button the reader clicks, and a
 * run that cannot connect aborts rather than reporting vacuously.
 *
 * The wait is for the CONNECTED wallet panel -- an address, not the chain figure. Waiting for the
 * chain figure would make the wait itself depend on the defect: on the broken page the panel says
 * the app's chain whatever the wallet says, so a wait for the wallet's chain would time out and
 * abort the very scenario that has to fail.
 */
async function loadWith(chainId) {
  await wb('navigate', { url: manageUrl(freshQuery(chainId)), newTab: false });
  await until(`(() => {
    const hasAddress = /0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/.test(document.body.innerText);
    const button = Array.from(document.querySelectorAll('button')).find((b) => /Connect wallet/.test(b.textContent));
    if (!hasAddress && button && !button.disabled) button.click();
    return hasAddress;
  })()`, 30000);
  const connected = await until(`/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/.test(document.body.innerText)`, 20000);
  /**
   * Then wait for the form to have DECIDED. Connected is a fact about the wallet; "what the form
   * offers" is a fact about four chain reads that arrive afterwards, and a probe taken between them
   * reads a half-built form -- measured: one pass matched the write control while the asset symbol
   * beside it still rendered as the `—` placeholder.
   *
   * Either settled shape counts, and which one is expected is the scenario's business: the
   * deployment's chain renders the balance line, another chain renders the refusal.
   */
  await until(`(() => {
    const t = ${DEPOSIT_TEXT};
    // The symbol is a SEPARATE read from the balance, and it lands later: "balance 18 —" is a form
    // whose asset identity has not arrived, and a decision taken there is taken with decimals the
    // chain has not reported yet. So the wait is for the whole line, symbol included.
    return /balance [\\d,.]+ [A-Z]/.test(t) || /Switch the wallet to chain/.test(t);
  })()`, 30000);
  const probe = await evaluate(`(() => {
    const text = document.body.innerText;
    const panel = /Wallet chain\\n(\\d+)/.exec(text);
    return JSON.stringify({
      connected: /0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/.test(text),
      walletChainRendered: panel ? panel[1] : null,
      matchesCopy: /matches the deployment/.test(text),
      stubInstalled: !!(window.ethereum && window.ethereum.__vaultStub === true),
      text,
    });
  })()`);
  return { connected, probe };
}

/** Type an amount into the deposit field and wait for a write control to become available. */
async function offerWrite(amount = '1') {
  await evaluate(`(() => {
    const panel = ${DEPOSIT};
    const input = panel && panel.querySelector('input[inputmode="decimal"]');
    if (!input) return JSON.stringify({ ok: false, reason: 'no amount field in the deposit panel' });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(amount)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return JSON.stringify({ ok: true, value: input.value });
  })()`);
  const available = await until(`(() => { const b = ${WRITE_BUTTON}; return b && !b.disabled ? b.textContent.trim() : false; })()`);
  const state = await evaluate(`(() => {
    const notice = (${DEPOSIT}) ? (${DEPOSIT}).innerText.split('\\n').find((line) => /allowance is|Switch the wallet|more USDC|Enter the amount/.test(line)) : null;
    return JSON.stringify({ notice: notice || null });
  })()`);
  return { label: available.read, ok: available.ok, notice: state.notice };
}

/** Click the write control, and report the label that was clicked. */
async function clickWrite() {
  return evaluate(`(() => {
    const button = ${WRITE_BUTTON};
    if (!button) return JSON.stringify({ clicked: null, reason: 'the deposit panel offers no write control' });
    const label = button.textContent.trim();
    button.click();
    return JSON.stringify({ clicked: label });
  })()`);
}

/** The page's own account of the write, after a click has been dealt with. */
async function readOutcome() {
  return evaluate(`(() => {
    const panel = ${TX_PANEL};
    return JSON.stringify({
      txPanel: panel,
      text: ${DEPOSIT_TEXT},
      button: (${WRITE_BUTTON}) ? { label: (${WRITE_BUTTON}).textContent.trim(), disabled: (${WRITE_BUTTON}).disabled } : null,
    });
  })()`);
}

/** The deposit panel's rendered text. Every `evaluate` in this file returns JSON, so it comes back wrapped. */
const PAGE_TEXT = `(() => { return JSON.stringify({ text: ${DEPOSIT_TEXT} }); })()`;

/** A 32-byte hex string on the page: a transaction hash, or the absence of one. */
const PAGE_HASHES = `(() => {
  const found = (${DEPOSIT_TEXT}).match(/0x[0-9a-fA-F]{64}/g) || [];
  return JSON.stringify({ hashes: found });
})()`;

// ---- 2. SCENARIO A: the reader rejects the prompt ---------------------------------------------
//
// The measured defect, reproduced: the wallet is on the deployment's chain, the form offers the
// approve step, and the wallet answers the send with EIP-1193 4001. The published page then
// reported "Approval sent. The wallet prompt is done; this waits for the chain to include it."

console.log('\n--- A. the reader rejects the prompt in the wallet ---');
const a = await loadWith(APP_CHAIN);
/**
 * NOTHING BELOW IS ABOUT THIS APP IF THE PAGE IS NOT CONNECTED, so a run that cannot connect stops
 * here. Every "no write control was offered" assertion in this file is satisfied by a page with no
 * wallet on it, and a green run of those checks would be a statement about an empty page.
 */
check('the page is connected to the stub wallet, not to a real one',
  a.connected && a.probe.stubInstalled,
  `wallet panel says chain ${a.probe.walletChainRendered}${a.probe.matchesCopy ? ' (matches the deployment)' : ''}, ` +
    `stub installed: ${a.probe.stubInstalled}`);
if (!a.connected || !a.probe.stubInstalled) {
  console.log('\nThe page never connected to the stub provider, so no scenario below would be about the write path. Stopping.');
  await wb('close_session').catch(() => undefined);
  process.exit(1);
}

const aOffer = await offerWrite('1');
check('A: the deposit form offers a write for 1 unit', aOffer.ok, `the control offered is ${JSON.stringify(aOffer.label)}; the form said ${JSON.stringify(aOffer.notice)}`);

if (aOffer.ok) {
  const clicked = await clickWrite();
  const settled = await until(`(() => { const t = ${TX_PANEL}; return t && !/Waiting for the wallet/.test(t) ? t : false; })()`, 15000);
  const outcome = await readOutcome();
  const log = await evaluate(READ_LOG);
  const hashes = (await evaluate(PAGE_HASHES)).hashes;

  check('A: the wallet was actually asked to send, and refused',
    log.methods.includes('eth_sendTransaction'),
    `${JSON.stringify(clicked.clicked)} -> ${JSON.stringify(log.methods.join(', '))}`);

  // THE ASSERTION THIS TOOL EXISTS FOR.
  check('A: A REJECTED PROMPT IS REPORTED AS A REJECTION, not as a sent transaction',
    /You cancelled this/.test(outcome.txPanel ?? '') && !/Approval sent|Waiting for the chain/.test(outcome.txPanel ?? ''),
    `the write panel reads ${JSON.stringify(outcome.txPanel)}`);
  check('A: the page does not claim a transaction exists',
    hashes.length === 0 && !/transaction 0x/.test(outcome.text),
    hashes.length === 0 ? 'no transaction hash anywhere in the deposit panel' : `hashes on screen: ${hashes.join(', ')}`);
  check('A: the form is not left waiting for a chain that was never asked',
    !/Waiting for the wallet/.test(outcome.button?.label ?? '') && !/Waiting for the chain/.test(outcome.text),
    `the control reads ${JSON.stringify(outcome.button?.label ?? null)}`);
  check('A: the rejection is stated in neutral words, not as a failure',
    /Nothing was signed and nothing was sent/.test(outcome.text) && !/The transaction failed/.test(outcome.text),
    `settled after ${settled.waitedMs}ms`);
}

// ---- 3. SCENARIO B: the wallet is on another chain before anything is typed --------------------
//
// The second measured defect: the page offered `1. Approve USDC` while the wallet was on Base
// mainnet, and the click put an `approve` in front of the wallet on a chain where this deployment
// does not exist. The guard's INPUT was the app's own chain (`useChainId()`), so it could not see it.

console.log(`\n--- B. the wallet is on chain ${WRONG_CHAIN} before anything is typed ---`);
const b = await loadWith(WRONG_CHAIN);
check('B: the page reads the chain the WALLET is on, not the chain the app is configured for',
  String(b.probe.walletChainRendered) === String(WRONG_CHAIN),
  `the wallet panel says chain ${b.probe.walletChainRendered}; the stub reports ${WRONG_CHAIN}, the deployment is ${APP_CHAIN}`);

const bOffer = await offerWrite('1');
const bText = (await evaluate(PAGE_TEXT)).text;

check('B: the page says which chain it is on and which chain it needs',
  new RegExp(`chain ${APP_CHAIN}`).test(bText) && new RegExp(`chain ${WRONG_CHAIN}`).test(bText),
  `the deposit panel says ${JSON.stringify((bText.split('\n').find((l) => /Switch the wallet/.test(l)) ?? '').slice(0, 200))}`);
check('B: the page offers NO write control while the wallet is on another chain',
  !bOffer.ok,
  bOffer.ok ? `a write control was offered: ${JSON.stringify(bOffer.label)}` : 'the panel renders the refusal and no control');

const bClicked = await clickWrite();
const bLog = await evaluate(READ_LOG);
check('B: NO WRITE WAS ATTEMPTED on the foreign chain',
  bLog.sends.length === 0,
  bLog.sends.length === 0
    ? `the wallet was asked for ${JSON.stringify(bLog.methods.join(', '))} and nothing else`
    : `the wallet was asked to send: ${JSON.stringify(bLog.sends)} (click returned ${JSON.stringify(bClicked.clicked)})`);

// ---- 4. SCENARIO C: the wallet switches chain, settled and unsettled ---------------------------
//
// The reader's own flow: the page is open on the right chain with the write offered, and they switch
// the wallet to another network. Two cases, and the difference between them is why the write path
// asks the wallet for its chain immediately before the send:
//
//   C1  the switch SETTLES -- React re-renders, the write control is withdrawn, the refusal is shown.
//   C2  the click lands in the SAME TASK as the switch, before that re-render -- a guard that reads
//       the rendered tree cannot see this one, and the reader's click reaches the wallet.

/** The wallet panel's own reading of the chain, and whether it claims to match the deployment. */
const WALLET_PANEL = `(() => {
  const text = document.body.innerText;
  const chain = /Wallet chain\\n(\\d+)/.exec(text);
  return JSON.stringify({ chainId: chain ? chain[1] : null, matchesCopy: /matches the deployment/.test(text) });
})()`;

const switchStubTo = (chainId) =>
  evaluate(`(() => { window.__vaultStubSetChain(${JSON.stringify(hexChain(chainId))}); return JSON.stringify({ chainId: window.__vaultStubState.chainId }); })()`);

console.log(`\n--- C1. the wallet switches to chain ${WRONG_CHAIN} while the form is offering the write ---`);
await loadWith(APP_CHAIN);
const cOffer = await offerWrite('1');
check('C1: the form offers the write before the switch', cOffer.ok, `the control offered is ${JSON.stringify(cOffer.label)}`);

const switched = await switchStubTo(WRONG_CHAIN);
const settledSwitch = await until(`(() => { const t = ${DEPOSIT_TEXT}; return /Switch the wallet to chain/.test(t) ? t : false; })()`, 10000);
const cText = (await evaluate(PAGE_TEXT)).text;
const cPanel = await evaluate(WALLET_PANEL);
const cOfferAfter = await evaluate(`(() => { const b = ${WRITE_BUTTON}; return JSON.stringify({ label: b ? b.textContent.trim() : null }); })()`);
const cLog = await evaluate(READ_LOG);

check('C1: the wallet panel follows the switch instead of claiming the deployment\'s chain',
  String(cPanel.chainId) === String(WRONG_CHAIN) && cPanel.matchesCopy === false,
  `the stub emits chainChanged with ${switched.chainId}; the wallet panel reads ${cPanel.chainId}` +
    (cPanel.matchesCopy ? ' and still says "matches the deployment"' : ''));
check('C1: after the switch settles, the page refuses and names both chains',
  /Switch the wallet to chain/.test(cText) &&
    new RegExp(`chain ${APP_CHAIN}`).test(cText) &&
    new RegExp(`chain ${WRONG_CHAIN}`).test(cText),
  settledSwitch.ok
    ? `the refusal is rendered: ${JSON.stringify((cText.split('\n').find((l) => /Switch the wallet/.test(l)) ?? '').slice(0, 240))}`
    : `the page did not render a refusal within ${settledSwitch.waitedMs}ms`);
check('C1: the write control is gone once the switch has settled',
  cOfferAfter.label === null,
  cOfferAfter.label === null ? 'no control offered' : `still offering ${JSON.stringify(cOfferAfter.label)}`);
check('C1: no send was attempted after the settled switch',
  cLog.sends.length === 0,
  cLog.sends.length === 0 ? 'nothing was sent' : JSON.stringify(cLog.sends));

console.log('\n--- C2. the chain switches and the click lands BEFORE the re-render ---');
await loadWith(APP_CHAIN);
const c2Offer = await offerWrite('1');
check('C2: the form offers the write before the switch', c2Offer.ok, `the control offered is ${JSON.stringify(c2Offer.label)}`);
if (c2Offer.ok) {
  // THE RACE, DETERMINISTICALLY: the switch and the click are in the SAME task, so React has not
  // committed the re-render that would have withdrawn the button. A guard that reads the tree
  // cannot see this; a guard that asks the wallet can.
  const raced = await evaluate(`(() => {
    const button = ${WRITE_BUTTON};
    const label = button ? button.textContent.trim() : null;
    window.__vaultStubSetChain(${JSON.stringify(hexChain(WRONG_CHAIN))});
    if (button) button.click();
    return JSON.stringify({ label, clickedInSameTask: button !== null });
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  const c2Log = await evaluate(READ_LOG);
  const c2Text = (await evaluate(PAGE_TEXT)).text;
  check('C2: a click delivered in the same task as the chain switch does not reach the wallet',
    c2Log.sends.length === 0,
    c2Log.sends.length === 0
      ? `the wallet was asked for ${JSON.stringify(c2Log.methods.join(', '))} and never to send`
      : `the wallet was asked to send: ${JSON.stringify(c2Log.sends)} (the control clicked was ${JSON.stringify(raced.label)})`);
  check('C2: and the page says why, naming both chains',
    new RegExp(`chain ${APP_CHAIN}`).test(c2Text) && new RegExp(`chain ${WRONG_CHAIN}`).test(c2Text),
    `after the race the panel says ${JSON.stringify((c2Text.split('\n').find((l) => /Switch the wallet|has not been read/.test(l)) ?? '').slice(0, 240))}`);
}

// ---- 5. the summary ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(72)}`);
console.log(`${results.length - failed.length} passed / ${failed.length} failed, of ${results.length} assertions`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
}
console.log(`deployment under test: chain ${APP_CHAIN} (${config.chainName}), vault ${VAULT}, from ${PAGE}`);
console.log(`wallet double: account ${ACCOUNT}, chain switched to ${WRONG_CHAIN} for the wrong-chain scenarios`);
// The user's browser is not a scratch pad: the session's tabs are closed unless the run was asked to
// leave them (`--keep`, for looking at the page afterwards).
if (!args.includes('--keep')) await wb('close_session').catch(() => undefined);
process.exit(failed.length === 0 ? 0 : 1);
