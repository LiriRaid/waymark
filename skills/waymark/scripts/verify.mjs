// Waymark · `waymark.mjs verify` (docs/adr/0027): what someone who was not there can check, offline.
//   chain      the records of the project: hash links, the notes in refs/notes/waymark, the anchors in refs/notes/waymark-anchor
//   install    the installed skills against skills/waymark/MANIFEST.json (or a manifest given with --manifest), and the vendored third-party
//              skills against skills/waymark/skills.lock (docs/adr/0036)
//   signature  the release tag (v<VERSION>, else HEAD) against skills/waymark/ALLOWED_SIGNERS, with git's own verification
//   anchors    who vouches for each task's anchor (docs/adr/0034): the ssh signature the hook made at the close, against the release's
//              ALLOWED_SIGNERS and the user's own (~/.waymark/ALLOWED_SIGNERS), several keys each with ssh's valid-after / valid-before,
//              and the keys in REVOKED_SIGNERS: signed by <key> · signed, key revoked · signed outside its validity · unsigned (key locked)
//   remote     with --remote [<name>] (default origin): the anchors the remote holds for this log, fetched into a temporary ref, against the
//              local records (docs/adr/0035): a record rewritten and chained again no longer matches the anchor the remote kept, and the first
//              task that differs is named. With no remote, "no remote copy" is said as a warning; offline, "not checked"; never silent.
// Exit 0 only when the chain (and, with --install, the files) are intact; a missing signature is a warning unless
// --require-signature, because a user with no signing key must still be able to verify the chain.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectHome, readRecords, readTaskRecords, readNotes, anchorsFor, verifyChain, gitNote, logId, logFile, RECORD_SCHEMAS } from './provenance.mjs';
import { anchorStates, fileSignature, trust, say, NS_ATTEST } from './sign.mjs';
import { remoteAnchors } from './notes-remote.mjs';
import { hasRemote } from './notes.mjs';
import { SKILLS, checkManifest, checkGenerated, manifestSignature, checkSkillsLock } from './manifest.mjs';
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

// The shapes of the records this project holds, from the records whose detail (the git note) can be read:
// { counts: { 'waymark.record/v2': n, … }, unknown: [schema…] }. A shape this release does not know is a warning, never a failure: a
// newer Waymark wrote it, and the chain does not depend on the shape.
export function schemaReport(cwd) {
  const counts = {};
  try { for (const r of readTaskRecords(projectHome(cwd))) if (r.schema) counts[r.schema] = (counts[r.schema] || 0) + 1; } catch {}
  return { counts, unknown: Object.keys(counts).filter((k) => !RECORD_SCHEMAS.includes(k)) };
}

// The signatures of a log's anchors, summed up: { rows, signed: [rows], problems: [{ row, text }], unsignedBefore }. The anchors before the
// first signed one are history from before signing was set up, not a gap; every one after it should be signed.
export function anchorReport(cwd) {
  const home = projectHome(cwd), records = readRecords(home.log);
  const rows = anchorStates(cwd, logId(logFile(cwd)), trust());
  const first = rows.findIndex((r) => r.state !== 'unsigned'); // signing began at the first anchor that carries any signature line
  const task = (r) => records[r.n - 1]?.id || `record ${r.n}`;
  const problems = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => first >= 0 && i >= first && r.state !== 'signed').map(({ r }) => ({ row: r, text: `${task(r)}: ${say(r)}` }));
  return { rows, first, unsignedBefore: first < 0 ? rows.length : rows.slice(0, first).filter((r) => r.state === 'unsigned').length, problems };
}

// The remote's copy of this log's anchors against the local records: { state, lines[], differs }. state: 'none' (no remote) |
// 'unreachable' | 'empty' | 'ok'. The remote anchors go through verifyChain like the local ones: since the last rewrite anchor, each must
// still name the line it anchored. Local anchors the remote lacks are not a failure: they were not pushed yet.
export function remoteReport(cwd, remote = 'origin') {
  const r = remoteAnchors(cwd, remote);
  if (r.state === 'none') return { state: 'none', lines: [`remote: no remote copy of the records (this repository has no remote ${remote}): a rewrite of the repository, its notes and the log together could not be detected`], differs: false };
  if (r.state === 'unreachable') return { state: r.state, lines: [`remote ${remote}: not checked (could not reach it: ${String(r.output || '').split('\n')[0].slice(0, 120)})`], differs: false };
  const home = projectHome(cwd), records = readRecords(home.log), m = logId(logFile(cwd));
  const mine = r.anchors.filter((a) => a.m === m && a.kind !== 'sig').sort((a, b) => (a.at || 0) - (b.at || 0));
  if (r.state === 'empty' || !mine.length) return { state: 'empty', lines: [`remote ${remote}: it holds no anchors of this log yet (nothing pushed: "waymark.mjs notes push")${r.anchors.length ? ` · ${r.anchors.length} of other logs` : ''}`], differs: false };
  const v = verifyChain(records, null, mine);
  if (!v.ok) {
    const rec = records[v.at] || {}, a = mine.find((x) => x.n === v.at + 1) || mine[mine.length - 1];
    return { state: 'ok', differs: true, lines: [`remote ${remote}: DIFFERS at ${rec.id || `record ${v.at + 1}`}: the anchor the remote kept (${a.n} records, last hash ${String(a.hash).slice(0, 12)}) no longer matches this log: one of them was rewritten after it was anchored`] };
  }
  const local = anchorsFor(cwd), onRemote = new Set(mine.map((a) => `${a.n}:${a.hash}`));
  const missing = local.filter((a) => a.kind !== 'rewrite' && !onRemote.has(`${a.n}:${a.hash}`)).length;
  return { state: 'ok', differs: false, lines: [`remote ${remote}: ${mine.length} anchors of this log match the local records${missing ? ` · ${missing} local anchor${missing > 1 ? 's' : ''} not pushed yet (\"waymark.mjs notes push\")` : ''}`] };
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
  const shapes = schemaReport(cwd);
  if (Object.keys(shapes.counts).length) lines.push(`record shapes: ${Object.entries(shapes.counts).map(([k, n]) => `${k.replace('waymark.record/', '')} ×${n}`).join(' · ')}${shapes.unknown.length ? ` · warning: unknown shape ${shapes.unknown.join(', ')} (written by a newer Waymark; the chain does not depend on it)` : ''}`);
  const at = args.indexOf('--remote');
  if (at >= 0) {
    const named = args[at + 1] && !args[at + 1].startsWith('--') && !/^d{4}-/.test(args[at + 1]) ? args[at + 1] : 'origin';
    const rr = remoteReport(cwd, named);
    lines.push(...rr.lines.map((l) => (rr.differs ? `✘ ${l}` : rr.state === 'ok' ? l : `⚠ ${l}`)));
    if (rr.differs) code = 1;
  } else if (!hasRemote(cwd)) lines.push('⚠ remote: no remote copy of the records (this repository has no remote origin): a rewrite of the repository, its notes and the log together could not be detected');
  const strict = args.includes('--require-signature') || args.includes('--require-signed'); // --require-signed: only the anchors and the attestation, not the release
  const sigs = anchorReport(cwd);
  if (sigs.rows.length) {
    const by = new Map();
    for (const r of sigs.rows.slice(Math.max(0, sigs.first))) by.set(sigs.first < 0 ? r.state : say(r), (by.get(sigs.first < 0 ? r.state : say(r)) || 0) + 1);
    lines.push(sigs.first < 0 ? `anchors: ${sigs.rows.length} unsigned (no signing key was set up when they were made; "waymark.mjs sign" says how)`
      : `anchors: ${[...by].map(([k, n]) => `${n} ${k}`).join(' · ')}${sigs.unsignedBefore ? ` · ${sigs.unsignedBefore} unsigned before signing began` : ''}`);
    for (const p of sigs.problems.slice(0, 5)) lines.push(`  ${p.row.state === 'bad' ? '✘' : '⚠'} ${p.text}`);
    if (sigs.problems.some((p) => p.row.state === 'bad')) code = 1; // a signature that does not match its anchor: the anchor or the signature was edited
    else if (sigs.problems.length && strict) code = 1;
  }
  const attFile = opt('--attestation');
  if (attFile) {
    const a = checkAttestation(cwd, attFile);
    lines.push(`attestation: ${a.ok ? 'valid' : 'INVALID'}`, ...a.checks.map((c) => `  ${c.ok ? '✔' : '✘'} ${c.name} · ${c.detail}`));
    if (!a.ok) code = 1;
    const s = fileSignature(attFile, NS_ATTEST);
    lines.push(`  ${s.state === 'bad' ? '✘' : s.state === 'signed' ? '✔' : '⚠'} signature · ${say(s)}`);
    if (s.state === 'bad' || (strict && s.state !== 'signed')) code = 1;
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
    const gen = checkGenerated(skillsDir);
    lines.push(gen.ok ? 'generated: skill-map.json and skill-registry.md are what sync writes (not hashed: sync rewrites them for each machine)' : `generated: ${gen.problems.join('; ')}`);
    if (!gen.ok) code = 1;
    // skills.lock (docs/adr/0036): each vendored third-party skill is still what it was pinned to.
    const lk = checkSkillsLock(skillsDir);
    lines.push(!lk.present ? `skills.lock: ${lk.problems[0]}`
      : lk.ok ? `skills.lock: ${lk.checked} vendored skill${lk.checked === 1 ? '' : 's'} match${lk.checked === 1 ? 'es' : ''} the pins${lk.checked ? '' : ' (this release vendors none)'}`
        : `skills.lock: DIFFERS · ${[...lk.changed.map((n) => `${n} changed since it was pinned`), ...lk.missing.map((n) => `${n} is pinned and gone`), ...lk.problems].join('; ')}`);
    if (lk.unpinned.length) lines.push(`  warning: ${lk.unpinned.join(', ')} ${lk.unpinned.length === 1 ? 'is' : 'are'} pinned to no ref and no upstream hash (re-vendor with --ref <tag|commit>)`);
    if (!lk.ok) code = 1;
    // The signature the install carries: MANIFEST.json.sig over the manifest, checked against ALLOWED_SIGNERS (no git needed).
    const sig = manifestSignature(manifestFile || path.join(skillsDir, 'waymark', 'MANIFEST.json'), path.join(skillsDir, 'waymark', 'ALLOWED_SIGNERS'));
    lines.push(`signature (MANIFEST.json): ${sig.state === 'signed' ? `signed by ${sig.by}` : sig.state === 'untrusted' ? 'signed, key not in ALLOWED_SIGNERS' : sig.state === 'bad' ? 'BAD signature: the manifest or its signature was edited after signing' : sig.state === 'unchecked' ? 'unchecked (ssh-keygen is not available here)' : 'unsigned'}`);
    if (sig.state !== 'signed') {
      if (args.includes('--require-signature')) code = 1;
      else lines.push('warning: not signed by a trusted key (pass --require-signature to fail on it)');
    }
    const tag = releaseSignature(skillsDir); // a clone also has the signed release tag: reported, not required
    if (tag) lines.push(`tag (${tag.ref}): ${sayState(tag)}`);
  } else if (args.includes('--require-signature')) {
    const sig = releaseSignature(skillsDir);
    lines.push(`signature (${sig?.ref || 'none'}): ${sig ? sayState(sig) : 'not a git clone'}`);
    if (!sig || sig.state !== 'signed') code = 1;
  }
  return { lines, code };
}
