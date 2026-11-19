// Waymark 2.0.22 · the notice that a newer Waymark exists (docs/adr/0066): the session card says it in every session until the install is updated, from a cached
// remote version that a detached process refreshes, so no hook waits for the network. Run: node --test tests/update-notice.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const INSTALLED = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-latest-'));
const temps = [home];
process.env.WAYMARK_HOME = home; // the in-process reads (lib/latest.mjs) and the spawned hooks see the same folder
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const L = await import(`file://${SCRIPTS}/lib/latest.mjs`);
const cache = path.join(home, '.latest.json');
const put = (o) => fs.writeFileSync(cache, JSON.stringify(o));
const env = (extra = {}) => ({ ...process.env, WAYMARK_HOME: home, WAYMARK_NO_REFRESH: '1', ...extra });
const card = (extra) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-latest-p-')); temps.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: dir, session_id: 's-up' }), env: env(extra), encoding: 'utf8' });
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};
const serve = (body, status = 200) => new Promise((resolve) => { const s = http.createServer((q, r) => { r.statusCode = status; r.end(body); }).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/VERSION` })); });

test('the notice line names the two versions, offers the three answers and points to the clean reinstall of INSTALL.md §12; nothing when the cache says the install is current, older, missing or broken', () => {
  put({ latest: '9.0.0', at: Date.now() });
  const line = L.updateLine(INSTALLED);
  assert.match(line, new RegExp(`Waymark ${INSTALLED.replace(/\./g, '\\.')} → 9\\.0\\.0`));
  assert.match(line, /Actualizar ahora/); assert.match(line, /Más tarde/); assert.match(line, /Ver cambios/);
  assert.match(line, /INSTALL\.md §12/); assert.match(line, /clean reinstall/i);
  put({ latest: INSTALLED, at: Date.now() }); assert.equal(L.updateLine(INSTALLED), '', 'the same version');
  put({ latest: '1.0.0', at: Date.now() }); assert.equal(L.updateLine(INSTALLED), '', 'an older one');
  fs.rmSync(cache, { force: true }); assert.equal(L.updateLine(INSTALLED), '', 'no cache');
  fs.writeFileSync(cache, '{not json'); assert.equal(L.updateLine(INSTALLED), '', 'a broken cache');
});

test('the session card carries the notice in every session until the install is updated, with no network and no weekly pause', () => {
  put({ latest: '9.0.0', at: Date.now() });
  fs.writeFileSync(path.join(home, '.check.json'), JSON.stringify({ checkedAt: Date.now(), pointedAt: Date.now() })); // the weekly pointer was just said
  for (const n of [1, 2]) assert.match(card(), /Waymark .* → 9\.0\.0/, `session ${n}`);
  put({ latest: INSTALLED, at: Date.now() });
  assert.doesNotMatch(card(), /Actualizar ahora/, 'current: nothing');
});

test('refreshDue: due when there is no cache or it is older than six hours, not before', () => {
  fs.rmSync(cache, { force: true });
  assert.equal(L.refreshDue(Date.now()), true);
  put({ latest: '9.0.0', at: Date.now() - 3600000 }); assert.equal(L.refreshDue(Date.now()), false, 'an hour old');
  put({ latest: '9.0.0', at: Date.now() - 7 * 3600000 }); assert.equal(L.refreshDue(Date.now()), true, 'seven hours old');
});

test('the refresher writes the version main publishes; a failed fetch keeps the last one and moves its time, so a bad network is not asked again at once', async () => {
  fs.rmSync(cache, { force: true });
  const ok = await serve('9.1.0\n');
  const run = (url) => new Promise((resolve) => { const c = spawn(process.execPath, [path.join(SCRIPTS, 'latest.mjs')], { env: env({ WAYMARK_UPDATE_URL: url }), stdio: 'ignore' }); c.on('close', (status) => resolve({ status })); }); // async: the server answering lives in this process
  assert.equal((await run(ok.url)).status, 0); ok.s.close();
  const first = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.equal(first.latest, '9.1.0');
  put({ ...first, at: Date.now() - 8 * 3600000 });
  const bad = await serve('boom', 500);
  assert.equal((await run(bad.url)).status, 0); bad.s.close();
  const second = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.equal(second.latest, '9.1.0', 'the last known version stays');
  assert.ok(Date.now() - second.at < 60000, 'the attempt is dated');
  assert.equal(L.refreshDue(Date.now()), false);
});

test('the session hook starts the refresh by itself when it is due, detached: the card is not held for it', async () => {
  fs.rmSync(cache, { force: true });
  const ok = await serve('9.2.0\n');
  const t0 = Date.now();
  card({ WAYMARK_NO_REFRESH: '', WAYMARK_UPDATE_URL: ok.url });
  assert.ok(Date.now() - t0 < 8000, 'the hook returned');
  let got = null;
  for (let i = 0; i < 40 && !got; i++) { await new Promise((r) => setTimeout(r, 250)); try { got = JSON.parse(fs.readFileSync(cache, 'utf8')).latest; } catch {} }
  ok.s.close();
  assert.equal(got, '9.2.0', 'the detached process wrote the cache');
});

test('INSTALL.md §12 says how the clean reinstall is really made: a signed export of origin/main, every agent, the Kiro IDE per project, the skill map and the Claude Code block', () => {
  const install = fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8'), s12 = install.slice(install.indexOf('## 12. Clean reinstall'));
  for (const [re, what] of [[/git archive origin\/main/, 'the export'], [/verify --install --require-signature/, 'the signature'], [/--project/, 'Kiro IDE per project'], [/skill-map\.json/, 'the skill map'], [/waymark-backups/, 'the backup'], [/\$\{?[A-Za-z]+:\?|never a link|never a junction/i, 'the removal that cannot expand to nothing'], [/§9|update notice|Actualizar ahora/, 'the update notice']]) assert.match(s12, re, what);
});
