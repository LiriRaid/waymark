// Waymark · the newest version main publishes, kept in ~/.waymark/.latest.json (docs/adr/0066). The session card reads it (no network) and says, in every
// session, that the install is behind until it is updated; a detached process (latest.mjs) refreshes it at most every six hours, so no hook waits for GitHub.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waymarkHome } from './paths.mjs';
import { newer } from './version.mjs';

export const LATEST_FILE = () => path.join(waymarkHome(), '.latest.json');
export const REFRESH_EVERY = 6 * 3600000;
// → { latest, at } or null (no file, or one that does not parse).
export function readLatest() {
  try { const l = JSON.parse(fs.readFileSync(LATEST_FILE(), 'utf8')); return l && typeof l === 'object' ? l : null; } catch { return null; }
}
export const refreshDue = (now = Date.now()) => { const l = readLatest(); return !l || !Number.isFinite(l.at) || now - l.at >= REFRESH_EVERY; };

// The version in main's skills/waymark/VERSION (WAYMARK_UPDATE_URL points elsewhere, the tests serve one from localhost), or '' when it cannot be read in `timeout` ms.
export async function fetchLatest({ timeout = 3000 } = {}) {
  const repo = process.env.WAYMARK_REPO || 'LiriRaid/waymark';
  try {
    const res = await fetch(process.env.WAYMARK_UPDATE_URL || `https://raw.githubusercontent.com/${repo}/main/skills/waymark/VERSION`, { signal: AbortSignal.timeout(timeout) });
    const text = res.ok ? (await res.text()).trim() : '';
    return /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(text) ? text : '';
  } catch { return ''; }
}
// Writes the answer; a failed one keeps the last known version and only dates the attempt, so a bad network is not asked again at once.
export function keepLatest(latest) {
  const prev = readLatest();
  try { fs.mkdirSync(path.dirname(LATEST_FILE()), { recursive: true }); fs.writeFileSync(LATEST_FILE(), JSON.stringify({ latest: latest || prev?.latest || null, at: Date.now() })); } catch {}
}
// The line the card adds while the install is behind; '' when it is current, ahead, or nothing is known.
export function updateLine(installed) {
  const l = readLatest();
  if (!l?.latest || !installed || !newer(l.latest, installed)) return '';
  return `Update: Waymark ${installed} → ${l.latest} is published. Before the task, offer in your choice window: "Actualizar ahora" / "Más tarde" / "Ver cambios" (CHANGELOG.md entries since ${installed}). "Actualizar ahora" is the clean reinstall of INSTALL.md §12 (backup first; the skills from a signature-verified export of origin/main; read §12 of the new version's INSTALL.md at https://github.com/${process.env.WAYMARK_REPO || 'LiriRaid/waymark'}/blob/main/INSTALL.md, since the installed skills carry no INSTALL.md), asking each step as §12 marks it.`;
}
// Starts the refresh as a process of its own that outlives the hook.
export function startRefresh() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'latest.mjs');
  spawn(process.execPath, [script], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
}
