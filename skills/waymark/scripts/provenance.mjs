// Waymark · supply chain of the agent's work (docs/adr/0001, 0002), shared by the hooks. Offline, 0 model tokens.
// - Task IDs `YYYY-MM-DD · T<n>[a-z]`: n per project and local day, a letter per follow-up prompt of the same task.
// - The record of a closed task, written by stop-hook.mjs from what the transcript proves (prompt, options asked and
//   the user's pick, files, commands, skills), the inputs it was built with (Waymark and agent version, model, MCP
//   servers, instruction file hashes), its commits (trailer `Waymark-Task: <id>`) and the Cierre text. Git is the
//   source of truth (docs/adr/0012): a task with a commit keeps its whole record as a git note on that commit
//   (notes.mjs) and <project>/.waymark/provenance.jsonl keeps a stub with the note's hash; a task without one keeps the
//   whole record there. Each line holds the hash of the previous one: an edited or deleted record or note breaks the
//   chain (verifyChain). Each record names its agent; a question (kind "Q") is a short record with no task ID
//   (docs/adr/0008).
// - The live state: one line per task in memory.md → Work in progress, written by the end-of-turn hook from the Cierre
//   (writeTaskLine), and tasks.md generated from it and the records.
// - `note` on a log line is always the git-note pointer { commit, sha } (gitNote() reads it); other text uses other fields.
// Where: <project>/.waymark/ (docs/adr/0007), resolved once by projectHome() for every hook.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPrompt } from './transcript.mjs';
import { addNote, readNotes, noteSha, NOTES_REF } from './notes.mjs';

const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
export const ID = /\b(20\d\d-\d\d-\d\d) · T(\d+)([a-z]?)\b/;

const slugOf = (dir) => (path.basename(norm(dir)) || 'project').replace(/[^a-z0-9._-]+/g, '-');

// The pre-0007 memory file whose `Path:` holds cwd (longest match), skipping files already migrated (`Moved:`).
export function legacyMemory(cwd) {
  const dir = path.join(HOME(), 'projects');
  let best = null;
  try {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      if (/^Moved:/m.test(text)) continue;
      const raw = text.match(/^Path:\s*([^·\n]+)/m)?.[1]?.trim(), p = norm(raw);
      if (p && (norm(cwd) === p || norm(cwd).startsWith(p + '/')) && (!best || p.length > best.p.length)) best = { f, p, root: raw.replace(/\\/g, '/') };
    }
  } catch {}
  return best ? { slug: best.f.slice(0, -3), file: path.join(dir, best.f), root: best.root } : null;
}

const gitTop = (cwd) => { try { const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 1500 }); return r.status === 0 ? r.stdout.trim() : null; } catch { return null; } };

// The one resolver of a project's Waymark state (docs/adr/0007). → { root, slug, dir, memory, tasks, log, legacy, legacyFile? }
// 1. The nearest <dir>/.waymark/memory.md walking up from cwd (the home folder itself is skipped: ~/.waymark is Waymark's).
// 2. Bridge until 2.1.0: an old ~/.waymark/projects/<slug>.md whose Path holds cwd → the old files (legacy: true).
// 3. No memory: a git repo → <git root>/.waymark/; outside git → the home layout.
export function projectHome(cwd) {
  const at = (root, slug = slugOf(root)) => {
    const dir = path.join(root, '.waymark');
    return { root, slug, dir, memory: path.join(dir, 'memory.md'), tasks: path.join(dir, 'tasks.md'), log: path.join(dir, 'provenance.jsonl'), legacy: false };
  };
  const home = norm(os.homedir());
  for (let d = path.resolve(String(cwd || '.')); ; d = path.dirname(d)) {
    if (norm(d) !== home && fs.existsSync(path.join(d, '.waymark', 'memory.md'))) return at(d);
    if (path.dirname(d) === d) break;
  }
  const old = legacyMemory(cwd);
  if (old) return { ...at(old.root, old.slug), memory: old.file, log: path.join(HOME(), 'provenance', `${old.slug}.jsonl`), legacy: true, legacyFile: old.file };
  const top = gitTop(cwd);
  if (top) return at(top);
  // A new project (a real folder with no git yet and no memory) keeps its memory and record inside itself, like any
  // other; the home folder itself, which is no project, and a path that does not exist keep the home layout.
  const here = path.resolve(String(cwd || '.'));
  if (norm(here) !== home && fs.existsSync(here) && fs.statSync(here).isDirectory()) return at(here);
  const slug = slugOf(cwd);
  return { root: String(cwd), slug, dir: null, memory: path.join(HOME(), 'projects', `${slug}.md`), tasks: null, log: path.join(HOME(), 'provenance', `${slug}.jsonl`), legacy: false };
}

export const projectSlug = (cwd) => projectHome(cwd).slug;

// The other projects of the same workspace: the folders next to this project's root that hold a .waymark/memory.md,
// when that parent is a workspace (its name says "workspace", or it holds a .code-workspace file). A generic parent
// (Proyectos/) with unrelated projects is not one. → [projectHome] of each sibling.
export function workspaceSiblings(root) {
  if (!root) return [];
  const parent = path.dirname(path.resolve(root));
  if (parent === path.resolve(root)) return [];
  let names = [];
  try { names = fs.readdirSync(parent); } catch { return []; }
  if (!/workspace/i.test(path.basename(parent)) && !names.some((n) => n.endsWith('.code-workspace'))) return [];
  return names.map((n) => path.join(parent, n)).filter((d) => norm(d) !== norm(root) && fs.existsSync(path.join(d, '.waymark', 'memory.md'))).map((d) => projectHome(d));
}
export const logFile = (cwd) => projectHome(cwd).log;

// Keeps <root>/.waymark/ out of git through the project's .gitignore (added once, created if missing) and writes its
// README once. → true when the ignore line is in place.
export function ensureLocal(home) {
  if (!home?.dir) return false;
  fs.mkdirSync(home.dir, { recursive: true });
  const readme = path.join(home.dir, 'README.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  // the project's .gitignore, so every clone and every agent keeps it out of git
  const file = path.join(home.root, '.gitignore');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  if (/^\/?\.waymark\/?\s*$/m.test(text)) return true;
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}# Waymark: project memory, local only\n.waymark/\n`);
  return true;
}

const README = `# .waymark: this project's Waymark memory (local, not committed)

Any agent (Claude Code, Codex, Cursor, a new session) resumes the work from this folder:

- \`tasks.md\`: where the work stands: in progress, pending, next step, and the tasks already done. Generated at each task close; do not edit it.
- \`memory.md\`: the project memory. *Work in progress* has one line per open task (≤200 characters, written by the end-of-turn hook from the Cierre; a task done leaves it), then identity, verified gate commands, conventions and solved problems.
- \`provenance.jsonl\`: one line per closed task, chained (each holds the hash of the previous one). A task with a commit keeps its whole record (the request, the user's decisions, files, gates, evidence, the automatic evaluation) as a git note on that commit (\`git notes --ref=waymark show <commit>\`, \`waymark.mjs tasks\`) and a stub here; one without a commit keeps it here.
- \`open.json\`: turns that started and have not ended (one per session); shown in tasks.md under *Started, not closed*.
- \`history.md\` (when present): *Work in progress* lines moved out of memory.md whole (older closed lines, or over 200 characters), never deleted. Read it only for the past.

Kept out of git through the project's \`.gitignore\`.
`;

// Turns that started and never reached the end-of-turn hook (quota ran out, the agent crashed): .waymark/open.json, one
// entry per session, written by the per-prompt hook and removed when the turn ends.
const openFile = (home) => (home?.dir && !home.legacy ? path.join(home.dir, 'open.json') : null);
const readOpen = (home) => { try { return JSON.parse(fs.readFileSync(openFile(home), 'utf8')) || {}; } catch { return {}; } };

export function markOpen(cwd, session, prompt, now = new Date(), agent = null) {
  const home = projectHome(cwd), file = openFile(home);
  if (!file || !fs.existsSync(home.memory)) return false; // tasks.md exists only with memory in the project
  const ids = taskIds(cwd, now), open = readOpen(home);
  open[session || 'unknown'] = { at: now.toISOString(), next: ids.next, followUp: ids.followUp || null, ...(agent ? { agent } : {}), prompt: maskSecrets(String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120)) }; // the agent: "started in codex"
  ensureLocal(home);
  fs.writeFileSync(file, JSON.stringify(open, null, 1));
  refreshTasks(home, true);
  return true;
}

// Removes the session's entry and, with the ID of a closed task, any entry of that task left by another session or agent
// (a hung task resumed elsewhere). → true when something was removed (then tasks.md must be regenerated).
export function closeOpen(home, session, closedId) {
  const file = openFile(home), open = readOpen(home), task = closedId && base(closedId);
  const gone = Object.keys(open).filter((k) => k === (session || 'unknown') || (task && [open[k].next, open[k].followUp].some((id) => id && base(id) === task)));
  if (!file || !gone.length) return false;
  for (const k of gone) delete open[k];
  if (Object.keys(open).length) fs.writeFileSync(file, JSON.stringify(open, null, 1)); else fs.rmSync(file, { force: true });
  return true;
}

// A turn another session left open for over `maxAge` (an API error, the quota, a crash) is interrupted: it leaves
// open.json and a chained {kind: "interrupted"} record keeps it (docs/adr/0015). The current session's own turn stays.
// → the entries closed (then tasks.md must be regenerated).
export const INTERRUPTED_AFTER = 2 * 3600000;
export function expireOpen(home, session, now = new Date(), maxAge = INTERRUPTED_AFTER) {
  const file = openFile(home), open = readOpen(home);
  const gone = Object.entries(open).filter(([k, o]) => k !== (session || 'unknown') && now - Date.parse(o.at || 0) > maxAge);
  if (!file || !gone.length) return [];
  for (const [k, o] of gone) {
    delete open[k];
    appendRecord(home.root, { kind: 'interrupted', agent: o.agent || null, at: now.toISOString(), session: k, task: o.next, startedAt: o.at, prompt: o.prompt });
  }
  if (Object.keys(open).length) fs.writeFileSync(file, JSON.stringify(open, null, 1)); else fs.rmSync(file, { force: true });
  return gone.map(([, o]) => o);
}

const TASK_CHARS = 300, TASKS_CHARS = 3000; // per task line and whole file: the detail stays in memory.md and the records
const DONE_MIN = 3; // done rows tasks.md keeps before it leaves in-progress lines out
const LINE_CHARS = 200, DONE_KEPT = 0; // a Work in progress line; closed (✔) tasks live in their record (note) and tasks.md, not here
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// The pending parts of a line, in order: every NEXT / Next: / Pendiente: / Pending: marker. A marker inside quotes is
// text, not a marker; "Next.js" is not one. None → the text after the first ":".
function nextOf(text) {
  const masked = text.replace(/"[^"]*"|“[^”]*”/g, (q) => ' '.repeat(q.length));
  const marks = [...masked.matchAll(/\b(?:NEXT(?=[\s:]):?|(?:Next|Pendiente|Pending):)\s*/g)];
  return marks.map((m, i) => text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim().replace(/[\s·;.,]+$/, '')).filter(Boolean).join(' · ')
    || text.slice(text.indexOf(':') + 1).trim();
}
// A line written by the hook: "- ▶|✔ [<task ID>] <Aprendido>", at most LINE_CHARS.
const HOOK_LINE = new RegExp(`^\\s*-\\s*([▶✔])\\s*\\[(${ID.source})\\]\\s*(.*)$`);

// One Work in progress line with a task ID → "ID · status · …". A hook line → "ID · en curso|hecho · <Aprendido>"; an
// older free-form line → "ID · status · step · next" (status: ▶ in progress, else pending).
export function taskSummary(line) {
  const hook = line.length <= LINE_CHARS && line.match(HOOK_LINE);
  if (hook) return clip(`- ${hook[2]} · ${hook[1] === '✔' ? 'hecho' : 'en curso'} · ${hook[hook.length - 1].trim()}`, TASK_CHARS);
  const text = line.replace(/^\s*-\s*/, '').replace(/\s+/g, ' ');
  const id = text.match(ID)[0];
  const status = /^▶/.test(text) ? 'en curso' : 'pendiente';
  const step = text.match(/▶(\S+)/)?.[1];
  const next = nextOf(text);
  return clip(['- ' + id, status, step && `paso ${step}`, next && `próximo: ${next}`].filter(Boolean).join(' · '), TASK_CHARS);
}

const WIP = /(\n## Work in progress[^\n]*\n)([\s\S]*?)(?=\n## |$)/;
// The task ID that heads a line: a hook line's, else one before the line's first ":"; one quoted later is a note.
const headId = (l) => l.match(HOOK_LINE)?.[2] || l.slice(0, l.indexOf(':') + 1 || undefined).match(ID)?.[0] || null;
// The Aprendido of a Cierre: its line, or, when the value ends with ":" or is empty, the lines below it up to a blank
// line, the next field or a heading.
export function aprendidoOf(cierre) {
  const m = cierre.match(/Aprendido:[ \t]*([^\n]*)/i);
  if (!m) return '';
  let v = m[1].trim();
  if (!v || v.endsWith(':')) {
    for (const l of cierre.slice(m.index + m[0].length).split('\n').slice(1)) {
      if (!l.trim() || /^\s*#|^\s*(?:[-*]\s*)?(?:Resultado|Evidencia|Tests|Review|Build|Secretos)\s*:/i.test(l)) break;
      v += ' ' + l.trim().replace(/^[-*]\s+/, '');
    }
  }
  return v.trim().replace(/^["“«]\s*|\s*["”»]$/g, '').replace(/\s+/g, ' ');
}
const idOrder = (id) => { const m = String(id).match(ID); return m ? `${m[1]}·${String(m[2]).padStart(4, '0')}${m[3]}` : ''; };

const STALE_DAYS = 14; // an open (▶) line whose task ID is older leaves Work in progress (the session hook flags it at 14 too)

// Writes the task's Work in progress line from its Cierre: "- ✔ [<id>] <Aprendido>" when Resultado is hecho, else
// "- ▶ …", at most 200 characters (the whole Aprendido stays in the record). It replaces the line of the same task (a
// follow-up replaces its task's line; a replaced line not written by the hook moves to history.md), then tidies the
// section (tidyWip). → true when written.
export function writeTaskLine(home, rec, now = new Date()) {
  if (!home?.dir || home.legacy || !rec?.id || !fs.existsSync(home.memory)) return false;
  const cierre = String(rec.cierre || '').replace(/\*\*|__/g, '');
  const learned = aprendidoOf(cierre);
  if (!learned || /^ninguno/i.test(learned)) return false;
  const done = /^hecho\b/i.test(cierre.match(/Resultado:[ \t]*([^\n·]*)/i)?.[1]?.trim() || '');
  // a task done leaves Work in progress (its Aprendido is in its record); one still open keeps its line
  return rewriteWip(home, { id: rec.id, line: done ? null : clip(`- ▶ [${rec.id}] ${learned}`, LINE_CHARS), now, label: `closing ${rec.id}` });
}

// The user confirmed that these tasks work (`waymark.mjs done <ID…>`): their lines leave Work in progress (a task done
// lives in its record), and a short chained record {kind: "confirm"} keeps the IDs and the note. → the IDs that had a
// line (others are ignored).
export function confirmTasks(home, ids, { note = '', now = new Date(), agent = null, session = null } = {}) {
  if (!home?.dir || home.legacy || !fs.existsSync(home.memory)) return [];
  const text = fs.readFileSync(home.memory, 'utf8'), m = ('\n' + text).match(WIP);
  if (!m) return [];
  const wanted = new Map((ids || []).map((id) => [base(id), id]).filter(([b]) => b));
  const done = [];
  const say = maskSecrets(String(note || '').replace(/\s+/g, ' ').trim());
  const body = m[2].split('\n').map((l) => {
    const hid = /^\s*-/.test(l) ? headId(l) : null;
    if (!hid || !wanted.has(base(hid))) return l;
    done.push(hid);
    return null;
  }).filter((l) => l !== null);
  if (!done.length) return [];
  fs.writeFileSync(home.memory, ('\n' + text).replace(WIP, (_, head) => head + body.join('\n')).slice(1));
  rewriteWip(home, { now, label: `confirmed ${done.join(', ')}` });
  appendRecord(home.root, { kind: 'confirm', agent, at: now.toISOString(), session, confirmed: done, ...(say ? { said: say.slice(0, 300) } : {}) });
  return done;
}

// Tidies Work in progress without writing a task line (also run by hand: `waymark.mjs tidy`). → true when it changed.
export function tidyWip(home, now = new Date()) {
  if (!home?.dir || home.legacy || !fs.existsSync(home.memory)) return false;
  return rewriteWip(home, { now, label: 'tidy' });
}

// The section, rewritten: the task's line (when given) in place of its task's lines, then every line moved whole to
// history.md that is over 200 characters (a task line stays as "- ▶ [<id>] <its next step>"), an older line of a task
// that has a newer one (a task and its follow-ups keep only the newest), an open (▶) or pending line whose task ID is older than 14 days, and the
// closed (✔) lines beyond the newest 5. A note (no ID at its head) is never moved except when over 200 characters.
function rewriteWip(home, { id = null, line = null, now = new Date(), label }) {
  const text = fs.readFileSync(home.memory, 'utf8');
  const m = ('\n' + text).match(WIP);
  if (!m && !line) return false;
  const body = m ? m[2].split('\n') : [];
  const moved = [];
  let at = -1, removed = 0;
  const kept = [];
  for (const l of body) {
    const hid = /^\s*-/.test(l) ? headId(l) : null;
    if (id && hid && base(hid) === base(id)) {
      if (at < 0) at = kept.length;
      removed++;
      if (l.length > LINE_CHARS || !HOOK_LINE.test(l)) moved.push(l); // a hand-written line keeps its detail in history.md
      continue;
    }
    if (/^\s*-/.test(l) && l.length > LINE_CHARS) {
      moved.push(l);
      const t = l.replace(/^\s*-\s*/, '');
      kept.push(clip(hid ? `- ${/^\s*-\s*✔/.test(l) ? '✔' : '▶'} [${hid}] ${nextOf(t)}` : `- ${clip(t, 150)} (whole: history.md)`, LINE_CHARS));
    } else kept.push(l);
  }
  if (line) {
    if (at < 0) { at = kept.length; while (at > 0 && !kept[at - 1].trim()) at--; }
    kept.splice(at, 0, line);
  }
  const drop = (l) => { kept.splice(kept.indexOf(l), 1); moved.push(l); };
  const tasks = kept.filter((l) => /^\s*-/.test(l) && headId(l));
  const newest = new Map();
  for (const l of tasks) { const b = base(headId(l)); if (!newest.has(b) || idOrder(headId(l)) > idOrder(headId(newest.get(b)))) newest.set(b, l); }
  for (const l of tasks) if (newest.get(base(headId(l))) !== l) drop(l);
  const cutoff = now.getTime() - STALE_DAYS * 86400000;
  for (const l of kept.filter((x) => x !== line && /^\s*-/.test(x) && headId(x) && !/^\s*-\s*✔/.test(x))) {
    const day = Date.parse(`${headId(l).match(ID)[1]}T00:00:00`);
    if (day < cutoff) drop(l);
  }
  const closed = kept.filter((l) => /^\s*-\s*✔/.test(l) && headId(l)).sort((a, b) => idOrder(headId(b)).localeCompare(idOrder(headId(a))));
  for (const l of closed.slice(DONE_KEPT)) drop(l);
  if (!line && !moved.length && !removed) return false;
  const section = kept.join('\n').replace(/\n*$/, '\n');
  const next = m ? ('\n' + text).replace(WIP, (_, head) => head + section).slice(1) : text.replace(/\n*$/, '\n') + `\n## Work in progress\n${section}`;
  fs.writeFileSync(home.memory, next);
  if (moved.length) {
    const hist = path.join(home.dir, 'history.md');
    const head = fs.existsSync(hist) ? '' : `# History · ${home.slug}\n\nWork in progress lines moved out of memory.md whole (not deleted). Newest batch last.\n`;
    fs.appendFileSync(hist, `${head}\n## Moved ${now.toISOString().slice(0, 16).replace('T', ' ')} (${label})\n${moved.join('\n')}\n`);
  }
  return true;
}

// The git note a log line points to ({ commit, sha }), or null: only an object with a commit counts.
export const gitNote = (r) => (r?.note && typeof r.note === 'object' && typeof r.note.commit === 'string' ? r.note : null);

// Every record of the log with its note read back: a stub becomes the whole record (note fields, then the stub's).
// With `last`: only the last N task records are read back (the others stay stubs).
export function readTaskRecords(home, { last = Infinity } = {}) {
  const records = readRecords(home.log);
  const tasks = records.filter((r) => r.id), wanted = new Set(tasks.slice(Math.max(0, tasks.length - last)).filter(gitNote));
  if (!wanted.size) return records;
  const notes = readNotes(home.root, [...wanted].map((r) => r.note.commit));
  return records.map((r) => {
    if (!wanted.has(r)) return r;
    try { return { ...JSON.parse(notes.get(r.note.commit)), ...r }; } catch { return { ...r, noteMissing: true }; }
  });
}

// tasks.md from memory.md (Work in progress) and the records (done tasks). The agent never edits it (docs/adr/0007).
// Only lines with a task ID are tasks; a memory without IDs (old format) shows its Task/Next lines.
export function tasksMarkdown(home, now = new Date()) {
  let mem = '';
  try { mem = fs.readFileSync(home.memory, 'utf8'); } catch {}
  const wip = (('\n' + mem).match(/\n## Work in progress[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] || '').split('\n').filter((l) => /^\s*-/.test(l));
  const withId = wip.filter(headId); // the ID heads the line; one quoted later is a note
  const tasks = withId.length ? withId.map(taskSummary)
    : wip.filter((l) => /^\s*-\s*(Task|Next)\b[^:]*:/i.test(l)).map((l) => clip(l.trim().replace(/\s+/g, ' '), TASK_CHARS));
  const notes = wip.length - (withId.length || tasks.length);
  let hidden = 0; // in-progress lines left out of tasks.md by the budget
  const cell = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  // "sin resolver" stays while no later task has passed a testigo this one failed (the incident is still open)
  const stillOpen = (r, later) => !r.evaluation?.steps || Object.entries(r.evaluation.steps).some(([label, ok]) => ok === false && !later.some((x) => x.evaluation?.steps?.[label] === true));
  const result = (r, later = []) => cell((r.cierre || '').match(/Resultado:[ \t]*([^·\n]*)/i)?.[1] || '?') + (r.unresolved?.length && stillOpen(r, later) ? ` · ${r.unresolved.length} sin resolver` : '');
  const started = Object.values(readOpen(home)).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((o) => clip(`- ${o.next}${o.followUp ? ` (or follow-up ${o.followUp})` : ''} · started${o.agent ? ` in ${cell(o.agent)}` : ''} ${new Date(o.at).toLocaleString('sv').slice(0, 16)} · "${o.prompt}"`, TASK_CHARS));
  const all = readTaskRecords(home, { last: 8 }), records = all.filter((r) => r.id), lastRec = records[records.length - 1]; // the rows shown
  const questions = all.slice(all.lastIndexOf(lastRec) + 1).filter((r) => r.kind === 'Q').length; // since the last close
  const who = (r) => (r.agent ? ` · ${cell(r.agent)}` : ''); // the agent that closed it (docs/adr/0008)
  const source = (r) => (gitNote(r) ? `git notes --ref=waymark show ${String(r.note.commit).slice(0, 8)}` : 'last line of provenance.jsonl');
  // The last closed task with what another agent needs to continue: ~220 ch per field.
  const lastClosed = lastRec ? [`## Last closed: ${cell(lastRec.id)}${who(lastRec)} (${new Date(lastRec.at).toLocaleString('sv').slice(0, 16)}; full record: ${source(lastRec)})`,
    // a field runs to the end of its line, or to the next field on the same line ("Resultado: hecho · Decisión: …")
    ...[['Resultado', 'Resultado'], ['Decisión', 'Decisi[oó]n'], ['Sub-decisiones', 'Sub-?decisiones'], ['Evidencia', 'Evidencia'], ['Aprendido', 'Aprendido']]
      // Decisión: the user's picks as recorded from the choice window; older records keep the Cierre's field
      .map(([name, re]) => [name, name === 'Decisión' && lastRec.decisions?.length ? lastRec.decisions.map((x) => x.chosen).join('; ')
        : (lastRec.cierre || '').replace(/\*\*|__/g, '').match(new RegExp(`${re}:[ \\t]*(.*?)(?=\\s*·\\s*(?:Resultado|Decisi[oó]n|Sub-?decisiones|Evidencia|Aprendido):|\\n|$)`, 'i'))?.[1]])
      .filter(([, v]) => v).map(([name, v]) => `- ${name}: ${clip(cell(v), 220)}`),
    ...(lastRec.evaluation ? [(() => { const failed = Object.entries(lastRec.evaluation.steps || {}).filter(([, v]) => !v).map(([k]) => k); return `- Evaluación: ${lastRec.evaluation.score}${failed.length ? ` (✘ ${failed.join(', ')})` : ''}`; })()] : []), ''] : [];
  const rows = records.slice(-8).reverse()
    .map((r) => `| ${cell(r.id)}${who(r)} | ${clip(result(r, records.slice(records.indexOf(r) + 1)), 60)} | ${cell(r.evaluation?.score || '—')} | ${clip(cell(r.prompt), 60)} |`);
  const render = () => [`# Tasks · ${home.slug}`, '',
    `Generated at each task close (${now.toISOString()}); do not edit. Detail: \`memory.md\` (*Work in progress*) and the records (\`waymark.mjs tasks [<task ID>]\`: git notes ${NOTES_REF} + \`provenance.jsonl\`).`, '',
    '## In progress / pending', ...(tasks.length ? tasks : ['- none']), ...(hidden ? [`- (+${hidden} more tasks in memory.md)`] : []), ...(notes > 0 ? [`- (${notes} more notes in memory.md, not tasks)`] : []), '',
    ...(started.length ? ['## Started, not closed (still running, the turn reading this file included, or it never ended: quota, crash)', ...started, ''] : []),
    ...(questions ? [`Preguntas (Q) desde el último cierre: ${questions} (provenance.jsonl, kind "Q")`, ''] : []),
    ...lastClosed,
    `## Done (last ${rows.length}, newest first)`,
    '| Task | Result | Routine | Request |', '|---|---|---|---|', ...rows, ''].join('\n');
  // Over budget: the oldest done rows go first down to DONE_MIN, then the in-progress lines with the oldest task IDs
  // (counted as "+n more"), then the remaining done rows.
  let out = render();
  while (out.length > TASKS_CHARS && rows.length > DONE_MIN) { rows.pop(); out = render(); }
  const order = withId.length ? withId.map((l) => idOrder(headId(l))) : tasks.map((_, i) => String(i).padStart(6, '0'));
  while (out.length > TASKS_CHARS && tasks.length > 1) {
    const i = order.indexOf([...order].sort()[0]);
    tasks.splice(i, 1); order.splice(i, 1); hidden++;
    out = render();
  }
  while (out.length > TASKS_CHARS && rows.length > 1) { rows.pop(); out = render(); }
  return out;
}

// Regenerates tasks.md when memory.md or the log is newer (cheap at every end of turn). Never for the bridge or outside git.
export function refreshTasks(home, force = false) {
  if (!home?.tasks || home.legacy || !fs.existsSync(home.memory)) return false;
  const m = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  if (!force && m(home.tasks) >= Math.max(m(home.memory), m(home.log))) return false;
  ensureLocal(home);
  fs.writeFileSync(home.tasks, tasksMarkdown(home));
  return true;
}

export const readLog = (cwd) => readRecords(logFile(cwd));
export function readRecords(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

const localDay = (now) => now.toLocaleDateString('sv'); // YYYY-MM-DD in local time
const base = (id) => { const m = String(id).match(ID); return m ? `${m[1]} · T${m[2]}` : null; };

// The ID for a new task and for a follow-up of the last one; `known` holds every ID already recorded.
export function taskIds(cwd, now = new Date(), records = readLog(cwd)) {
  const day = localDay(now);
  const n = Math.max(0, ...records.map((r) => String(r.id || '').match(ID)).filter((m) => m && m[1] === day).map((m) => Number(m[2])));
  const known = new Set(records.map((r) => r.id).filter(Boolean));
  const follow = (id) => {
    const b = base(id);
    for (let c = 98; c <= 122; c++) if (!known.has(`${b}${String.fromCharCode(c)}`)) return `${b}${String.fromCharCode(c)}`; // b … z
    return null;
  };
  const tasks = records.filter((r) => ID.test(String(r.id || ''))); // question records (kind "Q") carry no ID
  const last = tasks.length ? base(tasks[tasks.length - 1].id) : null;
  return { next: `${day} · T${n + 1}`, last, followUp: last ? follow(last) : null, known, follow };
}

// An ID is valid for this turn when it is the next new one, or an unused follow-up letter of a recorded task.
export function validId(id, ids) {
  const m = String(id || '').match(ID);
  if (!m || ids.known.has(m[0])) return false;
  if (m[0] === ids.next) return true;
  return !!m[3] && [...ids.known].some((k) => base(k) === base(m[0]));
}

// Lines of the current task. With `since` (ms, taskStart): every line after it, so a new task never carries the
// previous one's answers or first change. Without it: from the `prompts`-th last prompt.
export function taskLines(lines, { prompts = 3, since } = {}) {
  if (typeof since === 'number' && since > 0) {
    const i = lines.findIndex((d) => (Date.parse(d.timestamp || '') || 0) > since);
    return i < 0 ? [] : lines.slice(i);
  }
  let seen = 0;
  for (let i = lines.length - 1; i >= 0; i--) if (isPrompt(lines[i]) && ++seen === prompts) return lines.slice(i);
  return lines;
}

// Every file a task changed, from its records and those of its follow-ups: what a follow-up must share.
export function taskFiles(records, id) {
  const b = base(id);
  return b ? records.filter((r) => base(String(r.id || '')) === b).flatMap((r) => r.files || []) : [];
}

// When the current task started (ms), read from the chained log, never from prose: this session's last task record.
// With a follow-up's ID (a letter): after the last record of another task, so the stretch covers its whole task. 0
// when the session has no task record (every line read belongs to the task).
export function taskStart(records, session, id) {
  const own = /[a-z]$/.test(String(id || '').match(ID)?.[0] || '') ? base(id) : null;
  const closes = records.filter((r) => r.session === session && ID.test(String(r.id || '')) && (!own || base(r.id) !== own));
  return Date.parse(closes.pop()?.at || '') || 0;
}

// Choices the user made in the choice window (Claude Code: AskUserQuestion → toolUseResult.{questions, answers}).
export function decisionsIn(lines) {
  const out = [];
  for (const d of lines) {
    const r = d.toolUseResult;
    if (d.type !== 'user' || d.isSidechain || !r || !Array.isArray(r.questions) || !r.answers) continue;
    const callId = (Array.isArray(d.message?.content) ? d.message.content : []).find((c) => c.type === 'tool_result')?.tool_use_id;
    for (const q of r.questions) {
      const chosen = r.answers[q.question];
      if (chosen === undefined) continue;
      // A multi-select answer joins the labels with "," (observed on Claude Code 2.1.x): exact match per part; a label that
      // itself holds a comma falls back to a substring match.
      const parts = String(chosen).split(',').map((s) => s.trim());
      const picked = (l) => parts.includes(l) || (l.includes(',') && String(chosen).includes(l));
      const d = { question: q.question, chosen, discarded: (q.options || []).map((o) => o.label).filter((l) => !picked(l)), ...(r.source ? { source: r.source } : {}) }; // source "chat": asked in the chat (agents without a choice window, docs/adr/0009)
      Object.defineProperty(d, 'labels', { value: (q.options || []).map((o) => o.label), enumerable: false }); // for recordedDecisions only
      // the choice-window call that asked it, to place it before or after the task's first change (testigo decision)
      Object.defineProperty(d, 'callId', { value: callId, enumerable: false });
      out.push(d);
    }
  }
  return out;
}

// Decisions as the chained log keeps them: the picked labels, and a free-text answer as written, at most 200
// characters, with passwords, tokens, keys, URL credentials and e-mail addresses masked (a chained record cannot be
// edited later).
const answerText = (s) => clip(maskSecrets(s).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[correo]'), 200);
export function recordedDecisions(decisions = []) {
  return (decisions || []).map((d) => {
    if (!d.labels) return d; // built by hand (tests, older callers): no options known; decisionsIn always sets them
    const labels = d.labels, chosen = String(d.chosen ?? '');
    const kept = labels.includes(chosen) ? chosen
      : chosen.split(',').map((p) => p.trim()).filter(Boolean).map((p) => (labels.includes(p) ? p : answerText(p))).join(', ');
    return { ...d, chosen: kept };
  });
}

// Secret formats that are unambiguous wherever they appear: the testigo "sin secretos"
// looks for these in the memory, mem_save and the task's diff; "password=…" is only masked in what Waymark writes.
const SECRET_FORMATS = [
  ['llave privada', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ['API key sk-', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
];
// → [{ kind, line }] for every strong-format secret in the text; never the value.
export function findSecrets(text) {
  const s = String(text ?? ''), out = [];
  for (const [kind, re] of SECRET_FORMATS) for (const m of s.matchAll(re)) out.push({ kind, line: s.slice(0, m.index).split('\n').length });
  return out;
}
const maskStrong = (text) => SECRET_FORMATS.reduce((s, [, re]) => s.replace(re, '[redactado]'), String(text ?? ''));
// Every string of a record with the strong formats masked (the chained log cannot be edited later).
export const deepMask = (v) => (typeof v === 'string' ? maskStrong(v) : Array.isArray(v) ? v.map(deepMask) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepMask(x)])) : v);

// Passwords, tokens, keys and URL credentials masked in text the log keeps (prompt, commands, Cierre).
export function maskSecrets(text) {
  return maskStrong(text)
    .replace(/\b(contrase(?:ñ|n)a|password|passwd|pwd|clave|token|secret|api[_ -]?key|bearer)(\s*(?:es|is|=|:)\s*|\s+)(["'`]?)[^\s"'`,;]+\3/gi, '$1$2[redactado]')
    .replace(/(\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1[redactado]@')
    .replace(/(\s-u\s+[^\s:]+:)\S+/g, '$1[redactado]');
}

export const askedChoice = (lines) => lines.some((d) => d.type === 'assistant' && !d.isSidechain && (d.message?.content || []).some?.((c) => c.type === 'tool_use' && c.name === 'AskUserQuestion'));

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fileSha = (p) => { try { return sha(fs.readFileSync(p)).slice(0, 16); } catch { return null; } };

// What the task was built with, from the turn's transcript lines (from its prompt on) and the instruction files.
export function turnInputs(lines, cwd, userInstructions = path.join(os.homedir(), '.claude', 'CLAUDE.md')) { // the agent adapter names its file
  let model = null, agent = null;
  const mcp = new Set();
  for (const d of lines) {
    if (d.version) agent = d.version;
    if (d.type !== 'assistant' || d.isSidechain) continue;
    if (d.message?.model) model = d.message.model;
    for (const c of d.message?.content || []) if (c.type === 'tool_use' && /^mcp__/.test(c.name)) mcp.add(c.name.split('__')[1]);
  }
  let waymark = null;
  try { waymark = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'VERSION'), 'utf8').trim(); } catch {}
  const project = ['CLAUDE.md', 'AGENTS.md'].map((f) => path.join(cwd, f)).find((p) => fs.existsSync(p));
  return { waymark, agent, model, mcp: [...mcp], instructions: { user: fileSha(userInstructions), project: project ? fileSha(project) : null } };
}

// Commits that carry `Waymark-Task: <id>` among the last 30 of the repo at cwd (git missing or no repo → []). The line
// counts anywhere in the message, not only as a git trailer: one separated from Co-Authored-By by a blank line is not
// in the last paragraph, so git does not read it as a trailer.
export function commitsFor(cwd, id) {
  if (!id) return [];
  const r = spawnSync('git', ['log', '-30', '--format=%H%x1f%B%x1e'], { cwd, encoding: 'utf8', timeout: 1500 });
  if (r.status !== 0) return [];
  return r.stdout.split('\x1e').map((c) => c.replace(/^\s+/, '').split('\x1f'))
    .filter(([h, msg]) => h && String(msg || '').split(/\r?\n/).some((l) => l.match(/^\s*Waymark-Task:\s*(.+?)\s*$/i)?.[1] === id)).map(([h]) => h);
}

// Working-tree snapshot of the repo at cwd: { root, head, files: { <absolute path>: <content hash | "deleted"> } } for every
// path git reports as changed or untracked; null without git or a repo. Two snapshots (prompt → end of turn) give the
// files the turn really changed, whatever tool changed them (`git checkout`, a script, a formatter), not only the
// files written with Edit/Write.
export function gitSnapshot(cwd) {
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 1500, maxBuffer: 8 * 1024 * 1024 });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0) return null;
  const root = top.stdout.trim(), head = git('rev-parse', 'HEAD').stdout.trim() || null;
  const st = git('status', '--porcelain=v1', '-z', '--untracked-files=all');
  if (st.status !== 0) return null;
  const files = {};
  const parts = st.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (/^[RC]/.test(e)) i++; // rename/copy: the next entry is the source path
    const abs = path.join(root, e.slice(3));
    files[abs] = fs.existsSync(abs) && fs.statSync(abs).isFile() ? fileSha(abs) : 'deleted';
  }
  return { root, head, files };
}

// Paths whose state differs between two snapshots: newly changed, changed again, or back to clean (e.g. `git checkout --`).
export function snapshotDiff(before, after) {
  if (!before || !after || before.root !== after.root) return [];
  const out = new Set();
  for (const [p, h] of Object.entries(after.files)) if (before.files[p] !== h) out.add(p);
  // Back to clean: a change only when the content differs from before (git checkout --); a commit keeps the content.
  for (const [p, h] of Object.entries(before.files)) if (!(p in after.files) && (h === 'deleted' ? fs.existsSync(p) : fileSha(p) !== h)) out.add(p);
  return [...out];
}

// Snapshot taken by the per-prompt hook, per session (~/.waymark/.turn-snapshot.json), read by the end-of-turn hook.
const snapFile = () => path.join(HOME(), '.turn-snapshot.json');
export function saveSnapshot(session, cwd) {
  const snap = gitSnapshot(cwd);
  let all = {};
  try { all = JSON.parse(fs.readFileSync(snapFile(), 'utf8')); } catch {}
  for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 7 * 86400000) delete all[k];
  all[session || 'unknown'] = { at: Date.now(), cwd, snap };
  fs.mkdirSync(HOME(), { recursive: true });
  fs.writeFileSync(snapFile(), JSON.stringify(all));
  return snap;
}
export function loadSnapshot(session) {
  try { return JSON.parse(fs.readFileSync(snapFile(), 'utf8'))[session || 'unknown']?.snap || null; } catch { return null; }
}

// Shell commands that change files in place (the decision gate treats them like edits). Redirects count unless they go
// to /dev/null, $null, NUL or a temp/scratch folder.
// Temp/scratch locations: a whole path segment, so project paths such as src/templates/ are not mistaken for temp.
const TEMP = /(^|[\s"'=\\/])(tmp|temp|scratchpad)[\\/]|AppData[\\/]Local[\\/]Temp|\$\{?TMP|\$\{?TEMP|%TEMP%|\$T\b|mktemp/i;
const MUTATING = /(?:^|[;&|(]\s*)(?:git\s+(?:checkout\s+(?:\S+\s+)*--(?:\s|$)|(?:restore|reset\s+--hard|apply|rm|mv|clean)\b)|sed\s+(?:-\w+\s+)*-i|rm\s|mv\s|cp\s|tee\s|(?:Set|Add)-Content|Out-File|(?:Remove|Move|Copy|New)-Item)/i;
// The command with the text inside quotes, heredoc bodies and PowerShell here-strings blanked (same length, so an index
// in it is an index in the command): a ">" there is code or text, not a redirect (`node -e "…x=>{…}"`).
// quotes: false keeps the quoted text — `bash -c "npm test"` still runs a test — and blanks only the bodies (a spec
// written through `cat > x.spec.ts <<'EOF'` is not a test run).
export function shellSkeleton(command, { quotes = true } = {}) {
  const c = String(command || ''), out = c.split('');
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '; };
  for (const m of c.matchAll(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g)) blank(m.index + 2, m.index + m[0].length - 2);
  for (const m of c.matchAll(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n/g)) {
    const start = m.index + m[0].length, end = c.slice(start).search(new RegExp(`^[ \\t]*${m[2]}[ \\t]*$`, 'm'));
    blank(start, end < 0 ? c.length : start + end);
  }
  let quote = '';
  for (let i = 0; quotes && i < c.length; i++) {
    if (out[i] === ' ' && c[i] !== ' ') continue; // already blanked
    if (quote) { if (c[i] === '\\' && quote === '"') { out[i] = ' '; if (i + 1 < c.length) out[++i] = ' '; } else if (c[i] === quote) quote = ''; else if (c[i] !== '\n') out[i] = ' '; }
    else if (c[i] === '"' || c[i] === "'") quote = c[i];
  }
  return out.join('');
}

export function mutatesFiles(command) {
  const c = String(command || '');
  if (MUTATING.test(c)) return true;
  const skeleton = shellSkeleton(c);
  for (const m of skeleton.matchAll(/(?<![0-9&>=-])>{1,2}/g)) { // a redirect outside quotes; its target read from the command
    const t = c.slice(m.index + m[0].length).match(/^\s*(?:"([^"]*)"|'([^']*)'|([^\s"'&|;]+))/), target = t && (t[1] ?? t[2] ?? t[3]);
    if (target && !/^(\/dev\/null|\$null|nul|&\d)$/i.test(target) && !TEMP.test(target)) return true;
  }
  return false;
}
// A shell command that changes project files: mutating, and not only about temp/scratch or Waymark's own memory.
export const changesProject = (command) => mutatesFiles(command) && !TEMP.test(String(command || '')) && !/(\.waymark[\\/]|\.claude[\\/]projects)/i.test(String(command || ''));

// Appends the record with `prev` (hash of the last line) and `hash` (of this line without it). A task with commits
// (newest first, as commitsFor returns them) is written whole as a git note on its newest commit and the line is a stub
// that holds the note's sha256; a commit that already has a note, or a failed write, keeps the whole record here.
export function appendRecord(cwd, record) {
  const file = logFile(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = null;
  try { const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); if (lines.length) prev = JSON.parse(lines[lines.length - 1]).hash || sha(lines[lines.length - 1]); } catch {}
  let line = record;
  const commit = record.id && record.commits?.[0];
  if (commit) {
    const text = JSON.stringify(record);
    if (addNote(cwd, commit, text)) {
      const { id, kind, agent, at, session, cwd: where, files, commits, department } = record; // department: what the session loaded (docs/adr/0015)
      line = Object.fromEntries(Object.entries({ id, kind, agent, at, session, cwd: where, files, commits, department }).filter(([, v]) => v !== undefined));
      line.note = { commit, sha: noteSha(text) };
    }
  }
  const body = { ...line, prev };
  fs.appendFileSync(file, JSON.stringify({ ...body, hash: sha(JSON.stringify(body)) }) + '\n');
  return file;
}

// → { ok: true } or { ok: false, at: <index of the first line whose hash or link does not match> }. With the notes
// (readNotes): a stub whose note is missing or does not match its sha256 breaks the chain too ({ note: true }).
export function verifyChain(records, notes = null) {
  let prev = null;
  for (let i = 0; i < records.length; i++) {
    const { hash, ...body } = records[i];
    if (body.prev !== prev || sha(JSON.stringify(body)) !== hash) return { ok: false, at: i };
    const gn = gitNote(body);
    if (notes && gn && (!notes.has(gn.commit) || noteSha(notes.get(gn.commit)) !== gn.sha)) return { ok: false, at: i, note: true };
    prev = hash;
  }
  return { ok: true };
}
export { readNotes };
