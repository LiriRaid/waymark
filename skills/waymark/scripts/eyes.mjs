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

// → 'ego' | 'playwright' | null: ego on PATH (or where its installer puts it), else a Playwright the project declares.
export function eyesProvider({ root, env = process.env } = {}) {
  const home = env.HOME || env.USERPROFILE || '';
  if (onPath(EGO, env) || (home && EXE.some((x) => fs.existsSync(path.join(home, '.local', 'share', 'ego', 'active_version_dir', EGO + x))))) return 'ego';
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
export const RUNS_EGO = new RegExp(AT_START + String.raw`ego-browser(?:\.exe|\.cmd)?\s+nodejs\b`);
const RUNS_PLAYWRIGHT = new RegExp(AT_START + String.raw`playwright(?:\.cmd)?\s+(?:test|screenshot)\b`);
const PANEL = /^mcp__[\w-]*(?:browser|chrome)[\w-]*__(\w+)$/i;
const PANEL_ACTS = new Set(['form_input']);
const text = (t) => String(t.input?.command ?? '');

// ---- where the eyes may look (decision 1c): the local dev server, plus the design link the user wrote in the request, read only ----
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost|[\w.-]+\.test)$/i;
const URL_RE = /\b(?:https?:\/\/[^\s'"`)<>\]]+|file:\/\/\/?[^\s'"`)<>]+)/gi;
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
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

// The ego-browser script behind a call: the command, and the files it imports (a file given to `ego-browser nodejs -e` by a file:/// URL) written earlier in the turn.
function scriptOf(t, writes) {
  const cmd = text(t), files = [...cmd.matchAll(/file:\/\/\/?([^'"\s)]+)/g)].map((m) => decodeURI(m[1]).replace(/\\/g, '/').toLowerCase());
  return cmd + '\n' + files.map((f) => writes.get(f) || [...writes].find(([k]) => k.endsWith(f) || f.endsWith(k))?.[1] || '').join('\n');
}

// What the turn's tool calls show of the eyes. `from`: the index of the task's last change; only a call after it counts.
// → { provider, calls, measures, afterLastChange, references }. Nothing of the page is kept: no URL, no text.
export function observeEyes(tools, { from = -1, provider = null, reply = '', allowed = [] } = {}) {
  const writes = new Map();
  for (const t of tools) if (/^(Write|Edit)$/.test(t.name) && t.input?.file_path && typeof t.input.content === 'string') writes.set(String(t.input.file_path).replace(/\\/g, '/').toLowerCase(), t.input.content);
  let calls = 0, measures = 0, used = null, offHost = 0, design = 0, panelAt = 'local';
  const captures = [];
  tools.forEach((t, i) => {
    let kind = null, measuring = false, where = 'local';
    const panel = PANEL.exec(t.name || '');
    if (panel) {
      kind = 'panel';
      const name = panel[1], input = t.input || {};
      if (input.url && /^(navigate|preview_start|tabs_create)$/.test(name)) panelAt = whereTo(String(input.url), allowed); // the page the next panel calls look at
      where = panelAt;
      const acted = PANEL_ACTS.has(name) || (name === 'computer' && /click|drag/.test(String(input.action || '')));
      const readAfter = () => tools.slice(i + 1).some((x) => PANEL_READS.has(PANEL.exec(x.name || '')?.[1]));
      measuring = (name === 'javascript_tool' && MEASURES.test(String(input.text || ''))) || (acted && readAfter()); // an act counts with the page read after it
    } else if (t.name === 'Bash' || t.name === 'PowerShell' || t.name === 'shell') {
      if (RUNS_EGO.test(text(t))) {
        kind = 'ego';
        const s = scriptOf(t, writes), places = (s.match(URL_RE) || []).map((u) => whereTo(u, allowed));
        measuring = MEASURES.test(s);
        where = places.includes('off') ? 'off' : places.includes('local') || !places.length ? 'local' : 'design'; // a script that compares the design with the local build looks at the build
      } else if (RUNS_PLAYWRIGHT.test(text(t))) { kind = 'playwright'; measuring = true; where = (text(t).match(URL_RE) || []).some((u) => whereTo(u, allowed) === 'off') ? 'off' : 'local'; }
    }
    if (!kind) return;
    if (where === 'off') offHost++;
    if (where === 'design') design++;
    if (where !== 'local') measuring = false; // only the local build is the change; the design is a reference
    if (kind === 'ego') for (const m of scriptOf(t, writes).matchAll(/screenshot\(\s*\{[^}]*?path:\s*["'`]([^"'`]+)["'`]/g)) { const p = slash(m[1]); if (p.toLowerCase().startsWith(slash(eyesRoot()).toLowerCase() + '/') && captures.length < 8 && !captures.includes(p)) captures.push(p); } // only what lands in Waymark's own folder
    calls++;
    used = used || kind;
    if (measuring && i > from) measures++;
  });
  const verdicts = (String(reply).match(/:\s*(?:igual|parecido|falta)\b\s*[—–-]/gi) || []).length; // "<element>: igual — <measurement>", never the word in prose
  return { provider: used || provider, calls, measures, afterLastChange: measures > 0, references: verdicts, captures, offHost, design };
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
export function eyesGaps(observed, provider, captures = null) {
  if (observed?.afterLastChange) return [];
  const where = captures ? `; captures in ${slash(captures)}` : '';
  const how = provider === 'ego' ? 'ego-browser nodejs (read `ego-browser skill` first): the dev server on localhost, the viewport the task claims (Emulation.setDeviceMetricsOverride), a measurement of the element (getBoundingClientRect, getComputedStyle) or a real click with the state after it'
    : provider === 'playwright' ? 'the project\'s Playwright against the local dev server: a measurement of the element or a real click with the state after it'
      : 'the browser panel against the local dev server: a script that measures the element, or a real click with the state after it';
  return [`the task changed something seen and no browser measured or clicked it after the last change (a build or a spec does not see the screen): ${how}${where}; or write Ojos: no (<why the screen cannot be checked>)`];
}
