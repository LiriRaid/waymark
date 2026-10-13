// Waymark · what a project learns from its closed tasks (docs/adr/0023). The end-of-turn hook writes only what it
// observed into memory.md: a gate that passed after the last change (Quality gates: its row dated, an empty row filled),
// the folders the task touched (Project map → Areas) and how often a procedure repeats (Repeated procedures). Everything
// else is proposed, never written: a repeated procedure as a project skill, a repeated incident as a Learned rule of the
// owner department, a repeated correction of the user as a preferences.md entry. The session card says each proposal
// once; `waymark.mjs check` lists them; the agent offers them in the choice window and writes only after a yes.
// Offline, 0 model tokens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellRuns, aprendidoOf, maskSecrets } from './provenance.mjs';
import { incidents } from './incidents.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const words = (s) => [...String(s).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
const isRow = (l) => /^\|/.test(l) && !/^\|\s*-{3}/.test(l);

// The body of one "## <title>" section through fn(body) → the new text (the same text when the section is missing).
function editSection(text, title, fn) {
  const t = '\n' + text, m = t.match(new RegExp(`(\\n## ${title}[^\\n]*\\n)([\\s\\S]*?)(?=\\n## |$)`));
  if (!m) return text;
  const body = fn(m[2]);
  return body === m[2] ? text : (t.slice(0, m.index) + m[1] + body + t.slice(m.index + m[0].length)).slice(1);
}

// ---------- Quality gates ----------

// A command that can stand in the table: no shell variables, substitutions or loops.
const plain = (s) => !/[$`]|^(for|do|done|while|if|then|fi|else)\b/.test(s);
// No file named (a glob is general: tests/*.test.mjs): a command for this file only is no project gate.
const general = (s) => words(s).slice(1).every((w) => w.startsWith('-') || w.includes('*') || !/[\\/]|\.\w{1,5}$/.test(w));
const kindOf = (p) => (p.build ? 'build' : p.test ? (general(p.text) ? 'test (full)' : 'test (related)')
  : /\b(tsc|vue-tsc|svelte-check|typecheck|type-check|mypy|pyright)\b/.test(p.text) ? 'typecheck' : 'lint (changed files)');
// A row's command with <placeholders> as a pattern: `node --check <file>` matches node --check src/a.mjs.
const rowMatches = (cmd, text) => new RegExp(`^${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '\\S+')}$`).test(text);

// Verificar ✔ (a gate passed after the last change) → the parts of every command that passed and was a gate, test or
// build date their row; one with no row takes an empty row of its kind. A row with a command is never rewritten.
export function learnGates(text, rec, date) {
  if (rec?.evaluation?.steps?.Verificar !== true) return text;
  const o = rec.observed || {};
  const cmds = [...(o.gate?.ok ? [o.gate.cmd] : []), ...(o.gates || []).filter((g) => !g.error && !g.env).map((g) => g.cmd)];
  const parts = [...new Map(cmds.flatMap((c) => shellRuns(c)).filter((p) => (p.gate || p.test || p.build) && plain(p.text))
    .map((p) => [p.text.replace(/\s+/g, ' '), { ...p, text: p.text.replace(/\s+/g, ' ') }])).values()];
  if (!parts.length) return text;
  return editSection(text, 'Quality gates', (body) => {
    const lines = body.split('\n');
    for (const p of parts) {
      let hit = false;
      lines.forEach((l, i) => {
        if (!isRow(l)) return;
        const [gate, cmd = '', verified = ''] = cells(l), bare = cmd.replace(/`/g, '').trim();
        if (!bare || /^none\b/i.test(bare) || /^gate$/i.test(gate) || !rowMatches(bare, p.text)) return;
        hit = true;
        if (verified !== date) lines[i] = `| ${gate} | ${cmd} | ${date} |`;
      });
      if (hit || !general(p.text)) continue;
      const k = kindOf(p), i = lines.findIndex((l) => isRow(l) && cells(l)[0] === k && !(cells(l)[1] || '').replace(/`/g, '').trim());
      if (i >= 0) lines[i] = `| ${k} | \`${maskSecrets(p.text)}\` | ${date} |`;
    }
    return lines.join('\n');
  });
}

// ---------- Project map ----------

const AREAS = '- Areas (hook: last task per folder):';
const AREAS_MAX = 12;
// The folders the task's files are in (two levels, "(root)" for files at the root), each with the task and its
// Aprendido; newest first, one line per folder, at most AREAS_MAX. The user's lines in the section stay.
export function learnAreas(text, rec, root) {
  if (!rec?.id || !root) return text;
  const rel = (rec.files || []).map((f) => path.relative(root, path.resolve(root, f))).filter((r) => r && !r.startsWith('..') && !path.isAbsolute(r));
  const folders = [...new Set(rel.map((r) => { const p = r.split(/[\\/]/); return p.length > 1 ? `${p.slice(0, Math.min(2, p.length - 1)).join('/')}/` : '(root)'; }))];
  if (!folders.length) return text;
  const learned = aprendidoOf(String(rec.cierre || '').replace(/\*\*|__/g, ''));
  const line = (f) => `  - ${f} — ${rec.id}${learned ? ` · ${clip(maskSecrets(learned), 100)}` : ''}`;
  return editSection(text, 'Project map', (body) => {
    const lines = body.replace(/\n+$/, '').split('\n').filter((l, i, a) => l || i < a.length - 1);
    let at = lines.indexOf(AREAS), old = [];
    if (at >= 0) { let end = at + 1; while (end < lines.length && /^ {2}- /.test(lines[end])) end++; old = lines.splice(at + 1, end - at - 1); }
    else { at = lines.length; lines.push(AREAS); }
    const of = (l) => l.match(/^ {2}- (.+?) — /)?.[1];
    const kept = old.filter((l) => !folders.includes(of(l)));
    lines.splice(at + 1, 0, ...[...folders.map(line), ...kept].slice(0, AREAS_MAX));
    return lines.filter((l, i) => l || i).join('\n') + '\n';
  });
}

// ---------- Repeated procedures ----------

const READS = new Set(['cat', 'ls', 'dir', 'grep', 'rg', 'sed', 'awk', 'head', 'tail', 'find', 'echo', 'printf', 'wc', 'sort', 'uniq', 'cut', 'tr', 'type', 'more', 'less', 'which', 'where', 'pwd', 'cd', 'pushd', 'popd', 'test', 'true', 'false', 'diff', 'stat', 'file', 'tree', 'jq', 'curl', 'sleep', 'get-content', 'get-childitem', 'select-string', 'write-output', 'write-host', 'test-path', 'set-location', 'select-object', 'measure-object']);
const GIT_READ = /^(status|log|diff|show|branch|rev-parse|ls-files|grep|blame|config|remote|notes|describe|shortlog|reflog|cat-file|for-each-ref|worktree|version|help)$/;
const ROUTINE_GIT = /^git (add|commit|push|pull|fetch|checkout|switch|stash|merge|rebase|restore|reset)$/;
const FILE_OPS = /^(cp|mv|rm|mkdir|touch|ln|chmod|rmdir|copy|move|del|xcopy|robocopy|copy-item|move-item|remove-item|new-item|rename-item)$/;
const RUNS = /^(run|run-script|exec|x|dlx)$/;
// A part of a command as a step of a procedure: "<program> <subcommand>" ("git tag", "pnpm build", "node --test",
// "firebase deploy"), or null for a read or a shell fragment (a loop, a test bracket). routine: a gate, a test, a file
// operation or the commit routine (they alone are no procedure).
function step(p) {
  if (!plain(p.text)) return null;
  let w = words(p.text);
  while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w = w.slice(1);
  if (/^(npx|pnpx|bunx)$/i.test(w[0] || '')) w = w.slice(1);
  const prog = path.basename(String(w[0] || '').replace(/\\/g, '/')).toLowerCase().replace(/\.(cmd|exe|ps1|bat)$/, '');
  if (!/^[a-z][\w.-]*$/.test(prog) || READS.has(prog) || /waymark[\\/]+scripts/.test(p.text)) return null;
  const args = w.slice(1), routine = !!(p.gate || p.test || p.build) || FILE_OPS.test(prog);
  if (FILE_OPS.test(prog)) return { label: prog, routine };
  if (prog === 'git') {
    const rest = [...args];
    while (rest.length && /^-[Cc]$/.test(rest[0])) rest.splice(0, 2);
    const sub = rest.find((x) => !x.startsWith('-'));
    if (!sub || GIT_READ.test(sub)) return null;
    return { label: `git ${sub}`, routine: routine || ROUTINE_GIT.test(`git ${sub}`) };
  }
  if (/^(node|deno|python3?|py|bash|sh|pwsh|powershell)$/.test(prog)) {
    const flag = args.find((x) => /^--(test|check)$/.test(x));
    if (flag) return { label: `${prog} ${flag}`, routine: true };
    const script = args.find((x) => !x.startsWith('-')); // a script file; inline code (-e, a heredoc) is exploration
    return script && /\.(m?[jt]s|cjs|py|sh|ps1|rb)$/i.test(script) && !/^-(e|c|command)$/i.test(args[0] || '') ? { label: `${prog} ${path.basename(script.replace(/\\/g, '/'))}`, routine } : null;
  }
  const i = args.findIndex((x) => !x.startsWith('-')), sub = i >= 0 && /^[a-z][\w:-]*$/i.test(args[i]) ? args[i] : ''; // a subcommand, not a path
  return { label: [prog, sub, RUNS.test(sub) ? args[i + 1] : ''].filter(Boolean).join(' '), routine };
}
// A task's action steps, in order, each once.
const stepsOf = (rec) => {
  const seen = new Map();
  // a heredoc's body and a quoted string's lines are no commands (shellRuns splits at every newline); a record clips
  // long commands, so a quote may never close
  const flat = (c) => String(c).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?(\n\2(?=\s|$)|$)/g, '').replace(/'[^']*(?:'|$)|"(?:\\.|[^"\\])*(?:"|$)/g, (q) => q.replace(/\r?\n/g, ' '));
  for (const c of rec.commands || []) for (const p of shellRuns(flat(c))) { const s = step(p); if (s && !seen.has(s.label)) seen.set(s.label, s); }
  return [...seen.values()];
};

const WINDOW = 40; // the newest tasks a procedure is counted in
// The same run of 3 to 5 action steps in 2 tasks or more of the newest WINDOW, with one step at least that is not the
// routine. → [{ steps, ids }] the longest first, a run inside a longer one with the same tasks dropped.
export function procedures(records) {
  const runs = new Map();
  for (const r of records.filter((x) => x.id && x.commands?.length).slice(-WINDOW)) {
    const s = stepsOf(r);
    for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= s.length; i++) {
      const w = s.slice(i, i + n);
      if (w.every((x) => x.routine)) continue;
      const key = w.map((x) => x.label).join(' → ');
      const e = runs.get(key) || { steps: w.map((x) => x.label), ids: [] };
      if (!e.ids.includes(r.id)) e.ids.push(r.id);
      runs.set(key, e);
    }
  }
  const all = [...runs.entries()].filter(([, e]) => e.ids.length >= 2);
  return all.filter(([k, e]) => !all.some(([k2, e2]) => k2 !== k && ` → ${k2} → `.includes(` → ${k} → `) && e2.ids.length >= e.ids.length)).map(([, e]) => e)
    .sort((a, b) => b.ids.length - a.ids.length || b.steps.length - a.steps.length).slice(0, 5);
}

const times = (p) => `${p.ids.length} (${p.ids.slice(-3).join(', ')})`;
// Each procedure's row in Repeated procedures: its count updated, the user's Project skill cell kept.
export function learnProcedures(text, procs) {
  if (!procs.length) return text;
  return editSection(text, 'Repeated procedures', (body) => {
    const lines = body.replace(/\n+$/, '').split('\n');
    if (!lines.some((l) => /^\|\s*Procedure\s*\|/.test(l))) lines.push('| Procedure | Times | Project skill |', '|---|---|---|');
    for (const p of procs) {
      const key = p.steps.join(' → '), i = lines.findIndex((l) => isRow(l) && cells(l)[0] === key);
      if (i >= 0) { const c = cells(lines[i]); lines[i] = `| ${key} | ${times(p)} | ${c[2] ? `${c[2]} ` : ''}|`; continue; }
      let last = -1;
      lines.forEach((l, j) => { if (/^\|/.test(l)) last = j; });
      lines.splice(last + 1, 0, `| ${key} | ${times(p)} | |`);
    }
    return lines.join('\n') + '\n';
  });
}

// ---------- Corrections → preferences ----------

const CORRECTION = /(^|[^\p{L}])(siempre|nunca|jam[aá]s|no (vuelvas a|hagas|uses|pongas|cambies|toques|agregues|borres|quites|abras)|te dije|ya te dije|deja de|otra vez|de ahora en adelante|recuerda que|always|never|don'?t|do not|stop (doing|using)|from now on|i told you)(?=$|[^\p{L}])/iu;
const STOP = new Set(['que', 'los', 'las', 'del', 'por', 'para', 'con', 'una', 'uno', 'como', 'esto', 'esta', 'este', 'eso', 'pero', 'porque', 'sin', 'mas', 'muy', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'you', 'your', 'not', 'are', 'siempre', 'nunca', 'jamas', 'dije', 'deja', 'otra', 'vez', 'ahora', 'adelante', 'recuerda', 'always', 'never', 'dont', 'stop', 'told']);
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const keys = (s) => new Set(norm(s).match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) || []);
const alike = (a, b) => { const shared = [...a].filter((w) => b.has(w)).length; return shared >= 2 && shared / new Set([...a, ...b]).size >= 0.5; };
// The clause a correction is in: from its trigger word to the next punctuation, at most 12 words (a long prompt with
// several topics shares words with others; only the correction itself is compared).
const clause = (text) => {
  const m = String(text || '').match(CORRECTION);
  return m ? text.slice(m.index + m[1].length).split(/[,;.!?\n]/)[0].trim().split(/\s+/).slice(0, 12).join(' ') : '';
};
// The user's corrections (a task's prompt, or their reply to a choice window) that say the same in 2 tasks or more and
// are not in preferences.md yet. → [{ text (the newest clause), ids }].
export function corrections(records, preferences = '') {
  const said = [];
  for (const r of records.filter((x) => x.id)) {
    for (const t of [r.prompt, ...(r.decisions || []).filter((d) => d.source === 'reply').map((d) => d.chosen)]) {
      const c = clause(t);
      if (keys(c).size >= 2) said.push({ id: r.id, text: c, keys: keys(c) });
    }
  }
  const prefs = String(preferences).split('\n').filter((l) => /^\s*-/.test(l)).map(keys);
  const groups = [];
  for (const s of said) { const g = groups.find((x) => x.some((y) => alike(y.keys, s.keys))); if (g) g.push(s); else groups.push([s]); }
  return groups.map((g) => ({ text: clip(g[g.length - 1].text, 140), ids: [...new Set(g.map((s) => s.id))], keys: g[g.length - 1].keys, first: g[0].text }))
    .filter((g) => g.ids.length >= 2 && !prefs.some((p) => alike(p, g.keys))).map(({ text, ids, first }) => ({ text, ids, first })); // first: the oldest clause, a stable key for the proposal
}

// ---------- Proposals ----------

const deptOf = (r) => (typeof r?.department === 'string' ? r.department : r?.department?.declared || r?.department?.invoked?.[0] || null);
const PREFS = () => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'preferences.md');
// The owner department of an incident: the one most of its failed tasks were routed to.
export function ownerOf(records, ids) {
  const n = new Map();
  for (const r of records.filter((x) => ids.includes(x.id))) { const d = deptOf(r); if (d) n.set(d, (n.get(d) || 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
// What the project could learn, for the user to decide. → [{ kind: skill | rule | preference, key, text }]
export function proposals(home, records) {
  const out = [];
  const table = (('\n' + read(home.memory)).match(/\n## Repeated procedures[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] || '').split('\n').filter(isRow).map(cells);
  for (const p of procedures(records)) {
    const key = p.steps.join(' → ');
    if ((table.find((c) => c[0] === key)?.[2] || '').trim()) continue; // a project skill already covers it
    out.push({ kind: 'skill', key: `skill:${key}`, text: `project skill for "${key}" (${p.ids.length}×: ${p.ids.slice(-3).join(', ')}) — dept-devex procedures → Generate a project skill` });
  }
  for (const r of incidents(records).rules) {
    const owner = ownerOf(records, r.ids);
    out.push({ kind: 'rule', key: `rule:${r.label}`, text: `Learned rule for ${owner || 'the owner department'} (${owner ? `${owner}/SKILL.md → ## Learned rules` : 'its SKILL.md → ## Learned rules'}): ${r.label} failed ${r.failures}× (last ${r.ids[r.ids.length - 1]}; waymark.mjs incidents shows the causes)` });
  }
  for (const c of corrections(records, read(PREFS()))) {
    out.push({ kind: 'preference', key: `pref:${[...keys(c.first)].sort().join(' ')}`, text: `preference "${c.text}" (${c.ids.length}×: ${c.ids.slice(-3).join(', ')}) → ~/.waymark/preferences.md` });
  }
  return out;
}

// The proposals never said before in this project (.waymark/proposals-seen.json): the session card says them once.
export function newProposals(home, records) {
  if (!home?.dir || home.legacy) return [];
  const file = path.join(home.dir, 'proposals-seen.json');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const fresh = proposals(home, records).filter((p) => !seen.includes(p.key));
  if (fresh.length) { fs.mkdirSync(home.dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify([...seen, ...fresh.map((p) => p.key)], null, 1) + '\n'); }
  return fresh;
}

// ---------- The end-of-turn write ----------

// What the closed task showed, into memory.md: its gates, its areas, the procedures counted. Never for a question.
export function learn(home, rec, records, now = new Date()) {
  if (!home?.dir || home.legacy || !rec?.id || rec.kind === 'Q' || !fs.existsSync(home.memory)) return false;
  const text = fs.readFileSync(home.memory, 'utf8');
  let next = learnGates(text, rec, now.toLocaleDateString('sv'));
  next = learnAreas(next, rec, home.root);
  next = learnProcedures(next, procedures(records));
  if (next === text) return false;
  fs.writeFileSync(home.memory, next);
  return true;
}
