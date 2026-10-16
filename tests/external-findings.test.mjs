// What the real runs in other repositories showed (docs/adr/0027, 2.0.17 point 4), as specs: a change that only touches comments
// owes no gate; a gate whose tool is not installed is not a failed gate and not "nothing ran"; a run that was refused is not a run.
// The runs themselves are tests/external/run-agent.mjs; their transcripts, trimmed, are tests/corpus/external-*.json.
// Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const { commentOnlyEdit } = await import(`file://${SCRIPTS}/lib/comments.mjs`);
const { runGate, onPath } = await import(`file://${SCRIPTS}/testigos.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);

const edit = (file, old_string, new_string) => ({ name: 'Edit', input: { file_path: file, old_string, new_string } });

test('comments: a doc comment, an inline note and KDoc lines are comment-only edits, in each family of languages', () => {
  assert.equal(commentOnlyEdit(edit('src/exit_codes.rs', 'pub fn merge(a: u8) {', '/// Merges the codes.\npub fn merge(a: u8) {')), true, 'Rust: the line the edit repeats is context');
  assert.equal(commentOnlyEdit(edit('app/Models/User.php', "'password' => 'hashed',", "// hashed on save\n'password' => 'hashed',")), true, 'PHP //');
  assert.equal(commentOnlyEdit(edit('GrowZone.kt', ' * Zones.\n */\nfun zone() {', ' * Zones.\n * @param lat latitude\n * @return the zone\n */\nfun zone() {')), true, 'KDoc');
  assert.equal(commentOnlyEdit(edit('list.c', 'void vListInitialise( List_t * const pxList )', '/* Initialises an empty list. */\nvoid vListInitialise( List_t * const pxList )')), true, 'C block comment');
  assert.equal(commentOnlyEdit(edit('imblearn/base.py', 'def f():', '# why\ndef f():')), true, 'Python #');
  assert.equal(commentOnlyEdit({ name: 'MultiEdit', input: { file_path: 'a.go', edits: [{ old_string: '// a', new_string: '// b' }, { old_string: 'x', new_string: '// y\nx' }] } }), true, 'MultiEdit: every edit');
});

test('comments: anything that may be code, a directive or unknown is a code change', () => {
  assert.equal(commentOnlyEdit(edit('a.ts', 'const a = 1;', 'const a = 2;')), false, 'a code line changed');
  assert.equal(commentOnlyEdit(edit('a.ts', 'const a = 1;', 'const a = 1; // one')), false, 'a trailing comment rewrites a code line');
  assert.equal(commentOnlyEdit(edit('a.ts', 'let x = f();', '// @ts-ignore\nlet x = f();')), false, 'a directive to the typecheck');
  assert.equal(commentOnlyEdit(edit('a.js', 'a();', '// eslint-disable-next-line\na();')), false, 'a directive to the linter');
  assert.equal(commentOnlyEdit(edit('a.py', 'import x', '# type: ignore\nimport x')), false);
  assert.equal(commentOnlyEdit(edit('run.sh', 'echo hi', '#!/bin/sh\necho hi')), false, 'a shebang is not a comment');
  assert.equal(commentOnlyEdit({ name: 'Write', input: { file_path: 'a.rs', content: '// all comment' } }), false, 'a whole-file write is not read');
  assert.equal(commentOnlyEdit(edit('notes.xyz', 'a', '// b')), false, 'a language it does not know');
  assert.equal(commentOnlyEdit(edit('a.ts', 'a', 'a')), false, 'no change');
});

test('gate: a tool that is not installed is unavailable, not a failed gate', () => {
  assert.equal(onPath('node'), true);
  const r = runGate({ cmd: 'wm-no-such-tool-xyz test --all', from: 'memory.md' }, os.tmpdir(), 5000);
  assert.deepEqual([r.ok, r.unavailable, r.timedOut], [false, 'wm-no-such-tool-xyz', false]);
  assert.equal(runGate({ cmd: 'node -e "process.exit(0)"', from: 'test' }, os.tmpdir(), 15000).ok, true, 'node is always here');
});

// A turn: a code edit, then a gate run with the given result, then the Cierre. The hook has no typecheck of its own to run.
let n = 0;
const turnOf = (gateResult, cierreExtra = '', blocked = false, resultado = 'hecho') => {
  const run = (name, input, out = 'ok', error = false) => { const id = `t${++n}`; return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
  const q = '¿Cómo?';
  const lines = [
    { type: 'user', uuid: `p${n}`, timestamp: '2026-10-16T10:00:00Z', message: { role: 'user', content: 'cambia el servicio' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-backend · skills: ninguna' }] } },
    ...run('Skill', { skill: 'dept-backend', args: 'L1' }), ...run('Read', { file_path: '/skills/dept-backend/procedures.md' }),
    ...run('AskUserQuestion', { questions: [] }),
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question: q, options: [{ label: 'A' }, { label: 'B' }] }], answers: { [q]: 'A' } } },
    ...run('Edit', { file_path: '/work/svc/src/orders.rs', old_string: 'let a = 1;', new_string: 'let a = 2;' }),
    ...(gateResult ? run('Bash', { command: 'cargo clippy --all-targets' }, gateResult, true) : []),
  ];
  const turn = T.currentTurn(lines);
  const cierre = `## Cierre · 2026-10-16 · T1\nResultado: ${resultado}\nDecisión: elegida A · descartada B\nSub-decisiones: ninguna\nEvidencia: inferida del diff (check: cargo clippy)\nAprendido: cambio ← pedido; siguiente: nada.${cierreExtra}`;
  return cierreGaps(turn, cierre, T.sessionTools(lines), [turn.prompt], { ids: P.taskIds('/work/svc'), decisions: [{ question: q, chosen: 'A', discarded: ['B'] }], outside: true, cwd: '/work/svc', packed: 1, rerun: () => null, blocked });
};
const said = (g) => [...(g?.missing || []), ...(g?.findings || [])].join('\n');

test('gate: cargo missing here is "could not run", with the way out; "no comprobado (<why>)" accepts it as an exception', () => {
  const missing = turnOf('Exit code 127\n/usr/bin/bash: line 1: cargo: command not found');
  assert.match(said(missing), /the gate could not run here \(cargo clippy --all-targets; cargo is not available or the run was refused\): write "no comprobado/);
  assert.doesNotMatch(said(missing), /the repo has no typecheck the hook can run/);
  const excused = turnOf('Exit code 127\n/usr/bin/bash: line 1: cargo: command not found', '\nno comprobado (cargo no está instalado aquí; se corre donde esté)', true); // the reply that follows the block
  assert.doesNotMatch(said(excused), /could not run here|no typecheck, lint or build ran/);
  assert.equal(excused.steps.find((s) => s.id === 'gate').exception ? true : excused.steps.find((s) => s.id === 'gate').pass, true, 'the step passes, with the exception recorded');
});

test('gate: after the block, "Resultado: parcial (<why>)" already says the gate did not run: it is the exception', () => {
  const partial = turnOf('Exit code 127\n/usr/bin/bash: line 1: cargo: command not found', '', true, 'parcial (cargo no está instalado aquí; falta clippy)');
  assert.doesNotMatch(said(partial), /could not run here/);
  assert.match(partial.steps.find((x) => x.id === 'gate').exception || '', /Resultado: parcial \(cargo no está instalado/);
  const first = turnOf('Exit code 127\n/usr/bin/bash: line 1: cargo: command not found', '', false, 'parcial (cargo no está instalado aquí)');
  assert.match(said(first), /could not run here/, 'before the block a partial result written in advance cancels nothing');
});

test('gate: a run the permission system refused is not a gate run', () => {
  const refused = turnOf('Permission to use Bash has been denied. IMPORTANT: You *may* attempt to accomplish this action using other tools');
  assert.match(said(refused), /the gate could not run here \(cargo clippy/);
  const stopped = turnOf('PreToolUse:Bash hook error: Waymark: L1 decision gate');
  assert.match(said(stopped), /the gate could not run here/);
  assert.match(said(turnOf(null)), /no typecheck, lint or build ran after the last code change/, 'nothing tried at all keeps the old block');
});

test('classifier: CMake, CTest, Make and the Gradle tasks of an Android project are gates, builds and tests', async () => {
  const { shellRuns } = await import(`file://${SCRIPTS}/runs.mjs`);
  const kind = (cmd) => { const r = shellRuns(cmd).at(-1) || {}; return r.build ? 'build' : r.test ? 'test' : r.gate ? 'gate' : 'none'; };
  for (const [cmd, want] of [['cmake --build build', 'build'], ['ctest --test-dir build --output-on-failure', 'test'], ['make', 'build'], ['make all', 'build'], ['make test', 'test'], ['make clean', 'none'],
    ['./gradlew assembleDebug', 'build'], ['./gradlew testDebugUnitTest', 'test'], ['./gradlew lint', 'gate'], ['./gradlew compileDebugKotlin', 'gate'], ['cmake -S . -B build', 'none']]) assert.equal(kind(cmd), want, cmd);
});
