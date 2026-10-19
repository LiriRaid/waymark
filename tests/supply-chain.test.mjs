// Waymark 2.0.8: the log anchored in git (a rewrite shows), forget (a removal the user asked for, in view) and the
// Evidencia testigo (an "observada" backed by a check after the last change). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME and temporary repos; nothing reads or writes the real ~/.waymark or engram.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-supply-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const notes = await import(`file://${SCRIPTS}/notes.mjs`);
const { cierreGaps, evaluate, summaryLine } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-supply-${name}-`)); temps.push(d); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
const repo = (name, { commit = true } = {}) => {
  const d = tmp(name);
  gitT(d, 'init', '-q');
  withMemory(d);
  if (commit) { fs.writeFileSync(path.join(d, 'a.txt'), 'x'); gitT(d, 'add', 'a.txt'); gitT(d, 'commit', '-q', '-m', 'init'); }
  return d;
};
const day = new Date().toLocaleDateString('sv');
const rec = (n, more = {}) => ({ id: `${day} · T${n}`, agent: 'claude', at: new Date().toISOString(), session: 's1', files: [], commits: [], prompt: `pedido ${n}`, cierre: `## Cierre · ${day} · T${n}\nResultado: hecho\nEvidencia: observada x\nAprendido: lección ${n}`, ...more });
const chainOf = (cwd) => { const h = P.projectHome(cwd), records = P.readRecords(h.log); return P.verifyChain(records, null, P.anchorsFor(cwd)); };
// What a hand rewrite does (the one done on 2026-10-13 · T8): drop lines and chain the rest again from prev = null.
const rechainWithout = (cwd, drop) => {
  const file = P.projectHome(cwd).log, sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.id !== drop);
  let prev = null;
  for (const r of keep) { delete r.hash; r.prev = prev; r.hash = sha(JSON.stringify(r)); prev = r.hash; }
  fs.writeFileSync(file, keep.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

test('anchor: each close leaves {n, hash} of the log as a note on HEAD under its own ref; the chain checks it', () => {
  const d = repo('anchor');
  P.appendRecord(d, rec(1));
  P.appendRecord(d, rec(2));
  const anchors = P.anchorsFor(d);
  assert.equal(anchors.length, 2, 'one anchor per appended line');
  const last = P.readRecords(P.projectHome(d).log).pop();
  assert.deepEqual([anchors[1].n, anchors[1].hash], [2, last.hash]);
  assert.equal(gitT(d, 'notes', `--ref=${notes.ANCHOR_REF}`, 'list').stdout.trim().split('\n').length, 1, 'both anchors on the same HEAD');
  assert.deepEqual(chainOf(d), { ok: true });
});

test('anchor: a log rewritten by hand and chained again breaks the chain (the anchor no longer matches)', () => {
  const d = repo('rewrite');
  for (const n of [1, 2, 3]) P.appendRecord(d, rec(n));
  rechainWithout(d, `${day} · T1`);
  assert.equal(P.verifyChain(P.readRecords(P.projectHome(d).log)).ok, true, 'the hash chain alone cannot tell');
  const c = chainOf(d);
  assert.equal(c.ok, false);
  assert.equal(c.anchor, true);
});

test('anchor: a log truncated below an anchor breaks the chain; a repo with no commit records without an anchor', () => {
  const d = repo('trunc');
  for (const n of [1, 2]) P.appendRecord(d, rec(n));
  const file = P.projectHome(d).log;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, 1).join('\n') + '\n');
  assert.equal(chainOf(d).ok, false);
  const bare = repo('nocommit', { commit: false });
  P.appendRecord(bare, rec(1));
  assert.deepEqual(P.anchorsFor(bare), []);
  assert.deepEqual(chainOf(bare), { ok: true });
});

test('anchor: anchors of another clone or machine (another log) are not this log\'s and are not checked', () => {
  const d = repo('other');
  P.appendRecord(d, rec(1));
  notes.addAnchor(d, { m: 'another-log', n: 9, hash: 'f'.repeat(64), at: Date.now() });
  assert.equal(notes.readAnchors(d).length, 2);
  assert.equal(P.anchorsFor(d).length, 1, 'only the anchors of this log');
  assert.deepEqual(chainOf(d), { ok: true });
});

test('forget: removes a task\'s records, chains the rest again and leaves a rewrite anchor with the reason; the chain holds', () => {
  const d = repo('forget');
  for (const n of [1, 2, 3]) P.appendRecord(d, rec(n));
  P.appendRecord(d, { kind: 'Q', agent: 'claude', at: new Date().toISOString(), session: 's1', prompt: 'q' });
  const before = P.readRecords(P.projectHome(d).log);
  const r = P.forget(d, `${day} · T2`, { reason: 'el usuario pidió borrar la sesión' });
  assert.deepEqual(r.removed, [`${day} · T2`]);
  const after = P.readRecords(P.projectHome(d).log);
  assert.equal(after.length, before.length - 1);
  assert.deepEqual(chainOf(d), { ok: true });
  const rw = P.anchorsFor(d).filter((a) => a.kind === 'rewrite');
  assert.equal(rw.length, 1);
  assert.equal(rw[0].reason, 'el usuario pidió borrar la sesión');
  assert.deepEqual(rw[0].removed, [`${day} · T2`]);
  assert.deepEqual([rw[0].from.n, rw[0].from.hash], [before.length, before[before.length - 1].hash]);
  assert.deepEqual([rw[0].n, rw[0].hash], [after.length, after[after.length - 1].hash]);
  P.appendRecord(d, rec(4));
  assert.deepEqual(chainOf(d), { ok: true }, 'records after the rewrite keep anchoring');
});

test('forget: by session removes every record of it; a reason is required; a committed task (its note in git) is refused', () => {
  const d = repo('forget-s');
  P.appendRecord(d, rec(1, { session: 'old' }));
  P.appendRecord(d, { kind: 'Q', agent: 'claude', at: new Date().toISOString(), session: 'old', prompt: 'q' });
  P.appendRecord(d, rec(2, { session: 'new' }));
  assert.ok(P.forget(d, null, { session: 'old' }).error, 'no reason: refused');
  const r = P.forget(d, null, { session: 'old', reason: 'sesión vieja' });
  assert.equal(r.removed.length, 2);
  assert.deepEqual(P.readRecords(P.projectHome(d).log).map((x) => x.session), ['new']);
  assert.deepEqual(chainOf(d), { ok: true });
  fs.writeFileSync(path.join(d, 'b.txt'), 'y'); gitT(d, 'add', 'b.txt'); gitT(d, 'commit', '-q', '-m', `b\n\nWaymark-Task: ${day} · T3`);
  P.appendRecord(d, rec(3, { session: 'new', commits: [gitT(d, 'rev-parse', 'HEAD').stdout.trim()] }));
  const refused = P.forget(d, `${day} · T3`, { reason: 'x' });
  assert.match(refused.error, /git note/);
  assert.deepEqual(chainOf(d), { ok: true });
});

test('anchor: the anchor ref travels with the notes (push, then a clone\'s setup fetches and joins every line)', () => {
  const base = tmp('travel'), remote = path.join(base, 'remote.git'), a = path.join(base, 'a'), b = path.join(base, 'b');
  gitT(base, 'init', '-q', '--bare', remote);
  gitT(base, 'clone', '-q', remote, a);
  withMemory(a);
  fs.writeFileSync(path.join(a, 'a.txt'), 'x'); gitT(a, 'add', 'a.txt'); gitT(a, 'commit', '-q', '-m', 'init');
  gitT(a, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  P.appendRecord(a, rec(1));
  P.appendRecord(a, rec(2));
  assert.equal(notes.pushNotes(a).ok, true);
  gitT(base, 'clone', '-q', '-b', 'main', remote, b);
  notes.addAnchor(b, { m: 'b-log', n: 1, hash: 'e'.repeat(64), at: Date.now() });
  assert.equal(notes.notesSetup(b).ok, true);
  assert.equal(notes.readAnchors(b).length, 3, 'the remote\'s two anchor lines joined to the local one on the same commit');
});

// ---- Evidencia ----
let ids = 0, n = 0;
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const run = (name, input, { error = false, out = 'ok' } = {}) => {
  const id = `e${++ids}`;
  return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }];
};
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });
const DOC = '/work/proj/docs/guide.md';
const opening = () => [prompt('actualiza la guía'), say('Waymark → L1 · dept-devex · skills: ninguna'), ...run('Skill', { skill: 'dept-devex' }), ...run('Read', { file_path: '/skills/dept-devex/procedures.md' }),
  ...run('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Corta', 'Larga'], 'Corta'), ...run('Edit', { file_path: DOC, old_string: 'a', new_string: 'b' })];
const judge = (lines, evidencia) => {
  const cwd = `/work/supply-${++n}`, id = P.taskIds(cwd).next;
  return cierreGaps(T.currentTurn(lines), `## Cierre · ${id}\nResultado: hecho\nEvidencia: ${evidencia}\nAprendido: guía corta ← pedido`, undefined, undefined, { ids: P.taskIds(cwd), decisions: [{ question: '¿Cómo?', chosen: 'Corta', discarded: ['Larga'] }] });
};
const step = (g, id) => g.steps.find((s) => s.id === id);

test('Evidencia: "observada" with no tool call after the last change blocks once; "inferida" does not', () => {
  const g = judge(opening(), 'observada la guía queda corta');
  assert.equal(step(g, 'evidence').pass, false);
  assert.ok(g.missing.some((m) => /observada/.test(m)), 'it blocks');
  assert.equal(step(judge(opening(), 'inferida del diff (check: abre la guía)'), 'evidence').pass, true);
});

test('Evidencia: a commit or a push is no check; a read or a run after the change is', () => {
  const commitOnly = [...opening(), ...run('Bash', { command: 'git add docs/guide.md && git commit -m "guía"' })];
  assert.equal(step(judge(commitOnly, 'observada la guía queda corta'), 'evidence').pass, false);
  const read = [...opening(), ...run('Read', { file_path: DOC }, { out: '# Guía\ncorta' })];
  assert.equal(step(judge(read, 'observada la guía queda corta'), 'evidence').pass, true);
});

test('Evidencia: cited facts are looked up in the turn\'s tool calls; an unbacked one is a ⚠ that neither blocks nor lowers the score', () => {
  const lines = [...opening(), ...run('Bash', { command: 'node --test tests/guide.test.mjs' }, { out: '# tests 84\n# pass 84/84\n# fail 0' })];
  const backed = judge(lines, 'observada `node --test` da 84/84 y exit 0');
  assert.equal(step(backed, 'evidence').pass, true);
  assert.deepEqual(backed.observed.evidence.unbacked, []);
  const unbacked = judge(lines, 'observada `node --test` da 99/99');
  assert.equal(step(unbacked, 'evidence').pass, true, 'not a ✘');
  assert.match(step(unbacked, 'evidence').warn, /sin respaldo\): 99\/99/);
  assert.ok(!unbacked.missing.some((m) => /99\/99/.test(m)), 'not a block');
  assert.deepEqual(unbacked.observed.evidence.unbacked, ['99/99']);
  assert.ok(unbacked.findings.some((f) => /99\/99/.test(f)), 'kept in the record');
  const ev = evaluate(unbacked, null);
  assert.equal(ev.steps[step(unbacked, 'evidence').label], 'warn');
  assert.equal(ev.score, `${evaluate(backed, null).score} · 1 ⚠`, 'counted as passed, as when the fact is backed; shown as ⚠');
  assert.match(summaryLine('2026-10-14 · T1', ev), new RegExp(`${step(unbacked, 'evidence').label} ⚠`));
});

test('Evidencia: file:line is backed by a call that named the file and showed that line (grep -n of one file, Read)', () => {
  const FILE = '/work/proj/src/app/features/login/auth-callback/auth-callback.ts';
  const grep = [...opening(), ...run('Bash', { command: `grep -n "link" ${FILE} | head` }, { out: '21: *  También recibe el regreso\n45:    const isLink = sso === \'link\';\n47:    const codeVerifier = x;' })];
  assert.deepEqual(judge(grep, 'observada revisé `auth-callback.ts:45`').observed.evidence.unbacked, [], 'grep -n of one file prints "45:", not the file name');
  const read = [...opening(), ...run('Read', { file_path: FILE, offset: 40, limit: 10 }, { out: '    44→  ngOnInit() {\n    45→    const isLink = sso === \'link\';' })];
  assert.deepEqual(judge(read, 'observada `auth-callback.ts:45`').observed.evidence.unbacked, [], 'Read numbers its lines');
  assert.deepEqual(judge(grep, 'observada `auth-callback.ts:46`').observed.evidence.unbacked, ['auth-callback.ts:46'], 'a line the output never showed');
  assert.deepEqual(judge(grep, 'observada `login.ts:45`').observed.evidence.unbacked, ['login.ts:45'], 'line 45 of another file');
  assert.deepEqual(judge(grep, 'observada `callback.ts:45`').observed.evidence.unbacked, ['callback.ts:45'], 'a name that only ends another file\'s name');
});

test('Evidencia: a path is backed when its folder is in a call\'s command and its name in that call\'s output', () => {
  const ls = [...opening(), ...run('Bash', { command: 'cd api && ls prisma/backups | tail -1 && ls prisma/backups/$(ls prisma/backups | tail -1) | grep -c json' }, { out: '2026-10-14T15-38-44-344Z\n34' })];
  assert.deepEqual(judge(ls, 'observada el backup `prisma/backups/2026-10-14T15-38-44-344Z` tiene 34 tablas').observed.evidence.unbacked, []);
  assert.deepEqual(judge(ls, 'observada `prisma/seeds/2026-10-14T15-38-44-344Z`').observed.evidence.unbacked, ['prisma/seeds/2026-10-14T15-38-44-344Z'], 'another folder');
  assert.deepEqual(judge(ls, 'observada `prisma/backups/2026-10-14T15-38-44`').observed.evidence.unbacked, ['prisma/backups/2026-10-14T15-38-44'], 'only part of the name');
});

test('forget: removing every record leaves a chain that holds, and later records anchor again', () => {
  const d = repo('forget-all');
  P.appendRecord(d, rec(1, { session: 'only' }));
  assert.equal(P.forget(d, null, { session: 'only', reason: 'todo' }).to.n, 0);
  assert.deepEqual(chainOf(d), { ok: true });
  P.appendRecord(d, rec(2));
  assert.deepEqual(chainOf(d), { ok: true });
});

test('Evidencia: a fact only in the agent\'s own edit is not backed; a failing run ("permission denied") is still a check', () => {
  const wrote = [...opening(), ...run('Write', { file_path: '/work/proj/docs/result.md', content: 'tests 77/77' }), ...run('Read', { file_path: DOC })];
  assert.deepEqual(judge(wrote, 'observada 77/77').observed.evidence.unbacked, ['77/77']);
  const red = [...opening(), ...run('Bash', { command: 'npm test' }, { error: true, out: 'EACCES: permission denied, open dist/x' })];
  assert.equal(judge(red, 'observada el test falla por permisos').observed.evidence.checkedAfter, true);
  const refused = [...opening(), ...run('Bash', { command: 'npm test' }, { error: true, out: 'PreToolUse:Bash hook error: Waymark: …' })];
  assert.equal(judge(refused, 'observada x').observed.evidence.checkedAfter, false);
});
