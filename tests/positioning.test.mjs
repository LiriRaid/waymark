// Waymark 2.0.19 · point 9: the README says what Waymark is and is not and sets itself next to the kind of tool the author named, from a public README, with a date
// and without claiming a test. No other project is named (tests/docs.test.mjs holds that rule). Run: node --test tests/positioning.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readme = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
const section = readme.split(/\n(?=\*\*Next to environment configurators)/)[1]?.split('\n\n')[0] || '';

test('9: the comparison describes the other kind of tool, dated, attributed to a README and claiming no test', () => {
  assert.ok(section, 'a paragraph "Next to …" under "What Waymark is, and what it is not"');
  assert.doesNotMatch(section, /https?:\/\//, 'no other project is linked or named');
  assert.match(section, /read on \d{4}-\d{2}-\d{2}/, 'dated: a README changes');
  assert.match(section, /not a test of the tool/, 'a reading, not a measurement');
  assert.ok(section.split(/\s+/).length < 230, 'a paragraph, not a section');
});

test('9: counter-example — it ranks nothing, and every statement about the other tool is attributed to its README', () => {
  assert.doesNotMatch(section, /\b(better|worse|superior|inferior|only|unlike)\b/i, 'no ranking');
  assert.match(section, /public README|That README/);
  const at = readme.indexOf('**Next to environment configurators.**');
  assert.ok(at > readme.indexOf('## What Waymark is, and what it is not') && at < readme.indexOf('## A supply chain'), 'inside the section that says what Waymark is');
});
