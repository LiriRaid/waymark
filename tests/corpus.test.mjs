// Waymark 2.0.15 · point 1: regression corpus. Each tests/corpus/*.json is a real (or synthetic) turn, trimmed to what the
// testigos read, with what the routine must NOT block on. Run: node --test tests/corpus.test.mjs
// Case shape: { source, note, synthetic?, lines, expect: { absent: [regex…] } }
//   absent: no `missing` or `findings` entry of the verdict may match any of these
//   present: at least one entry must match each of these (a block the case must still raise)
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-corpus-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);

const dir = path.join(HERE, 'corpus');
const cases = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));

let n = 0;
// The verdict the stop hook would give: the corpus turn, the Cierre it ends with, the decisions its stretch holds.
// `gate` stands for the repo typecheck the hook re-runs when the agent ran none (green here: the case is about what the agent ran;
// a case with rerun: 'none' is a repo where the hook has none to run).
export const judgeCase = (c) => {
  const cwd = `/work/corpus-${++n}`;
  const turn = T.currentTurn(c.lines);
  const last = turn.texts.filter((t) => /Cierre/.test(t)).pop() || turn.texts.at(-1) || '';
  return cierreGaps(turn, last, T.sessionTools(c.lines), [turn.prompt], {
    ids: P.taskIds(cwd), decisions: P.decisionsIn(P.taskLines(c.lines)), pedido: P.pedidoItems(P.taskLines(c.lines)), outside: true, cwd, blocked: !!c.blocked, // blocked: the reply that follows a block, where an exception line counts
    packed: 1, rerun: c.rerun === 'none' ? () => null : () => ({ cmd: 'typecheck', ok: true, s: 0 }), // rerun: 'none' is a repo whose typecheck the hook cannot run
  });
};

test('corpus: every case has a source, a note and an expectation', () => {
  assert.ok(cases.length > 0);
  for (const c of cases) {
    assert.ok(c.source && c.note && c.lines?.length && Array.isArray(c.expect?.absent), `${c.file} is incomplete`);
  }
});

for (const c of cases) {
  test(`corpus ${c.file}: ${c.note}`, () => {
    const g = judgeCase(c);
    const said = [...(g.missing || []), ...(g.findings || [])];
    for (const re of c.expect.absent) assert.ok(!said.some((s) => new RegExp(re, 'i').test(s)), `${c.source}: /${re}/ in\n  ${said.join('\n  ')}`);
    for (const re of c.expect.present || []) assert.ok(said.some((s) => new RegExp(re, 'i').test(s)), `${c.source}: /${re}/ expected in\n  ${said.join('\n  ')}`);
  });
}

// Synthetic cases, one per shape of command a gate-looking run can take. Each ends with a helper or a clean-copy run that
// fails AFTER the last change; none is the task's own gate, so none may make the verdict say a gate or a test failed.
let ids = 0;
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: '2026-10-15T10:00:00Z', message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const run = (name, input, { error = false, out = 'ok' } = {}) => {
  const id = `s${++ids}`;
  return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }];
};
const sh = (command, opts) => run('Bash', { command }, opts);
const ps = (command, opts) => run('PowerShell', { command }, opts);
const answered = { type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'A' }, { label: 'B' }] }], answers: { '¿Cómo?': 'A' } } };
const FILE = '/work/proj/src/orders.service.mjs';
const head = () => [prompt('agrega reintentos'), say('Waymark → L1 · dept-backend · skills: ninguna'), ...run('Skill', { skill: 'dept-backend' }), ...run('Read', { file_path: '/skills/dept-backend/procedures.md' }),
  ...run('AskUserQuestion', { questions: [] }), answered, ...run('Edit', { file_path: FILE }), ...sh('node --check src/orders.service.mjs')];
const done = [say('## Cierre · 2026-10-15 · T9\nResultado: hecho\nEvidencia: observada node --check sin errores\nAprendido: reintentos con backoff ← timeouts')];
const SYNTHETIC = {
  'powershell-T-junction': ps(String.raw`$T = "C:\Users\u\AppData\Local\Temp\claude\proj\wt-clean"; New-Item -ItemType Junction -Path "$T\node_modules" -Target "C:\proj\node_modules" | Out-Null; Push-Location $T; pnpm exec eslint src/a.ts; Pop-Location`, { out: 'exit 3', error: true }),
  'powershell-join-path': ps('$w = Join-Path $env:TEMP "wm-clean"; git worktree add -q --detach $w HEAD; Push-Location $w; npm test; Pop-Location; git worktree remove --force $w', { out: 'npm ERR!', error: true }),
  'helper-script-after-last-change': sh('node scripts/tmp-inspect.mjs src/orders.service.mjs', { out: 'TypeError: x is not a function', error: true }),
  'and-and-pipe': sh('cat src/orders.service.mjs | grep -c retry && node -e "process.exit(1)"', { out: '', error: true }),
  'semicolon-chain': sh('ls src; node scripts/missing.mjs; echo done', { out: 'Cannot find module', error: true }),
  'heredoc-helper': sh("python - <<'EOF'\nimport sys\nsys.exit(2)\nEOF", { out: 'exit 2', error: true }),
  'clean-copy-bash': sh('T=/tmp/wt-clean && git worktree add -q --detach "$T" HEAD && cd "$T" && npm test; git worktree remove --force "$T"', { out: '1 failing', error: true }),
};
for (const [name, tail] of Object.entries(SYNTHETIC)) {
  test(`corpus synthetic ${name}: a failing run that is not the task's gate does not say a gate failed`, () => {
    const c = { lines: [...head(), ...tail, ...done] };
    const g = judgeCase(c);
    const said = [...(g.missing || []), ...(g.findings || [])];
    assert.ok(!said.some((s) => /gate after the last code change failed|test after the last code change failed|command after the last change failed/.test(s)), said.join('\n'));
    assert.equal(g.steps.find((s) => s.id === 'gate')?.pass, true, "Verificar is the task's own gate, whatever the helper exited with");
  });
}
