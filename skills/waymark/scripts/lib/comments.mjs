// A change that only touches comments (docs/adr/0027, 2.0.17 point 4): a doc comment on a function, a note above a field. It
// cannot alter what a typecheck, a build or a test sees, so no gate, spec or build is owed for it. Judged from the edit itself
// (what an Edit replaced and with what), so it holds before and after a commit and needs no git. Conservative on purpose:
// whatever this cannot tell (a whole-file Write, a shell change, a language it does not know, a directive to a tool) is code.
import path from 'node:path';

// extension → the line openers that make a line a comment in that family of languages
const C_LIKE = ['//', '/*', '*', '*/'];
const FAMILY = new Map([
  ...['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'java', 'kt', 'kts', 'go', 'rs', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'cs', 'swift', 'scala', 'dart', 'groovy', 'gradle'].map((e) => [e, C_LIKE]),
  ['php', [...C_LIKE, '#']],
  ...['py', 'rb', 'sh', 'bash', 'zsh', 'r', 'pl', 'ps1', 'ex', 'exs'].map((e) => [e, ['#']]),
  ...['tf', 'hcl'].map((e) => [e, [...C_LIKE, '#']]),
]);
// a comment that is an instruction to a tool (a typecheck, a linter, a formatter, an interpreter) is code
const DIRECTIVE = /@ts-|eslint|noqa|type:\s*ignore|nolint|NOLINT|pragma|istanbul|prettier-ignore|#!|coding[:=]|-\*-|lint:|rubocop|clippy|cfg\(|@suppress|@Suppress|SuppressWarnings|\bmypy\b|\bpylint\b/;

const linesOf = (s) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

// The lines one replacement really changes: the ones of `next` that `prev` does not have and the other way round (the context an
// Edit repeats around the change is in both and drops out).
function changedLines(prev, next) {
  const left = linesOf(prev), right = linesOf(next), count = new Map();
  for (const l of left) count.set(l, (count.get(l) || 0) + 1);
  const added = [];
  for (const l of right) { const n = count.get(l) || 0; if (n > 0) count.set(l, n - 1); else added.push(l); }
  const removed = [];
  for (const [l, n] of count) for (let i = 0; i < n; i++) removed.push(l);
  return [...added, ...removed];
}

// → true when this Edit or MultiEdit of `file` adds, removes or rewrites comment lines and nothing else.
export function commentOnlyEdit(tool) {
  const input = tool?.input || {};
  const file = String(input.file_path || input.path || '');
  const openers = FAMILY.get(path.extname(file).slice(1).toLowerCase());
  if (!openers) return false;
  const pairs = tool.name === 'Edit' ? [[input.old_string, input.new_string]] : tool.name === 'MultiEdit' ? (input.edits || []).map((e) => [e.old_string, e.new_string]) : null;
  if (!pairs?.length) return false;
  let any = false;
  for (const [prev, next] of pairs) {
    for (const l of changedLines(prev, next)) {
      if (!openers.some((o) => l.startsWith(o)) || DIRECTIVE.test(l)) return false;
      any = true;
    }
  }
  return any;
}
