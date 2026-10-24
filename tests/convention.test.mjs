// Waymark 2.0.19 · point 1: a profile is a reference, never the project's rule (docs/adr/0043). `waymark.mjs convention` censuses where each
// kind of piece lives in a repository, names the commit that set the structure and judges a proposed move against it. Every repository here
// is a synthetic copy of a pattern: no real project, path or prompt. Run: node --test tests/convention.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const C = await import(`file://${SCRIPTS}/convention.mjs`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

const write = (dir, files) => { for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body ?? ''); } };
const g = (dir, date, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
// A repository whose commits carry the dates given: [{ date, files }, …].
const repo = (commits) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-conv-')); temps.push(d);
  g(d, commits[0].date, 'init', '-q', '-b', 'main');
  for (const c of commits) { write(d, c.files); g(d, c.date, 'add', '-A'); g(d, c.date, 'commit', '-q', '-m', 'x'); }
  return d;
};
const many = (n, f) => Object.fromEntries(Array.from({ length: n }, (_, i) => f(i + 1)));

// every UI piece (component, modal, its template and its styles) in shared/; the features hold services, models and routes
const sharedUi = () => repo([
  { date: '2020-01-01T10:00:00Z', files: {
    ...many(5, (i) => [`src/app/shared/button-${i}/button-${i}.component.ts`, '']),
    ...many(5, (i) => [`src/app/shared/button-${i}/button-${i}.component.html`, '<button></button>']),
    ...many(5, (i) => [`src/app/shared/button-${i}/button-${i}.component.css`, 'button { width: 40px }']),
    'src/app/shared/modals/confirm-modal.component.ts': '', 'src/app/shared/modals/edit-modal.component.ts': '',
    'src/app/features/inbox/services/inbox.service.ts': '', 'src/app/features/inbox/models/inbox.model.ts': '',
    'src/app/features/contacts/services/contacts.service.ts': '', 'src/app/features/contacts/models/contact.model.ts': '',
  } },
  { date: '2020-06-01T10:00:00Z', files: { 'src/app/core/auth/auth.service.ts': '', 'package-lock.json': '{}' } },
]);
// the opposite convention: each piece lives in the one feature that uses it
const scopeRule = () => repo([{ date: '2021-02-02T10:00:00Z', files: {
  ...many(5, (i) => [`src/app/features/inbox/components/row-${i}.component.ts`, '']), ...many(3, (i) => [`src/app/features/contacts/components/card-${i}.component.ts`, '']),
  'src/app/shared/spinner/spinner.component.ts': '', 'src/app/shared/spinner/spinner.component.css': 'a {}', 'src/app/features/inbox/inbox.service.ts': '',
} }]);
// too little to say anything
const bare = () => repo([{ date: '2022-03-03T10:00:00Z', files: { 'src/app/shared/a.component.ts': '', 'src/app/features/x/b.component.ts': '' } }]);

test('logic: a repository whose UI always lived in shared/ is a Shared UI repository, and moving a piece into a feature CONTRADICTS it with the first commit cited', () => {
  const conv = C.census(sharedUi());
  assert.equal(conv.variant, 'shared-ui');
  assert.equal(conv.kinds.component.dominant, 'shared');
  assert.equal(conv.kinds.modal.dominant, null, 'two modals are too few to say anything on their own');
  assert.equal(conv.structure.date, '2020-01-01');
  assert.match(conv.structure.hash, /^[0-9a-f]{7,}$/);
  assert.equal(conv.lockfile, 'package-lock.json', 'the repo\'s own lockfile decides the package manager');
  const v = C.judgeMove(conv, 'ui', 'shared', 'features/inbox');
  assert.equal(v.verdict, 'contradicts');
  assert.match(v.line, /CONTRADICTS the project's convention/);
  assert.ok(v.line.includes(conv.structure.hash) && v.line.includes('2020-01-01'), v.line);
  assert.match(v.line, /Recommended: do not move/);
  assert.equal(C.judgeMove(conv, 'ui', 'features', 'shared').verdict, 'follows', 'a piece going to where the convention puts it follows it');
});

test('CSS/HTML: a repository whose templates and styles live together in shared/ places a new component there, and moving its styles into a feature CONTRADICTS', () => {
  const conv = C.census(sharedUi());
  assert.deepEqual([conv.kinds.style.dominant, C.whereToPlace(conv, 'style').layer], ['shared', 'shared']);
  assert.equal(C.whereToPlace(conv, 'ui').layer, 'shared', 'a new component with its CSS and HTML goes where the others are');
  assert.equal(C.judgeMove(conv, 'style', 'src/app/shared/button-1', 'src/app/features/inbox').verdict, 'contradicts', 'paths are read as their layer');
});

test('counter-example: the verdict follows the repository, not a profile: where the UI lives in the features, moving it into shared/ is what CONTRADICTS', () => {
  const conv = C.census(scopeRule());
  assert.equal(conv.variant, 'scope-rule');
  assert.equal(C.judgeMove(conv, 'ui', 'features', 'shared').verdict, 'contradicts');
  assert.equal(C.judgeMove(conv, 'ui', 'shared', 'features').verdict, 'follows');
});

test('counter-example: a repository with no convention gets the profile default, marked as such, never "the project\'s rule"', () => {
  const conv = C.census(bare());
  assert.equal(conv.variant, 'none');
  const v = C.judgeMove(conv, 'ui', 'shared', 'features');
  assert.equal(v.verdict, 'no-convention');
  assert.match(v.line, /marked "profile default"/);
  assert.equal(C.whereToPlace(conv, 'ui').layer, null);
});

test('a component of the newer naming (no .component suffix, @Component in the file) is counted, a plain class beside it is not', () => {
  const d = repo([{ date: '2023-01-01T10:00:00Z', files: {
    ...many(4, (i) => [`src/app/shared/card-${i}/card-${i}.ts`, '@Component({ selector: "c" })\nexport class C {}']),
    'src/app/shared/card-1/helper.ts': 'export class Plain {}', 'src/app/shared/edit-dialog/edit-dialog.ts': '@Component({})\nexport class D {}',
    'src/app/features/inbox/inbox.service.ts': '', 'src/app/features/inbox/inbox.model.ts': '',
  } }]);
  const conv = C.census(d);
  assert.deepEqual([conv.kinds.component.total, conv.kinds.modal.total, conv.kinds.component.dominant], [4, 1, 'shared']);
  assert.equal(conv.variant, 'shared-ui');
});

test('a folder with no git and no source still answers: nothing to cite, nothing to place', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-conv-')); temps.push(d);
  write(d, { 'README.md': 'x' });
  const conv = C.census(d);
  assert.equal(conv.variant, 'none');
  assert.equal(conv.structure, null);
  assert.equal(C.fillMemory(path.join(d, 'missing.md'), conv), false);
});

test('fillMemory: the placeholders of the template become the census, marked to confirm; a line somebody wrote stays; a second run changes nothing', () => {
  const conv = C.census(sharedUi()), d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-conv-')); temps.push(d);
  const file = path.join(d, 'memory.md'), template = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'templates', 'project-memory.template.md'), 'utf8');
  fs.writeFileSync(file, template);
  assert.equal(C.fillMemory(file, conv), true);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^- Architecture: screaming — Shared UI: .*2020-01-01.*\(to confirm\)$/m);
  assert.match(text, /## Conventions specific to this project\n- Placement \(to confirm, detected \d{4}-\d{2}-\d{2}\): Shared UI/);
  assert.match(text, /- component pieces live in shared \(5\/5\); a new one goes there/);
  assert.equal(C.fillMemory(file, conv), false, 'no placeholder left, nothing to write');
  const own = '## Identity\n- Architecture: hexagonal — ports in src/ports\n\n## Conventions specific to this project\n- UI in shared\n';
  fs.writeFileSync(file, own);
  assert.equal(C.fillMemory(file, conv), false);
  assert.equal(fs.readFileSync(file, 'utf8'), own, 'what a person wrote is never overwritten');
});

test('a turn that writes into an agent\'s own memory folder is told where the user\'s rule belongs; a project file and a spec are not', async () => {
  const { nativeMemoryWrites, nativeMemoryNote } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const w = (p, name = 'Write') => ({ name, input: { file_path: p } });
  const home = path.join(os.homedir(), '.claude', 'projects', 'C--work-app', 'memory');
  const files = nativeMemoryWrites([w(path.join(home, 'feedback-style.md')), w(path.join(home, 'feedback-style.md'), 'Edit'), w('C:\\work\\app\\src\\a.css'), w('/work/app/src/a.spec.ts'), { name: 'Read', input: { file_path: path.join(home, 'x.md') } }]);
  assert.equal(files.length, 1, 'the same file twice counts once; a read, a stylesheet and a spec are no native-memory write');
  assert.match(nativeMemoryNote(files), /preferences\.md.*Conventions/);
  assert.equal(nativeMemoryNote([]), '', 'no write, no note');
});

// A repository whose versioned .gitignore holds Waymark's blocks (what 2.0.18 wrote) beside the project's own lines.
const withOldBlocks = (extra = {}) => {
  const d = repo([{ date: '2024-01-01T10:00:00Z', files: { '.gitignore': 'dist/\nnode_modules/\n# Waymark: project memory, local only\n.waymark/\n# project skills, every agent, local only\n.agents/\n', 'src/a.css': 'a {}', ...extra } }]);
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n');
  return d;
};

test('check lists Waymark\'s lines in a versioned .gitignore, and localize moves them to .git/info/exclude leaving the project\'s own lines', async () => {
  const { footprint, localize, ignoreLines } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const d = withOldBlocks();
  assert.match(footprint(d), /^repo: Waymark wrote 2 ignore blocks \(\.waymark\/ \.agents\/\) into this project's versioned \.gitignore/);
  assert.deepEqual(localize(d), { moved: ['.waymark/', '.agents/'], plan: true });
  assert.match(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), /\.waymark\//, 'the plan writes nothing');
  assert.deepEqual(localize(d, { apply: true }).moved, ['.waymark/', '.agents/']);
  assert.equal(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), 'dist/\nnode_modules/\n', 'the project\'s own lines stay');
  assert.match(fs.readFileSync(path.join(d, '.git', 'info', 'exclude'), 'utf8'), /^\.waymark\/$/m);
  assert.equal(footprint(d), '', 'nothing left to move');
  assert.equal(ignoreLines(d), null);
});

test('counter-example: a .gitignore with only the project\'s own lines, and a folder with no Waymark memory, have nothing to move; a .gitignore only Waymark wrote and git never tracked is removed', async () => {
  const { footprint, localize } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const clean = repo([{ date: '2024-01-01T10:00:00Z', files: { '.gitignore': 'dist/\n', 'src/a.html': '<a></a>' } }]);
  fs.mkdirSync(path.join(clean, '.waymark')); fs.writeFileSync(path.join(clean, '.waymark', 'memory.md'), '# P\n');
  assert.equal(footprint(clean), '');
  assert.deepEqual(localize(clean, { apply: true }), { moved: [] });
  assert.equal(fs.readFileSync(path.join(clean, '.gitignore'), 'utf8'), 'dist/\n');
  const mine = repo([{ date: '2024-01-01T10:00:00Z', files: { 'src/a.css': 'a {}' } }]);
  fs.mkdirSync(path.join(mine, '.waymark')); fs.writeFileSync(path.join(mine, '.waymark', 'memory.md'), '# P\n');
  fs.writeFileSync(path.join(mine, '.gitignore'), '# Waymark: project memory, local only\n.waymark/\n');
  assert.equal(localize(mine, { apply: true }).moved.length, 1);
  assert.equal(fs.existsSync(path.join(mine, '.gitignore')), false, 'a file only Waymark wrote goes with its lines');
});

test('the command: waymark.mjs convention <repo> --move shared features prints the verdict a structural-change window shows', () => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'convention', sharedUi(), '--move', 'shared', 'features', '--kind', 'ui', '--files', '56'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /56 files, ui: shared → features: CONTRADICTS the project's convention/);
  const census = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'convention', sharedUi()], { encoding: 'utf8' });
  assert.match(census.stdout, /^convention: Shared UI:/);
  assert.match(census.stdout, /component: shared 5 · core 0 · features 0 · other 0 → shared/);
});
