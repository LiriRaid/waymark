// Waymark · the sensitive-path guard's reading of a shell command, and the end-of-turn detection that backs it up (docs/adr/0037).
// commandSensitive: which existing secret-bearing path a command names (the pre-tool hook denies it). detectGuarded: what reached the
// agent in a finished turn although no hook stopped it, read from the normalised transcript of any agent (the end-of-turn hook records it).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { shellRuns } from '../runs.mjs';
import { isSensitive } from './risk.mjs';
import { findSecrets } from '../provenance/secrets.mjs';

export const expandHome = (w) => String(w).replace(/^(~|\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:(?:USERPROFILE|HOME))(?=[\\/]|$)/i, os.homedir());

const WORD = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
const REDIRECT = /(?<![0-9&>=-])>{1,2}\s*(?:"([^"]*)"|'([^']*)'|([^\s"'&|;<>]+))/g;
const GLOB = /[*?[]/;
// A flag whose value is a pattern to match names with, not a file to read: `find -name "*.pem"`, `grep --include=*.pem`.
const PATTERN_FLAG = /^-{1,2}(?:i?name|i?path|i?wholename|regex|g|e|E|T|include|exclude|glob|iglob|pattern|ignore|exclude-dir|include-dir)$/;
const SHELLS = /^(bash|sh|zsh|dash|pwsh|powershell|cmd)(\.exe)?$/i;
const unquote = (s) => String(s).replace(/^["']|["']$/g, '');

// Every path a word of a command could name: the word itself, the value of a flag or an assignment (--file=.env, -Path:.env, if=.env),
// what follows an attached input redirect (cat<.env), the path of a revision (git show HEAD:.env), and the word without the closing
// bracket of a substitution ($(cat .env)). The command's own first word is a path only through its redirect.
export function pathsIn(word, first = false) {
  const w = String(word), out = [];
  const attached = w.includes('<') ? w.split(/<+/).slice(1) : [];
  if (!first) {
    out.push(w);
    const flag = w.match(/^-{1,2}[\w-]+[=:](.+)$/) || w.match(/^[A-Za-z_]\w*=(.+)$/);
    if (flag) out.push(flag[1]);
    const rev = w.match(/^[\w./~^@{}-]{2,}:(?!\/\/)(.+)$/);
    if (rev) out.push(rev[1]);
  }
  out.push(...attached);
  return [...new Set(out.flatMap((c) => [c, c.replace(/[)`]+$/, '')]).map(unquote).filter(Boolean))];
}

// The existing files a glob names, in its folder only: the shell does not match a leading dot with `*`, and a pattern with fewer than two
// literal characters (`*`, `?`) names nothing in particular, so `git add *` is not a read of every key in the folder.
function globMatches(abs) {
  const dir = path.dirname(abs), base = path.basename(abs);
  if (!GLOB.test(base) || GLOB.test(dir)) return [];
  if (base.replace(/\[[^\]]*\]|[*?]/g, '').length < 2) return [];
  let re = '';
  for (let i = 0; i < base.length; i++) {
    const c = base[i];
    if (c === '*') re += '[^/\\\\]*';
    else if (c === '?') re += '[^/\\\\]';
    else if (c === '[' && base.indexOf(']', i + 1) > i + 1) { const j = base.indexOf(']', i + 1); re += `[${base.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = j; }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const rx = new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
  return names.filter((n) => (base.startsWith('.') || !n.startsWith('.')) && rx.test(n)).map((n) => path.join(dir, n));
}

// The secret-bearing path an existing file or a redirect target of the command names, or null. Any command naming one counts (cat, type,
// Get-Content, head, tail, less, cp, git…): the guard judges the argument, never the program. A shell run through another shell
// (bash -c "cat .env") is read inside. It does not stop what a command only reaches by searching (`grep -r KEY .`, `find`), nor a script
// that opens the file by itself.
export function commandSensitive(command, cwd, cfg, depth = 0) {
  for (const p of shellRuns(command)) {
    const dir = path.resolve(cwd, expandHome(unquote(p.cd || '.')).replace(/^\/([a-z])\//i, '$1:/'));
    const words = [...String(p.text).matchAll(WORD)].map((m) => m[1] ?? m[2] ?? m[3]);
    const targets = [...String(p.text).matchAll(REDIRECT)].map((m) => m[1] ?? m[2] ?? m[3]);
    if (depth < 2 && SHELLS.test(path.basename(String(words[0] || '').replace(/\\/g, '/')))) {
      for (const w of words.slice(1)) if (/\s/.test(w)) { const inner = commandSensitive(w, dir, cfg, depth + 1); if (inner) return inner; }
    }
    const patternOf = (i) => (i > 0 && PATTERN_FLAG.test(words[i - 1])) || PATTERN_FLAG.test(String(words[i]).replace(/[=:].*$/, ''));
    const candidates = [...words.flatMap((w, i) => pathsIn(w, i === 0).map((c) => [c, false, patternOf(i)])), ...targets.map((t) => [t, true, false])];
    for (const [w, isTarget, pattern] of candidates) {
      if (!w || /^-|^[<>&|]/.test(w)) continue;
      const abs = path.resolve(dir, expandHome(w)), glob = GLOB.test(w);
      if (glob && pattern) continue;
      for (const f of glob ? globMatches(abs) : [abs]) {
        if (isSensitive(f, cfg) && (isTarget || glob || fs.existsSync(f))) return f;
      }
    }
  }
  return null;
}

const EDIT = /^(Edit|Write|MultiEdit|NotebookEdit)$/, SHELL = /^(Bash|PowerShell)$/;
const show = (file, cwd) => {
  const f = String(file).replace(/\\/g, '/'), root = String(cwd).replace(/\\/g, '/').replace(/\/$/, ''), home = os.homedir().replace(/\\/g, '/').replace(/\/$/, '');
  return f.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? f.slice(root.length + 1) : f.toLowerCase().startsWith(`${home.toLowerCase()}/`) ? `~/${f.slice(home.length + 1)}` : f;
};

// What reached the agent in a turn although the hook before the tool did not stop it (the agent has none for that tool, or the command found a
// way round the guard): a read or an edit of a sensitive path, a shell command naming one, and a strong-format secret printed in a tool's
// result (findSecrets: a private key, a cloud or API key, a token). `tools` are the normalised calls (Read, Edit, Bash… with their input,
// the same for every agent); `denied(t)` says the call was refused (the guard's own denial is in the record already). Never the value.
// → [{ kind: 'read' | 'edit' | 'shell' | 'output', tool, path? | secret?, line? }], at most 20.
export function detectGuarded(tools, { cwd = process.cwd(), cfg, outputOf = () => '', denied = () => false } = {}) {
  const found = [], seen = new Set();
  const add = (f) => { const k = `${f.kind}|${f.tool}|${f.path || f.secret}`; if (!seen.has(k) && found.length < 20) { seen.add(k); found.push(f); } };
  const sensitive = (file) => { const abs = path.resolve(cwd, expandHome(file)); return isSensitive(abs, cfg) ? show(abs, cwd) : null; };
  for (const t of tools || []) {
    const i = t.input || {};
    if (!denied(t)) {
      const file = t.name === 'Read' ? i.file_path : EDIT.test(t.name) ? i.file_path || i.notebook_path : t.name === 'Grep' ? i.path : null;
      const hit = file ? sensitive(file) : null;
      if (hit) add({ kind: t.name === 'Read' || t.name === 'Grep' ? 'read' : 'edit', tool: t.name, path: hit });
      else if (SHELL.test(t.name) && i.command) {
        const abs = commandSensitive(String(i.command), cwd, cfg);
        if (abs) add({ kind: 'shell', tool: t.name, path: show(abs, cwd) });
      }
    }
    for (const s of findSecrets(String(outputOf(t) || '').slice(0, 200000))) add({ kind: 'output', tool: t.name, secret: s.kind, line: s.line });
  }
  return found;
}

// One line for the task's findings: what was detected, short.
export const guardedLine = (found) => `a sensitive path or a secret reached the agent and no hook stopped it (recorded, not blocked): ${found.slice(0, 4).map((f) => (f.kind === 'output' ? `${f.secret} printed by ${f.tool}` : `${f.kind} ${f.path}`)).join(' · ')}${found.length > 4 ? ` · +${found.length - 4}` : ''}`;
