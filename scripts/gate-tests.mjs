#!/usr/bin/env node
// Waymark 2.0.18 · point 1: the gate of the suite. It runs every tests/*.test.mjs three ways and fails unless each run reads
// "skipped 0, todo 0, fail 0": a test that is skipped, marked todo or cancelled is not a pass, so it cannot hide in a green run.
//   1. the default run, at most CONCURRENCY files at once
//   2. --test-concurrency=1      (no test depends on running beside another)
//   3. from a copy of the working tree under the OS temp folder (no test depends on where the repository lives)
//   node scripts/gate-tests.mjs [--once]      --once runs only the first, for the loop of a change
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The files run at once: every test spawns hooks, git and node, and node's own default (one per core) saturated a busy machine and made the
// suite fail differently on each run, by timeouts. Four is what a runner with four cores carries, and a bigger machine has no reason to exceed it.
export const CONCURRENCY = 4;

// The counters of node's test runner summary ("ℹ tests 419", "ℹ skipped 1", …) → { tests, pass, fail, cancelled, skipped, todo }, or null.
export function summarize(output) {
  const n = (name) => { const m = String(output).match(new RegExp(`^ℹ ${name} (\\d+)\\s*$`, 'm')); return m ? Number(m[1]) : null; };
  const s = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((k) => [k, n(k)]));
  return Object.values(s).some((v) => v === null) ? null : s;
}

// Why a summary is not clean, in words; '' when it is.
export function problems(s) {
  if (!s) return 'the runner printed no summary (it crashed, or the output was cut)';
  return [s.tests === 0 && 'no test ran', s.fail && `${s.fail} failed`, s.cancelled && `${s.cancelled} cancelled`, s.skipped && `${s.skipped} skipped`, s.todo && `${s.todo} todo`].filter(Boolean).join(', ');
}

// The runner's "failing tests:" section without the stack frames: each failed test with its file and the assertion that
// failed, so a run on a machine nobody can open (CI) says why. '' when nothing failed.
export function failures(output) {
  const lines = String(output).split('\n'), at = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  if (at < 0) return '';
  return lines.slice(at).filter((l) => !/^\s+at /.test(l) && l.trim()).slice(0, 200).join('\n');
}

// The folders Waymark's tests name in the OS temp folder (wm-*, waymark-*): a run that leaves more than it found left its own behind. Every test
// process makes one root (tests/helpers/isolate.mjs) and removes it when it ends, so the count after a run is the count before it.
export const tempFolders = (dir = os.tmpdir()) => { try { return fs.readdirSync(dir).filter((n) => /^(?:wm-|waymark-)/.test(n)).length; } catch { return 0; } };

const testFiles = (root) => fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join('tests', f));

function run(root, extra = []) {
  const r = spawnSync(process.execPath, ['--test', ...extra, ...testFiles(root)], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const summary = summarize(`${r.stdout}\n${r.stderr}`);
  return { summary, why: problems(summary) || (r.status === 0 ? '' : `exit ${r.status}`), output: `${r.stdout}\n${r.stderr}` };
}

// A copy of what the repository holds now (tracked and untracked files, not ignored ones), as its own git repository.
function copyOfTree(root) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gate-'));
  const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\0').filter(Boolean);
  for (const f of files) {
    if (!fs.existsSync(path.join(root, f))) continue; // deleted in the working tree
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(dest, f));
  }
  const git = (...a) => spawnSync('git', ['-c', 'user.name=gate', '-c', 'user.email=gate@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: dest, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'copy of the working tree');
  return dest;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const once = process.argv.includes('--once');
  const runs = [[`default (concurrency ${CONCURRENCY})`, () => run(ROOT, [`--test-concurrency=${CONCURRENCY}`])], ...(once ? [] : [['--test-concurrency=1', () => run(ROOT, ['--test-concurrency=1'])], ['a copy under the temp folder', () => { const d = copyOfTree(ROOT); try { return run(d, [`--test-concurrency=${CONCURRENCY}`]); } finally { fs.rmSync(d, { recursive: true, force: true }); } }]])];
  let bad = 0;
  for (const [name, go] of runs) {
    const before = tempFolders();
    const r = go();
    let left = tempFolders() - before;
    if (left > 0) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000); left = tempFolders() - before; } // another process's folder (a suite of another session) is gone a moment later; ours stay
    if (left > 0) r.why = [r.why, `the run left ${left} temp folder${left > 1 ? 's' : ''} behind (wm-* or waymark-*)`].filter(Boolean).join('; ');
    const s = r.summary;
    console.log(`${r.why ? '✘' : '✔'} ${name}: ${s ? `tests ${s.tests}, pass ${s.pass}, skipped ${s.skipped}, todo ${s.todo}, fail ${s.fail}` : 'no summary'}${r.why ? ` — ${r.why}` : ''}`);
    if (r.why) { bad++; console.log(failures(r.output) || r.output.split('\n').filter((l) => /^✖|^not ok/.test(l)).slice(0, 20).join('\n')); }
  }
  console.log(bad ? `gate-tests: FAILED (${bad} of ${runs.length} runs not clean)` : `gate-tests: clean (skipped 0, todo 0, fail 0 in ${runs.length} run${runs.length > 1 ? 's' : ''})`);
  process.exitCode = bad ? 1 : 0;
}
