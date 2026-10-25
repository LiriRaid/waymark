#!/usr/bin/env node
// Waymark · the on-demand command (docs/adr/0008). Everything that is not a link of the chain lives here instead of in
// the hooks, so every agent runs the same four short hooks. Run it from the project folder:
//   node waymark.mjs [check]            read-only report of what is pending (default)
//   node waymark.mjs sync               refresh skill-registry.md (sync.mjs) and remember the skills seen here
//   node waymark.mjs mcp-fit | skill-fit | migrate | connect | install-hooks | uninstall [args]   the existing scripts, args passed on
//   node waymark.mjs testigos [<task ID>]   re-run the testigos that execute (chain, commit + trailer, secrets, typecheck)
//   node waymark.mjs tasks [<task ID>]      the task records, newest first (git notes + provenance.jsonl); one task → its whole record
//   node waymark.mjs notes push [<remote>] [--always | --never]  send the records (refs/notes/waymark) to the remote (default origin);
//                                         --always: and let the hook push this project's at each close; --never: never offer it here
//   node waymark.mjs notes setup [<remote>] by hand (the session hook adds it in a repo with .waymark/): a fetch refspec so fetches bring the remote's records, fetched at once
//                                           (into refs/notes/remotes/<remote>/waymark, merged at session start), then a fetch
//   node waymark.mjs tidy                   tidy memory.md → Work in progress now (what each close does); moved lines go to history.md
//   node waymark.mjs done <ID…> [--note "…"]  the user confirmed these tasks work: ✔ in Work in progress + a chained {kind: "confirm"} record
//   node waymark.mjs forget <ID> | --session <id> --reason "…" [--apply]  remove records without a commit the user asked to remove: the rest
//                                           chained again and a rewrite anchor in git with the reason (docs/adr/0025); the plan without --apply
//   node waymark.mjs pack <file…>           per file, the last tasks that changed it (git log + their records): ID · agent · Aprendido · commit
//   node waymark.mjs learned [--apply]      move memory.md's learned sections (Solved problems, Gotchas, Decisions) to engram (docs/adr/0015)
//   node waymark.mjs review <file…>         the task's diff against HEAD and the review checklist (the review where the agent has no code-review)
//   node waymark.mjs memory [<section>]     one section of the project memory (Conventions, Identity, Quality gates…); none → the section names
//   node waymark.mjs stack-new <path>       draft a stack profile for a repository with none, from its manifests, scripts and CI (docs/adr/0039)
//   node waymark.mjs gates [--apply]        empty the Quality gates rows that cannot be right (a cut command); the plan without --apply
//   node waymark.mjs copy [<ref>] | --remove <path> | --clean [--apply]  a clean copy of the repo in a short folder Waymark owns (~/.waymark/tmp), its removal, and the folders nobody removed (docs/adr/0046)
//   node waymark.mjs localize [--apply]     move Waymark's lines out of the project's versioned .gitignore into .git/info/exclude (docs/adr/0043); the plan without --apply
//   node waymark.mjs convention [<path>] [--move <from> <to>]  where each kind of piece lives in the repo, the commit that set it, and the verdict of a proposed move (docs/adr/0043)
//   node waymark.mjs adapter-new <agent> [flags] [--install]  draft the adapter of a known agent with none and run the conformance suite on it (docs/adr/0039)
//   node waymark.mjs incidents              open incidents (a testigo ✘ not yet ✔ in a later task) and suggested rules (3 failures or more)
// `check` reports, one line each, only what is pending: a newer Waymark VERSION, skills added or removed since the last
// sync, framework MCP servers that do not fit this project, skills never used, memory still in the old location, other
// agents not connected or without Waymark's hooks (Claude Code included), project skills versioned in .claude/skills, an
// agent framework that appeared or vanished, and a large idle session in this folder. It
// writes nothing but the time of the check (~/.waymark/.check.json, read by the session hook's weekly pointer).
// Every item is offered to the user with the choice window; its command runs only after their yes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTail, sessionState } from './transcript.mjs';
import { projectHome, workspaceSiblings, readTaskRecords, readRecords, readNotes, gitNote, aprendidoOf, tidyWip, refreshTasks, confirmTasks, hookErrorsFile, forget, ensureLocal, LOCAL_DIRS, ID } from './provenance.mjs';
import { incidentsAt, incidents } from './incidents.mjs';
import { proposals, ownerOf } from './learn.mjs';
import { openIds } from './session-hook.mjs';
import { pushNotes, notesSetup, hasRemote, hasFetchSpec, unpushedNotes, hasNotes } from './notes.mjs';
import { pushPref, savePushPref } from './notes-remote.mjs';
import { stackOf, rowProblem } from './stack.mjs';
import { found } from './connect-agents.mjs';
import { registered } from './install-hooks.mjs';
import { agentFrom } from './agents/index.mjs';
import { claudeDir } from './agents/paths.mjs';
import { engramBin, engramStatus, enginePin } from './engram.mjs';
import { learnedEntries } from './learned.mjs';
import { trackedProjectSkills } from './skill-links.mjs';
import { waymarkHome as HOME, norm } from './lib/paths.mjs';
import { makeCopy, removeCopy, orphans, cleanOrphans, copyRoot } from './copy.mjs';
import { read, readJson } from './lib/fs.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const script = (name) => path.join(SCRIPTS, name).replace(/\\/g, '/');
const W = `node "${script('waymark.mjs')}"`; // the full command every usage line prints (waymark.mjs is no program on the PATH)
const section = (text, title) => {
  const m = text.match(new RegExp(`\\n## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('<!--')) : [];
};
const RESUME_TOKENS = 150000, CACHE_MINUTES = 60; // above this context, a resume after the prompt cache expired re-writes it all
export const COMMANDS = { sync: 'sync.mjs', 'mcp-fit': 'mcp-fit.mjs', 'skill-fit': 'skill-fit.mjs', migrate: 'migrate-memory.mjs', connect: 'connect-agents.mjs', 'install-hooks': 'install-hooks.mjs', testigos: 'testigos.mjs', size: 'size.mjs', learned: 'learned.mjs', cost: 'cost.mjs', precedent: 'precedent.mjs', sign: 'sign.mjs', scorecard: 'scorecard.mjs', 'stack-new': 'stack-new.mjs', 'adapter-new': 'adapter-new.mjs', convention: 'convention.mjs', uninstall: 'uninstall.mjs' };

export const newer = (a, b) => {
  const pa = String(a).trim().split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).trim().split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

export async function update() {
  const repo = process.env.WAYMARK_REPO || 'LiriRaid/waymark';
  const installed = read(path.join(SCRIPTS, '..', 'VERSION')).trim();
  try {
    // WAYMARK_UPDATE_URL points the check at another file holding the version (the tests serve one from localhost)
    const res = await fetch(process.env.WAYMARK_UPDATE_URL || `https://raw.githubusercontent.com/${repo}/main/skills/waymark/VERSION`, { signal: AbortSignal.timeout(3000) });
    const latest = res.ok ? (await res.text()).trim() : '';
    if (installed && latest && newer(latest, installed)) return `update: Waymark ${installed} → ${latest}. Offer it (Actualizar ahora / Más tarde / Ver cambios): "Actualizar ahora" → INSTALL.md §9 from https://github.com/${repo}; "Ver cambios" → CHANGELOG.md entries since ${installed}.`;
  } catch {}
  return '';
}

// Skill folders sync.mjs indexes: Waymark's own, other agents', the project's.
export function skillNames(cwd) {
  const roots = [path.resolve(SCRIPTS, '..', '..'), ...['.claude', '.agents', '.codex', '.cursor', '.gemini', '.config/opencode'].map((d) => path.join(os.homedir(), ...d.split('/'), 'skills')),
    ...['.claude', '.agents', '.codex', '.cursor', '.gemini', '.opencode'].map((d) => path.join(cwd, d, 'skills'))];
  return [...new Set(roots)].flatMap((r) => { try { return fs.readdirSync(r).filter((n) => !/^[._]/.test(n) && fs.existsSync(path.join(r, n, 'SKILL.md'))).map((n) => `${norm(r)}/${n}`); } catch { return []; } }).sort();
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

// What `check` says when the engram on this machine is not the release Waymark pinned (docs/adr/0036); nothing when it is.
function engramPinLines(st) {
  const short = (h) => `${String(h).slice(0, 12)}…`;
  if (st.state === 'version') return [`engram: ${st.version || 'an unknown version'} is installed and Waymark was tested with ${st.pinned} (skills/waymark/engram.pin.json): the learned layer may behave differently. Install ${st.entry.archive} from the release (archive sha256 ${short(st.entry.archiveSha256)}) or move the pin on purpose.`];
  if (st.state === 'binary') return [`engram: ${st.file} reports ${st.version} but its sha256 ${short(st.sha256)} is not the published release's (${short(st.entry.binarySha256)}): a build that is not ${st.entry.archive}. Reinstall it from the release and compare the archive with its sha256 ${short(st.entry.archiveSha256)}.`];
  if (st.state === 'platform') return [`engram: the pin (skills/waymark/engram.pin.json) has no entry for ${st.platform}, so ${st.version || 'this engram'} cannot be compared with a release: add the sha256 of that release's archive and binary to the pin.`];
  if (st.state === 'unpinned') return ['engram: skills/waymark/engram.pin.json is missing or unreadable, so the engram on this machine is not checked against a release.'];
  return [];
}

// The learned layer (docs/adr/0015): engram installed, and memory.md without the learned sections engram replaced.
function learnedLayer(cwd) {
  const out = [];
  const pin = enginePin();
  if (!engramBin()) out.push(`engram: not installed. The learned layer (docs/adr/0015) needs it: engram_${pin?.version || '<version>'}_<os>_<arch> from https://github.com/Gentleman-Programming/engram/releases (the archive's sha256 is in ${pin ? "skills/waymark/engram.pin.json and in the release's checksums.txt" : 'checksums.txt'}), on the PATH; then each agent's MCP with engram setup <claude-code|codex|opencode|gemini-cli>. Until then Waymark keeps git and memory.md.`);
  else out.push(...engramPinLines(engramStatus(pin)));
  const home = projectHome(cwd);
  try {
    const n = home.legacy ? 0 : learnedEntries(read(home.memory)).length;
    if (n) out.push(`learned: ${home.memory.replace(/\\/g, '/')} still holds ${n} learned entries (Solved problems, Gotchas, Decisions), which now live in engram: node "${script('waymark.mjs')}" learned shows the plan, --apply on yes (history.md keeps their text).`);
  } catch {}
  return out.join('\n');
}

// Each registered hook run as its agent runs it, with a probe: a hook that does not answer runs nothing (a moved or
// linked install, a path that no longer exists), and then no task is recorded.
export function hooksHealth(list = registered()) {
  const dead = [];
  for (const { agent, commands } of list) {
    for (const c of commands) {
      if (!/^\s*node\s/.test(c)) continue;
      // the launcher and the hook script it runs are both quoted paths: everything after `node` is the argument list
      const args = [...c.replace(/^\s*node\s+/, '').matchAll(/"([^"]*)"|(\S+)/g)].map((t) => t[1] ?? t[2]);
      const r = spawnSync(process.execPath, args, { input: '{"waymark_probe":true}', cwd: os.tmpdir(), encoding: 'utf8', timeout: 50000 });
      if (!String(r.stdout || '').includes('"waymark_probe":"ok"')) dead.push(`${agent} ${path.basename(args.find((t) => /-hook\.mjs$/.test(t)) || args[0])}`);
    }
  }
  return dead.length ? `hooks: not answering: ${[...new Set(dead)].join(', ')} — tasks there are not recorded. Re-register them: node "${script('install-hooks.mjs')}" --agent <agent> (plan), then --apply.` : '';
}

// The task records ride as git notes on their commits; a squash or rebase merge on GitHub re-creates the commits and
// leaves the notes behind. → the pending line when the project's GitHub repo allows either (read-only gh api call).
export function mergeMethods(cwd) {
  if (process.env.WAYMARK_NO_GH) return '';
  const root = projectHome(cwd).root;
  if (spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/notes/waymark'], { cwd: root, timeout: 3000 }).status !== 0) return '';
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: 3000 }).stdout || '';
  const repo = url.trim().match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1];
  if (!repo) return '';
  const r = spawnSync('gh', ['api', `repos/${repo}`, '--jq', '[.allow_squash_merge, .allow_rebase_merge] | @json'], { encoding: 'utf8', timeout: 8000 });
  let flags = null;
  try { flags = JSON.parse(String(r.stdout || '').trim()); } catch { return ''; }
  if (!Array.isArray(flags) || !flags.some(Boolean)) return '';
  return `notes: ${repo} allows ${['squash', 'rebase'].filter((_, i) => flags[i]).join(' and ')} merges, which re-create the commits and leave the task records (git notes) behind. Merge pull requests with a merge commit, or allow only that (the user's setting: ask first): gh api -X PATCH repos/${repo} -F allow_squash_merge=false -F allow_rebase_merge=false`;
}

function agents(list = found()) {
  const fresh = list.filter((a) => !a.connected && a.path && !a.shares); // an instructions file to write the block in
  const stale = fresh.filter((a) => a.full && /waymark:(pointer|begin)/.test(read(a.path)));
  if (stale.length === fresh.length && stale.length) return `connect: ${stale.map((a) => a.name).join(', ')} run${stale.length > 1 ? '' : 's'} Waymark's hooks but ${stale.length > 1 ? 'have' : 'has'} the pointer or an older Rule 0 block in ${stale.map((a) => a.path.replace(/\\/g, '/')).join(', ')}: offer to write the current block: node "${script('connect-agents.mjs')}" --apply`;
  return fresh.length ? `connect: other agents not connected to the project memory: ${fresh.map((a) => `${a.name} (${a.path.replace(/\\/g, '/')}${a.guestOf.length ? `; ${a.guestOf.join(', ')} governs it: Waymark joins as its guest` : ''})`).join(', ')}. One marked line in each one's instructions file so it reads .waymark/tasks.md first: node "${script('connect-agents.mjs')}" shows the plan, --apply on yes (backup first).` : '';
}

// Agents on this machine whose hooks do not run Waymark (Claude Code when its folder exists, and every agent connect-agents
// finds): their tasks are neither recorded nor checked. None in a coexistence where the orchestrator owns the hooks.
export function hookless(list = found()) {
  if (orchestrated()) return '';
  const have = new Set(registered().map((r) => r.agent));
  const missing = [...(fs.existsSync(claudeDir()) ? [{ name: 'Claude Code', key: 'claude' }] : []), ...list.filter((a) => a.adapter)].filter((a) => !have.has(a.key));
  return missing.length ? `hooks: ${missing.map((a) => `${a.name} (--agent ${a.key})`).join(', ')} on this machine without Waymark's hooks: tasks there are neither recorded nor checked. Offer each: node "${script('install-hooks.mjs')}" --agent <agent> shows its plan, --apply on yes.` : '';
}
const orchestrated = () => ['guest', 'skills-only', 'other-leads'].includes(read(path.join(HOME(), 'coexistence.md')).match(/^Mode:\s*(\S+)/m)?.[1]);

// Agents on this machine with no adapter (docs/adr/0022): one agents.json lists with documented hooks, and the unknown
// ones. Waymark cannot run their hooks until a module is written for each (dept-devex procedures → Add an agent).
export function adapterless(all = found()) {
  if (orchestrated()) return '';
  const list = all.filter((a) => !a.adapter && (a.unknown || a.hooks));
  if (!list.length) return '';
  const label = (a) => (a.unknown ? `${a.name} (unknown: ${a.signals.join(', ')})` : `${a.name} (${a.dir.replace(/\\/g, '/')})`);
  return `agents: ${list.map(label).join(', ')} on this machine with no Waymark adapter: their tasks are neither recorded nor checked (the pointer still shows where the work stands). Offer, one agent at a time, to draft its adapter with the user's yes: node "${script('waymark.mjs')}" adapter-new <agent> (from templates/agent-adapter.template.mjs and its documentation; it runs the conformance suite on the draft and installs only what passes). By hand: dept-devex procedures → Add an agent.`;
}

// Project skills versioned in git under .claude/skills: the session hook leaves them there (moving them would change
// the repository), so Claude Code reads them but the other agents do not.
export function projectSkills(cwd) {
  const home = projectHome(cwd);
  const names = home.dir && !home.legacy ? trackedProjectSkills(home.root) : [];
  return names.length ? `project skills: ${names.join(', ')} versioned in git in .claude/skills, left in place (only Claude Code reads them there). To share them with every agent, move them to .agents/skills in a commit of the user's choice.` : '';
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

// Waymark's own ignore lines in the project's versioned .gitignore: before 2.0.19 it wrote them there (docs/adr/0043 moves them to
// .git/info/exclude, which is never part of the repo). → { home, file, text, found } or null.
const ignoreBlock = ([dir, what]) => new RegExp(`^# ${what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, local only\\r?\\n${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n?`, 'm');
export function ignoreLines(cwd) {
  const home = projectHome(cwd);
  if (!home.dir || home.legacy) return null;
  const file = path.join(home.root, '.gitignore'), text = read(file);
  const found = LOCAL_DIRS.filter((d) => ignoreBlock(d).test(text));
  return found.length ? { home, file, text, found } : null;
}
// What Waymark wrote in the user's repo that the user did not ask for. → the line, or ''.
export function footprint(cwd) {
  const at = ignoreLines(cwd);
  if (!at) return '';
  const spec = hasFetchSpec(at.home.root) ? ' Also in .git/config: the notes fetch refspec (local to this clone, never versioned).' : '';
  return `repo: Waymark wrote ${at.found.length} ignore block${at.found.length > 1 ? 's' : ''} (${at.found.map(([d]) => d).join(' ')}) into this project's versioned .gitignore, so they show as a change of the project's own files. Offer, with the choice window: ${W} localize shows the plan and --apply moves them to .git/info/exclude (this clone only); the .gitignore change that leaves is the user's to commit or discard.${spec}`;
}
// Moves those blocks out of the versioned .gitignore into .git/info/exclude. A .gitignore Waymark created and nothing else holds is removed.
export function localize(cwd, { apply = false } = {}) {
  const at = ignoreLines(cwd);
  if (!at) return { moved: [] };
  if (!apply) return { moved: at.found.map(([d]) => d), plan: true };
  let text = at.text;
  for (const d of at.found) text = text.replace(ignoreBlock(d), '');
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.gitignore'], { cwd: at.home.root, encoding: 'utf8' }).status === 0;
  if (!text.trim() && !tracked) fs.rmSync(at.file, { force: true }); else fs.writeFileSync(at.file, text);
  ensureLocal(at.home); // after the lines left .gitignore, or they would count as already ignored there
  return { moved: at.found.map(([d]) => d) };
}

// The Quality gates rows that cannot be right in this repo (stack.mjs rowProblem: a cut command such as `tsc -p ts`). → [{ gate, cmd, why }]
export function brokenGates(cwd) {
  const home = projectHome(cwd);
  if (!home.dir || home.legacy) return [];
  return section('\n' + read(home.memory), 'Quality gates').filter((l) => l.startsWith('|') && !/^\|\s*(Gate|---)/.test(l))
    .map((l) => l.split('|').slice(1, 3).map((s) => s.replace(/`/g, '').trim())).map(([gate, cmd]) => ({ gate, cmd, why: rowProblem(cmd, home.root) })).filter((r) => r.why);
}
// Folders nobody removed: copies in Waymark's root and the improvised or test ones in the temp folder and at the top of the disk (docs/adr/0046).
export function copiesLine(list = orphans()) {
  if (!list.length) return '';
  const own = list.filter((o) => path.resolve(o.path).startsWith(path.resolve(copyRoot()))).length;
  return `copies: ${list.length} folder${list.length > 1 ? 's' : ''} left behind (${own} in Waymark's copy root, ${list.length - own} improvised or from a test run: ${list.slice(0, 3).map((o) => path.basename(o.path)).join(', ')}${list.length > 3 ? '…' : ''}). Offer, with the choice window: ${W} copy --clean shows them and --apply removes them (they hold no learning: the result went to the task's record).`;
}
export function gatesLine(cwd) {
  const bad = brokenGates(cwd);
  return bad.length ? `gates: ${bad.length} Quality gates row${bad.length > 1 ? 's' : ''} in memory.md cannot be right (${bad.map((r) => `${r.gate}: \`${r.cmd}\` ${r.why}`).join('; ')}). The hook ignores them already. Offer, with the choice window: ${W} gates shows the plan and --apply empties each cell, so the next gate that passes fills it.` : '';
}
// Empties the Command and Verified cells of those rows (the learning step fills an empty row with the gate that passes next).
export function repairGates(cwd, { apply = false } = {}) {
  const bad = brokenGates(cwd);
  if (!bad.length || !apply) return { rows: bad, applied: false };
  const home = projectHome(cwd);
  let text = read(home.memory);
  for (const r of bad) text = text.replace(new RegExp(`^\\|\\s*${r.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|[^\\n]*$`, 'm'), (row) => (row.split('|')[2]?.replace(/`/g, '').trim() === r.cmd ? `| ${r.gate} | | |` : row));
  fs.writeFileSync(home.memory, text);
  return { rows: bad, applied: true };
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
  await add(() => learnedLayer(cwd));
  await add(() => packageManager(cwd));
  await add(() => suggestedRules(cwd));
  await add(() => learnProposals(cwd));
  await add(() => openTasks(cwd));
  let machine = null; // the agents on this machine, scanned once for the three lines below
  const onMachine = () => (machine ??= found());
  await add(() => agents(onMachine()));
  await add(() => hookless(onMachine()));
  await add(() => adapterless(onMachine()));
  await add(() => projectSkills(cwd));
  await add(() => hooksHealth());
  await add(() => hookErrors());
  await add(() => mergeMethods(cwd));
  await add(() => notesState(cwd));
  await add(() => footprint(cwd));
  await add(() => gatesLine(cwd));
  await add(() => copiesLine());
  await add(frameworks);
  await add(() => session(cwd, agent));
  try {
    const st = readJson(path.join(HOME(), '.check.json')) || {};
    fs.mkdirSync(HOME(), { recursive: true });
    fs.writeFileSync(path.join(HOME(), '.check.json'), JSON.stringify({ ...st, checkedAt: Date.now() }));
  } catch {}
  return items;
}

// The task records (git notes) against origin, without network: a project whose fetches do not bring them (a clone
// brings branches only) and note commits not pushed yet. → the pending lines, or ''.
export function notesState(cwd) {
  const home = projectHome(cwd), root = home.root;
  if (!home.dir || home.legacy || !hasRemote(root)) return '';
  if (!hasFetchSpec(root)) return `notes: fetches from origin here do not bring the task records (git notes; a clone brings branches only), so another machine's tasks are missing from tasks.md and the card. Offer, with the choice window: node "${script('waymark.mjs')}" notes setup — adds one fetch refspec to .git/config (into refs/notes/remotes/origin/waymark, never over the local notes), fetches and merges.`;
  const n = unpushedNotes(root);
  if (!(n > 0 || (n === null && hasNotes(root))) || pushPref(home.slug)) return ''; // 'yes': the hook pushes them at the next close; 'never': the user said no for this project; null: the remote has no notes yet
  return `notes: ${n === null ? 'the' : `${n} commit${n > 1 ? 's' : ''} of`} task records (git notes) ${n === null ? 'were never pushed to origin' : 'not pushed to origin'}. They hold the user's requests and Cierres, and a public remote publishes them. Offer, with the choice window: push once and keep pushing this project's notes at each close (node "${script('waymark.mjs')}" notes push --always), push once (notes push), or never for this project (notes push --never).`;
}

// A hook's own failures (provenance.mjs logHookError) of the last 7 days: their count and the newest. → the line, or ''.
export function hookErrors(now = Date.now()) {
  let lines = [];
  try { lines = fs.readFileSync(hookErrorsFile(), 'utf8').split('\n').filter(Boolean); } catch { return ''; }
  const recent = lines.filter((l) => now - (Date.parse(l.split(' ')[0]) || 0) < 7 * 86400000);
  if (!recent.length) return '';
  return `hooks: ${recent.length} error${recent.length > 1 ? 's' : ''} in the last 7 days (${hookErrorsFile().replace(/\\/g, '/')}); newest: ${recent[recent.length - 1].slice(0, 200)}`;
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
  const records = readTaskRecords(projectHome(cwd)), { rules } = incidents(records);
  const owner = (r) => { const d = ownerOf(records, r.ids); return d ? ` → ${d} (${d}/SKILL.md → Learned rules)` : ''; };
  return rules.length ? `rule: ${rules.map((r) => `${r.label} failed ${r.failures}× (last ${r.ids[r.ids.length - 1]})${owner(r)}`).join('; ')} in this project. Offer to add the lesson as a Learned rule of the owner department, or to the stack profile (${script('waymark.mjs')} incidents shows the causes); write it only after the user's yes.` : '';
}

// A repeated procedure with no project skill, and a correction the user repeated (docs/adr/0023): proposed, never written.
export function learnProposals(cwd) {
  const home = projectHome(cwd);
  if (!home.dir || home.legacy) return '';
  const all = proposals(home, readTaskRecords(home)), lines = [];
  for (const p of all.filter((x) => x.kind === 'skill')) lines.push(`procedure: ${p.text.replace(/^project skill for /, '')}. Offer a project skill for it with the user's yes; the count is in memory.md → Repeated procedures.`);
  for (const p of all.filter((x) => x.kind === 'preference')) lines.push(`preference: ${p.text.replace(/^preference /, '')}. The user corrected this more than once: offer to add it to ~/.waymark/preferences.md with their yes.`);
  return lines.join('\n');
}

// The tasks still open (▶, or an older pending "[<id>]") in Work in progress: the card lists them, check asks the user
// which already work. → the pending line, or ''.
export function openTasks(cwd) {
  const home = projectHome(cwd);
  const open = openIds(section('\n' + read(home.memory), 'Work in progress'));
  return open.length ? `open: ${open.join(', ')} in Work in progress. Ask the user once, in the choice window (multi-select), which already work; close those with node "${script('waymark.mjs')}" done "<ID>"… --note "<their words>".` : '';
}

// Per file, the last tasks that changed it, newest first: from `git log -- <file>` and the records of those commits (a
// note, read even with no local log, a stub's commits, or the recorded task the commit's trailer names), plus the
// records of tasks without a commit that list the file. A commit no task recorded is shown too (a change made by hand).
// → text.
export function pack(cwd, files, per = 3) {
  const home = projectHome(cwd), root = home.root;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', timeout: 5000 });
  const records = readRecords(home.log).filter((r) => r.id);
  const out = [];
  for (const file of files) {
    const abs = path.resolve(cwd, file), rel = path.relative(root, abs).replace(/\\/g, '/');
    const log = git('log', '-n', '20', '--format=%H%x1f%ct%x1f%s%x1f%B%x1e', '--', rel).stdout.split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => l.split('\x1f'));
    const notes = readNotes(root, log.map(([h]) => h));
    const byCommit = new Map(records.flatMap((r) => (r.commits || []).map((c) => [c, r])));
    const byId = new Map(records.map((r) => [r.id, r]));
    const seen = new Set(), rows = [];
    const learnedOf = (r) => clipTo(aprendidoOf(String(r.cierre || '').replace(/\*\*|__/g, '')) || r.prompt || '', 120);
    for (const [h, ct, subject, body = ''] of log) {
      // the commit's record: its stub here; else its note alone (a clone without this machine's log); else the
      // recorded task its trailer names (committed later by another task)
      const stub = byCommit.get(h), trailer = body.match(/^\s*Waymark-Task:\s*(.+?)\s*$/im)?.[1];
      let rec = stub;
      const n = notes.get(gitNote(stub)?.commit || h);
      if (n) { try { rec = { ...JSON.parse(n), ...stub }; } catch {} }
      else if (gitNote(stub)) rec = { ...stub, prompt: '(its git note is missing: a rebase or amend?)' };
      else if (!stub && trailer && byId.has(trailer)) rec = byId.get(trailer);
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

// The review where the agent has no code-review skill (Codex, Gemini CLI, OpenCode): the diff of the task's files
// against HEAD (a file git does not track yet: its first lines) and the checklist to review it with. Running it after
// the last code change is the Review testigo's action. → text.
export const REVIEW_CHECKLIST = [
  'Correctness: each change does what the task asked; edge cases (empty, null, limits, errors, concurrency) handled.',
  'Callers: every consumer of a changed export, signature or response shape still works.',
  'Tests: a spec covers the new behavior and fails without it; no test was weakened to pass.',
  'Reuse: no duplicate of an existing helper or component; the smallest change that does it.',
  'Security: no secret in code or logs; input reaching a query, command or HTML is validated or escaped.',
];
export function review(cwd, files) {
  const root = projectHome(cwd).root;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  const out = [];
  for (const file of files) {
    const rel = path.relative(root, path.resolve(cwd, file)).replace(/\\/g, '/');
    const tracked = git('ls-files', '--error-unmatch', '--', rel).status === 0;
    if (tracked) { const d = git('diff', 'HEAD', '--', rel).stdout.trimEnd(); out.push(d || `${rel}: no change against HEAD`); continue; }
    const text = read(path.join(root, rel));
    const lines = text.split('\n');
    out.push(text ? `new file ${rel} (${lines.length} lines)\n${lines.slice(0, 300).map((l) => `+${l}`).join('\n')}${lines.length > 300 ? '\n+…' : ''}` : `${rel}: not found`);
  }
  return `${out.join('\n\n')}\n\nChecklist (fix every finding before the Cierre; a finding you leave goes in Resultado: parcial):\n${REVIEW_CHECKLIST.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
}

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

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const [sub = 'check', ...rest] = process.argv.slice(2).filter((a, i, all) => a !== '--agent' && all[i - 1] !== '--agent');
  if (sub === 'check') {
    const items = await check(process.cwd());
    console.log(items.length ? `Waymark check · ${items.length} pending (offer each with the choice window; run its command only after the user's yes):\n${items.map((t) => `- ${t}`).join('\n')}` : 'Waymark check: nothing pending.');
  } else if (sub === 'tasks' && rest[0] === '--workspace') { // every project of the workspace, this one first
    const here = projectHome(process.cwd());
    for (const h of [here, ...workspaceSiblings(here.root)]) console.log(`## ${path.basename(h.root)}\n${tasks(h.root, null)}\n`);
  } else if (sub === 'tasks') {
    console.log(tasks(process.cwd(), rest[0] || null));
  } else if (sub === 'attest') {
    const { attest } = await import('./attest.mjs');
    const out = rest.indexOf('--out') >= 0 ? rest[rest.indexOf('--out') + 1] : null;
    const id = rest.join(' ').match(ID)?.[0];
    const s = id ? attest(process.cwd(), id) : { error: 'name a task ID' };
    if (s.error) { console.log(`attest: ${s.error}\nUsage: ${W} attest "<task ID>" [--out <file>]`); process.exitCode = 1; }
    else if (out) {
      fs.writeFileSync(out, JSON.stringify(s, null, 1) + '\n');
      const { signAttestation } = await import('./attest.mjs'), sig = signAttestation(out, { interactive: process.stdin.isTTY });
      const signed = sig.state === 'signed' ? `signed (${sig.file})` : sig.state === 'nokey' ? 'not signed: no signing key (run: sign)' : `not signed (${sig.state})`;
      console.log(`attestation of ${id} written to ${out} (${s.subject.length} commit(s)), ${signed}; check it with: ${W} verify --attestation ${out}`);
    }
    else console.log(JSON.stringify(s, null, 1));
  } else if (sub === 'verify') {
    const { verify } = await import('./verify.mjs');
    const r = verify(process.cwd(), rest);
    console.log(['Waymark verify', ...r.lines].join('\n'));
    process.exitCode = r.code;
  } else if (sub === 'tidy') {
    const home = projectHome(process.cwd());
    const changed = tidyWip(home);
    if (changed) refreshTasks(home, true);
    console.log(changed ? `Work in progress tidied (${home.memory}); moved lines: ${home.dir}/history.md` : 'Work in progress: nothing to tidy');
  } else if (sub === 'pack') {
    console.log(rest.length ? pack(process.cwd(), rest) : `Usage: ${W} pack <file…>`);
  } else if (sub === 'review') {
    console.log(rest.length ? review(process.cwd(), rest) : `Usage: ${W} review <file…>   (the task's changed files: their diff against HEAD and the review checklist)`);
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
    console.log(done.length ? `confirmed by the user: ${done.join(', ')} (removed from Work in progress in ${home.memory}; record kind "confirm")` : `Usage: ${W} done "<task ID>" ["<task ID>"…] [--note "<the user's words>"] (no matching Work in progress line)`);
    process.exitCode = done.length ? 0 : 1;
  } else if (sub === 'forget') {
    const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
    const apply = rest.includes('--apply'), session = opt('--session'), reason = opt('--reason') || '';
    const id = rest.join(' ').match(ID)?.[0] || null;
    const home = projectHome(process.cwd());
    const r = forget(process.cwd(), id, { session, reason, dryRun: !apply });
    if (r.error) console.log(`forget: ${r.error}\nUsage: ${W} forget "<task ID>" | --session <id> --reason "<why>" [--apply]`);
    else if (!apply) console.log(`forget (plan, nothing written): removes ${r.removed.join(', ')} from ${home.log} (${r.from.n} → ${r.to.n} records), chains the rest again and anchors the rewrite in git with the reason. Ask the user, then re-run with --apply.`);
    else { refreshTasks(home, true); console.log(`forgotten: ${r.removed.join(', ')} (${r.from.n} → ${r.to.n} records); rewrite anchor in refs/notes/waymark-anchor: "${reason}"`); }
    process.exitCode = r.error ? 1 : 0;
  } else if (sub === 'gates') {
    const r = repairGates(process.cwd(), { apply: rest.includes('--apply') });
    console.log(!r.rows.length ? 'gates: every Quality gates row can be right here' : r.applied ? `gates: emptied ${r.rows.map((x) => x.gate).join(', ')}; the next gate that passes fills them` : `gates (plan, nothing written): empties ${r.rows.map((x) => `${x.gate} (\`${x.cmd}\`: ${x.why})`).join('; ')}. Ask the user, then re-run with --apply.`);
  } else if (sub === 'copy') {
    if (rest[0] === '--remove') {
      const r = rest[1] ? removeCopy(rest[1]) : { error: 'name the copy to remove' };
      console.log(r.error ? `copy: ${r.error}
Usage: ${W} copy --remove <path of the copy>` : r.removed ? `copy: removed ${rest[1]}` : `copy: ${rest[1]} could not be removed (something holds a file there); ${W} copy --clean lists it`);
      process.exitCode = r.removed ? 0 : 1;
    } else if (rest[0] === '--clean') {
      const list = orphans();
      if (!list.length) console.log('copy: no folder left behind');
      else if (!rest.includes('--apply')) console.log(`copy --clean (plan, nothing removed): ${list.length} folder${list.length > 1 ? 's' : ''}, among them ${list.slice(0, 8).map((o) => `${o.path} (${o.ageH} h)`).join('; ')}${list.length > 8 ? `; +${list.length - 8} more` : ''}. Ask the user, then re-run with --apply.`);
      else { const r = cleanOrphans(list); console.log(`copy: removed ${r.removed}${r.left.length ? `; could not remove ${r.left.join(', ')} (in use)` : ''}`); }
    } else {
      const { copyInstall } = await import('./stack.mjs');
      const home = projectHome(process.cwd());
      let install = null;
      try { install = copyInstall(stackOf(home.root)); } catch {}
      const r = makeCopy(process.cwd(), rest[0] || 'HEAD', { install });
      console.log(r.error ? `copy: ${r.error}
Usage: ${W} copy [<ref>] | copy --remove <path> | copy --clean [--apply]` : `${r.path}
A clean copy of ${rest[0] || 'HEAD'} (a short folder Waymark owns).${r.install ? ` In it: ${r.install}, with CI=true in its environment (from the store, no network; never a junction to the repo's node_modules).` : ''} Run what must show its result there, then remove it: ${W} copy --remove "${r.path}" (the task's close removes it too).`);
      process.exitCode = r.error ? 1 : 0;
    }
  } else if (sub === 'localize') {
    const r = localize(process.cwd(), { apply: rest.includes('--apply') });
    console.log(!r.moved.length ? 'localize: nothing of Waymark\'s in this project\'s .gitignore' : r.plan ? `localize (plan, nothing written): moves ${r.moved.join(' ')} from the versioned .gitignore to .git/info/exclude. Ask the user, then re-run with --apply.` : `localize: ${r.moved.join(' ')} now ignored through .git/info/exclude; the .gitignore change is the user's to commit or discard`);
  } else if (sub === 'notes' && rest[0] === 'setup') {
    const r = notesSetup(projectHome(process.cwd()).root, rest[1] || 'origin');
    console.log(r.ok ? `notes: ${r.added ? 'fetch refspec added, ' : 'fetch refspec already there, '}${r.merged ? 'the remote records merged' : 'nothing new to merge'}` : `notes setup failed: ${r.output}`);
    process.exitCode = r.ok ? 0 : 1;
  } else if (sub === 'notes' && rest[0] === 'push') {
    const flag = rest.find((a) => a === '--always' || a === '--never'), slug = projectHome(process.cwd()).slug, remote = rest.slice(1).find((a) => !a.startsWith('--')) || 'origin';
    if (flag === '--never') { savePushPref(slug, 'never'); console.log(`notes: ${slug} will not be offered the push again (Notes push never: in ~/.waymark/preferences.md)`); }
    else {
      const r = pushNotes(process.cwd(), remote);
      console.log(r.output || (r.ok ? 'notes pushed' : 'notes push failed'));
      if (r.ok && flag === '--always') { savePushPref(slug, 'yes'); console.log(`notes: the hook will push ${slug}'s notes to ${remote} at each close (Notes push: in ~/.waymark/preferences.md)`); }
      process.exitCode = r.ok ? 0 : 1;
    }
  } else if (COMMANDS[sub]) {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, COMMANDS[sub]), ...rest], { stdio: 'inherit' });
    if (sub === 'sync' && r.status === 0 && !rest.includes('--dry-run')) { // remember the skills seen from this folder
      const all = readJson(sigFile()) || {};
      fs.mkdirSync(HOME(), { recursive: true });
      fs.writeFileSync(sigFile(), JSON.stringify({ ...all, [norm(process.cwd())]: skillNames(process.cwd()) }));
    }
    process.exitCode = r.status ?? 1;
  } else {
    console.log(`Usage: ${W} [check | tasks [<task ID>] | verify [--install] [--require-signature | --require-signed] [--remote [<remote>]] [--manifest <file>] [--attestation <file>] [<task ID>] | attest <task ID> [--out <file>] | notes push [--always|--never] | notes setup [<remote>] | tidy | done <task ID…> | forget <task ID> --reason "…" [--apply] | pack <file…> | review <file…> | memory [<section>] | incidents | localize [--apply] | gates [--apply] | copy [<ref>] [--remove <path> | --clean [--apply]] |${Object.keys(COMMANDS).join(' | ')}] [args]`);
    process.exitCode = 1;
  }
}
