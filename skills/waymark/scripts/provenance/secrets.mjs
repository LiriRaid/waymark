// Secrets masked before a record is written or an agent is told something (the testigo "sin secretos", docs/adr/0012).

import { knownIn, maskKnown } from '../lib/known.mjs';

// Secret formats that are unambiguous wherever they appear: the testigo "sin secretos"
// looks for these in the memory, mem_save and the task's diff; "password=…" is only masked in what Waymark writes.
const SECRET_FORMATS = [
  ['llave privada', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----|[\s\S]*$)/g], // the whole block, body included (a key cut before END to the end)
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ['API key sk-', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
];
// → [{ kind, line }] for every strong-format secret in the text; never the value.
// A value read from the project's own `.env*` files (lib/known.mjs) is a secret wherever it appears, whatever its format.
export function findSecrets(text) {
  const s = String(text ?? ''), out = [];
  for (const [kind, re] of SECRET_FORMATS) for (const m of s.matchAll(re)) out.push({ kind, line: s.slice(0, m.index).split('\n').length });
  for (const line of knownIn(s)) out.push({ kind: 'valor de un archivo sensible', line });
  return out;
}
const maskStrong = (text) => maskKnown(SECRET_FORMATS.reduce((s, [, re]) => s.replace(re, '[redactado]'), String(text ?? '')));
// Every string of a record with the strong formats masked (the chained log cannot be edited later).
export const deepMask = (v) => (typeof v === 'string' ? maskStrong(v) : Array.isArray(v) ? v.map(deepMask) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepMask(x)])) : v);

// Passwords, tokens, keys and URL credentials masked in text the log keeps (prompt, commands, Cierre).
// Only a value that is shaped like a secret is masked: "the token expires" and "la clave es larga" are prose, and masking them made a record say
// "the token [redactado]". Shaped: a digit or a symbol or mixed case in it, 6+ characters after `=`, `:`, "es" or "is" (10+ with a digit or mixed case after a bare space: `Bearer eyJhbGciOi…`).
const shaped = (v, bare) => v.length >= (bare ? 10 : 6) && (/\d/.test(v) || (!bare && /[^A-Za-z0-9ñÑáéíóúÁÉÍÓÚ]/.test(v)) || (/[a-z]/.test(v) && /[A-Z]/.test(v)));
export function maskSecrets(text) {
  return maskStrong(text)
    // a name that ends with the word counts too: aws_secret_access_key, client_secret, DB_PASSWORD (never one that only starts with it)
    .replace(/\b((?:[A-Za-z0-9]+[_.-])*?(?:contrase(?:ñ|n)a|password|passwd|pwd|clave|token|secret|api[_ -]?key|access[_-]?key|bearer))(\s*(?:es|is|=|:)\s*|\s+)(["'`]?)([^\s"'`,;]+)\3/gi,
      (all, key, sep, quote, value) => ((/^bearer$/i.test(key) && value.length >= 8) || shaped(value, !/(?:es|is|=|:)/i.test(sep)) ? `${key}${sep}[redactado]` : all))
    .replace(/(\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1[redactado]@')
    .replace(/(\s-u\s+[^\s:]+:)\S+/g, '$1[redactado]');
}
