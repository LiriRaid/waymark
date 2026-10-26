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
  assert.deepEqual(Object.keys(o).sort(), ['afterLastChange', 'calls', 'measures', 'provider', 'references'].sort());
  assert.ok(!JSON.stringify(o).includes('localhost'), 'no URL, no text of the page');
});

test('8: ego-browser counts as the browser the task tried', () => {
  const g = judge([...head(2, CSS), ...ego(LOOK)]);
  assert.ok(g.observed.browser.tried.length >= 1);
});
