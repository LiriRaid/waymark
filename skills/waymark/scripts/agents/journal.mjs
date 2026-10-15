// Waymark · the journal of an agent whose hooks carry no reply and whose transcript Waymark cannot read (Kiro,
// Antigravity): each hook appends its event to ~/.waymark/<agent>/<session>.jsonl, already in the core's terms, and
// toLines() turns the journal into the core's lines (Claude Code's .jsonl shape). A row: { at, event, cwd, ... } where
// event is prompt (prompt), tool (tool: the canonical name Bash/Edit/Read/AskUserQuestion or the agent's own, input,
// key: the agent's tool name, id when the agent gives one, skill when it reads <dir>/<skill>/SKILL.md), result (key, id,
// error, output) or stop. Journals untouched for 14 days go when a new session starts one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTail, clipOutput } from '../transcript.mjs';
import { answerLine } from './lines.mjs';

export const journalDir = (agent) => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), agent);
const safe = (s) => String(s || 'unknown').replace(/[^\w.-]+/g, '_');
export const journalOf = (agent, session) => path.join(journalDir(agent), `${safe(session)}.jsonl`);
export const SKILL_FILE = /[\\/]([A-Za-z0-9:_-]+)[\\/]SKILL\.md$/i;
// The core's event the installed hook names on its command line (`--event <event>`), or ''.
export const eventArg = (argv = process.argv) => { const i = argv.indexOf('--event'); return i >= 0 ? argv[i + 1] || '' : ''; };

const prune = (dir, days = 14) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > days * 86400000) fs.rmSync(p, { force: true }); } catch {}
  }
};
export function append(agent, session, row) {
  try {
    const file = journalOf(agent, session);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) prune(path.dirname(file));
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
  } catch {}
}

// A stop after the turn's prompt was already answered: the end-of-turn hook blocked once and the agent went on (the
// agent's own flag, when it has none). Read before the current stop is journaled.
export function stoppedAgain(file) {
  const rows = readTail(file, 256 * 1024);
  for (let i = rows.length - 1; i >= 0; i--) { if (rows[i]?.event === 'prompt') return false; if (rows[i]?.event === 'stop') return true; }
  return false;
}

// The journal → the core's lines. A result without the agent's id is paired with the last open call of the same tool.
export function toLines(rows, tag = 'j') {
  const lines = [], open = new Map(), asked = new Map();
  let n = 0;
  const assistant = (r, content) => lines.push({ type: 'assistant', timestamp: r.at, message: { id: `${tag}-${n++}`, content } });
  for (const r of rows) {
    if (r?.event === 'prompt') { open.clear(); asked.clear(); } // an id the agent reuses in a later turn is a new call
    if (r?.event === 'prompt') lines.push({ type: 'user', uuid: `${tag}-${n++}`, timestamp: r.at, message: { role: 'user', content: String(r.prompt || '') } });
    else if (r?.event === 'tool') {
      const id = r.id ? `${tag}-${r.id}` : `${tag}-call-${n++}`;
      open.set(r.key || r.tool, id);
      if (r.skill && r.skill !== 'code-review') assistant(r, [{ type: 'tool_use', name: 'Skill', id: `${id}-skill`, input: { skill: r.skill } }]);
      if (r.tool === 'AskUserQuestion') asked.set(id, r.input?.questions || []);
      assistant(r, [{ type: 'tool_use', name: r.tool, id, input: r.input || {} }]);
    } else if (r?.event === 'result') {
      const id = r.id ? `${tag}-${r.id}` : open.get(r.key || r.tool);
      if (!id) continue;
      open.delete(r.key || r.tool);
      const question = asked.get(id);
      asked.delete(id);
      if (question && !r.error) { // answered: the hook carries no answer, so the record says so
        const qs = question;
        lines.push(answerLine(r.at, id, 'answered', { questions: qs, answers: Object.fromEntries(qs.map((q) => [q.question, r.output || '(answered; the hook does not carry the answer)'])) }));
        continue;
      }
      lines.push({ type: 'user', timestamp: r.at, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!r.error, content: clipOutput(String(r.error || r.output || '')) }] } });
    }
  }
  return lines;
}

// The journals of the sessions opened in cwd, newest first (each row carries its folder).
export function journals(agent, cwd) {
  const dir = journalDir(agent), want = String(cwd).replace(/\\/g, '/').toLowerCase();
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f))
      .filter((f) => String(readTail(f, 64 * 1024).find((r) => r.cwd)?.cwd || '').replace(/\\/g, '/').toLowerCase() === want)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}
