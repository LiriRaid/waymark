// Record schema v2 (docs/adr/0030): what the hooks derive about a task, never what the agent types. A record is chained, so a
// field is added and never repurposed; a reader takes a missing field as "not derivable then" (a v1 record has none of these).
//   taskType     a label from the files the task changed and the verbs of the ask: fix, feature, refactor, docs, test, config, question
//   asked        the items of the ask: the numbered items of the Pedido line the agent wrote (L2+), else the user's own list (docs/adr/0038)
//   answered     what the Cierre's Pedido line says of each item: [{ n, ok, note }]
//   options      for each decision, its options with their attributes: { label, recommended, files, risk, estCost }
//   reworks      the earlier tasks of the project that changed the same files within a window; reworkFiles are those files
//   cost.byCall  the tokens of each tool call (transcript.mjs, costByCall)
//   precedent    the earlier task the hook handed over at the start (point 5; absent until then)
import { base } from './ids.mjs';

export const RECORD_V1 = 'waymark.record/v1';
export const RECORD_V2 = 'waymark.record/v2';
export const RECORD_SCHEMAS = [RECORD_V1, RECORD_V2];
export const TASK_TYPES = ['fix', 'feature', 'refactor', 'docs', 'test', 'config', 'question', 'ops'];
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
  ['feature', /\b(agrega\w*|anad\w*|crea\w*|implementa\w*|construye\w*|nuevo|nueva|soporte|permite|habilita\w*|integra\w*|conecta\w*|muestra|mostrar|expone\w*|add|create|implement\w*|build|feature|enable|support|integrate|expose|show)\b/],
  // work on the repository and its environment, not on its code: commits, pushes, merges, deploys, migrations, deletions, releases
  ['ops', /\b(commit\w*|push|merge\w*|rebase|cherry-?pick|revert\w*|despleg\w*|deploy\w*|migra\w*|migrate|borra\w*|elimina\w*|delete|publica\w*|publish|release|tag|backup)\b/],
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

// The items of an ask: those the agent numbered in its Pedido line (L2+), else the user's own list.
const askedFrom = (pedido, prompt) => (pedido.length >= 2 ? pedido : askedItems(prompt));

// The numbered requirements of a Pedido line ("1) a 2) b · Captura: …" → ['a', 'b']): the numbers run from 1 without a gap, and fewer
// than two is not a list. What follows " · Captura:", " · Copia:", " · Capa:" or " · Cambia:" is not part of an item.
export function itemsOf(text) {
  const head = String(text || '').split(/\s[·|]\s*(?:Captura|Copia|Capa|Cambia)\s*:/i)[0];
  const accepted = [];
  for (const m of head.matchAll(/(?:^|\s)\(?(\d{1,2})[).]\s+/g)) if (Number(m[1]) === accepted.length + 1) accepted.push(m);
  if (accepted.length < 2) return [];
  return accepted.slice(0, 12).map((m, i) => head.slice(m.index + m[0].length, accepted[i + 1]?.index ?? head.length).trim().replace(/[;,.]+$/, '').slice(0, 160)).filter(Boolean);
}

// The items of the last Pedido line the agent wrote in the task, read from its transcript lines (`lines`: the task's); [] when it wrote none or no list.
export function pedidoItems(lines) {
  let line = null;
  for (const d of lines || []) {
    if (d.type !== 'assistant' || d.isSidechain) continue;
    for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
      if (c.type !== 'text') continue;
      for (const m of String(c.text || '').replace(/\*\*|__/g, '').split(/##\s*Cierre/)[0].matchAll(/^[ \t]*(?:[-*]\s*)?Pedido:[ \t]*(.+)$/gim)) line = m[1];
    }
  }
  return line ? itemsOf(line) : [];
}

const YES = /[✔✓]/, MARK = /([✔✓✘✗✕])\s*(\d{1,2})\b[:)\s]*([^·✔✓✘✗✕\n]*)/g;
// What the Cierre's Pedido line says of each item: "Pedido: ✔1 <evidence> · ✘2 <why not>" (the marks may continue on the lines below it) →
// [{ n, ok, note }]. Read only inside the Cierre block.
export function pedidoAnswers(reply) {
  const text = String(reply || '').replace(/\*\*|__/g, ''), at = text.search(/##\s*Cierre/);
  const lines = (at >= 0 ? text.slice(at) : '').split('\n'), i = lines.findIndex((l) => /^[ \t]*(?:[-*]\s*)?Pedido:/i.test(l));
  if (i < 0) return [];
  const block = [lines[i]];
  for (const l of lines.slice(i + 1)) { if (/^[ \t]*(?:[-*]\s*)?[✔✓✘✗✕]/.test(l)) block.push(l.replace(/^[ \t]*[-*]\s*/, '')); else break; }
  return [...block.join(' ').matchAll(MARK)].map((m) => ({ n: Number(m[2]), ok: YES.test(m[1]), note: m[3].trim().replace(/[;,]+$/, '').slice(0, 120) }));
}

// What an L2+ Cierre owes the items of its ask: every item answered, and no "hecho" over an item marked ✘. → [what is missing, as a sentence]
export function askedGaps(items, answers, resultado = '') {
  if (!Array.isArray(items) || items.length < 2) return [];
  const have = new Set(answers.map((a) => a.n)), gaps = [];
  const missing = items.map((_, i) => i + 1).filter((n) => !have.has(n));
  if (missing.length) gaps.push(`Pedido: answer each numbered item of the ask (missing ${missing.map((n) => `${n}) ${String(items[n - 1]).slice(0, 50)}`).join(' · ')}): "Pedido: ✔1 <evidence> · ✘2 <why not>"`);
  const failed = answers.filter((a) => !a.ok && a.n >= 1 && a.n <= items.length).map((a) => a.n);
  if (failed.length && /^hecho$/i.test(String(resultado).trim())) gaps.push(`Resultado: hecho while item ${failed.join(', ')} is ✘: write "Resultado: parcial (<what is missing>)"`);
  return gaps;
}

// What the user chose in the choice window (an option, a free-text answer) is an item of the ask too (docs/adr/0046). The hook reads the choices
// from the window and writes them in the record (`window.chosen`), so the Cierre does not have to repeat them: a choice counts as kept unless a Cierre
// line names it with ✘ (not done, or changed), and only that keeps a "hecho" from standing. A chosen label that holds two actions ("apply and run
// it") is flagged: one label that says two things left a migration unrun under a task marked hecho.
// → { items, failed, twoActions } (arrays; empty when all is as it should be).
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const TWO_ACTIONS = /\s(?:y|and|&|\+)\s+(?:ejecuta\w*|aplica\w*|corre\w*|correr|borra\w*|elimina\w*|despliega\w*|desplegar|migra\w*|run|apply|delete|deploy|migrate)\b/i;
export function windowCheck(decisions, reply) {
  const out = { items: [], failed: [], twoActions: [] };
  const lines = String(reply || '').split('\n');
  // a multi-select answer joins its labels with commas: each label picked is its own item
  const chosen = (decisions || []).flatMap((d) => { const parts = String(d.chosen ?? '').split(/,\s+/); return parts.length > 1 && (d.labels || []).some((l) => parts.includes(l)) ? parts : [String(d.chosen ?? '')]; });
  for (const raw of chosen) {
    const item = raw.trim().replace(/\s*\((?:recommended|recomendad[ao])\)\s*$/i, ''); // the marker is the window's, not the user's choice
    if (!item || /^(?:otra cosa|other)$/i.test(item) || out.items.includes(item)) continue;
    out.items.push(item);
    if (TWO_ACTIONS.test(item)) out.twoActions.push(item);
    const words = [...new Set(plain(item).split(' ').filter((w) => w.length >= 4))].slice(0, 8);
    if (!words.length) continue; // nothing to look for: not judged
    const named = (t) => words.filter((w) => t.includes(w)).length >= Math.ceil(words.length * 0.6);
    const line = lines.find((l) => named(plain(l)) && /[✔✓✘✗✕]/.test(l));
    if (line && /[✘✗✕]/.test(line) && !/[✔✓]/.test(line)) out.failed.push(item);
  }
  return out;
}

// The first choice window of an L2+ task judged on what it says of each option: its risk, its files or its cost, and exactly one option marked
// (Recommended). `decisions` are the task's answered questions (decisionsIn: each carries its options). A window of one option, or a question
// whose options are not known (asked in the chat), is not judged. → { options, missing: [...] } or null.
const REC = /\((?:Recomendad[ao]|Recommended)\)\s*$/i;
const PHASED = /(?<![\p{L}\p{N}])(?:(?:s[oó]lo|solamente|only|just)\s+(?:la\s+|el\s+|the\s+)?(?:(?:primera|first|1[ªa]?)\s+)?(?:fase|etapa|phase|stage)(?:\s*(?:1|uno|one))?|primera\s+(?:fase|etapa)|first\s+(?:phase|stage)|empezar\s+por\s+(?:una|la\s+primera)\s+(?:fase|etapa)|(?:start|begin)\s+with\s+(?:one|the\s+first)\s+(?:phase|stage))(?![\p{L}\p{N}])/iu;
export function optionsLint(decisions, level) {
  if (!(Number(level) >= 2)) return null;
  const first = (decisions || []).find((d) => d.optionList?.length >= 2);
  if (!first) return null;
  const call = first.callId, window = (decisions || []).filter((d) => d.optionList?.length >= 2 && d.callId === call);
  const missing = [];
  for (const d of window) {
    const q = String(d.question || '').slice(0, 30);
    // only the mark is asked: risk, files and cost are kept as fields when an option says them (optionAttrs), never asked of it; asking them fired on 368
    // of 398 real windows and said nothing about the decision
    const marked = d.optionList.filter((o) => REC.test(String(o.label || ''))).length;
    if (marked !== 1) missing.push(`${q}: ${marked ? 'more than one' : 'no'} option marked (Recommended)`);
  }
  // an L2+ ask is built whole, in one task: no option offers a phase of it as a way to shrink the work ("solo la fase 1", "primera fase")
  const phased = window.flatMap((d) => d.optionList.filter((o) => PHASED.test(`${o.label || ''} ${o.description || ''}`)).map((o) => `${String(d.question || '').slice(0, 30)}: "${String(o.label || '').slice(0, 40)}" offers a phase of the ask`));
  return { questions: window.length, missing: missing.slice(0, 8), ...(phased.length ? { phased: phased.slice(0, 4) } : {}) };
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
export function v2Fields({ prompt, files, level, records, now, self, norm, pedido = [] } = {}) {
  const fields = { taskType: taskTypeOf({ prompt, files, level }), asked: askedFrom(pedido, prompt), ...reworkOf(files, records, { now, self, norm }) };
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
