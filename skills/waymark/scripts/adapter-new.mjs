#!/usr/bin/env node
// Waymark · `waymark.mjs adapter-new <agent>` (docs/adr/0039): drafts the adapter of an agent Waymark knows but has no adapter for (check lists
// them), from templates/agent-adapter.template.mjs and what the agent's documentation says (its folder, its instructions file, the names of its
// shell, edit and read tools: pass what you read there as flags), and runs the conformance suite on the draft. The draft is Claude Code's shape
// until the documentation says otherwise, so a draft that passes proves the agent's hooks speak it, and one that fails names the cases to adapt.
// Nothing is installed without --install, which runs the suite again and refuses a draft that does not pass: a new adapter passes the list or it
// does not install.
//   node adapter-new.mjs <key> [--name <Name>] [--dir <~/.agent>] [--instructions <file>] [--shell <tool>] [--edit <tool|tool>] [--read <tool>] [--draft-dir <dir>] [--no-run]
//   node adapter-new.mjs <key> --install       the user's yes: put the adapter, its entry in agents.json, its driver and its doc in place
// The suite lives in the repository (tests/conformance.test.mjs): from an install with no clone around it the draft is written and says so.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const SKILLS = path.resolve(SKILL, '..');
const REPO = path.resolve(SKILLS, '..');
const AGENTS = path.join(HERE, 'agents');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const KNOWN = () => JSON.parse(read(path.join(AGENTS, 'agents.json'))).agents;

// The conformance driver of a draft, from templates/conformance-driver.template.mjs: Claude Code's payloads and transcript with this agent's tool names.
// __COMMON__ is where tests/conformance/agents/common.mjs is (the repository's, or a file URL when the suite runs on a draft).
const DRIVER = (a) => read(path.join(SKILL, 'templates', 'conformance-driver.template.mjs'))
  .replaceAll('__NAME__', a.name).replaceAll('__KEY__', a.key).replaceAll('__DOCS__', a.docs || 'TODO(docs)').replaceAll('__SHELL__', a.shell).replaceAll('__EDIT__', a.edit.split('|')[0]).replaceAll('__READ__', a.read);

// The agent's facts: what agents.json knows of it, what the flags say.
export function facts(key, flags = {}) {
  const k = KNOWN().find((a) => a.key === key) || {};
  const name = flags.name || k.name || key;
  return { key, name, dir: flags.dir || k.dir || `~/.${key}`, instructions: flags.instructions || k.instructions || 'AGENTS.md', docs: k.docs || null, known: !!k.key, entry: k,
    shell: flags.shell || 'Bash', edit: flags.edit || 'Edit|Write', read: flags.read || 'Read' };
}

// → { adapter, driver, entry, doc }: the files of a draft, as text.
export function draftFiles(a) {
  const tpl = read(path.join(SKILL, 'templates', 'agent-adapter.template.mjs'));
  if (!tpl) throw new Error('templates/agent-adapter.template.mjs is missing');
  const shellRe = a.shell.replace(/[.*+?^${}()[\]\\]/g, '\\$&'), editRe = a.edit.split('|').map((t) => t.replace(/[.*+?^${}()[\]\\]/g, '\\$&')).join('|');
  const readRe = a.read.replace(/[.*+?^${}()[\]\\]/g, '\\$&');
  const dir = a.dir.startsWith('~/') ? a.dir.slice(2) : a.dir;
  let src = tpl
    .replace(/Copy to scripts\/agents\/<key>\.mjs[\s\S]*?the Cursor tests\)\.\n/, 'Registered by adapter-new in agents/index.mjs and agents.json; the conformance suite (tests/conformance/) judges it.\n')
    .replace("// Waymark · <Agent> adapter (docs/adr/0022).", `// Waymark · ${a.name} adapter (docs/adr/0022). DRAFT from waymark.mjs adapter-new on ${new Date().toISOString().slice(0, 10)}: Claude Code's shapes until ${a.docs || 'the agent\'s documentation'} says otherwise (TODO(docs)).`)
    .replace("import os from 'node:os';", "import os from 'node:os';\nimport { readTail } from '../transcript.mjs';\nimport { agentDir, known } from './paths.mjs';")
    .replace("export const name = '<key>';", `export const name = '${a.key}';`)
    // the agent's own tool names, as the core reads them (Bash, Edit, Read); Claude Code's .jsonl shape otherwise: TODO(docs) if its transcript differs
    .replace("export const read = (hook, bytes) => [];", `const CANON = [[/^(${shellRe})$/, 'Bash'], [/^(${editRe})$/, 'Edit'], [/^(${readRe})$/, 'Read']];\nconst canon = (d) => (d?.message?.content?.some?.((c) => c.type === 'tool_use') ? { ...d, message: { ...d.message, content: d.message.content.map((c) => (c.type === 'tool_use' ? { ...c, name: CANON.find(([re]) => re.test(c.name))?.[1] || c.name } : c)) } } : d);\nexport const read = (hook, bytes) => readTail(hook.transcript_path, bytes).map(canon);`)
    .replace('export const preContext = false; // true only when its pre-tool hook can add context and still let the tool run', "export const preContext = true; // Claude Code's shape: TODO(docs) false when its pre-tool hook cannot add context")
    .replace("if (/^<shell tool>$/.test(tool))", `if (/^(${shellRe})$/.test(tool))`)
    .replace("if (/^<edit tools>$/.test(tool)) return { files: [input.file_path].filter(Boolean) };", `if (/^(${readRe})$/.test(tool)) return { reads: [input.file_path].filter(Boolean) }; // the sensitive-path guard reads this one\n  if (/^(${editRe})$/.test(tool)) return { files: [input.file_path].filter(Boolean) };`)
    .replace("export const instructions = path.join(os.homedir(), '<.agent>', '<INSTRUCTIONS>.md'); // TODO: agentDir(known('<key>')) in scripts/agents/", `export const instructions = path.join(agentDir(known('${a.key}') || { dir: '~/${dir.replace(/^~\//, '')}' }), '${a.instructions}');`);
  const entry = { ...a.entry, key: a.key, name: a.name, dir: a.dir.startsWith('~') || a.dir.startsWith('$') ? a.dir : `~/${a.dir}`, instructions: a.instructions, adapter: a.key, checked: new Date().toISOString().slice(0, 10),
    hooks: { ...(a.entry.hooks || { file: 'hooks.json', format: 'nested' }), matcher: [a.shell, ...a.edit.split('|'), a.read].join('|') } };
  const doc = `# Adapter · ${a.name}\n\nDraft from \`waymark.mjs adapter-new\` (docs/adr/0039). Written from ${a.docs || 'the agent\'s documentation'}: nothing here has run on a live session.\n\n| Key | Value |\n|---|---|\n| \`<instructions-file>\` | \`${a.dir}/${a.instructions}\` |\n| Hook adapter | \`skills/waymark/scripts/agents/${a.key}.mjs\` |\n| Conformance | \`tests/conformance/agents/${a.key}.mjs\` |\n\n## First live session: what to check\n\n1. The hooks run, and the card arrives at the start of the session.\n2. The tool names (\`${a.shell}\`, \`${a.edit}\`, \`${a.read}\`) and the fields of their inputs are the ones the documentation gives.\n3. How the agent carries the reply and the transcript, and whether a hook can block the end of a turn.\n\nAnything that differs: change \`agents/${a.key}.mjs\` and its driver in \`tests/conformance/agents/${a.key}.mjs\`, and run the suite again.\n`;
  return { adapter: src, driver: DRIVER(a), entry, doc };
}

// Puts the adapter in a skills folder: its module, its import and its place in AGENTS (agents/index.mjs), its entry in agents.json.
export function register(skillsDir, a, files) {
  const dir = path.join(skillsDir, 'waymark', 'scripts', 'agents');
  fs.writeFileSync(path.join(dir, `${a.key}.mjs`), files.adapter);
  const index = path.join(dir, 'index.mjs');
  let idx = read(index);
  if (!new RegExp(`import \\* as ${a.key} from`).test(idx)) {
    idx = idx.replace(/(import \* as [a-z]+ from '\.\/[a-z]+\.mjs';\n)(?!import \* as)/, `$1import * as ${a.key} from './${a.key}.mjs';\n`).replace(/export const AGENTS = \{ ([^}]*) \};/, (m, list) => `export const AGENTS = { ${[...list.split(', '), a.key].sort().join(', ')} };`);
    fs.writeFileSync(index, idx);
  }
  const json = path.join(dir, 'agents.json'), all = JSON.parse(read(json));
  const at = all.agents.findIndex((x) => x.key === a.key);
  if (at >= 0) all.agents[at] = files.entry; else all.agents.push(files.entry);
  fs.writeFileSync(json, JSON.stringify(all, null, 2) + '\n');
}

// Runs the conformance suite on the draft, in a copy of the skills where it is registered. → { ran, pass, fail, total, failing[], output }
export function conformance(a, files, { repo = REPO } = {}) {
  const suite = path.join(repo, 'tests', 'conformance.test.mjs');
  if (!fs.existsSync(suite)) return { ran: false, reason: `the conformance suite is in the repository (tests/conformance.test.mjs) and none is next to this install (${repo})` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-adapter-new-'));
  try {
    fs.cpSync(SKILLS, path.join(tmp, 'skills'), { recursive: true });
    register(path.join(tmp, 'skills'), a, files);
    const common = pathToFileURL(path.join(repo, 'tests', 'conformance', 'agents', 'common.mjs')).href;
    const driver = path.join(tmp, `${a.key}.driver.mjs`);
    fs.writeFileSync(driver, files.driver.replace('__COMMON__', common));
    const r = spawnSync(process.execPath, ['--test', suite], { cwd: repo, encoding: 'utf8', timeout: 20 * 60 * 1000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, WAYMARK_CONFORMANCE_SCRIPTS: path.join(tmp, 'skills', 'waymark', 'scripts'), WAYMARK_CONFORMANCE_DRIVERS: driver, WAYMARK_CONFORMANCE_ONLY: a.key } });
    const out = `${r.stdout || ''}${r.stderr || ''}`, n = (k) => Number(out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'))?.[1] || 0);
    const failing = [...new Set([...out.matchAll(/^\s*✖ [a-z]+ · ([\w.-]+)/gm)].map((m) => m[1]))];
    return { ran: true, pass: n('pass'), fail: n('fail'), total: n('tests'), failing, output: out };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const RUN = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (RUN) {
  const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
  const valued = new Set(['--name', '--dir', '--instructions', '--shell', '--edit', '--read', '--draft-dir']);
  const key = args.find((x, i) => !x.startsWith('--') && !valued.has(args[i - 1]));
  if (!key || !/^[a-z][a-z0-9-]*$/.test(key)) { console.log('adapter-new: usage: waymark.mjs adapter-new <agent key> [--name <Name>] [--dir <~/.agent>] [--instructions <file>] [--shell <tool>] [--edit <tool|tool>] [--read <tool>] [--install] [--no-run]'); process.exit(1); }
  if (fs.existsSync(path.join(AGENTS, `${key}.mjs`)) && !args.includes('--install')) { console.log(`adapter-new: ${key} already has an adapter (agents/${key}.mjs).`); process.exit(1); }
  const a = facts(key, { name: flag('--name'), dir: flag('--dir'), instructions: flag('--instructions'), shell: flag('--shell'), edit: flag('--edit'), read: flag('--read') });
  const draftDir = flag('--draft-dir') || path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'drafts', 'adapters', key);
  // A draft already in the folder is the one the user adapted: it is judged as it is, never written over (--regenerate drafts it again).
  const mine = (f) => path.join(draftDir, f), kept = !args.includes('--regenerate') && fs.existsSync(mine(`${key}.mjs`)) && fs.existsSync(mine(`${key}.driver.mjs`));
  const files = kept ? { adapter: read(mine(`${key}.mjs`)), driver: read(mine(`${key}.driver.mjs`)), entry: JSON.parse(read(mine('agents.entry.json')) || 'null') || draftFiles(a).entry, doc: read(mine(`${key}.md`)) || draftFiles(a).doc } : draftFiles(a);
  if (!kept) {
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(mine(`${key}.mjs`), files.adapter);
    fs.writeFileSync(mine(`${key}.driver.mjs`), files.driver);
    fs.writeFileSync(mine('agents.entry.json'), JSON.stringify(files.entry, null, 2) + '\n');
    fs.writeFileSync(mine(`${key}.md`), files.doc);
  }
  console.log(`adapter-new: ${a.name} (${key})${a.known ? '' : ' — not in agents.json: its entry is drafted too'} · ${kept ? 'the draft in' : 'untracked draft in'} ${draftDir}`);
  const res = args.includes('--no-run') ? { ran: false, reason: '--no-run' } : conformance(a, files);
  if (!res.ran) console.log(`  conformance: not run (${res.reason}). Run it in a clone: node --test tests/conformance.test.mjs with the draft registered, or re-run this command from the clone.`);
  else {
    console.log(`  conformance: ${res.pass} of ${res.total} checks pass${res.fail ? ` · ${res.fail} fail: ${res.failing.join(', ') || 'see the suite output'}` : ''}`);
    if (res.fail) console.log(`  The draft speaks Claude Code's shapes; each failing case names what ${a.name}'s documentation says otherwise (payload, answer or transcript). Adapt ${path.join(draftDir, `${key}.mjs`)} and its driver, then run this command again.`);
  }
  if (args.includes('--install')) {
    if (!res.ran || res.fail || !res.pass) { console.log('  not installed: a new adapter passes the conformance list or it does not install.'); process.exit(1); }
    register(SKILLS, a, files);
    const docs = path.join(REPO, 'adapters');
    if (fs.existsSync(docs)) fs.writeFileSync(path.join(docs, `${key}.md`), files.doc);
    const drivers = path.join(REPO, 'tests', 'conformance', 'agents');
    if (fs.existsSync(drivers)) fs.writeFileSync(path.join(drivers, `${key}.mjs`), files.driver.replace('__COMMON__', './common.mjs'));
    console.log(`  installed: agents/${key}.mjs, its place in agents/index.mjs and agents.json${fs.existsSync(docs) ? `, adapters/${key}.md` : ''}${fs.existsSync(drivers) ? `, its conformance driver` : ''}. In a clone: node skills/waymark/scripts/manifest.mjs --write, then node skills/waymark/scripts/install-hooks.mjs to register its hooks.`);
  } else console.log(`  Not installed. With your yes: node waymark.mjs adapter-new ${key} --install (it runs the suite again and refuses a draft that does not pass).`);
  process.exit(res.ran && res.fail ? 1 : 0);
}
