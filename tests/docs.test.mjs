// Waymark 2.0.16 · point 11: the documentation cannot drift from the code. Fails when the version files disagree, a README figure
// differs from size.mjs, a documentation file holds Spanish prose outside the allowed places, an ADR is missing from the
// README's index, or README/INSTALL name a waymark.mjs command that does not exist. Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const gen = await import(`file://${SCRIPTS}/docs-gen.mjs`);

test('version: VERSION, plugin.json and the head of the CHANGELOG are one number', () => {
  const version = read('skills', 'waymark', 'VERSION').trim();
  const plugin = JSON.parse(read('.claude-plugin', 'plugin.json')).version;
  const head = read('CHANGELOG.md').match(/^##\s*\[?v?(\d+\.\d+\.\d+)/m)?.[1];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual([plugin, head], [version, version], 'VERSION, .claude-plugin/plugin.json and the first CHANGELOG entry');
});

test('size: the figures in the README table are what size.mjs measures now (5% tolerance)', () => {
  const printed = spawnSync(process.execPath, [path.join(SCRIPTS, 'size.mjs'), '--readme'], { encoding: 'utf8' }).stdout.trim().split('\n').slice(2);
  const block = gen.between(read('README.md'), read('README.md').match(/<!-- size:begin[^>]*-->/)[0], '<!-- size:end -->');
  assert.ok(block, 'README.md has the size markers');
  const rows = (text) => Object.fromEntries(text.split('\n').filter((l) => /^\|/.test(l) && !/^\|[-| ]+\|$/.test(l) && !/^\| Part/.test(l)).map((l) => { const c = l.split('|').map((x) => x.trim()); return [c[1], Number(c[c.length - 2].replace(/,/g, ''))]; }));
  const want = rows(printed.join('\n')), have = rows(block);
  assert.deepEqual(Object.keys(have).sort(), Object.keys(want).sort(), 'the same parts');
  for (const [name, chars] of Object.entries(want)) assert.ok(Math.abs(have[name] - chars) <= Math.max(2, chars * 0.05), `${name}: README says ${have[name]}, size.mjs measures ${chars} (node skills/waymark/scripts/size.mjs --readme)`);
});

// ---- Spanish prose in the documentation -------------------------------------------------------------------------------------
// The documentation is English. Spanish stays only where it is the product: the phrases a user says (inside quotes or backticks,
// and the trigger lists of the routing tables and skill descriptions) and the text the hooks print for the user.
const STOP = new Set('el la los las del para una por que con está este esta cuando donde sobre hacer puede también según sin porque pero como más muy ya al sus tu tus mi se lo le les nos hay son era fue ser estar tiene tienen hasta desde entre cada todo toda todos todas otro otra otros otras mismo misma nunca siempre después antes mientras aunque'.split(' '));
const strip = (l) => l.replace(/\\"/g, '"').replace(/`[^`]*`/g, ' ').replace(/"[^"]*"/g, ' ').replace(/«[^»]*»/g, ' ').replace(/\*"[^"]*"\*/g, ' ').replace(/https?:\/\/\S+/g, ' ');
export const spanish = (line) => {
  const s = strip(line);
  if (/[¿¡]/.test(s)) return true;
  const words = s.toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  const hits = new Set(words.filter((w) => STOP.has(w)));
  const accented = words.filter((w) => /[áéíóúñ]/.test(w)).length;
  return hits.size >= 2 || (hits.size >= 1 && accented >= 1) || accented >= 2;
};
// Lines that may carry Spanish: a skill's frontmatter, the trigger lists of routing tables, and what a document says it shows in the user's language.
const ALLOWED = [/^description:/, /^\| `(dept|ui)-[\w-]+` \|/, /^\| `[\w-]+` \| [^|]+ \| [^|]*(animación|accesibilidad|regresión)/, /Spanish needs/, /user'?s language/i];
const docFiles = () => {
  const out = ['README.md', 'INSTALL.md', 'CHANGELOG.md'].map((f) => path.join(ROOT, f));
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.md$/.test(e.name)) out.push(p); } };
  walk(path.join(ROOT, 'docs', 'adr')); walk(path.join(ROOT, 'skills'));
  out.push(path.join(ROOT, 'docs', 'audit-context.md'));
  return out;
};

test('language: no Spanish prose in the documentation outside the quoted phrases and the trigger lists', () => {
  const offenders = [];
  for (const f of docFiles()) {
    let code = false;
    read(path.relative(ROOT, f)).split('\n').forEach((l, i) => {
      if (/^\s*```/.test(l)) { code = !code; return; }
      if (spanish(l) && !ALLOWED.some((re) => re.test(l))) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${l.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], 'translate these, or quote the phrase the user says');
});

test('language: the detector flags real Spanish prose and lets English with quoted Spanish pass', () => {
  assert.equal(spanish('Esta función devuelve el valor que se calcula para cada usuario.'), true);
  assert.equal(spanish('¿Continúo con la instalación?'), true);
  assert.equal(spanish('Say "quiero crear un modal de confirmación" and the agent routes it to the frontend department.'), false);
  assert.equal(spanish('Ask in the choice window, then reply with the `Cierre` block.'), false);
});

test('adr: every record is in the README index (node skills/waymark/scripts/docs-gen.mjs --write)', () => {
  const have = gen.between(read('README.md'), gen.ADR_BEGIN, gen.ADR_END);
  assert.equal(have, gen.adrIndex(), 'the README index differs from docs/adr');
  for (const f of fs.readdirSync(path.join(ROOT, 'docs', 'adr')).filter((x) => /^\d{4}-/.test(x))) assert.ok(have.includes(f), `${f} is missing from the README index`);
});

test('commands: every waymark.mjs command that README and INSTALL name exists', () => {
  const src = read('skills', 'waymark', 'scripts', 'waymark.mjs');
  const known = new Set([...src.matchAll(/sub === '([\w-]+)'/g)].map((m) => m[1]));
  for (const m of src.match(/export const COMMANDS = \{([^}]*)\}/)?.[1].matchAll(/'?([\w-]+)'?:\s*'/g) || []) known.add(m[1]);
  for (const f of ['README.md', 'INSTALL.md']) {
    for (const m of read(f).matchAll(/waymark\.mjs["']?\s+(?!--)([a-z][\w-]*)/g)) assert.ok(known.has(m[1]) || m[1] === 'sync', `${f} names "waymark.mjs ${m[1]}", which does not exist`);
  }
  assert.ok(known.has('verify') && known.has('attest') && known.has('check'));
});

// ---- No other project is named ----------------------------------------------------------------------------------------------
// Documentation, ADRs, tests and comments say "an orchestrator, ecosystem or supply chain", never another project's name. The
// name is built from parts so this file does not hold it either. The one allowed neighbour is the organisation in engram's own
// repository address (engram is a dependency, named by its address).
test('docs: no other project is named in any tracked file', () => {
  const org = ['gentle', 'man'].join(''), proj = `${['gentle'].join('')}[- ]?ai`;
  const re = new RegExp(`${proj}|${org}[- ]programming(?!/engram)`, 'i');
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  const hits = [];
  for (const f of tracked) {
    if (/\.(png|jpe?g|gif|ico|woff2?|pdf)$/i.test(f)) continue;
    let text; try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, [], 'say "an orchestrator already installed"; use acme-orch as a sample namespace in tests');
});

// ---- Commands are written the way they run ----------------------------------------------------------------------------------
// waymark.mjs is a script, not a program on the PATH: typed bare it fails. A document that tells someone to run it shows
// `node "<skills-dir>/waymark/scripts/waymark.mjs" <command>`; text the agent reads may use W, the full command the session
// card defines. History (CHANGELOG, ADRs) and the tests are left as written.
test('commands: no document shows waymark.mjs bare as a command to type', () => {
  const scope = /^(README\.md|INSTALL\.md|docs\/audit-context\.md|adapters\/.*\.md|skills\/.*\.md|skills\/waymark\/routine\.json)$/;
  const bare = /(?:node\s+)?waymark\.mjs(?!["'`])(?=\s+[a-z<\[-])/;
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter((f) => scope.test(f) && !/skill-registry\.md$/.test(f));
  const hits = [];
  for (const f of tracked) read(f).split('\n').forEach((line, i) => { if (bare.test(line)) hits.push(`${f}:${i + 1}`); });
  assert.deepEqual(hits, [], 'write node "<skills-dir>/waymark/scripts/waymark.mjs" <command> (or W in text the agent reads)');
  assert.ok(tracked.includes('INSTALL.md') && tracked.some((f) => /^adapters\//.test(f)), 'the scope found the documents');
});

test('commands: the messages the hooks print carry the full command', () => {
  for (const f of ['stop-hook.mjs', 'tool-hook.mjs', 'session-hook.mjs', 'waymark.mjs', 'incidents.mjs', 'learned.mjs']) {
    const text = read('skills', 'waymark', 'scripts', f);
    const lines = text.split('\n').filter((l) => !/^\s*\/\//.test(l) && /waymark\.mjs/.test(l) && /node waymark\.mjs|run waymark\.mjs|Run waymark\.mjs|\(waymark\.mjs [a-z]/.test(l.replace(/\/\/.*$/, '')));
    assert.deepEqual(lines.map((l) => l.trim().slice(0, 80)), [], `${f} prints a bare command`);
  }
});
