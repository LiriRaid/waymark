// Waymark · `waymark.mjs verify` (docs/adr/0027): what someone who was not there can check, offline.
//   chain      the records of the project: hash links, the notes in refs/notes/waymark, the anchors in refs/notes/waymark-anchor
//   install    the installed skills against skills/waymark/MANIFEST.json (or a manifest given with --manifest)
//   signature  the release tag (v<VERSION>, else HEAD) against skills/waymark/ALLOWED_SIGNERS, with git's own verification
// Exit 0 only when the chain (and, with --install, the files) are intact; a missing signature is a warning unless
// --require-signature, because a user with no signing key must still be able to verify the chain.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectHome, readRecords, readNotes, anchorsFor, verifyChain, gitNote } from './provenance.mjs';
import { SKILLS, checkManifest } from './manifest.mjs';
import { checkAttestation } from './attest.mjs';

export const ALLOWED_SIGNERS = path.join(SKILLS, 'waymark', 'ALLOWED_SIGNERS');
const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 8000, ...opts });

// Why the chain broke at record `at`, in words: the three ways a record's history is changed.
function why(r, records) {
  if (r.anchor) return 'an anchor in git names a line this log no longer has: the log was rewritten and chained again, or cut';
  if (r.note) return 'its git note is missing or was edited after the record sealed it';
  const prev = records[r.at - 1];
  return `the line's hash or its link to the one before does not match: it was edited${prev ? '' : ' (it is the first line)'}, or a line before it was deleted`;
}

// → { ok, records, notes, anchors, broken: { at, task, reason } | null }
export function chainReport(cwd) {
  const home = projectHome(cwd);
  const records = readRecords(home.log);
  const anyNote = records.some(gitNote);
  const notes = anyNote ? readNotes(cwd) : null;
  const anchors = anchorsFor(cwd);
  const r = verifyChain(records, notes, anchors);
  const base = { records: records.length, notes: notes ? notes.size : 0, anchors: anchors.length };
  if (r.ok) return { ok: true, ...base, broken: null };
  const rec = records[r.at] || {};
  return { ok: false, ...base, broken: { at: r.at, task: rec.id || `line ${r.at + 1}`, reason: why(r, records) } };
}

// The signers a project's release trusts: ssh lines of git's allowed-signers format, and `gpg <fingerprint>` lines.
export function allowedSigners(file = ALLOWED_SIGNERS) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { ssh: false, gpg: [] }; }
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return { ssh: lines.some((l) => !/^gpg\s/i.test(l)), gpg: lines.filter((l) => /^gpg\s/i.test(l)).map((l) => l.replace(/^gpg\s+/i, '').replace(/\s+/g, '').toUpperCase()) };
}

// State of the signature of a tag or a commit: { state: 'signed' | 'untrusted' | 'bad' | 'unsigned' | 'unchecked', by? }.
export function signatureState(repo, rev, { tag = false, allowed = ALLOWED_SIGNERS } = {}) {
  const signers = allowedSigners(allowed);
  const cfg = fs.existsSync(allowed) ? ['-c', `gpg.ssh.allowedSignersFile=${allowed}`] : [];
  const r = tag ? git(repo, [...cfg, 'tag', '-v', rev]) : git(repo, [...cfg, 'verify-commit', rev]);
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.error) return { state: 'unchecked' };
  const ssh = out.match(/Good "git" signature for (\S+) with (\S+) key (\S+)/);
  if (ssh) return { state: 'signed', by: `${ssh[1]} (${ssh[2]} ${ssh[3]})` };
  const fpr = (out.match(/Primary key fingerprint:\s*([0-9A-F ]+)/i)?.[1] || out.match(/using \w+ key ([0-9A-F]{16,40})/i)?.[1] || '').replace(/\s+/g, '').toUpperCase();
  if (/Good signature from/i.test(out)) {
    const name = out.match(/Good signature from "([^"]+)"/i)?.[1] || fpr;
    return fpr && signers.gpg.some((f) => f.endsWith(fpr) || fpr.endsWith(f)) ? { state: 'signed', by: `${name} (gpg ${fpr.slice(-16)})` } : { state: 'untrusted' };
  }
  if (/No principal matched|not .*allowed|no allowed signers|allowedSignersFile/i.test(out) && /signature/i.test(out)) return { state: 'untrusted' };
  if (/Bad "git" signature|BAD signature|bad signature/i.test(out)) return { state: 'bad' };
  if (/no signature found|does not have a GPG signature|error: no signature|cannot verify a non-tag/i.test(out) || r.status !== 0) return { state: 'unsigned' };
  return { state: 'unchecked' };
}

const SAYS = { signed: (s) => `signed by ${s.by}`, untrusted: () => 'signed, key not in ALLOWED_SIGNERS', bad: () => 'bad signature', unsigned: () => 'unsigned', unchecked: () => 'unchecked (git could not verify it here)' };
export const sayState = (s) => SAYS[s.state](s);

// The release this repository holds: tag v<VERSION> if it exists, else HEAD. null: not a git repository.
export function releaseSignature(skillsDir = SKILLS) {
  const top = git(skillsDir, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return null;
  const repo = top.stdout.trim();
  const version = (() => { try { return fs.readFileSync(path.join(skillsDir, 'waymark', 'VERSION'), 'utf8').trim(); } catch { return null; } })();
  const tag = version && git(repo, ['rev-parse', '-q', '--verify', `refs/tags/v${version}`]).status === 0 ? `v${version}` : null;
  const s = signatureState(repo, tag || 'HEAD', { tag: !!tag, allowed: path.join(skillsDir, 'waymark', 'ALLOWED_SIGNERS') });
  return { ...s, ref: tag || 'HEAD' };
}

// The signature state of each commit (hashes), for the record: { <short hash>: 'signed' | … }.
export function commitSignatures(repo, commits) {
  const out = {};
  for (const h of commits || []) out[h.slice(0, 12)] = signatureState(repo, h).state;
  return out;
}

// The rules a record says governed its task (rec.pinned) against this release's manifest: { pinned, match, differ[] }, or
// null when the record pins nothing (a task before 2.0.16).
export function pinnedReport(rec, manifest = null) {
  const p = rec?.pinned;
  if (!p) return null;
  let files = manifest?.files;
  if (!files) { try { files = JSON.parse(fs.readFileSync(path.join(SKILLS, 'waymark', 'MANIFEST.json'), 'utf8')).files; } catch { files = {}; } }
  const items = [['waymark/routine.json', p.routine], ...(p.department ? [[`${p.department.skill}/SKILL.md`, p.department.sha]] : []), ...(p.procedures ? [[`${p.procedures.dept}/procedures.md`, p.procedures.sha]] : []),
    ...(p.profiles || []).map((x) => [`waymark/${x.kind === 'stack' ? 'stacks' : 'architectures'}/${x.name}.md`, x.sha])].filter(([, sha]) => sha);
  const differ = items.filter(([f, sha]) => files[f] !== sha).map(([f]) => f);
  return { pinned: items.length, match: items.length - differ.length, differ };
}

// verify [--install] [--require-signature] [--manifest <file>] [<task ID>] → { lines[], code }
export function verify(cwd, args = [], { skillsDir = SKILLS } = {}) { // skillsDir: the install to check (the running one by default)
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const lines = [];
  let code = 0;
  const chain = chainReport(cwd);
  lines.push(chain.ok
    ? `chain: intact · ${chain.records} records · ${chain.notes} notes in git · ${chain.anchors} anchors`
    : `chain: BROKEN at ${chain.broken.task} · ${chain.broken.reason}`);
  if (!chain.ok) code = 1;
  const attFile = opt('--attestation');
  if (attFile) {
    const a = checkAttestation(cwd, attFile);
    lines.push(`attestation: ${a.ok ? 'valid' : 'INVALID'}`, ...a.checks.map((c) => `  ${c.ok ? '✔' : '✘'} ${c.name} · ${c.detail}`));
    if (!a.ok) code = 1;
  }
  const id = args.join(' ').match(/\d{4}-\d{2}-\d{2} · T\d+[a-z]*/)?.[0];
  if (id) {
    const rec = readRecords(projectHome(cwd).log).find((r) => r.id === id);
    lines.push(rec ? `task ${id}: recorded${rec.commits?.length ? ` · ${rec.commits.length} commit(s)` : ' · no commit'}${rec.signatures ? ` · signatures ${Object.values(rec.signatures).join(', ')}` : ''}` : `task ${id}: no record in this log`);
    const pr = pinnedReport(rec);
    if (rec) lines.push(pr ? `rules: ${pr.pinned} pinned · ${pr.match} match this release's manifest${pr.differ.length ? ` · differ: ${pr.differ.join(', ')} (another release, or the file changed)` : ''}` : 'rules: not pinned in this record (a task from before 2.0.16)');
    if (!rec) code = 1;
  }
  if (args.includes('--install')) {
    const manifestFile = opt('--manifest');
    let m = null;
    try { m = manifestFile ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null; } catch { lines.push(`install: cannot read ${manifestFile}`); code = 1; }
    if (!manifestFile || m) {
      let r;
      try { r = checkManifest(skillsDir, m); } catch { r = null; lines.push('install: no MANIFEST.json in this install'); code = 1; }
      if (r) {
        lines.push(r.ok ? `install: ${r.checked} files match the manifest (version ${r.version})` : `install: DIFFERS from the manifest · ${r.changed.length} changed, ${r.missing.length} missing, ${r.extra.length} extra\n${[...r.changed.map((f) => `  ~ ${f}`), ...r.missing.map((f) => `  - ${f}`), ...r.extra.map((f) => `  + ${f}`)].slice(0, 12).join('\n')}`);
        if (!r.ok) code = 1;
      }
    }
    const sig = releaseSignature(skillsDir);
    if (!sig) lines.push('signature: this install is not a git clone (no history to verify); check the tag from a clone: git tag -v v<version>');
    else {
      lines.push(`signature (${sig.ref}): ${sayState(sig)}`);
      if (sig.state !== 'signed') {
        if (args.includes('--require-signature')) code = 1;
        else lines.push('warning: not signed by a trusted key (pass --require-signature to fail on it)');
      }
    }
  } else if (args.includes('--require-signature')) {
    const sig = releaseSignature(skillsDir);
    lines.push(`signature (${sig?.ref || 'none'}): ${sig ? sayState(sig) : 'not a git clone'}`);
    if (!sig || sig.state !== 'signed') code = 1;
  }
  return { lines, code };
}
