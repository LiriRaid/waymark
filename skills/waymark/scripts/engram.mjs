// Waymark · the learned-memory layer (docs/adr/0015, 0017). The hooks write and read engram through its CLI, so every
// agent on this machine shares one learned memory whether or not it has engram's MCP server:
// - saveLearned: at each close, the task's Aprendido, request, decisions, files and commit (`engram save`, titled with
//   the Aprendido; topic = the task's ID without its follow-up letter, so a re-close or a follow-up updates the task's
//   memory instead of adding one);
// - saveQuestion: a Q whose reply ends with an Aprendido line, marked Q (one topic per question);
// - learnedLines: the project's latest memories, for the context card.
// The memory stays local: .engram/ is git-ignored and nothing is exported to it. The project name is Waymark's slug,
// pinned in .engram/config.json so engram's own MCP server resolves the same name.
// engram missing → every function is a no-op (Waymark keeps git and memory.md). WAYMARK_ENGRAM overrides the binary
// (a .mjs path runs with node, for tests). The update check is skipped (ENGRAM_NO_UPDATE_CHECK=1).
// The release Waymark was tested with is pinned in skills/waymark/engram.pin.json (docs/adr/0036): its version and, per OS and
// architecture, the sha256 of the release archive and of the binary inside it. `check` compares the engram on this machine with it
// (engramStatus) and each record keeps the version it was written under (engramInput). A mismatch is said, never a stop.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { maskSecrets, ID } from './provenance.mjs';

const ENV = () => ({ ...process.env, ENGRAM_NO_UPDATE_CHECK: '1' });
const VERSION = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/;
let found, foundVersion;
// → [command, ...prefixArgs] to run engram, or null when it is not installed.
export function engramBin() {
  if (process.env.WAYMARK_ENGRAM !== undefined) {
    const p = process.env.WAYMARK_ENGRAM;
    return !p ? null : p.endsWith('.mjs') ? [process.execPath, p] : [p];
  }
  if (found !== undefined) return found;
  // PATH first; then where its installers put it when a hook's PATH lacks that folder (Windows, Homebrew, Go, ~/.local)
  const candidates = ['engram', path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'engram', 'engram.exe'), '/opt/homebrew/bin/engram', '/usr/local/bin/engram',
    path.join(os.homedir(), '.local', 'bin', 'engram'), path.join(os.homedir(), 'go', 'bin', 'engram')];
  found = null;
  for (const c of candidates) {
    const r = spawnSync(c, ['version'], { encoding: 'utf8', timeout: 3000, env: ENV() });
    if (r.status === 0) { found = [c]; foundVersion = String(r.stdout).match(VERSION)?.[0] || null; break; }
  }
  return found;
}

export const PIN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'engram.pin.json');
const OS_NAME = { win32: 'windows', darwin: 'darwin', linux: 'linux' }, CPU_NAME = { x64: 'amd64', arm64: 'arm64' };
// The key of a platform in the pin file, named as the release names its archives: windows_amd64, darwin_arm64, linux_amd64…
export const platformKey = (platform = process.platform, arch = process.arch) => `${OS_NAME[platform] || platform}_${CPU_NAME[arch] || arch}`;
export function enginePin(file = PIN_FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// The version engram reports (`engram version`), or null: not installed, or it does not say.
export function engramVersion() {
  const bin = engramBin();
  if (!bin) return null;
  if (foundVersion !== undefined && bin.length === 1 && found) return foundVersion;
  const r = spawnSync(bin[0], [...bin.slice(1), 'version'], { encoding: 'utf8', timeout: 3000, env: ENV() });
  return r.status === 0 ? String(r.stdout).match(VERSION)?.[0] || null : null;
}

// The file a command name runs: itself when it is a path, else the first match on the PATH (PATHEXT on Windows).
function whereIs(cmd) {
  if (path.isAbsolute(cmd) || /[\\/]/.test(cmd)) return fs.existsSync(cmd) ? cmd : null;
  const exts = process.platform === 'win32' ? ['', ...String(process.env.PATHEXT || '.EXE').split(';')] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const e of exts) { const f = path.join(dir, cmd + e); try { if (fs.statSync(f).isFile()) return f; } catch {} }
  }
  return null;
}
export const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// What was found (the version engram reports, the file it runs) against the pin: { state, version, file, sha256?, pinned?, entry?, platform }.
// ok (version and binary sha256 match) · version (another release) · binary (the version matches, the bytes do not: not the published release)
// · unchecked (the version matches, the file cannot be read to hash it) · unpinned (no pin file) · platform (the pin has no entry for this OS).
export function judgeEngram({ version = null, file = null } = {}, pin = enginePin(), platform = platformKey()) {
  if (!pin?.version) return { state: 'unpinned', version, file, platform };
  const entry = pin.platforms?.[platform];
  if (!entry) return { state: 'platform', version, file, pinned: pin.version, platform };
  if (version !== pin.version) return { state: 'version', version, file, pinned: pin.version, entry, platform };
  let sha256 = null;
  try { if (file) sha256 = sha256File(file); } catch {}
  return { state: !sha256 ? 'unchecked' : sha256 === entry.binarySha256 ? 'ok' : 'binary', version, file, sha256, pinned: pin.version, entry, platform };
}

// The engram on this machine against the pin (judgeEngram), or { state: 'missing' } when it is not installed.
export function engramStatus(pin = enginePin()) {
  const bin = engramBin();
  if (!bin) return { state: 'missing', platform: platformKey() };
  return judgeEngram({ version: engramVersion(), file: bin.length === 1 ? whereIs(bin[0]) : null }, pin); // a stand-in script (tests) has no binary to hash
}

// What a record keeps of engram in its `inputs`: { version, pinned } (pinned: the version is the pinned one; null with no pin), or null
// when engram is not installed. The binary's hash is not computed here: a hook runs at every close, `check` reads the bytes.
export function engramInput(pin = enginePin()) {
  const version = engramVersion();
  return version ? { version, pinned: pin?.version ? pin.version === version : null } : null;
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

// The task a follow-up belongs to: its ID without the follow-up letter.
const taskOf = (id) => { const m = String(id).match(ID); return m ? `${m[1]} · T${m[2]}` : String(id); };

// The memory of a closed task: title "<id> · <Aprendido>", the Aprendido first and the request below it. A task closed
// with testigos left unresolved is saved as "sin verificar" with the steps that failed, so the lesson is kept but never
// read as proven. → true when saved.
export function saveLearned(home, rec) {
  const learned = aprendido(rec?.cierre);
  if (!rec?.id || !learned || !engramBin()) return false;
  const project = ensureConfig(home);
  const decisions = (rec.decisions || []).map((d) => d.chosen).filter(Boolean);
  const unverified = rec.unresolved?.length ? Object.entries(rec.evaluation?.steps || {}).filter(([, v]) => v === false).map(([k]) => k) : [];
  const content = [
    rec.unresolved?.length ? `Sin verificar: ${unverified.join(', ') || rec.unresolved.length}` : '',
    `Aprendido: ${learned}`,
    rec.prompt ? `Pedido: ${clip(rec.prompt, 160)}` : '',
    decisions.length ? `Decisión: ${clip(decisions.join(' · '), 300)}` : '',
    rec.files?.length ? `Archivos: ${[...new Set(rec.files.map((f) => path.basename(f)))].slice(0, 12).join(', ')}` : '',
    rec.commits?.length ? `Commit: ${rec.commits.map((c) => c.slice(0, 8)).join(', ')}` : '',
    `Agente: ${rec.agent || '?'}`,
  ].filter(Boolean).join('\n');
  // never a secret in engram: its store is gzipped or SQLite, where the secrets testigo cannot read it
  const r = run(home, ['save', maskSecrets(`${rec.id} · ${rec.unresolved?.length ? 'sin verificar · ' : ''}${clip(learned, 70)}`), maskSecrets(content), '--type', 'learning', '--project', project, '--topic', `waymark/${taskOf(rec.id)}`]);
  return !!r?.ok;
}

// The lesson of a question (questionRecord's `learned`): title "Q · <date> · <Aprendido>". → true when saved.
export function saveQuestion(home, q) {
  if (!q?.learned || !engramBin()) return false;
  const project = ensureConfig(home), day = String(q.at || new Date().toISOString()).slice(0, 10);
  const content = [`Aprendido: ${q.learned}`, q.prompt ? `Pregunta: ${clip(q.prompt, 160)}` : '', `Agente: ${q.agent || '?'}`].filter(Boolean).join('\n');
  const r = run(home, ['save', maskSecrets(`Q · ${day} · ${clip(q.learned, 70)}`), maskSecrets(content), '--type', 'learning', '--project', project, '--topic', `waymark/Q/${q.at || day}`]);
  return !!r?.ok;
}

// The project's latest memories, newest first: "<title>: <content>" (from `engram context <project>`). A task's memory
// titled "<id> · …" (the Aprendido or the request) whose content opens with its Aprendido shows "<id> · <the whole
// Aprendido>"; the task in `skip` (the card's last closed, already shown there) is left out. → lines.
export function learnedLines(home, n = 3, width = 150, skip = null) {
  if (!engramBin()) return [];
  const r = run(home, ['context', projectOf(home)]);
  if (!r?.ok) return [];
  const obs = (r.out.split(/^### Recent Observations\s*$/m)[1] || '').split('\n').map((l) => l.match(/^- \[[^\]]*\] \*\*(.+?)\*\*:\s*(.*)$/)).filter(Boolean);
  // a memory whose body repeats its title (moved from memory.md: "[date] <title>…") shows the body alone
  const same = (title, body) => body.replace(/^\[[^\]]*\]\s*/, '').startsWith(title.replace(/…$/, ''));
  const line = (title, body) => {
    const id = title.match(ID)?.[0];
    const rest = id && title.startsWith(id) ? title.slice(id.length).replace(/^\s*·\s*/, '') : '';
    const mark = rest.startsWith('sin verificar · ') ? 'sin verificar · ' : '';
    if (rest && body.startsWith('Aprendido: ')) return `${id} · ${mark}${body.slice('Aprendido: '.length)}`;
    return same(title, body) ? body : `${title}: ${body}`;
  };
  return obs.filter(([, title]) => !skip || title.match(ID)?.[0] !== skip).slice(0, n).map(([, title, body]) => clip(line(title, body), width));
}
