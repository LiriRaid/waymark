// Waymark · one real copy of each shared skill (docs/adr/0016, 0017). Codex, OpenCode and Gemini CLI read
// .agents/skills (in the project and at user level); Claude Code reads only .claude/skills. A shared skill lives once
// in .agents/skills and Claude Code gets a link to it (a junction on Windows, a symlink elsewhere):
// - project skills: every skill of <project>/.agents/skills, linked from <project>/.claude/skills by the session hook;
// - Waymark's skills: ~/.agents/skills, linked from ~/.claude/skills by the installer (`node skill-links.mjs --user`).
// A real folder found on Claude Code's side (a skill written there, or an old copy) moves to .agents/skills, the newer
// content winning; the folder it replaces goes to ~/.waymark/backups, never deleted. Where no link can be made, a copy
// is kept instead. The .claude side exists only where Claude Code is installed. CLI: --user [--apply].
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED = path.join('.agents', 'skills'), CLAUDE = path.join('.claude', 'skills');
const hasClaude = () => fs.existsSync(path.join(os.homedir(), '.claude'));
const backupRoot = (scope) => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'backups', `skills-${new Date().toISOString().slice(0, 10)}`, scope);

const present = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const isSkill = (d) => fs.existsSync(path.join(d, 'SKILL.md'));
const entries = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const files = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, base) : [path.relative(base, p)];
}).sort();
const sameTree = (a, b) => {
  const fa = files(a), fb = files(b);
  return fa.length === fb.length && fa.every((f, i) => f === fb[i] && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
};
const newest = (dir) => Math.max(0, ...files(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
const unlink = (p) => { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } }; // a Windows junction is removed as a directory
const move = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true, preserveTimestamps: true }); fs.rmSync(from, { recursive: true }); }
};
const aside = (dir, backup) => {
  let to = path.join(backup, path.basename(dir));
  for (let i = 2; present(to); i++) to = path.join(backup, `${path.basename(dir)}-${i}`);
  move(dir, to);
  return to;
};
export function makeLink(target, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (process.platform === 'win32') fs.symlinkSync(path.resolve(target), link, 'junction');
  else fs.symlinkSync(path.relative(path.dirname(link), target), link, 'dir');
}
// Whether a link can be made next to `dir` (probed once per folder): no → copies are kept instead.
const probed = new Map();
function canLink(dir) {
  if (probed.has(dir)) return probed.get(dir);
  let ok = false;
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-link-')), link = path.join(dir, `.wm-link-${process.pid}`);
  try { makeLink(target, link); ok = true; unlink(link); } catch {}
  fs.rmSync(target, { recursive: true, force: true });
  probed.set(dir, ok);
  return ok;
}

// Links each shared skill (`names` only, when given) from `agent` to `shared`. → the actions taken, one line each.
export function linkSkills(shared, agent, { names = null, claude = true, backup, apply = true } = {}) {
  const done = [], want = (n) => !names || names.has(n);
  const all = new Set([...entries(shared).filter((n) => isSkill(path.join(shared, n))), ...entries(agent).filter((n) => !n.startsWith('.'))]);
  for (const name of [...all].filter(want).sort()) {
    const s = path.join(shared, name), a = path.join(agent, name);
    if (!isSkill(s)) {
      // only on the agent's side: a link left by an old install, or a skill written there that belongs in shared
      if (isLink(a)) { if (!realOf(a)) { if (apply) unlink(a); done.push(`${name}: broken link removed`); } continue; }
      if (!present(a) || !isSkill(a)) continue;
      if (apply) { move(a, s); if (claude) linkOrCopy(s, a); }
      done.push(`${name}: moved to ${shared}${claude ? ', linked' : ''}`);
      continue;
    }
    if (!claude) continue;
    if (isLink(a)) {
      if (realOf(a) === realOf(s)) continue;
      if (apply) { unlink(a); linkOrCopy(s, a); }
      done.push(`${name}: link pointed elsewhere, relinked`);
      continue;
    }
    if (present(a)) {
      if (sameTree(a, s) && !canLink(agent)) continue; // the copy kept where no link can be made
      // a real copy: the newer content stays in shared, the other folder goes to the backup
      const keepAgent = !sameTree(a, s) && newest(a) > newest(s);
      if (apply) { if (keepAgent) { aside(s, backup); move(a, s); } else aside(a, backup); linkOrCopy(s, a); }
      done.push(`${name}: copy replaced by a link${keepAgent ? ` (its newer content moved to ${shared})` : ''}; the old folder in ${backup}`);
      continue;
    }
    if (apply) linkOrCopy(s, a);
    done.push(`${name}: linked`);
  }
  return done;
}
function linkOrCopy(s, a) {
  try { makeLink(s, a); } catch { fs.cpSync(s, a, { recursive: true, preserveTimestamps: true }); }
}

// Project skills: <root>/.agents/skills, linked from <root>/.claude/skills where Claude Code is installed.
export function linkProjectSkills(root, { claude = hasClaude(), backup = backupRoot(path.basename(root)) } = {}) {
  return linkSkills(path.join(root, SHARED), path.join(root, CLAUDE), { claude, backup });
}

// Waymark's own skills at user level: the folders of the repository's skills/ (this script's grandparent).
export const WAYMARK_SKILLS = () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return new Set(entries(dir).filter((n) => isSkill(path.join(dir, n))));
};
export function linkUserSkills({ home = os.homedir(), names = WAYMARK_SKILLS(), claude = fs.existsSync(path.join(home, '.claude')), apply = true, backup = backupRoot('user') } = {}) {
  return linkSkills(path.join(home, SHARED), path.join(home, CLAUDE), { names, claude, backup, apply });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--user')) {
  const apply = process.argv.includes('--apply');
  const done = linkUserSkills({ apply });
  console.log(done.length ? `${apply ? 'Done' : 'Plan (re-run with --apply)'}:\n- ${done.join('\n- ')}` : 'Nothing to do: every Waymark skill lives in ~/.agents/skills and Claude Code links to it.');
}
