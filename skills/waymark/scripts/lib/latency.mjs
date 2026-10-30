// The tag hook-run.cjs writes beside a run's milliseconds in latency.log: project folder, session (first 8 characters) and the transcript's size in KB, so a slow run
// can be read against a long session (docs/adr/0049). One stat; it never throws and adds no process.
import fs from 'node:fs';
import path from 'node:path';

export function tagLatency(hook, cwd) {
  try {
    const kb = hook?.transcript_path ? Math.max(1, Math.round(fs.statSync(hook.transcript_path).size / 1024)) : 0;
    process.env.WAYMARK_LATENCY_TAG = `${path.basename(String(cwd || hook?.cwd || '')).replace(/[\s:]+/g, '_')}:${String(hook?.session_id || '').slice(0, 8)}:${kb}`;
  } catch { /* the hook's work matters more than its timing */ }
}
