// Risk of a change, from routine.json `risk` (docs/adr/0027): what makes the review testigo block, and the sensitive-path
// list the tool guard shares. Defaults live in routine.json; a project may override them in <project>/.waymark/risk.json
// (`maxFiles`, `maxLines`, `mode`, and the pattern lists: `sensitive`/`critical` replace, `allow` adds).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slash } from './paths.mjs';

const ROUTINE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'routine.json');
const FALLBACK = { review: { mode: 'always' }, sensitive: [], critical: [], allow: [] };

const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// The effective config: routine.json's `risk` block, then the project's override. A missing block keeps the old rule
// (review always, as before 2.0.16), so a broken file never lowers the bar.
export function loadRisk(root = null) {
  const base = read(ROUTINE_FILE)?.risk;
  const cfg = base && typeof base === 'object' ? { ...FALLBACK, ...base, review: { ...FALLBACK.review, ...base.review } } : { ...FALLBACK };
  const mode = process.env.WAYMARK_REVIEW_MODE; // always | proportional, over the file's (tests pin it; a user can force the old rule)
  if (mode === 'always' || mode === 'proportional') cfg.review = { ...cfg.review, mode };
  const own = root ? read(path.join(root, '.waymark', 'risk.json')) : null;
  if (!own || typeof own !== 'object') return cfg;
  return {
    ...cfg,
    review: { ...cfg.review, ...(own.review && typeof own.review === 'object' ? own.review : {}) },
    sensitive: Array.isArray(own.sensitive) ? own.sensitive : cfg.sensitive,
    critical: Array.isArray(own.critical) ? own.critical : cfg.critical,
    allow: [...cfg.allow, ...(Array.isArray(own.allow) ? own.allow : [])],
  };
}

const compile = (list) => list.flatMap((p) => { try { return [new RegExp(p, 'i')]; } catch { return []; } });

// A secret-bearing path (read or edit guarded) unless the allow list names it.
export const isSensitive = (file, cfg) => {
  const f = slash(file);
  return compile(cfg.sensitive).some((r) => r.test(f)) && !compile(cfg.allow).some((r) => r.test(f));
};
// A path whose change is risky for what it protects or holds (auth, migrations) even when small.
export const isCritical = (file, cfg) => compile(cfg.critical).some((r) => r.test(slash(file)));

const count = (s) => (s ? String(s).split('\n').length : 0);
// Lines a turn's edit calls changed (the larger of old and new text per edit, a write's whole content, a patch's +/-
// lines). null when a call changed the project without a countable edit (a shell command): the size is then unknown.
export function editedLines(tools, isShellChange = () => false) {
  let n = 0;
  for (const t of tools) {
    const i = t.input || {};
    if (isShellChange(t)) return null;
    if (t.name === 'Edit') n += Math.max(count(i.old_string), count(i.new_string));
    else if (t.name === 'MultiEdit') for (const e of i.edits || []) n += Math.max(count(e.old_string), count(e.new_string));
    else if (t.name === 'Write') n += count(i.content);
    else if (t.name === 'NotebookEdit') n += count(i.new_source);
    else if (/apply_patch/.test(t.name)) n += String(i.input || i.patch || i.command || '').split('\n').filter((l) => /^[+-](?![+-]{2})/.test(l)).length;
  }
  return n;
}

// → { review: boolean, reason } for a turn that changed `code` (and `changed` files of any kind) at `level`.
// review=false carries the reason the record shows as `omitido: riesgo bajo (<reason>)`.
export function reviewRisk({ code, changed, level, lines, cfg }) {
  if (!code.length) return { review: false, reason: 'no code changed' };
  if (cfg.review.mode !== 'proportional') return { review: true, reason: 'always' };
  if (level === 3) return { review: true, reason: 'L3' };
  const hot = changed.find((f) => isSensitive(f, cfg) || isCritical(f, cfg));
  if (hot) return { review: true, reason: `sensitive path ${path.basename(hot)}` };
  const maxFiles = cfg.review.maxFiles ?? 4, maxLines = cfg.review.maxLines ?? 100;
  if (code.length > maxFiles) return { review: true, reason: `${code.length} files > ${maxFiles}` };
  if (lines === null) return { review: true, reason: 'size unknown (a shell command changed files)' };
  if (lines > maxLines) return { review: true, reason: `${lines} lines > ${maxLines}` };
  return { review: false, reason: `${code.length} file${code.length === 1 ? '' : 's'}, ${lines} lines, no sensitive path` };
}
