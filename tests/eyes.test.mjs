// Waymark 2.0.19 · point 8: the eyes (docs/adr/0047). An L2/L3 task that changes something seen, or an L1 CSS/HTML change with no spec, is not done until a
// browser measured or clicked what was built, after the last change. Synthetic copies of the pattern: a CSS/HTML case, a logic case and the counter-examples.
// The ego-browser binary is a stub on PATH; the real one is only used by the opt-in check at the end. Run: node --test tests/eyes.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-eyes-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const Eyes = await import(`file://${SCRIPTS}/eyes.mjs`);

let ids = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok', error = false) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
const head = (level, ...files) => [prompt('ajusta el botón'), say(`Waymark → L${level} · dept-frontend`), ...call('Skill', { skill: 'dept-frontend' }), ...files.flatMap((f) => call('Edit', { file_path: f }))];
const CIERRE = '## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: observada ancho 40\nAprendido: x ← y';
const judge = (lines, ctx = {}, reply = CIERRE) => cierreGaps(currentTurn(lines), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-frontend'], eyes: { provider: 'ego' }, ...ctx });
const eyes = (g) => g.steps.find((s) => s.id === 'eyes');
// what the agent runs: a script given to ego, measuring (evaluate), clicking, or only looking
const ego = (body) => call('Bash', { command: `ego-browser nodejs <<'EOF'\nconst task = await taskSpace("check");\nconst page = task.page("p1");\n${body}\nEOF` });
const MEASURE = 'console.log(await page.evaluate(() => document.querySelector("button").getBoundingClientRect().width));';
const LOOK = 'await page.goto("http://localhost:4200/"); console.log(await page.snapshot());';
const CLICK = 'await page.click("#go"); console.log(await page.evaluate(() => document.getElementById("state").textContent));';
const CSS = '/work/proj/src/app/shared/button/button.component.css', HTML = '/work/proj/src/app/shared/button/button.component.html', TS = '/work/proj/src/app/orders/orders.service.ts';

test('8: CSS/HTML — an L2 style change closes only after a measurement taken after the last change', () => {
  const none = judge(head(2, CSS, HTML));
  assert.equal(eyes(none).applies, true);
  assert.equal(eyes(none).pass, false, 'no eyes call and "observada: ancho 40" is a claim nobody looked at');
  assert.ok(none.missing.some((m) => /browser|ego/i.test(m)), 'the block names the way: run the eyes');
  const measured = judge([...head(2, CSS, HTML), ...ego(MEASURE)]);
  assert.equal(eyes(measured).pass, true, 'a width measured after the last change');
  assert.equal(measured.observed.eyes.provider, 'ego');
  assert.equal(measured.observed.eyes.afterLastChange, true);
  assert.ok(measured.observed.eyes.measures >= 1);
  const stale = judge([...head(2, CSS), ...ego(MEASURE), ...call('Edit', { file_path: HTML })]);
  assert.equal(eyes(stale).pass, false, 'counter-example: a measurement older than the last change');
  assert.equal(judge([...head(2, CSS), ...ego(LOOK)]).steps.find((s) => s.id === 'eyes').pass, false, 'counter-example: only looking (goto + snapshot) measures nothing');
  assert.equal(eyes(judge([...head(2, CSS), ...ego(CLICK)])).pass, true, 'a real click with the state after it counts');
});

test('8: counter-example — a build or a spec never counts as the look of the screen', () => {
  const lines = [...head(2, CSS), ...call('Bash', { command: 'pnpm run build' }, 'Build at: now\n<exit_code>0</exit_code>'), ...call('Bash', { command: 'pnpm exec vitest run' }, 'Tests  3 passed')];
  assert.equal(eyes(judge(lines)).pass, false);
});

test('8: logic — a pure .ts change owes no eyes at L2; a template with a binding does', () => {
  assert.equal(eyes(judge(head(2, TS))).applies, false, 'nothing seen changed');
  assert.equal(eyes(judge(head(2, TS, HTML))).applies, true);
});

test('8: L1 — a CSS/HTML change with no spec owes the eyes; with logic, or with a spec, it does not', () => {
  assert.equal(eyes(judge(head(1, CSS))).applies, true);
  assert.equal(eyes(judge(head(1, TS, HTML))).applies, false, 'logic in an L1: the normal spec applies instead');
  assert.equal(eyes(judge(head(1, CSS, '/work/proj/src/app/shared/button/button.component.spec.ts'))).applies, false, 'a spec already covers it');
});

test('8: no provider, no eyes: not applicable, and the record says why', () => {
  const g = judge(head(2, CSS), { eyes: { provider: null } });
  assert.equal(eyes(g).applies, false);
  assert.match(String(g.omitted?.Ojos || ''), /sin navegador|no browser/i);
});

test('8: the way out after the block: "Ojos: no (<why>)" passes as a declared exception, never as a pass', () => {
  const g = judge(head(2, CSS), { blocked: true }, `${CIERRE}\nOjos: no (el servidor de desarrollo no arranca sin la base de datos)`);
  assert.equal(eyes(g).pass, true);
  assert.match(String(eyes(g).exception || ''), /servidor/);
  const early = judge(head(2, CSS), {}, `${CIERRE}\nOjos: no (el servidor de desarrollo no arranca sin la base de datos)`);
  assert.equal(eyes(early).pass, false, 'counter-example: a preventive line before any block cancels nothing');
});

test('8: a script file imported by ego is read: its measurement counts', () => {
  const file = '/home/u/ego/round-01.mjs';
  const lines = [...head(2, CSS), ...call('Write', { file_path: file, content: `const page = (await taskSpace("x")).page("p1");\nconsole.log(await page.evaluate(() => getComputedStyle(document.body).width));` }), ...call('Bash', { command: `ego-browser nodejs -e "await import('file:///home/u/ego/round-01.mjs')"` })];
  assert.equal(eyes(judge(lines)).pass, true);
});

test('8: the panel of the agent is a provider too: a measuring script or a click counts', () => {
  const panel = (name, input) => call(`mcp__Claude_Browser__${name}`, input);
  assert.equal(eyes(judge([...head(2, CSS), ...panel('javascript_tool', { action: 'javascript_exec', text: 'document.querySelector("button").getBoundingClientRect().width' })], { eyes: { provider: 'panel' } })).pass, true);
  assert.equal(eyes(judge([...head(2, CSS), ...panel('computer', { action: 'left_click', coordinate: [10, 10] })], { eyes: { provider: 'panel' } })).pass, true);
  assert.equal(eyes(judge([...head(2, CSS), ...panel('navigate', { url: 'http://localhost:4200' })], { eyes: { provider: 'panel' } })).pass, false, 'counter-example: only navigating');
});

test('8: the provider is what the machine has: ego first, Playwright where the project declares it, else none', () => {
  const bin = fs.mkdtempSync(path.join(home, 'bin-'));
  const proj = fs.mkdtempSync(path.join(home, 'proj-'));
  const env = { PATH: bin, Path: bin, HOME: home, USERPROFILE: home };
  assert.equal(Eyes.eyesProvider({ root: proj, env }), null, 'nothing on PATH, nothing declared');
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '1.50.0' } }));
  assert.equal(Eyes.eyesProvider({ root: proj, env }), 'playwright');
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'ego-browser.cmd' : 'ego-browser'), '#!/bin/sh\necho stub\n', { mode: 0o755 });
  assert.equal(Eyes.eyesProvider({ root: proj, env }), 'ego', 'ego first');
});

test('8: the record keeps the eyes: provider, calls, measures, and nothing of the page', () => {
  const g = judge([...head(2, CSS), ...ego(MEASURE)]);
  const o = g.observed.eyes;
  assert.deepEqual(Object.keys(o).sort(), ['afterLastChange', 'calls', 'captures', 'design', 'measures', 'offHost', 'provider', 'references'].sort());
  assert.ok(!JSON.stringify(o).includes('localhost'), 'no URL, no text of the page');
});

test('8: ego-browser counts as the browser the task tried', () => {
  const g = judge([...head(2, CSS), ...ego(LOOK)]);
  assert.ok(g.observed.browser.tried.length >= 1);
});

// ---- the dev server row and the captures folder ----
const proj = (pkg, files = {}) => { const d = fs.mkdtempSync(path.join(home, 'p-')); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg)); for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(d, f), t); return d; };
const MEMORY = '# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | npx tsc --noEmit | 2026-10-25 |\n| build | | |\n\n## Design system\n';
const memoryOf = (text = MEMORY) => { const f = path.join(fs.mkdtempSync(path.join(home, 'm-')), 'memory.md'); fs.writeFileSync(f, text); return f; };

test('8: logic — the dev server comes from package.json and the framework: the script, the port, the local URL', () => {
  const ng = proj({ scripts: { start: 'ng serve', build: 'ng build' }, dependencies: { '@angular/core': '17.0.0' } }, { 'pnpm-lock.yaml': '' });
  assert.deepEqual(Eyes.devServer(ng), { command: 'pnpm run start', port: 4200, url: 'http://localhost:4200' });
  const vite = proj({ scripts: { dev: 'vite --port 4300' }, devDependencies: { vite: '5.0.0', react: '18.0.0' } });
  assert.deepEqual(Eyes.devServer(vite), { command: 'npm run dev', port: 4300, url: 'http://localhost:4300' }, 'a --port in the script wins over the default');
  assert.equal(Eyes.devServer(proj({ scripts: { start: 'node server.js' }, dependencies: { express: '4.0.0' } })), null, 'counter-example: an API shows nothing');
  assert.equal(Eyes.devServer(proj({ scripts: { build: 'ng build' }, dependencies: { '@angular/core': '17.0.0' } })), null, 'counter-example: no start, dev or serve script: never invented');
});

test('8: CSS/HTML — a static site served by a tool gets its row too', () => {
  const site = proj({ scripts: { serve: 'http-server . -p 8081' }, devDependencies: { 'http-server': '14.0.0' } }, { 'index.html': '<p>x</p>' });
  assert.deepEqual(Eyes.devServer(site), { command: 'npm run serve', port: 8081, url: 'http://localhost:8081' });
});

test('8: the eyes row is written once, after the last Quality gates row, and never over one somebody wrote', () => {
  const root = proj({ scripts: { start: 'ng serve' }, dependencies: { '@angular/core': '17.0.0' } });
  const file = memoryOf();
  const row = Eyes.fillEyes(file, root);
  assert.match(row, /^\| eyes \| `npm run start` · http:\/\/localhost:4200 \| to confirm/);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.indexOf('| eyes |') > text.indexOf('| build |') && text.indexOf('| eyes |') < text.indexOf('## Design system'));
  assert.equal(Eyes.fillEyes(file, root), null, 'once');
  const own = memoryOf(MEMORY.replace('| build | | |', '| build | | |\n| eyes | npm run dev · http://localhost:3000 | 2026-10-25 |'));
  assert.equal(Eyes.fillEyes(own, root), null, 'counter-example: the user\'s own row stays');
  assert.equal(Eyes.fillEyes(memoryOf(), proj({ scripts: { start: 'node server.js' }, dependencies: { express: '4.0.0' } })), null, 'counter-example: a backend gets no row');
  assert.deepEqual(Eyes.readEyesRow(fs.readFileSync(file, 'utf8')), { command: 'npm run start', url: 'http://localhost:4200', confirmed: false });
  assert.equal(Eyes.readEyesRow(fs.readFileSync(own, 'utf8')).confirmed, true);
});

test('8: captures live under the Waymark home, one folder per task, and go after seven days', () => {
  const dir = Eyes.eyesDir('shop', '2026-10-25 · T7');
  assert.ok(dir.startsWith(path.join(home, 'eyes', 'shop')) && /2026-10-25-T7$/.test(dir), dir);
  const old = Eyes.eyesDir('shop', '2026-10-10 · T1'), fresh = Eyes.eyesDir('shop', '2026-10-24 · T2');
  for (const d of [old, fresh]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'a.png'), 'x'); }
  const now = Date.now();
  fs.utimesSync(old, new Date(now - 8 * 86400000), new Date(now - 8 * 86400000));
  fs.utimesSync(fresh, new Date(now - 2 * 86400000), new Date(now - 2 * 86400000));
  assert.match(Eyes.eyesLine(now), /2 capture folders/);
  assert.deepEqual(Eyes.cleanEyes(now).map((p) => path.basename(p)), ['2026-10-10-T1']);
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh), 'counter-example: a recent folder stays');
  assert.match(Eyes.eyesLine(now), /1 capture folder\b/);
  fs.rmSync(path.join(home, 'eyes'), { recursive: true, force: true });
  assert.equal(Eyes.eyesLine(now), '', 'nothing to list');
});

test('8: the record keeps the paths of the captures the task made in its folder, and no other', () => {
  const inside = path.join(home, 'eyes', 'shop', '2026-10-25-T7', 'button-390.png').replace(/\\/g, '/');
  const g = judge([...head(2, CSS), ...ego('await page.screenshot({ path: "' + inside + '" });\n' + MEASURE), ...ego('await page.screenshot({ path: "/work/proj/leak.png" });')]);
  assert.deepEqual(g.observed.eyes.captures, [inside]);
});

test('8: the session card shows the eyes row and drops the captures past seven days', async () => {
  const { spawnSync } = await import('node:child_process');
  const repo = fs.mkdtempSync(path.join(home, 'r-')); spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, '.waymark')); fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), MEMORY);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { start: 'ng serve' }, dependencies: { '@angular/core': '17.0.0' } }));
  const old = Eyes.eyesDir('gone', '2026-10-01 · T1'); fs.mkdirSync(old, { recursive: true });
  fs.utimesSync(old, new Date(Date.now() - 9 * 86400000), new Date(Date.now() - 9 * 86400000));
  const out = spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout;
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /eyes: [^\n]*localhost:4200/);
  assert.ok(!fs.existsSync(old), 'the old capture folder is gone');
});

// ---- found by the review ----
test('8: counter-example — the words ego-browser nodejs in an echo or a grep are not a call; a trivial evaluate measures nothing', () => {
  const g = (...c) => judge([...head(2, CSS), ...c.flat()]);
  assert.equal(eyes(g(call('Bash', { command: "echo 'ego-browser nodejs getBoundingClientRect'" }))).pass, false);
  assert.equal(eyes(g(call('Bash', { command: 'grep -n "ego-browser nodejs" notes.md' }))).pass, false);
  assert.equal(eyes(g(ego('console.log(await page.evaluate(() => 1));'))).pass, false, 'evaluate alone is not a measurement');
  assert.equal(eyes(g(call('Bash', { command: 'cd web && ego-browser nodejs <<\'EOF\'\n' + MEASURE + '\nEOF' }))).pass, true, 'after a cd, still the program');
});

test('8: Playwright counts when it runs a test or a screenshot, not when it is only installed', () => {
  const g = (cmd) => judge([...head(2, CSS), ...call('Bash', { command: cmd })], { eyes: { provider: 'playwright' } });
  assert.equal(eyes(g('pnpm exec playwright test e2e/button.spec.ts')).pass, true);
  assert.equal(eyes(g('npx playwright screenshot http://localhost:4200 /tmp/a.png')).pass, true);
  assert.equal(eyes(g('npx playwright install chromium')).pass, false);
});

test('8: references counts the verdict lines of the Cierre, not the words in prose', () => {
  const reply = CIERRE + '\nResultado: parcial (falta el spec)\nbotón: igual — ancho 374\nmodal: parecido — alto 28 contra 40\nfalta el hover del título';
  const g = judge([...head(2, CSS), ...ego(MEASURE)], {}, reply);
  assert.equal(g.observed.eyes.references, 2);
});

test('8: an expired capture folder takes its empty project folder with it; one with a live task keeps it', () => {
  const dead = Eyes.eyesDir('lone', '2026-10-01 · T1'), live = Eyes.eyesDir('busy', '2026-10-24 · T1'), old2 = Eyes.eyesDir('busy', '2026-10-02 · T1');
  for (const d of [dead, live, old2]) fs.mkdirSync(d, { recursive: true });
  const now = Date.now(), t = (d, days) => fs.utimesSync(d, new Date(now - days * 86400000), new Date(now - days * 86400000));
  t(dead, 9); t(old2, 9); t(live, 1);
  Eyes.cleanEyes(now);
  assert.ok(!fs.existsSync(path.dirname(dead)), 'the empty project folder is gone');
  assert.ok(fs.existsSync(live) && !fs.existsSync(old2), 'counter-example: the project with a live task stays');
});

// ---- H5: the eyes look at the local dev server; a design link the user wrote is read, never counted as the built screen ----
const at_ = (url, body = MEASURE) => ego(`await page.goto("${url}");\n${body}`);
const DESIGN = 'https://www.figma.com/design/AbC123/kit?node-id=1-2';
test('8: CSS/HTML — a measurement counts only on a local page: localhost, 127.0.0.1, *.localhost, *.test, a file', () => {
  for (const url of ['http://localhost:4200/', 'http://127.0.0.1:5173/x', 'http://app.localhost:3000/', 'https://shop.test/', 'file:///C:/work/proj/dist/index.html']) {
    assert.equal(eyes(judge([...head(2, CSS), ...at_(url)])).pass, true, url);
  }
  const prod = judge([...head(2, CSS), ...at_('https://prod.example.com/')]);
  assert.equal(eyes(prod).pass, false, 'counter-example: the production site is not the change');
  assert.equal(prod.observed.eyes.offHost, 1);
  assert.ok(prod.findings.some((f) => /not local/.test(f)), prod.findings.join(' | '));
});

test('8: logic — the design link the user wrote is a reference, read only: it counts as no eyes; one the user did not write is off-host', () => {
  const asked = { requests: { images: 0, hosts: ['www.figma.com'] } };
  const design = judge([...head(2, CSS), ...at_(DESIGN)], asked);
  assert.equal(eyes(design).pass, false, 'the design is not the built screen');
  assert.deepEqual([design.observed.eyes.design, design.observed.eyes.offHost], [1, 0]);
  assert.equal(eyes(judge([...head(2, CSS), ...at_(DESIGN), ...at_('http://localhost:4200/')], asked, CIERRE + '\nbotón: igual — ancho 40')).pass, true, 'compared with the local build');
  assert.equal(judge([...head(2, CSS), ...at_(DESIGN)]).observed.eyes.offHost, 1, 'counter-example: a design link not written by the user');
});

test('8: before the tool — a profile-wide clear, a site clear off the local host, a password typed, a host the user did not write: refused', () => {
  const allowed = ['www.figma.com'];
  for (const s of ['await page.cdp("Network.clearBrowserCookies");', 'await page.cdp("Network.clearBrowserCache")', 'await page.cdp("Storage.clearCookies", {});',
    'await page.cdp("Storage.clearDataForOrigin", { origin: "https://mail.example.com", storageTypes: "all" });', 'await page.goto("http://localhost:4200/login"); await page.fill("#password", "x");',
    'await page.fill(\'input[type=password]\', "x")', 'await page.goto("https://prod.example.com/")']) assert.ok(Eyes.eyesRefusal(s, allowed), s);
  // counter-examples: scoped to the local app, a design read, a context-scoped clear
  for (const s of ['await page.goto("http://localhost:4200/"); ' + MEASURE, `await page.goto("${DESIGN}"); console.log(await page.snapshot());`,
    'await page.cdp("Storage.clearDataForOrigin", { origin: "http://localhost:4200", storageTypes: "all" });', 'await page.cdp("Storage.clearCookies", { browserContextId: ctx });',
    'await page.fill("#email", "a@b.c")']) assert.equal(Eyes.eyesRefusal(s, allowed), null, s);
});

// ---- H6: screenshots or a design link in the request owe an answer element by element ----
test('8: CSS/HTML — screenshots in the request and no verdict line in the Cierre: the eyes ask for one per element; with them it passes', () => {
  const refs = { requests: { images: 2, hosts: [] } }, lines = [...head(2, CSS), ...at_('http://localhost:4200/')];
  const none = judge(lines, refs);
  assert.equal(eyes(none).pass, false);
  assert.ok(none.missing.some((m) => /igual|parecido|falta/.test(m)), none.missing.join(' | '));
  assert.equal(eyes(judge(lines, refs, CIERRE + '\nbotón: igual — ancho 40\nícono: parecido — 18 contra 20')).pass, true);
  const declared = judge(lines, { ...refs, blocked: true }, CIERRE.replace('Aprendido', 'Ojos: no (el diseño no está publicado)\nAprendido'));
  assert.ok(!declared.missing.some((m) => /igual|parecido|falta/.test(m)), 'Ojos: no stays the declared way out');
});

test('8: logic — a design link written in the request is a reference too; counter-example: no reference, no verdict lines owed', () => {
  const lines = [...head(2, CSS, HTML), ...at_('http://localhost:4200/')];
  assert.equal(eyes(judge(lines, { requests: { images: 0, hosts: ['www.figma.com'] } })).pass, false);
  assert.equal(eyes(judge(lines, { requests: { images: 0, hosts: [] } })).pass, true);
  assert.equal(eyes(judge(lines)).pass, true, 'no request data: nothing owed');
});

test('8: the request is read from the prompts: image blocks and the hosts of the links the user wrote', () => {
  const img = { type: 'user', uuid: 'pi', timestamp: at(), message: { role: 'user', content: [{ type: 'text', text: `así debe quedar ${DESIGN} y en local http://localhost:4200` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] } };
  assert.deepEqual(Eyes.requestRefs([img, say('ok')]), { images: 1, hosts: ['www.figma.com'] });
});

test('8: the pre-tool hook denies the eyes script that clears the profile or opens a host the user did not write; the design link written in the request passes', async () => {
  const { gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-eyes-gate-'));
  const transcript = path.join(proj, 't.jsonl');
  fs.writeFileSync(transcript, [prompt(`ajusta el botón como en ${DESIGN}`)].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const run = (script) => gate({ tool_name: 'Bash', tool_input: { command: `ego-browser nodejs -e '${script}'` }, cwd: proj, session_id: 's-eyes-gate', transcript_path: transcript }, claude);
  assert.match(run('await page.cdp("Network.clearBrowserCookies")') || '', /whole browser profile/);
  assert.match(run('await page.goto("https://prod.example.com/")') || '', /neither the local dev server/);
  assert.match(run('await page.fill("#password", "x")') || '', /password/);
  assert.equal(run(`await page.goto("${DESIGN}")`), null, 'the design link the user wrote');
  assert.equal(run('await page.goto("http://localhost:4200/"); ' + MEASURE.replace(/'/g, '"')), null, 'the local dev server');
  assert.equal(gate({ tool_name: 'Bash', tool_input: { command: 'echo "ego-browser nodejs Network.clearBrowserCookies"' }, cwd: proj, session_id: 's-eyes-gate', transcript_path: transcript }, claude), null, 'counter-example: the words in an echo');
  fs.rmSync(proj, { recursive: true, force: true });
});
