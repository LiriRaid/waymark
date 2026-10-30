// Waymark · the eyes (docs/adr/0047): what a task that changed something seen owes the screen. A build or a spec says the code compiles; only a browser
// that measured or clicked what was built says how it looks and behaves. The provider is what the machine has: ego-browser first, Playwright where the
// project declares it, else the agent's own browser panel. Read from the transcript's tool calls, never from words: a call counts when it measures (the
// computed size or style of an element, a script run in the page) or clicks (with the state after it), after the task's last change.
import fs from 'node:fs';
import path from 'node:path';
import { waymarkHome, slash } from './lib/paths.mjs';

const EXE = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
const EGO = 'ego-browser';
const onPath = (name, env) => String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).some((d) => EXE.some((x) => fs.existsSync(path.join(d, name + x))));

// Where ego's installer puts the program when the PATH lacks it: the absolute path, or null.
const egoInstalled = (env) => {
  const home = env.HOME || env.USERPROFILE || '';
  if (!home) return null;
  const dir = path.join(home, '.local', 'share', 'ego', 'active_version_dir');
  const x = EXE.find((e) => fs.existsSync(path.join(dir, EGO + e)));
  return x === undefined ? null : path.join(dir, EGO + x);
};
// The command the block hands the agent: the bare name while the agent's shell runs it, the absolute path (quoted, forward slashes) only while the PATH lacks it.
export function egoCommand(env = process.env) {
  if (onPath(EGO, env)) return EGO;
  const at = egoInstalled(env);
  return at ? `"${slash(at)}"` : EGO;
}
// Ego installed but not on the PATH: what `check` tells the user (the agent is handed the path meanwhile).
export const egoOffPath = (env = process.env) => !onPath(EGO, env) && !!egoInstalled(env);

// → 'ego' | 'playwright' | null: ego on PATH (or where its installer puts it), else a Playwright the project declares.
export function eyesProvider({ root, env = process.env } = {}) {
  if (onPath(EGO, env) || egoInstalled(env)) return 'ego';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root || '', 'package.json'), 'utf8'));
    if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((n) => /^(@playwright\/test|playwright)$/.test(n))) return 'playwright';
  } catch {}
  return null;
}

const CSS_HTML = /\.(css|scss|sass|less|html)$/i;
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/i;
// Is the eyes' turn due? A seen change at L2+, or an L1 of styles and templates only with no spec (a spec cannot see layout: jsdom computes none).
export function eyesDue({ provider, ui, level, changed = [] }) {
  if (!provider || !ui) return false;
  if (level >= 2) return true;
  const files = changed.filter((f) => !SPEC.test(path.basename(f)));
  return level === 1 && files.length > 0 && files.every((f) => CSS_HTML.test(f)) && files.length === changed.length;
}

// A script run in the page that measures an element, or acts on it and reads the state after: not a goto and a snapshot alone, not the window's width alone,
// not a click whose result nobody read.
const ELEMENT = /getBoundingClientRect|getComputedStyle|\b(?:offset|client|scroll)(?:Width|Height)\b/;
const ACTS = /\.(?:click|dblclick|fill|press|selectOption|check|type)\(|mouse\.click/;
const READS = /evaluate|textContent|innerText|getAttribute|isVisible|isChecked|inputValue|\.count\(|getBoundingClientRect|getComputedStyle|snapshot\(/;
const measuresIn = (s) => ELEMENT.test(s) || (ACTS.test(s) && READS.test(s.slice(s.search(ACTS) + 1)));
const MEASURES = { test: (s) => measuresIn(String(s)) };
const PANEL_READS = new Set(['read_page', 'get_page_text', 'javascript_tool', 'find']);
// The program being run, at the start of a command or of a segment after ; & | ( or a line: never the words inside an echo or a grep.
const AT_START = String.raw`(?:^|[;&|(]\s*|\n)\s*(?:npx\s+|pnpm\s+exec\s+|yarn\s+|bunx\s+)?(?:\S*[\\/])?`;
// ego is run as the agent's shell lets it: bare or by an unquoted path, by a quoted absolute path ("C:/…/ego-browser.exe" nodejs), through a variable
// (the PATH lacks it, so a message hands the path: "$EGO" nodejs, ${EGO}, $env:EGO, & $exe nodejs) and after wrappers (timeout 60, nohup, env assignments).
// A variable counts only when `nodejs`, ego's own subcommand, is its first argument. Everything is a regex over the command: no process, no latency.
const EGO_PROGRAM = String.raw`(?:(?:\S*[\\/])?ego-browser(?:\.exe|\.cmd)?|(?<q>["'])(?:[^"'\n]*[\\/])?ego-browser(?:\.exe|\.cmd)?\k<q>|["']?\$(?:\{[\w:]+\}|(?:env:)?\w+)["']?)`;
const EGO_START = String.raw`(?:^|[;&|(]\s*|\n)\s*(?:(?:npx|pnpm\s+exec|yarn|bunx|nohup|time|timeout\s+\S+)\s+|[A-Za-z_]\w*=\S*\s+)*`;
export const RUNS_EGO = new RegExp(EGO_START + EGO_PROGRAM + String.raw`\s+nodejs\b`);
// `ego-browser skill`, ego's own manual: the program by name or path, or through a variable whose name says ego ("$EGO", ${EGO_BIN}); never any other variable
const EGO_NAMED = String.raw`(?:(?:\S*[\\/])?ego-browser(?:\.exe|\.cmd)?|(?<q>["'])(?:[^"'\n]*[\\/])?ego-browser(?:\.exe|\.cmd)?\k<q>|["']?\$(?:\{[\w:]*ego\w*\}|(?:env:)?\w*ego\w*)["']?)`;
const EGO_SKILL = new RegExp(EGO_START + EGO_NAMED + String.raw`\s+skill\b`, 'i');
// Does this tool call read ego's own skill? (the Skill tool, or `ego-browser skill` in a shell; the cheap word test first, the regex only for a command that has it)
export const readsEgoSkill = (t) => (t.name === 'Skill' && /(^|:)ego-browser$/.test(String(t.input?.skill || ''))) || (/^(Bash|PowerShell|shell)$/.test(t.name) && text(t).includes('skill') && EGO_SKILL.test(text(t)));
const RUNS_PLAYWRIGHT = new RegExp(AT_START + String.raw`playwright(?:\.cmd)?\s+(?:test|screenshot)\b`);
const PANEL = /^mcp__[\w-]*(?:browser|chrome)[\w-]*__(\w+)$/i;
const PANEL_ACTS = new Set(['form_input']);
const text = (t) => String(t.input?.command ?? '');

// ---- where the eyes may look (decision 1c): the local dev server, plus the design link the user wrote in the request, read only ----
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost|[\w.-]+\.test)$/i;
const URL_RE = /\b(?:https?:\/\/[^\s'"`)<>\]]+|file:\/\/\/?[^\s'"`)<>]+)/gi;
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
// The port a http(s) URL looks at ('' for a file or a bad URL).
const portOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.port || (x.protocol === 'https:' ? '443' : '80') : ''; } catch { return ''; } };
// → 'local' | 'design' | 'off' for one URL, given the hosts the user wrote in the request.
export function whereTo(url, allowed = []) {
  if (/^file:/i.test(url)) return 'local';
  const h = hostOf(url);
  if (!h) return 'off';
  return LOCAL_HOST.test(h) || LOCAL_HOST.test(`[${h}]`) ? 'local' : allowed.includes(h) ? 'design' : 'off';
}
// What the user's request carries for the eyes: the screenshots (image blocks) and the hosts of the links they wrote that are not local.
export function requestRefs(prompts) {
  let images = 0;
  const hosts = new Set();
  for (const d of prompts || []) {
    if (d?.type !== 'user' || d.isMeta) continue;
    const c = d.message?.content, parts = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    if (parts.some((p) => p.type === 'tool_result')) continue;
    for (const p of parts) {
      if (p.type === 'image') images++;
      if (p.type === 'text') for (const u of String(p.text).match(URL_RE) || []) { const h = hostOf(u); if (h && whereTo(u) !== 'local') hosts.add(h); }
    }
  }
  return { images, hosts: [...hosts] };
}
// ego's own reference (references/clearing-state.md): three commands empty the whole profile's cookies or cache and cannot be undone.
const PROFILE_WIPE = /Network\.clearBrowserCookies|Network\.clearBrowserCache|Storage\.clearCookies["'`]\s*(?:\)|,\s*\{(?![^}]*browserContextId))/;
const SITE_CLEAR = /Storage\.clearDataForOrigin|Network\.deleteCookies/;
const PASSWORD = /\.(?:fill|type|pressSequentially)\(\s*["'`][^"'`]*(?:password|passwd|contrase)/i;
// Why an eyes script must not run, or null: a profile-wide clear, a site clear or a navigation off the local host and the user's design link,
// a password typed. Waymark signs in nowhere and never clears the user's profile.
export function eyesRefusal(script, allowed = []) {
  const s = String(script || '');
  if (PROFILE_WIPE.test(s)) return 'it clears the cookies or the cache of the whole browser profile (every site the user is signed in to): never run it; clear one local origin with Storage.clearDataForOrigin if a test needs it';
  if (PASSWORD.test(s)) return 'it types into a password field: Waymark signs in nowhere; look at the app as the user, already signed in';
  const urls = s.match(URL_RE) || [];
  const off = urls.filter((u) => whereTo(u, allowed) === 'off');
  if (SITE_CLEAR.test(s) && urls.some((u) => whereTo(u, allowed) !== 'local')) return 'it clears a site that is not the local dev server';
  if (off.length) return `it opens ${hostOf(off[0]) || 'a host'}, which is neither the local dev server nor a design link the user wrote in the request`;
  return null;
}

// A script the shell wrote to a file with a heredoc (cat > f <<'EOF', tee f <<EOF) or a PowerShell here-string (@'…'@ | Set-Content f): the file ego is later asked to
// import (file:///…) is not in a Write call, so its measurements went uncounted. → [[file, body]].
const HEREDOC_FILE = /(?:\bcat\s*>>?|\btee(?:\s+-a)?)\s*(?<q>["']?)(?<file>[^\s"'<>|;&]+)\k<q>[ \t]*<<-?[ \t]*(?<k>["']?)(?<tag>[A-Za-z_]\w*)\k<k>[^\n]*\r?\n(?<body>[\s\S]*?)\r?\n[ \t]*\k<tag>[ \t]*(?:\r?\n|$)/g;
const HERE_PIPE = /@(?<k>['"])\r?\n(?<body>[\s\S]*?)\r?\n\k<k>@\s*\|\s*(?:Set-Content|Out-File|Add-Content)\s+(?:-(?:Path|FilePath|LiteralPath)\s+)?(?<q>["']?)(?<file>[^\s"']+)\k<q>/g;
const HERE_VALUE = /(?:Set-Content|Out-File|Add-Content)\s+(?:-(?:Path|FilePath|LiteralPath)\s+)?(?<q>["']?)(?<file>[^\s"']+)\k<q>\s+-Value\s+@(?<k>['"])\r?\n(?<body>[\s\S]*?)\r?\n\k<k>@/g;
export function shellScripts(command) {
  const c = String(command || '');
  return /<<|@['"]/.test(c) ? [HEREDOC_FILE, HERE_PIPE, HERE_VALUE].flatMap((re) => [...c.matchAll(re)].map((m) => [m.groups.file, m.groups.body])) : [];
}

// A written file's key: forward slashes, a Git Bash path (/c/…) as C:/…, lower case.
const fileKey = (file) => String(file).replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').toLowerCase();
const STDIN_FILE = /(?<![<\d&])<(?![<(&=])\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s|;&<>]+))/g; // ego-browser nodejs < file (never a heredoc <<, a process substitution <( or 2<)
const CAT_FILE = /\bcat\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^\s|;&<>]+))\s*\|/g; // cat file | ego-browser nodejs
const CD_DIR = /(?:^|[;&|(]\s*)cd\s+(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;&|]+))/;
// The ego-browser script behind a call: the command, the files it imports (a file given to `ego-browser nodejs -e` by a file:/// URL) written earlier in the turn, and the
// file handed to its stdin (`< file`, `cat file |`) as it stood at that call: a relative path is read from the folder the command went to (`cd dir && …`).
function scriptOf(t, writes, log = [], at = Infinity) {
  const cmd = text(t), files = [...cmd.matchAll(/file:\/\/\/?([^'"\s)]+)/g)].map((m) => decodeURI(m[1]).replace(/\\/g, '/').toLowerCase());
  const cd = CD_DIR.exec(cmd), dir = cd ? fileKey(cd[1] || cd[2] || cd[3]) : '';
  const stdin = [...cmd.matchAll(STDIN_FILE), ...cmd.matchAll(CAT_FILE)].map((m) => fileKey(m[1] || m[2] || m[3])).map((f) => {
    const abs = /^([a-z]:)?\//.test(f), rel = f.replace(/^\.\//, '');
    const key = abs ? f : /^([a-z]:)?\//.test(dir) ? `${dir.replace(/\/$/, '')}/${rel}` : null;
    const seen = log.filter((w) => w.i < at && (key ? w.key === key : w.key.endsWith(`/${rel}`)));
    if (!key && new Set(seen.map((w) => w.key)).size > 1) return ''; // a bare name two folders hold: which one the shell meant is not guessed
    return seen.length ? seen[seen.length - 1].body : '';
  });
  return cmd + '\n' + files.map((f) => writes.get(f) || [...writes].find(([k]) => k.endsWith(f) || f.endsWith(k))?.[1] || '').join('\n') + '\n' + stdin.join('\n');
}

// The dev server's own compile output, the second signal that the version served is the new one (docs/adr/0047): the server the agent started in the background and the
// output it read afterwards (its output tool, or the file it writes to). Only a read after the last change says what the server compiled from it; the last state in it wins.
// → { launched, compile: 'ok' | 'failed' | null }. 'failed': the newest line after the change reports an error (a page then shows the version before it).
const DEV_CMD = /\b(?:ng\s+serve|vite(?:\s+dev)?|next\s+dev|nuxt\s+dev|astro\s+dev|webpack(?:-dev-server|\s+serve)|react-scripts\s+start|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:start|dev|serve))\b/i;
const SERVER_OK = /Application bundle generation complete|[Cc]ompiled successfully|Compiled client and server|compiled in \d|\bready in \d|webpack compiled|No issues found|Compiled with warnings|Found 0 errors/;
const SERVER_BAD = /Failed to compile|\bERROR in\b|Build failed|\[ERROR\]|error TS\d+|Module not found|SyntaxError|Application bundle generation failed|Found [1-9]\d* errors?/;
export function devServerCompile(tools, outOf, from = -1) {
  const lastState = (out) => { // the newest state-bearing line wins
    let state = null;
    for (const line of String(out || '').split('\n')) { if (SERVER_BAD.test(line)) state = 'failed'; else if (SERVER_OK.test(line)) state = 'ok'; }
    return state;
  };
  let launched = false, compile = null;
  tools.forEach((t, i) => {
    const bg = /^(Bash|PowerShell|shell)$/.test(t.name) && t.input?.run_in_background && DEV_CMD.test(text(t));
    if (!bg) return;
    launched = true;
    const launch = String(outOf(t) || ''), id = launch.match(/\bID:\s*([\w-]+)/)?.[1], file = launch.match(/written to:?\s*(\S+)/i)?.[1];
    let mine = null; // this server's newest state; one server's error is not hidden by another's clean compile
    for (let j = Math.max(i, from) + 1; j < tools.length; j++) { // a read after the last change (or the launch, when the server started after it)
      const u = tools[j], said = `${u.input?.command || ''} ${u.input?.file_path || ''}`;
      if (!((id && (u.input?.bash_id === id || u.input?.task_id === id || u.input?.shell_id === id)) || (file && said.includes(file)))) continue;
      mine = lastState(outOf(u)) || mine;
    }
    if (from < i && !mine) mine = lastState(launch);
    if (mine && compile !== 'failed') compile = mine;
  });
  return { launched, compile };
}

// What the turn's tool calls show of the eyes. `from`: the index of the task's last change; only a call after it counts. `gateAt`: the index of the first project gate that passed after it
// (Infinity: none did): a look before it saw a version nobody had compiled, so it does not count (`beforeGate`). -1: no gate is required (it could not run here).
// → { provider, calls, measures, afterLastChange, beforeGate, references }. Nothing of the page is kept: no URL, no text.
// A look that landed on the local app's sign-in page: the ego space holds no session for it. The user signs in there (the agent never types credentials) and the task goes on.
// It is the address the call landed on, the first line of ego's output that is an address (a script may print its own lines before it): a link to /login inside a page's links, or a line of source naming it, is not a page without a session.
const LOGIN_PAGE = /^\s*https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/(?:login|signin|sign-in)(?![\w-])/i;
export const SIGN_IN_GAP = 'the ego space shows the app\'s sign-in page';
export function observeEyes(tools, { from = -1, gateAt = -1, isChange = null, provider = null, reply = '', allowed = [], skillSeen = false, outOf = () => '' } = {}) {
  const writes = new Map(), log = []; // log: every script write in the order of the calls, so a file rewritten under one name is read as it stood at each call
  const keep = (file, body, i) => { writes.set(fileKey(file), body); log.push({ i, key: fileKey(file), body }); }; // a Git Bash path (/c/…) is the file:///C:/… the import names
  tools.forEach((t, i) => {
    if (/^(Write|Edit)$/.test(t.name) && t.input?.file_path && typeof t.input.content === 'string') keep(t.input.file_path, t.input.content, i);
    else if (t.name === 'Edit' && t.input?.file_path && typeof t.input.old_string === 'string' && typeof t.input.new_string === 'string') { // an edit of a script written earlier: the body the next call reads
      const was = [...log].reverse().find((w) => w.key === fileKey(t.input.file_path));
      if (was) keep(t.input.file_path, t.input.replace_all ? was.body.split(t.input.old_string).join(t.input.new_string) : was.body.replace(t.input.old_string, () => t.input.new_string), i);
    } else if (/^(Bash|PowerShell|shell)$/.test(t.name)) for (const [file, body] of shellScripts(text(t))) keep(file, body, i);
  });
  let login = false, calls = 0, measures = 0, early = 0, used = null, offHost = 0, design = 0, panelAt = 'local', returns = 0, sinceChange = false;
  let skillRead = skillSeen, readFirst = null; // skillRead: the agent read ego's own skill (`ego-browser skill`), in this turn or earlier in the task (skillSeen); readFirst: whether it had by the first ego script
  const ports = new Set(); let panelUrl = ''; // the local ports a counted look measured (a number only, never a page)
  const captures = [], spaces = new Map(); // spaces: the ego task spaces by name, { opened: times a script took it, finished }
  const scripts = new Map(), scriptAt = (t, i) => { if (!scripts.has(i)) scripts.set(i, scriptOf(t, writes, log, i)); return scripts.get(i); }; // read once per call, not once per use
  tools.forEach((t, i) => {
    let kind = null, measuring = false, where = 'local';
    if (readsEgoSkill(t)) skillRead = true;
    const panel = PANEL.exec(t.name || '');
    if (panel) {
      kind = 'panel';
      const name = panel[1], input = t.input || {};
      if (input.url && /^(navigate|preview_start|tabs_create)$/.test(name)) { panelAt = whereTo(String(input.url), allowed); panelUrl = String(input.url); } // the page the next panel calls look at
      where = panelAt;
      const acted = PANEL_ACTS.has(name) || (name === 'computer' && /click|drag/.test(String(input.action || '')));
      const readAfter = () => tools.slice(i + 1).some((x) => PANEL_READS.has(PANEL.exec(x.name || '')?.[1]));
      measuring = (name === 'javascript_tool' && MEASURES.test(String(input.text || ''))) || (acted && readAfter()); // an act counts with the page read after it
    } else if (t.name === 'Bash' || t.name === 'PowerShell' || t.name === 'shell') {
      if (RUNS_EGO.test(text(t))) {
        kind = 'ego';
        const s = scriptAt(t, i), places = (s.match(URL_RE) || []).map((u) => whereTo(u, allowed));
        measuring = MEASURES.test(s);
        where = places.includes('off') ? 'off' : places.includes('local') || !places.length ? 'local' : 'design'; // a script that compares the design with the local build looks at the build
      } else if (RUNS_PLAYWRIGHT.test(text(t))) { kind = 'playwright'; measuring = true; where = (text(t).match(URL_RE) || []).some((u) => whereTo(u, allowed) === 'off') ? 'off' : 'local'; }
    }
    if (!kind) { if (isChange?.(t, i)) sinceChange = true; return; }
    if (kind === 'ego') { // one space per task: which one the script takes, whether it closes it, and a return to ego after the code changed
      const s = scriptAt(t, i), names = [...s.matchAll(/taskSpace\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
      for (const n of names) spaces.set(n, { opened: (spaces.get(n)?.opened || 0) + 1, finished: false });
      const last = names[names.length - 1] || [...spaces.keys()].pop();
      if (/\bfinish\s*\(/.test(s) && last && spaces.has(last)) spaces.get(last).finished = true;
      if (readFirst === null) readFirst = skillRead;
      if (sinceChange || !calls) returns++;
      sinceChange = false;
    }
    if (where === 'off') offHost++;
    if (where === 'design') design++;
    if (where !== 'local') measuring = false; // only the local build is the change; the design is a reference
    if (kind === 'ego') for (const m of scriptAt(t, i).matchAll(/screenshot\(\s*\{[^}]*?path:\s*["'`]([^"'`]+)["'`]/g)) { const p = slash(m[1]); if (p.toLowerCase().startsWith(slash(eyesRoot()).toLowerCase() + '/') && captures.length < 8 && !captures.includes(p)) captures.push(p); } // only what lands in Waymark's own folder
    calls++;
    if (kind === 'ego' && i > from) login = LOGIN_PAGE.test(String(outOf(t) || '').split('\n').find((l) => /^\s*https?:\/\//i.test(l)) || ''); // the newest look after the last change: the app's own sign-in page, so the space holds no session
    used = used || kind;
    if (measuring && i > from) {
      if (i > gateAt) measures++; else early++;
      for (const u of kind === 'panel' ? [panelUrl] : kind === 'ego' ? scriptAt(t, i).match(URL_RE) || [] : text(t).match(URL_RE) || []) { const p = whereTo(u, allowed) === 'local' ? portOf(u) : null; if (p) ports.add(p); }
    }
  });
  const verdicts = (String(reply).match(/:[ \t]*(?:igual|parecido|falta)\b[ \t]*(?:[—–.,(-]|$)/gim) || []).length; // "<element>: igual — <measurement>" (or after the word a dot, a comma, a parenthesis, the end of the line), never the word in prose
  // the server's own compile output after the last change: an error there means the page served is the version before it, so a look does not count
  const server = devServerCompile(tools, outOf, from), served = server.compile === 'failed';
  return { provider: used || provider, calls, ...(login ? { login: true } : {}), measures, afterLastChange: measures > 0 && !served && !login, ...(early ? { beforeGate: true } : {}), ...(server.launched ? { server: server.compile || 'unread' } : {}), references: verdicts, captures, offHost, design, ...(readFirst === null ? {} : { skillRead: readFirst }), ...(ports.size ? { ports: [...ports].slice(0, 6) } : {}), ...(spaces.size ? { spaces: [...spaces].map(([name, v]) => ({ name, ...v })), returns } : {}) };
}

// ---- the captures folder: ~/.waymark/eyes/<project>/<task>/, never in the repo, gone after seven days ----
export const eyesRoot = () => path.join(waymarkHome(), 'eyes');
export const EYES_DAYS = 7;
export const eyesDir = (project, task) => path.join(eyesRoot(), String(project || 'project'), String(task || 'task').replace(/\s*·\s*/g, '-').replace(/[^\w.-]+/g, '-'));
const taskFolders = () => {
  const out = [];
  try { for (const p of fs.readdirSync(eyesRoot())) { const pd = path.join(eyesRoot(), p); try { for (const t of fs.readdirSync(pd)) { const d = path.join(pd, t); if (fs.statSync(d).isDirectory()) out.push({ path: d, at: fs.statSync(d).mtimeMs }); } } catch {} } } catch {}
  return out;
};
// Removes the task folders older than a week; → the paths removed.
export function cleanEyes(now = Date.now()) {
  const gone = [];
  for (const f of taskFolders()) if (now - f.at > EYES_DAYS * 86400000) { try { fs.rmSync(f.path, { recursive: true, force: true }); gone.push(f.path); fs.rmdirSync(path.dirname(f.path)); } catch {} } // rmdir only succeeds on an empty project folder
  return gone;
}
// One line for `check`: what is kept and for how long; '' with none.
export function eyesLine(now = Date.now()) {
  const list = taskFolders();
  return list.length ? `eyes: ${list.length} capture folder${list.length > 1 ? 's' : ''} in ${slash(eyesRoot())} (kept ${EYES_DAYS} days; the session card removes the older ones)` : '';
}

// ---- the dev server the eyes look at: a row of Quality gates in memory.md, proposed from package.json and confirmed once ----
const PORTS = [[/@angular\/cli|@angular\/core/, 4200], [/\bnext\b|\bnuxt\b|react-scripts/, 3000], [/\bvite\b|@sveltejs|\bastro\b|solid-js/, 5173], [/vue-cli-service|@vue\/cli-service/, 8080]];
const UI_DEPS = /^(?:@angular\/core|react|react-dom|vue|svelte|@sveltejs\/kit|next|nuxt|astro|solid-js|lit|vite|react-scripts|http-server|live-server|serve|browser-sync)$/;
// → { command, port, url } for a project that has a screen and a start, dev or serve script; null otherwise (never invented).
export function devServer(root) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root || '', 'package.json'), 'utf8')); } catch { return null; }
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  if (!deps.some((d) => UI_DEPS.test(d))) return null;
  const script = ['dev', 'start', 'serve'].find((s) => pkg.scripts?.[s]);
  if (!script) return null;
  const body = String(pkg.scripts[script]), has = (f) => fs.existsSync(path.join(root, f));
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  const port = Number(body.match(/(?:--port[= ]|-p[= ]?)(\d{2,5})\b/)?.[1]) || PORTS.find(([re]) => deps.some((d) => re.test(d)))?.[1] || 8080;
  return { command: `${pm} run ${script}`, port, url: `http://localhost:${port}` };
}
const EYES_ROW = /^\|\s*eyes\s*\|\s*([^|]*)\|\s*([^|]*)\|/im;
// Writes the `eyes` row at the end of Quality gates when the repo has a screen and a start script and no row says so yet; never over one somebody wrote.
export function fillEyes(memoryFile, root) {
  let text = '';
  try { text = fs.readFileSync(memoryFile, 'utf8'); } catch { return null; }
  if (!text || EYES_ROW.test(text) || /^\|\s*dev server\s*\|/im.test(text)) return null;
  const s = devServer(root);
  if (!s) return null;
  const row = `| eyes | \`${s.command}\` · ${s.url} | to confirm: proposed from package.json; confirm once on the first seen change |`;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## Quality gates/.test(l));
  if (start < 0) return null;
  let last = -1;
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (lines[i].trim().startsWith('|')) last = i;
  if (last < 0) return null;
  lines.splice(last + 1, 0, row);
  fs.writeFileSync(memoryFile, lines.join('\n'));
  return row;
}

// The references the request carried and the Cierre did not answer (decision 1b): one line per element, "<element>: igual | parecido | falta — <measurement>".
export function referenceGaps(observed, refs) {
  const n = (refs?.images || 0) + (refs?.hosts?.length || 0);
  if (!n || observed?.references > 0) return [];
  return [`the request carried ${n} reference${n > 1 ? 's' : ''} (${[refs.images ? `${refs.images} screenshot${refs.images > 1 ? 's' : ''}` : '', refs.hosts?.length ? 'a design link' : ''].filter(Boolean).join(' and ')}) and the Cierre answers none: one line per element asked or visible in them, "<element>: igual | parecido | falta — <measurement>"; or write Ojos: no (<why>)`];
}

// The block: what the eyes still owe.
// `captures`: the task's folder for screenshots (eyesDir), named so they land under the Waymark home and go after a week, never in the repo.
export function eyesGaps(observed, provider, captures = null, env = process.env) {
  if (observed?.afterLastChange) return [];
  const where = captures ? `; captures in ${slash(captures)}` : '';
  const ego = egoCommand(env);
  const how = provider === 'ego' ? `${ego} nodejs (read \`${ego} skill\` first; one space for the whole task, resumed and not opened anew, closed with finish only when the task is complete): the dev server on localhost, the viewport the task claims (Emulation.setDeviceMetricsOverride), a measurement of the element (getBoundingClientRect, getComputedStyle) or a real click with the state after it`
    : provider === 'playwright' ? 'the project\'s Playwright against the local dev server: a measurement of the element or a real click with the state after it'
      : 'the browser panel against the local dev server: a script that measures the element, or a real click with the state after it';
  if (observed?.login) return [SIGN_IN_GAP + ' (no session in it): this is not a gap you can close and not a Cierre yet. Ask it in the choice window ("Ya inicié sesión" / "Aún no"), wait for the answer with no Cierre, and when they answer go back to the same space and measure what you built'];
  const gate = (observed?.beforeGate ? 'a look made before the gate passed since your last change does not count; ' : '') + (observed?.server === 'failed' ? 'the dev server you started printed a compile error after your last change, so the page it serves is the version before it: fix that error and read its output again; ' : '');
  return [`the task changed something seen and no browser measured or clicked it after the last change (a build or a spec does not see the screen): ${gate}run the project's typecheck or build first and read its result (and the dev server's own compile output where the project has one: it shows the version being served is the new one), and if it fails the change cannot be seen until it is fixed: fix it first and do not open the browser to find the error. Then ${how}${where}; or write Ojos: no (<why the screen cannot be checked>)`];
}
