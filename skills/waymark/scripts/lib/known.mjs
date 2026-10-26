// Waymark · the values of the project's sensitive files, held in the process of one hook and never written (docs/adr/0045). The agent may be allowed to
// read a `.env`; what it reads must not reach memory, a record, a note or engram, and the masker knows only a few secret formats (a password or a
// connection string has none). So the hook that is about to write something loads the `KEY=value` pairs of the project's `.env*` files and masks
// those exact values in everything it writes, and the secrets testigo reports one that reaches a diff, a commit or a mem_save.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waymarkHome } from './paths.mjs';
import { activeAllow } from './grants.mjs';

const expandHome = (p) => String(p).replace(/^~(?=[\\/]|$)/, os.homedir());

const ENV_FILE = /^\.env(\.[^/\\]+)?$/i, PLACEHOLDER = /\.(example|sample|template|dist)$/i;
const TRIVIAL = /^(true|false|null|undefined|localhost|development|production|staging|test|debug|info|warn|error|utf-?8)$/i;
let VALUES = [];

// The values of every `.env*` file at the root and one folder down (an API beside its front end): quotes dropped, six characters or more, nothing
// that is only a word like `true`, and no URL without credentials (a public address is no secret).
export function valuesOf(root) {
  const out = new Set(), dirs = [root];
  try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && !/^(\.|node_modules$|dist$|build$)/.test(e.name) && dirs.length < 24) dirs.push(path.join(root, e.name)); } catch {}
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.filter((x) => ENV_FILE.test(x) && !PLACEHOLDER.test(x))) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/^\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*=\s*(.*)$/gm)) {
        const v = m[1].trim().replace(/^(["'`])(.*)\1$/, '$2').replace(/\s+#.*$/, '');
        if (v.length >= 6 && !TRIVIAL.test(v) && !/^https?:\/\/[^@\s]*$/i.test(v)) out.add(v);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length).slice(0, 200); // the longest first: a value that holds another is masked whole
}
// The values of the sensitive files the user allowed the agent to read (Sensitive allow, lib/grants.mjs): a key's body lines, and the values of
// `name = value`, `name: value` or `NAME=value` lines (a credentials or config file). A file with no permission is never read: the agent could not
// read it either. Held in memory only, like the rest.
export function grantedValues(root, { session } = {}) {
  let prefs = '';
  try { prefs = fs.readFileSync(path.join(waymarkHome(), 'preferences.md'), 'utf8'); } catch { return []; }
  const out = new Set();
  for (const entry of activeAllow(prefs, { session })) {
    const e = expandHome(entry), cands = path.isAbsolute(e) ? [e] : [path.join(root || '.', e)];
    if (!path.isAbsolute(e) && !/[\\/]/.test(e)) { try { for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && !/^(\.git|node_modules)$/.test(d.name)) cands.push(path.join(root, d.name, e)); } catch {} } // a name allowed always: here and one folder down
    for (const f of cands) {
      let text = '';
      try { if (fs.statSync(f).size > 200000) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) { for (const l of text.split(/\r?\n/)) if (l.trim().length >= 16 && !/^-----/.test(l.trim())) out.add(l.trim()); continue; }
      for (const m of text.matchAll(/^\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*[=:]\s*(.*)$/gm)) {
        const v = m[1].trim().replace(/^(["'`])(.*)\1$/, '$2').replace(/\s+#.*$/, '');
        if (v.length >= 6 && !TRIVIAL.test(v) && !/^https?:\/\/[^@\s]*$/i.test(v)) out.add(v);
      }
    }
  }
  return [...out];
}
export function loadKnownValues(root, opts = {}) {
  const safe = (f) => { try { return f(); } catch { return []; } }; // each source on its own: a broken preferences.md never drops the .env values
  VALUES = root ? [...new Set([...safe(() => valuesOf(root)), ...safe(() => grantedValues(root, opts))])].sort((a, b) => b.length - a.length).slice(0, 400) : [];
  return VALUES.length;
}
export const clearKnownValues = () => { VALUES = []; };
export const maskKnown = (text) => VALUES.reduce((s, v) => s.split(v).join('[redactado]'), String(text ?? ''));
// The line of each place a known value appears in the text (never the value).
export function knownIn(text) {
  const s = String(text ?? ''), out = [];
  for (const v of VALUES) for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + v.length)) out.push(s.slice(0, i).split('\n').length);
  return out;
}
