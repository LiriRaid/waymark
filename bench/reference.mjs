#!/usr/bin/env node
// Waymark 2.0.18 · point 11 (docs/adr/0039): the reference bench. It takes read-only clones of the repositories in ~/.waymark/reference-repos.json (a
// list that lives outside this repository: nothing about another project is written to a tracked file) and measures, with no opinion and no agent:
//   - the stack and the profile Waymark detects, what `stack-new` would say, and the layout of the repository (its top-level folders);
//   - the gates it proposes for the repository, and whether the hooks recognise each one as a gate, a test or a build (runs.mjs);
//   - the agent assets the repository carries (CLAUDE.md, AGENTS.md, rules, skills…), the orchestrator blocks in them and what Waymark's guest mode
//     reads from them (references/coexistence.md), and the size of what Waymark injects there against the size of those assets;
//   - where Waymark's detection or generation fails: a manifest that no profile covers, a proposed gate no hook recognises, a hook that errors.
// Each failure is data: the bench names it, and the failures it finds become fixtures and regression cases (tests/reference.test.mjs).
//   node bench/reference.mjs [--list <file>] [--out <file>] [--keep] [--only <id,id>]      clones to a temp folder, measures, deletes the clones
//   node bench/reference.mjs --dir <folder>                                                  measures the folders already there (no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
export const SCHEMA = 'waymark.reference-bench/v1';
export const LIST = () => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'reference-repos.json');
const imp = (f) => import(pathToFileURL(path.join(SCRIPTS, f)).href);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// The agent assets a repository carries: files and folders that instruct or extend an agent, with their size in characters.
const ASSETS = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'QWEN.md', 'CRUSH.md', '.github/copilot-instructions.md', '.cursorrules', '.windsurfrules', '.clinerules'];
const ASSET_DIRS = ['.claude', '.agents', '.codex', '.cursor', '.gemini', '.opencode', '.kiro', '.github/agents', '.github/prompts', '.windsurf'];
const walkText = (dir, limit = 400) => {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) { if (out.length >= limit) return; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(md|mdc|txt|json|toml|ya?ml|mjs|js|ts)$/i.test(e.name)) out.push(p); }
  };
  walk(dir);
  return out;
};
export function agentAssets(root) {
  const files = [];
  for (const f of ASSETS) if (fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile()) files.push(path.join(root, f));
  for (const d of ASSET_DIRS) files.push(...walkText(path.join(root, d)));
  const rows = files.map((f) => ({ file: path.relative(root, f).replace(/\\/g, '/'), chars: read(f).length }));
  return { files: rows.length, chars: rows.reduce((a, r) => a + r.chars, 0), top: rows.sort((a, b) => b.chars - a.chars).slice(0, 5) };
}

// The namespaces of the orchestrator blocks in the repository's instruction files (`<!-- name:section -->`), never Waymark's own.
export async function orchestratorBlocks(root) {
  const { foreignIn } = await imp('connect-agents.mjs');
  const names = new Set();
  for (const f of ASSETS.filter((x) => /\.md$/i.test(x))) for (const n of foreignIn(read(path.join(root, f)))) names.add(n);
  return [...names].sort();
}

const layout = (root) => { try { return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(\.git|node_modules|\.github|\.vscode|\.idea)$/.test(e.name)).map((e) => e.name).sort().slice(0, 14); } catch { return []; } };

// One repository, measured. `home`: a throwaway WAYMARK_HOME for the hooks. Never runs a command of the repository: only Waymark's own scripts read it.
export async function measureRepo(root, { home = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reference-home-')) } = {}) {
  const S = await imp('stack.mjs'), N = await imp('stack-new.mjs'), R = await imp('runs.mjs'), Z = await imp('size.mjs');
  const started = Date.now(), stack = S.stackOf(root), profile = S.profileOf(root), eco = N.detectEcosystems(root).map((e) => e.id), draft = N.draftProfile(root);
  const gates = {};
  for (const [name, g] of Object.entries(draft?.gates || {})) {
    if (name === 'format') continue; // not a gate: the profiles say so
    if (!g || g[0] === 'none') { gates[name] = { command: g ? 'none' : null, recognised: null, as: null }; continue; }
    const k = R.shellRuns(g[0])[0] || {};
    gates[name] = { command: g[0], recognised: !!(k.gate || k.test || k.build), as: k.test ? 'test' : k.build ? 'build' : k.gate ? 'gate' : null };
  }
  const hookErrors = [], out = {};
  for (const [file, payload] of [['session-hook.mjs', { session_id: 's-ref', cwd: root }], ['rule0-hook.mjs', { session_id: 's-ref', cwd: root, prompt: 'corrige un detalle pequeño' }]]) {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, file)], { input: JSON.stringify(payload), encoding: 'utf8', cwd: root, env: { ...process.env, WAYMARK_HOME: home }, timeout: 30000 });
    if (r.status !== 0 || /Error|Cannot find/.test(r.stderr || '')) hookErrors.push(`${file}: exit ${r.status} ${String(r.stderr).split('\n')[0]}`.trim());
    try { out[file] = JSON.parse(r.stdout || '{}').hookSpecificOutput?.additionalContext || ''; } catch { out[file] = ''; }
  }
  const sizes = Object.fromEntries(Z.sizes(root).map((r) => [r.name, r.chars]));
  const injected = { card: (out['session-hook.mjs'] || '').length, reminder: (out['rule0-hook.mjs'] || '').length, fixed: (sizes['instructions block'] || 0) + (sizes['skill descriptions'] || 0) };
  const assets = agentAssets(root), blocks = await orchestratorBlocks(root);
  return {
    stack: stack ? (stack.other || `node (${stack.pm})`) : null, profile: { slug: profile.slug, exists: profile.exists }, ecosystems: eco, layout: layout(root),
    draft: draft ? { slug: draft.slug, signals: draft.signals, gates: Object.fromEntries(Object.entries(draft.gates).map(([k, v]) => [k, v ? v[0] : null])) } : null, gates,
    assets, orchestrators: blocks, injected: { ...injected, total: injected.card + injected.reminder + injected.fixed, againstAssets: assets.chars ? Math.round(((injected.card + injected.reminder + injected.fixed) / assets.chars) * 100) / 100 : null },
    hookErrors, ms: Date.now() - started,
  };
}

// Where Waymark's detection or generation fails on a measured repository, in words and as a kind (each kind is a regression case):
//   no-stack       a manifest says what the repository is (stack-new knows it) and the stack module sees nothing
//   no-profile     the repository is an ecosystem Waymark has no profile for: the generic one applies (stack-new can draft it)
//   no-draft       the repository has files that look like a project and stack-new cannot say what it is
//   gate-unknown   a command the draft proposes as a gate that the hooks do not recognise as a gate, a test or a build
//   hook-error     a hook that exits non-zero or prints an error there
//   guest-blind    the repository carries an orchestrator's blocks and the card does not say Waymark joins as a guest
export function failuresOf(m) {
  const f = [];
  const eco = m.ecosystems[0] || null;
  if (eco && !m.stack) f.push({ kind: 'no-stack', detail: `stack-new reads ${eco} here and stackOf sees no manifest` });
  if (eco && (!m.profile.exists || m.profile.slug === 'generic')) f.push({ kind: 'no-profile', detail: `${eco}: no profile of its own (${m.profile.slug}); \`stack-new\` drafts one` });
  if (!eco && (m.layout.length > 2 && m.assets.files === 0 && !m.stack) && m.layout.some((d) => /^(src|lib|app|cmd|pkg|internal|packages)$/.test(d))) f.push({ kind: 'no-draft', detail: `folders ${m.layout.filter((d) => /^(src|lib|app|cmd|pkg|internal|packages)$/.test(d)).join(', ')} and no manifest stack-new knows` });
  for (const [g, v] of Object.entries(m.gates)) if (v.recognised === false) f.push({ kind: 'gate-unknown', detail: `${g}: \`${v.command}\` is no gate, test or build to the hooks` });
  for (const e of m.hookErrors) f.push({ kind: 'hook-error', detail: e });
  return f;
}

// A shallow, read-only clone that also works where a path is long (Windows: a repository with a long file name fails to check out without core.longpaths).
export const cloneArgs = (url, dir) => ['-c', 'core.longpaths=true', 'clone', '--depth', '1', '--no-tags', '--quiet', url, dir];

const RUN = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (RUN) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reference-home-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reference-'));
  const results = [];
  try {
    let repos;
    if (opt('--dir')) repos = fs.readdirSync(opt('--dir'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ id: e.name, dir: path.join(opt('--dir'), e.name) }));
    else {
      const list = opt('--list') || LIST();
      if (!fs.existsSync(list)) { console.log(`reference bench: no list at ${list}. It lives outside the repository: { "schema": "waymark.reference-repos/v1", "repos": [{ "id": "<short id>", "url": "<https git url>", "field": "<what it is>" }] }`); process.exit(1); }
      repos = JSON.parse(fs.readFileSync(list, 'utf8')).repos || [];
      const only = String(opt('--only') || '').split(',').filter(Boolean);
      if (only.length) repos = repos.filter((r) => only.includes(r.id));
      for (const r of repos) { // a shallow, read-only clone in a folder of its own; nothing in it is ever run
        r.dir = path.join(work, r.id);
        const c = spawnSync('git', cloneArgs(r.url, r.dir), { encoding: 'utf8', timeout: 300000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        if (c.status !== 0) { r.failed = `clone failed: ${String(c.stderr).split('\n').find(Boolean) || c.status}`; continue; }
        r.commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: r.dir, encoding: 'utf8' }).stdout.trim();
      }
    }
    for (const r of repos) {
      if (r.failed) { results.push({ id: r.id, field: r.field || null, error: r.failed }); continue; }
      const m = await measureRepo(r.dir, { home });
      results.push({ id: r.id, field: r.field || null, commit: r.commit || null, ...m, failures: failuresOf(m) });
    }
  } finally {
    if (!args.includes('--keep')) fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
  const doc = { schema: SCHEMA, waymark: read(path.join(ROOT, 'skills', 'waymark', 'VERSION')).trim(), at: new Date().toISOString(), results };
  const out = opt('--out') || path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'bench', `reference-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
  for (const r of results) console.log(r.error ? `${r.id}: ${r.error}` : `${r.id}: ${r.stack || 'no stack'} · profile ${r.profile.slug}${r.profile.exists ? '' : ' (none)'} · injected ${r.injected.total} chars vs ${r.assets.chars} of its own assets · ${r.failures.length} failure${r.failures.length === 1 ? '' : 's'}${r.failures.length ? `: ${r.failures.map((x) => x.kind).join(', ')}` : ''}`);
  console.log(`reference bench: ${results.length} repositories → ${out}`);
}
