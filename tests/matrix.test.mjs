// Waymark 2.0.16 · point 12: the per-agent capability matrix is generated from agents.json and the adapters, and the copies in
// README.md and INSTALL.md are the generated text. Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MX = await import(`file://${ROOT}/skills/waymark/scripts/matrix.mjs`);
const rows = await MX.agentMatrix();
const row = (key) => rows.find((r) => r.key === key);

test('events: an agent with all five, one without PreToolUse and an agent with no adapter', () => {
  assert.deepEqual(Object.values(MX.eventsOf({ adapter: 'x', hooks: { format: 'plugin' } })), [true, true, true, true, true], 'a plugin (OpenCode) maps all five');
  const full = MX.eventsOf({ adapter: 'x', hooks: { format: 'nested', extra: ['PostToolUse'] } });
  assert.deepEqual(full, { SessionStart: true, UserPromptSubmit: true, PreToolUse: true, PostToolUse: true, Stop: true });
  const noPre = MX.eventsOf({ adapter: 'x', hooks: { format: 'flat', events: { SessionStart: 's', UserPromptSubmit: 'u', Stop: 'e' } } });
  assert.deepEqual(noPre, { SessionStart: true, UserPromptSubmit: true, PreToolUse: false, PostToolUse: false, Stop: true });
  const generic = MX.eventsOf({ adapter: null, hooks: { format: 'flat' } });
  assert.deepEqual(Object.values(generic), [false, false, false, false, false], 'an agent with no adapter has none');
});

test('matrix: Claude Code enforces everything including reads; the others leave reads advisory; unknown agents are named as having no adapter', () => {
  assert.deepEqual(Object.values(row('claude').cells), ['enforced', 'enforced', 'enforced', 'enforced', 'enforced', 'enforced']);
  assert.equal(row('codex').cells.reads, 'advisory', 'Codex reads through its shell');
  assert.equal(row('copilot').cells.brake, 'advisory', 'no way to stop a prompt there: the brake is a line in the reminder');
  assert.equal(row('windsurf').adapter, null);
  assert.equal(row('windsurf').cells, null);
  assert.match(MX.matrixMarkdown(rows), /no adapter yet[^\n]*Windsurf/);
});

test('matrix: a table row for every agent that has an adapter, none for the others', () => {
  const md = MX.matrixMarkdown(rows);
  for (const r of rows.filter((x) => x.adapter)) assert.match(md, new RegExp(`^\\| ${r.name.replace(/[()]/g, '\\$&')} \\|`, 'm'), r.name);
  assert.doesNotMatch(md, /^\| Windsurf \|/m);
});

test('README.md and INSTALL.md carry exactly the generated matrix (run: node skills/waymark/scripts/matrix.mjs --write)', () => {
  const md = MX.matrixMarkdown(rows);
  for (const f of ['README.md', 'INSTALL.md']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(MX.between(text), md, `${f} differs from the generated matrix`);
  }
});
