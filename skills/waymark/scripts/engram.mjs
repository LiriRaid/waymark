// Waymark · the learned-memory layer (docs/adr/0015, 0017). The hooks write and read engram through its CLI, so every
// agent on this machine shares one learned memory whether or not it has engram's MCP server:
// - saveLearned: at each close, the task's Aprendido, decisions, files and commit (`engram save`, topic = task ID, so a
//   re-close of the same task updates its memory instead of adding one);
// - importChunks: at session start, `engram sync --import` loads chunks a repo still carries in .engram/;
// - learnedLines: the project's latest memories, for the context card.
// The memory stays local: .engram/ is git-ignored and nothing is exported to it. The project name is Waymark's slug,
// pinned in .engram/config.json so engram's own MCP server resolves the same name.
// engram missing → every function is a no-op (Waymark keeps git and memory.md). WAYMARK_ENGRAM overrides the binary
// (a .mjs path runs with node, for tests). The update check is skipped (ENGRAM_NO_UPDATE_CHECK=1).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { maskSecrets } from './provenance.mjs';

const ENV = () => ({ ...process.env, ENGRAM_NO_UPDATE_CHECK: '1' });
let found;
// → [command, ...prefixArgs] to run engram, or null when it is not installed.
export function engramBin() {
  if (process.env.WAYMARK_ENGRAM !== undefined) {
    const p = process.env.WAYMARK_ENGRAM;
    return !p ? null : p.endsWith('.mjs') ? [process.execPath, p] : [p];
  }
  if (found !== undefined) return found;
  const candidates = ['engram', path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'engram', 'engram.exe'), path.join(os.homedir(), 'go', 'bin', 'engram')];
  found = null;
  for (const c of candidates) if (spawnSync(c, ['version'], { encoding: 'utf8', timeout: 3000, env: ENV() }).status === 0) { found = [c]; break; }
  return found;
}

const run = (home, args, timeout = 5000) => {
  const bin = engramBin();
  if (!bin) return null;
  const r = spawnSync(bin[0], [...bin.slice(1), ...args], { cwd: home.root, encoding: 'utf8', timeout, env: ENV() });
  return { ok: r.status === 0, out: `${r.stdout || ''}`.trim(), err: `${r.stderr || ''}`.trim() };
};
const configFile = (home) => path.join(home.root, '.engram', 'config.json');

// .engram/config.json with project_name = the slug, when missing (never rewritten: a name the user set stays).
export function ensureConfig(home) {
  const file = configFile(home);
  if (fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, 'utf8')).project_name || home.slug; } catch { return home.slug; } }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ project_name: home.slug }, null, 2) + '\n');
  return home.slug;
}
const projectOf = (home) => { try { return JSON.parse(fs.readFileSync(configFile(home), 'utf8')).project_name || home.slug; } catch { return home.slug; } };

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const aprendido = (cierre) => String(cierre || '').replace(/\*\*|__/g, '').match(/^\s*Aprendido:[ \t]*(.+)$/im)?.[1]?.trim() || '';

// The memory of a closed task: title "<id> · <prompt>", the Aprendido first. → true when saved.
export function saveLearned(home, rec) {
  const learned = aprendido(rec?.cierre);
  if (!rec?.id || !learned || !engramBin()) return false;
  const project = ensureConfig(home);
  const decisions = (rec.decisions || []).map((d) => d.chosen).filter(Boolean);
  const content = [
    `Aprendido: ${learned}`,
    decisions.length ? `Decisión: ${clip(decisions.join(' · '), 300)}` : '',
    rec.files?.length ? `Archivos: ${[...new Set(rec.files.map((f) => path.basename(f)))].slice(0, 12).join(', ')}` : '',
    rec.commits?.length ? `Commit: ${rec.commits.map((c) => c.slice(0, 8)).join(', ')}` : '',
    `Agente: ${rec.agent || '?'}`,
  ].filter(Boolean).join('\n');
  // never a secret in engram: its store is gzipped or SQLite, where the secrets testigo cannot read it
  const r = run(home, ['save', maskSecrets(`${rec.id} · ${clip(rec.prompt, 70)}`), maskSecrets(content), '--type', 'learning', '--project', project, '--topic', `waymark/${rec.id}`]);
  return !!r?.ok;
}

// At session start: import chunks the repo brought, once per manifest change (state in WAYMARK_HOME).
export function importChunks(home, stateFile = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.engram-import.json')) {
  const manifest = path.join(home.root, '.engram', 'manifest.json');
  let mtime = 0;
  try { mtime = fs.statSync(manifest).mtimeMs; } catch { return false; }
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const key = home.root.replace(/\\/g, '/').toLowerCase();
  if (st[key] === mtime || !engramBin()) return false;
  const r = run(home, ['sync', '--import'], 10000);
  if (r?.ok) { st[key] = mtime; try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {} }
  return !!r?.ok;
}

// The project's latest memories, newest first: "<title>: <content>" (from `engram context <project>`). → lines.
export function learnedLines(home, n = 3, width = 150) {
  if (!engramBin()) return [];
  const r = run(home, ['context', projectOf(home)]);
  if (!r?.ok) return [];
  const obs = (r.out.split(/^### Recent Observations\s*$/m)[1] || '').split('\n').map((l) => l.match(/^- \[[^\]]*\] \*\*(.+?)\*\*:\s*(.*)$/)).filter(Boolean);
  // a memory whose body repeats its title (moved from memory.md: "[date] <title>…") shows the body alone
  const same = (title, body) => body.replace(/^\[[^\]]*\]\s*/, '').startsWith(title.replace(/…$/, ''));
  return obs.slice(0, n).map(([, title, body]) => clip(same(title, body) ? body : `${title}: ${body}`, width));
}
