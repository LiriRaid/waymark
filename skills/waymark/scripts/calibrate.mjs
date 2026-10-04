#!/usr/bin/env node
// Waymark · quota calibration from the user's own pairs: a closed task's tokens and the % of the 5-hour quota it used,
// per model, kept in ~/.waymark/calibration.jsonl (this machine).
//   node calibrate.mjs <task ID> <percent> [--project <path>]   adds the pair (tokens and model from the task's record)
//   node calibrate.mjs --list                                   shows the pairs and the current estimate per model
// Estimate: WAYMARK_TOKENS_PER_PCT if set; else 3+ pairs of the model with a token split → a weight for new tokens and
// one for cache reads (least squares); else 1+ pairs → their mean tokens per 1%; else the contract's default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHome, readRecords, readTaskRecords } from './provenance.mjs';

const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
export const pairsFile = () => path.join(HOME(), 'calibration.jsonl');
export const readPairs = (model) => readRecords(pairsFile()).filter((p) => p.pct > 0 && p.total > 0 && (!model || p.model === model));

// → { pct, by } for one task's usage ({ total, fresh?, cacheRead? }) and model.
export function estimate(usage, model, perPctDefault = 1350000) {
  const total = usage?.total || 0;
  if (!total) return { pct: null, by: null };
  const round = (x) => Math.round(x * 10) / 10;
  const env = Number(process.env.WAYMARK_TOKENS_PER_PCT);
  if (env) return { pct: round(total / env), by: 'env' };
  const pairs = readPairs(model);
  const split = pairs.filter((p) => p.fresh >= 0 && p.cacheRead >= 0 && p.fresh + p.cacheRead > 0);
  if (split.length >= 3 && usage.fresh !== undefined) {
    let ff = 0, fc = 0, cc = 0, fp = 0, cp = 0;
    for (const p of split) { ff += p.fresh ** 2; fc += p.fresh * p.cacheRead; cc += p.cacheRead ** 2; fp += p.fresh * p.pct; cp += p.cacheRead * p.pct; }
    const det = ff * cc - fc * fc, a = (fp * cc - cp * fc) / det, b = (cp * ff - fp * fc) / det;
    if (det > 0 && a >= 0 && b >= 0) return { pct: round(a * usage.fresh + b * (usage.cacheRead || 0)), by: `fit:${split.length}` };
  }
  if (pairs.length) {
    const perPct = pairs.reduce((s, p) => s + p.total / p.pct, 0) / pairs.length;
    return { pct: round(total / perPct), by: `pairs:${pairs.length}` };
  }
  return { pct: round(total / perPctDefault), by: 'default' };
}

export function addPair(taskId, pct, cwd = process.cwd(), now = new Date()) {
  const home = projectHome(cwd);
  const rec = readTaskRecords(home).reverse().find((r) => r.id === taskId); // a committed task: its note
  if (!rec) throw new Error(`task ${taskId} is not in ${home.log}`);
  const u = rec.evaluation?.usage || {};
  const pair = { at: now.toISOString(), task: taskId, project: home.slug, model: rec.inputs?.model || null, agent: rec.inputs?.agent || null, pct: Number(pct),
    total: rec.evaluation?.tokens || 0, ...(u.cacheRead !== undefined ? { fresh: (u.input || 0) + (u.cacheWrite || 0) + (u.output || 0), cacheRead: u.cacheRead } : {}) };
  if (!(pair.pct > 0) || !pair.total) throw new Error('the pair needs a percent > 0 and a record with tokens');
  fs.mkdirSync(HOME(), { recursive: true });
  fs.appendFileSync(pairsFile(), JSON.stringify(pair) + '\n');
  return pair;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const show = () => {
    const by = {};
    for (const p of readPairs()) (by[p.model] ||= []).push(p);
    for (const [m, ps] of Object.entries(by)) console.log(`${m}: ${ps.length} pair(s) · ${(ps.reduce((s, p) => s + p.total / p.pct, 0) / ps.length / 1e6).toFixed(2)}M tokens per 1% · ${ps.map((p) => `${p.task} ${p.pct}%`).join(', ')}`);
    if (!Object.keys(by).length) console.log('No pairs yet.');
  };
  if (args[0] === '--list') { show(); process.exit(0); }
  const [task, pct] = args, at = args.indexOf('--project');
  if (!task || !pct) { console.log('Usage: node calibrate.mjs "<task ID>" <percent> [--project <path>] | --list'); process.exit(1); }
  try { const p = addPair(task, pct, at >= 0 ? args[at + 1] : process.cwd()); console.log(`added: ${p.task} · ${p.model} · ${(p.total / 1e6).toFixed(2)}M tokens = ${p.pct}%`); show(); }
  catch (e) { console.log(e.message); process.exit(1); }
}
