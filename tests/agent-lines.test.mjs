// Waymark 2.0.15 · point 7: what the adapters' toLines share lives in agents/lines.mjs. Run: node --test tests/agent-lines.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const { asQuestion, plainQuestions, answerLine, chatAnswer } = await import(`file://${SCRIPTS}/agents/lines.mjs`);

test('asQuestion: the first of the text keys that has a value, options from the first options key that has any', () => {
  assert.deepEqual(asQuestion({ question: ' ¿A? ', options: [{ label: 'x' }, 'y'] }), { question: '¿A?', options: [{ label: 'x' }, { label: 'y' }] });
  assert.deepEqual(asQuestion({ header: 'H', options: [] }, { text: ['question', 'header'] }), { question: 'H', options: [] });
  assert.deepEqual(asQuestion({ title: 'T' }, { text: ['question', 'title'] }), { question: 'T', options: [] });
});

test('asQuestion: a bare string is the question only when the adapter says so (plain), else empty', () => {
  assert.equal(asQuestion('¿B?', { plain: true }).question, '¿B?');
  assert.equal(asQuestion('¿B?').question, '');
  assert.equal(asQuestion(null).question, '');
});

test('asQuestion: Copilot choices and Antigravity capitalized keys', () => {
  assert.deepEqual(asQuestion({ prompt: 'P', choices: ['a', { label: 'b' }] }, { text: ['question', 'prompt'], options: ['choices', 'options'], plain: true }).options, [{ label: 'a' }, { label: 'b' }]);
  assert.deepEqual(asQuestion({ Question: 'Q', Options: ['z'] }, { text: ['question', 'Question'], options: ['options', 'Options', 'choices'] }), { question: 'Q', options: [{ label: 'z' }] });
});

test('plainQuestions drops what the adapter added (an id) and keeps question and options', () => {
  assert.deepEqual(plainQuestions([{ id: 'i1', question: 'q', options: [{ label: 'a' }] }]), [{ question: 'q', options: [{ label: 'a' }] }]);
});

test('answerLine: the user line that answers a choice-window call', () => {
  assert.deepEqual(answerLine('t1', 'c1', 'answered', { questions: [], answers: { q: 'a' } }), {
    type: 'user', timestamp: 't1',
    message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'answered' }] },
    toolUseResult: { questions: [], answers: { q: 'a' } },
  });
  assert.equal(answerLine('t', 'c', 'answered', {}, { version: '0.1' }).version, '0.1');
});

test('chatAnswer: a question asked in the chat, answered by the user\'s reply', () => {
  assert.deepEqual(chatAnswer(['¿Sí?', '¿No?'], 'sí'), {
    source: 'chat',
    questions: [{ question: '¿Sí?', options: [] }, { question: '¿No?', options: [] }],
    answers: { '¿Sí?': 'sí', '¿No?': 'sí' },
  });
});

test('no adapter builds those lines by hand any more', () => {
  const dir = path.join(SCRIPTS, 'agents');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs') && n !== 'lines.mjs')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/label: String\(o\?\.label \?\? o\)/.test(src), `${f} maps options by hand`);
    assert.ok(!/toolUseResult: \{/.test(src), `${f} builds toolUseResult by hand`);
  }
});
