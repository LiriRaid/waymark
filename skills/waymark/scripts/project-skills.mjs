// Waymark · one project-skills folder for every agent (docs/adr/0016). Codex, OpenCode and Gemini CLI read
// <project>/.agents/skills; Claude Code reads only <project>/.claude/skills. A project skill is written to .agents/skills
// and the session hook mirrors each skill between the two folders, the newer copy winning, so a skill one agent
// generated is there for the others. The .claude/skills side is kept only where Claude Code is installed. Nothing is
// ever deleted; equal timestamps (preserved on copy) mean nothing to do.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SHARED = path.join('.agents', 'skills'), CLAUDE = path.join('.claude', 'skills');
const skillsIn = (dir) => { try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))); } catch { return []; } };
const newest = (dir) => {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : Math.floor(fs.statSync(p).mtimeMs / 1000));
  }
  return t;
};

// → the copies made, "<skill> → <folder>".
export function mirrorProjectSkills(root, { claude = fs.existsSync(path.join(os.homedir(), '.claude')) } = {}) {
  const shared = path.join(root, SHARED), mine = path.join(root, CLAUDE);
  const inShared = new Set(skillsIn(shared)), inClaude = new Set(skillsIn(mine)), copied = [];
  for (const name of new Set([...inShared, ...inClaude])) {
    const a = path.join(shared, name), c = path.join(mine, name);
    const ta = inShared.has(name) ? newest(a) : -1, tc = inClaude.has(name) ? newest(c) : -1;
    if (ta === tc) continue;
    const [from, to, label] = ta > tc ? [a, c, CLAUDE] : [c, a, SHARED];
    if (to === c && !claude) continue; // no Claude Code here: .agents/skills is enough
    fs.cpSync(from, to, { recursive: true, force: true, preserveTimestamps: true });
    copied.push(`${name} → ${label.replace(/\\/g, '/')}`);
  }
  return copied;
}
