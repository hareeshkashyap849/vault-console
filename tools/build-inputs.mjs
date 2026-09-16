/**
 * Hash the BUILD INPUTS, because the build outputs are not reproducible by nature.
 *
 * THE TRAP THIS AVOIDS
 *
 * "Build reproducibility" is usually checked by building twice and comparing the artefact
 * hash. For a Next.js app that check can never pass: `.next/` contains timestamps and
 * content-hashed chunk names, so two builds of identical source produce different bytes.
 * Comparing artefact hashes would either fail forever or get silently dropped from the
 * checklist, and dropping it is how "we verify reproducibility" becomes a claim nobody tests.
 *
 * So this hashes what the build actually consumes:
 *
 *   package-lock.json      the dependency graph, at exact versions
 *   src/**                 every file, path-sorted, each hashed then folded in
 *   test/** + tools/**     the checks themselves, so a change there is visible too
 *   config files           next.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.mjs
 *   node and npm versions  a different toolchain is a different build
 *
 * Two runs with the same output mean the same source, the same lockfile and the same
 * toolchain -- which is the claim worth making. Documenting it required running this twice,
 * and doing that is a separate step from having the tool: see `支持矩阵与验收.md` §2, where
 * the state is recorded honestly as `未验证` until the second run has happened.
 *
 * Usage:
 *
 *   node tools/build-inputs.mjs             # print the hashes
 *   node tools/build-inputs.mjs --json      # machine-readable, for pasting into evidence
 *
 * A NOTE FOR WHOEVER EDITS THIS FILE: it is `.mjs`, so it is plain JavaScript. Node's type
 * stripping applies to `.ts`/`.mts`, NOT to `.mjs`, and `foo(x)` `as` `T` is a syntax error
 * there. That mistake was made four times while building this repository -- in
 * `tools/capture-fixtures.mjs`, `tools/run-tests.mjs`, and twice here -- because the rest of
 * the repository is TypeScript and the annotation is muscle memory. The runner also had it in
 * a different form: `const failed: string[] = []`. Everything under `tools/` except the
 * `--experimental-strip-types` test files is `.mjs` and must stay plain JS.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const project = resolve(import.meta.dirname, '..');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every file under `dir`, path-sorted, so the fold order does not depend on the filesystem. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** A tree hash: fold each file's path and content hash, in sorted order. */
function treeHash(files) {
  const h = createHash('sha256');
  for (const file of files) {
    h.update(relative(project, file).replace(/\\/g, '/'));
    h.update('\0');
    h.update(sha256(readFileSync(file)));
    h.update('\n');
  }
  return { hash: h.digest('hex'), count: files.length };
}

const configFiles = ['next.config.ts', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs']
  .map((f) => join(project, f))
  .filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });

const lockPath = join(project, 'package-lock.json');
const srcFiles = walk(join(project, 'src'));
const checkFiles = [...walk(join(project, 'test')), ...walk(join(project, 'tools'))];

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  npm: (() => {
    try {
      // The npm shim cannot be spawned under the restricted sandbox (it needs cmd.exe), so the
      // version is read from the JS entry point's own package.json rather than by running npm.
      const cli = process.env.npmCli ?? 'E:/nodejs/node_modules/npm/package.json';
      return JSON.parse(readFileSync(cli, 'utf8')).version;
    } catch {
      return 'unknown';
    }
  })(),
  packageLock: (() => {
    try {
      return sha256(readFileSync(lockPath));
    } catch {
      return 'MISSING -- a build without a lockfile is not a reproducible build';
    }
  })(),
  src: treeHash(srcFiles),
  checks: treeHash(checkFiles),
  config: treeHash(configFiles),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`generated   ${result.generatedAt}`);
  console.log(`node        ${result.node}`);
  console.log(`npm         ${result.npm}`);
  console.log(`lockfile    ${result.packageLock}`);
  console.log(`src         ${result.src.hash}   (${result.src.count} files)`);
  console.log(`checks      ${result.checks.hash}   (${result.checks.count} files: test/ + tools/)`);
  console.log(`config      ${result.config.hash}   (${result.config.count} files)`);
  console.log('\nRun twice and compare: identical output means identical inputs.');
}

void execFileSync;
