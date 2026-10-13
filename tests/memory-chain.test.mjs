// Waymark 2.0.3 · point 2: the memory chain (notes that travel, records that are only notes, what a Q learns, the
// card). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME and temporary repos; nothing reads or writes the real ~/.waymark or engram.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-chain-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { appendRecord, projectHome, readTaskRecords, taskIds, tasksMarkdown } = await import(`file://${SCRIPTS}/provenance.mjs`);
const notes = await import(`file://${SCRIPTS}/notes.mjs`);
const engram = await import(`file://${SCRIPTS}/engram.mjs`);
const { questionRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { digest } = await import(`file://${SCRIPTS}/session-hook.mjs`);
const { notesState } = await import(`file://${SCRIPTS}/waymark.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-chain-${name}-`)); temps.push(d); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n.engram/\n');
  return repo;
};
const commit = (repo, id) => {
  fs.writeFileSync(path.join(repo, 'a.txt'), String(Math.random()));
  gitT(repo, 'add', 'a.txt'); gitT(repo, 'commit', '-q', '-m', `x\n\nWaymark-Task: ${id}`);
  return gitT(repo, 'rev-parse', 'HEAD').stdout.trim();
};
const day = new Date().toLocaleDateString('sv');
const record = (id, sha, more = {}) => ({ id, agent: 'claude', at: new Date().toISOString(), session: 's', files: ['a.txt'], commits: [sha], prompt: `pedido ${id}`, cierre: `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada x\nAprendido: lección de ${id}`, evaluation: { score: '4/4', steps: {} }, ...more });
// A bare remote, a repo that closed one task (its record a note) and pushed branch and notes, and a fresh clone.
const pair = () => {
  const base = tmp('remote'), remote = path.join(base, 'remote.git'), a = path.join(base, 'a'), b = path.join(base, 'b');
  gitT(base, 'init', '-q', '--bare', remote);
  gitT(base, 'clone', '-q', remote, a);
  withMemory(a);
  const id = `${day} · T1`, sha = commit(a, id);
  appendRecord(a, record(id, sha));
  gitT(a, 'push', '-q', 'origin', 'HEAD:refs/heads/main', `${notes.NOTES_REF}:${notes.NOTES_REF}`);
  gitT(base, 'clone', '-q', '-b', 'main', remote, b);
  return { a, b, id, sha };
};
const fakeEngram = (context = '') => {
  const dir = tmp('engram'), log = path.join(dir, 'calls.jsonl'), bin = path.join(dir, 'engram.mjs');
  fs.writeFileSync(bin, `import fs from 'node:fs';
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] === 'version') console.log('engram 3.1.0');
if (a[0] === 'context') console.log(${JSON.stringify(`## Memory\n\n### Recent Observations\n${context}`)});
`);
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []) };
};
const withEngram = (bin, fn) => { const prev = process.env.WAYMARK_ENGRAM; process.env.WAYMARK_ENGRAM = bin; try { return fn(); } finally { process.env.WAYMARK_ENGRAM = prev; } };

test('notes at clone: a clone has none; setup adds a tracking refspec (never over the local ref), fetches and merges', () => {
  const { a, b, sha } = pair();
  assert.equal(notes.readNotes(b).size, 0, 'git clone brings branches only');
  assert.equal(notes.hasFetchSpec(b), false);
  assert.match(notesState(b), /notes setup/, 'check offers the setup');
  const r = notes.notesSetup(b);
  assert.equal(r.ok, true, r.output);
  assert.equal(notes.hasFetchSpec(b), true);
  assert.ok(gitT(b, 'config', '--get-all', 'remote.origin.fetch').stdout.includes(`+${notes.NOTES_REF}*:refs/notes/remotes/origin/waymark*`), 'a glob: a remote without notes never fails a fetch');
  assert.ok(notes.readNotes(b).has(sha), 'the record came with the setup');
  assert.equal(notesState(b), '', 'nothing pending after the setup');
  // the other machine closes a second task and pushes: a plain fetch brings it, the merge joins it
  const sha2 = commit(a, `${day} · T2`);
  appendRecord(a, record(`${day} · T2`, sha2));
  gitT(a, 'push', '-q', 'origin', 'HEAD:refs/heads/main', `${notes.NOTES_REF}:${notes.NOTES_REF}`);
  gitT(b, 'fetch', '-q', 'origin');
  assert.equal(notes.mergeNotes(b), true);
  assert.ok(notes.readNotes(b).has(sha2));
  assert.equal(notes.mergeNotes(b), false, 'nothing new: no merge');
});

test('notes refspec: a remote with no notes yet never breaks git fetch; the old exact refspec is replaced', () => {
  const base = tmp('empty'), remote = path.join(base, 'remote.git'), c = path.join(base, 'c');
  gitT(base, 'init', '-q', '--bare', remote);
  gitT(base, 'clone', '-q', remote, c);
  commit(c, 'x'); gitT(c, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  gitT(c, 'config', '--add', 'remote.origin.fetch', `+${notes.NOTES_REF}:refs/notes/remotes/origin/waymark`); // 2.0.3's exact refspec
  assert.equal(gitT(c, 'fetch', '-q', 'origin').status, 128, 'the exact refspec breaks fetch while the remote has no notes');
  assert.equal(notes.hasFetchSpec(c), false, 'the old refspec does not count');
  assert.equal(notes.ensureFetchSpec(c), true, 'added');
  assert.deepEqual(gitT(c, 'config', '--get-all', 'remote.origin.fetch').stdout.trim().split(String.fromCharCode(10)).map((l) => l.trim()), ['+refs/heads/*:refs/remotes/origin/*', `+${notes.NOTES_REF}*:refs/notes/remotes/origin/waymark*`], 'the old one replaced');
  assert.equal(gitT(c, 'fetch', '-q', 'origin').status, 0, 'fetch works with no notes on the remote');
  assert.equal(notes.ensureFetchSpec(c), false, 'once');
  const lone = tmp('lone'); gitT(lone, 'init', '-q');
  assert.equal(notes.ensureFetchSpec(lone), false, 'no origin: nothing to add');
});

test('notes setup on its own: the session hook adds the refspec in a repo with Waymark memory and says it once; never in one without it', () => {
  const { b, sha } = pair();
  const card = (cwd) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ session_id: 's', cwd }), env: process.env, encoding: 'utf8' }).stdout || '{}').hookSpecificOutput?.additionalContext || '';
  assert.doesNotMatch(card(b), /fetches from origin now bring/, 'no .waymark/ here: the repo is left alone');
  assert.equal(notes.hasFetchSpec(b), false);
  withMemory(b);
  assert.match(card(b), /fetches from origin now bring the task records/);
  assert.equal(notes.hasFetchSpec(b), true);
  assert.equal(notesState(b), '', 'check has nothing to offer');
  gitT(b, 'fetch', '-q', 'origin');
  assert.doesNotMatch(card(b), /fetches from origin now bring/, 'said once');
  assert.ok(notes.readNotes(b).has(sha), 'the next fetch brought the records and the card merged them');
});

test('notes merge: a conflict on one commit keeps the local note (its stub hashes it); the rest joins', () => {
  const { a, b, sha } = pair();
  notes.notesSetup(b);
  gitT(b, 'pull', '-q', '--no-rebase', 'origin', 'main');
  const shaB = commit(b, `${day} · T5`);
  notes.addNote(b, shaB, '{"id":"local"}');
  gitT(b, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  gitT(a, 'pull', '-q', '--no-rebase', 'origin', 'main');
  notes.addNote(a, shaB, '{"id":"remote"}');
  const sha3 = commit(a, `${day} · T3`);
  notes.addNote(a, sha3, '{"id":"three"}');
  gitT(a, 'push', '-q', 'origin', 'HEAD:refs/heads/main', `${notes.NOTES_REF}:${notes.NOTES_REF}`);
  gitT(b, 'fetch', '-q', 'origin');
  assert.equal(notes.mergeNotes(b), true);
  const n = notes.readNotes(b);
  assert.deepEqual([n.get(shaB), n.get(sha3), n.has(sha)], ['{"id":"local"}', '{"id":"three"}', true]);
});

test('notes push: check says how many note commits are not pushed; the hook pushes on any push it sees', () => {
  const { b } = pair();
  notes.notesSetup(b);
  assert.equal(notes.unpushedNotes(b), 0);
  assert.equal(notes.shouldPushNotes(b), false, 'nothing to push');
  const sha = commit(b, `${day} · T4`);
  notes.addNote(b, sha, '{"id":"x"}');
  assert.equal(notes.unpushedNotes(b), 1);
  assert.equal(notes.shouldPushNotes(b), true);
  assert.match(notesState(b), /1 .*not pushed.*notes push/);
  assert.equal(notes.pushNotes(b).ok, true);
  assert.equal(notes.unpushedNotes(b), 0, 'the push moves the tracking ref');
  const plain = tmp('plain');
  gitT(plain, 'init', '-q');
  assert.equal(notes.shouldPushNotes(plain), false, 'no notes at all: nothing to push');
});

test('records that are only notes: the clone reads them (the note wins), counts their IDs and shows the last close', () => {
  const { b, id } = pair();
  withMemory(b);
  notes.notesSetup(b);
  const h = projectHome(b);
  assert.equal(fs.existsSync(h.log), false, 'the clone has no log');
  const recs = readTaskRecords(h).filter((r) => r.id);
  assert.deepEqual(recs.map((r) => [r.id, r.agent]), [[id, 'claude']]);
  assert.match(recs[0].cierre, /lección de/);
  assert.equal(taskIds(b).next, `${day} · T2`, 'an ID only in a note is taken');
  assert.match(tasksMarkdown(h), new RegExp(`Last closed: ${id} · claude`));
  // a log line and a note of the same task: one record, the note's fields win
  appendRecord(b, { id, agent: 'claude', at: new Date().toISOString(), session: 's2', prompt: 'p', cierre: 'Aprendido: viejo' });
  const again = readTaskRecords(h).filter((r) => r.id === id);
  assert.equal(again.length, 2, 'same ID from another session (two machines the same day): two tasks, never mixed');
  assert.deepEqual(again.map((r) => r.cierre), ['## Cierre · ' + id + '\nResultado: hecho\nEvidencia: observada x\nAprendido: lección de ' + id, 'Aprendido: viejo']);
  // the follow-up offered is the newest task, wherever it lives
  appendRecord(b, { id: `${day} · T2`, agent: 'codex', at: new Date(Date.now() + 60000).toISOString(), session: 's3', prompt: 'p', cierre: 'Aprendido: nuevo' });
  assert.equal(taskIds(b).last, `${day} · T2`);
  assert.equal(readTaskRecords(h).filter((r) => r.id).pop().id, `${day} · T2`);
});

test('records: a whole log line that a later commit carries as a note (same session) is one record with the note\'s fields', () => {
  const repo = tmp('late'); gitT(repo, 'init', '-q'); withMemory(repo);
  const id = `${day} · T1`;
  appendRecord(repo, { id, agent: 'claude', at: new Date().toISOString(), session: 's', prompt: 'p', cierre: 'Aprendido: x' });
  const sha = commit(repo, id);
  assert.deepEqual(notes.noteLateCommits(repo, readTaskRecords(projectHome(repo))), [id]);
  const recs = readTaskRecords(projectHome(repo)).filter((r) => r.id);
  assert.deepEqual(recs.map((r) => [r.id, r.commits]), [[id, [sha]]]);
});

test('"¿por dónde voy?": a task closed in Codex is the last closed for Claude, in the card and in tasks.md', () => {
  const repo = tmp('cross');
  gitT(repo, 'init', '-q');
  withMemory(repo);
  appendRecord(repo, { id: `${day} · T7`, agent: 'codex', at: new Date().toISOString(), session: 'cx', prompt: 'agrega reintentos', cierre: `## Cierre · ${day} · T7\nResultado: parcial (faltan tests)\nAprendido: backoff ← timeouts` });
  const card = digest(repo, 'claude');
  assert.match(card, new RegExp(`Last closed: ${day} · T7 · codex · parcial · backoff ← timeouts`));
  assert.match(tasksMarkdown(projectHome(repo)), new RegExp(`${day} · T7 · codex`));
});

test('engram: titled with the Aprendido (the request in the body); a follow-up writes its task\'s topic', () => {
  const repo = tmp('eng'); gitT(repo, 'init', '-q'); withMemory(repo);
  const h = projectHome(repo), fake = fakeEngram();
  withEngram(fake.bin, () => {
    assert.equal(engram.saveLearned(h, { id: '2026-10-06 · T4b', agent: 'codex', prompt: 'arregla el contador', cierre: 'Resultado: hecho\nAprendido: el contador vive en el store' }), true);
  });
  const save = fake.calls().find((c) => c[0] === 'save');
  assert.equal(save[1], '2026-10-06 · T4b · el contador vive en el store');
  assert.match(save[2], /^Aprendido: el contador vive en el store\nPedido: arregla el contador\n/);
  assert.equal(save[save.indexOf('--topic') + 1], 'waymark/2026-10-06 · T4', 'the follow-up replaces its task\'s lesson');
  assert.equal(engram.importChunks, undefined, 'docs/adr/0017: nothing is imported from .engram/');
  assert.doesNotMatch(fs.readFileSync(path.join(SCRIPTS, 'session-hook.mjs'), 'utf8'), /importChunks/);
});

test('a Q that ends with an Aprendido line goes to engram marked Q; one without it saves nothing', () => {
  const repo = tmp('q'); gitT(repo, 'init', '-q'); withMemory(repo);
  const h = projectHome(repo), fake = fakeEngram();
  const turn = (text) => currentTurn([{ type: 'user', message: { role: 'user', content: '¿dónde vive el contador?' } }, { type: 'assistant', message: { content: [{ type: 'text', text }] } }]);
  const q = questionRecord(turn('Waymark → Q · dept-frontend · skills: ninguna\n\nEn `store.ts:12`.\n\nAprendido: el contador vive en el store ← store.ts:12'), { agent: 'codex', session: 's', cwd: repo });
  assert.equal(q.learned, 'el contador vive en el store ← store.ts:12');
  withEngram(fake.bin, () => assert.equal(engram.saveQuestion(h, q), true));
  const save = fake.calls().find((c) => c[0] === 'save');
  assert.match(save[1], /^Q · \d{4}-\d\d-\d\d · el contador vive en el store/);
  assert.match(save[save.indexOf('--topic') + 1], /^waymark\/Q\//);
  const none = questionRecord(turn('Waymark → Q · dept-frontend · skills: ninguna\n\nEn `store.ts:12`.'), { agent: 'codex', session: 's', cwd: repo });
  assert.equal(none.learned, undefined);
  withEngram(fake.bin, () => assert.equal(engram.saveQuestion(h, none), false));
});

// 2.0.7: a Q keeps what it answered and the skills it ran, and tasks.md lists the questions since the last close, so a
// "¿por dónde voy?" does not take a security-review that already ran for still pending.
test('a Q keeps its answer (the final reply without the routing line) and its skills; tasks.md lists the Qs since the last close', () => {
  const repo = tmp('q-answer'); gitT(repo, 'init', '-q'); withMemory(repo);
  const said = (text, tools = []) => ({ type: 'assistant', message: { content: [{ type: 'text', text }, ...tools.map((t) => ({ type: 'tool_use', id: t, name: 'Skill', input: { skill: t } }))] } });
  const turn = currentTurn([{ type: 'user', message: { role: 'user', content: 'corre el security-review de auth' } },
    said('Waymark → Q · dept-security · skills: security-review', ['dept-security', 'security-review']),
    said('La revisión sigue corriendo en segundo plano.'),
    said('# Security review: auth de T1\n\n**No encontré vulnerabilidades** con confianza ≥ 8/10.\n\n## Lo que revisé\n- logout')]);
  const q = questionRecord(turn, { agent: 'claude', session: 's', cwd: repo });
  assert.deepEqual(q.skills, ['security-review'], 'the department is its own field');
  assert.equal(q.answer, 'Security review: auth de T1 · No encontré vulnerabilidades con confianza ≥ 8/10. · Lo que revisé · logout');
  const learned = questionRecord(currentTurn([{ type: 'user', message: { role: 'user', content: '¿dónde?' } }, said('Waymark → Q · dept-frontend · skills: ninguna\n\nEn `store.ts:12`.\n\nAprendido: vive en el store ← store.ts:12')]), { agent: 'claude', session: 's', cwd: repo });
  assert.equal(learned.answer, 'vive en el store ← store.ts:12', 'the Aprendido, when the reply has one');
  const closing = questionRecord(currentTurn([{ type: 'user', message: { role: 'user', content: '¿por dónde voy?' } }, said('Waymark → Q · dept-qa · skills: ninguna\n\nVas después del cierre de T1: los commits están subidos y el review corrió sin hallazgos.'), said('¿Con cuál seguimos?')]), { agent: 'claude', session: 's', cwd: repo });
  assert.match(closing.answer, /^Vas después del cierre de T1/, 'a closing question on its own is not the answer');
  appendRecord(repo, { id: `${day} · T1`, agent: 'claude', at: '2026-10-13T16:36:00.000Z', session: 's', prompt: 'p', cierre: 'Resultado: hecho\nAprendido: x' });
  for (let i = 0; i < 6; i++) appendRecord(repo, { ...q, at: `2026-10-13T16:4${i}:00.000Z`, prompt: `pregunta ${i} ${'larga '.repeat(30)}` });
  const md = tasksMarkdown(projectHome(repo));
  assert.match(md, /## Preguntas \(Q\) desde el último cierre: 6 \(las últimas 5; provenance\.jsonl, kind "Q"\)\n/);
  const rows = md.split('\n').filter((l) => /^- (?:\d\d-\d\d )?\d\d:\d\d · dept-security · security-review · "pregunta \d/.test(l));
  assert.equal(rows.length, 5, md);
  assert.ok(rows[0].includes('"pregunta 1 ') && rows[4].includes('"pregunta 5 '), 'the newest five, oldest first');
  assert.match(rows[4], /…" → Security review: auth de T1 · No encontré vulnerabilidades/);
  assert.ok(rows.every((l) => l.length <= 300), 'one line each');
});

test('card: the last closed task\'s Aprendido shows once (not again under Learned); a Learned line is "<id> · <Aprendido>"', () => {
  const repo = tmp('card'); gitT(repo, 'init', '-q'); withMemory(repo);
  appendRecord(repo, { id: `${day} · T2`, agent: 'claude', at: new Date().toISOString(), session: 's', prompt: 'p', cierre: 'Resultado: hecho\nAprendido: la lección nueva' });
  const fake = fakeEngram([
    `- [learning] **${day} · T2 · la lección nueva**: Aprendido: la lección nueva`,
    `- [learning] **${day} · T1 · una lección vieja y larga que el título recor…**: Aprendido: una lección vieja y larga que el título recorta pero el cuerpo no`,
    '- [decision] **ADR 0001**: [2026-10-05] ADR 0001 y tema',
  ].join('\n'));
  const card = withEngram(fake.bin, () => digest(repo, 'claude'));
  assert.equal(card.split('la lección nueva').length - 1, 1, card);
  assert.match(card, new RegExp(`- ${day} · T1 · una lección vieja y larga que el título recorta pero el cuerpo no`));
  assert.match(card, /- ADR 0001: \[2026-10-05\] ADR 0001 y tema|- \[2026-10-05\] ADR 0001 y tema/);
});

test('docs say what the code does: closed lines leave Work in progress (DONE_KEPT = 0); a follow-up corrects its task\'s lesson', () => {
  const learning = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'references', 'learning.md'), 'utf8');
  const template = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'templates', 'project-memory.template.md'), 'utf8');
  const prov = fs.readFileSync(path.join(SCRIPTS, 'provenance.mjs'), 'utf8');
  for (const [name, text] of [['learning.md', learning], ['template', template], ['provenance.mjs', prov]]) assert.doesNotMatch(text, /newest 5/i, name);
  assert.match(prov, /DONE_KEPT = 0/);
  assert.match(learning, /follow-up/i);
});
