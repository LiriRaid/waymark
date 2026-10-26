// Waymark · the eyes (docs/adr/0047): what a task that changed something seen owes the screen. A build or a spec says the code compiles; only a browser
// that measured or clicked what was built says how it looks and behaves. The provider is what the machine has: ego-browser first, Playwright where the
// project declares it, else the agent's own browser panel. Read from the transcript's tool calls, never from words: a call counts when it measures (the
// computed size or style of an element, a script run in the page) or clicks (with the state after it), after the task's last change.
import fs from 'node:fs';
import path from 'node:path';

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

// A script run in the page that measures or clicks: not a goto and a snapshot alone.
const MEASURES = /getBoundingClientRect|getComputedStyle|\b(?:offset|client|scroll)(?:Width|Height)\b|\binnerWidth\b|\.evaluate\(|\.(?:click|dblclick|fill|press|selectOption)\(|mouse\.click/;
const PANEL = /^mcp__[\w-]*(?:browser|chrome)[\w-]*__(\w+)$/i;
const PANEL_ACTS = new Set(['form_input']);
const text = (t) => String(t.input?.command ?? '');

// The ego-browser script behind a call: the command, and the files it imports (a file given to `ego-browser nodejs -e` by a file:/// URL) written earlier in the turn.
function scriptOf(t, writes) {
  const cmd = text(t), files = [...cmd.matchAll(/file:\/\/\/?([^'"\s)]+)/g)].map((m) => decodeURI(m[1]).replace(/\\/g, '/').toLowerCase());
  return cmd + '\n' + files.map((f) => writes.get(f) || [...writes].find(([k]) => k.endsWith(f) || f.endsWith(k))?.[1] || '').join('\n');
}

// What the turn's tool calls show of the eyes. `from`: the index of the task's last change; only a call after it counts.
// → { provider, calls, measures, afterLastChange, references }. Nothing of the page is kept: no URL, no text.
export function observeEyes(tools, { from = -1, provider = null, reply = '' } = {}) {
  const writes = new Map();
  for (const t of tools) if (/^(Write|Edit)$/.test(t.name) && t.input?.file_path && typeof t.input.content === 'string') writes.set(String(t.input.file_path).replace(/\\/g, '/').toLowerCase(), t.input.content);
  let calls = 0, measures = 0, used = null;
  tools.forEach((t, i) => {
    let kind = null, measuring = false;
    const panel = PANEL.exec(t.name || '');
    if (panel) {
      kind = 'panel';
      const name = panel[1], input = t.input || {};
      measuring = (name === 'javascript_tool' && MEASURES.test(String(input.text || ''))) || PANEL_ACTS.has(name) || (name === 'computer' && /click|drag/.test(String(input.action || '')));
    } else if (t.name === 'Bash' || t.name === 'PowerShell' || t.name === 'shell') {
      if (/\bego-browser\s+nodejs\b/.test(text(t))) { kind = 'ego'; measuring = MEASURES.test(scriptOf(t, writes)); }
      else if (/\b(?:npx|pnpm exec|yarn|bunx)\s+playwright\s+test\b|\bplaywright\s+test\b/.test(text(t))) { kind = 'playwright'; measuring = true; }
    }
    if (!kind) return;
    calls++;
    used = used || kind;
    if (measuring && i > from) measures++;
  });
  const verdicts = (String(reply).match(/\b(?:igual|parecido|falta)\b/gi) || []).length;
  return { provider: used || provider, calls, measures, afterLastChange: measures > 0, references: verdicts };
}

// The block: what the eyes still owe.
export function eyesGaps(observed, provider) {
  if (observed?.afterLastChange) return [];
  const how = provider === 'ego' ? 'ego-browser nodejs (read `ego-browser skill` first): the dev server on localhost, the viewport the task claims (Emulation.setDeviceMetricsOverride), a measurement of the element (getBoundingClientRect, getComputedStyle) or a real click with the state after it'
    : provider === 'playwright' ? 'the project\'s Playwright against the local dev server: a measurement of the element or a real click with the state after it'
      : 'the browser panel against the local dev server: a script that measures the element, or a real click with the state after it';
  return [`the task changed something seen and no browser measured or clicked it after the last change (a build or a spec does not see the screen): ${how}; or write Ojos: no (<why the screen cannot be checked>)`];
}
