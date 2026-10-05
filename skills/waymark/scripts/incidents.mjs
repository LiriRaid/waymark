// Waymark · incidents, derived from the chained records (docs/adr/0012), never stored apart: a testigo that failed (✘)
// in a task is an open incident until the same testigo passes (✔) in a later task of the project; the cause is the
// task's first unresolved or recorded reason. A testigo that failed 3 times or more is a suggested rule for its
// department or stack (`waymark.mjs check` offers it). Offline, 0 model tokens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTaskRecords, projectHome } from './provenance.mjs';

// Only the testigos of the current catalog: one removed since (an older record's label) is no incident.
const LABELS = (() => { try { return new Set(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routine.json'), 'utf8')).testigos.map((t) => t.label)); } catch { return null; } })();

const REPEAT = 3; // failures of one testigo that make it a suggested rule
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// → { open: [{ label, since, last, count, cause }], rules: [{ label, failures, ids }] } from the records, oldest first.
export function incidents(records) {
  const open = new Map(), failures = new Map();
  for (const r of records) {
    const steps = r.id && r.evaluation?.steps;
    if (!steps) continue;
    for (const [label, ok] of Object.entries(steps)) {
      if (LABELS && !LABELS.has(label)) continue;
      if (ok) { open.delete(label); continue; }
      const cause = clip(String([...(r.unresolved || []), ...(r.findings || [])][0] || '').replace(/\s+/g, ' '), 120);
      const o = open.get(label) || { label, since: r.id, count: 0 };
      open.set(label, { ...o, last: r.id, count: o.count + 1, cause: cause || o.cause || '' });
      failures.set(label, [...(failures.get(label) || []), r.id]);
    }
  }
  return {
    open: [...open.values()],
    rules: [...failures].filter(([, ids]) => ids.length >= REPEAT).map(([label, ids]) => ({ label, failures: ids.length, ids })),
  };
}

export const incidentsAt = (cwd) => incidents(readTaskRecords(projectHome(cwd)));

// One line for the context card, or ''.
export function incidentsLine(found) {
  if (!found.open.length && !found.rules.length) return '';
  const open = found.open.map((o) => `${o.label} ✘${o.count > 1 ? `×${o.count}` : ''} (${o.last})`).join(', ');
  const rules = found.rules.map((r) => `${r.label} failed ${r.failures}×`).join(', ');
  return `Incidents: ${open ? `open ${open}` : 'none open'}${rules ? `; suggested rule: ${rules}` : ''} (waymark.mjs incidents)`;
}
