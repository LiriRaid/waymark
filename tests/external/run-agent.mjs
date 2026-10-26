#!/usr/bin/env node
// Waymark · one real agent run inside a clone (docs/adr/0027, point 4 of 2.0.17). Not shipped: it lives with the corpus.
// It starts Claude Code headless (`claude -p`, stream-json) in the clone, with the hooks of THIS checkout (not the user's
// installed copy) and a private WAYMARK_HOME, so the run neither reads nor writes the author's memory. The choice window is
// answered by the harness (the recommended option, else the first), because a headless session has no human; every answer is
// logged. Tools are answered from a short allow list; a shell command outside it is denied with a reason, and the denial is
// part of what the run records. Output: one JSON line per event, and a summary the corpus runner reads.
//   node run-agent.mjs <clone> --prompt "<task>" --out <dir> [--model sonnet] [--timeout 900] [--arm with|without] [--instructions <file>]
// --arm without is the A/B's other arm (tests/ab): `--safe-mode`, so no CLAUDE.md, skill, hook or MCP server loads, and none of
// this checkout's either; authentication works as usual (code.claude.com/docs/en/cli-reference). --instructions appends the
// instructions block to the system prompt of the arm with Waymark, for a CLI that does not load the user's CLAUDE.md under
// --setting-sources project (ab.mjs probes it once).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', '..', 'skills', 'waymark', 'scripts').replace(/\\/g, '/');
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const clone = path.resolve(argv[0]);
const prompt = opt('--prompt');
const out = path.resolve(opt('--out', path.join(os.tmpdir(), 'waymark-run')));
const model = opt('--model', 'sonnet');
const timeoutS = Number(opt('--timeout', 900));
const arm = opt('--arm', 'with'), instructions = opt('--instructions');
if (!prompt || !fs.existsSync(clone) || !/^(with|without)$/.test(arm)) { console.error('usage: run-agent.mjs <clone> --prompt "<task>" --out <dir> [--model sonnet] [--timeout 900] [--arm with|without] [--instructions <file>]'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const hook = (f, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `node "${SCRIPTS}/${f}"` }] }];
const settings = path.join(out, 'settings.json');
fs.writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: hook('session-hook.mjs'), UserPromptSubmit: hook('rule0-hook.mjs'), PreToolUse: hook('tool-hook.mjs', 'Bash|PowerShell|Edit|Write|NotebookEdit|Read'), Stop: hook('stop-hook.mjs') } }, null, 1));
// The departments and skills of THIS checkout, as project-level skills of an added folder (the user's own skills are not loaded
// with --setting-sources project, and a plugin would prefix their names).
const addon = path.join(out, 'addon');
fs.rmSync(addon, { recursive: true, force: true });
fs.cpSync(path.resolve(HERE, '..', '..', 'skills'), path.join(addon, '.claude', 'skills'), { recursive: true });
const wmHome = path.join(out, 'waymark-home');
fs.mkdirSync(wmHome, { recursive: true });

// A shell command the harness lets run: reading, git, node, and the ecosystem's own gate commands (they fail offline or
// when the toolchain is absent; that is recorded as it happens). Anything that fetches or deletes outside the clone is denied.
const SAFE = /^\s*(cd\s+\S+\s*&&\s*)?(node|git(?!\s+(push|clone|remote|config))|ls|cat|pwd|echo|head|tail|wc|grep|rg|find|sed\s+-n|test|cargo|npm\s+(test|run)|npx|pytest|python|python3|php|composer\s+(test|validate)|terraform\s+(fmt|validate)|gradle|\.\/gradlew|make|ctest|go\s+(test|vet|build)|dotnet\s+(test|build)|ruff|mypy)\b/;
const UNSAFE = /\brm\s+-rf?\s+(\/|~|\.\.)|\bcurl\b|\bwget\b|\bsudo\b|\bnpm\s+(i|install)\b|\bpip\s+install\b|Invoke-WebRequest|>\s*\/dev\/(sd|hd)|\bformat\b\s+[a-z]:/i;

const args = arm === 'without'
  ? ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--safe-mode', '--model', model, '--permission-mode', 'acceptEdits']
  : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
    '--setting-sources', 'project', '--settings', settings, '--add-dir', addon, '--strict-mcp-config', '--model', model, '--permission-mode', 'acceptEdits', ...(instructions ? ['--append-system-prompt-file', path.resolve(instructions)] : [])];
const env = arm === 'without' ? { ...process.env, CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: '1' } : { ...process.env, WAYMARK_HOME: wmHome, WAYMARK_ENGRAM: '', WAYMARK_AGENTS_HOME: wmHome, CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: '1' };
const child = spawn('claude', args, { cwd: clone, env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const log = fs.createWriteStream(path.join(out, 'stream.jsonl'));
const answers = [], denials = [], tools = [];
let result = null, buf = '';
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');

const decide = (req) => {
  const { tool_name: name, input } = req;
  tools.push(name);
  if (name === 'AskUserQuestion') {
    const picked = {};
    for (const q of input.questions || []) {
      const opts = q.options || [];
      const rec = opts.find((o) => /recomend|recommended/i.test(`${o.label} ${o.description || ''}`)) || opts[0];
      picked[q.question] = rec?.label ?? '';
      answers.push({ question: q.question, options: opts.map((o) => o.label), chosen: rec?.label ?? null });
    }
    return { behavior: 'allow', updatedInput: { ...input, answers: picked } };
  }
  if (name === 'Bash' || name === 'PowerShell') {
    const cmd = String(input.command || '');
    if (UNSAFE.test(cmd) || !SAFE.test(cmd)) { denials.push({ tool: name, command: cmd.slice(0, 200) }); return { behavior: 'deny', message: 'Not allowed in this sandboxed run (offline; only reading, git status/diff/log/add/commit, node and the ecosystem gate commands).' }; }
  }
  return { behavior: 'allow', updatedInput: input };
};

child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    log.write(line + '\n');
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      send({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: decide(m.request) } });
    } else if (m.type === 'result') { result = m; try { child.stdin.end(); } catch {} }
  }
});
child.stderr.on('data', (d) => log.write(JSON.stringify({ type: 'stderr', text: String(d).slice(0, 2000) }) + '\n'));
const timer = setTimeout(() => { result = result || { type: 'result', subtype: 'timeout', is_error: true }; child.kill(); }, timeoutS * 1000);
child.on('close', (code) => {
  clearTimeout(timer);
  // what the run left in the clone: its .waymark/ (the record, the memory the agent bootstrapped) and its diff
  try { fs.rmSync(path.join(out, 'after'), { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'after'), { recursive: true }); fs.cpSync(path.join(clone, '.waymark'), path.join(out, 'after', '.waymark'), { recursive: true }); } catch {}
  try { fs.writeFileSync(path.join(out, 'after', 'diff.patch'), spawnSync('git', ['diff'], { cwd: clone, encoding: 'utf8' }).stdout || ''); } catch {}
  const u = result?.usage || {};
  const summary = { schema: 'waymark.external-run/v1', clone: path.basename(clone), arm, model, prompt, exit: code, subtype: result?.subtype || null, error: !!result?.is_error, turns: result?.num_turns ?? null,
    usage: { input: u.input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null }, costUsd: result?.total_cost_usd ?? null,
    durationMs: result?.duration_ms ?? null, answers, denials, toolCalls: tools.length, result: String(result?.result ?? '').slice(0, 4000), at: new Date().toISOString() };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  log.end();
  console.log(JSON.stringify({ subtype: summary.subtype, turns: summary.turns, usage: summary.usage, costUsd: summary.costUsd, answers: answers.length, denials: denials.length }));
});
send({ type: 'user', message: { role: 'user', content: prompt } });
