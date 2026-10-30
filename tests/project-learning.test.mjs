// Waymark 2.0.20 · points 11, 16 and 23: what the project learns from the user is proposed for its own Conventions (the user decides, never the agent); the API line is in the block.
// Synthetic copies of the real corrections (ADR 0042). Run: node --test tests/project-learning.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-projlearn-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { corrections, proposals } = await import(`file://${SCRIPTS}/learn.mjs`);

const rec = (n, prompt) => ({ id: `2026-10-2${n} · T${n}`, prompt, at: `2026-10-2${n}T10:00:00Z`, level: 2 });
const memory = (conventions = '- …') => { const f = path.join(home, `memory-${Math.random()}.md`); fs.writeFileSync(f, `# P\n\n## Conventions specific to this project\n${conventions}\n\n## Work in progress\n`); return { memory: f, dir: home }; };

test('11: the second equal correction — reuse the existing piece, a size class, a default — is a proposal for the project\'s Conventions', () => {
  const reuse = corrections([rec(1, 'agrega el botón de exportar, reutiliza el componente app-button que ya existe en shared'), rec(2, 'ahora el de importar: reutiliza el componente app-button que ya existe, no crees otro')]);
  assert.equal(reuse.length, 1, 'two tasks, the same correction');
  assert.deepEqual(reuse[0].ids, ['2026-10-21 · T1', '2026-10-22 · T2']);
  const size = corrections([rec(3, 'abre la modal de pedidos con el tamaño por defecto md en los modales'), rec(4, 'la de clientes igual, por defecto md en los modales')]);
  assert.equal(size.length, 1, 'a default said twice');
});

test('11: counter-examples — one saying is no rule; two different corrections are two sayings; a plain ask with the same words is not a correction', () => {
  assert.equal(corrections([rec(1, 'reutiliza el componente app-button que ya existe')]).length, 0, 'once');
  assert.equal(corrections([rec(1, 'reutiliza el componente app-button que ya existe'), rec(2, 'reutiliza la tabla de pedidos que ya existe en features')]).length, 0, 'different pieces');
  assert.equal(corrections([rec(1, 'agrega el botón de exportar al encabezado'), rec(2, 'agrega el botón de importar al encabezado')]).length, 0, 'no correction cue');
});

test('11: the proposal names the project\'s Conventions (and the user-level preferences only for what holds in every project); a line already there is not proposed again', () => {
  const records = [rec(1, 'reutiliza el componente app-button que ya existe en shared'), rec(2, 'reutiliza el componente app-button que ya existe, no crees otro')];
  const out = proposals(memory(), records).filter((p) => p.kind === 'preference');
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Conventions[\s\S]*\.waymark\/memory\.md/, 'the project\'s file first');
  assert.match(out[0].text, /preferences\.md/, 'the user-level file for what holds everywhere');
  const known = proposals(memory('- Reutiliza el componente app-button que ya existe en shared (2026-10-22)'), records).filter((p) => p.kind === 'preference');
  assert.deepEqual(known, [], 'counter-example: the project already says it');
});

test('16: the block says the user restarts a local API unless the project\'s Conventions say the agent does, and stays within its size', () => {
  const block = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'templates', 'instructions.md'), 'utf8');
  assert.match(block, /Local API: the user restarts it unless Conventions say you do\./);
  assert.ok(block.length <= 6500, `the instructions block is ${block.length} characters`);
});

// ---- point 23: the minimal bootstrap fills what the repo itself shows ----
test('23: the template\'s Stack, Source root, Path aliases, Related projects and Reusables are filled from the repo, marked to confirm; a line somebody wrote stays', async () => {
  const { spawnSync } = await import('node:child_process');
  const C = await import(`file://${SCRIPTS}/convention.mjs`);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-boot-')); after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = { 'package.json': JSON.stringify({ name: 'web', dependencies: { '@angular/animations': '^20.1.0', '@angular/common': '^20.1.0', '@angular/core': '^20.1.0', rxjs: '~7.8.0' } }), 'tsconfig.json': '{\n  // paths of the app\n  "compilerOptions": { "paths": { "@core/*": ["src/app/core/*"], /* shared */ "@shared/*": ["src/app/shared/*"] } }, // trailing note\n  "include": ["src/*/types/**/*.ts"]\n}\n' };
  for (let i = 1; i <= 5; i++) files[`src/app/shared/components/b${i}/b${i}.component.ts`] = '@Component({})\nexport class B {}\n';
  for (let i = 1; i <= 3; i++) files[`src/app/core/services/s${i}.service.ts`] = 'export class S {}\n';
  files['src/app/features/orders/orders.component.ts'] = '@Component({})\nexport class O {}\n';
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d });
  g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'x');
  const file = path.join(d, 'memory.md');
  fs.writeFileSync(file, fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'templates', 'project-memory.template.md'), 'utf8'));
  assert.equal(C.fillMemory(file, C.census(d), { related: ['api (../omni-inbox-api)'] }), true);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^- Stack: @angular\/core 20\.1\.0\b[^\n]* \(to confirm\)$/m, 'the framework, not the first dependency');
  assert.doesNotMatch(text, /^- Stack: @angular\/animations/m);
  assert.match(text, /^- Source root and layout: src\/app\/\{[a-z,]*core[a-z,]*\} \(to confirm\)$/m);
  assert.match(text, /^- Path aliases: @core\/\* → src\/app\/core\/\*, @shared\/\* → src\/app\/shared\/\* \(to confirm\)$/m, 'the tsconfig paths, comments and all');
  assert.match(text, /^- Related projects: api \(\.\.\/omni-inbox-api\) \(to confirm\)$/m);
  assert.match(text, /^ {2}- Components \/ UI: src\/app\/shared \(\d+\/\d+ [a-z]+ pieces\) \(to confirm\)$/m);
  const own = '## Identity\n- Stack: ruby 3.3 / rails 7 — mine\n- Related projects: ninguno\n\n## Project map\n- Path aliases: @/* → app/*\n';
  fs.writeFileSync(file, own);
  C.fillMemory(file, C.census(d), { related: ['x (../x)'] });
  assert.equal(fs.readFileSync(file, 'utf8'), own, 'counter-example: what a person wrote is never overwritten');
});
