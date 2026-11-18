// Waymark · the files the Kiro adapter writes in a workspace (docs/adr/0063). The Kiro IDE (1.1.3) reads neither the global
// ~/.kiro/hooks/waymark.json nor ~/.kiro/steering/AGENTS.md: it loads rules from the workspace's .kiro/steering/*.md and hooks from
// .kiro/hooks/*.kiro.hook, a JSON file { enabled, name, description, version: "1", when: { type }, then: { type: "runCommand", command, timeout } }.
// A runCommand hook gets only the environment variable USER_PROMPT: no JSON on stdin, so no session, tool or result. So the workspace has two
// hooks (promptSubmit → rule0-hook.mjs, agentStop → stop-hook.mjs) and no tool hooks (they would journal nothing), plus the Rule 0 block as a
// steering file (`inclusion: always`), all kept out of git through the clone's .git/info/exclude. Every folder written is registered in
// ~/.waymark/kiro-workspaces.json, so uninstall.mjs finds them; it removes only what carries Waymark's marks.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { waymarkHome, slash, hookCommand } from './lib/paths.mjs';
import { read } from './lib/fs.mjs';
import { instructionsBlock } from './connect-agents.mjs';

export const EXCLUDE_LINE = '/.kiro/';
const registry = () => path.join(waymarkHome(), 'kiro-workspaces.json');
const TIMEOUT = 60;
// [Kiro's event, the core's event, the script, the file's id]
const EVENTS = [['promptSubmit', 'UserPromptSubmit', 'rule0-hook.mjs', 'waymark-prompt'], ['agentStop', 'Stop', 'stop-hook.mjs', 'waymark-stop']];
export const STEERING = path.join('.kiro', 'steering', 'waymark.md');
const OURS_HOOK = /waymark[\\/]+scripts[\\/]+[\w-]+-hook\.mjs/;

export const excludeFile = (root) => {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    return r.status === 0 && r.stdout.trim() ? path.resolve(root, r.stdout.trim()) : null;
  } catch { return null; }
};
const excluded = (root) => { const f = excludeFile(root); return !f || read(f).split(/\r?\n/).some((l) => l.trim() === EXCLUDE_LINE); };

export function hookFile(kiroEvent, event, script, id, scripts) {
  return JSON.stringify({
    enabled: true, name: `Waymark · ${event}`, description: `Waymark's ${event} hook (${script}); written by install-hooks.mjs --agent kiro, removed by uninstall.mjs`, version: '1',
    when: { type: kiroEvent }, then: { type: 'runCommand', command: `${hookCommand(scripts, script)} --agent kiro --event ${event}`, timeout: TIMEOUT },
  }, null, 2) + '\n';
}
export const steeringText = () => `---\ninclusion: always\n---\n${instructionsBlock()}\n`;

// → { root, files: [{ file, text, state: 'add' | 'update' | 'same' }], exclude: the line is still to add, registered }; nothing is written.
export function planWorkspace(root, { scripts } = {}) {
  const dir = path.resolve(root), want = [
    ...EVENTS.map(([k, e, s, id]) => [path.join(dir, '.kiro', 'hooks', `${id}.kiro.hook`), hookFile(k, e, s, id, scripts)]),
    [path.join(dir, STEERING), steeringText()],
  ];
  const files = want.map(([file, text]) => { const have = fs.existsSync(file) ? read(file) : null; return { file, text, state: have === null ? 'add' : have === text ? 'same' : 'update' }; });
  return { root: dir, files, exclude: !excluded(dir), registered: workspaces().includes(dir) };
}
export const pending = (plan) => plan.files.some((f) => f.state !== 'same') || plan.exclude || !plan.registered;

export function applyWorkspace(plan) {
  for (const f of plan.files) if (f.state !== 'same') {
    fs.mkdirSync(path.dirname(f.file), { recursive: true });
    if (f.state === 'update') fs.copyFileSync(f.file, `${f.file}.waymark-bak`); // a file the user edited is kept beside the new one
    fs.writeFileSync(f.file, f.text);
  }
  const ex = plan.exclude ? excludeFile(plan.root) : null;
  if (ex) { const text = read(ex); fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.writeFileSync(ex, text + (text && !text.endsWith('\n') ? '\n' : '') + `${EXCLUDE_LINE}\n`); }
  keep([...new Set([...workspaces(), plan.root])]);
}

export function workspaces() {
  try { const l = JSON.parse(fs.readFileSync(registry(), 'utf8')); return Array.isArray(l) ? l.map(String) : []; } catch { return []; }
}
function keep(list) {
  if (!list.length) { fs.rmSync(registry(), { force: true }); return; }
  fs.mkdirSync(path.dirname(registry()), { recursive: true });
  fs.writeFileSync(registry(), JSON.stringify(list, null, 1) + '\n');
}

// What uninstall removes: only files that are Waymark's (a hook that runs its scripts, the steering file with its block), the exclude line, the registry entry.
// → steps { agent, file, what, write } for every registered folder that still has something of Waymark's.
export function removalSteps() {
  const steps = [];
  for (const root of workspaces()) {
    const mine = [];
    for (const [, , , id] of EVENTS) {
      const file = path.join(root, '.kiro', 'hooks', `${id}.kiro.hook`), text = read(file);
      if (text && OURS_HOOK.test(text)) mine.push(file);
    }
    const steer = path.join(root, STEERING);
    if (/<!-- waymark:begin -->/.test(read(steer))) mine.push(steer);
    for (const file of mine) steps.push({ agent: 'kiro-workspace', file, what: `remove Waymark's Kiro workspace file (${slash(path.relative(root, file))})`, write: () => fs.rmSync(file, { force: true }) });
    const ex = excludeFile(root);
    if (ex && read(ex).split(/\r?\n/).some((l) => l.trim() === EXCLUDE_LINE)) {
      steps.push({ agent: 'kiro-workspace', file: ex, what: `remove the line ${EXCLUDE_LINE} from ${slash(path.relative(root, ex))}`, write: () => fs.writeFileSync(ex, read(ex).split(/\r?\n/).filter((l) => l.trim() !== EXCLUDE_LINE).join('\n').replace(/\n*$/, '\n')) });
    }
    steps.push({ agent: 'kiro-workspace', what: `forget ${slash(root)} in ${slash(registry())}`, write: () => keep(workspaces().filter((w) => w !== root)) });
  }
  return steps;
}
