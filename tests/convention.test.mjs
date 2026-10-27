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

// Two homes: a library of reusable UI pieces in shared/components and, in the features, their screens with their own modals and panels.
// The features hold more pieces, so a census that only looks for the dominant layer reads it as the Scope Rule.
const KIT = ['button', 'input', 'select', 'modal', 'editor', 'preview', 'reorder', 'schedule'];
const SCREENS = [['admin', 'users'], ['admin', 'teams'], ['admin', 'brands'], ['inbox', 'inbox'], ['inbox', 'header'], ['inbox', 'panel'], ['inbox', 'sidebar'],
  ['contacts', 'contacts'], ['contacts', 'card'], ['contacts', 'profile'], ['tickets', 'tickets'], ['tickets', 'detail'], ['tickets', 'form-modal'], ['admin', 'role-modal']];
const libraryAndScreens = () => repo([{ date: '2020-03-13T10:00:00Z', files: {
  ...many(KIT.length, (i) => [`src/app/shared/components/kit-${KIT[i - 1]}/kit-${KIT[i - 1]}.component.ts`, `// kit ${KIT[i - 1]}`]),
  ...many(KIT.length, (i) => [`src/app/shared/components/kit-${KIT[i - 1]}/kit-${KIT[i - 1]}.component.html`, `<div class="kit-${KIT[i - 1]}"></div>`]),
  ...many(KIT.length, (i) => [`src/app/shared/components/kit-${KIT[i - 1]}/kit-${KIT[i - 1]}.component.css`, `.kit-${KIT[i - 1]} { display: block }`]),
  ...Object.fromEntries(SCREENS.map(([f, s]) => [`src/app/features/${f}/${s}/${s}.component.ts`, `// screen ${f} ${s}`])),
  'src/app/features/admin/admin.routes.ts': '', 'src/app/features/inbox/inbox.routes.ts': '', 'src/app/features/inbox/services/inbox.service.ts': '',
} }]);
// the same repository after one commit moved half of the library into the features that used each piece
const movedOut = () => {
  const d = libraryAndScreens(), date = '2020-10-14T10:00:00Z';
  for (const [k, f] of [['editor', 'admin'], ['preview', 'inbox'], ['reorder', 'admin'], ['schedule', 'admin']]) {
    fs.mkdirSync(path.join(d, `src/app/features/${f}/components`), { recursive: true });
    g(d, date, 'mv', `src/app/shared/components/kit-${k}`, `src/app/features/${f}/components/kit-${k}`);
  }
  g(d, date, 'commit', '-q', '-m', 'move');
  return d;
};

test('logic: a library of reusable UI in shared/components is a home of its own: moving a piece out of it CONTRADICTS, although the features hold more pieces', () => {
  const conv = C.census(libraryAndScreens());
  assert.equal(conv.variant, 'shared-library', conv.line);
  const home = conv.homes.find((h) => h.dir === 'src/app/shared/components');
  assert.ok(home && home.ui === KIT.length && home.since?.date === '2020-03-13', JSON.stringify(conv.homes));
  assert.match(conv.line, /src\/app\/shared\/components/);
  for (const from of ['src/app/shared/components/kit-editor', 'shared/components', 'shared']) {
    const v = C.judgeMove(conv, 'ui', from, 'src/app/features/inbox');
    assert.equal(v.verdict, 'contradicts', `${from}: ${v.line}`);
    assert.ok(v.line.includes(home.since.hash) && v.line.includes('2020-03-13') && /Recommended: do not move/.test(v.line), v.line);
  }
});

test('logic: on a tree a mass move already changed, the census cites that move and a move out of the library still CONTRADICTS', () => {
  const conv = C.census(movedOut());
  assert.equal(conv.moves?.n, 4, JSON.stringify(conv.moves));
  assert.equal(conv.moves.date, '2020-10-14');
  assert.match(conv.line, /moved 4 pieces from src\/app\/shared\/components to features/);
  assert.equal(C.judgeMove(conv, 'ui', 'src/app/shared/components/kit-button', 'src/app/features/admin').verdict, 'contradicts');
});

test('logic: a move of components of the newer naming (<piece>/<piece>.ts) is cited too; a helper named like no folder is not a piece', () => {
  const d = repo([{ date: '2021-01-01T10:00:00Z', files: {
    ...many(6, (i) => [`src/app/shared/components/kit-${i}/kit-${i}.ts`, `@Component({ selector: "kit-${i}" })\nexport class K${i} {}`]),
    ...many(6, (i) => [`src/app/shared/components/kit-${i}/kit-${i}.html`, `<i>${i}</i>`]),
    ...many(5, (i) => [`src/app/features/f${i}/f${i}.ts`, `@Component({ selector: "f-${i}" })\nexport class F${i} {}`]),
    'src/app/shared/components/helpers.ts': 'export const h = 1;',
  } }]);
  for (const i of [1, 2, 3, 4]) { fs.mkdirSync(path.join(d, 'src/app/features/f1/components'), { recursive: true }); g(d, '2021-05-05T10:00:00Z', 'mv', `src/app/shared/components/kit-${i}`, `src/app/features/f1/components/kit-${i}`); }
  g(d, '2021-05-05T10:00:00Z', 'mv', 'src/app/shared/components/helpers.ts', 'src/app/features/f1/helpers.ts');
  g(d, '2021-05-05T10:00:00Z', 'commit', '-q', '-m', 'move');
  const conv = C.census(d);
  assert.deepEqual([conv.moves?.n, conv.moves?.date, conv.moves?.from], [4, '2021-05-05', 'src/app/shared/components'], JSON.stringify(conv.moves));
});

test('CSS/HTML: the styles and templates of the library are part of the home: moving them out CONTRADICTS, and a new reusable piece is placed in the library', () => {
  const conv = C.census(libraryAndScreens());
  assert.equal(C.judgeMove(conv, 'style', 'src/app/shared/components/kit-button', 'src/app/features/admin').verdict, 'contradicts');
  const at = C.whereToPlace(conv, 'ui');
  assert.match(at.line, /reusable .*src\/app\/shared\/components/, at.line);
});

test('counter-example: in the library repository a piece promoted from a feature into the library follows; a Scope Rule repository with one shared piece has no home', () => {
  const conv = C.census(libraryAndScreens());
  assert.equal(C.judgeMove(conv, 'ui', 'src/app/features/inbox/panel', 'src/app/shared/components').verdict, 'follows');
  const scope = C.census(scopeRule());
  assert.deepEqual(scope.homes, []);
  assert.equal(scope.moves, null);
  assert.equal(C.judgeMove(scope, 'ui', 'src/app/shared/spinner', 'src/app/features/inbox').verdict, 'follows');
});

// The skills that place UI teach the repo's convention first; the scope rule appears only as the "profile default" of a repo with none.
test('no skill teaches the scope rule as the rule: every mention outside the architecture profile says "profile default"', () => {
  const md = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) md.push(p); } };
  walk(path.join(ROOT, 'skills'));
  const taught = md.filter((f) => !f.replace(/\\/g, '/').endsWith('architectures/screaming.md')).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [`${path.relative(ROOT, f)}:${i + 1}`, l]))
    .filter(([, l]) => /scope rule|second feature needs it|two or more → shared|2\+ → shared/i.test(l) && !/profile default/i.test(l));
  assert.deepEqual(taught.map(([at]) => at), []);
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

test('a mass move between layers is stopped once per task with the convention\'s line: logic pieces by git mv, styles and templates by Move-Item; a small or same-layer move runs', async () => {
  const T = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const d = sharedUi(), sf = path.join(d, '..', `move-gate-${path.basename(d)}.json`); temps.push(sf);
  const ts = 'git mv src/app/shared/button-1/button-1.component.ts src/app/shared/button-2/button-2.component.ts src/app/shared/modals/confirm-modal.component.ts src/app/features/inbox/';
  const deny = T.checkMove(ts, d, 's1', 't1', sf);
  assert.match(deny, /moves 3 files from src\/app\/shared\/button-1 \(shared\) to src\/app\/features\/inbox \(features\): a structural change/);
  assert.match(deny, /CONTRADICTS the project's convention: .*first commit|CONTRADICTS the project's convention/);
  assert.match(deny, /The recommended option is not to move/);
  assert.equal(T.checkMove(ts, d, 's1', 't1', sf), null, 'asked once: after the answer it runs');
  assert.match(T.checkMove(ts, d, 's1', 't2', sf) || '', /structural change/, 'a new task asks again');
  const css = 'Move-Item -Path src/app/shared/button-3/*.css,src/app/shared/button-4/*.css,src/app/shared/button-5/*.css -Destination src/app/features/contacts';
  assert.match(T.checkMove(css, d, 's2', 't1', sf) || '', /moves 3 files .*\(shared\) to src\/app\/features\/contacts \(features\).*CONTRADICTS.*style pieces/, 'styles count, judged as styles');
  assert.match(T.checkMove('Move-Item src/app/shared/button-4/*.html,src/app/shared/button-4/*.css,src/app/shared/button-4/*.ts src/app/features/contacts', d, 's2b', 't1', sf) || '', /moves 3 files/, 'positional Move-Item, a template with its style');
  assert.match(T.checkMove('cd src/app && mv shared/button-5 features/inbox/', d, 's3', 't1', sf) || '', /moves 3 files/, 'a folder counts the files it holds, after a cd');
  assert.equal(T.checkMove('git mv src/app/shared/button-1/button-1.component.ts src/app/shared/button-2/button-2.component.ts src/app/features/inbox/', d, 's4', 't1', sf), null, 'counter-example: two files is no mass move');
  assert.equal(T.checkMove('mv src/app/shared/button-1 src/app/shared/buttons-old', d, 's5', 't1', sf), null, 'counter-example: inside the same layer');
  assert.equal(T.checkMove('git mv a.txt b.txt', d, 's6', 't1', sf), null, 'counter-example: nothing that exists between layers');
});

test('through the hook: a mass git mv out of the shared home is denied before it runs, and the files stay where they were', () => {
  const d = sharedUi();
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n');
  const t = path.join(d, '..', `move-${path.basename(d)}.jsonl`); temps.push(t);
  fs.writeFileSync(t, [{ type: 'user', uuid: 'p1', timestamp: new Date().toISOString(), message: { role: 'user', content: 'mueve los botones a inbox' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L3 · dept-architecture' }] } }].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const command = 'git mv src/app/shared/button-1 src/app/features/inbox/button-1';
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'tool-hook.mjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: d, session_id: 's-move-e2e', transcript_path: t }), encoding: 'utf8', env: process.env });
  assert.match(r.stdout, /"permissionDecision":"deny"/, r.stdout + r.stderr);
  assert.match(r.stdout, /a structural change.*CONTRADICTS/);
  assert.ok(fs.existsSync(path.join(d, 'src', 'app', 'shared', 'button-1', 'button-1.component.css')));
});

test('the notes refspec in .git/config is named with the command that takes it out; that command, run, leaves the remote\'s own fetch line', async () => {
  const { footprint } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const { hasFetchSpec } = await import(`file://${SCRIPTS}/notes.mjs`);
  const d = withOldBlocks({ 'src/a.html': '<a></a>' });
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-conv-remote-')); temps.push(remote);
  spawnSync('git', ['init', '-q', '--bare', remote]);
  spawnSync('git', ['remote', 'add', 'origin', remote], { cwd: d });
  spawnSync('git', ['config', '--add', 'remote.origin.fetch', '+refs/notes/waymark*:refs/notes/remotes/origin/waymark*'], { cwd: d });
  const line = footprint(d), cmd = line.match(/after the user's yes: (git config .*)$/)?.[1];
  assert.ok(cmd, line);
  assert.ok(hasFetchSpec(d));
  const args = cmd.match(/"[^"]*"|\S+/g).slice(1).map((a) => a.replace(/^"|"$/g, ''));
  assert.equal(spawnSync('git', args, { cwd: d }).status, 0);
  assert.equal(hasFetchSpec(d), false);
  assert.match(spawnSync('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: d, encoding: 'utf8' }).stdout, /^\+refs\/heads\/\*:refs\/remotes\/origin\/\*$/m, 'the remote\'s own line stays');
  assert.doesNotMatch(footprint(d), /refspec/, 'counter-example: no refspec, no sentence');
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
