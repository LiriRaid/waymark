#!/usr/bin/env node
// Waymark · testigos (docs/adr/0012). A testigo answers "is it true that…?" by executing, never by reading the
// agent's prose: it states its claim (waymark/routine.json, `claim`), runs a command and returns ✔ / ✘ / not applicable
// with its evidence. stop-hook.mjs judges every testigo at the end of a turn; the ones that need a process or git live
// here, so they can also be run again by hand:
//   node testigos.mjs [<task ID>]     (or: node waymark.mjs testigos [<task ID>]) from the project folder
// It prints the chain, the task's commits and their trailer, secrets in those commits, and the repo typecheck run now.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectHome, readRecords, readTaskRecords, readNotes, gitNote, verifyChain, commitsFor, findSecrets } from './provenance.mjs';
import { stackOf, translate } from './stack.mjs';

const GATE_MS = 40000; // under the agents' default hook timeout
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const top = (dir) => { const r = git(dir, 'rev-parse', '--show-toplevel'); return r.status === 0 ? path.resolve(r.stdout.trim()) : null; };
const same = (a, b) => String(a || '').replace(/\\/g, '/').toLowerCase() === String(b || '').replace(/\\/g, '/').toLowerCase();

// The rows of memory.md's "Quality gates" table → [gate, command] (backticks dropped). Only lines that start with "|":
// a comment that shows the format is not a row.
const gateRows = (memoryFile) => (read(memoryFile).match(/\n## Quality gates[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] || '').split('\n')
  .filter((row) => row.trim().startsWith('|')).map((row) => row.split('|').slice(1, 3).map((c) => String(c || '').replace(/`/g, '').trim()));

// A project with no build declares it in memory.md's "Quality gates": `| build | none (<why>) | <date> |`. → the why,
// or null (no row, a real command, or "none" without a why). The Build testigo does not apply there.
export function buildNone(memoryFile) {
  for (const [gate, cmd] of gateRows(memoryFile)) {
    const why = /^build$/i.test(gate || '') && String(cmd || '').match(/^none\s*\(([^<>]{3,})\)\s*$/i)?.[1].trim(); // a <placeholder> is not a why
    if (why) return why;
  }
  return null;
}

// The repo's typecheck, in this order: the verified typecheck/syntax row of memory.md's
// "Quality gates" table (project root only) → package.json's typecheck script → `tsc --noEmit` when TypeScript is
// installed, each run with the repo's own package manager (stack.mjs: a memory row written for npm runs with pnpm in a
// pnpm repo). → { cmd, from } or null. Never the full build.
export function gateCommand(root, memoryFile) {
  const stack = stackOf(root);
  for (const [gate, cmd] of gateRows(memoryFile)) {
    if (gate && cmd && /^(typecheck|type-check|types?|tsc|syntax)\b/i.test(gate) && !/[<>]/.test(cmd)) return { cmd: translate(cmd, stack), from: 'memory.md' };
  }
  let pkg = null;
  try { pkg = JSON.parse(read(path.join(root, 'package.json'))); } catch {}
  const script = ['typecheck', 'type-check', 'tsc'].find((s) => pkg?.scripts?.[s]);
  if (script) {
    return { cmd: `${stack?.run || 'npm run'} ${script}`, from: 'package.json' };
  }
  const tsc = ['tsc', 'tsc.cmd'].some((f) => fs.existsSync(path.join(root, 'node_modules', '.bin', f)));
  const project = ['tsconfig.app.json', 'tsconfig.json'].find((f) => fs.existsSync(path.join(root, f))); // a solution tsconfig.json checks nothing
  const exec = !stack?.pm || stack.pm === 'npm' ? 'npx --no-install' : stack.exec;
  return tsc && project ? { cmd: `${exec} tsc --noEmit -p ${project}`, from: 'tsconfig' } : null;
}

// Runs the gate with a time limit and kills its whole process tree when the limit is hit (spawnSync's own timeout kills
// only the shell: on Windows the typecheck under it kept running and holding the folder). Exit 124 = timed out.
// → { cmd, from, ok, s, timedOut }
const RUNNER = `const { spawn, spawnSync } = require('node:child_process');
const [cmd, ms] = process.argv.slice(1), win = process.platform === 'win32';
const c = spawn(cmd, { shell: true, stdio: 'ignore', windowsHide: true, detached: !win });
const t = setTimeout(() => { try { if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true }); else process.kill(-c.pid, 'SIGKILL'); } catch {} process.exit(124); }, Number(ms));
c.on('error', () => process.exit(127));
c.on('exit', (code) => { clearTimeout(t); process.exit(code ?? 1); });`;
export function runGate(gate, cwd, ms = GATE_MS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['-e', RUNNER, gate.cmd, String(ms)], { cwd, encoding: 'utf8', timeout: ms + 5000, windowsHide: true });
  const timedOut = r.status === 124 || r.error?.code === 'ETIMEDOUT';
  return { cmd: gate.cmd, from: gate.from, ok: !timedOut && r.status === 0, s: Math.round((Date.now() - t0) / 1000), timedOut };
}

// The gate testigo's fallback when the agent ran no gate after its last code change: the typecheck of the repo that holds
// the changed code (the project first). → the run, or null when that repo has no typecheck the hook can run.
export function rerunGate(codeFiles, home) {
  const roots = [...new Set(codeFiles.map((f) => top(path.dirname(f))).filter(Boolean))];
  roots.sort((a, b) => (same(b, home.root) ? 1 : 0) - (same(a, home.root) ? 1 : 0));
  for (const root of roots) {
    const gate = gateCommand(root, same(root, home.root) ? home.memory : null);
    if (gate) return runGate(gate, root);
  }
  return null;
}

// What the testigo "sin secretos" reads besides what Waymark writes: the project memory
// when the turn wrote it, the lines the task added to its files (untracked files whole) and the task's commits.
// → [{ where, text }]
export function secretSources(files, commits, cwd, memoryFile, since = 0) {
  const out = [];
  try { if (memoryFile && fs.statSync(memoryFile).mtimeMs >= since - 1000) out.push({ where: 'memory.md', text: read(memoryFile) }); } catch {}
  const byRoot = new Map();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const root = top(path.dirname(f));
    if (!root) { if (fs.statSync(f).size < 1024 * 1024) out.push({ where: path.basename(f), text: read(f) }); continue; }
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(path.relative(root, f).replace(/\\/g, '/'));
  }
  for (const [root, rel] of byRoot) {
    const untracked = new Set(git(root, 'ls-files', '--others', '--exclude-standard', '--', ...rel).stdout?.split('\n').filter(Boolean));
    for (const f of untracked) if (fs.statSync(path.join(root, f)).size < 1024 * 1024) out.push({ where: f, text: read(path.join(root, f)) });
    out.push(...addedLines(git(root, 'diff', 'HEAD', '--unified=0', '--no-color', '--', ...rel.filter((f) => !untracked.has(f))).stdout || ''));
  }
  for (const h of commits || []) out.push(...addedLines(git(cwd, 'show', '--format=', '--unified=0', '--no-color', h).stdout || '', `commit ${h.slice(0, 8)} `));
  return out;
}
// A unified diff → [{ where: <file>, text: <its added lines> }]
function addedLines(diff, prefix = '') {
  const out = [];
  let cur = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { cur = { where: prefix + line.slice(4).replace(/^b\//, ''), text: '' }; out.push(cur); }
    else if (cur && line.startsWith('+')) cur.text += line.slice(1) + '\n';
  }
  return out.filter((s) => s.text);
}

// → [{ where, kind }] (never the value)
export const secretHits = (sources) => sources.flatMap((s) => findSecrets(s.text).map((h) => ({ where: s.where, kind: h.kind, ...(s.where === 'memory.md' ? { line: h.line } : {}) })));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cwd = process.cwd(), home = projectHome(cwd), records = readRecords(home.log);
  const id = process.argv[2] || records.filter((r) => r.id).pop()?.id;
  const mark = (ok) => (ok === null ? '—' : ok ? '✔' : '✘');
  const chain = verifyChain(records, records.some(gitNote) ? readNotes(cwd) : null); // with the notes, as the hook checks it
  console.log(`${mark(chain.ok)} chain: ${records.length} records${chain.ok ? ' intact' : `, broken at record ${chain.at + 1}${chain.note ? ' (its git note is missing or was edited)' : ''}`} (${home.log})`);
  if (!id) { console.log('— no task recorded yet'); process.exit(chain.ok ? 0 : 1); }
  const commits = commitsFor(cwd, id);
  console.log(`${commits.length ? '✔' : '—'} commit + trailer: ${commits.length ? commits.map((h) => h.slice(0, 8)).join(', ') : `no commit with Waymark-Task: ${id} in the last 30`}`);
  const hits = secretHits(secretSources([], commits, cwd, null));
  console.log(`${mark(!hits.length)} secrets in the task's commits: ${hits.length ? hits.map((h) => `${h.kind} in ${h.where}`).join('; ') : 'none'}`);
  const gate = gateCommand(top(cwd) || cwd, home.memory);
  const run = gate ? runGate(gate, top(cwd) || cwd) : null;
  console.log(run ? `${mark(run.ok)} typecheck now (${run.from}): ${run.cmd} · ${run.timedOut ? `over ${GATE_MS / 1000} s` : `${run.s} s`}` : '— typecheck: none found (memory.md Quality gates, package.json, tsconfig)');
  const rec = readTaskRecords(home).find((r) => r.id === id);
  if (rec?.evaluation) console.log(`recorded for ${id}: ${Object.entries(rec.evaluation.steps || {}).map(([k, v]) => `${k} ${v ? '✔' : '✘'}`).join(' · ')} (${rec.evaluation.score})`);
  process.exit(chain.ok && !hits.length && (!run || run.ok) ? 0 : 1);
}
