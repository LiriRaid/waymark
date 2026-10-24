// Waymark 2.0.18 · point 11: the conformance suite. Every adapter passes the same list of behavioural cases (tests/conformance/cases.json), each
// run through the real hook scripts with the agent's own payloads and transcript (docs/adr/0039). The agents run side by side; the cases of one
// agent run one after the other. A new adapter passes the list or it does not install (`waymark.mjs adapter-new` runs this same suite on its draft).
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-conformance-')); // this process only; every world has its own WAYMARK_HOME
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = path.join(home, 'agents');
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_REVIEW_MODE = 'always';
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { makeWorld } = await import('./conformance/harness.mjs');
const { CASES } = await import('./conformance/cases.mjs');
const { cases } = JSON.parse(fs.readFileSync(path.join(HERE, 'conformance', 'cases.json'), 'utf8'));
const { loadAgents } = await import('./conformance/roster.mjs');
const agents = await loadAgents();
const draft = !!process.env.WAYMARK_CONFORMANCE_ONLY; // the suite run on a draft adapter (adapter-new): only that agent is judged

// A need is a capability the driver declares ("reply"), its negation ("!reply") or a value ("reminder:post"; "reminder:null").
export const applies = (caps, need) => {
  if (need.startsWith('!')) return !caps[need.slice(1)];
  const [k, v] = need.split(':');
  return v === undefined ? !!caps[k] : v.split('|').includes(String(caps[k] ?? null));
};

test('the case list and its implementations are the same set, with at least 30 cases and each need known', () => {
  assert.deepEqual(Object.keys(CASES).sort(), cases.map((c) => c.id).sort());
  assert.ok(cases.length >= 30, `${cases.length} cases`);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'no id twice');
  const known = new Set(['reply', 'readGuard', 'choice', 'ruleInCard', 'reminder', 'noOutput']);
  for (const c of cases) for (const n of c.needs) assert.ok(known.has(n.replace(/^!/, '').split(':')[0]), `${c.id}: unknown need ${n}`);
  for (const c of cases) assert.ok(c.area && c.behaviour, c.id);
});

test('every agent has a driver, and every case applies to at least one agent', () => {
  assert.ok(draft ? agents.length >= 1 : agents.length >= 8, `${agents.length} drivers`);
  if (!draft) for (const c of cases) assert.ok(agents.some((a) => c.needs.every((n) => applies(a.caps, n))), `${c.id} runs nowhere`); // a draft alone cannot carry every case
  for (const a of agents) assert.ok(cases.filter((c) => c.needs.every((n) => applies(a.caps, n))).length >= 20, `${a.key}: the cases that apply`);
});

describe('conformance', { concurrency: 4 }, () => {
  for (const agent of agents) {
    test(`${agent.name}: the cases that apply pass`, async (t) => {
      for (const c of cases.filter((x) => x.needs.every((n) => applies(agent.caps, n)))) {
        const w = makeWorld(agent);
        try {
          await t.test(`${agent.key} · ${c.id}`, async () => { await CASES[c.id](w); });
        } finally { w.cleanup(); }
      }
    });
  }
});
