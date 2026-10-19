// Waymark 2.0.18 · point 11: the conformance harness (docs/adr/0039). One neutral way to say what an agent did in a task, and one driver per
// agent (tests/conformance/agents/<key>.mjs) that says it the way that agent documents: its hook payloads, its transcript or the events
// Waymark journals. The cases (cases.mjs) run the real hook scripts with `--agent <key>` and read what they answer and what they record, so
// every adapter passes the same list; the cases never know which agent they run on, only what it can do (its `caps`).
//
// The neutral steps a world keeps, in order:
//   every step also carries `at`, an ISO time, stamped when it happens
//   { k: 'user', text }                           the user's prompt
//   { k: 'say', text }                            assistant text (the routing line, the Cierre)
//   { k: 'skill', name }                          a department or skill invoked
//   { k: 'tool', kind: 'shell'|'edit'|'read', input: { command | file }, out, error }
//   { k: 'ask', questions: [{ question, options: [{ label, description }] }], picks: { <question>: <label> } }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..', '..');
// WAYMARK_CONFORMANCE_SCRIPTS: another copy of the scripts to judge (`waymark.mjs adapter-new` registers a draft in a copy and runs the suite there).
export const SCRIPTS = process.env.WAYMARK_CONFORMANCE_SCRIPTS || path.join(ROOT, 'skills', 'waymark', 'scripts');
export const SKILLS_DIR = path.resolve(SCRIPTS, '..', '..');
const SCRIPT = { start: 'session-hook.mjs', prompt: 'rule0-hook.mjs', pre: 'tool-hook.mjs', post: 'tool-hook.mjs', reply: 'tool-hook.mjs', stop: 'stop-hook.mjs' };

// Runs one hook script as the agent runs it: its arguments, the payload on stdin, the isolated environment.
export function hookRun(script, argv, payload, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), ...argv], { cwd, env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => { let json = null; try { json = JSON.parse(stdout); } catch {} resolve({ stdout, stderr, status, json }); });
    child.stdin.end(JSON.stringify(payload));
  });
}

let counter = 0;
// A world: one project folder with Waymark's memory in it (as a project that uses Waymark has), one session, one WAYMARK_HOME, the steps so far.
// `from`: another world whose project this one continues, under another agent (the handoff): the same folder, memory, records and WAYMARK_HOME, a new session.
export function makeWorld(agent, { from = null } = {}) {
  const id = ++counter, root = from ? from.root : fs.mkdtempSync(path.join(os.tmpdir(), `wm-conf-${agent.key}-`)), home = path.join(root, 'home'); // every world has its own WAYMARK_HOME: the state files the hooks share are never shared by two worlds
  const cwd = path.join(root, 'proj'), session = `conf-${agent.key}-${id}`;
  if (!from) {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    for (const f of ['src/orders.service.mjs', '.env', 'README.md']) fs.writeFileSync(path.join(cwd, f), 'x\n');
    spawnSync('git', ['init', '-q'], { cwd });
    fs.mkdirSync(path.join(cwd, '.waymark'));
    fs.writeFileSync(path.join(cwd, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.waymark/\n');
  }
  const env = { ...process.env, WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: path.join(root, 'agents'), WAYMARK_ENGRAM: '', WAYMARK_REVIEW_MODE: 'always', WAYMARK_BACKUPS: path.join(root, 'backups'),
    COPILOT_HOME: path.join(root, 'copilot'), GEMINI_CLI_HOME: path.join(root, 'gemini'), KIRO_HOME: path.join(root, 'kiro') };
  const w = { agent, cwd, session, root, home, env, steps: [], file: null, runs: [] };
  const push = (s) => w.steps.push({ ...s, at: new Date().toISOString() }); // a step is stamped when it happens: the task starts at the prompt, and only what follows it belongs to the task
  const norm = (ev, r) => ({ ...agent.read(ev, r), raw: r });
  const write = () => { w.file = agent.write ? agent.write(w) : w.file; };
  const fire = async (ev, a = {}) => {
    const payload = a.probe ? { waymark_probe: true } : agent.payload(ev, { cwd, session, file: w.file, ...a }); // a probe is how `check` asks a registered hook whether it runs
    const r = await hookRun(SCRIPT[ev], agent.argv(ev), payload, env, cwd);
    w.runs.push({ ev, status: r.status });
    return norm(ev, r);
  };
  w.fire = fire;
  w.start = () => fire('start');
  w.prompt = async (text) => { push({ k: 'user', text }); write(); return fire('prompt', { prompt: text }); };
  const fires = (list, kind) => (agent.events[list] || []).includes(kind); // the hook events this agent runs around a kind of tool call
  w.say = async (text) => { push({ k: 'say', text }); write(); return agent.events.reply ? fire('reply', { text }) : { raw: null }; };
  // A tool call: the hook before it (it may deny: then it never happens), the call, the hook after it where the agent has one.
  w.tool = async (kind, input, { out = 'ok', error = false } = {}) => {
    write();
    const pre = fires('pre', kind) ? await fire('pre', { kind, input }) : { context: '', deny: null };
    if (pre.deny) return { denied: true, deny: pre.deny, context: pre.context || '', pre };
    push({ k: 'tool', kind, input, out, error });
    write();
    const post = fires('post', kind) ? await fire('post', { kind, input, out, error }) : { context: '' };
    return { denied: false, deny: null, context: [pre.context, post.context].filter(Boolean).join('\n'), pre, post };
  };
  w.skill = async (name) => {
    write();
    const pre = fires('pre', 'skill') ? await fire('pre', { kind: 'skill', input: { name } }) : { context: '' };
    push({ k: 'skill', name });
    write();
    if (fires('post', 'skill')) await fire('post', { kind: 'skill', input: { name }, out: 'ok' });
    return pre;
  };
  w.ask = async (questions, picks) => {
    write();
    if (fires('pre', 'ask')) await fire('pre', { kind: 'ask', input: { questions }, picks });
    push({ k: 'ask', questions, picks });
    write();
    if (fires('post', 'ask')) await fire('post', { kind: 'ask', input: { questions }, picks, out: Object.values(picks).join(', ') });
  };
  // The end of a turn: the reply is the turn's last message (in the transcript, and in the event of the agents that carry it apart).
  w.stop = async (reply, { again = false } = {}) => {
    if (reply) { push({ k: 'say', text: reply }); write(); if (agent.events.reply) await fire('reply', { text: reply }); }
    write();
    return fire('stop', { reply, again });
  };
  w.files = (rel) => path.join(cwd, rel);
  w.memoryFile = path.join(cwd, '.waymark', 'memory.md');
  // The records of the project, as the hooks wrote them (one JSON line per task).
  w.records = () => { try { return fs.readFileSync(path.join(cwd, '.waymark', 'provenance.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  w.cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return w;
}

export const day = new Date().toLocaleDateString('sv');
