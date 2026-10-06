#!/usr/bin/env node
// Re-indexes installed skills + MCP servers into skill-registry.md, auto-assigns new skills to a
// department and a capability, and (re)applies the waymark precondition to installed tool skills.
// Third-party skills are indexed too: other agents' skill folders (Cursor, Codex, .agents, Gemini, OpenCode…)
// and project skill folders, with their path so any agent can read and follow them.
// Usage: node sync.mjs [--dry-run] [--unpatch] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const SKILLS_HOME = path.dirname(SKILL_DIR); // the agent's user skills folder (this skill lives inside it)
const CLAUDE = path.join(HOME, '.claude'); // optional extras (plugins, claude.ai skills) when Claude Code is present
const LOCAL = process.env.WAYMARK_HOME || path.join(HOME, '.waymark'); // private layer, agent-neutral
// .agents first: the real copy of a project skill; .claude/skills holds Claude Code's links to it (docs/adr/0017)
const PROJECT_SKILL_DIRS = ['.agents', '.claude', '.codex', '.cursor', '.gemini', '.opencode'].map((d) => [d, 'skills']);
const MAP_FILE = path.join(SKILL_DIR, 'skill-map.json');
const REGISTRY = path.join(SKILL_DIR, 'skill-registry.md');
// Other agents' user-level skill folders; the one Waymark is installed in (SKILLS_HOME) is scanned as 'user'.
const AGENT_SKILL_DIRS = [['claude', '.claude'], ['agents', '.agents'], ['codex', '.codex'], ['cursor', '.cursor'], ['gemini', '.gemini'], ['opencode', '.config/opencode']]
  .map(([label, d]) => [label, path.join(HOME, ...d.split('/'), 'skills')]);
// Community skills Waymark's own tool skills replace (INSTALL §4): indexed as replaced, never used.
const REPLACED = { 'frontend-design': 'ui-build', impeccable: 'ui-refine', 'ui-ux-pro-max': 'ui-system', 'web-design-guidelines': 'ui-audit', 'webapp-testing': 'browser-verify', 'context7-mcp': 'library-docs' };
const dryRun = process.argv.includes('--dry-run');
const unpatch = process.argv.includes('--unpatch');
const quiet = process.argv.includes('--quiet');
const OWN = /^(waymark|dept-[a-z-]+)$/;
const BEGIN = '<!-- waymark:begin -->';
const END = '<!-- waymark:end -->';

const DEPT_KEYWORDS = {
  'dept-frontend': /\b(ui|frontend|component|react|vue|angular|svelte|css|tailwind|layout|page|screen|interface|web app)\b/i,
  'dept-ux-ui': /\b(design|ux|accessib|a11y|wcag|animation|motion|typograph|color|palette|visual|brand)\b/i,
  'dept-backend': /\b(api|backend|server|endpoint|rest|graphql|webhook|queue|job|microservice|rails|nest|django|express)\b/i,
  'dept-data': /\b(database|sql|postgres|mysql|mongo|migration|schema|query|cache|redis|etl|data)\b/i,
  'dept-security': /\b(security|auth|oauth|jwt|vulnerab|owasp|secret|pentest|cve)\b/i,
  'dept-qa': /\b(test|testing|qa|playwright|cypress|jest|vitest|pytest|coverage|review|lint|verify)\b/i,
  'dept-devops': /\b(deploy|docker|kubernetes|ci|cd|pipeline|github actions|terraform|cloud|aws|gcp|azure|git|release)\b/i,
  'dept-architecture': /\b(architecture|refactor|pattern|design pattern|clean code|ddd|hexagonal|modular)\b/i,
  'dept-product': /\b(requirement|user story|prd|roadmap|product|spec|planning)\b/i,
  'dept-devex': /\b(claude|skill|mcp|prompt|agent|documentation|docs|readme|tooling|cli)\b/i,
};

// Capability guessed from the description, in the vocabulary of skill-map.json; first match wins.
const CAP_KEYWORDS = [
  ['review.security', /\b(security review|vulnerab|owasp|pentest|cve|secret scan)\b/i],
  ['review.diff', /\b(code review|review (the )?(diff|changes|pr|pull request)|reviewer)\b/i],
  ['test.browser', /\b(playwright|cypress|e2e|end-to-end|browser test|screenshot)\b/i],
  ['test.unit', /\b(unit test|jest|vitest|pytest|rspec|tdd|test suite)\b/i],
  ['ui.audit', /\b(accessib|a11y|wcag|audit)\b/i],
  ['ui.build', /\b(component|ui|frontend|landing|page|screen|layout)\b/i],
  ['docs.library', /\b(documentation|docs|api reference|library|framework)\b/i],
  ['plan.implementation', /\b(plan|spec|requirement|roadmap|breakdown)\b/i],
  ['git.workflow', /\b(commit|branch|pull request|pr|release|changelog)\b/i],
  ['deploy', /\b(deploy|docker|kubernetes|ci|pipeline|terraform)\b/i],
  ['data.query', /\b(sql|database|migration|schema|query)\b/i],
  ['skills.author', /\b(skill|prompt|agent)\b/i],
];
const guessCapability = (s) => CAP_KEYWORDS.find(([, re]) => re.test(`${s.name.replace(/[-_]/g, ' ')} ${s.description || ''}`))?.[0] || '-';

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function frontmatter(text) {
  const m = text?.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const get = (k) => {
    const line = m[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'));
    return line ? line[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return { name: get('name'), description: get('description') };
}

function scanSkillsDir(dir, origin) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'synced') continue;
    const skillDir = path.join(dir, e.name);
    const file = path.join(skillDir, 'SKILL.md');
    const text = readText(file);
    if (!text) continue;
    const fm = frontmatter(text);
    out.push({ name: fm.name || e.name, description: fm.description, file, origin });
  }
  return out;
}

function discover() {
  const found = [...scanSkillsDir(SKILLS_HOME, 'user')];
  const home = path.resolve(SKILLS_HOME).toLowerCase();
  for (const [label, dir] of AGENT_SKILL_DIRS) {
    if (path.resolve(dir).toLowerCase() !== home) found.push(...scanSkillsDir(dir, `foreign:${label}`));
  }
  const synced = path.join(CLAUDE, 'skills', 'synced');
  for (const bucket of fs.existsSync(synced) ? fs.readdirSync(synced) : []) {
    found.push(...scanSkillsDir(path.join(synced, bucket), 'claude.ai'));
  }
  const plugins = readJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'));
  const enabled = readJson(path.join(CLAUDE, 'settings.json'))?.enabledPlugins || {};
  for (const [id, installs] of Object.entries(plugins?.plugins || {})) {
    if (enabled[id] === false) continue;
    for (const inst of [].concat(installs)) {
      if (inst?.installPath) found.push(...scanSkillsDir(path.join(inst.installPath, 'skills'), `plugin:${id}`));
    }
  }
  const projects = [];
  for (const f of fs.existsSync(path.join(LOCAL, 'projects')) ? fs.readdirSync(path.join(LOCAL, 'projects')) : []) {
    const p = readText(path.join(LOCAL, 'projects', f))?.match(/^Path:\s*(.+)$/m)?.[1]?.trim();
    if (p) for (const d of PROJECT_SKILL_DIRS) for (const s of scanSkillsDir(path.join(p, ...d), `project:${path.basename(p)}`)) projects.push(s);
  }
  // a skill reached through a link and through its real folder is listed once
  const real = (file) => { try { return fs.realpathSync(file).toLowerCase(); } catch { return file; } };
  const once = new Set();
  projects.splice(0, projects.length, ...projects.filter((s) => !once.has(real(s.file)) && once.add(real(s.file))));
  const seen = new Map();
  for (const s of found) if (!seen.has(s.name)) seen.set(s.name, s);
  return { skills: [...seen.values()].filter((s) => !OWN.test(s.name)), projects };
}

function discoverMcp() {
  const names = new Set();
  const add = (o) => { for (const n of Object.keys(o || {})) names.add(n); };
  const claude = readJson(path.join(HOME, '.claude.json')) || {};
  add(claude.mcpServers);
  for (const p of Object.values(claude.projects || {})) add(p?.mcpServers);
  add(readJson(path.join(HOME, '.cursor', 'mcp.json'))?.mcpServers);
  add(readJson(path.join(HOME, '.gemini', 'settings.json'))?.mcpServers);
  add(readJson(path.join(HOME, '.config', 'opencode', 'opencode.json'))?.mcp);
  const codex = readText(path.join(HOME, '.codex', 'config.toml')) || '';
  for (const m of codex.matchAll(/^\[mcp_servers\.("?)([^"\]]+)\1\]/gm)) names.add(m[2]);
  return names;
}

function autoAssign(skill) {
  if (REPLACED[skill.name]) return ['replaced'];
  if (skill.origin === 'claude.ai') return ['general'];
  const text = `${skill.name.replace(/[-_]/g, ' ')} ${skill.description || ''}`;
  const hits = Object.entries(DEPT_KEYWORDS)
    .map(([d, re]) => [d, (text.match(new RegExp(re.source, 'gi')) || []).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
  return hits.length ? hits.slice(0, 2) : ['unassigned'];
}

// ---------- precondition patch ----------

function patchSkill(file, dept) {
  let text = readText(file);
  if (!text) return false;
  const original = text;
  const block = `${BEGIN}\n> **Waymark precondition.** This skill is a tool of the \`${dept}\` department. If \`${dept}\` (or \`waymark:${dept}\`) has not been loaded in this conversation, invoke it first and follow its brief (what, why, where, how), then return here. Skip only for trivial L0 edits.\n${END}\n`;
  text = text.replace(new RegExp(`\\r?\\n?${BEGIN}[\\s\\S]*?${END}\\r?\\n?`), '');
  text = text.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)(?:\r?\n){2,}/, '$1\n');
  text = text.replace(/^(description:\s*)(.*)$/m, (all, k, v) => {
    const clean = v.replace(/ ?\(Waymark[^)]*\)/, '');
    if (unpatch) return k + clean;
    const tag = ` (Waymark — load ${dept} first.)`;
    const q = clean[0];
    if ((q === '"' || q === "'") && clean.endsWith(q)) return k + clean.slice(0, -1) + tag + q;
    return k + clean + tag;
  });
  if (!unpatch) text = text.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1\n${block}`);
  if (text === original) return false;
  if (!dryRun) fs.writeFileSync(file, text);
  return true;
}

// ---------- owned skills: learning sections + provenance ----------

function ensureSection(file, heading, intro) {
  const text = readText(file);
  if (!text || text.includes(`\n${heading}\n`)) return false;
  if (!dryRun) fs.writeFileSync(file, `${text.trimEnd()}\n\n${heading}\n\n${intro}\n`);
  return true;
}

function ensureNotice(dir, name, e) {
  const file = path.join(dir, 'NOTICE.md');
  if (fs.existsSync(file)) return false;
  const body = [
    `# NOTICE — ${name}`,
    '',
    `Vendored into Waymark on ${e.vendoredAt} from \`${e.vendoredFrom}\`${e.upstreamHash ? ` (upstream folder hash \`${e.upstreamHash}\`)` : ''}.`,
    `Upstream license: ${e.license}. Keep the original LICENSE file when redistributing.`,
    'Modified: waymark precondition block, description trigger, and the "Learned notes" section that grows with use.',
    '',
  ].join('\n');
  if (!dryRun) fs.writeFileSync(file, body);
  return true;
}

const LEARNED_TOOL = '_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._';
const LEARNED_DEPT = '_Grows with use (waymark `references/learning.md`). Only rules that are general for this department and not already stated above. Format: `- [YYYY-MM-DD] <rule> — <why> (source: <project>)`._';

// ---------- registry ----------

function row(name, e, status) {
  const type = e.origin?.startsWith('foreign:') ? `skill (${e.origin.slice(8)})` : e.type || 'mcp';
  const source = e.path ? `\`${e.path.replace(/\\/g, '/')}\`` : e.source || '-';
  return `| \`${name}\` | ${type} | ${e.capability || '-'} | ${e.when || '-'} | ${e.level || '-'} | ${status} | ${source} |`;
}

function render(map, installed, mcpNames, projects) {
  const head = '| Name | Type | Capability | When | Level | Status | Source |\n|---|---|---|---|---|---|---|';
  const status = (name, e) => {
    if (e.type === 'built-in' || e.type === 'agent') return 'built-in';
    return installed.has(name) ? 'installed' : 'missing';
  };
  const mcpStatus = (name) => (mcpNames.has(name) ? 'configured' : 'missing');
  const depts = ['dept-product', 'dept-architecture', 'dept-frontend', 'dept-ux-ui', 'dept-backend', 'dept-data', 'dept-security', 'dept-qa', 'dept-devops', 'dept-devex'];
  const lines = [
    '# Skill Registry',
    '',
    `> Generated by \`scripts/sync.mjs\` on ${new Date().toISOString().slice(0, 10)}. Edit \`skill-map.json\`, not this file.`,
    '> Use: read your department section + **Shared**. Pick rows whose *When* matches and *Level* ≤ the task level.',
    '> Status `missing` → ask the user to install (`npx skills add <source>`), then re-run sync. Never invent names that are not here or in the session listing.',
    '> Third-party skills (type `skill (<agent>)`, project skills) may not be in your session listing: read the `SKILL.md` at *Source* and follow it like a loaded skill. Rows under *Replaced* are never used.',
    '',
  ];
  const shared = Object.entries(map.skills).filter(([, e]) => e.departments.includes('*'));
  const sharedMcp = Object.entries(map.mcp).filter(([, e]) => e.departments.includes('*'));
  lines.push('## Shared', '', head, ...shared.map(([n, e]) => row(n, e, status(n, e))), ...sharedMcp.map(([n, e]) => row(n, { ...e, type: 'mcp' }, mcpStatus(n))), '');
  for (const d of depts) {
    const s = Object.entries(map.skills).filter(([, e]) => e.departments.includes(d));
    const m = Object.entries(map.mcp).filter(([, e]) => e.departments.includes(d));
    lines.push(`## ${d}`, '');
    if (!s.length && !m.length) { lines.push('_No dedicated skills yet. Use Shared, or propose one (waymark `references/skills.md`)._', ''); continue; }
    lines.push(head, ...s.map(([n, e]) => row(n, e, status(n, e))), ...m.map(([n, e]) => row(n, { ...e, type: e.stack ? `mcp (${e.stack})` : 'mcp' }, mcpStatus(n))), '');
  }
  const general = Object.entries(map.skills).filter(([, e]) => e.departments.includes('general'));
  if (general.length) lines.push('## General (not development)', '', general.map(([n]) => `\`${n}\``).join(' · '), '');
  const un = Object.entries(map.skills).filter(([, e]) => e.departments.includes('unassigned'));
  if (un.length) lines.push('## Unassigned', '', '_Detected but not mapped. Edit `skill-map.json` to assign a department._', '', head, ...un.map(([n, e]) => row(n, e, status(n, e))), '');
  const rep = Object.entries(map.skills).filter(([, e]) => e.departments.includes('replaced'));
  if (rep.length) lines.push('## Replaced (not used)', '', rep.map(([n]) => `- \`${n}\` → use \`${REPLACED[n] || '?'}\` (INSTALL §4 offers to remove it)`).join('\n'), '');
  if (projects.length) {
    lines.push('## Project skills', '', '_Read the SKILL.md at Path when working in that project._', '', '| Name | Project | Capability | Description | Path |', '|---|---|---|---|---|');
    for (const p of projects) lines.push(`| \`${p.name}\` | ${p.origin.replace('project:', '')} | ${guessCapability(p)} | ${(p.description || '').replace(/\|/g, '/').slice(0, 160)} | \`${p.file.replace(/\\/g, '/')}\` |`);
    lines.push('');
  }
  const extraMcp = [...mcpNames].filter((n) => !map.mcp[n]);
  if (extraMcp.length) lines.push('## Other MCP servers configured', '', extraMcp.map((n) => `- \`${n}\` — not mapped; add it to \`skill-map.json\` → mcp`).join('\n'), '');
  return lines.join('\n');
}

const map = readJson(MAP_FILE);

const vi = process.argv.indexOf('--vendor');
if (vi > 0) {
  const name = process.argv[vi + 1];
  const dest = path.join(path.dirname(SKILL_DIR), name);
  if (!name || !fs.existsSync(dest)) { console.error(`--vendor: skill "${name}" not found in ${path.dirname(SKILL_DIR)}`); process.exit(1); }
  if (fs.lstatSync(dest).isSymbolicLink()) {
    const real = fs.realpathSync(dest);
    fs.unlinkSync(dest);
    fs.cpSync(real, dest, { recursive: true, dereference: true });
    console.log(`Vendored ${name}: link to ${real} replaced by a real copy (original left untouched).`);
  }
  const lock = readJson(path.join(HOME, '.agents', '.skill-lock.json'))?.skills?.[name];
  const fm = frontmatter(readText(path.join(dest, 'SKILL.md')));
  const e = map.skills[name] || { type: 'skill', departments: autoAssign({ name, description: fm.description, origin: 'user' }), capability: '-', auto: true, when: (fm.description || '').slice(0, 140), level: 'L1' };
  Object.assign(e, {
    owned: true,
    vendoredFrom: e.vendoredFrom || lock?.source || e.source || 'unknown',
    source: e.source || lock?.source,
    upstreamHash: lock?.skillFolderHash || e.upstreamHash || null,
    vendoredAt: new Date().toISOString().slice(0, 10),
    license: e.license || (fs.readdirSync(dest).find((f) => /licen/i.test(f)) ? 'see LICENSE file' : 'unknown (verify upstream)'),
  });
  if (!e.patch) e.patch = e.departments.find((d) => d.startsWith('dept-')) || 'waymark';
  map.skills[name] = e;
}

const { skills, projects } = discover();
const installed = new Set(skills.map((s) => s.name));
const added = [];
const outsideAgent = (s) => s.origin.startsWith('foreign:');
for (const s of skills) {
  const e = map.skills[s.name];
  if (e) {
    // Auto entries follow the skill: fill a missing capability, keep the path of third-party skills current.
    if (e.auto) {
      if (!e.capability || e.capability === '-') e.capability = guessCapability(s);
      if (outsideAgent(s)) { e.origin = s.origin; e.path = s.file; } else delete e.path;
    }
    continue;
  }
  map.skills[s.name] = {
    type: 'skill', departments: autoAssign(s), capability: REPLACED[s.name] ? '-' : guessCapability(s), auto: true,
    when: (s.description || '').replace(/\|/g, '/').slice(0, 140), level: 'L1', origin: s.origin,
    ...(outsideAgent(s) ? { path: s.file } : {}),
  };
  added.push(`${s.name} → ${map.skills[s.name].departments.join(', ')} (${map.skills[s.name].capability})`);
}
// Auto-discovered skills that were uninstalled leave the map (curated entries stay, shown as missing).
const dropped = Object.keys(map.skills).filter((n) => map.skills[n].auto && !map.skills[n].owned && !installed.has(n));
for (const n of dropped) delete map.skills[n];

const patched = [];
for (const s of skills) {
  const dept = map.skills[s.name]?.patch;
  if (dept && s.origin === 'user' && patchSkill(s.file, dept)) patched.push(`${s.name} (${unpatch ? 'removed' : dept})`);
}

const evolved = [];
for (const s of skills) {
  const e = map.skills[s.name];
  if (!e?.owned || s.origin !== 'user' || unpatch) continue;
  if (ensureSection(s.file, '## Learned notes', LEARNED_TOOL)) evolved.push(`${s.name} (+Learned notes)`);
  if (e.vendoredFrom && ensureNotice(path.dirname(s.file), s.name, e)) evolved.push(`${s.name} (+NOTICE)`);
}
for (const d of fs.readdirSync(SKILLS_HOME)) {
  if (!/^dept-/.test(d)) continue;
  if (!unpatch && ensureSection(path.join(SKILLS_HOME, d, 'SKILL.md'), '## Learned rules', LEARNED_DEPT)) evolved.push(`${d} (+Learned rules)`);
}

const registry = render(map, installed, discoverMcp(), projects);
if (!dryRun) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + '\n');
  fs.writeFileSync(REGISTRY, registry + '\n');
  fs.mkdirSync(path.join(LOCAL, 'learnings'), { recursive: true });
  fs.mkdirSync(path.join(LOCAL, 'projects'), { recursive: true });
  const tpl = path.join(SKILL_DIR, 'templates', 'private-layer');
  // coexistence.md exists only when the installer found another agent framework (references/coexistence.md).
  for (const f of fs.existsSync(tpl) ? fs.readdirSync(tpl).filter((n) => n.endsWith('.md') && n !== 'coexistence.md') : []) {
    if (!fs.existsSync(path.join(LOCAL, f))) { fs.copyFileSync(path.join(tpl, f), path.join(LOCAL, f)); evolved.push(`~/.waymark/${f} (created)`); }
  }
}
if (!quiet) {
  const foreign = skills.filter(outsideAgent).length;
  console.log(`Skills found: ${skills.length} (from other agents: ${foreign}) · project skills: ${projects.length}`);
  console.log(`New (auto-assigned, review in skill-map.json): ${added.length ? '\n  ' + added.join('\n  ') : 'none'}`);
  console.log(`Removed (uninstalled auto entries): ${dropped.length ? dropped.join(', ') : 'none'}`);
  console.log(`Precondition ${unpatch ? 'removed from' : 'applied to'}: ${patched.length ? patched.join(', ') : 'nothing changed'}`);
  console.log(`Learning sections / provenance added: ${evolved.length ? evolved.join(', ') : 'nothing changed'}`);
  console.log(`${dryRun ? '[dry-run] ' : ''}Registry: ${REGISTRY}`);
}
