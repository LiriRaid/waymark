// Secrets masked before a record is written or an agent is told something (the testigo "sin secretos", docs/adr/0012).


// Secret formats that are unambiguous wherever they appear: the testigo "sin secretos"
// looks for these in the memory, mem_save and the task's diff; "password=…" is only masked in what Waymark writes.
export const SECRET_FORMATS = [
  ['llave privada', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g],
  ['API key sk-', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
];
// → [{ kind, line }] for every strong-format secret in the text; never the value.
export function findSecrets(text) {
  const s = String(text ?? ''), out = [];
  for (const [kind, re] of SECRET_FORMATS) for (const m of s.matchAll(re)) out.push({ kind, line: s.slice(0, m.index).split('\n').length });
  return out;
}
export const maskStrong = (text) => SECRET_FORMATS.reduce((s, [, re]) => s.replace(re, '[redactado]'), String(text ?? ''));
// Every string of a record with the strong formats masked (the chained log cannot be edited later).
export const deepMask = (v) => (typeof v === 'string' ? maskStrong(v) : Array.isArray(v) ? v.map(deepMask) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepMask(x)])) : v);

// Passwords, tokens, keys and URL credentials masked in text the log keeps (prompt, commands, Cierre).
export function maskSecrets(text) {
  return maskStrong(text)
    .replace(/\b(contrase(?:ñ|n)a|password|passwd|pwd|clave|token|secret|api[_ -]?key|bearer)(\s*(?:es|is|=|:)\s*|\s+)(["'`]?)[^\s"'`,;]+\3/gi, '$1$2[redactado]')
    .replace(/(\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1[redactado]@')
    .replace(/(\s-u\s+[^\s:]+:)\S+/g, '$1[redactado]');
}
