// The live state: open turns (.waymark/open.json), the Work in progress lines of memory.md, and tasks.md generated from them and the records.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES_REF } from '../notes.mjs';
import { ID, base, clip, idOrder, localDay } from './ids.mjs';
import { maskSecrets } from './secrets.mjs';
import { ensureLocal, projectHome } from './project.mjs';
import { appendRecord, gitNote } from './chain.mjs';
import { readTaskRecords } from './records.mjs';
import { taskIds, openFile, readOpen } from './tasks.mjs';
import { followUps } from './derive.mjs';

// Turns that started and never reached the end-of-turn hook (quota ran out, the agent crashed): .waymark/open.json, one
// entry per session (read by tasks.mjs), written by the per-prompt hook and removed when the turn ends.
export function markOpen(cwd, session, prompt, now = new Date(), agent = null, followUp = undefined) { // followUp: the one the per-prompt hook offered (null: none)
  const home = projectHome(cwd), file = openFile(home);
  if (!file || !fs.existsSync(home.memory)) return false; // tasks.md exists only with memory in the project
  const ids = taskIds(cwd, now), open = readOpen(home);
  open[session || 'unknown'] = { at: now.toISOString(), next: ids.next, followUp: (followUp === undefined ? ids.followUp : followUp) || null, ...(agent ? { agent } : {}), prompt: maskSecrets(String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120)) }; // the agent: "started in codex"
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

// The handoff: .waymark/next-prompt.md carries what a task left for whoever starts next (the ✔/▶ steps of its Aprendido, what a parcial is missing), so any
// agent or account finds it in the card, in place of a long note in one agent's own memory. The context brake keeps the user's held message in the same file:
// that one is never overwritten. A close with nothing to hand over takes a stale handoff away. → 'written' | 'removed' | 'kept' | ''.
const RELAY_FILE = 'next-prompt.md', RELAY_CHARS = 600, RELAY_DAYS = 7;
export const RELAY_MARK = '<!-- handoff ';
const STEPS = /[✔▶]\s*\d/;
export function writeRelay(home, rec) {
  if (!home?.dir || home.legacy || !rec?.id) return '';
  const file = path.join(home.dir, RELAY_FILE);
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch {}
  if (current && !current.startsWith(RELAY_MARK)) return 'kept'; // the user's own words, held by the brake
  const cierre = String(rec.cierre || '').replace(/\*\*|__/g, ''), learned = aprendidoOf(cierre);
  const result = cierre.match(/Resultado:[ \t]*([^\n]*)/i)?.[1]?.trim() || rec.outcome?.result || '';
  if (!(/^(?:parcial|bloqueado)/i.test(result) || STEPS.test(learned))) {
    // only the close of the task the handoff is about takes it away: another task's (or another session's) clean close leaves the steps for whoever starts next
    if (!current || base(current.match(/^<!-- handoff · (\d{4}-\d\d-\d\d · T\d+[a-z]?) ·/)?.[1] || '') !== base(rec.id)) return '';
    fs.rmSync(file, { force: true });
    return 'removed';
  }
  const body = clip(`Relevo de ${rec.id} · ${clip(result, 160)}\nAprendido: ${learned}`, RELAY_CHARS);
  fs.writeFileSync(file, `${RELAY_MARK}· ${rec.id} · ${rec.at || new Date().toISOString()} -->\n${body}\n`);
  return 'written';
}
// The handoff text, or '' when there is none or it is over RELAY_DAYS old; reading it removes nothing (the next session, whichever agent, finds it too).
export function readRelay(home, now = Date.now()) {
  if (!home?.dir || home.legacy) return '';
  try {
    const file = path.join(home.dir, RELAY_FILE), text = fs.readFileSync(file, 'utf8');
    if (!text.startsWith(RELAY_MARK) || now - fs.statSync(file).mtimeMs > RELAY_DAYS * 86400000) return '';
    return text.replace(/^<!--[^\n]*-->\n/, '').trim();
  } catch { return ''; }
}

const TASK_CHARS = 300, TASKS_CHARS = 3000; // per task line and whole file: the detail stays in memory.md and the records
// Cited facts a call backs (observed.evidence): below BACKED_MIN a task is marked ⚠ (the threshold frozen in docs/adr/0038, scorecard check 11.2).
const BACKED_MIN = 0.95;
const DONE_MIN = 3; // done rows tasks.md keeps before it leaves in-progress lines out
const QUESTIONS_SHOWN = 5; // questions (Q) since the last close listed in tasks.md, newest last
const LINE_CHARS = 200, DONE_KEPT = 0; // a Work in progress line; closed (✔) tasks live in their record (note) and tasks.md, not here


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


const STALE_DAYS = 14; // an open (▶) line whose task ID is older leaves Work in progress (the session hook flags it at 14 too)

// Writes the task's Work in progress line from its Cierre: "- ✔ [<id>] <Aprendido>" when Resultado is hecho, else
// "- ▶ …", at most 200 characters (the whole Aprendido stays in the record). It replaces the line of the same task (a
// follow-up replaces its task's line; a replaced line not written by the hook moves to history.md), then tidies the
// section (tidyWip). → true when written.
export function writeTaskLine(home, rec, now = new Date()) {
  if (!home?.dir || home.legacy || !rec?.id || !fs.existsSync(home.memory)) return false;
  const cierre = String(rec.cierre || '').replace(/\*\*|__/g, '');
  const learned = maskSecrets(aprendidoOf(cierre)); // the memory line is written here: masked here too (docs/adr/0045)
  if (!learned || /^ninguno/i.test(learned)) return false;
  // the line says what the record says: a task the record calls hecho leaves Work in progress (its Aprendido and any testigo left unresolved stay in
  // the record and in W check), one it calls parcial or bloqueado keeps its line; the Cierre's word only when the record has no result
  const result = rec.outcome?.result || cierre.match(/Resultado:[ \t]*([^\n·]*)/i)?.[1]?.trim() || '';
  const done = /^hecho\b/i.test(result) || !!rec.outcome?.userOwned; // a step the user owns is not left undone
  return rewriteWip(home, { id: rec.id, line: done ? null : clip(`- ▶ [${rec.id}] ${learned}`, LINE_CHARS), now, label: `closing ${rec.id}` });
}

// The user confirmed that these tasks work (`waymark.mjs done <ID…>`): their lines leave Work in progress (a task done
// lives in its record), and a short chained record {kind: "confirm"} keeps the IDs and the note. → the IDs that had a
// line (others are ignored).
// `always`: the user's "sí" at a close (the per-prompt hook): a task that said hecho has no line to remove, and its
// confirmation is still recorded.
export function confirmTasks(home, ids, { note = '', now = new Date(), agent = null, session = null, always = false } = {}) {
  if (!home?.dir || home.legacy || !fs.existsSync(home.memory)) return [];
  const text = fs.readFileSync(home.memory, 'utf8'), m = ('\n' + text).match(WIP);
  if (!m && !always) return [];
  const wanted = new Map((ids || []).map((id) => [base(id), id]).filter(([b]) => b));
  const done = [];
  const say = maskSecrets(String(note || '').replace(/\s+/g, ' ').trim());
  const body = (m ? m[2].split('\n') : []).map((l) => {
    const hid = /^\s*-/.test(l) ? headId(l) : null;
    if (!hid || !wanted.has(base(hid))) return l;
    done.push(hid);
    return null;
  }).filter((l) => l !== null);
  const confirmed = always ? [...new Set([...done, ...(ids || [])])] : done;
  if (!confirmed.length) return [];
  if (done.length) {
    fs.writeFileSync(home.memory, ('\n' + text).replace(WIP, (_, head) => head + body.join('\n')).slice(1));
    rewriteWip(home, { now, label: `confirmed ${done.join(', ')}` });
  }
  appendRecord(home.root, { kind: 'confirm', agent, at: now.toISOString(), session, confirmed, ...(say ? { said: say.slice(0, 300) } : {}) });
  return confirmed;
}

// Tidies Work in progress without writing a task line (also run by hand: `waymark.mjs tidy`). An open line whose task's newest record says hecho
// leaves too, as writeTaskLine would leave it today: `records` are read only when asked (the hand-run tidy), never on a close. → true when it changed.
export function tidyWip(home, now = new Date(), { records = null } = {}) {
  if (!home?.dir || home.legacy || !fs.existsSync(home.memory)) return false;
  const last = new Map((records || []).filter((r) => r?.id && r.outcome).map((r) => [r.id, r])); // the newest record of each ID wins
  return rewriteWip(home, { now, label: 'tidy', done: new Set([...last].filter(([, r]) => r.outcome.result === 'hecho' || r.outcome.userOwned).map(([id]) => id)) });
}

// The section, rewritten: the task's line (when given) in place of its task's lines, then every line moved whole to
// history.md that is over 200 characters (a task line stays as "- ▶ [<id>] <its next step>"), an older line of a task
// that has a newer one (a task and its follow-ups keep only the newest), an open (▶) or pending line whose task ID is older than 14 days, and the
// every closed (✔) line (DONE_KEPT: a task done lives in its record). A note (no ID at its head) is never moved except when over 200 characters.
function rewriteWip(home, { id = null, line = null, now = new Date(), label, done = new Set() }) {
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
  for (const l of kept.filter((x) => x !== line && /^\s*-\s*▶/.test(x) && done.has(headId(x)))) drop(l); // its record says hecho
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
  const ownedCell = (owned) => { const steps = owned.filter((s) => s !== 'manual'); return `hecho (${[...(owned.includes('manual') ? ['pendiente tuyo: prueba manual'] : []), ...(steps.length ? [`${steps.join(', ')}: tuyo`] : [])].join('; ')})`; }; // the user's own test is named as what is pending from them; a step (deploy, PR) as theirs
  const result = (r, later = []) => (r.fromCommit ? 'solo commit' : r.outcome?.userOwned ? ownedCell(r.outcome.userOwned) : cell((r.cierre || '').match(/Resultado:[ \t]*([^·\n]*)/i)?.[1] || '?') + (r.unresolved?.length && stillOpen(r, later) ? ` · ${r.unresolved.length} sin resolver` : ''));
  const started = Object.values(readOpen(home)).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((o) => clip(`- ${o.next}${o.followUp ? ` (or follow-up ${o.followUp})` : ''} · started${o.agent ? ` in ${cell(o.agent)}` : ''} ${new Date(o.at).toLocaleString('sv').slice(0, 16)} · "${o.prompt}"`, TASK_CHARS));
  const all = readTaskRecords(home), records = all.filter((r) => r.id), lastRec = records[records.length - 1]; // the rows shown
  // the questions since the last close, the newest QUESTIONS_SHOWN as one line each: when, department, skills, the
  // question and what it answered (older records have no skills or answer)
  const asked = all.slice(all.lastIndexOf(lastRec) + 1).filter((r) => r.kind === 'Q'), questions = asked.length;
  const today = now.toLocaleDateString('sv');
  const when = (at) => { const t = new Date(at).toLocaleString('sv'); return t.slice(0, 10) === today ? t.slice(11, 16) : t.slice(5, 16); };
  const qRows = asked.slice(-QUESTIONS_SHOWN).map((r) => clip(`- ${[when(r.at), r.department, r.skills?.join(', ')].filter(Boolean).map(cell).join(' · ')} · "${clip(cell(r.prompt), 80)}"${r.answer ? ` → ${cell(r.answer)}` : ''}`, TASK_CHARS));
  // changes another project's task made in this one (kind "touched"): who, under which task, and which files
  const touched = all.filter((r) => r.kind === 'touched').slice(-3).reverse().map((r) => clip(`- ${cell(r.task)} from ${cell(r.from)} · ${new Date(r.at).toLocaleString('sv').slice(0, 16)} · ${(r.files || []).slice(0, 3).map((f) => path.basename(f)).join(', ')}${(r.files || []).length > 3 ? ` (+${r.files.length - 3})` : ''}${r.learned ? ` · ${cell(r.learned)}` : ''}`, 160));
  const who = (r) => (r.agent ? ` · ${cell(r.agent)}` : ''); // the agent that closed it (docs/adr/0008)
  const source = (r) => (gitNote(r) || r.fromNote ? `git notes --ref=waymark show ${String(r.note?.commit || r.fromNote).slice(0, 8)}` : r.fromCommit ? `git show ${r.fromCommit.slice(0, 8)} (no record: its commit only)` : 'last line of provenance.jsonl');
  // The last closed task with what another agent needs to continue: ~220 ch per field.
  const lastClosed = lastRec ? [`## Last closed: ${cell(lastRec.id)}${who(lastRec)} (${new Date(lastRec.at).toLocaleString('sv').slice(0, 16)}; full record: ${source(lastRec)})`,
    // a field runs to the end of its line, or to the next field on the same line ("Resultado: hecho · Decisión: …")
    ...[['Resultado', 'Resultado'], ['Decisión', 'Decisi[oó]n'], ['Sub-decisiones', 'Sub-?decisiones'], ['Evidencia', 'Evidencia'], ['Aprendido', 'Aprendido']]
      // Decisión: the user's picks as recorded from the choice window; older records keep the Cierre's field
      .map(([name, re]) => [name, name === 'Decisión' && lastRec.decisions?.length ? lastRec.decisions.map((x) => x.chosen).join('; ')
        : (lastRec.cierre || '').replace(/\*\*|__/g, '').match(new RegExp(`${re}:[ \\t]*(.*?)(?=\\s*·\\s*(?:Resultado|Decisi[oó]n|Sub-?decisiones|Evidencia|Aprendido):|\\n|$)`, 'i'))?.[1]])
      .filter(([, v]) => v).map(([name, v]) => `- ${name}: ${clip(cell(v), 220)}`), ...(lastRec.outcome?.userOwned && lastRec.outcome.pending?.length ? [`- Pendiente de ti: ${clip(cell(lastRec.outcome.pending.join('; ')), 220)}`] : []),
    ...(lastRec.evaluation ? [(() => { const st = Object.entries(lastRec.evaluation.steps || {}), failed = st.filter(([, v]) => !v).map(([k]) => k), declared = st.filter(([, v]) => v === 'exception' || v === 'warn').map(([k]) => k); return `- Evaluación: ${lastRec.evaluation.score}${failed.length ? ` (✘ ${failed.join(', ')})` : ''}${declared.length ? ` (⚠ ${declared.join(', ')})` : ''}`; })()] : []), ''] : [];
  // the facts the Cierre cited that a tool call of the task backs, "10/10" (⚠ below BACKED_MIN); — when it cited none or the record has no evidence
  const backed = (r) => { const e = r.observed?.evidence; return e?.cited > 0 ? `${e.cited - (e.unbacked?.length || 0) < e.cited * BACKED_MIN ? '⚠ ' : ''}${e.cited - (e.unbacked?.length || 0)}/${e.cited}` : '—'; };
  const shown = records.slice(-8).reverse();
  // tasks the same files came back to: redone as a follow-up (derived from the IDs: a chained record cannot be edited when a later one continues it)
  // or reworked by a later task within the window (the record's reworks and reworkFiles)
  const redone = shown.flatMap((r) => {
    const again = followUps(records, r.id), files = (r.reworkFiles || []).slice(0, 3).map((f) => path.basename(f));
    return again.length || r.reworks?.length ? [clip(`- ${cell(r.id)}${again.length ? ` · redone as ${again.map((x) => cell(x).split(' · ')[1] || cell(x)).join(', ')}` : ''}${r.reworks?.length ? ` · changes the files of ${r.reworks.slice(0, 3).map((x) => cell(x).split(' · ')[1] || cell(x)).join(', ')}${files.length ? ` (${files.join(', ')})` : ''}` : ''}`, 140)] : [];
  }).slice(0, 4);
  const rows = shown
    .map((r) => `| ${cell(r.id)}${who(r)} | ${clip(result(r, records.slice(records.indexOf(r) + 1)), 60)} | ${cell(r.evaluation?.score || '—')} | ${backed(r)} | ${clip(cell(r.prompt), 60)} |`);
  const render = () => [`# Tasks · ${home.slug}`, '',
    `Generated at each task close (${now.toISOString()}); do not edit. Detail: \`memory.md\` (*Work in progress*) and the records (the \`tasks [<task ID>]\` command: git notes ${NOTES_REF} + \`provenance.jsonl\`).`, '',
    '## In progress / pending', ...(tasks.length ? tasks : ['- none']), ...(hidden ? [`- (+${hidden} more tasks in memory.md)`] : []), ...(notes > 0 ? [`- (${notes} more notes in memory.md, not tasks)`] : []), '',
    ...(started.length ? ['## Started, not closed (still running, the turn reading this file included, or it never ended: quota, crash)', ...started, ''] : []),
    ...(questions ? [`## Preguntas (Q) desde el último cierre: ${questions} (${qRows.length < questions ? `las últimas ${qRows.length}; ` : ''}provenance.jsonl, kind "Q")`, ...qRows, ''] : []),
    ...(touched.length ? ['## Touched from another project (its task is recorded there; kind "touched")', ...touched, ''] : []),
    ...lastClosed,
    `## Done (last ${rows.length}, newest first)`,
    '| Task | Result | Routine | Backed | Request |', '|---|---|---|---|---|', ...rows, '',
    ...(redone.length ? ['## Redone or reworked (the same files came back within 7 days)', ...redone, ''] : [])].join('\n');
  // Over budget: the oldest done rows go first down to DONE_MIN, then the in-progress lines with the oldest task IDs
  // (counted as "+n more"), then the remaining done rows.
  let out = render();
  while (out.length > TASKS_CHARS && touched.length) { touched.pop(); out = render(); } // the touched lines first: they point at another project
  while (out.length > TASKS_CHARS && redone.length) { redone.pop(); out = render(); } // the rework lines next: they only point at rows
  while (out.length > TASKS_CHARS && rows.length > DONE_MIN) { rows.pop(); out = render(); }
  while (out.length > TASKS_CHARS && qRows.length > 1) { qRows.shift(); out = render(); } // the oldest questions
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

// A project with records in git and no .waymark/ (a clone, a cleaned project): memory.md from the template, its Work in
// progress replayed from the records in date order (a task done leaves it, as at its close), and tasks.md. Identity,
// gates and map stay for the Minimal bootstrap. → the number of records it was rebuilt from, or 0 (nothing written).
export function rebuildFromGit(home, now = new Date()) {
  if (!home?.dir || home.legacy || fs.existsSync(home.dir)) return 0;
  const records = readTaskRecords(home);
  if (!records.length) return 0;
  let template = '';
  try { template = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'project-memory.template.md'), 'utf8'); } catch {}
  if (!/\n## Work in progress/.test(template)) template = '# Project: <name>\n\n## Work in progress\n\n## Identity\n';
  ensureLocal(home);
  fs.writeFileSync(home.memory, template.replace('<name>', home.slug).replace('<absolute path to project root>', home.root).replace('<YYYY-MM-DD>', localDay(now)));
  for (const r of records.filter((x) => x.id && x.cierre)) writeTaskLine(home, r, now);
  refreshTasks(home, true);
  return records.length;
}
