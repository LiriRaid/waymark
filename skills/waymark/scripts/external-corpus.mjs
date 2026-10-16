#!/usr/bin/env node
// Waymark · the external corpus (docs/adr/0027): public repositories unlike the author's own, read-only clones, measured without
// opinion. Per repository: is the stack detected, which profile applies (or `generic`), are the gate commands of its ecosystem
// recognised as gates by the hooks, what do the card and the reminder cost there, do the hooks run clean, and does a small
// scripted task (a doc edit; a code edit with a passing test run) get blocked for nothing.
//   node external-corpus.mjs <clones-dir> [--out <file>]     <clones-dir>/<id> is a clone of each repository of tests/external/corpus.json
// What it does not measure: the memory bootstrap and the routing, which are the agent's work (an A/B in its own session).
// The output is structured and versioned (schema waymark.external-corpus/v1): it is also the dataset a later learning step can read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
export const SCHEMA = 'waymark.external-corpus/v1';
export const MANIFEST = path.join(ROOT, 'tests', 'external', 'corpus.json');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-external-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_AGENTS_HOME = home;
const imp = (f) => import(pathToFileURL(path.join(HERE, f)).href);

// A scripted task in the repository: the department loaded, its procedures read, the choice window answered, one edit, an
// optional gate run that passes, and a Cierre. The verdict the stop hook would give: what it would block or note.
function scripted(root, file, gateCmd, { P, T, cierreGaps }) {
  let n = 0;
  const run = (name, input, out = 'ok') => { const id = `c${++n}`; return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }]; };
  const q = '¿Cómo lo hago?';
  const lines = [
    { type: 'user', uuid: 'p1', timestamp: '2026-10-15T10:00:00Z', message: { role: 'user', content: 'corrige un detalle pequeño' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-backend · skills: ninguna' }] } },
    ...run('Skill', { skill: 'dept-backend', args: 'L1' }),
    ...run('Read', { file_path: path.join(ROOT, 'skills', 'dept-backend', 'procedures.md') }),
    ...run('AskUserQuestion', { questions: [] }),
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question: q, options: [{ label: 'A' }, { label: 'B' }] }], answers: { [q]: 'A' } } },
    ...run('Edit', { file_path: file, old_string: 'a', new_string: 'b' }),
    ...(gateCmd ? run('Bash', { command: gateCmd }, 'test result: ok. 12 passed; 0 failed') : []),
  ];
  const turn = T.currentTurn(lines);
  const cierre = `## Cierre · ${P.taskIds(root).next}\nResultado: hecho\nEvidencia: observada 12 passed en la salida del test\nAprendido: cambio pequeño ← pedido; siguiente: nada.`; // the ID the hook offers today, so the measure never ages
  const g = cierreGaps(turn, cierre, T.sessionTools(lines), [turn.prompt], { ids: P.taskIds(root), decisions: [{ question: q, chosen: 'A', discarded: ['B'] }], outside: true, cwd: root, root, packed: 1, rerun: () => ({ cmd: 'typecheck', ok: true, s: 0 }) });
  return g ? { blocked: g.missing || [], noted: g.findings || [] } : { blocked: [], noted: [] };
}

const firstFile = (root, re) => {
  const walk = (d, depth = 0) => {
    if (depth > 4) return null;
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (/^(\.git|node_modules|target|vendor|\.terraform)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const r = walk(p, depth + 1); if (r) return r; } else if (re.test(e.name)) return p;
    }
    return null;
  };
  return walk(root);
};

export async function measure(root, entry) {
  const S = await imp('stack.mjs'), R = await imp('runs.mjs'), P = await imp('provenance.mjs'), T = await imp('transcript.mjs'), { cierreGaps } = await imp('stop-hook.mjs'), Z = await imp('size.mjs');
  const started = Date.now();
  const stack = S.stackOf(root);
  const label = stack ? (stack.other || `node (${stack.pm})`) : null;
  const profile = S.profileOf(root);
  const gates = {};
  for (const [name, cmd] of Object.entries(entry.expect.gates || {})) {
    const k = R.shellRuns(cmd)[0] || {};
    gates[name] = { command: cmd, recognised: !!(k.gate || k.test || k.build), as: k.test ? 'test' : k.build ? 'build' : k.gate ? 'gate' : null };
  }
  const sizes = Object.fromEntries(Z.sizes(root).filter((r) => /context card|reminder \(real\)/.test(r.name)).map((r) => [r.name, r.chars]));
  const hookErrors = [];
  for (const [file, payload] of [['session-hook.mjs', { session_id: 's-ext', cwd: root }], ['rule0-hook.mjs', { session_id: 's-ext', cwd: root, prompt: 'corrige un detalle pequeño' }]]) {
    const r = spawnSync(process.execPath, [path.join(HERE, file)], { input: JSON.stringify(payload), encoding: 'utf8', cwd: root, env: { ...process.env, WAYMARK_HOME: home }, timeout: 20000 });
    if (r.status !== 0 || /Error|Cannot find/.test(r.stderr || '')) hookErrors.push(`${file}: exit ${r.status} ${String(r.stderr).split('\n')[0]}`.trim());
  }
  const doc = firstFile(root, /^readme\.(md|rst|txt)$/i), code = entry.sample ? path.join(root, entry.sample) : null;
  const docTask = doc ? scripted(root, doc, null, { P, T, cierreGaps }) : null;
  const codeTask = code && fs.existsSync(code) ? scripted(root, code, entry.expect.gates?.test || Object.values(entry.expect.gates || {})[0] || null, { P, T, cierreGaps }) : null;
  return {
    id: entry.id, commit: entry.commit,
    detected: { stack: label, expected: entry.expect.stack ?? null, ok: (label ?? null) === (entry.expect.stack ?? null) },
    profile: { slug: profile.slug, exists: profile.exists, expected: entry.expect.profile, ok: profile.slug === entry.expect.profile && profile.exists },
    gates, cost: sizes, hookErrors,
    tasks: { doc: docTask, code: codeTask },
    ms: Date.now() - started,
  };
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) { console.log('Usage: node external-corpus.mjs <clones-dir> [--out <file>]'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const results = [];
  for (const e of manifest.repos) {
    const root = path.join(dir, e.id);
    if (!fs.existsSync(root)) { results.push({ id: e.id, skipped: 'no clone' }); continue; }
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    results.push({ ...(await measure(root, e)), cloneAt: head, atManifestCommit: head === e.commit });
  }
  const out = { schema: SCHEMA, waymark: fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim(), results };
  const at = process.argv.indexOf('--out');
  if (at >= 0) { fs.writeFileSync(process.argv[at + 1], JSON.stringify(out, null, 1) + '\n'); console.log(`written to ${process.argv[at + 1]}`); }
  else console.log(JSON.stringify(out, null, 1));
  fs.rmSync(home, { recursive: true, force: true });
}
