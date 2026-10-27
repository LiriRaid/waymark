// Waymark · the memory a file carries into an edit (docs/adr/0027). It lives apart from the CLI (waymark.mjs) so the tool hook, which hands it
// over at a task's first edit, imports only provenance.mjs and not every module the commands use.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectHome, readRecords, readNotes, gitNote, aprendidoOf } from './provenance.mjs';

// Per file, the last tasks that changed it, newest first: from `git log -- <file>` and the records of those commits (a
// note, read even with no local log, a stub's commits, or the recorded task the commit's trailer names), plus the
// records of tasks without a commit that list the file. A commit no task recorded is shown too (a change made by hand).
// → text.
export function pack(cwd, files, per = 3) {
  const home = projectHome(cwd), root = home.root;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', timeout: 5000 });
  const records = readRecords(home.log).filter((r) => r.id);
  const out = [];
  for (const file of files) {
    const abs = path.resolve(cwd, file), rel = path.relative(root, abs).replace(/\\/g, '/');
    const log = git('log', '-n', '20', '--format=%H%x1f%ct%x1f%s%x1f%B%x1e', '--', rel).stdout.split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => l.split('\x1f'));
    const notes = readNotes(root, log.map(([h]) => h));
    const byCommit = new Map(records.flatMap((r) => (r.commits || []).map((c) => [c, r])));
    const byId = new Map(records.map((r) => [r.id, r]));
    const seen = new Set(), rows = [];
    const learnedOf = (r) => clipTo(aprendidoOf(String(r.cierre || '').replace(/\*\*|__/g, '')) || r.prompt || '', 120);
    for (const [h, ct, subject, body = ''] of log) {
      // the commit's record: its stub here; else its note alone (a clone without this machine's log); else the
      // recorded task its trailer names (committed later by another task)
      const stub = byCommit.get(h), trailer = body.match(/^\s*Waymark-Task:\s*(.+?)\s*$/im)?.[1];
      let rec = stub;
      const n = notes.get(gitNote(stub)?.commit || h);
      if (n) { try { rec = { ...JSON.parse(n), ...stub }; } catch {} }
      else if (gitNote(stub)) rec = { ...stub, prompt: '(its git note is missing: a rebase or amend?)' };
      else if (!stub && trailer && byId.has(trailer)) rec = byId.get(trailer);
      if (rec && seen.has(rec.id)) continue;
      if (rec) seen.add(rec.id);
      rows.push({ at: Number(ct) * 1000, text: rec ? `${rec.id} · ${rec.agent || '?'} · ${learnedOf(rec)} · ${h.slice(0, 8)}` : `${h.slice(0, 8)} · ${clipTo(subject, 100)} (no task record)` });
    }
    // tasks with no commit that changed this file
    for (const r of records.filter((x) => !x.commits?.length && !seen.has(x.id) && (x.files || []).some((p) => path.resolve(p).toLowerCase() === abs.toLowerCase()))) {
      seen.add(r.id);
      rows.push({ at: Date.parse(r.at) || 0, text: `${r.id} · ${r.agent || '?'} · ${learnedOf(r)} · (no commit)` });
    }
    const shown = rows.sort((x, y) => y.at - x.at).slice(0, per).map((x) => x.text);
    out.push(`${rel}:${shown.length ? shown.map((x) => `\n  - ${x}`).join('') : ' no earlier task or commit'}`);
  }
  return out.join('\n');
}
const clipTo = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
