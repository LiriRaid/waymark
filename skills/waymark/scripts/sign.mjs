#!/usr/bin/env node
// Waymark · signatures (docs/adr/0034): who vouches for an anchor and for an attestation, with the user's own ssh key.
// At a task's close the hook signs the anchor that already chains the records (one ssh-keygen call per task, namespace
// waymark-anchor) and keeps the signature as a `kind: "sig"` line appended to the same notes ref; `attest --out` writes a
// `.sig` next to the statement (namespace waymark-attestation). The hook never prompts for a passphrase: a locked key is
// recorded as `locked` and `waymark.mjs sign --pending` signs those from the user's terminal. The key is never read here,
// only handed to ssh-keygen by its path.
//   node sign.mjs                   which key would sign, and whether it can without asking
//   node sign.mjs --pending         sign the anchors a locked key left (asks for the passphrase in this terminal)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addAnchor, readAnchors } from './notes.mjs';
import { waymarkHome as HOME } from './lib/paths.mjs';

export const NS_ANCHOR = 'waymark-anchor';
export const NS_ATTEST = 'waymark-attestation';
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keygen = (args, opts = {}) => spawnSync('ssh-keygen', args, { encoding: 'utf8', timeout: 10000, windowsHide: true, ...opts });

// ---- the key ----
// The key to sign with: WAYMARK_SIGNING_KEY, else the `Signing key: <path>` line of ~/.waymark/preferences.md, else git's
// user.signingkey when gpg.format is ssh. A public key file works with ssh-agent. null: no key, so nothing is signed.
let gitKey;
export function signingKey(cwd = process.cwd(), env = process.env) {
  const given = env.WAYMARK_SIGNING_KEY;
  if (given !== undefined) return given.trim() || null;
  try {
    const m = fs.readFileSync(path.join(HOME(), 'preferences.md'), 'utf8').match(/^[-*\s]*(?:\[[^\]]*\]\s*)?Signing key:\s*(.+?)\s*$/im);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch {}
  if (gitKey === undefined) {
    const cfg = (k) => spawnSync('git', ['config', '--get', k], { cwd, encoding: 'utf8', timeout: 3000 }).stdout?.trim() || '';
    gitKey = cfg('gpg.format') === 'ssh' && cfg('user.signingkey') && !cfg('user.signingkey').startsWith('key::') ? cfg('user.signingkey') : null;
  }
  return gitKey;
}
export const home = (p) => (String(p).startsWith('~/') ? path.join(os.homedir(), String(p).slice(2)) : p);

// ---- signing ----
// → { ok: true, sig } | { ok: false, state: 'nokey' | 'locked' | 'error', error }
// interactive: the user is at a terminal, so ssh-keygen may ask for the passphrase; the hook is never interactive.
export function signData(data, ns, keyFile, { interactive = false } = {}) {
  if (!keyFile) return { ok: false, state: 'nokey' };
  const file = home(keyFile);
  if (!fs.existsSync(file)) return { ok: false, state: 'error', error: `no key at ${keyFile}` };
  const args = ['-Y', 'sign', '-f', file, '-n', ns, ...(file.endsWith('.pub') ? ['-U'] : [])];
  const r = interactive
    ? keygen(args, { input: data, timeout: 120000, stdio: ['pipe', 'pipe', 'inherit'] })
    : keygen(args, { input: data, env: { ...process.env, SSH_ASKPASS_REQUIRE: 'never', DISPLAY: '' } });
  if (r.status === 0 && String(r.stdout).includes('BEGIN SSH SIGNATURE')) return { ok: true, sig: r.stdout };
  const why = `${r.stderr || ''} ${r.error?.message || ''}`;
  return { ok: false, state: /passphrase|incorrect|decrypt|agent|communication/i.test(why) || r.error?.code === 'ETIMEDOUT' ? 'locked' : 'error', error: why.trim().slice(0, 200) };
}

// What an anchor's signature covers: the log, the kind, how many records, the last hash and when it was anchored.
export const anchorPayload = (a) => `waymark-anchor/v1\n${a.m}\n${a.kind || 'anchor'}\n${a.n}\n${a.hash}\n${a.at}\n`;

// Signs one anchor and keeps the result next to it. → 'signed' | 'locked' | 'nokey' | 'error'. With no key nothing is written:
// a user who never set signing up gets no extra lines.
export function signAnchor(cwd, anchor, { keyFile = signingKey(cwd), interactive = false, late = false } = {}) {
  const r = signData(anchorPayload(anchor), NS_ANCHOR, keyFile, { interactive });
  if (r.state === 'nokey') return 'nokey';
  const line = { m: anchor.m, kind: 'sig', n: anchor.n, hash: anchor.hash, at: anchor.at, signedAt: Date.now(), ...(anchor.kind ? { of: anchor.kind } : {}), ...(late ? { late: true } : {}),
    ...(r.ok ? { state: 'signed', sig: r.sig } : { state: r.state === 'locked' ? 'locked' : 'error' }) };
  try { addAnchor(cwd, line); } catch {}
  return line.state;
}

// ---- trust ----
// The signers verify trusts: the release's ALLOWED_SIGNERS plus the user's own (~/.waymark/ALLOWED_SIGNERS), several keys each
// with ssh's own valid-after / valid-before; and the keys revoked in REVOKED_SIGNERS (release and user), one public key per line.
export function trust(skillDir = SKILL) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const lines = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !/^gpg\s/i.test(l));
  const allowed = [...lines(read(path.join(skillDir, 'ALLOWED_SIGNERS'))), ...lines(read(path.join(HOME(), 'ALLOWED_SIGNERS')))];
  const revokedText = [read(path.join(skillDir, 'REVOKED_SIGNERS')), read(path.join(HOME(), 'REVOKED_SIGNERS'))].join('\n');
  const revoked = new Set();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-trust-'));
  try {
    const f = path.join(tmp, 'revoked.pub');
    fs.writeFileSync(f, lines(revokedText).join('\n') + '\n');
    if (lines(revokedText).length) for (const l of String(keygen(['-lf', f]).stdout).split('\n')) { const fp = l.match(/SHA256:\S+/)?.[0]; if (fp) revoked.add(fp); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { allowed, revoked, principals: [...new Set(allowed.map((l) => l.split(/\s+/)[0]))] };
}
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';

// The state of a signature over `data`: { state: 'signed' | 'revoked' | 'outside' | 'untrusted' | 'bad' | 'unchecked', by?, fingerprint? }.
// `at` is when it was signed: a key is valid or not as of that time. Without ssh-keygen nothing can be checked.
export function verifySignature(data, sigText, ns, { at = Date.now(), t = trust() } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sig-'));
  try {
    const sigFile = path.join(tmp, 'x.sig'), allowedFile = path.join(tmp, 'allowed');
    fs.writeFileSync(sigFile, sigText);
    fs.writeFileSync(allowedFile, t.allowed.join('\n') + '\n');
    const c = keygen(['-Y', 'check-novalidate', '-n', ns, '-s', sigFile], { input: data });
    if (c.error) return { state: 'unchecked' };
    if (c.status !== 0) return { state: 'bad' };
    const fingerprint = `${c.stdout}${c.stderr}`.match(/SHA256:\S+/)?.[0] || null;
    if (fingerprint && t.revoked.has(fingerprint)) return { state: 'revoked', fingerprint };
    let outside = false;
    for (const who of t.principals) {
      const v = keygen(['-Y', 'verify', '-f', allowedFile, '-I', who, '-n', ns, '-s', sigFile, `-Overify-time=${stamp(at)}`], { input: data });
      if (v.status === 0) return { state: 'signed', by: who, fingerprint };
      if (/expired|not yet valid/i.test(`${v.stderr}`)) outside = true;
    }
    return { state: outside ? 'outside' : 'untrusted', fingerprint };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---- the anchors of a log and their signatures ----
// One row per anchor of the log `m`, oldest first: { n, hash, at, kind?, state, by? } where state is signed | revoked | outside |
// untrusted | bad | locked | unsigned. The newest signature line of an anchor wins (a later `sign --pending` supersedes `locked`).
export function anchorStates(cwd, m, t = trust()) {
  const all = readAnchors(cwd).filter((a) => a.m === m);
  const sigs = all.filter((a) => a.kind === 'sig');
  return all.filter((a) => a.kind !== 'sig').sort((a, b) => (a.at || 0) - (b.at || 0)).map((a) => {
    const mine = sigs.filter((s) => s.n === a.n && s.hash === a.hash).sort((x, y) => (x.signedAt || 0) - (y.signedAt || 0));
    const last = mine.filter((s) => s.state === 'signed').pop() || mine.pop();
    const row = { n: a.n, hash: a.hash, at: a.at, ...(a.kind ? { kind: a.kind } : {}) };
    if (!last) return { ...row, state: 'unsigned' };
    if (last.state !== 'signed') return { ...row, state: last.state === 'locked' ? 'locked' : 'unsigned' };
    const v = verifySignature(anchorPayload(a), last.sig, NS_ANCHOR, { at: last.signedAt || a.at, t });
    return { ...row, state: v.state === 'unchecked' ? 'unsigned' : v.state, ...(v.by ? { by: v.by } : {}), ...(last.late ? { late: true } : {}) };
  });
}

// The anchors a locked key left, to sign now with the user at the terminal. → { signed, locked, error }
export function signPending(cwd, m, { keyFile = signingKey(cwd), interactive = true } = {}) {
  const out = { signed: 0, locked: 0, error: 0, todo: 0 };
  const rows = anchorStates(cwd, m).filter((r) => r.state === 'locked');
  out.todo = rows.length;
  const all = readAnchors(cwd).filter((a) => a.m === m && a.kind !== 'sig');
  for (const r of rows) {
    const a = all.find((x) => x.n === r.n && x.hash === r.hash && x.at === r.at);
    if (!a) continue;
    const s = signAnchor(cwd, a, { keyFile, interactive, late: true });
    out[s === 'signed' ? 'signed' : s === 'locked' ? 'locked' : 'error']++;
    if (s !== 'signed') break; // a wrong passphrase once is enough: do not ask the same thing again
  }
  return out;
}

// ---- a file and its .sig (the attestation) ----
export function signFile(file, ns, keyFile = signingKey(path.dirname(file)), opts = {}) {
  const r = signData(fs.readFileSync(file), ns, keyFile, opts);
  if (r.ok) fs.writeFileSync(`${file}.sig`, r.sig);
  return r.ok ? { state: 'signed', file: `${file}.sig` } : { state: r.state, error: r.error };
}
export function fileSignature(file, ns, t = trust()) {
  if (!fs.existsSync(`${file}.sig`)) return { state: 'unsigned' };
  return verifySignature(fs.readFileSync(file), fs.readFileSync(`${file}.sig`, 'utf8'), ns, { at: fs.statSync(`${file}.sig`).mtimeMs, t });
}

// The words verify and the CLI use for each state.
export const SAYS = { signed: (r) => `signed by ${r.by}${r.late ? ' (signed later)' : ''}`, revoked: () => 'signed, key revoked', outside: () => 'signed outside its validity', untrusted: () => 'signed, key not trusted', bad: () => 'BAD signature', locked: () => 'unsigned (key locked)', unsigned: () => 'unsigned', unchecked: () => 'unchecked (ssh-keygen is not available here)' };
export const say = (r) => SAYS[r.state](r);

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const key = signingKey(process.cwd());
  if (process.argv.includes('--pending')) {
    const { projectHome, logId, logFile } = await import('./provenance.mjs');
    const cwd = process.cwd(), m = logId(logFile(cwd));
    const todo = anchorStates(cwd, m).filter((r) => r.state === 'locked').length;
    if (!key) { console.log('sign: no signing key (WAYMARK_SIGNING_KEY, a `Signing key: <path>` line in ~/.waymark/preferences.md, or git user.signingkey with gpg.format ssh)'); process.exitCode = 1; }
    else if (!todo) console.log('sign: nothing pending (no anchor was left by a locked key)');
    else { const r = signPending(projectHome(cwd).root, m, { keyFile: key }); console.log(`sign: ${r.signed} of ${r.todo} signed${r.locked ? ` · the key is still locked (wrong passphrase?)` : ''}${r.error ? ` · ${r.error} failed` : ''}`); process.exitCode = r.signed === r.todo ? 0 : 1; }
  } else {
    const probe = key ? signData('waymark-probe', NS_ANCHOR, key) : { state: 'nokey' };
    console.log(!key ? 'sign: no signing key; tasks are not signed (set WAYMARK_SIGNING_KEY, a `Signing key: <path>` line in ~/.waymark/preferences.md, or git user.signingkey with gpg.format ssh)'
      : probe.ok ? `sign: ready: ${key} signs without asking` : `sign: ${probe.state === 'locked' ? 'the key is locked (a passphrase): tasks are recorded as locked; run `sign --pending` from your terminal' : `cannot sign (${probe.error || probe.state})`}`);
  }
}
