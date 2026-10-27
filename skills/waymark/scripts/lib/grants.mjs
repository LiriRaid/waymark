// Waymark · the permission to read a sensitive file (docs/adr/0045). The guard blocks `.env*`, keys and credentials; the only way past it is the
// user, and only through the choice window or a line they write: never the agent's own text. The window's question carries `Sensitive allow: <path>`
// and its options are fixed (LABELS); the user's answer, read from the transcript, is written to ~/.waymark/preferences.md as
//   Sensitive allow: <path>                          always (the name of the file, in every project)
//   Sensitive allow: <path> · task <ID> · <time>     until that task closes (the end-of-turn hook removes it)
//   Sensitive allow: <path> · session <id> · <time>  this session, at most a day
import fs from 'node:fs';
import path from 'node:path';
import { waymarkHome } from './paths.mjs';

// The options the choice window offers, in the user's language and in English; the first word decides the scope. "No" grants nothing.
export const LABELS = [[/^\s*(solo esta tarea|only this task)/i, 'task'], [/^\s*(esta sesi[oó]n|this session)/i, 'session'], [/^\s*(siempre|always)/i, 'always']];
export const WINDOW = 'Solo esta tarea · Esta sesión · Siempre este nombre de archivo · No';
const ASKED = /Sensitive allow:\s*([^\s?¿"“”)]+)/;
const DAY = 86400000;

// The permissions the user gave in the answered choice windows of these lines (decisionsIn): [{ path, scope }].
export function grantsIn(decisions) {
  const out = [];
  for (const d of decisions || []) {
    const asked = String(d.question || '').match(ASKED)?.[1];
    const scope = LABELS.find(([re]) => re.test(String(d.chosen || '')))?.[1];
    if (asked && scope) out.push({ path: asked.replace(/\\/g, '/'), scope });
  }
  return out;
}

const file = () => path.join(waymarkHome(), 'preferences.md');
const entryOf = (g) => (g.scope === 'always' ? path.posix.basename(g.path) : g.path);
// The line a grant is kept as, without its time (what two writes of the same grant share).
export const lineOf = (g, { session, taskId }) => `Sensitive allow: ${entryOf(g)}${g.scope === 'task' ? ` · task ${taskId}` : g.scope === 'session' ? ` · session ${session}` : ''}`;

// Writes the grants not yet there. → how many lines were added.
export function recordGrants(grants, ctx, now = Date.now()) {
  if (!grants.length) return 0;
  let text = '';
  try { text = fs.readFileSync(file(), 'utf8'); } catch {}
  let added = 0;
  for (const g of grants) {
    const line = lineOf(g, ctx);
    if (text.split('\n').some((l) => l.replace(/^[-*\s]+/, '').startsWith(line))) continue;
    text += `${text && !text.endsWith('\n') ? '\n' : ''}- ${line}${g.scope === 'always' ? '' : ` · ${new Date(now).toISOString()}`}\n`;
    added++;
  }
  if (added) { try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), text); } catch { return 0; } }
  return added;
}

// The entries a `Sensitive allow:` line gives, with their scope read: [{ entry, scope, id?, at? }].
const LINE = /^[ \t]*(?:[-*][ \t]*)?Sensitive allow:[ \t]*(.+)$/gim;
export function parseAllow(text) {
  const out = [];
  for (const m of String(text || '').matchAll(LINE)) {
    const scoped = m[1].match(/^(.+?)\s·\s(task|session)\s(.+?)(?:\s·\s(\d{4}-\d\d-\d\dT[\d:.]+Z))?\s*$/);
    if (scoped) out.push({ entry: scoped[1].trim().replace(/^[`"']|[`"']$/g, ''), scope: scoped[2], id: scoped[3].trim(), at: scoped[4] ? Date.parse(scoped[4]) : 0 });
    else for (const e of m[1].split(',')) if (e.trim()) out.push({ entry: e.trim().replace(/^[`"']|[`"']$/g, ''), scope: 'always' });
  }
  return out;
}

// The entries that count now: always ones; this session's, if under a day old; a task's, if under a week old (its close removes it, this is the net).
export function activeAllow(text, { session, now = Date.now() } = {}) {
  return parseAllow(text).filter((a) => a.scope === 'always' || (a.scope === 'session' && a.id === session && now - a.at < DAY) || (a.scope === 'task' && now - a.at < 7 * DAY)).map((a) => a.entry);
}

// A task closed: its permissions end. Session ones older than a day go too. → how many lines were removed.
export function expireGrants(taskId, now = Date.now()) {
  let text = '';
  try { text = fs.readFileSync(file(), 'utf8'); } catch { return 0; }
  const keep = [];
  let removed = 0;
  for (const l of text.split('\n')) {
    const [a] = parseAllow(l);
    if (a && ((a.scope === 'task' && a.id === taskId) || (a.scope === 'session' && now - a.at >= DAY))) { removed++; continue; }
    keep.push(l);
  }
  if (removed) { try { fs.writeFileSync(file(), keep.join('\n')); } catch { return 0; } }
  return removed;
}
