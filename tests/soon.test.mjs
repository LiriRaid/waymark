// Waymark 2.0.19 · point 12 (ADR 0048): an agent that cannot technically carry the chain is "coming soon" with its reason, outside the count of criterion 9.1,
// and the README lists the checks only the user can run. No UI in this change: there is no CSS/HTML case. Run: node --test tests/soon.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const AGENTS = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'agents', 'agents.json'), 'utf8')).agents;
const MX = await import(`file://${SCRIPTS}/matrix.mjs`);
const SC = await import(`file://${SCRIPTS}/scorecard.mjs`);

test('12: Windsurf and Crush are coming soon, each with the technical reason, and no other agent is', () => {
  const soon = AGENTS.filter((a) => a.soon);
  assert.deepEqual(soon.map((a) => a.key).sort(), ['crush', 'windsurf']);
  for (const a of soon) { assert.equal(a.adapter, null, `${a.key} has no adapter`); assert.ok(a.soon.length > 30, `${a.key}: a reason, not a label`); }
  assert.match(AGENTS.find((a) => a.key === 'windsurf').soon, /session start|context/i);
  assert.match(AGENTS.find((a) => a.key === 'crush').soon, /one event|PreToolUse/i);
});

test('12: the matrix says coming soon with the reason; the README and INSTALL carry it', async () => {
  const text = MX.matrixMarkdown(await MX.agentMatrix());
  assert.match(text, /no adapter yet[^\n]*Windsurf \([^)]*(session start|context)[^)]*\)/);
  assert.match(text, /Crush \([^)]*(one event|PreToolUse)[^)]*\)/);
  assert.match(text, /[Cc]oming soon/);
  for (const f of ['README.md', 'INSTALL.md']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /[Cc]oming soon[^\n]*Windsurf/, f);
});

test('12: criterion 9.1 counts the agents that can have an adapter and leaves the coming-soon ones apart', () => {
  const list = [{ key: 'a', adapter: 'a' }, { key: 'b', adapter: 'b' }, { key: 'c', adapter: null, soon: 'one event only' }];
  assert.equal(SC.adapterShare(list), 1, 'two of the two that can');
  assert.equal(SC.adapterShare([...list, { key: 'd', adapter: null }]), 2 / 3, 'counter-example: an agent with no adapter and no reason still counts against');
  assert.equal(SC.adapterShare([{ key: 'c', adapter: null, soon: 'x' }]), null, 'nothing that can: no share, never 100 %');
  assert.equal(SC.adapterShare(AGENTS), 1, 'the real list');
  assert.equal(SC.adapterShare([{ key: 'a', adapter: 'a' }, { key: 'c', adapter: 'c', soon: 'stale' }, { key: 'd', adapter: null }]), 2 / 3, 'counter-example: a coming-soon agent that has an adapter counts again');
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'scorecard.json'), 'utf8'));
  const check = card.criteria.flatMap((c) => c.checks).find((c) => c.id === '9.1');
  assert.match(check.what, /technically/);
  assert.equal(check.threshold, 1, 'the threshold is the same: only what is counted changed');
});

test('12: check and install-hooks tell a coming-soon agent apart: its reason, no adapter to draft', async () => {
  const { adapterless } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const windsurf = AGENTS.find((a) => a.key === 'windsurf');
  const only = adapterless([{ ...windsurf, dir: '~/.codeium/windsurf' }]);
  assert.match(only, /Windsurf/);
  assert.match(only, /coming soon/i);
  assert.doesNotMatch(only, /adapter-new|Add an agent/, 'nothing to draft: it cannot carry the chain yet');
  const mixed = adapterless([{ ...windsurf, dir: 'w' }, { name: '.foo', unknown: true, signals: ['AGENTS.md'] }]);
  assert.match(mixed, /coming soon/i);
  assert.match(mixed, /\.foo \(unknown/);
  assert.match(mixed, /Add an agent/, 'counter-example: an unknown agent still gets the procedure');
  assert.equal((mixed.match(/agents: /g) || []).length, 1, 'one item, one prefix');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'install-hooks.mjs'), '--agent', 'crush'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /coming soon/i);
});

test('12: the ADR records the decision of the cut turn and of the coming-soon agents', () => {
  assert.ok(fs.readdirSync(path.join(ROOT, 'docs', 'adr')).some((f) => /^0048-/.test(f)));
});
