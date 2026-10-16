// Waymark 2.0.15 · point 6: provenance.mjs split by concern (scripts/provenance/*), same public API. Run: node --test tests/provenance-split.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const MODULES = ['ids', 'secrets', 'project', 'chain', 'records', 'tasks', 'taskmd', 'decisions', 'snapshot', 'derive'];
const M = Object.fromEntries(await Promise.all(MODULES.map(async (n) => [n, await import(`file://${SCRIPTS}/provenance/${n}.mjs`)])));

// The 2.0.14 public API of provenance.mjs (13 scripts import it): the split must not add, drop or rename one. 2.0.16 adds pinnedRules (point 9); 2.0.18 adds the record schema v2 names of provenance/derive.mjs (point 2).
const API = ['ID', 'INTERRUPTED_AFTER', 'LOCAL_DIRS', 'PROBE_OK', 'addRepoSnapshot', 'anchorsFor', 'appendRecord', 'aprendidoOf', 'askedChoice', 'changesProject', 'clearTaskStart', 'closeOpen', 'commitsFor', 'confirmTasks', 'decisionsIn', 'deepMask', 'ensureLocal', 'expireOpen', 'findSecrets', 'forget', 'gitError', 'gitNote', 'gitSnapshot', 'hookErrorsFile', 'legacyMemory', 'loadSnapshot', 'logFile', 'logHookError', 'logId', 'markOpen', 'markPaused', 'markTaskStart', 'maskSecrets', 'mutatesFiles', 'projectHome', 'projectSlug', 'readLog', 'readNotes', 'readRecords', 'readTaskRecords', 'rebuildFromGit', 'recordName', 'recordedDecisions', 'refreshTasks', 'saveSnapshot', 'shellRuns', 'shellSkeleton', 'snapshotDiff', 'taskFiles', 'taskIds', 'taskInProgress', 'taskLines', 'taskStart', 'taskStartMark', 'taskSummary', 'tasksMarkdown', 'tidyWip', 'turnChanged', 'pinnedRules', 'turnInputs', 'validId', 'verifyChain', 'workspaceSiblings', 'writeTaskLine', 'RECORD_SCHEMAS', 'RECORD_V1', 'RECORD_V2', 'TASK_TYPES', 'askedItems', 'followUps', 'optionAttrs', 'replayV2', 'reworkOf', 'taskTypeOf', 'v2Fields'];

test('provenance.mjs keeps exactly its public API', () => {
  assert.deepEqual(Object.keys(P).sort(), [...API].sort());
});

test('every public name is the very function of the module that owns it', () => {
  const OWNER = {
    ids: ['ID'],
    secrets: ['findSecrets', 'deepMask', 'maskSecrets'],
    project: ['hookErrorsFile', 'logHookError', 'legacyMemory', 'projectHome', 'projectSlug', 'workspaceSiblings', 'logFile', 'PROBE_OK', 'LOCAL_DIRS', 'ensureLocal'],
    chain: ['gitNote', 'gitError', 'recordName', 'readLog', 'readRecords', 'appendRecord', 'logId', 'anchorsFor', 'forget', 'verifyChain', 'readNotes'],
    records: ['readTaskRecords'],
    tasks: ['taskIds', 'validId', 'taskLines', 'taskFiles', 'taskStart', 'taskStartMark', 'markTaskStart', 'clearTaskStart', 'taskInProgress'],
    taskmd: ['INTERRUPTED_AFTER', 'markOpen', 'closeOpen', 'expireOpen', 'taskSummary', 'aprendidoOf', 'writeTaskLine', 'confirmTasks', 'tidyWip', 'tasksMarkdown', 'refreshTasks', 'rebuildFromGit'],
    decisions: ['decisionsIn', 'recordedDecisions', 'askedChoice'],
    derive: ['RECORD_SCHEMAS', 'RECORD_V1', 'RECORD_V2', 'TASK_TYPES', 'askedItems', 'followUps', 'optionAttrs', 'replayV2', 'reworkOf', 'taskTypeOf', 'v2Fields'],
    snapshot: ['turnInputs', 'pinnedRules', 'commitsFor', 'gitSnapshot', 'snapshotDiff', 'saveSnapshot', 'loadSnapshot', 'addRepoSnapshot', 'markPaused', 'turnChanged'],
  };
  const claimed = Object.values(OWNER).flat();
  assert.deepEqual(claimed.sort(), API.filter((n) => !['changesProject', 'mutatesFiles', 'shellRuns', 'shellSkeleton'].includes(n)).sort());
  for (const [mod, names] of Object.entries(OWNER)) for (const n of names) assert.equal(P[n], M[mod][n], `${mod}.${n}`);
});

test('the modules import each other without a cycle', () => {
  const dir = path.join(SCRIPTS, 'provenance');
  const graph = Object.fromEntries(MODULES.map((n) => [n, [...fs.readFileSync(path.join(dir, `${n}.mjs`), 'utf8').matchAll(/from '\.\/(\w+)\.mjs'/g)].map((m) => m[1])]));
  const state = {};
  const visit = (n, stack) => {
    if (state[n] === 'done') return;
    assert.notEqual(state[n], 'open', `cycle: ${[...stack, n].join(' → ')}`);
    state[n] = 'open';
    for (const d of graph[n]) visit(d, [...stack, n]);
    state[n] = 'done';
  };
  for (const n of MODULES) visit(n, []);
});

test('no module reads from the facade, and the facade holds no logic', () => {
  for (const n of MODULES) assert.ok(!/from '\.\.\/provenance\.mjs'/.test(fs.readFileSync(path.join(SCRIPTS, 'provenance', `${n}.mjs`), 'utf8')), n);
  const facade = fs.readFileSync(path.join(SCRIPTS, 'provenance.mjs'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'));
  assert.ok(facade.every((l) => /^export (\{|\*)/.test(l) || /^\s+\w+,?$|^\} from /.test(l)), 'only re-exports');
  assert.ok(facade.length <= 100, `${facade.length} lines`);
});

test('each module stays readable: under 350 lines', () => {
  for (const n of MODULES) {
    const lines = fs.readFileSync(path.join(SCRIPTS, 'provenance', `${n}.mjs`), 'utf8').split('\n').length;
    assert.ok(lines <= 350, `${n}.mjs has ${lines} lines`);
  }
});

test('a module exports only what another module or the facade uses', () => {
  const dir = path.join(SCRIPTS, 'provenance');
  const facade = fs.readFileSync(path.join(SCRIPTS, 'provenance.mjs'), 'utf8');
  const srcs = Object.fromEntries(MODULES.map((n) => [n, fs.readFileSync(path.join(dir, `${n}.mjs`), 'utf8')]));
  const idle = [];
  for (const [n, s] of Object.entries(srcs)) {
    for (const m of s.matchAll(/^export (?:async )?(?:const|let|function|class) ([A-Za-z_$][\w$]*)/gm)) {
      const re = new RegExp(`(?<![\w$.])${m[1].replace(/\$/g, '\$')}(?![\w$])`);
      const used = re.test(facade) || Object.entries(srcs).some(([o, t]) => o !== n && re.test(t.split('\n').filter((l) => /^import /.test(l)).join('\n')));
      if (!used) idle.push(`${n}.${m[1]}`);
    }
  }
  assert.deepEqual(idle, []);
});
