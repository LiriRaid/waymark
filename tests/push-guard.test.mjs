// Waymark 2.0.20 · point 21: nothing leaves the machine from a turn that is not the user's to publish. A `git push` (with a tag, a force) and a `gh release` are denied when
// the project's Conventions say "Push: the user", and on a turn routed Q that continues no task. Synthetic copies of the real commands (ADR 0042).
// Run: node --test tests/push-guard.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-push-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { checkPush, gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);

const USER = '## Conventions specific to this project\n- Push: el usuario (2026-10-27: «Sí + línea en waymark»)\n';
const AGENT = '## Conventions specific to this project\n- Push: the agent, when asked\n';
const PUSHES = ['git push', 'git push origin develop', 'git push origin develop v2.0.19', 'git push --tags', 'git push --force-with-lease origin develop', 'git -C ../api push',
  'git add -A && git commit -m "x" && git push', 'cd web && git push origin HEAD', 'GIT_SSH_COMMAND="ssh -i k" git push', 'git push --delete origin old', 'gh release create v2.0.20 --notes x', 'gh release upload v2.0.20 a.zip'];
const NOT = ['git status', 'git log --oneline -3', 'git commit -m "fix: stop calling git push in the hook"', 'echo "git push origin main"', 'git config --get remote.origin.push', 'git pull --rebase', 'git stash push -m x',
  'gh release view v2.0.19', 'node waymark.mjs notes push', 'grep -rn "git push" docs', "cat <<'EOF'\ngit push origin main\nEOF"];

test('21: with "Push: the user" every form of git push and gh release is denied, naming the rule; a command that only mentions the words is not', () => {
  for (const command of PUSHES) assert.match(checkPush(command, USER) || '', /Push: el usuario[^]*publishing is the user's/, command);
  for (const command of NOT) assert.equal(checkPush(command, USER), null, command);
});

test('21: without the line, or with a line that gives the push to the agent, a push in a routed task goes through; on a turn routed Q it never does', () => {
  for (const memory of ['', AGENT, '## Conventions\n- PRs: el usuario\n']) for (const command of PUSHES) assert.equal(checkPush(command, memory, false), null, `${command} (${memory.slice(0, 20)})`);
  for (const command of PUSHES) assert.match(checkPush(command, AGENT, true) || '', /question \(Q\) and a question never publishes/, command);
  assert.equal(checkPush('git status', '', true), null, 'counter-example: a question may read');
  assert.match(checkPush('git push', `${USER}`, true) || '', /Conventions say/, 'the user\'s line is named first');
});

// ---- through the pre-tool gate: the memory of the session's project, the route of the turn ----
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-push-proj-'));
spawnSync('git', ['init', '-q'], { cwd: proj });
fs.mkdirSync(path.join(proj, '.waymark'));
let n = 0;
const at = () => new Date().toISOString();
const line = (role, content) => ({ type: role, uuid: `u${++n}`, timestamp: at(), message: role === 'user' ? { role, content } : { content } });
const run = (memory, command, texts) => {
  fs.writeFileSync(path.join(proj, '.waymark', 'memory.md'), memory);
  const transcript = path.join(proj, `t${++n}.jsonl`);
  fs.writeFileSync(transcript, [line('user', 'sube lo que falta'), ...texts.map((t) => line('assistant', [{ type: 'text', text: t }]))].map((l) => JSON.stringify(l)).join('\n') + '\n');
  return gate({ tool_name: 'Bash', tool_input: { command }, cwd: proj, session_id: `s-push-${n}`, transcript_path: transcript }, claude);
};
test('21: through the gate, the project\'s own Conventions line decides, and a Q turn is denied even where the user gave the agent the push', () => {
  assert.match(run(USER, 'git push origin develop', ['Waymark → L1 · dept-devops']) || '', /publishing is the user's/);
  assert.match(run(AGENT, 'git push origin develop', ['Waymark → Q · dept-devops']) || '', /a question never publishes/);
  assert.equal(run(AGENT, 'git push origin develop', ['Waymark → L1 · dept-devops']), null, 'the agent\'s, in a routed task');
  assert.equal(run('', 'git status', ['Waymark → Q · dept-devops']), null, 'a question that only reads');
  fs.rmSync(proj, { recursive: true, force: true });
});

test('21: the PRs rule reads the user\'s Spanish line too ("PRs: el usuario"): it was written "the user" only, so the project\'s own line never matched', async () => {
  const { checkGh } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  assert.match(checkGh('gh pr create --title x', 'abre el PR por favor', '- PRs: el usuario (2026-10-27: «Sí»)') || '', /Conventions say "PRs: el usuario[^]*is the user's, even when the request names it/);
  assert.match(checkGh('gh pr merge 12', 'mergea el PR', '- Pull requests: the user') || '', /Conventions say/);
  assert.equal(checkGh('gh pr create --title x', 'abre el PR', '- PRs: the agent, when asked'), null, 'counter-example: given to the agent, asked for');
});
