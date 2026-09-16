/**
 * Run every test file, one child process at a time.
 *
 * WHY NOT `node --test test/*.test.ts`
 *
 * `node --test` spawns a child process PER FILE and captures its output over a named pipe.
 * On this machine, under the restricted sandbox, creating that pipe is refused and the
 * whole run dies before a single assertion executes:
 *
 *     Error: spawn EPERM
 *       errno: -4048, code: 'EPERM', syscall: 'spawn'
 *
 * That is an ENVIRONMENT limit, not a defect in `node --test` -- the same glob runs fine
 * outside the sandbox. It also survives passing a single file to `--test`, because the
 * spawn is how the runner works, not a consequence of the glob.
 *
 * THE FIX IS TO CHANGE HOW THE CHILD IS INVOKED, NOT TO STOP TESTING. Running the test file
 * directly executes its tests IN THE PROCESS -- no runner child, no pipe. `node:test` still
 * provides `describe`/`it` and still aggregates, and the file's exit code is still non-zero
 * when an assertion fails, which is all the gate needs. `stdio: 'inherit'` keeps the output
 * visible.
 *
 * Verified both ways: this runner passes here, and the same suites pass under
 * `node --test` outside the sandbox.
 *
 * Exit code is the number of files that failed, so this is usable directly as a gate.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const testDir = join(project, 'test');

/**
 * Files that need a live service, excluded from the default suite.
 *
 * `npm test` must pass on a machine with nothing else running. These files reach a real
 * service over HTTP, so including them would make the suite's result depend on three other
 * processes -- and a suite that is "usually green depending on what is up" stops being a gate.
 * They are run explicitly instead, and the exclusion is named here so that a reader does not
 * conclude the file was simply forgotten.
 *
 *   node --experimental-strip-types test/contract-live.test.ts
 *   node tools/browser-assert.mjs
 */
const NEEDS_LIVE_SERVICE = new Set(['contract-live.test.ts', 'api-against-real-service.test.ts']);

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts') || name.endsWith('.test.mjs'))
  .filter((name) => !NEEDS_LIVE_SERVICE.has(name))
  .sort();

const skipped = readdirSync(testDir).filter((name) => NEEDS_LIVE_SERVICE.has(name));
if (skipped.length > 0) {
  console.log(`Not run here (need live services, run explicitly): ${skipped.join(', ')}`);
}

if (files.length === 0) {
  console.error('No test files found in test/. That is a failure, not a pass.');
  process.exit(1);
}

const failed = [];

for (const file of files) {
  console.log(`\n${'='.repeat(72)}\n${file}\n${'='.repeat(72)}`);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(testDir, file)],
    {
      stdio: 'inherit',
      cwd: project,
      // Both spellings: `cast` and `forge` read one, Node reads the other, and a localhost
      // call sent through the SOCKS proxy disappears silently.
      env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    },
  );
  if (result.status !== 0) failed.push(file);
}

console.log(`\n${'='.repeat(72)}`);
console.log(`${files.length - failed.length}/${files.length} test files passed`);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(', ')}`);
  process.exit(failed.length);
}
console.log('all green');
