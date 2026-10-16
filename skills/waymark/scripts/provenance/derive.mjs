// Record schema v2 (docs/adr/0030): what the hooks derive about a task, never what the agent types. A record is chained, so a
// field is added and never repurposed; a reader takes a missing field as "not derivable then" (a v1 record has none of these).
//   taskType     a label from the files the task changed and the verbs of the ask: fix, feature, refactor, docs, test, config, question
//   asked        the items of the ask, when it was written as a list (point 10 fills it from the Pedido line too)
//   options      for each decision, its options with their attributes: { label, recommended, files, risk, estCost }
//   reworks      the earlier tasks of the project that changed the same files within a window; reworkFiles are those files
//   cost.byCall  the tokens of each tool call (transcript.mjs, costByCall)
//   precedent    the earlier task the hook handed over at the start (point 5; absent until then)
import { base } from './ids.mjs';

export const RECORD_V1 = 'waymark.record/v1';
export const RECORD_V2 = 'waymark.record/v2';
export const RECORD_SCHEMAS = [RECORD_V1, RECORD_V2];
export const TASK_TYPES = ['fix', 'feature', 'refactor', 'docs', 'test', 'config', 'question'];
const REWORK_WINDOW_MS = 7 * 24 * 3600 * 1000;

const slash = (f) => String(f || '').replace(/\\/g, '/');
const TEST_FILE = /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$/i;
const DOC_FILE = /(^|\/)docs?\/|\.(md|mdx|rst|adoc|txt)$|(^|\/)(README|CHANGELOG|LICENSE|NOTICE)[^/]*$/i;
const CONFIG_FILE = /\.(json|ya?ml|toml|ini|cfg|conf|lock|env|properties)$|(^|\/)\.[\w.-]*rc(\.\w+)?$|(^|\/)(Dockerfile|Makefile|\.gitignore|\.editorconfig|\.gitattributes)$|(^|\/)\.github\//i;
// The class of one file; a test file wins over a doc or a config one (a fixture under tests/ is a test).
const classOf = (f) => (TEST_FILE.test(f) ? 'test' : DOC_FILE.test(f) ? 'docs' : CONFIG_FILE.test(f) ? 'config' : 'code');

// The verbs of an ask, in Spanish and English, accents removed; the one that comes first in the text decides.
const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VERBS = [
  ['fix', /\b(arregl\w*|corrig\w*|repar\w*|fix\w*|soluciona\w*|bug|errores?|falla\w*|no funciona|esta roto|rota)\b/],
  ['refactor', /\b(refactor\w*|reorganiz\w*|simplific\w*|limpi\w*|renombr\w*|extrae\w*|mueve|mover|restructur\w*|rename|clean ?up)\b/],
  ['feature', /\b(agrega\w*|anad\w*|crea\w*|implementa\w*|construye\w*|nuevo|nueva|soporte|add|create|implement\w*|build|feature)\b/],
];

// → one of TASK_TYPES, or null when nothing decides it (a label that is a guess would feed a dataset).
// Files first: no file changed, or a Q → question; every file of one class (docs, test, config) → that class. Otherwise the verb.
export function taskTypeOf({ prompt = '', files = [], level = null } = {}) {
  const list = [...new Set((files || []).map(slash))];
  if (level === 'Q' || !list.length) return 'question';
  const classes = new Set(list.map(classOf));
  if (classes.size === 1 && !classes.has('code')) return [...classes][0];
  const text = strip(prompt);
  const hits = VERBS.map(([type, re]) => [type, text.search(re)]).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]);
  return hits[0]?.[0] || null;
}

// The items of an ask written as a list (numbered or bulleted lines); fewer than two is not a list → [].
export function askedItems(prompt) {
  const items = String(prompt || '').split('\n').map((l) => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(\S.*)$/)?.[1]?.trim()).filter(Boolean);
  return items.length >= 2 ? items.slice(0, 12).map((s) => s.slice(0, 160)) : [];
}

// One option of the choice window → { label, recommended, files, risk, estCost }; what its description does not say is null.
// recommended: the label ends with "(Recomendada)" / "(Recommended)", the convention the choice window uses.
export function optionAttrs(o = {}) {
  const label = String(o.label || ''), d = String(o.description || '');
  const risk = d.match(/(?:riesgo|risk)\s*:?\s*(bajo|medio|alto|low|medium|high)/i)?.[1];
  const cost = d.match(/(?:costo|coste|cost)\s*:?\s*([^.;,\n]{1,40})/i)?.[1];
  const files = d.match(/(\d+)\s*(?:archivos|files)\b|\b(?:archivos|files)\s*:?\s*(\d+)/i);
  return { label: label.slice(0, 120), recommended: /\((?:Recomendad[ao]|Recommended)\)\s*$/i.test(label), files: files ? Number(files[1] || files[2]) : null, risk: risk ? risk.toLowerCase() : null, estCost: cost ? cost.trim() : null };
}

// The earlier tasks that changed one of these files within the window: { reworks: [IDs], reworkFiles: [files] }.
// `records` are the project's log lines (id, at, files); `self` is this task's ID, whose own earlier records do not count
// as a task before it. A follow-up of the same task counts: it is the signal the earlier close was not complete.
export function reworkOf(files, records, { now = Date.now(), windowMs = REWORK_WINDOW_MS, self = null, norm = slash } = {}) {
  const mine = new Set((files || []).map(norm));
  const ids = new Set(), shared = new Set();
  for (const r of records || []) {
    const at = Date.parse(r.at || '');
    if (!r.id || r.kind || r.id === self || !Number.isFinite(at) || now - at > windowMs || at > now) continue;
    for (const f of r.files || []) if (mine.has(norm(f))) { ids.add(r.id); shared.add(norm(f)); }
  }
  return { reworks: [...ids], reworkFiles: [...shared].sort() };
}

// The follow-ups of a task (its ID with a letter: 2026-10-16 · T15b), read from the records, never stored: a chained record
// cannot be edited when a later one continues it.
export function followUps(records, id) {
  const b = base(String(id || ''));
  return b ? [...new Set((records || []).map((r) => String(r.id || '')).filter((x) => x && x !== id && base(x) === b && /[a-z]$/.test(x)))].sort() : [];
}

// The v2 fields the hook adds to a new record; a field with nothing to say is left out.
export function v2Fields({ prompt, files, level, records, now, self, norm } = {}) {
  const fields = { taskType: taskTypeOf({ prompt, files, level }), asked: askedItems(prompt), ...reworkOf(files, records, { now, self, norm }) };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v && (!Array.isArray(v) || v.length)));
}

// A record of any schema seen as v2, with what can be derived from what it holds (a replay: nothing is written, the log is
// chained). The tokens per call and the options' descriptions were not kept in a v1 record, so those stay as they were.
export function replayV2(rec, records = []) {
  const level = rec.level === 'Q' || rec.kind === 'Q' ? 'Q' : rec.level;
  const out = { ...rec, ...v2Fields({ prompt: rec.prompt, files: rec.files, level, records: records.filter((r) => r.id !== rec.id), now: Date.parse(rec.at || '') || Date.now(), self: rec.id }), ...(rec.taskType ? { taskType: rec.taskType } : {}) };
  if (rec.decisions && !rec.decisions.every((d) => d.options)) {
    out.decisions = rec.decisions.map((d) => (d.options ? d : { ...d, options: [d.chosen, ...(d.discarded || [])].filter(Boolean).map((label) => optionAttrs({ label })) }));
  }
  return out;
}
