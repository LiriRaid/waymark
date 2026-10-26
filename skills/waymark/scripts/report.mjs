#!/usr/bin/env node
// Waymark · the report (docs/adr/0049): an anonymous summary of the user's own usage patterns, for them to read before they share it. Counts and shapes only:
// the level, the kind of department, the outcome, the kinds of testigo that failed, buckets of duration and tokens, the stack family, the agent and the model
// family. Never a prompt, a path, a file name, code, a project name or an address: every value passes a list or a bucket, and what is off the list is "other".
// Waymark never sends it; the user chooses to (the `pattern-report` issue form). Machine learning, when it comes, learns from patterns, never from cases.
//   node report.mjs [<project path> …] [--out <file>]   the summary of the projects named (this one with none)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectHome, readTaskRecords, followUps } from './provenance.mjs';
import { profileOf } from './stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA = 'waymark.report/v1';
const DEPARTMENTS = ['architecture', 'backend', 'data', 'devex', 'devops', 'frontend', 'product', 'qa', 'security', 'ux-ui'];
const known = (dir, ext) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)); } catch { return []; } };
const lists = () => ({
  agents: (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'agents', 'agents.json'), 'utf8')).agents.map((a) => a.key); } catch { return []; } })(),
  stacks: known(path.join(HERE, '..', 'stacks'), '.md'),
  testigos: (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'routine.json'), 'utf8')).testigos.map((t) => t.id); } catch { return []; } })(),
});
const pick = (v, list) => (v === null || v === undefined || v === '' ? 'unknown' : list.includes(v) ? v : 'other');
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

// Buckets: a number becomes a range, never itself.
export const durationBucket = (m) => (m === null || m === undefined ? 'unknown' : m < 5 ? 'under 5 min' : m < 30 ? '5-30 min' : m < 60 ? '30-60 min' : 'over 1 h');
export const tokenBucket = (t) => (!(t > 0) ? 'unknown' : t < 500e3 ? 'under 500k' : t < 2e6 ? '500k-2M' : t < 5e6 ? '2M-5M' : t < 10e6 ? '5M-10M' : 'over 10M');
export const modelFamily = (m) => (!m ? 'unknown' : /opus/i.test(m) ? 'opus' : /sonnet/i.test(m) ? 'sonnet' : /haiku/i.test(m) ? 'haiku' : /fable/i.test(m) ? 'fable' : 'other');
const SIZES = [[50, 'xs'], [300, 's'], [1500, 'm']];

// The project's kind, a label of two words: the stack family of its profile and a size bucket by tracked files. Stored in new records (ADR 0049).
export function projectKind(root) {
  let n = 0;
  const r = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', timeout: 8000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status === 0) n = r.stdout.split('\n').filter(Boolean).length;
  return { stack: profileOf(root).slug, size: (SIZES.find(([max]) => n < max) || [0, 'l'])[1] };
}

// The commits a later commit says it reverts (`git revert` writes "This reverts commit <sha>"). → Set of the shas named.
export function revertedCommits(root) {
  const r = spawnSync('git', ['log', '-n', '2000', '--format=%B'], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  return new Set(r.status === 0 ? [...r.stdout.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map((m) => m[1]) : []);
}
const isReverted = (commits, reverted) => (commits || []).some((c) => [...reverted].some((x) => x.startsWith(String(c)) || String(c).startsWith(x)));

// The verdict of a task, read from what happened after it and never stored (a chained record cannot be edited): `reverted` when a commit of it was reverted,
// `reworked` when a later task changed the same files, `continued` when it has a follow-up; null when nothing happened, never invented.
export function verdictOf(rec, records, reverted) {
  if (isReverted(rec.commits, reverted || new Set())) return 'reverted';
  if ((records || []).some((r) => r.id !== rec.id && (r.reworks || []).includes(rec.id))) return 'reworked';
  if (followUps(records || [], rec.id).length) return 'continued';
  return null;
}

// The summary of the projects named. → { schema, tasks, counts } where counts holds only values from a list or a bucket.
export async function buildReport(roots = [process.cwd()]) {
  const L = lists();
  const counts = { level: {}, outcome: {}, cause: {}, department: {}, failedTestigo: {}, durationBucket: {}, tokenBucket: {}, stack: {}, size: {}, agent: {}, modelFamily: {}, modelChanged: {}, verdict: {} };
  let tasks = 0;
  for (const root of roots) {
    const home = projectHome(root);
    if (!home.dir) continue;
    const records = readTaskRecords(home).filter((r) => r.id && !r.kind), reverted = revertedCommits(home.root);
    for (const r of records) {
      tasks++;
      bump(counts.level, pick(r.level === undefined || r.level === null ? null : String(r.level), ['0', '1', '2', '3', 'Q']));
      bump(counts.outcome, pick(r.outcome?.result, ['hecho', 'parcial', 'bloqueado']));
      if (r.outcome?.cause) bump(counts.cause, pick(r.outcome.cause, ['external']));
      bump(counts.department, pick(String(r.department?.declared || '').replace(/^dept-/, ''), DEPARTMENTS));
      for (const s of r.evaluation?.steps || []) if (s.applies !== false && s.pass === false) bump(counts.failedTestigo, pick(s.id, L.testigos));
      bump(counts.durationBucket, durationBucket(r.observed?.time?.minutes));
      bump(counts.tokenBucket, tokenBucket(r.evaluation?.tokens));
      bump(counts.stack, pick(r.projectKind?.stack, L.stacks));
      bump(counts.size, pick(r.projectKind?.size, ['xs', 's', 'm', 'l']));
      bump(counts.agent, pick(r.agent, L.agents));
      bump(counts.modelFamily, modelFamily(r.inputs?.model));
      if (r.modelChanged) bump(counts.modelChanged, 'yes');
      const v = verdictOf(r, records, reverted);
      if (v) bump(counts.verdict, v); // none when nothing happened after the task
    }
  }
  return { schema: SCHEMA, tasks, counts: Object.fromEntries(Object.entries(counts).filter(([, v]) => Object.keys(v).length)) };
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--out');
  const out = at >= 0 ? args[at + 1] : null, roots = args.filter((a, i) => !a.startsWith('--') && i !== at + 1);
  const report = await buildReport(roots.length ? roots : [process.cwd()]);
  const json = JSON.stringify(report, null, 1);
  if (out) fs.writeFileSync(out, json + '\n');
  console.log(`Waymark report (${SCHEMA}): ${report.tasks} task(s). Counts and shapes of your own usage only: no prompt, path, file name, code, project name or address. Read it before you share it; Waymark never sends it, so nothing is sent. If you choose to share it, the pattern-report issue form is the channel.${out ? ` Written to ${out}.` : ''}\n\n${json}`);
}
