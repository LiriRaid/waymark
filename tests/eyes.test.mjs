// Waymark 2.0.19 · point 8: the eyes (docs/adr/0047). An L2/L3 task that changes something seen, or an L1 CSS/HTML change with no spec, is not done until a
// browser measured or clicked what was built, after the last change. Synthetic copies of the pattern: a CSS/HTML case, a logic case and the counter-examples.
// The ego-browser binary is a stub on PATH; no test needs the real one. Run: node --test tests/eyes.test.mjs
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
const bare = (level, ...files) => [prompt('ajusta el botón'), say(`Waymark → L${level} · dept-frontend`), ...call('Skill', { skill: 'dept-frontend' }), ...files.flatMap((f) => call('Edit', { file_path: f }))];
// the usual task: the edits, then the project's typecheck passing, then whatever the case does; `bare` is the same with no gate
const head = (level, ...files) => [...bare(level, ...files), ...call('Bash', { command: 'pnpm exec tsc --noEmit' })];
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
  assert.equal(eyes(judge([...head(2, CSS), ...panel('computer', { action: 'left_click', coordinate: [10, 10] }), ...panel('read_page', {})], { eyes: { provider: 'panel' } })).pass, true, 'a click with the page read after it');
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
  assert.deepEqual(Object.keys(o).sort(), ['afterLastChange', 'calls', 'captures', 'design', 'measures', 'offHost', 'provider', 'references', 'returns', 'skillRead', 'spaces'].sort()); // the ego task space(s) and the returns to ego are kept by name and count only, and whether ego's own skill was read first (2.0.20 point 15)
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

// ---- M9: the measure floor, the gap names where captures go, ego as a skill, and no department keeps the old rule ----
test('8: logic — a measurement counts only on an element; window.innerWidth alone is no look at the change', () => {
  assert.equal(eyes(judge([...head(2, CSS), ...ego('console.log(await page.evaluate(() => window.innerWidth));')])).pass, false);
  assert.equal(eyes(judge([...head(2, CSS), ...ego('console.log(await page.evaluate(() => document.querySelector("button").offsetWidth));')])).pass, true, 'an element\'s width');
});
test('8: CSS/HTML — a click counts only with the state read after it; a click alone is not', () => {
  assert.equal(eyes(judge([...head(2, CSS, HTML), ...ego('await page.click("#go");')])).pass, false);
  assert.equal(eyes(judge([...head(2, CSS, HTML), ...ego(CLICK)])).pass, true, 'counter-example: the state after it');
  const panel = (...calls) => judge([...head(2, CSS), ...calls.flatMap(([n, i]) => call(`mcp__Claude_Browser__${n}`, i))]);
  assert.equal(eyes(panel(['computer', { action: 'left_click', coordinate: [10, 10] }])).pass, false, 'the panel: a click alone');
  assert.equal(eyes(panel(['computer', { action: 'left_click', coordinate: [10, 10] }], ['get_page_text', {}])).pass, true, 'the panel: a click and the page read after it');
});
test('8: the gap names the folder the captures go to', () => {
  const g = judge(head(2, CSS), { slug: 'shop', ids: P.taskIds('/nowhere') });
  assert.ok(g.missing.some((m) => /captures in .*eyes[\/]shop[\/]/.test(m)), g.missing.join(' | '));
});
test('8: ego loaded as a skill counts as the browser the task tried', () => {
  assert.ok(judge([...head(2, CSS), ...call('Skill', { skill: 'ego-browser' })]).observed.browser.tried.includes('ego-browser'));
});
test('8: no department, tool skill or audit note keeps "the browser only when the user asks" for the eyes', () => {
  const root = path.join(SCRIPTS, '..', '..', '..');
  const files = ['skills/dept-devops/SKILL.md', 'skills/dept-devops/procedures.md', 'skills/dept-qa/SKILL.md', 'skills/dept-frontend/SKILL.md', 'docs/audit-context.md'];
  const old = /browser only if the user asks|`run` \/ `browser-verify` only when the user asks|`browser-verify` only when the user asks\)|^\| "Never offer browser verification" \|/im;
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), old, f);
  assert.match(fs.readFileSync(path.join(root, 'skills/dept-devops/SKILL.md'), 'utf8'), /post-deploy smoke test of a deployed host only when the user asks/, 'counter-example: a deployed host is beyond the eyes and stays on request');
});

// ---- 2.0.20 · point 1 (rows 11, 29, 30): the forms of the ego command the agents really ran, copied as patterns (no path, name or script of a real project) ----
const EGO_EXE = 'C:/Users/dev/.local/share/ego/active_version_dir/ego-browser.exe';
const FORMS = {
  'bare': `ego-browser nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'unquoted absolute path': `${EGO_EXE} nodejs -e "${MEASURE.replace(/"/g, "'")}"`,
  'quoted absolute path (the form the 2.0.19 message recommended: 75 of 130 misses)': `"${EGO_EXE}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'single-quoted path': `'${EGO_EXE}' nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'quoted path with a space': `"C:/Program Files/ego/ego-browser.exe" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'a variable': `"$EGO" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'an unquoted variable': `$EGO nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'a braced variable': `"\${EGO}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'the variable assigned in the same command': `EGO="${EGO_EXE}"; "$EGO" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'PowerShell & with a quoted path': `& "${EGO_EXE}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'PowerShell & with a variable': `& $exe nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'PowerShell & with an environment variable': `& "$env:EGO" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'after cd &&': `cd web && "${EGO_EXE}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'after touch && sleep &&': `touch ready.flag && sleep 1 && "${EGO_EXE}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'after mkdir && cd &&': `mkdir -p out && cd out && "$EGO" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'behind timeout': `timeout 120 "${EGO_EXE}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
  'behind an environment assignment': `EGO_QUIET=1 "${EGO_EXE}" nodejs <<'EOF'\n${MEASURE}\nEOF`,
};
test('1: every form of the ego command the agents ran is a call, and its measurement counts (one case per form)', () => {
  for (const [form, command] of Object.entries(FORMS)) {
    assert.equal(Eyes.RUNS_EGO.test(command), true, `recognised: ${form}`);
    const g = judge([...head(2, CSS), ...call('Bash', { command })]);
    assert.equal(g.observed.eyes.calls, 1, `calls: ${form}`);
    assert.equal(eyes(g).pass, true, `measured after the last change: ${form}`);
  }
});

test('1: counter-example — a variable or a path that is not ego, or ego named inside text, is no call', () => {
  for (const command of ['echo "$EGO nodejs"', 'grep -rn "$EGO nodejs" notes.md', '$NODE script.js', '"$EGO" skill', `"${EGO_EXE}" skill`, 'cat ego-browser-nodejs.md', 'node nodejs.js', 'echo ok && echo "ego-browser nodejs"']) {
    assert.equal(Eyes.RUNS_EGO.test(command), false, command);
  }
});

test('1: the browser the task tried names ego for every form, not only the bare one', () => {
  const g = judge([...head(2, CSS), ...call('Bash', { command: FORMS['quoted absolute path (the form the 2.0.19 message recommended: 75 of 130 misses)'] })]);
  assert.ok(g.observed.browser.tried.includes('ego-browser'));
});

test('1: a script the shell wrote (heredoc or PowerShell here-string) and ego imported later is read: its measurement counts; a look-only one does not', () => {
  const run = `"${EGO_EXE}" nodejs -e "await import('file:///home/u/ego/round-02.mjs')"`;
  const body = `const page = (await taskSpace("x")).page("p1");\n${MEASURE}`;
  const written = {
    'cat > f <<EOF': `cat > /home/u/ego/round-02.mjs <<'EOF'\n${body}\nEOF`,
    'cat >> f <<EOF': `cat >> /home/u/ego/round-02.mjs <<'EOF'\n${body}\nEOF`,
    'tee f <<EOF': `tee /home/u/ego/round-02.mjs <<EOF\n${body}\nEOF`,
    'here-string piped to Set-Content': `@'\n${body}\n'@ | Set-Content -Path /home/u/ego/round-02.mjs`,
    'Set-Content -Value here-string': `Set-Content -Path "/home/u/ego/round-02.mjs" -Value @'\n${body}\n'@`,
  };
  for (const [how, command] of Object.entries(written)) {
    const tool = how.includes('here-string') || how.includes('-Value') ? 'PowerShell' : 'Bash';
    assert.equal(eyes(judge([...head(2, CSS), ...call(tool, { command }), ...call('Bash', { command: run })])).pass, true, how);
  }
  const look = `cat > /home/u/ego/round-02.mjs <<'EOF'\nconst page = (await taskSpace("x")).page("p1");\n${LOOK}\nEOF`;
  assert.equal(eyes(judge([...head(2, CSS), ...call('Bash', { command: look }), ...call('Bash', { command: run })])).pass, false, 'counter-example: a script that only looks');
});

test('1: the pre-tool guard of the ego host and profile runs for every form of the command (it shared the detector that missed 130 of 182 real calls)', async () => {
  const { gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-eyes-forms-'));
  const transcript = path.join(proj, 't.jsonl');
  fs.writeFileSync(transcript, [prompt(`ajusta el botón como en ${DESIGN}`)].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const run = (program, script) => gate({ tool_name: 'Bash', tool_input: { command: `${program} nodejs -e '${script}'` }, cwd: proj, session_id: 's-eyes-forms', transcript_path: transcript }, claude);
  const programs = [`"${EGO_EXE}"`, '"$EGO"', '& $exe', `cd web && "${EGO_EXE}"`, `timeout 60 "${EGO_EXE}"`];
  for (const p of programs) {
    assert.match(run(p, 'await page.goto("https://prod.example.com/")') || '', /neither the local dev server/, `an off host is refused: ${p}`);
    assert.match(run(p, 'await page.cdp("Network.clearBrowserCookies")') || '', /whole browser profile/, `the profile wipe is refused: ${p}`);
    assert.equal(run(p, `await page.goto("${DESIGN}")`), null, `the design link the user wrote passes: ${p}`);
  }
  fs.rmSync(proj, { recursive: true, force: true });
});

// ---- point 18 (2.0.20): the typecheck goes before the eyes ----
const GATE = call('Bash', { command: 'pnpm exec tsc --noEmit' });
const GATE_FAIL = call('Bash', { command: 'pnpm exec tsc --noEmit' }, "src/app/shared/button/button.component.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.", true);
const GATE_MISSING = call('Bash', { command: 'pnpm exec tsc --noEmit' }, 'tsc: command not found', true);

test('18: a look counts only after the project\'s typecheck or build passed since the last change; the message says it in those words', () => {
  const ok = judge([...bare(2, CSS, HTML), ...GATE, ...ego(MEASURE)]);
  assert.equal(eyes(ok).pass, true, 'gate, then the look');
  const before = judge([...bare(2, CSS, HTML), ...ego(MEASURE), ...GATE]);
  assert.equal(eyes(before).pass, false, 'the look came before the gate: it saw a version nobody had compiled');
  assert.equal(before.observed.eyes.beforeGate, true, 'the record says why the look did not count');
  assert.match(before.missing.find((m) => /browser|ego/i.test(m)), /typecheck or build first[^;]*cannot be seen until it is fixed/, 'the instruction, in its words');
  const failed = judge([...bare(2, CSS), ...GATE_FAIL, ...ego(MEASURE)]);
  assert.equal(eyes(failed).pass, false, 'a gate that failed is no gate that passed');
  const none = judge([...bare(2, CSS), ...ego(MEASURE)]);
  assert.equal(eyes(none).pass, false, 'no gate at all since the change');
  assert.equal(none.observed.eyes.beforeGate, true);
});

test('18: counter-examples — a gate the machine cannot run does not hold the look back; a gate after an earlier look and before a later one counts that later look', () => {
  assert.equal(eyes(judge([...bare(2, CSS), ...GATE_MISSING, ...ego(MEASURE)])).pass, true, 'the tool is not installed: not the code\'s failure');
  assert.equal(eyes(judge([...bare(2, CSS), ...ego(MEASURE), ...GATE, ...ego(CLICK)])).pass, true, 'the second look came after the gate');
});

// ---- point 15 (2.0.20): one ego space per task, closed by the agent when the task is complete; the returns to it are counted ----
const egoIn = (name, body) => call('Bash', { command: `ego-browser nodejs <<'EOF'\nconst task = await taskSpace("${name}");\nconst page = task.page("p1");\n${body}\nEOF` });
const FINISH = 'await task.finish({ keep: [] });';
const edit = (f) => call('Edit', { file_path: f });
const OPEN_TASK = '## Cierre · 2026-10-25 · T1\nResultado: parcial (falta el paso 3)\nEvidencia: observada ancho 40\nAprendido: ✔1 · ▶2 · 3 ← pasos';

test('15: the record keeps the spaces (opened, finished) and how many times the agent went back to ego after a change', () => {
  const g = judge([...head(2, CSS), ...egoIn('pedidos', MEASURE), ...edit(HTML), ...call('Bash', { command: 'pnpm exec tsc --noEmit' }), ...egoIn('pedidos', CLICK), ...edit(CSS), ...call('Bash', { command: 'pnpm exec tsc --noEmit' }), ...egoIn('pedidos', MEASURE + FINISH)]);
  assert.deepEqual(g.observed.eyes.spaces, [{ name: 'pedidos', opened: 3, finished: true }], 'one space, resumed, finished once');
  assert.equal(g.observed.eyes.returns, 3, 'each look that followed a change');
  assert.equal(eyes(g).pass, true);
});

test('15: a space closed while the task is open, or opened anew inside one task, is a finding (recorded, never a block); one closed at the end of a complete task is not', () => {
  const finished = [...head(2, CSS), ...egoIn('pedidos', MEASURE + FINISH)];
  const open = judge(finished, {}, OPEN_TASK);
  assert.ok(open.findings.some((f) => /ego space was closed while the task is still open/.test(f)), JSON.stringify(open.findings));
  assert.deepEqual(open.missing.filter((m) => /ego space/.test(m)), [], 'a look, never a block');
  assert.ok(!judge(finished).findings.some((f) => /ego space/.test(f)), 'counter-example: a complete task closes its space');
  const anew = judge([...head(2, CSS), ...egoIn('uno', MEASURE), ...egoIn('dos', MEASURE)]);
  assert.ok(anew.findings.some((f) => /ego was opened 2 times in one task \(uno, dos;/.test(f)), JSON.stringify(anew.findings));
  assert.ok(!judge([...head(2, CSS), ...egoIn('uno', MEASURE), ...egoIn('uno', CLICK)]).findings.some((f) => /ego was opened/.test(f)), 'counter-example: the same space resumed is one');
});

// ---- review of level 2: the gate rule in a turn that changed nothing, and with a real failure beside a missing tool ----
test('18 (review): a red typecheck beside a command the machine cannot run still holds the look back; the missing tool alone does not', () => {
  const redAndMissing = judge([...bare(2, CSS), ...GATE_FAIL, ...call('Bash', { command: 'pnpm exec eslint src' }, 'eslint: command not found', true), ...ego(MEASURE)]);
  assert.equal(eyes(redAndMissing).pass, false, 'a typecheck that really failed is not excused by a lint that could not run');
  assert.equal(eyes(judge([...bare(2, CSS), ...GATE_MISSING, ...ego(MEASURE)])).pass, true, 'counter-example: only a missing tool');
});

// ---- 2.0.20 point 29, from the first real task of checkpoint B: 151 of 434 real ego calls handed the script by stdin ----
const SCRIPT = 'const page = (await taskSpace("x")).page("p1");\nconsole.log(await page.evaluate(() => document.querySelector("b").getBoundingClientRect().width));';
const QEGO = '"' + EGO_EXE + '"';

test('29: a script written by Write and given to ego by stdin redirect (absolute path) counts as a measurement', () => {
  const file = 'C:/Users/u/AppData/Local/Temp/claude/proj/scratchpad/ego-run/round-50.mjs';
  const lines = [...head(2, CSS), ...call('Write', { file_path: file, content: SCRIPT }), ...call('Bash', { command: `${QEGO} nodejs < "${file}" 2>&1 | head -8` })];
  const g = judge(lines);
  assert.equal(g.observed.eyes.measures, 1, JSON.stringify(g.observed.eyes));
  assert.equal(eyes(g).pass, true);
});

test('29: the same by a relative path after cd, and by `cat file |`', () => {
  const dir = 'C:/Users/u/AppData/Local/Temp/claude/proj/scratchpad/ego-run';
  const write = call('Write', { file_path: `${dir}/round-51.mjs`, content: SCRIPT });
  const rel = judge([...head(2, CSS), ...write, ...call('Bash', { command: `cd "${dir}" && ${QEGO} nodejs < round-51.mjs 2>&1 | head -3` })]);
  assert.equal(rel.observed.eyes.measures, 1, 'relative to the folder the command went to');
  const cat = judge([...head(2, CSS), ...write, ...call('Bash', { command: `cat "${dir}/round-51.mjs" | ${QEGO} nodejs` })]);
  assert.equal(cat.observed.eyes.measures, 1, 'a script piped in');
});

test('29: a script rewritten under the same name is read as it stood at that call', () => {
  const file = 'C:/Users/u/scratch/ego-run/round.mjs';
  const look = 'await page.goto("http://localhost:4200/"); console.log(await page.snapshot());';
  const lines = [...head(2, CSS), ...call('Write', { file_path: file, content: look }), ...call('Bash', { command: `${QEGO} nodejs < "${file}"` }), ...call('Write', { file_path: file, content: SCRIPT })];
  assert.equal(judge(lines).observed.eyes.measures, 0, 'the measuring version was written after the call');
});

test('29: counter-examples — a redirect to a file nobody wrote, and a heredoc, are not a script read from the file', () => {
  const missing = judge([...head(2, CSS), ...call('Bash', { command: `${QEGO} nodejs < "C:/Users/u/never-written.mjs"` })]);
  assert.equal(missing.observed.eyes.measures, 0);
  const heredoc = judge([...head(2, CSS), ...ego(MEASURE)]);
  assert.equal(heredoc.observed.eyes.measures, 1, 'the heredoc form still counts from its own body');
});

test('29: references — "<element> (captura 1): parecido." and the other separators count; a word in prose does not', () => {
  const reply = CIERRE + '\n- **Turno sin iniciar (captura 1)**: parecido. Ahora muestra el reloj\n- título: igual, 26 px\n- pill: falta (la etiqueta de IA)\n- botón: igual — 28x28\n- cierre: parecido\nel botón es igual al diseño y falta el hover';
  const g = judge([...head(2, CSS), ...ego(MEASURE)], {}, reply);
  assert.equal(g.observed.eyes.references, 5, 'the five lines, not the prose');
});

// ---- review of level 3: the script ego reads is the one the agent edited, and a bare file name that two folders hold is not guessed ----
test('29 (review): an Edit of the script after its Write is applied before the call that reads it', () => {
  const file = 'C:/Users/u/AppData/Local/Temp/claude/proj/scratchpad/ego-run/round-7.mjs';
  const look = 'await page.goto("http://localhost:4200/"); console.log(await page.snapshot());';
  const lines = [...head(2, CSS), ...call('Write', { file_path: file, content: look }),
    ...call('Edit', { file_path: file, old_string: 'console.log(await page.snapshot());', new_string: 'console.log(await page.evaluate(() => document.querySelector("b").getBoundingClientRect().width));' }),
    ...call('Bash', { command: `${QEGO} nodejs < "${file}"` })];
  assert.equal(judge(lines).observed.eyes.measures, 1, 'the measurement the Edit added counts');
  const removed = [...head(2, CSS), ...call('Write', { file_path: file, content: SCRIPT }),
    ...call('Edit', { file_path: file, old_string: 'getBoundingClientRect()', new_string: 'toString()' }),
    ...call('Bash', { command: `${QEGO} nodejs < "${file}"` })];
  assert.equal(judge(removed).observed.eyes.measures, 0, 'counter-example: an Edit that took the measurement out is read too');
});

test('29 (review): a relative file name with no cd that two folders hold is ambiguous and credits nothing; one folder holding it is read', () => {
  const a = 'C:/Users/u/AppData/Local/Temp/claude/proj/scratchpad/ego-a/round.mjs', b = 'C:/Users/u/AppData/Local/Temp/claude/proj/scratchpad/ego-b/round.mjs';
  const look = 'await page.goto("http://localhost:4200/");';
  const ambiguous = [...head(2, CSS), ...call('Write', { file_path: a, content: look }), ...call('Write', { file_path: b, content: SCRIPT }), ...call('Bash', { command: `${QEGO} nodejs < round.mjs` })];
  assert.equal(judge(ambiguous).observed.eyes.measures, 0, 'two folders: not guessed');
  const single = [...head(2, CSS), ...call('Write', { file_path: b, content: SCRIPT }), ...call('Bash', { command: `${QEGO} nodejs < round.mjs` })];
  assert.equal(judge(single).observed.eyes.measures, 1, 'one folder: read');
});

test('2.0.20 point 1: the block hands the bare ego command while the PATH has it and the absolute path only while it lacks it; check says so', () => {
  const dirHome = fs.mkdtempSync(path.join(home, 'eh-'));
  const bin = path.join(dirHome, '.local', 'share', 'ego', 'active_version_dir');
  fs.mkdirSync(bin, { recursive: true });
  const exe = path.join(bin, process.platform === 'win32' ? 'ego-browser.exe' : 'ego-browser');
  fs.writeFileSync(exe, '');
  const off = { HOME: dirHome, USERPROFILE: dirHome, PATH: '' };
  assert.match(Eyes.egoCommand(off), /^".*ego-browser(\.exe)?"$/, 'off the PATH: the quoted absolute path');
  assert.ok(Eyes.egoOffPath(off));
  assert.match(Eyes.eyesGaps({}, 'ego', null, off)[0], /"[^"]*ego-browser(\.exe)? " ?nodejs|ego-browser(\.exe)?" nodejs/, 'the block carries the path');
  const on = { ...off, PATH: bin };
  assert.equal(Eyes.egoCommand(on), 'ego-browser', 'counter-example: on the PATH the bare command is handed, not the path');
  assert.equal(Eyes.egoOffPath(on), false);
  assert.match(Eyes.eyesGaps({}, 'ego', null, on)[0], /ego-browser nodejs \(read `ego-browser skill` first/);
  assert.match(Eyes.eyesGaps({}, 'ego', null, on)[0], /dev server's own compile output/);
});

test('2.0.20 point 1: the record says whether the agent read ego\'s own skill before its first script', () => {
  const run = (cmd) => ({ name: 'Bash', input: { command: cmd } });
  const script = run(`ego-browser nodejs <<'EOF'\nconst task = await taskSpace("t");\nconsole.log(1);\nEOF`);
  assert.equal(Eyes.observeEyes([run('ego-browser skill'), script]).skillRead, true, 'read first');
  assert.equal(Eyes.observeEyes([{ name: 'Skill', input: { skill: 'ego-browser' } }, script]).skillRead, true, 'the skill through the Skill tool');
  assert.equal(Eyes.observeEyes([run('"C:/Users/dev/.local/share/ego/active_version_dir/ego-browser.exe" skill'), script]).skillRead, true, 'by the absolute path');
  assert.equal(Eyes.observeEyes([script, run('ego-browser skill')]).skillRead, false, 'counter-example: read after the first script');
  assert.equal('skillRead' in Eyes.observeEyes([run('ls')]), false, 'no ego call: nothing to say');
});

test('2.0.20 point 15: the card records returns against steps, an ego run without its skill and a Cierre that guessed; none blocks', () => {
  const lines = [...head(2, CSS), ...egoIn('t', `${LOOK}\n${MEASURE}`)];
  const cierre = (aprendido, evid = 'observada ancho 40') => `## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: ${evid}\nAprendido: ${aprendido}`;
  const g = judge(lines, {}, cierre('✔1 modal · ✔2 tabla · ✔3 filtros ← x'));
  assert.ok(g.findings.some((f) => /revisited 1 time for 3 steps done \(recorded, not blocked\)/.test(f)), 'three steps, one return');
  assert.ok(g.findings.some((f) => /ego was run without reading its own skill/.test(f)), 'the skill was not read');
  assert.ok(g.findings.some((f) => /names a doubt or an assumption/.test(f)) === false, 'counter-example: no doubt written');
  assert.ok(judge(lines, {}, cierre('x ← y', 'observada ancho 40; asumí el color del hover')).findings.some((f) => /names a doubt or an assumption/.test(f)), 'a guess named in the Cierre');
  assert.equal(eyes(g)?.pass, true, 'recorded, never a block');
  const ok = judge([...head(2, CSS), ...call('Bash', { command: 'ego-browser skill' }), ...egoIn('t', `${LOOK}\n${MEASURE}`)], {}, cierre('✔1 modal ← x'));
  assert.ok(!ok.findings.some((f) => /without reading its own skill|revisited/.test(f)), 'skill read, one step, one return');
});
