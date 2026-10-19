// Waymark 2.0.18 · ADR 0042: the public repository carries no data of the projects Waymark ran on. Every versioned fixture
// is synthetic or redacted: no home folder of a real user (C:\Users\<name>, /Users/<name>, /home/<name>) and, in the
// recorded turns (tests/corpus, tests/external/*.json), no address outside the example and noreply domains. A real
// project may be named; its code, its prompts and its paths stay on the machine where Waymark runs.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = ['corpus', 'reference', 'external', 'conformance'].map((d) => path.join(HERE, d));
const TURNS = [path.join(HERE, 'corpus'), path.join(HERE, 'external')];
// The names fixtures use for a made-up user; anything else under a home folder is a real one.
const PLACEHOLDER_USERS = new Set(['dev', 'u', 'x', 'user', 'me', 'runner', 'test', 'ci', 'example', 'someone', 'public', 'default']);
const PLACEHOLDER_MAIL = /@(example\.(com|org|net)|users\.noreply\.github\.com|noreply\.[\w.-]+)$|^noreply@/i;

const files = (dir, only = () => true) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, only) : only(p) ? [p] : [];
});

// The real user names under a home folder in a text: "C:\\Users\\ana\\…", "/c/Users/ana/…" (Git Bash), "/Users/ana/…",
// "/home/ana/…" (escaped or not), and Claude's project folder "C--Users-ana-…".
export function homeUsers(text) {
  const out = new Set();
  const paths = /(?:\b[A-Za-z]:(?:\\{1,2}|\/)+Users|(?:^|[^\w.])(?:\/[A-Za-z])?\/(?:Users|home))(?:\\{1,2}|\/)+([^\\/"'`\s:*?<>|]+)/g;
  const slugs = /\b[A-Za-z]--Users-([^-\\/"'`\s]+)/g;
  for (const m of [...String(text).matchAll(paths), ...String(text).matchAll(slugs)]) {
    const name = m[1].toLowerCase();
    if (!PLACEHOLDER_USERS.has(name) && !/^[<$%{]/.test(name)) out.add(m[1]);
  }
  return [...out];
}

// The addresses in a text that are not placeholders.
export function realMails(text) {
  return [...new Set(String(text).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])].filter((m) => !PLACEHOLDER_MAIL.test(m));
}

test('privacy: the detectors find a real home folder and address, and pass the placeholders', () => {
  assert.deepEqual(homeUsers('cd C:\\\\Users\\\\ana\\\\work && ls /Users/bob/x /home/carol/y'), ['ana', 'bob', 'carol']);
  assert.deepEqual(homeUsers('cd /c/Users/dan/x && ls .claude/projects/C--Users-eve-Proyectos-app'), ['dan', 'eve']);
  assert.deepEqual(homeUsers('C:/Users/dev/proj · /home/runner/work · /Users/<user>/x · C:\\Users\\u\\y · /c/Users/dev · C--Users-dev-p'), []);
  assert.deepEqual(realMails('ana@corp.hn, maint@example.com, 1+bot@users.noreply.github.com, noreply@anthropic.com'), ['ana@corp.hn']);
});

test('privacy: no versioned fixture holds the home folder of a real user', () => {
  const found = FIXTURES.flatMap((d) => files(d)).flatMap((f) => homeUsers(fs.readFileSync(f, 'utf8')).map((u) => `${path.relative(HERE, f)}: ${u}`));
  assert.deepEqual(found, [], 'redact the path to C:/Users/dev (or another placeholder) before committing the fixture');
});

test('privacy: no recorded turn holds a real address', () => {
  const found = TURNS.flatMap((d) => files(d, (f) => f.endsWith('.json'))).flatMap((f) => realMails(fs.readFileSync(f, 'utf8')).map((m) => `${path.relative(HERE, f)}: ${m}`));
  assert.deepEqual(found, [], 'replace the address with one at example.com before committing the turn');
});
