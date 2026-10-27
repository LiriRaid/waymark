// Waymark · the notes' way to a remote and back (docs/adr/0035): the user's one-time yes saved as a preference, the push the hook
// makes at each close once it is given, and the remote's anchors fetched into a temporary ref for `verify --remote`.
//   Notes push: waymark, other-project      projects whose task notes the hook pushes to origin at each close
//   Notes push never: some-project          projects that must never be offered it again
// The notes hold the user's requests and Cierres: a remote that is public publishes them, so the yes is per project, never global.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './lib/git.mjs';
import { waymarkHome as HOME } from './lib/paths.mjs';
import { ANCHOR_REF, pushNotes, shouldPushNotes, hasRemote, readNotes, defaultRemote } from './notes.mjs';

const prefsFile = () => path.join(HOME(), 'preferences.md');
const LIST = (key) => new RegExp(`${key}:[ \\t]*([^—\\n]*)`, 'i');
const names = (s) => String(s || '').split(/[,;]/).map((x) => x.replace(/[`"']/g, '').trim()).filter(Boolean);

// 'yes' when the project is on the `Notes push:` list (or the list says `all`), 'never' when it is on `Notes push never:`, else null.
export function pushPref(slug, file = prefsFile()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const never = names(text.match(LIST('Notes push never'))?.[1]);
  if (never.includes(slug)) return 'never';
  const yes = names(text.match(/Notes push:[ \t]*([^—\n]*)/i)?.[1]);
  return yes.includes(slug) || yes.includes('all') ? 'yes' : null;
}

// Adds the project to the `Notes push:` (or `Notes push never:`) line of the preferences, creating the line when there is none.
// The contrary line loses the project and keeps `(expired <date> for <slug>: <the new rule>)`, or the older answer would still win;
// the note never repeats a key, or the key's regex would read it as the line.
export function savePushPref(slug, kind = 'yes', { file = prefsFile(), now = new Date() } = {}) {
  const key = kind === 'never' ? 'Notes push never' : 'Notes push';
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const NEVER = /^(.*Notes push never:[ \t]*)([^—\n]*)(.*)$/im, YES = /^(.*Notes push:[ \t]*)([^—\n]*)(.*)$/im;
  const other = kind === 'never' ? YES : NEVER, old = text.match(other);
  if (old && names(old[2]).includes(slug)) {
    const rest = names(old[2]).filter((n) => n !== slug).join(', ');
    text = text.replace(other, (_, a, b, c) => `${a}${rest}${rest ? ' ' : ''}${c.trim() ? c.trim() : '—'} (expired ${now.toLocaleDateString('sv')} for ${slug}: the user now said ${kind === 'never' ? 'never push' : 'push at each close'})`);
  }
  const re = kind === 'never' ? NEVER : YES;
  const hit = text.match(re);
  if (hit) {
    const list = names(hit[2]);
    if (!list.includes(slug)) text = text.replace(re, (_, a, b, c) => `${a}${[...list, slug].join(', ')}${c ? ` ${c.trim()}` : ''}`);
  } else {
    const why = kind === 'never' ? 'never offered to push their task notes (they hold the requests)' : 'agreed to push their task notes to origin at each close (they hold the requests)';
    text = `${text.replace(/\n*$/, '\n')}${text.includes('## Learned preferences') ? '' : '\n## Learned preferences\n'}- [${now.toLocaleDateString('sv')}] ${key}: ${slug} — the user ${why}\n`;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// The push at a task's close, once the user said yes for this project. It never prompts, waits at most 15 s and never blocks:
// the next close tries again. → { state: 'off' | 'nothing' | 'pushed' | 'failed', remote, output? }
export function autoPushNotes(cwd, slug, remote = defaultRemote(cwd)) {
  if (pushPref(slug) !== 'yes' || !hasRemote(cwd, remote)) return { state: 'off', remote };
  if (!shouldPushNotes(cwd, remote)) return { state: 'nothing', remote };
  const r = pushNotes(cwd, remote, { timeout: 15000, quiet: true });
  return { state: r.ok ? 'pushed' : 'failed', remote, output: r.output };
}

// The anchors the remote holds, fetched into a temporary ref (the local notes are never touched) and read.
// → { state: 'none' (no such remote) | 'unreachable' | 'empty' (the remote has no anchors yet) | 'ok', anchors, output }
export function remoteAnchors(cwd, remote = defaultRemote(cwd)) {
  if (!hasRemote(cwd, remote)) return { state: 'none', anchors: [] };
  const tmp = `refs/notes/waymark-verify-${process.pid}`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const f = git(cwd, ['fetch', '-q', remote, `+${ANCHOR_REF}:${tmp}`], { encoding: 'utf8', timeout: 60000, env });
  const output = `${f.stdout || ''}${f.stderr || ''}`.trim() || (f.error ? `${f.error.code || f.error.message}` : '');
  try {
    if (f.status !== 0) return { state: /couldn't find remote ref/i.test(output) ? 'empty' : 'unreachable', anchors: [], output };
    const anchors = [];
    for (const [, text] of readNotes(cwd, null, tmp)) for (const line of text.split('\n')) { try { const a = JSON.parse(line); if (a && typeof a === 'object') anchors.push(a); } catch {} }
    return { state: 'ok', anchors, output };
  } finally { git(cwd, ['update-ref', '-d', tmp]); }
}
