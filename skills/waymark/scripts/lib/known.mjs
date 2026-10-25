// Waymark · the values of the project's sensitive files, held in the process of one hook and never written (docs/adr/0045). The agent may be allowed to
// read a `.env`; what it reads must not reach memory, a record, a note or engram, and the masker knows only a few secret formats (a password or a
// connection string has none). So the hook that is about to write something loads the `KEY=value` pairs of the project's `.env*` files and masks
// those exact values in everything it writes, and the secrets testigo reports one that reaches a diff, a commit or a mem_save.
import fs from 'node:fs';
import path from 'node:path';

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
export function loadKnownValues(root) { try { VALUES = root ? valuesOf(root) : []; } catch { VALUES = []; } return VALUES.length; }
export const clearKnownValues = () => { VALUES = []; };
export const maskKnown = (text) => VALUES.reduce((s, v) => s.split(v).join('[redactado]'), String(text ?? ''));
// The line of each place a known value appears in the text (never the value).
export function knownIn(text) {
  const s = String(text ?? ''), out = [];
  for (const v of VALUES) for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + v.length)) out.push(s.slice(0, i).split('\n').length);
  return out;
}
