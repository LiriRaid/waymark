#!/usr/bin/env node
// Waymark · what the real runs of tests/external/run-agent.mjs measured, per repository (docs/adr/0027, 2.0.17 point 4).
// Reads, for each repository of corpus.json, the run's summary.json (tokens, turns, the harness's answers and denials) and the
// clone's own .waymark/ (the record the hooks wrote, the memory the agent bootstrapped, the diff), and writes one structured
// file: schema waymark.external-results/v1, the shape a later learning step can read. It states what it could not measure.
//   node summarize-runs.mjs <ext-dir> [--detect <detection.json>] [--out <file>]
//   <ext-dir>/runs/<id>/summary.json and /after/   what run-agent.mjs wrote: the summary, and the clone's .waymark/ and diff
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ext = path.resolve(argv[0] || '.');
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));
const detection = opt('--detect') ? JSON.parse(fs.readFileSync(opt('--detect'), 'utf8')) : null;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

const results = [];
for (const repo of corpus.repos) {
  const runDir = path.join(ext, 'runs', repo.id);
  const sum = (() => { try { return JSON.parse(read(path.join(runDir, 'summary.json'))); } catch { return null; } })();
  const after = path.join(runDir, 'after'); // what run-agent.mjs copied out of the clone
  const records = read(path.join(after, '.waymark', 'provenance.jsonl')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const rec = records[records.length - 1] || null;
  const memory = read(path.join(after, '.waymark', 'memory.md'));
  const patch = read(path.join(after, 'diff.patch'));
  const changed = [...patch.matchAll(/^diff --git a\/(.+?) b\/.+$/gm)].map((m) => m[1]).filter((f) => f !== '.gitignore').map((file) => ({ file }));
  const steps = rec?.evaluation?.steps || {};
  const mark = (v) => (v === true ? '✔' : v === false ? '✘' : v === 'warn' ? '⚠' : String(v));
  const notMeasured = [];
  if (!rec) notMeasured.push('no record: the hook wrote none');
  const gateCmd = repo.expect?.gates && Object.values(repo.expect.gates)[0];
  if (gateCmd && !(rec?.commands || []).some((c) => /test|check|build|lint|validate|fmt/.test(JSON.stringify(c)))) notMeasured.push(`gate "${gateCmd}" was not run: the toolchain is not installed on this machine or the agent did not run it`);
  results.push({
    id: repo.id, commit: repo.commit, field: repo.field, language: repo.language,
    task: { kind: repo.task?.kind || null, file: repo.task?.file || null, prompt: repo.task?.prompt || null },
    detection: detection?.repos?.find((r) => r.id === repo.id)?.detected ?? null,
    expect: repo.expect,
    run: sum && { model: sum.model, subtype: sum.subtype, error: sum.error, turns: sum.turns, durationMs: sum.durationMs, costUsd: sum.costUsd, usage: sum.usage, choiceAnswers: sum.answers?.length ?? 0, denials: sum.denials?.length ?? 0, denied: sum.denials || [] },
    bootstrap: { memoryExists: !!memory, bytes: memory.length, names: { stack: /stack|repo:|rust|php|python|terraform|kotlin|android|go|node|java|c\b|cmake|markdown|docs?/i.test(memory.split('## Work')[0] || ''), gates: /gate|test|lint|build|typecheck/i.test(memory.split('## Work')[0] || '') }, text: memory.slice(0, 600) },
    routing: { level: rec?.level ?? null, declared: rec?.department?.declared ?? null, invoked: rec?.department?.invoked ?? [] },
    record: rec && { id: rec.id, result: rec.outcome?.result, steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, mark(v)])), failed: Object.entries(steps).filter(([, v]) => v === false).map(([k]) => k), warned: Object.entries(steps).filter(([, v]) => v === 'warn').map(([k]) => k), findings: rec.findings || [], unresolved: rec.unresolved || [], score: rec.evaluation?.score ?? null },
    tokensByLink: rec?.evaluation?.links ? Object.fromEntries(Object.entries(rec.evaluation.links).filter(([k]) => k !== 'v')) : null,
    changed, notMeasured,
  });
}
const out = { schema: 'waymark.external-results/v1', corpusSchema: corpus.schema, waymark: read(path.join(HERE, '..', '..', 'skills', 'waymark', 'VERSION')).trim(), agent: 'claude-code (headless, stream-json)', at: new Date().toISOString().slice(0, 10), repos: results };
const file = opt('--out');
if (file) fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
for (const r of results) console.log(`${r.id.padEnd(18)} ${String(r.run?.subtype || 'no run').padEnd(8)} turns ${String(r.run?.turns ?? '-').padStart(3)}  $${(r.run?.costUsd ?? 0).toFixed(3)}  dept ${r.routing.declared || '-'}  ✘ [${(r.record?.failed || []).join(',')}] ⚠ [${(r.record?.warned || []).join(',')}]  files ${r.changed.length}`);
