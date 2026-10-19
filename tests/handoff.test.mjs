// Waymark 2.0.18 · point 11: a task started under one agent's payloads resumes under another's, in the same project (docs/adr/0039). The project's
// memory, the records, the open task, the precedent and the chain are what the next agent finds, whoever wrote them. Each agent hands over to the
// next in a ring, so every adapter is once the one that wrote and once the one that continues.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const { makeWorld, day, SCRIPTS } = await import('./conformance/harness.mjs');
const { routed, work, CIERRE, W } = await import('./conformance/cases.mjs');
const { loadAgents } = await import('./conformance/roster.mjs');
const agents = await loadAgents();
const KEYS = agents.map((a) => a.key);
const verify = (w) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'verify'], { cwd: w.cwd, env: w.env, encoding: 'utf8' });

describe('handoff', { concurrency: true }, () => {
  agents.forEach((from, i) => {
    const to = agents[(i + 1) % agents.length];
    test(`${from.name} → ${to.name}: the next agent finds the memory, the records, the open task and the precedent, and the chain stays intact`, async () => {
      const a = makeWorld(from);
      let b;
      try {
        // under the first agent: one task closed, then a second that never ends (quota, a crash)
        await routed(a);
        await work(a);
        await a.stop(CIERRE());
        assert.deepEqual(a.records().map((r) => [r.id, r.agent]), [[`${day} · T1`, from.key]]);
        await a.prompt('documenta el límite de reintentos del servicio de pedidos');

        // under the second agent, in the same project, a new session
        b = makeWorld(to, { from: a });
        assert.equal(b.cwd, a.cwd);
        assert.notEqual(b.session, a.session);
        const card = await b.start();
        assert.match(card.context, /Project memory/, 'the project memory is where the first agent left it');
        assert.match(card.context, new RegExp(`${day} · T1`), 'the card names the last closed task, written by the other agent');
        const tasks = fs.readFileSync(path.join(b.cwd, '.waymark', 'tasks.md'), 'utf8'); // where the card sends the next agent first
        assert.match(tasks, new RegExp(`started in ${from.key}${from.caps.prompt === false ? '' : '[^\\n]*documenta el límite'}`), 'tasks.md names the task the first agent never closed, and which agent started it (and what was asked, where the agent carries the prompt)');

        const reminder = await b.prompt('agrega reintentos al servicio de pedidos de nuevo');
        const text = to.caps.reminder === 'post' ? (await b.tool('shell', { command: 'ls src' })).context : reminder.context;
        if (to.caps.reminder) {
          assert.match(text, new RegExp(`ID: new ${day} · T2; follow-up ${day} · T1b`), 'the next number follows the last record, whichever agent wrote it (an open task has no number until it closes)');
          if (to.caps.prompt !== false && from.caps.prompt !== false) assert.match(text, new RegExp(`Precedent ${day} · T1`), 'the earlier task whose ask resembles this one is handed over, whichever agent recorded it');
        }

        // the second agent finishes its own task: one chain, two agents
        await b.say(`Waymark → L2 · dept-backend · skills: code-review`);
        await b.skill('dept-backend');
        await work(b);
        await b.stop(CIERRE().replace('T1', 'T2'));
        const rows = b.records().map((r) => [r.id, r.agent]);
        assert.deepEqual(rows[0], [`${day} · T1`, from.key]);
        assert.equal(rows.at(-1)[1], to.key, JSON.stringify(rows));
        const v = verify(b);
        assert.equal(v.status, 0, v.stdout);
        assert.match(v.stdout, /chain: intact · 2 records/, 'the chain holds across the two agents');
      } finally { a.cleanup(); }
    });
  });
});

test('the ring covers every agent as the one that writes and as the one that continues', () => {
  const pairs = agents.map((from, i) => [from.key, agents[(i + 1) % agents.length].key]);
  assert.deepEqual(new Set(pairs.map((p) => p[0])), new Set(KEYS));
  assert.deepEqual(new Set(pairs.map((p) => p[1])), new Set(KEYS));
});
