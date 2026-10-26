// Waymark · the runtime a stack needs (2.0.19, point 6). A legacy Angular app runs on the Node of its day, not the machine's: Angular 10 wants Node 14 and a
// machine on Node 24 fails every gate the same way, in every session, until somebody discovers it by hand. The Node a repo asks for is read from the repo
// (`volta.node` and `engines.node` of package.json, `.nvmrc`), else from the Angular major it installs; when this machine's Node is outside it, memory.md →
// Quality gates gets a `runtime` row naming the folder of that Node on this machine (nvm-windows, nvm, Volta, fnm, asdf, mise), and the hook's own re-run of a
// gate puts it first on the PATH: a chained command keeps working and the machine's Node is never switched. TypeScript gives no Node range (its `engines` is a
// floor), so it is not read. Offline, a few file reads.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { read } from './lib/fs.mjs';
import { stackOf } from './stack.mjs';

// The Node majors each Angular major runs on (angular.dev/reference/versions), and the one to use when the machine's is not among them.
const ANGULAR = {
  8: { ok: [10], use: 10 }, 9: { ok: [10, 12], use: 12 },
  10: { ok: [10, 12, 14], use: 14 }, 11: { ok: [10, 12, 14], use: 14 }, 12: { ok: [12, 14, 16], use: 14 }, 13: { ok: [12, 14, 16], use: 14 }, 14: { ok: [14, 16], use: 16 },
  15: { ok: [14, 16, 18], use: 16 }, 16: { ok: [16, 18], use: 18 }, 17: { ok: [18, 20], use: 18 }, 18: { ok: [18, 20, 22], use: 20 }, 19: { ok: [18, 20, 22], use: 20 },
  20: { ok: [20, 22, 24], use: 22 }, 21: { ok: [20, 22, 24], use: 22 },
};

// Does a node major satisfy an `engines.node` range? Majors only (">=14 <17", "^16 || >=18", "14.x", "18"): enough to tell a machine that is outside it.
export function satisfiesMajor(range, major) {
  const alts = String(range || '').split('||').map((a) => a.trim()).filter(Boolean);
  if (!alts.length) return true;
  return alts.some((alt) => alt.split(/\s+/).filter(Boolean).every((c) => {
    const m = c.match(/^(>=|<=|>|<|\^|~|=)?v?(\d+)/);
    if (!m) return true;
    const n = Number(m[2]);
    switch (m[1]) { case '>=': return major >= n; case '>': return major > n; case '<=': return major <= n; case '<': return major < n; default: return major === n; }
  }));
}

// → { ok: [majors] | null, use: major, range?, from } the repo asks for, or null when it asks for nothing (a modern repo on any Node).
export function neededNode(root) {
  let pkg = null;
  try { pkg = JSON.parse(read(path.join(root, 'package.json'))); } catch {}
  const volta = String(pkg?.volta?.node || '').match(/^v?(\d+)/)?.[1];
  if (volta) return { use: Number(volta), ok: [Number(volta)], from: 'package.json volta' };
  const rc = ['.nvmrc', '.node-version'].map((f) => { try { return read(path.join(root, f)).trim().match(/^v?(\d+)/)?.[1]; } catch { return null; } }).find(Boolean);
  if (rc) return { use: Number(rc), ok: [Number(rc)], from: '.nvmrc' };
  const engines = pkg?.engines?.node;
  if (engines) { const use = String(engines).match(/(\d+)/)?.[1]; if (use) return { use: Number(use), range: String(engines), from: 'package.json engines' }; }
  const angular = (stackOf(root)?.deps || []).find(([n]) => n === '@angular/core')?.[1]?.match(/^(\d+)/)?.[1];
  const row = angular && ANGULAR[Number(angular)];
  return row ? { use: row.use, ok: row.ok, from: `angular ${angular}` } : null;
}

// A legacy stack: an Angular before 14 (its builds take minutes and its Node is another). → true / false
export function legacyStack(root) {
  const angular = Number((stackOf(root)?.deps || []).find(([n]) => n === '@angular/core')?.[1]?.match(/^(\d+)/)?.[1]);
  return Number.isFinite(angular) && angular < 14;
}

// The Node the shell finds first on the PATH, which is the one a gate runs on: the hook itself may run under another one a launcher pinned.
const shellNode = () => {
  const v = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }); // no shell: node.exe resolves on the PATH (DEP0190)
  return Number(String(v.stdout || '').trim().match(/^v?(\d+)/)?.[1] || process.versions.node.split('.')[0]);
};
// Where each manager keeps its Nodes: [name, base folder, the folder of one version that holds the binary]. Versions are named `v14.21.3` or `14.21.3`.
const LAYOUTS = ({ env, home, platform }) => {
  const win = platform === 'win32', bin = (d) => (win ? d : path.join(d, 'bin'));
  return [
    ['nvm-windows', win ? env.NVM_HOME || (env.APPDATA ? path.join(env.APPDATA, 'nvm') : null) : null, (d) => d],
    ['nvm', win ? null : path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), (d) => path.join(d, 'bin')],
    ['volta', win ? (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'node') : null) : path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'tools', 'image', 'node'), bin],
    ['fnm', path.join(env.FNM_DIR || (win ? path.join(env.APPDATA || home, 'fnm') : path.join(home, '.local', 'share', 'fnm')), 'node-versions'), (d) => bin(path.join(d, 'installation'))],
    ['asdf', path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'installs', 'nodejs'), bin],
    ['mise', path.join(env.MISE_DATA_DIR || path.join(home, '.local', 'share', 'mise'), 'installs', 'node'), bin],
  ];
};
const semver = (n) => (String(n).match(/^v?(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
// → { via, dir } of the newest Node of `major` this machine has in a manager's folder (the folder that holds the node binary), or null.
export function nodeDir(major, { env = process.env, home = process.env.HOME || process.env.USERPROFILE || '', platform = process.platform } = {}) {
  const exe = platform === 'win32' ? 'node.exe' : 'node';
  for (const [via, base, dirOf] of LAYOUTS({ env, home, platform })) {
    if (!base) continue;
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    const mine = names.filter((n) => semver(n)[0] === major).sort((a, b) => { const x = semver(a), y = semver(b); return y[1] - x[1] || y[2] - x[2]; });
    for (const n of mine) { const dir = dirOf(path.join(base, n)); if (fs.existsSync(path.join(dir, exe))) return { via, dir }; }
  }
  return null;
}

// → null when this machine's Node satisfies the repo (nothing to change), else { use, from, machine, via, dir, prefix }: `prefix` is the row's cell,
// `node <dir>` (null when no manager here has that Node: the row then says which Node is needed).
export function runtimeOf(root, { machine = null, dirOf = (major) => nodeDir(major) } = {}) {
  const need = neededNode(root);
  if (!need) return null;
  machine ??= shellNode();
  if (need.range ? satisfiesMajor(need.range, machine) : need.ok.includes(machine)) return null;
  const found = dirOf(need.use);
  return { use: need.use, from: need.from, machine, via: found?.via || null, dir: found?.dir || null, prefix: found ? `node ${found.dir}` : null };
}

// The folder a `node <dir>` cell names, or null (a command the user wrote stays a command prefix).
export const runtimeDir = (cell) => String(cell || '').match(/^node\s+(.+)$/)?.[1]?.trim() || null;
// The environment that runs a gate on that Node: this one with the folder first on the PATH (whatever the case of its key on Windows).
export function runtimeEnv(dir, env = process.env) {
  const key = Object.keys(env).find((k) => /^path$/i.test(k)) || 'PATH';
  return { ...env, [key]: `${dir}${path.delimiter}${env[key] || ''}` };
}

// The cell memory.md's `runtime` row names, or null (no row, "none (…)", a <placeholder>). Written by fillRuntime, or by the user in their own words.
export function runtimePrefix(memoryText) {
  const rows = (String(memoryText).match(/\n## Quality gates[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] || '').split('\n').filter((r) => r.trim().startsWith('|'));
  for (const r of rows) {
    const [gate, cmd] = r.split('|').slice(1, 3).map((c) => String(c || '').replace(/`/g, '').trim());
    if (/^runtime$/i.test(gate || '') && cmd && !/^none\b/i.test(cmd) && !/[<>]/.test(cmd)) return cmd;
  }
  return null;
}

// Writes the `runtime` row at the end of the Quality gates table when the repo needs another Node than this machine's and no row says so yet; never over one
// somebody wrote. → the row's text, or null when nothing was written.
export function fillRuntime(memoryFile, root, opts) {
  const text = read(memoryFile);
  if (!text || /^\|\s*runtime\s*\|/im.test(text)) return null;
  const rt = runtimeOf(root, opts);
  if (!rt) return null;
  const cell = rt.prefix || `none (needs node ${rt.use} from ${rt.from}: no Node ${rt.use} folder in nvm-windows, nvm, Volta, fnm, asdf or mise)`;
  const row = `| runtime | ${rt.prefix ? `\`${cell}\`` : cell} | to confirm: node ${rt.use} (${rt.from}), this machine runs ${rt.machine}${rt.via ? ` · via ${rt.via}` : ''} |`;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## Quality gates/.test(l));
  if (start < 0) return null;
  let last = -1;
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (lines[i].trim().startsWith('|')) last = i;
  if (last < 0) return null;
  lines.splice(last + 1, 0, row);
  fs.writeFileSync(memoryFile, lines.join('\n'));
  return row;
}
