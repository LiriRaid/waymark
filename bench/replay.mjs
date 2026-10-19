#!/usr/bin/env node
// Waymark 2.0.18 · point 3 (docs/adr/0031): the replay bench. It takes the recorded tasks and recomputes what Waymark's own
// injection would have cost under the sizes of another version, so a change in what Waymark injects is shown on the SAME
// tasks, not on different ones. Offline and deterministic: no model, no network.
//   node bench/replay.mjs [--refs v2.0.16,v2.0.17,working] [--json]
// The model, in words:
//   - Waymark injects the fixed context (instructions block + context card + skill descriptions) once per session and a reminder
//     at each prompt. Both stay in the context, so every later response of the task re-reads them (a cache read).
//   - A task recorded under version A is replayed under version B by swapping A's injection for B's: the same responses, the
//     same work, the same recorded routine. It does NOT replay the agent's behaviour: a change that removes a response, or a
//     routine call, is invisible to this bench and is measured on real tasks.
//   - Injection is counted per response as (fixed + reminder) tokens x the cache-read weight; the fixed context is written once
//     for the first task of its session and the reminder once per task (the records do not keep the prompt count: one prompt,
//     a lower bound of the reminder's term). Tokens are chars / 4, the estimate size.mjs uses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COST = pathToFileURL(path.join(ROOT, 'skills', 'waymark', 'scripts', 'cost.mjs')).href;
export const SCHEMA = 'waymark.replay/v1';
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// → { ref, fixedChars, perPromptChars } for a tag (extracted to a temporary worktree and deleted) or 'working' (the tree as it is).
export function sizesAt(ref, root = ROOT) {
  let dir = root, tmp = null;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-replay-home-'));
  try {
    if (ref !== 'working') {
      tmp = path.join(os.tmpdir(), `wm-replay-${ref.replace(/[^\w.-]/g, '_')}-${process.pid}`);
      const w = spawnSync('git', ['worktree', 'add', '-q', '--detach', tmp, ref], { cwd: root, encoding: 'utf8' });
      if (w.status !== 0) return null;
      dir = tmp;
    }
    const r = spawnSync(process.execPath, [path.join(dir, 'skills', 'waymark', 'scripts', 'size.mjs'), '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home, WAYMARK_ENGRAM: '', WAYMARK_AGENTS_HOME: home }, timeout: 60000 });
    if (r.status !== 0) return null;
    const rows = JSON.parse(r.stdout);
    const n = (name) => rows.find((x) => x.name === name)?.chars || 0;
    return { ref, fixedChars: n('instructions block') + n('context card') + n('skill descriptions'), perPromptChars: n('reminder (real)') || n('reminder (full)') };
  } finally {
    if (tmp) spawnSync('git', ['worktree', 'remove', '--force', tmp], { cwd: root });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// The cost units of Waymark's injection in one task under one set of sizes. `first` is true for the first recorded task of its session.
export function injection(task, sizes, W) {
  const fixed = sizes.fixedChars / 4, reminder = sizes.perPromptChars / 4, R = task.responses || 0;
  const reads = R * (fixed + reminder) * W.cacheRead, writes = (task.first ? fixed * W.cacheWrite : 0) + reminder * W.cacheWrite;
  return { reads, writes, units: reads + writes };
}

// One task replayed: its recorded cost with the injection of `recorded` swapped for the injection of `target`.
// The routine link carries its own responses' share of the swap, so the routine share is recomputed, not assumed.
export function replayTask(task, recorded, target, W) {
  const a = injection(task, recorded, W), b = injection(task, target, W);
  const routineR = task.links?.routine?.responses || 0, R = task.responses || 0;
  const dRoutine = (R ? (b.reads - a.reads) * (routineR / R) : 0) + (b.writes - a.writes); // the writes are Waymark's own routine
  const units = task.units + (b.units - a.units), routine = (task.links ? W.unitsOf(task.links.routine) : 0) + dRoutine;
  return { id: task.id, level: task.level, units, routineUnits: routine, injectionUnits: b.units, deltaUnits: b.units - a.units };
}

// Every recorded task under each target; `recordedAt(task)` names the sizes a task was recorded under.
export function replay(tasks, targets, recordedAt, W) {
  const seen = new Set();
  const rows = tasks.filter((t) => t.links).map((t) => { const first = !seen.has(t.session); seen.add(t.session); return { ...t, first }; });
  return targets.map((target) => {
    const per = rows.map((t) => replayTask(t, recordedAt(t), target, W));
    const by = (lvl) => per.filter((p) => String(p.level) === String(lvl));
    const share = (set) => (set.length ? set.reduce((a, p) => a + p.routineUnits, 0) / set.reduce((a, p) => a + p.units, 0) : null);
    return { ref: target.ref, fixedChars: target.fixedChars, perPromptChars: target.perPromptChars, tasks: per.length,
      injectionShare: per.length ? round(per.reduce((a, p) => a + p.injectionUnits, 0) / per.reduce((a, p) => a + p.units, 0), 4) : null,
      routineShare: Object.fromEntries([1, 2, 3].map((l) => [`L${l}`, by(l).length ? round(share(by(l)), 4) : null])), routineShareAll: share(per) === null ? null : round(share(per), 4),
      unitsMean: per.length ? Math.round(per.reduce((a, p) => a + p.units, 0) / per.length) : null };
  });
}

export async function run(refs = ['v2.0.16', 'v2.0.17', 'working'], root = ROOT) {
  const C = await import(COST);
  const W = { ...C.WEIGHTS, unitsOf: C.units };
  const tasks = C.tasksOf(root);
  const sizes = new Map(refs.map((r) => [r, sizesAt(r, root)]));
  const tagOf = (t) => (/^\d+\.\d+\.\d+$/.test(String(t.version)) ? `v${t.version}` : 'working');
  const need = [...new Set(tasks.map(tagOf))].filter((r) => !sizes.has(r));
  for (const r of need) sizes.set(r, sizesAt(r, root));
  const ok = (s) => s && s.fixedChars > 0;
  const recordedAt = (t) => (ok(sizes.get(tagOf(t))) ? sizes.get(tagOf(t)) : sizes.get('working') || sizesAt('working', root));
  return { schema: SCHEMA, weights: C.WEIGHTS, assumes: 'a task recorded under version X carries the injection of tag vX; one prompt per task; the agent behaviour is not replayed', results: replay(tasks, refs.map((r) => sizes.get(r)).filter(ok), recordedAt, W) };
}

export function render(r) {
  const out = [`Waymark replay · ${r.schema} · the same recorded tasks under the injection of each version`, `Assumes: ${r.assumes}.`, '', 'ref · fixed chars · per prompt · tasks · injection share of a task · routine share L1 / L2 / L3 (cost units) · units per task'];
  const p = (x) => (x === null ? '—' : `${round(x * 100, 2)} %`);
  for (const x of r.results) out.push(`${x.ref} · ${x.fixedChars} · ${x.perPromptChars} · ${x.tasks} · ${p(x.injectionShare)} · ${p(x.routineShare.L1)} / ${p(x.routineShare.L2)} / ${p(x.routineShare.L3)} · ${x.unitsMean}`);
  return out.join('\n');
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--refs');
  const r = await run(at >= 0 ? process.argv[at + 1].split(',') : undefined);
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : render(r));
}
