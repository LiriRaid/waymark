// Waymark · `waymark.mjs attest <task ID>` (docs/adr/0027): one task exported as an in-toto Statement (v1): the subject is the
// commit(s) it produced, the predicate says what governed and what proved the work. It is a copy of what the chained record
// already holds, shaped for a reader who was not there; `waymark.mjs verify --attestation <file>` checks it against the
// project's log and git. The file itself is not signed in this release (a later option, docs/adr/0027).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { projectHome, readTaskRecords, anchorsFor } from './provenance.mjs';

export const STATEMENT = 'https://in-toto.io/Statement/v1';
export const PREDICATE = 'https://github.com/LiriRaid/waymark/attestation/task/v1';

// Same bytes for the same content: object keys sorted at every depth.
export const canonical = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
export const digestOf = (v) => crypto.createHash('sha256').update(canonical(v)).digest('hex');

const field = (cierre, name) => String(cierre || '').match(new RegExp(`^[ \\t]*${name}:[ \\t]*(.*)$`, 'mi'))?.[1]?.trim() || null;

// → the Statement, or { error }.
export function attest(cwd, id) {
  const home = projectHome(cwd);
  const r = readTaskRecords(home).filter((x) => x.id === id).pop();
  if (!r) return { error: `no record for ${id}` };
  const o = r.observed || {};
  const anchor = anchorsFor(cwd).find((a) => a.hash === r.hash) || null;
  const predicate = {
    task: { id: r.id, agent: r.agent || null, level: r.level ?? null, department: r.department || null, at: r.at || null, session: r.session || null },
    request: r.prompt || null,
    decisions: (r.decisions || []).map((d) => ({ question: d.question, chosen: d.chosen, discarded: d.discarded || [], position: d.position || null, at: r.at || null })),
    evidence: { stated: field(r.cierre, 'Evidencia'), result: field(r.cierre, 'Resultado'), learned: field(r.cierre, 'Aprendido'), unbacked: o.evidence?.unbacked || [], calls: r.commands || [] },
    gates: { gate: o.gate ?? null, gates: o.gates || [], tests: o.tests || null, build: o.build ?? null, review: o.review ?? null, secrets: o.secrets || [], computedBy: 'the end-of-turn hook, from the session transcript and git' },
    evaluation: r.evaluation || null,
    inputs: r.inputs || null,
    pinned: r.pinned || null,
    signatures: r.signatures || null,
    chain: { hash: r.hash || null, prev: r.prev || null, anchor: anchor ? { ref: 'refs/notes/waymark-anchor', n: anchor.n, hash: anchor.hash } : null, note: r.note?.commit || null },
  };
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 3000 });
  const repo = top.status === 0 ? top.stdout.trim() : home.root;
  const subject = (r.commits || []).map((h) => ({ name: `git:${repo.split(/[\\/]/).pop()}`, digest: { gitCommit: h } }));
  return { _type: STATEMENT, subject, predicateType: PREDICATE, predicate, predicateDigest: digestOf(predicate) };
}

// Checks a statement file against this project: shape, the digest of its predicate, the commits in git and the record in the
// log. → { ok, checks: [{ name, ok, detail }] }
export function checkAttestation(cwd, file) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ok: false, checks: [{ name: 'file', ok: false, detail: `cannot read ${file} as JSON` }] }; }
  add('shape', s._type === STATEMENT && s.predicateType === PREDICATE && Array.isArray(s.subject) && !!s.predicate, `${s._type || '?'} · ${s.predicateType || '?'}`);
  add('predicate digest', !!s.predicate && digestOf(s.predicate) === s.predicateDigest, 'the predicate is the one that was exported (not edited since)');
  for (const sub of s.subject || []) {
    const h = sub.digest?.gitCommit;
    const ok = !!h && spawnSync('git', ['cat-file', '-e', `${h}^{commit}`], { cwd, timeout: 3000 }).status === 0;
    add(`commit ${String(h).slice(0, 8)}`, ok, ok ? 'in this repository' : 'not in this repository');
  }
  const home = projectHome(cwd);
  const rec = readTaskRecords(home).find((x) => x.id === s.predicate?.task?.id);
  const hash = s.predicate?.chain?.hash;
  add('record', !!rec && rec.hash === hash, rec ? (rec.hash === hash ? `${rec.id} holds the same hash` : 'the log holds another hash for this task') : 'no such task in this log');
  if (s.predicate?.chain?.anchor) add('anchor', anchorsFor(cwd).some((a) => a.hash === s.predicate.chain.anchor.hash && a.n === s.predicate.chain.anchor.n), 'the anchor in refs/notes/waymark-anchor');
  return { ok: checks.every((c) => c.ok), checks };
}
