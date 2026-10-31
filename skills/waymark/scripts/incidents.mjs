// Waymark · incidents, derived from the chained records (docs/adr/0012), never stored apart: a testigo that failed (✘)
// in a task is an open incident until the same testigo passes (✔) in a later task of the project; the cause is the
// task's first unresolved or recorded reason. A testigo that failed 3 times or more within the project's last 10 tasks
// is a suggested rule for its department or stack (`waymark.mjs check` offers it). Offline, 0 model tokens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTaskRecords, projectHome } from './provenance.mjs';
import { WAYMARK_CMD } from './lib/paths.mjs';
import { RUNS_EGO } from './eyes.mjs';
import { shellRuns } from './runs.mjs';
import { release, writtenBy, BUILD_START } from './lib/version.mjs';

// Only the testigos of the current catalog: one removed since (an older record's label) is no incident.
const LABELS = (() => { try { return new Set(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routine.json'), 'utf8')).testigos.map((t) => t.label)); } catch { return null; } })();

// The Waymark version the records of today are judged by: an incident an earlier version's detectors recorded is theirs, not this version's.
const VERSION = (() => { try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'VERSION'), 'utf8').trim(); } catch { return null; } })();
const AGE_DAYS = 30; // an incident whose last failure is older than this is outgrown
const REPEAT = 3; // failures of one testigo that make it a suggested rule…
const WINDOW = 10; // …within this many of the newest evaluated tasks, so a failure already outgrown stops suggesting one
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// → { open: [{ label, since, last, count, cause }], rules: [{ label, failures, ids }] } from the records, oldest first.
// A failure the detector may have misjudged, read from what the record itself shows: an eyes failure with no call counted although a command ran ego,
// a build failure although a build command ran, a review refused for the words of a quote, a procedure "read late" although the hook handed it. It still opens an incident
// (the card tells it), but it never makes a suggested rule: a department would learn a false lesson from it.
export function suspect(r, label) {
  const cmds = r.commands || [];
  if (label === 'Ojos') return (r.observed?.eyes?.calls || 0) === 0 && cmds.some((c) => RUNS_EGO.test(c));
  // a build ran and none of the commands the record kept after the last change failed: the testigo may have missed a build that passed
  if (label === 'Build') return cmds.some((c) => shellRuns(c).some((p) => p.build)) && !(r.observed?.gates || []).some((g) => g.error && shellRuns(g.cmd || '').some((p) => p.build));
  if (label === 'Review') return (r.findings || []).some((x) => /skip quoted as the user's/.test(x));
  if (label === 'Enrutar') return r.observed?.procedure?.handed === true && r.observed?.procedure?.readBeforeChange === false;
  return false;
}

export function incidents(records, { now = Date.now(), version = VERSION } = {}) {
  const open = new Map(), failures = new Map();
  // only what this version produced: a record that names another Waymark version is left out (one with no version is kept), and an old failure ages out
  const evaluated = records.filter((r) => r.id && r.evaluation?.steps && !(version && r.inputs?.waymark && writtenBy(r.inputs.waymark, r.at, version, BUILD_START) !== release(version))), recent = new Set(evaluated.slice(-WINDOW));
  for (const r of evaluated) {
    const steps = r.evaluation.steps;
    for (const [label, ok] of Object.entries(steps)) {
      if (LABELS && !LABELS.has(label)) continue;
      if (ok === 'exception' || ok === 'na') continue; // declared, not proven, or a cut turn that judged nothing: it neither opens nor closes an incident
      if (ok) { open.delete(label); continue; }
      // the reason of its own testigo: the record's `causes`, or, when it is the only one that failed, the first reason; never another testigo's
      const failed = Object.values(steps).filter((v) => v === false).length;
      const own = r.causes?.[label] || (failed === 1 ? [...(r.unresolved || []), ...(r.findings || [])][0] : '');
      const cause = clip(String(own || '').replace(/\s+/g, ' '), 120);
      const o = open.get(label) || { label, since: r.id, count: 0 };
      open.set(label, { ...o, last: r.id, at: Date.parse(r.at || '') || o.at || 0, count: o.count + 1, cause: cause || o.cause || '' });
      if (recent.has(r) && !suspect(r, label)) failures.set(label, [...(failures.get(label) || []), r.id]);
    }
  }
  return {
    open: [...open.values()].filter((o) => !o.at || now - o.at < AGE_DAYS * 86400000).map(({ at, ...rest }) => rest),
    rules: [...failures].filter(([, ids]) => ids.length >= REPEAT).map(([label, ids]) => ({ label, failures: ids.length, ids })),
  };
}

export const incidentsAt = (cwd) => incidents(readTaskRecords(projectHome(cwd)));

// One line for the context card, or ''.
export function incidentsLine(found, w = WAYMARK_CMD) { // w: the command as the text around it names it (the card defines W)
  if (!found.open.length && !found.rules.length) return '';
  const open = found.open.map((o) => `${o.label} ✘${o.count > 1 ? `×${o.count}` : ''} (${o.last})`).join(', ');
  const rules = found.rules.map((r) => `${r.label} failed ${r.failures}×`).join(', ');
  return `Incidents: ${open ? `open ${open}` : 'none open'}${rules ? `; suggested rule: ${rules}` : ''} (${w} incidents)`;
}
