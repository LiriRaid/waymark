// Waymark 2.0.20 · point 31: one Cierre per task. The first real task of checkpoint B showed four Cierre-like messages and two blocks: a Cierre written while the
// review ran, then a block per turn. Every case is a synthetic copy of that run. Run: node --test tests/one-cierre.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-one-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-one-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
const hookRun = (script, payload, { wait = 60000 } = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, wait);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});

const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text, when = at()) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: when, message: { role: 'user', content: text } });
const say = (text, when = at()) => ({ type: 'assistant', timestamp: when, message: { content: [{ type: 'text', text }] } });
let ids = 0;
const call = (name, input, when = at()) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: when, message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: when, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const launch = (toolUseId, agentId, when = at()) => ({ type: 'user', timestamp: when, toolUseResult: { isAsync: true, agentId }, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }] } });
const CIERRE = (id = '2026-10-30 · T1') => `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y`;
const FILE = 'src/orders.service.mjs';
const blocked = (r) => /"decision":"block"/.test(r.out);

const stopper = (dir, session) => {
  const transcript = path.join(dir, `${session}.jsonl`);
  return async (last, { active = false, extra = [] } = {}) => {
    fs.writeFileSync(transcript, [prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...call('Edit', { file_path: path.join(dir, FILE) }), ...extra, say(last)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    return hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: last, stop_hook_active: active });
  };
};
const recordsOf = (dir) => P.readRecords(P.projectHome(dir).log);

test('31: a task is blocked once; the next turn that still lacks proofs is recorded in red, not blocked', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-block');
  assert.ok(blocked(await stop(CIERRE())), 'the first close lacks the review and the build: blocked');
  const again = await stop(CIERRE());
  assert.ok(!blocked(again), 'a second chain of the same task is not blocked');
  const rec = recordsOf(dir).find((r) => r.id);
  assert.ok(rec, 'the task is recorded');
  assert.ok(Object.values(rec.evaluation.steps).includes(false), 'what is still missing is red in the record: ' + JSON.stringify(rec.evaluation.steps));
  assert.ok((rec.findings || []).some((f) => /already blocked once/.test(f)), JSON.stringify(rec.findings));
  assert.ok((rec.unresolved || []).some((m) => /review|build/.test(m)), 'the record keeps what was left unresolved: ' + JSON.stringify(rec.unresolved));
});

test('31: counter-example — a reply with no Cierre is still blocked after the task used its block, and a new task has its block again', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-no-cierre');
  assert.ok(blocked(await stop(CIERRE())), 'first block');
  assert.ok(blocked(await stop('Listo, terminé el cambio.')), 'no Cierre: the task cannot end without one');
  const later = stopper(dir, 'one-no-cierre');
  await later(CIERRE()); // closes the task: its record is written and its block count ends with it
  assert.ok(blocked(await later(CIERRE('2026-10-30 · T2'))), 'a new task in the session starts with its block unspent');
});

test('31: a Cierre written while a review still runs in the background is deferred, not judged and not blocked; the closing turn judges it', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-wait');
  const bg = [...call('Agent', { run_in_background: true }), launch(`toolu_bg${ids}`, 'bg1')];
  bg[1] = launch(bg[0].message.content[0].id, 'bg1');
  const waiting = await stop(CIERRE().replace('hecho', 'parcial (la revisión sigue corriendo)'), { extra: bg });
  assert.ok(!blocked(waiting), 'no block while the review runs, even with a Cierre in the reply');
  assert.match(waiting.out, /se evaluará cuando termine la tarea en segundo plano/);
  assert.ok(!recordsOf(dir).some((r) => r.id), 'and no task is closed by it');
});

// ---- 2.0.20 point 32: more than 4 decisions or review findings are all asked, in calls of 4; the rule lives where the agent reads it before its first window ----
test('32: the instructions block says it, stays within its size, and says the block is once per task; the L2 protocol carries the review rule', () => {
  const block = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8');
  assert.match(block, /Over 4 items \(decisions, review findings\): list all, ask in calls of 4, drop none/);
  assert.match(block, /blocks once per task naming the way out/);
  assert.ok(block.length <= 6500, `the block stays within its size (${block.length})`);
  const l2 = fs.readFileSync(path.join(SCRIPTS, '..', 'references', 'protocol', 'l2.md'), 'utf8');
  assert.match(l2, /Its findings are the user's to decide, all of them/);
  assert.match(l2, /"apply all recommended" or "one by one"/);
  assert.match(l2, /you never filter which are asked/);
});

// ---- 2.0.20 point 33: a task that crosses midnight keeps the ID its prompt was handed ----
test('33: the Cierre of a task handed 2026-10-29 · T12 and closed the next day is recorded as the ID it was handed, not renumbered to the new day', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' });
  const day = (d) => P.taskIds(dir, d).next.split(' · ')[0];
  const today = day(new Date()), yesterday = day(new Date(Date.now() - 86400000));
  P.markOpen(dir, 'midnight', 'ajusta el servicio', new Date(Date.now() - 86400000));
  const open = P.projectHome(dir).dir + '/open.json', entries = JSON.parse(fs.readFileSync(open, 'utf8'));
  entries.midnight.next = `${yesterday} · T12`; // the number of the day before: eleven tasks had been closed
  entries.midnight.at = new Date(Date.now() - 40 * 60000).toISOString(); // the prompt came forty minutes ago, before midnight
  fs.writeFileSync(open, JSON.stringify(entries));
  const stop = stopper(dir, 'midnight');
  await stop(CIERRE(`${today} · T12`), { active: true }); // stop_hook_active: nothing blocks, the record is written
  const rec = recordsOf(dir).find((r) => r.id);
  assert.ok(rec, 'the task is recorded');
  assert.equal(rec.id, `${yesterday} · T12`, 'the ID the prompt was handed');
  assert.equal(rec.claimed, `${today} · T12`, 'what the agent wrote is kept');
});

test('31 (review of level 3): a block that only asked for the Cierre does not spend the task\'s block; one that asked for any proof does', async () => {
  const { spendsBlock } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  assert.equal(spendsBlock(['the "## Cierre · <ID>" block is missing']), false, 'only the Cierre: the proofs were never asked');
  assert.equal(spendsBlock(['the "## Cierre · <ID>" block is missing', 'L2+ with code: run the build once now']), true, 'the Cierre and a proof');
  assert.equal(spendsBlock(['L2+ with code: run the build once now']), true, 'a proof alone');
  assert.equal(spendsBlock([]), false);
});

test('31 (review of level 3): a Cierre over background work that started a long time ago is judged: an agent that never notified must not hold a finished task unrecorded', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-old');
  const old = (minutes) => { const when = at(-minutes * 60000), c = call('Agent', { run_in_background: true }, when); return [c[0], launch(c[0].message.content[0].id, 'bgold', when)]; };
  const recent = await stop(CIERRE(), { extra: old(2) });
  assert.match(recent.out, /se evaluará cuando termine/, 'two minutes: the review is still expected');
  const stale = await stop(CIERRE(), { extra: old(20) });
  assert.doesNotMatch(stale.out, /se evaluará cuando termine/, 'twenty minutes: judged now');
});

// ---- 2.0.20 point 32: the Decision testigo compares the findings the review reported (foreseen) with the ones the windows put to the user (offered) ----
const finding = (n) => ({ file: `skills/waymark/scripts/mod${n}.mjs`, line: 10 + n, category: 'correctness', summary: `defect ${n}`, failure_scenario: `case ${n}` });
const windowOf = (items) => call('AskUserQuestion', { questions: items.map((f) => ({ question: `${f.file}:${f.line} (high): ${f.summary}. Recommended: fix`, header: 'Finding', multiSelect: false, options: [{ label: 'Fix (Recommended)', description: 'apply' }, { label: 'Leave', description: 'skip' }] })) });
const callsOf4 = (items) => { const out = []; for (let i = 0; i < items.length; i += 4) out.push(...windowOf(items.slice(i, i + 4))); return out; };
const reply = async (n, offered) => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, `p32-${n}-${offered}`), all = Array.from({ length: n }, (_, i) => finding(i + 1));
  return stop(CIERRE(), { extra: [...call('ReportFindings', { level: 'high', findings: all }), ...callsOf4(all.slice(0, offered))] });
};
test('32: 10 findings all put to the user in calls of 4 (4, 4, 2) leave the Decision testigo quiet about them', async () => {
  const r = await reply(10, 10);
  assert.doesNotMatch(r.out, /never reached the user/);
});
test('32: 13 findings, 8 asked in two calls: the testigo names the 5 that never reached the user and asks for them in calls of 4', async () => {
  const r = await reply(13, 8);
  assert.match(r.out, /the review reported 13 finding\(s\) and 5 never reached the user/);
  assert.match(r.out, /mod9\.mjs:19/, 'it names the first one left, with its line');
  assert.match(r.out, /4 per call, none dropped/);
});
test('32: 10 findings of which the agent asked only 4 (the real run: 6 left on its own) are caught', async () => {
  const r = await reply(10, 4);
  assert.match(r.out, /the review reported 10 finding\(s\) and 6 never reached the user/);
});
test('32: a re-report with outcomes (after the fixes) is not a second list to ask', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'p32-rereport'), all = [1, 2].map(finding);
  const r = await stop(CIERRE(), { extra: [...call('ReportFindings', { level: 'high', findings: all }), ...callsOf4(all), ...call('ReportFindings', { level: 'high', findings: all.map((f) => ({ ...f, outcome: 'fixed' })) })] });
  assert.doesNotMatch(r.out, /never reached the user/);
});
