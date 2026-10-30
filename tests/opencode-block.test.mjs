// Waymark 2.0.20 · point 4: in OpenCode the hook's block is sent back as a user message; read as the user's prompt it opened a new turn whose last reply had no Cierre.
// The block is part of the turn it stops (as in Claude Code, where it is no user line). Synthetic copy of the real session shape (ADR 0042). Run: node --test tests/opencode-block.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const { toLines } = await import(`file://${SCRIPTS}/agents/opencode.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);

const T = (n) => ({ created: Date.parse('2026-10-29T10:00:00Z') + n * 1000 });
const user = (id, text, n) => ({ info: { id, role: 'user', time: T(n) }, parts: [{ type: 'text', text }] });
const reply = (id, text, n) => ({ info: { id, role: 'assistant', time: T(n) }, parts: [{ type: 'text', text }] });
const CIERRE = '## Cierre · 2026-10-29 · T1\nResultado: hecho\nEvidencia: observada ok\nAprendido: x ← y';
const BLOCK = 'Waymark: this L2 turn changed files and is missing: 1) no review ran. Do what is missing (or correct the field), then reply in one or two lines with what you did.';

test('4: the block sent back as a message is no new prompt: the turn keeps its Cierre and the reply that follows it', () => {
  const rows = [user('u1', 'agrega el filtro por fecha', 0), reply('a1', `Waymark → L2 · dept-backend\n${CIERRE}`, 1), user('u2', BLOCK, 2), reply('a2', 'Corrí la revisión y apliqué los hallazgos.', 3)];
  const lines = toLines(rows, '/work/proj');
  assert.equal(lines.filter((l) => l.type === 'user' && typeof l.message.content === 'string').length, 1, 'one prompt: the block opens no turn');
  const turn = currentTurn(lines);
  assert.match(turn.prompt, /agrega el filtro por fecha/, 'the turn is still the user\'s ask');
  assert.ok(turn.texts.some((t) => /## Cierre · 2026-10-29 · T1/.test(t)), 'the Cierre written before the block is in the turn');
  assert.ok(turn.texts.some((t) => /apliqué los hallazgos/.test(t)), 'and so is the reply after it');
});

test('4: counter-examples — a user message that only mentions Waymark, and a real second prompt, still open their turn', () => {
  const lines = toLines([user('u1', 'agrega el filtro', 0), reply('a1', CIERRE, 1), user('u2', 'Waymark es lento, ¿por qué?', 2), reply('a2', 'Porque…', 3)], '/work/proj');
  assert.equal(lines.filter((l) => l.type === 'user' && typeof l.message.content === 'string').length, 2, 'a question about Waymark is the user\'s');
  assert.match(currentTurn(lines).prompt, /Waymark es lento/);
  const two = toLines([user('u1', 'agrega el filtro', 0), reply('a1', CIERRE, 1), user('u2', 'ahora también por cliente', 2)], '/work/proj');
  assert.match(currentTurn(two).prompt, /ahora también por cliente/);
});
