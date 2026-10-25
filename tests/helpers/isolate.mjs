// Test isolation: import this first in every test file. A test never reads or writes the real ~/.waymark, ~/.claude or
// any agent's home, and never inherits the environment of the session it runs in (WAYMARK_* switches, Claude Code,
// Codex, Gemini, Cursor or Copilot variables; only WAYMARK_CONFORMANCE_*, which tell the conformance suite what to judge, pass). The process gets a throwaway home folder: os.homedir() answers it, so a
// path built from it lands in the sandbox, and the variables an agent's hook reads point inside it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REAL_HOME = process.env.WAYMARK_TEST_REAL_HOME || os.homedir(); // kept for the one test that checks the isolation
if (!process.env.WAYMARK_TEST_SANDBOX) {
  const INHERITED = /^(WAYMARK_(?!CONFORMANCE_)|CLAUDE|CODEX_|GEMINI_|CURSOR_|COPILOT_|OPENCODE_|ANTIGRAVITY_|KIRO_|XDG_|USER_PROMPT$)/i;
  for (const k of Object.keys(process.env)) if (INHERITED.test(k)) delete process.env[k];
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `wm-test-${process.pid}-`));
  process.env.WAYMARK_TEST_SANDBOX = sandbox;
  process.env.WAYMARK_TEST_REAL_HOME = REAL_HOME;
  process.env.USERPROFILE = process.env.HOME = sandbox;
  process.env.WAYMARK_HOME = path.join(sandbox, '.waymark');
  // one root for everything a test makes: os.tmpdir() answers a folder inside the sandbox (and so does every process the test spawns), so no test leaves a folder
  // of its own in the machine's temp, whether it removes its own or not; the root is removed when the process ends.
  const tmp = path.join(sandbox, 'tmp');
  fs.mkdirSync(tmp);
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = tmp;
  process.on('exit', () => { try { fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {} });
}
export const SANDBOX = process.env.WAYMARK_TEST_SANDBOX;
