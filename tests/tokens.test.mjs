// Point 6 of 2.0.3 — tokens: the protocol read by level, a card that says each path once and asks nothing, and a
// size report that measures what really enters the context.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'skills', 'waymark');
const SCRIPTS = path.join(CORE, 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-tokens-t-'));
const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-tokens-h-'));
const temps = [home, agentsHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: agentsHome, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'),
});
const read = (p) => fs.readFileSync(p, 'utf8');
const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const memRepo = (name, wip) => {
  const repo = fs.mkdtempSync(path.join(os.homedir(), `.wm-tokens-${name}-`));
  temps.push(repo);
  gitT(repo, 'init', '-q');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), `# P\n\n## Work in progress\n${wip}\n## Identity\n- Stack: test\n`);
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
const card = (repo) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8', env: process.env }).stdout).hookSpecificOutput.additionalContext;
const count = (text, s) => text.split(s).length - 1;

test('protocol by level: the block points at parts that exist, an L2 reads one part of ≤4,500 chars that does not repeat the block', () => {
  const block = read(path.join(CORE, 'templates', 'instructions.md'));
  const refs = [...block.matchAll(/`waymark\/(references\/[^`]+\.md)`/g)].map((m) => m[1]);
  for (const r of refs) assert.ok(fs.existsSync(path.join(CORE, r)), `the block points at ${r}, which does not exist`);
  for (const part of ['references/protocol/l2.md', 'references/protocol/l3.md', 'references/protocol/stuck.md']) assert.ok(refs.includes(part), `the block names ${part}`);
  assert.ok(!refs.includes('references/protocol.md'), 'the block no longer sends an L2 to the whole protocol');
  assert.ok(block.length <= 6500, `instructions block: ${block.length} chars`);
  const l2 = read(path.join(CORE, 'references', 'protocol', 'l2.md'));
  assert.ok(l2.length <= 4500, `protocol/l2.md: ${l2.length} chars`);
  assert.doesNotMatch(l2, /## Cierre ·|Never offer, recommend or run browser verification|rewrite project memory → \*Work in progress\*/, 'l2.md repeats or contradicts the block');
  for (const part of ['l3.md', 'stuck.md', 'handoff.md', 'tokens.md']) assert.ok(fs.existsSync(path.join(CORE, 'references', 'protocol', part)), part);
  assert.ok(read(path.join(CORE, 'references', 'protocol.md')).length <= 900, 'protocol.md is an index of the parts');
  assert.doesNotMatch(read(path.join(CORE, 'SKILL.md')), /`references\/protocol\.md`/, 'SKILL.md points at the parts');
});

test('context card: the open IDs say a date once and show at most six; the rest are counted for W tasks', async () => {
  const { openList } = await import(`file://${SCRIPTS}/session-hook.mjs`);
  const ids = ['2026-10-24 · T7', ...[8, 9, 11, 12, 14, 15, 16, 17, 19].map((n) => `2026-10-26 · T${n}`)];
  assert.equal(openList(ids), '2026-10-24 · T7, 2026-10-26 · T8, T9, T11, T12, T14 +4 (W tasks)');
  assert.equal(openList(['2026-10-04 · T3', '2026-10-05 · T1', '2026-10-04 · T5']), '2026-10-04 · T3, 2026-10-05 · T1, 2026-10-04 · T5', 'counter-example: another date is said again, and six or fewer add no count');
});

test('context card: open tasks listed without a question (check asks), the waymark.mjs path and the project root said once', async () => {
  const repo = memRepo('card', '- ▶ [2026-10-04 · T3] waiting for the user\n- ▶ [2026-10-04 · T5] another one\n- Gotcha: a note\n');
  const text = card(repo);
  assert.match(text, /Open tasks \(▶\): 2026-10-04 · T3, T5 \(W check asks the user which already work\)\./);
  assert.doesNotMatch(text, /In your first reply/, 'the card asks nothing');
  assert.equal(count(text, 'waymark.mjs"'), 1, 'W is defined once and used by name');
  assert.match(text, /W = node "[^"]+\/waymark\.mjs"/);
  assert.equal(count(text, repo.replace(/\\/g, '/')), 1, 'the project root once');
  const { openTasks } = await import(`file://${SCRIPTS}/waymark.mjs`);
  assert.match(openTasks(repo), /^open: 2026-10-04 · T3, 2026-10-04 · T5 in Work in progress\. Ask the user once, in the choice window \(multi-select\), which already work; close those with node "[^"]+waymark\.mjs" done "<ID>"… --note "<their words>"\.$/);
  assert.equal(openTasks(memRepo('none', '- Gotcha: only a note\n')), '', 'nothing open, nothing pending');
});

test('learned: a memory titled with the request (before 2.0.3) shows as "<id> · <Aprendido>", like the new ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-engram-'));
  temps.push(dir);
  const bin = path.join(dir, 'engram.mjs');
  fs.writeFileSync(bin, `const a = process.argv.slice(2);
if (a[0] === 'version') console.log('engram 3.1.0');
if (a[0] === 'context') console.log('### Recent Observations\\n- [learning] **2026-10-12 · T12 · si, agrégalo como punto 4b**: Aprendido: ✔1 · ▶4b cualquier agente\\n- [learning] **2026-10-12 · T11 · sin verificar · ✔4 agentes**: Aprendido: ✔4 agentes · ▶5\\n- [decision] **ADR 0001**: [2026-10-05] ADR 0001 y tema');
`);
  const e = await import(`file://${SCRIPTS}/engram.mjs`);
  const { projectHome } = await import(`file://${SCRIPTS}/provenance.mjs`);
  process.env.WAYMARK_ENGRAM = bin;
  try {
    assert.deepEqual(e.learnedLines(projectHome(memRepo('learned', ''))), ['2026-10-12 · T12 · ✔1 · ▶4b cualquier agente', '2026-10-12 · T11 · sin verificar · ✔4 agentes · ▶5', '[2026-10-05] ADR 0001 y tema']);
  } finally { process.env.WAYMARK_ENGRAM = ''; }
});

test('size: the real reminder, the skill descriptions, what goes outside the card cap and the protocol by level', async () => {
  const { sizes } = await import(`file://${SCRIPTS}/size.mjs`);
  const { REMINDER } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
  const rows = sizes(ROOT), by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.ok(by['reminder (real)'].group === 'prompt' && by['reminder (real)'].chars > REMINDER.full.length, 'with the task ID and the git line');
  const SKILLS = path.join(ROOT, 'skills');
  const descriptions = fs.readdirSync(SKILLS).map((d) => (read(path.join(SKILLS, d, 'SKILL.md')).match(/^description:.*$/m) || [''])[0].length).reduce((a, b) => a + b, 0);
  assert.deepEqual([by['skill descriptions'].group, by['skill descriptions'].chars], ['session', descriptions]);
  for (const name of ['check pointer', 'held message (frame)', 'new agents', 'proposals', 'coexistence', 'instructions block (Cursor)']) assert.equal(by[name]?.group, 'outside cap', name);
  assert.equal(by['held message (frame)'].chars <= 100, true, '2.0.20: the held message adds only its frame; the user\'s own words go whole after it');
  assert.equal(by['instructions block (Cursor)'].chars, read(path.join(CORE, 'templates', 'instructions.md')).trim().length);
  const l2 = read(path.join(CORE, 'references', 'protocol', 'l2.md')).length, l3 = read(path.join(CORE, 'references', 'protocol', 'l3.md')).length;
  assert.deepEqual([by['protocol L2'].group, by['protocol L2'].chars, by['protocol L3'].chars], ['level', l2, l2 + l3]);
});

// ---- 2.0.20 point 24: check 8.2 measures Waymark's own skills, not every skill the machine has ----
test('24: the fixed context counts waymark, the dept-* and the owned tool skills; a skill another agent or the user installed is not Waymark\'s to answer for', async () => {
  const { ownSkills } = await import(`file://${SCRIPTS}/size.mjs`);
  const map = { skills: { 'ui-build': { owned: true }, 'library-docs': { owned: true }, 'code-review': {}, 'ego-browser': {} } };
  assert.deepEqual(ownSkills(['waymark', 'dept-qa', 'ui-build', 'ego-browser', 'pdf', 'code-review', 'library-docs'], map), ['waymark', 'dept-qa', 'ui-build', 'library-docs']);
  assert.deepEqual(ownSkills(['waymark', 'pdf'], null), ['waymark'], 'no skill-map: only the core');
});
