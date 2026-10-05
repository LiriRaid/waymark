#!/usr/bin/env node
// Waymark · the on-demand command (docs/adr/0008). Everything that is not a link of the chain lives here instead of in
// the hooks, so every agent runs the same four short hooks. Run it from the project folder:
//   node waymark.mjs [check]            read-only report of what is pending (default)
//   node waymark.mjs sync               refresh skill-registry.md (sync.mjs) and remember the skills seen here
//   node waymark.mjs mcp-fit | skill-fit | migrate | connect | install-hooks [args]   the existing scripts, args passed on
//   node waymark.mjs testigos [<task ID>]   re-run the testigos that execute (chain, commit + trailer, secrets, typecheck)
//   node waymark.mjs tasks [<task ID>]      the task records, newest first (git notes + provenance.jsonl); one task → its whole record
//   node waymark.mjs notes push [<remote>]  send the records (refs/notes/waymark) to the remote (default origin); git's config is never changed
//   node waymark.mjs tidy                   tidy memory.md → Work in progress now (what each close does); moved lines go to history.md
//   node waymark.mjs done <ID…> [--note "…"]  the user confirmed these tasks work: ✔ in Work in progress + a chained {kind: "confirm"} record
//   node waymark.mjs pack <file…>           per file, the last tasks that changed it (git log + their records): ID · agent · Aprendido · commit
//   node waymark.mjs memory [<section>]     one section of the project memory (Solved problems, Conventions, Identity…); none → the section names
//   node waymark.mjs incidents              open incidents (a testigo ✘ not yet ✔ in a later task) and suggested rules (3 failures or more)
// `check` reports, one line each, only what is pending: a newer Waymark VERSION, skills added or removed since the last
// sync, framework MCP servers that do not fit this project, skills never used, memory still in the old location, other
// agents not connected, an agent framework that appeared or vanished, and a large idle session in this folder. It
// writes nothing but the time of the check (~/.waymark/.check.json, read by the session hook's weekly pointer).
// Every item is offered to the user with the choice window; its command runs only after their yes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTail, sessionState } from './transcript.mjs';
import { projectHome, readTaskRecords, readRecords, readNotes, gitNote, aprendidoOf, tidyWip, refreshTasks, confirmTasks, ID } from './provenance.mjs';
import { incidentsAt } from './incidents.mjs';
import { pushNotes } from './notes.mjs';
import { stackOf } from './stack.mjs';
import { found } from './connect-agents.mjs';
import { agentFrom } from './agents/index.mjs';

const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const script = (name) => path.join(SCRIPTS, name).replace(/\\/g, '/');
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const section = (text, title) => {
  const m = text.match(new RegExp(`\\n## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('<!--')) : [];
};
const RESUME_TOKENS = 150000, CACHE_MINUTES = 60; // above this context, a resume after the prompt cache expired re-writes it all
export const COMMANDS = { sync: 'sync.mjs', 'mcp-fit': 'mcp-fit.mjs', 'skill-fit': 'skill-fit.mjs', migrate: 'migrate-memory.mjs', connect: 'connect-agents.mjs', 'install-hooks': 'install-hooks.mjs', testigos: 'testigos.mjs', size: 'size.mjs' };

export const newer = (a, b) => {
  const pa = String(a).trim().split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).trim().split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

async function update() {
  const repo = process.env.WAYMARK_REPO || 'LiriRaid/waymark';
  const installed = read(path.join(SCRIPTS, '..', 'VERSION')).trim();
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/main/skills/waymark/VERSION`, { signal: AbortSignal.timeout(3000) });
    const latest = res.ok ? (await res.text()).trim() : '';
    if (installed && latest && newer(latest, installed)) return `update: Waymark ${installed} → ${latest}. Offer it (Actualizar ahora / Más tarde / Ver cambios): "Actualizar ahora" → INSTALL.md §9 from https://github.com/${repo}; "Ver cambios" → CHANGELOG.md entries since ${installed}.`;
  } catch {}
  return '';
}

// Skill folders sync.mjs indexes: Waymark's own, other agents', the project's.
export function skillNames(cwd) {
  const roots = [path.resolve(SCRIPTS, '..', '..'), ...['.claude', '.agents', '.codex', '.cursor', '.gemini', '.config/opencode'].map((d) => path.join(os.homedir(), ...d.split('/'), 'skills')),
    ...['.claude', '.agents', '.codex', '.cursor', '.gemini', '.opencode'].map((d) => path.join(cwd, d, 'skills'))];
  return [...new Set(roots)].flatMap((r) => { try { return fs.readdirSync(r).filter((n) => fs.existsSync(path.join(r, n, 'SKILL.md'))).map((n) => `${norm(r)}/${n}`); } catch { return []; } }).sort();
}
const sigFile = () => path.join(HOME(), '.skills-signature.json');

function skills(cwd) {
  const names = skillNames(cwd), before = readJson(sigFile())?.[norm(cwd)];
  if (!before) return `skills: never indexed from this folder. Run node "${script('waymark.mjs')}" sync (refreshes skill-registry.md; third-party skills listed there with their path).`;
  const added = names.filter((n) => !before.includes(n)), removed = before.filter((n) => !names.includes(n));
  if (!added.length && !removed.length) return '';
  const short = (l) => l.map((n) => n.split('/').pop()).join(', ');
  return `skills: changed since the last sync (${[added.length && '+' + short(added), removed.length && '-' + short(removed)].filter(Boolean).join(' · ')}). Run node "${script('waymark.mjs')}" sync.`;
}

async function mcpFit(cwd) {
  if (!fs.existsSync(process.env.WAYMARK_CLAUDE_JSON || path.join(os.homedir(), '.claude.json'))) return '';
  const { fitFor } = await import('./mcp-fit.mjs');
  const f = fitFor(cwd);
  if (!f.add.length && !f.lift.length) return '';
  const parts = [];
  if (f.add.length) parts.push(`${f.add.map((a) => a.server).join(', ')} visible here but this project does not use their framework`);
  if (f.lift.length) parts.push(`${f.lift.map((l) => l.server).join(', ')} blocked here and the project uses their framework now`);
  return `mcp-fit: ${parts.join('; ')}. Block/lift them for this project only (your servers stay registered; a deny rule in .claude/settings.local.json): node "${script('mcp-fit.mjs')}" --project "${cwd.replace(/\\/g, '/')}" shows the plan, --apply on yes; next session.`;
}

async function skillFit() {
  if (!fs.existsSync(process.env.WAYMARK_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects'))) return '';
  const { plan } = await import('./skill-fit.mjs');
  const p = plan();
  const n = p.skills.length + p.plugins.length;
  if (p.skipped || !n) return '';
  const tokens = Math.round([...p.skills, ...p.plugins].reduce((a, x) => a + (x.chars || 0), 0) / 4);
  return `skill-fit: ${n} skills/plugins unused in ${p.days} days are listed in every session (~${tokens} tokens per session). List only their names (still invocable) / disable unused plugins: node "${script('skill-fit.mjs')}" shows the plan, --apply on yes (--restore undoes it); next session.`;
}

function migration(cwd) {
  const home = projectHome(cwd);
  return home.legacy ? `migrate: this project's memory and record are still in ~/.waymark (docs/adr/0007). Move them into ${home.root}/.waymark/ (local, excluded from git, any agent resumes from it): node "${script('migrate-memory.mjs')}" --project "${home.root}" shows the plan, --apply on yes (backup first); the old location works until 2.1.0.` : '';
}

function agents() {
  const fresh = found().filter((a) => !a.connected);
  const stale = fresh.filter((a) => a.full && /waymark:(pointer|begin)/.test(read(a.path)));
  if (stale.length === fresh.length && stale.length) return `connect: ${stale.map((a) => a.name).join(', ')} run${stale.length > 1 ? '' : 's'} Waymark's hooks but ${stale.length > 1 ? 'have' : 'has'} the pointer or an older Rule 0 block in ${stale.map((a) => a.path.replace(/\\/g, '/')).join(', ')}: offer to write the current block: node "${script('connect-agents.mjs')}" --apply`;
  return fresh.length ? `connect: other agents not connected to the project memory: ${fresh.map((a) => `${a.name} (${a.path.replace(/\\/g, '/')}${a.guestOf.length ? `; ${a.guestOf.join(', ')} governs it: Waymark joins as its guest` : ''})`).join(', ')}. One marked line in each one's instructions file so it reads .waymark/tasks.md first: node "${script('connect-agents.mjs')}" shows the plan, --apply on yes (backup first).` : '';
}

// Framework namespaces marked in the agents' instructions files (`<!-- name:section -->`, `<!-- BEGIN name -->`).
export function foreignMarkers() {
  const files = read(path.join(HOME(), 'agent.md')).split('\n').filter((l) => l.startsWith('|') && !/^\|\s*(Agent|---|<agent>)/.test(l))
    .map((l) => l.split('|')[4]?.trim().replace(/`/g, '')).filter((f) => f && !f.startsWith('<'));
  const out = new Map();
  for (const f of files) {
    const text = read(f);
    for (const re of [/<!--\s*([a-z][\w.-]*):[\w.-]+/gi, /<!--\s*(?:begin|start)[:\s]+([a-z][\w.-]*)/gi, /<!--\s*([a-z][\w.-]*)\s+(?:begin|start)\b/gi]) {
      for (const m of text.matchAll(re)) {
        const ns = m[1].toLowerCase();
        if (ns !== 'waymark' && !['begin', 'start', 'end'].includes(ns)) out.set(ns, f);
      }
    }
  }
  return out;
}

function frameworks() {
  const text = '\n' + read(path.join(HOME(), 'coexistence.md'));
  const mode = text.match(/\nMode:\s*(waymark-leads|guest|other-leads|skills-only)\b/)?.[1];
  const listed = (text.match(/\nFrameworks:\s*([^\n]+)/)?.[1] || '').toLowerCase();
  const markers = foreignMarkers(), out = [];
  const missing = [...markers].filter(([ns]) => !(mode && listed.includes(ns)));
  if (missing.length) {
    const byFile = new Map();
    for (const [ns, f] of missing) byFile.set(f, [...(byFile.get(f) || []), ns]);
    out.push(`coexistence: another agent framework appeared and coexistence is not configured for it (${[...byFile].map(([f, ns]) => `${ns.join(', ')} in ${f}`).join('; ')}). Ask: keep Waymark leading (classify its rules into ~/.waymark/coexistence.md, mode waymark-leads) or make Waymark its guest (no Waymark hooks or block). waymark/references/coexistence.md; never edit its rules.`);
  }
  const names = listed.split(';').map((s) => s.split('·')[0].trim()).filter(Boolean);
  const gone = names.filter((n) => ![...markers.keys()].some((ns) => n.includes(ns) || ns.includes(n)));
  if (mode && gone.length && gone.length === names.length) out.push(`coexistence: the framework(s) in ~/.waymark/coexistence.md (${gone.join(', ')}) no longer show markers. Ask whether they were uninstalled; if yes, offer the full install back (remove coexistence.md).`);
  return out.join('\n');
}

function session(cwd, agent) {
  const file = agent.sessions?.(cwd)?.[0];
  if (!file) return '';
  const st = sessionState(readTail(file));
  if (st.context < RESUME_TOKENS) return '';
  const idle = st.lastAt ? Math.round((Date.now() - st.lastAt) / 60000) : 0;
  return `session: the latest session here holds ~${Math.round(st.context / 1000)}k tokens of context${idle >= CACHE_MINUTES ? ` and was idle ${idle} min: resuming it re-writes all of it (the prompt cache expired)` : ': each response re-reads all of it'}. A new task is cheaper in a new session (project memory carries over).`;
}

// → the pending items, one line each ([] when nothing is pending). Records the time of the check.
export async function check(cwd = process.cwd(), agent = agentFrom()) {
  const items = [];
  const add = async (f) => { try { const t = await f(); if (t) items.push(...String(t).split('\n')); } catch {} };
  await add(update);
  await add(() => skills(cwd));
  await add(() => mcpFit(cwd));
  await add(skillFit);
  await add(() => migration(cwd));
  await add(() => packageManager(cwd));
  await add(() => suggestedRules(cwd));
  await add(agents);
  await add(frameworks);
  await add(() => session(cwd, agent));
  try {
    const st = readJson(path.join(HOME(), '.check.json')) || {};
    fs.mkdirSync(HOME(), { recursive: true });
    fs.writeFileSync(path.join(HOME(), '.check.json'), JSON.stringify({ ...st, checkedAt: Date.now() }));
  } catch {}
  return items;
}

// The package manager memory.md names (Identity, Quality gates) against the repo's own: package.json `packageManager`,
// else the lockfile. → the pending line, or '' when they agree or either is unknown.
export function packageManager(cwd) {
  const home = projectHome(cwd), root = home.root;
  const s = stackOf(root);
  if (!s?.pm || s.from === 'default') return '';
  const real = s.pm;
  const mem = read(home.memory);
  const said = mem.match(/Package manager[^:\n]*:\s*([a-z]+)/i)?.[1]?.toLowerCase();
  const gates = section('\n' + mem, 'Quality gates').filter((l) => l.startsWith('|')).map((l) => l.split('|')[2] || '').join(' ');
  const used = [...new Set([...gates.matchAll(/(?:^|[\s`])(npx|npm|pnpm|yarn|bunx?)\b/g)].map((m) => m[1].replace(/^npx$/, 'npm').replace(/^bunx$/, 'bun')))];
  const off = [said && said !== real ? `Identity says ${said}` : '', used.some((u) => u !== real) ? `Quality gates use ${used.filter((u) => u !== real).join(', ')}` : ''].filter(Boolean);
  return off.length ? `package manager: this repo uses ${real} (${s.from === 'package.json packageManager' ? s.from : 'its lockfile'}) but ${home.memory.replace(/\\/g, '/')} ${off.join(' and ')}. Offer to correct Identity and the Quality gates rows to ${real} (each gate re-run once and marked verified).` : '';
}

// A testigo that failed 3 times or more in this project: offer to turn its lesson into a department or stack rule.
export function suggestedRules(cwd) {
  const { rules } = incidentsAt(cwd);
  return rules.length ? `rule: ${rules.map((r) => `${r.label} failed ${r.failures}× (last ${r.ids[r.ids.length - 1]})`).join('; ')} in this project. Offer to add the lesson as a rule of the owner department or the stack profile (${script('waymark.mjs')} incidents shows the causes); write it only after the user's yes.` : '';
}

// Per file, the last tasks that changed it, newest first: from `git log -- <file>` and the records of those commits (a
// note, or a stub's commits), plus the records of tasks without a commit that list the file. A commit no task recorded
// is shown too (a change made by hand). → text.
export function pack(cwd, files, per = 3) {
  const home = projectHome(cwd), root = home.root;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', timeout: 5000 });
  const records = readRecords(home.log).filter((r) => r.id);
  const out = [];
  for (const file of files) {
    const abs = path.resolve(cwd, file), rel = path.relative(root, abs).replace(/\\/g, '/');
    const log = git('log', '-n', '20', '--format=%H%x1f%ct%x1f%s', '--', rel).stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\x1f'));
    const notes = readNotes(root, log.map(([h]) => h));
    const byCommit = new Map(records.flatMap((r) => (r.commits || []).map((c) => [c, r])));
    const seen = new Set(), rows = [];
    const learnedOf = (r) => clipTo(aprendidoOf(String(r.cierre || '').replace(/\*\*|__/g, '')) || r.prompt || '', 120);
    for (const [h, ct, subject] of log) {
      const stub = byCommit.get(h);
      let rec = stub;
      const n = gitNote(stub) && notes.get(gitNote(stub).commit);
      if (n) { try { rec = { ...JSON.parse(n), ...stub }; } catch {} }
      else if (gitNote(stub)) rec = { ...stub, prompt: '(its git note is missing: a rebase or amend?)' };
      if (rec && seen.has(rec.id)) continue;
      if (rec) seen.add(rec.id);
      rows.push({ at: Number(ct) * 1000, text: rec ? `${rec.id} · ${rec.agent || '?'} · ${learnedOf(rec)} · ${h.slice(0, 8)}` : `${h.slice(0, 8)} · ${clipTo(subject, 100)} (no task record)` });
    }
    // tasks with no commit that changed this file
    for (const r of records.filter((x) => !x.commits?.length && !seen.has(x.id) && (x.files || []).some((p) => path.resolve(p).toLowerCase() === abs.toLowerCase()))) {
      seen.add(r.id);
      rows.push({ at: Date.parse(r.at) || 0, text: `${r.id} · ${r.agent || '?'} · ${learnedOf(r)} · (no commit)` });
    }
    const shown = rows.sort((x, y) => y.at - x.at).slice(0, per).map((x) => x.text);
    out.push(`${rel}:${shown.length ? shown.map((x) => `\n  - ${x}`).join('') : ' no earlier task or commit'}`);
  }
  return out.join('\n');
}
const clipTo = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

// One section of the project memory, or the list of its sections.
export function memorySection(cwd, name) {
  const text = read(projectHome(cwd).memory);
  const names = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  if (!name) return `sections: ${names.join(' · ')}`;
  const hit = names.find((n) => n.toLowerCase().startsWith(name.toLowerCase()));
  return hit ? `## ${hit}\n${section('\n' + text, hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\n')}` : `no section "${name}" (sections: ${names.join(' · ')})`;
}

// One line per task record, newest first: "<id> · <agent> · <result> · <score> · <request>"; with an ID, its whole record.
export function tasks(cwd = process.cwd(), id = null) {
  const records = readTaskRecords(projectHome(cwd)).filter((r) => r.id);
  if (id) { const r = records.filter((x) => x.id === id).pop(); return r ? JSON.stringify(r, null, 2) : `no record for ${id}`; }
  const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return records.reverse().map((r) => [r.id, r.agent || '?', cell((r.cierre || '').match(/Resultado:[ \t]*([^·\n]*)/i)?.[1]) || '?', r.evaluation?.score || '—', cell(r.prompt).slice(0, 80)]
    .join(' · ') + (r.noteMissing ? ' · (note missing)' : '')).join('\n') || 'no task recorded yet';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sub = 'check', ...rest] = process.argv.slice(2).filter((a, i, all) => a !== '--agent' && all[i - 1] !== '--agent');
  if (sub === 'check') {
    const items = await check(process.cwd());
    console.log(items.length ? `Waymark check · ${items.length} pending (offer each with the choice window; run its command only after the user's yes):\n${items.map((t) => `- ${t}`).join('\n')}` : 'Waymark check: nothing pending.');
  } else if (sub === 'tasks') {
    console.log(tasks(process.cwd(), rest[0] || null));
  } else if (sub === 'tidy') {
    const home = projectHome(process.cwd());
    const changed = tidyWip(home);
    if (changed) refreshTasks(home, true);
    console.log(changed ? `Work in progress tidied (${home.memory}); moved lines: ${home.dir}/history.md` : 'Work in progress: nothing to tidy');
  } else if (sub === 'pack') {
    console.log(rest.length ? pack(process.cwd(), rest) : 'Usage: node waymark.mjs pack <file…>');
  } else if (sub === 'memory') {
    console.log(memorySection(process.cwd(), rest.join(' ')));
  } else if (sub === 'incidents') {
    const { open, rules } = incidentsAt(process.cwd());
    console.log([...open.map((o) => `open: ${o.label} ✘${o.count > 1 ? `×${o.count}` : ''} since ${o.since}, last ${o.last}${o.cause ? ` · ${o.cause}` : ''}`), ...rules.map((r) => `suggested rule: ${r.label} failed ${r.failures}× (${r.ids.slice(-3).join(', ')})`)].join('\n') || 'no incidents');
  } else if (sub === 'done') {
    const at = rest.indexOf('--note'), note = at >= 0 ? rest.slice(at + 1).join(' ') : '';
    const ids = (at >= 0 ? rest.slice(0, at) : rest).join(' ').match(new RegExp(ID.source, 'g')) || [];
    const home = projectHome(process.cwd());
    const done = ids.length ? confirmTasks(home, ids, { note }) : [];
    if (done.length) refreshTasks(home, true);
    console.log(done.length ? `confirmed by the user: ${done.join(', ')} (✔ in ${home.memory}; record kind "confirm")` : 'Usage: node waymark.mjs done "<task ID>" ["<task ID>"…] [--note "<the user\'s words>"] (no matching Work in progress line)');
    process.exitCode = done.length ? 0 : 1;
  } else if (sub === 'notes' && rest[0] === 'push') {
    const r = pushNotes(process.cwd(), rest[1] || 'origin');
    console.log(r.output || (r.ok ? 'notes pushed' : 'notes push failed'));
    process.exitCode = r.ok ? 0 : 1;
  } else if (COMMANDS[sub]) {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, COMMANDS[sub]), ...rest], { stdio: 'inherit' });
    if (sub === 'sync' && r.status === 0 && !rest.includes('--dry-run')) { // remember the skills seen from this folder
      const all = readJson(sigFile()) || {};
      fs.mkdirSync(HOME(), { recursive: true });
      fs.writeFileSync(sigFile(), JSON.stringify({ ...all, [norm(process.cwd())]: skillNames(process.cwd()) }));
    }
    process.exitCode = r.status ?? 1;
  } else {
    console.log(`Usage: node waymark.mjs [check | tasks [<task ID>] | notes push [<remote>] | tidy | done <task ID…> | pack <file…> | memory [<section>] | incidents | ${Object.keys(COMMANDS).join(' | ')}] [args]`);
    process.exitCode = 1;
  }
}
