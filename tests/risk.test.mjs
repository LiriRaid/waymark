// Waymark 2.0.16 · point 2: review proportional to risk (routine.json `risk`, docs/adr/0027). Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.WAYMARK_REVIEW_MODE;
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const { loadRisk, reviewRisk, editedLines, isSensitive, isCritical } = await import(`file://${SCRIPTS}/lib/risk.mjs`);
const cfg = loadRisk();
const ask = (over) => reviewRisk({ code: ['src/a.mjs'], changed: ['src/a.mjs'], level: 2, lines: 10, cfg, ...over });

test('risk: routine.json holds the proportional rule with its limits', () => {
  assert.deepEqual([cfg.review.mode, cfg.review.maxFiles, cfg.review.maxLines], ['proportional', 4, 100]);
});

test('risk: a small plain change skips the review and says why; docs-only never had code', () => {
  const r = ask({});
  assert.equal(r.review, false);
  assert.match(r.reason, /1 file, 10 lines, no sensitive path/);
  assert.equal(ask({ code: [], changed: ['README.md'] }).review, false);
});

test('risk: L3, a sensitive or critical path, many files, many lines or an unknown size need the review', () => {
  assert.equal(ask({ level: 3 }).review, true);
  assert.equal(ask({ code: ['db/migrate/20260101_add.rb'], changed: ['db/migrate/20260101_add.rb'] }).review, true, 'a migration');
  assert.equal(ask({ code: ['src/auth/login.ts'], changed: ['src/auth/login.ts'] }).review, true, 'an auth file');
  assert.equal(ask({ code: ['a.js'], changed: ['a.js', 'deploy/server.pem'] }).review, true, 'a secret path among the changed');
  assert.equal(ask({ code: ['1', '2', '3', '4', '5'].map((n) => `${n}.js`) }).review, true, '5 files > 4');
  assert.equal(ask({ lines: 101 }).review, true, '101 lines > 100');
  assert.equal(ask({ lines: null }).review, true, 'a shell edit leaves the size unknown');
});

test('risk: sensitive patterns, their exceptions and the project override', () => {
  for (const f of ['.env', '.env.local', 'app/.env.production', 'home/.ssh/config', 'x/id_rsa', 'keys/a.pem', 'c.p12']) assert.equal(isSensitive(f, cfg), true, f);
  for (const f of ['.env.example', '.env.sample', 'cfg/.env.template', 'src/environment.ts', 'docs/ssh.md']) assert.equal(isSensitive(f, cfg), false, f);
  assert.equal(isCritical('src/payments/charge.ts', cfg), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-risk-'));
  fs.mkdirSync(path.join(root, '.waymark'));
  fs.writeFileSync(path.join(root, '.waymark', 'risk.json'), JSON.stringify({ review: { maxLines: 10 }, allow: ['fixtures/'] }));
  const mine = loadRisk(root);
  assert.equal(mine.review.maxLines, 10);
  assert.equal(mine.review.maxFiles, 4, 'what the override leaves out keeps the default');
  assert.equal(isSensitive('fixtures/test.pem', mine), false, 'the allow list adds up');
  fs.writeFileSync(path.join(root, '.waymark', 'risk.json'), '{ broken');
  assert.equal(loadRisk(root).review.maxLines, 100, 'a broken override never lowers the bar');
});

test('risk: lines counted from the edit calls; a shell change makes the size unknown', () => {
  const tools = [
    { name: 'Edit', input: { old_string: 'a\nb', new_string: 'a\nb\nc' } },
    { name: 'Write', input: { content: 'x\ny\nz\nw' } },
    { name: 'apply_patch', input: { input: '*** Begin Patch\n+one\n-two\n+++ no\n context\n' } },
  ];
  assert.equal(editedLines(tools), 3 + 4 + 2);
  assert.equal(editedLines(tools, (t) => t.name === 'Write'), null);
});

test('risk: WAYMARK_REVIEW_MODE=always brings the old rule back', () => {
  process.env.WAYMARK_REVIEW_MODE = 'always';
  try { assert.equal(reviewRisk({ code: ['a.js'], changed: ['a.js'], level: 2, lines: 1, cfg: loadRisk() }).review, true); } finally { delete process.env.WAYMARK_REVIEW_MODE; }
});
