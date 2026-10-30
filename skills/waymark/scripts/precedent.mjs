#!/usr/bin/env node
// Waymark · precedent (docs/adr/0033): a similar task starts from what an earlier one left. At a task's first prompt the hook
// searches the project's earlier tasks for the one that resembles the ask and hands over about 400 characters: which task, what
// the ask was, the files, the gates it needed and what it learned. It hands nothing when nothing resembles the ask.
// Lexical and deterministic: the words of the ask against the words of each earlier task's ask and Aprendido (BM25), no
// embeddings, no model, no network. The evidence of an earlier task is evidence, not fact: the text says so.
//   node precedent.mjs <the ask…>        what would be handed over for this ask
//   node precedent.mjs --eval [--json]   the held-out evaluation on this project's tasks
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHome, readTaskRecords, aprendidoOf } from './provenance.mjs';
import { parseLines } from './transcript.mjs';
import { waymarkHome as HOME } from './lib/paths.mjs';

export const MAX_CHARS = 400;      // the hand-over's cap (scorecard check 10.4)
// Below this score, or with fewer than MIN_MATCHES words in common, the earlier task does not resemble the ask: nothing is handed over.
// Scores grow with the log of the history (a rare word weighs more among many tasks), so the minimum does too: 4.5 at 140 tasks, 1.6 at 5.
export const MIN_FACTOR = 0.9;
export const MIN_MATCHES = 2;
export const minScoreFor = (n) => MIN_FACTOR * Math.log(1 + n);
const K1 = 1.2, B = 0.75;
const STOP = new Set('el la los las un una unos unas de del al a en y o u que con por para sin sobre es son se lo le les mi tu su sus si no ya muy mas pero como este esta esto ese esa eso hay ser estar the an of to in and or for with on at by is are be it this that from as not do does you we pasted_content id sigue seguir quiero necesito favor porfavor ok cual cuales donde cuando quien porque tambien'.split(' '));
const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// The words of a text: lower case, no accents, no tags, no stop words; a path or a dotted version also keeps its parts. A plural loses its s.
export const tokens = (text) => strip(text).replace(/<[^>]*>/g, ' ').split(/[^a-z0-9_.\/-]+/)
  .flatMap((w) => (w.includes('/') || w.includes('.') ? [w, ...w.split(/[\/.]/)] : [w]))
  .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => w.replace(/(es|s)$/, ''));

const docOf = (r) => [...tokens(String(r.prompt || '').slice(0, 600)), ...tokens(aprendidoOf(String(r.cierre || '')))];
const oneLine = (s, n) => { const t = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// The earlier tasks ranked against an ask: [{ record, score }], best first, with a score above zero.
export function search(query, records, k = 3) {
  const docs = records.filter((r) => r.id && r.prompt && !r.kind).map((r) => ({ r, t: docOf(r) }));
  const N = docs.length, df = new Map();
  for (const { t } of docs) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.t.length, 0) / (N || 1) || 1;
  const q = [...new Set(tokens(query))];
  return docs.map(({ r, t }) => {
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    let score = 0, matched = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      matched++;
      const n = df.get(w) || 0;
      score += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * t.length / avg));
    }
    return { record: r, score, matched };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

// The gates an earlier task ran, as short commands: the test, lint, check or build segment of each gate command it recorded.
const GATE = /(--test|\btest\b|lint|\bcheck\b|typecheck|tsc|build|pytest|jest|vitest|cargo|go vet|mvn|gradle)/i;
export function gatesOf(r) {
  const seen = new Set();
  for (const g of [...(r.observed?.gates || [])].reverse()) {
    const seg = String(g.cmd || '').split(/&&|;|\|/).map((s) => s.trim()).find((s) => GATE.test(s) && !/^(cd|echo|cat|sed|grep|git|ls|head|tail|T=)/.test(s));
    if (seg && seen.size < 2) seen.add(oneLine(seg.replace(/\s+\d?>&?\d.*$/, ''), 60)); // without its redirection
  }
  return [...seen];
}

const names = (r) => [...new Set((r.files || []).map((f) => path.basename(String(f).replace(/\\/g, '/'))))];

// The hand-over: at most MAX_CHARS, the lesson taking what the rest leaves.
export function handover(r) {
  const files = names(r), shown = files.slice(0, 3).join(', ') + (files.length > 3 ? ` +${files.length - 3}` : '');
  const gates = gatesOf(r);
  const head = `Precedent ${r.id}${r.level !== undefined && r.level !== null ? ` (L${r.level}${r.taskType ? ` ${r.taskType}` : ''})` : ''}: "${oneLine(r.prompt, 70)}"${shown ? ` → ${shown}` : ''}${gates.length ? ` · gates: ${gates.join('; ')}` : ''}`;
  const tail = ' · earlier evidence, not fact: check it against the code.';
  const learned = oneLine(aprendidoOf(String(r.cierre || '')), Math.max(0, MAX_CHARS - head.length - tail.length - 12));
  const text = `${head}${learned ? ` · learned: ${learned}` : ''}${tail}`;
  return text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS - 1)}…`;
}

// A short ask ("sigue con H4 del plan") names little: it is searched with the session's previous task beside it (its ask, its Aprendido and the
// names of its files). The session's own tasks are never what is found: the agent has them in its context already.
export const SHORT_ASK = 10;
export function queryOf(prompt, records, session) {
  const prev = session && tokens(prompt).length < SHORT_ASK ? records.filter((r) => r.id && !r.kind && r.session === session).pop() : null;
  return prev ? `${prompt} ${prev.prompt || ''} ${aprendidoOf(String(prev.cierre || ''))} ${names(prev).join(' ')}` : prompt;
}
const othersOf = (records, session) => (session ? records.filter((r) => r.session !== session) : records);

// What to hand over for an ask, or null: the best earlier task of another session above the minimum. { task, score, files, text, chars }
export function precedentFor(prompt, records, minScore = minScoreFor(records.filter((r) => r.id && r.prompt && !r.kind).length), session = null) {
  const query = queryOf(prompt, records, session); // "sigue con el punto 2" alone is one word; with its session's task it says what it continues
  if (process.env.WAYMARK_PRECEDENT === '0' || !tokens(prompt).length || tokens(query).length < 2) return null; // a bare "sí" or "ok" asks for nothing
  const [top] = search(query, othersOf(records, session), 1);
  if (!top || top.score < minScore || top.matched < MIN_MATCHES) return null; // one rare word in common is a coincidence, not a precedent
  const text = handover(top.record);
  return { task: top.record.id, score: Math.round(top.score * 10) / 10, files: names(top.record), text, chars: text.length };
}

// Did the task use what it was handed? 'cited' when it names the earlier task, 'files' when a call touched one of its files.
export function usedOf(p, turn) {
  if (!p) return null;
  const said = (turn.texts || []).join('\n');
  if (said.includes(p.task) || said.includes(` · ${p.task.split(' · ').pop()}`) && /precedent|precedente/i.test(said)) return 'cited';
  const calls = (turn.tools || []).map((t) => JSON.stringify(t.input || {}).toLowerCase());
  return p.files.some((f) => calls.some((c) => c.includes(f.toLowerCase()))) ? 'files' : null;
}

// ---- the hand-over of a session, from the first prompt to the close ----
const stateFile = () => path.join(HOME(), '.precedent.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch { return {}; } };
export function keepPrecedent(session, p, now = Date.now()) {
  const all = readState(), id = session || 'unknown';
  for (const [k, v] of Object.entries(all)) if (now - (v.at || 0) > 7 * 86400000) delete all[k];
  if (p) all[id] = { task: p.task, score: p.score, files: p.files, chars: p.chars, at: now }; else delete all[id];
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(all)); } catch {}
}
export const takePrecedent = (session) => readState()[session || 'unknown'] || null;

// ---- the held-out evaluation: each task is searched with its own ask against the tasks before it ----
const norm = (f, root) => String(f).replace(/\\/g, '/').toLowerCase().replace(`${root}/`, '');
export function evaluate(records, { k = 3, minScore = null, root = '' } = {}) {
  const rs = records.filter((r) => r.id && !r.kind && r.prompt).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const r0 = String(root).replace(/\\/g, '/').toLowerCase();
  let eligible = 0, hits = 0, random = 0, handed = 0, handedRight = 0, maxChars = 0;
  const detail = [];
  for (let i = 1; i < rs.length; i++) {
    const t = rs[i], mine = new Set((t.files || []).map((f) => norm(f, r0)));
    const earlier = rs.slice(0, i);
    // measured as it is handed: the ask with its session's context, among the tasks of other sessions
    const top = search(queryOf(t.prompt, earlier, t.session), othersOf(earlier, t.session), k), first = precedentFor(t.prompt, earlier, minScore ?? undefined, t.session);
    if (first) maxChars = Math.max(maxChars, first.chars);
    if (!mine.size) continue;
    // relevant: the earlier tasks of other sessions on its files, the only ones the hand-over searches (othersOf): an earlier task of its own session would be a miss no search could avoid
    const relevant = othersOf(earlier, t.session).filter((e) => (e.files || []).some((f) => mine.has(norm(f, r0))));
    if (!relevant.length) continue;
    eligible++;
    const hit = top.some((x) => relevant.includes(x.record));
    if (hit) hits++;
    random += 1 - (1 - relevant.length / earlier.length) ** Math.min(k, earlier.length);
    if (first) { handed++; if (relevant.some((e) => e.id === first.task)) handedRight++; }
    detail.push({ id: t.id, hit, handed: !!first, matched: first?.task || null, relevant: relevant.length });
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { k, minScoreFactor: MIN_FACTOR, tasks: rs.length, eligible, hits, precisionAtK: eligible ? r3(hits / eligible) : null, randomAtK: eligible ? r3(random / eligible) : null,
    lift: eligible ? r3(hits / eligible - random / eligible) : null, handed, handedShare: eligible ? r3(handed / eligible) : null, handedPrecision: handed ? r3(handedRight / handed) : null, maxChars, detail };
}

// ---- tokens a hand-over would have saved: the discovery calls a later task repeated on an earlier task's files ----
const SEARCH = (c) => (['Grep', 'Glob'].includes(c.name) || (c.name === 'Bash' && /\b(grep|rg|ls|find|git (log|show|blame))\b/.test(String(c.input?.command || ''))));
const READ = (c) => c.name === 'Read' || (c.name === 'Bash' && /\b(cat|head|sed -n)\b/.test(String(c.input?.command || '')));
const EDIT = (c) => ['Edit', 'Write', 'NotebookEdit'].includes(c.name);
// The calls of a transcript's lines that came before the first edit and that looked at one of these files: { search, read }.
// Only searches are claimed as spared: the edit tool needs a read of a file before it changes it, whatever the agent was told.
export function repeatedDiscovery(lines, files) {
  const base = files.map((f) => f.toLowerCase());
  const n = { search: 0, read: 0 };
  for (const d of lines) {
    if (d.type !== 'assistant' || d.isSidechain) continue;
    for (const c of d.message?.content || []) {
      if (c.type !== 'tool_use') continue;
      if (EDIT(c)) return n;
      if (!base.some((f) => JSON.stringify(c.input || {}).toLowerCase().includes(f))) continue;
      if (SEARCH(c)) n.search++; else if (READ(c)) n.read++;
    }
  }
  return n;
}

// What the discovery calls a hand-over would have spared, estimated on the held-out tasks whose transcript is still on this machine:
// for each task whose best earlier match was a task on the same files, the calls it made before its first edit that looked at
// those files, at the mean cost of one response of that task. An estimate with its n: the calls may not have been avoidable.
export async function savings(records, { root = '', projectsDir } = {}) {
  const C = await import('./cost.mjs');
  const rs = records.filter((r) => r.id && !r.kind && r.prompt).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const r0 = String(root).replace(/\\/g, '/').toLowerCase();
  const out = { tasks: 0, calls: 0, reads: 0, units: 0, shareOfUnits: null, measured: 0 };
  let total = 0;
  for (let i = 1; i < rs.length; i++) {
    const t = rs[i], mine = new Set((t.files || []).map((f) => norm(f, r0)));
    const first = precedentFor(t.prompt, rs.slice(0, i), undefined, t.session);
    const match = first && rs.slice(0, i).find((e) => e.id === first.task);
    if (!match || !(match.files || []).some((f) => mine.has(norm(f, r0)))) continue;
    out.tasks++;
    const file = C.transcriptFile({ session: t.session, cwd: t.cwd }, projectsDir);
    const links = t.evaluation?.links;
    if (!file || !links) continue;
    const prev = rs.slice(0, i).filter((r) => r.session === t.session).pop();
    const from = Date.parse(prev?.at || '') || 0, to = Date.parse(t.at || '') || Infinity;
    const lines = parseLines(fs.readFileSync(file, 'utf8')).filter((d) => { const at = Date.parse(d.timestamp || '') || 0; return at > from && at <= to; });
    const responses = ['routine', 'work', 'reply'].reduce((a, k) => a + (links[k]?.responses || 0), 0) || 1;
    const n = repeatedDiscovery(lines, names(match));
    out.measured++; out.calls += n.search; out.reads += n.read; out.units += n.search * C.units(t.evaluation.usage || {}) / responses; total += C.units(t.evaluation.usage || {});
  }
  out.units = Math.round(out.units);
  out.shareOfUnits = total ? Math.round(out.units / total * 10000) / 10000 : null;
  return out;
}

const render = (e) => [`Waymark precedent · held-out evaluation · ${e.tasks} tasks, ${e.eligible} with an earlier task on the same files`,
  `precision@${e.k} ${e.precisionAtK} (random ${e.randomAtK}, lift ${e.lift}) · handed over for ${e.handed} (${e.handedShare}), the right task first in ${e.handedPrecision} · longest hand-over ${e.maxChars} chars (cap ${MAX_CHARS}) · minimum score ${e.minScoreFactor} × ln(1 + tasks)`].join('\n');

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const records = readTaskRecords(projectHome(process.cwd()));
  if (process.argv.includes('--eval')) {
    const root = projectHome(process.cwd()).root, e = { ...evaluate(records, { root }), savings: await savings(records, { root }) };
    console.log(process.argv.includes('--json') ? JSON.stringify(e, null, 1) : `${render(e)}
Savings (estimate): ${e.savings.measured} of ${e.savings.tasks} matched tasks have a transcript here; its searches on the matched files before the first edit: ${e.savings.calls} (reads, which an edit needs anyway: ${e.savings.reads}, not claimed) ≈ ${e.savings.units} cost units (${e.savings.shareOfUnits === null ? '—' : `${(e.savings.shareOfUnits * 100).toFixed(2)} % of those tasks`}).`);
  } else {
    const ask = process.argv.slice(2).join(' ');
    const p = ask ? precedentFor(ask, records) : null;
    console.log(p ? `${p.text}\n(score ${p.score}, ${p.chars} chars)` : 'nothing resembles this ask: nothing would be handed over');
  }
}
