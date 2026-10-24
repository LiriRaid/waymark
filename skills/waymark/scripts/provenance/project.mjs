// Where a project's Waymark state lives (docs/adr/0007): the one resolver every hook uses, the folder's local files and the hooks' own error log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { waymarkHome as HOME, norm, real } from '../lib/paths.mjs';

// A hook's own failure never reaches the agent (a hook must not break the turn): it is appended to
// ~/.waymark/hook-errors.log (the newest 200 lines) and `waymark.mjs check` reports it.
export const hookErrorsFile = () => path.join(HOME(), 'hook-errors.log');
export function logHookError(where, err) {
  try {
    const file = hookErrorsFile(), line = `${new Date().toISOString()} ${where} ${String(err?.stack || err).split('\n').slice(0, 3).map((l) => l.trim()).join(' · ')}`.slice(0, 600);
    let old = [];
    try { old = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [...old.slice(-199), line].join('\n') + '\n');
  } catch {}
}

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

// The git root, spelled the way cwd is: git reports the long, link-free name (C:/Users/runneradmin/...) while cwd may come
// as an 8.3 short name (C:\Users\RUNNER~1\...) or through a link, and every caller compares the root with paths spelled
// like cwd. The root is cwd's own ancestor at the depth git's root lies above it.
const gitTop = (cwd) => {
  let top;
  try { const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 5000 }); if (r.status !== 0) return null; top = r.stdout.trim(); } catch { return null; }
  const here = path.resolve(String(cwd || '.')), rel = path.relative(real(top), real(here)), up = rel.split(path.sep);
  if (up[0] === '..' || path.isAbsolute(rel)) return top;
  return (rel ? path.resolve(here, ...up.map(() => '..')) : here).replace(/\\/g, '/'); // forward slashes, as git writes it
};

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

// What each hook answers to {"waymark_probe": true}: proof that it runs from the path it is registered with (waymark.mjs check).
export const PROBE_OK = '{"waymark_probe":"ok"}';

// The agents' local folders kept out of git (docs/adr/0017): Waymark's memory, engram's store, the project skills
// (.agents/skills, every agent) and Claude Code's link to them. Each line is added once.
export const LOCAL_DIRS = [
  ['.waymark/', 'Waymark: project memory'],
  ['.engram/', 'engram: learned memory store'],
  ['.agents/', 'project skills, every agent'],
  ['.claude/skills/', "Claude Code's links to .agents/skills"],
];
// The file git reads this clone's own ignores from (a worktree shares its repository's): `git rev-parse --git-path`, or null outside git.
function excludeFile(root) {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    return r.status === 0 && r.stdout.trim() ? path.resolve(root, r.stdout.trim()) : null;
  } catch { return null; }
}
// Keeps the LOCAL_DIRS out of git through .git/info/exclude, never through the project's versioned .gitignore (docs/adr/0043), and
// writes .waymark's README once. A line the project's own .gitignore already has is kept. Outside git there is nothing to ignore yet:
// the next call, once git exists, writes the lines. → true when the ignore lines are in place.
export function ensureLocal(home) {
  if (!home?.dir) return false;
  fs.mkdirSync(home.dir, { recursive: true });
  const readme = path.join(home.dir, 'README.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  const file = excludeFile(home.root);
  if (!file) return false;
  const has = (text, dir) => new RegExp(`^/?${dir.replace(/[.]/g, '\\.').replace(/\/$/, '')}/?\\s*$`, 'm').test(text);
  let own = '', text = '';
  try { own = fs.readFileSync(path.join(home.root, '.gitignore'), 'utf8'); } catch {}
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const missing = LOCAL_DIRS.filter(([dir]) => !has(own, dir) && !has(text, dir));
  if (!missing.length) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${missing.map(([dir, what]) => `# ${what}, local only\n${dir}\n`).join('')}`);
  return true;
}

const README = `# .waymark: this project's Waymark memory (local, not committed)

Any agent (Claude Code, Codex, Cursor, a new session) resumes the work from this folder:

- \`tasks.md\`: where the work stands: in progress, pending, next step, and the tasks already done. Generated at each task close; do not edit it.
- \`memory.md\`: the project memory. *Work in progress* has one line per open task (≤200 characters, written by the end-of-turn hook from the Cierre; a task done leaves it), then identity, verified gate commands, conventions and solved problems.
- \`provenance.jsonl\`: one line per closed task, chained (each holds the hash of the previous one). A task with a commit keeps its whole record (the request, the user's decisions, files, gates, evidence, the automatic evaluation) as a git note on that commit (\`git notes --ref=waymark show <commit>\`, \`waymark.mjs tasks\`) and a stub here; one without a commit keeps it here.
- \`open.json\`: turns that started and have not ended (one per session); shown in tasks.md under *Started, not closed*.
- \`history.md\` (when present): *Work in progress* lines moved out of memory.md whole (older closed lines, or over 200 characters), never deleted. Read it only for the past.

Kept out of git through \`.git/info/exclude\` (this clone only); the project's own \`.gitignore\` is never touched.
`;
