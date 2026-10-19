// The agents the conformance suite runs on: every driver in tests/conformance/agents/ (a new adapter that is installed brings its driver there).
// `waymark.mjs adapter-new` runs the suite on a draft that is not installed yet: WAYMARK_CONFORMANCE_DRIVERS names its driver (a path, comma
// separated) and WAYMARK_CONFORMANCE_ONLY the keys to run, so only the draft is judged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents');
const order = ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'copilot', 'kiro', 'antigravity']; // the first eight keep their order; a later one follows by name

export async function loadAgents() {
  const keys = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs') && f !== 'common.mjs').map((f) => f.slice(0, -4));
  const sorted = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k)).sort()];
  const agents = await Promise.all(sorted.map(async (k) => (await import(pathToFileURL(path.join(DIR, `${k}.mjs`)).href)).default));
  for (const f of String(process.env.WAYMARK_CONFORMANCE_DRIVERS || '').split(',').filter(Boolean)) agents.push((await import(pathToFileURL(f).href)).default);
  const only = String(process.env.WAYMARK_CONFORMANCE_ONLY || '').split(',').filter(Boolean);
  return only.length ? agents.filter((a) => only.includes(a.key)) : agents;
}
