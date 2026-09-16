/**
 * Refresh the screenshots in `docs/evidence/` from the running console instances.
 *
 * WHY THIS IS A SCRIPT AND NOT THREE MANUAL SCREENSHOTS
 *
 * A screenshot in a repository is evidence for a claim, and evidence has to be reproducible by
 * whoever reads it. Three hand-taken images are three images nobody can re-take: the browser was in
 * a particular state, the window was a particular size, and nothing records which URL was open.
 * This script names the URL for each image, navigates to it, waits for the page's own content to be
 * there, and writes the file -- so the images can be regenerated after any change and compared.
 *
 * It is not part of any gate. It produces documentation, not a verdict.
 *
 * Usage:
 *
 *   node tools/capture-screenshots.mjs             # the three ports capture-scenarios.mjs uses
 *   node tools/capture-screenshots.mjs --port-up 3131 --port-index-down 3132
 *   node tools/capture-screenshots.mjs --only scenario-12-history-up
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const project = resolve(import.meta.dirname, '..');
const evidenceDir = join(project, 'docs', 'evidence');
const DAEMON = 'http://127.0.0.1:10086/command';
/** One session, so the images all come from the same tab and cannot drift apart mid-run. */
const SESSION = 'vault-console-screenshots';
const UP = flag('--port-up', '3121');
const INDEX_DOWN = flag('--port-index-down', '3122');

/**
 * Each shot names its URL, the thing to wait for, and the file it becomes.
 *
 * `waitFor` is a CSS selector rather than a sleep. A screenshot taken after a fixed delay is a race
 * that looks like a bug the day the machine is slower: the image would show a half-rendered page and
 * whoever reads it has no way to know that is what they are looking at.
 */
const SHOTS = [
  {
    name: 'console-live',
    url: `http://127.0.0.1:${UP}/vault`,
    waitFor: 'svg[role="img"]',
    why: 'the console: four panels, the chart, and the nav that links the other routes',
  },
  {
    name: 'scenario-12-history-up',
    url: `http://127.0.0.1:${UP}/history`,
    waitFor: 'table',
    why: 'the history page: three tables, each stating how much it is showing',
  },
  {
    name: 'scenario-13-history-index-down',
    url: `http://127.0.0.1:${INDEX_DOWN}/history`,
    waitFor: 'main',
    why: 'the history page with the index unreachable: it renders no figures at all',
  },
];

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

mkdirSync(evidenceDir, { recursive: true });

/**
 * Start from a clean session, and retry once past a stale-tab error.
 *
 * WHY: the first run of this script after the assertion tool had been running failed with
 * `No tab with given id 606774173` on `navigate` -- the session's remembered tab ids pointed at tabs
 * that no longer existed, because another tool had closed them. The daemon treats a session as
 * long-lived, so a tab it once opened and no longer has is a state a caller has to clear rather than
 * an error to report. `close_session` on our own session does exactly that, and doing it up front
 * means the failure cannot happen at all rather than being retried away.
 */
await wb('close_session', {}).catch(() => undefined);

const only = flag('--only', null);
const failures = [];

for (const shot of SHOTS) {
  if (only !== null && shot.name !== only) continue;
  const path = join(evidenceDir, `${shot.name}.png`);
  console.log(`\n${shot.name}\n  url:  ${shot.url}\n  why:  ${shot.why}`);

  try {
    await wb('navigate', { url: shot.url, newTab: true, group_title: 'Vault console evidence' });
    const waited = await wb('wait', { selector: shot.waitFor, timeout_ms: 20000 });
    if (waited.ok === false) {
      console.log(`  !! the page never showed ${shot.waitFor}; the image would document a page that had not rendered`);
      failures.push(`${shot.name}: ${shot.waitFor} never appeared`);
      continue;
    }
    const result = await wb('screenshot', { format: 'png', path });
    console.log(`  -> ${result.path ?? path}  (${result.sizeBytes ?? '?'} bytes)`);
    if (!existsSync(path)) {
      console.log('  !! the daemon reported success but no file is there');
      failures.push(`${shot.name}: no file written`);
    }
  } catch (cause) {
    console.log(`  !! ${cause instanceof Error ? cause.message : cause}`);
    failures.push(`${shot.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

console.log(`\n${'='.repeat(70)}`);
if (failures.length === 0) {
  console.log(`${SHOTS.length} screenshot(s) refreshed in docs/evidence/`);
} else {
  console.log(`${failures.length} screenshot(s) failed:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
