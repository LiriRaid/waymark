// Waymark 2.0.15 · what a shell command runs: the chain split outside quotes and heredoc bodies, each part classified
// (gate, build, test) by its executable, and whether it changes project files. Moved out of provenance.mjs, which
// re-exports it; the stop hook, the tool hook and learn.mjs read commands only through here.
import path from 'node:path';

// Shell commands that change files in place (the decision gate treats them like edits). Redirects count unless they go
// to /dev/null, $null, NUL or a temp/scratch folder.
// Temp/scratch locations: a whole path segment, so project paths such as src/templates/ are not mistaken for temp.
const TEMP = /(^|[\s"'=\\/])(tmp|temp|scratchpad)[\\/]|AppData[\\/]Local[\\/]Temp|\$\{?TMP|\$\{?TEMP|%TEMP%|\$T\b|mktemp/i;
const MUTATING = /(?:^|[;&|(]\s*)(?:git\s+(?:checkout\s+(?:\S+\s+)*--(?:\s|$)|(?:restore|reset\s+--hard|apply|rm|mv|clean)\b)|sed\s+(?:-\w+\s+)*-i|perl\s+(?:-\w+\s+)*-\w*i\w*(?:\s|$)|rm\s|mv\s|cp\s|tee\s|(?:Set|Add)-Content|Out-File|(?:Remove|Move|Copy|New)-Item)/i;
// The command with the text inside quotes, heredoc bodies and PowerShell here-strings blanked (same length, so an index
// in it is an index in the command): a ">" there is code or text, not a redirect (`node -e "…x=>{…}"`).
// quotes: false keeps the quoted text — `bash -c "npm test"` still runs a test — and blanks only the bodies (a spec
// written through `cat > x.spec.ts <<'EOF'` is not a test run).
export function shellSkeleton(command, { quotes = true } = {}) {
  const c = String(command || ''), out = c.split('');
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '; };
  for (const m of c.matchAll(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g)) blank(m.index + 2, m.index + m[0].length - 2);
  for (const m of c.matchAll(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n/g)) {
    const start = m.index + m[0].length, end = c.slice(start).search(new RegExp(`^[ \\t]*${m[2]}[ \\t]*$`, 'm'));
    blank(start, end < 0 ? c.length : start + end);
  }
  let quote = '';
  for (let i = 0; quotes && i < c.length; i++) {
    if (out[i] === ' ' && c[i] !== ' ') continue; // already blanked
    if (quote) { if (c[i] === '\\' && quote === '"') { out[i] = ' '; if (i + 1 < c.length) out[++i] = ' '; } else if (c[i] === quote) quote = ''; else if (c[i] !== '\n') out[i] = ' '; }
    else if (c[i] === '"' || c[i] === "'") quote = c[i];
  }
  return out.join('');
}

// A script an interpreter runs from a heredoc or -e/-c (python - <<'EOF', node -e "…") that writes, moves or deletes files: the agent edits through
// Python or Node as often as through Edit, and neither the memory pack nor the decision gate saw it. Writing to a temp/scratch place is no change.
const INTERPRETER = /(?:^|[;&|(\s])(?:python3?|py|node|deno|ruby|perl|php)(?:\.exe)?\s+(?:-[A-Za-z]*\s+)*(?:-\s*)?(?:<<|-[ecr]\b|--eval\b|-p\b)/;
const FILE_WRITES = /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|rmSync|unlinkSync|renameSync|copyFileSync)\s*\(|\.write_text\s*\(|\.write_bytes\s*\(|\bopen\s*\([^)]*,\s*['"][^'"]*[wa+][^'"]*['"]|\bshutil\.(?:copy|copyfile|move|rmtree)\s*\(|\bos\.(?:remove|rename|unlink)\s*\(|\bFile\.(?:write|rename|delete)\s*\(|\bfile_put_contents\s*\(/;
export const scriptWrites = (command) => INTERPRETER.test(String(command || '')) && FILE_WRITES.test(String(command || '')) && !TEMP.test(String(command || ''));
// The files such a script names to write: a quoted path in front of the call (open('a.ts', 'w'), writeFileSync('a.ts', …), Path('a.ts').write_text).
export function scriptWriteTargets(command) {
  const c = String(command || '');
  if (!scriptWrites(c)) return [];
  const out = [];
  for (const re of [/\b(?:writeFileSync|appendFileSync|writeFile|appendFile|rmSync|unlinkSync|renameSync|copyFileSync)\s*\(\s*(['"`])([^'"`\n]+)\1/g, /\bopen\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*['"][^'"]*[wa+]/g, /\bPath\s*\(\s*(['"])([^'"\n]+)\1\s*\)\s*\.write_(?:text|bytes)/g]) {
    for (const m of c.matchAll(re)) out.push(m[2]);
  }
  return [...new Set(out)];
}

export function mutatesFiles(command) {
  const c = String(command || '');
  if (MUTATING.test(c) || scriptWrites(c)) return true;
  const skeleton = shellSkeleton(c);
  for (const m of skeleton.matchAll(/(?<![0-9&>=-])>{1,2}/g)) { // a redirect outside quotes; its target read from the command
    const t = c.slice(m.index + m[0].length).match(/^\s*(?:"([^"]*)"|'([^']*)'|([^\s"'&|;]+))/), target = t && (t[1] ?? t[2] ?? t[3]);
    if (target && !/^(\/dev\/null|\$null|nul|&\d)$/i.test(target) && !TEMP.test(target)) return true;
  }
  return false;
}
// What a shell command runs, part by part (the chain split outside quotes and heredoc bodies): each part is judged by
// its executable, never by a word in its arguments, so `git commit -m "fix build"` and `ls build` check nothing.
// Env assignments, `time`, the call operator and runners (npx, pnpm exec, bundle exec, python -m…) are skipped;
// `bash -c "<cmd>"`, `cmd /c <cmd>` and `pwsh -Command "<cmd>"` are judged inside. → [{ text, gate, build, test, sep, cd }]
// sep: the separator after the part ('&&', '||', ';', '|', '\n' or '' at the end); cd: the folder a `cd` before it
// entered in the same command (null: the session's).
const TOKEN = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
const tokens = (s) => [...String(s).matchAll(TOKEN)].map((m) => m[1] ?? m[2] ?? m[3]);
const RUNNER = { npx: 1, pnpx: 1, bunx: 1, time: 1, call: 1, '&': 1, exec: 1, env: 1 };
const RUNNER2 = /^(pnpm (exec|dlx)|yarn (exec|dlx)|bundle exec|poetry run|uv run|pipenv run|python3? -m|py -m|npm exec)$/;
const LINTERS = /^(tsc|vue-tsc|svelte-check|eslint|biome|oxlint|stylelint|mypy|ruff|rubocop|pyright|flake8|pylint|golangci-lint|gofmt|phpstan|pint|phpcs|php-cs-fixer|tflint|typecheck)$/;
const TESTERS = /^(vitest|jest|karma|mocha|pytest|rspec|phpunit|pest|ava|tap|playwright|cypress|nyc|c8)$/;
const SCRIPT_TEST = /(^|[:_-])(test|tests|spec|e2e|unit|vitest|jest)([:_-]|$)/i;
const SCRIPT_BUILD = /(^|[:_-])build([:_-]|$)/i;
const SCRIPT_GATE = /(typecheck|type-check|tsc|lint|check|types)/i;
function classify(words) {
  let w = words.filter((x) => x !== '');
  for (let guard = 0; guard < 4 && w.length; guard++) {
    while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w = w.slice(1); // FOO=1 cmd, env FOO=1 cmd
    const head = String(w[0] || '').toLowerCase();
    if (RUNNER[head]) { w = w.slice(1); while (w.length && /^-/.test(w[0])) w = w.slice(/^(-p|--package)$/.test(w[0]) ? 2 : 1); continue; }
    // wrappers that run what follows them: `timeout 600 pnpm run build`, `nice -n 10 vitest`, `nohup`, `stdbuf -oL`, `ionice`; their flags and a timeout's duration are no part of the command
    if (head === 'timeout') { w = w.slice(1); while (w.length && /^-/.test(w[0])) w = w.slice(/^(-k|-s|--kill-after|--signal)$/.test(w[0]) ? 2 : 1); if (/^\d+(\.\d+)?[smhd]?$/.test(String(w[0] || ''))) w = w.slice(1); continue; }
    if (/^(nice|nohup|stdbuf|ionice|command)$/.test(head)) {
      if (head === 'command' && /^-[vV]$/.test(String(w[1] || ''))) return { gate: false, build: false, test: false }; // `command -v tsc` looks a program up, it runs nothing
      w = w.slice(1);
      while (w.length && /^-/.test(w[0])) w = w.slice(/^(-n|--adjustment|-c|-p)$/.test(w[0]) ? 2 : 1);
      continue;
    }
    if (RUNNER2.test(`${head} ${String(w[1] || '').toLowerCase()}`)) { w = w.slice(2); continue; }
    break;
  }
  const prog = path.basename(String(w[0] || '').replace(/\\/g, '/')).toLowerCase().replace(/\.(cmd|exe|ps1|bat)$/, '');
  let a = w.slice(1), dir = null;
  // a package manager's own flags before its command: pnpm --filter web build, npm --prefix ../api run build (a folder
  // flag is where the command runs)
  if (/^(npm|pnpm|yarn|bun)$/.test(prog)) {
    while (a.length && /^-/.test(a[0])) {
      const flag = String(a[0]).toLowerCase(), takes = /^(-c|--dir|--prefix|--cwd|-w|--workspace|-f|--filter)$/.test(flag);
      if (/^(-c|--dir|--prefix|--cwd)$/.test(flag) && a[1]) dir = a[1];
      a = a.slice(takes ? 2 : 1);
    }
    if (prog === 'yarn' && /^workspace$/i.test(a[0] || '')) a = a.slice(2);
  }
  const sub = String(a[0] || '').toLowerCase(), subs = a.map((x) => String(x).toLowerCase());
  const out = { gate: false, build: false, test: false, ...(dir ? { dir } : {}) };
  // a build script run by its interpreter or by path: node build.mjs, bash scripts/build.sh, ./build.ps1
  const script = /^(node|bash|sh|zsh|pwsh|powershell|python3?|py|deno)$/.test(prog) ? subs.find((x) => !x.startsWith('-')) : String(w[0] || '').toLowerCase();
  if (script && /^build(\.[a-z0-9]+)?$/.test(path.basename(script.replace(/\\/g, '/')))) { out.gate = out.build = true; return out; }
  if (/^(bash|sh|zsh|dash)$/.test(prog) && sub === '-c') return { inner: a[1] };
  if (prog === 'cmd' && /^\/[ck]$/.test(sub)) return { inner: a.slice(1).join(' ') };
  if (/^(pwsh|powershell)$/.test(prog)) { const i = subs.findIndex((x) => /^-(c|command)$/.test(x)); if (i >= 0) return { inner: a.slice(i + 1).join(' ') }; }
  if (LINTERS.test(prog)) { out.gate = true; out.build = prog === 'tsc' && subs.includes('-b'); }
  else if (TESTERS.test(prog)) out.test = true;
  else if (/^(npm|pnpm|yarn|bun)$/.test(prog)) {
    const script = /^(run|run-script)$/.test(sub) ? String(a[1] || '') : sub;
    if (/^(t|test|tst)$/.test(sub) || SCRIPT_TEST.test(script)) out.test = true;
    else if (!/^(install|i|ci|add|remove|uninstall|update|init|create|publish|pack|link|exec|dlx|x|outdated|audit|view|info|config|cache|why|ls|list)$/.test(sub)) {
      out.build = SCRIPT_BUILD.test(script);
      out.gate = out.build || SCRIPT_GATE.test(script);
    }
  } else if (prog === 'node' || prog === 'deno') {
    if (subs.includes('--check') || /^(check|lint)$/.test(sub)) out.gate = true;
    else if (subs.includes('--test') || sub === 'test') out.test = true;
  } else if (/^(ng|nest|react-scripts|vue-cli-service|turbo|nx|vite|next|nuxt|astro|go|cargo|dotnet|mvn|mvnw|gradle|gradlew|make|cmake|ctest|rails|rake|artisan|php|terraform|tofu|composer|flutter|dart|mix|swift)$/.test(prog)) {
    // The verb is the first word that is no flag: `mvn -q test`, `cargo +nightly test`, `dotnet --nologo build`, `make -j8 test`, `terraform -chdir=x validate`
    // (docs/adr/0039: the reference bench found `mvn -q test` taken for no test at all). The value of make's -C and -f is no verb.
    const bare = subs.filter((x, i) => !/^[-+]/.test(x) && !(prog === 'make' && /^-[cfi]$/.test(subs[i - 1] || '')));
    // the monorepo task runners name the task after `run` (turbo run build), as `app:build` (nx run app:build) or with -t/--target (nx run-many -t build)
    const task = (x) => String(x || '').split(':').pop();
    const targetAt = subs.findIndex((x) => /^(-t|--target|--targets)(=|$)/.test(x)), targetOf = targetAt < 0 ? '' : subs[targetAt].includes('=') ? subs[targetAt].split('=')[1] : subs[targetAt + 1];
    const verb = prog === 'php' ? String(a[1] || '').toLowerCase() : prog === 'turbo' ? (bare[0] === 'run' ? bare[1] : bare[0]) || ''
      : prog === 'nx' ? (bare[0] === 'run' ? task(bare[1]) : /^(run-many|affected)$/.test(bare[0] || '') ? task(targetOf) : bare[0]) || ''
      : /^(php|ng|nest|react-scripts|vue-cli-service|vite|next|nuxt|astro|ctest|rails|rake|artisan|cmake)$/.test(prog) ? sub : bare[0] || '';
    if (/^(test|spec)$/.test(verb) || (/^(react-scripts|vue-cli-service|nx|turbo)$/.test(prog) && /^test:/.test(verb)) || prog === 'ctest' || (/^(gradle|gradlew)$/.test(prog) && /^test/i.test(verb))) out.test = true;
    else if (/^(build|package|verify)$/.test(verb) || (/^(gradle|gradlew)$/.test(prog) && /^assemble/i.test(verb)) || (prog === 'cmake' && subs.includes('--build')) || (prog === 'make' && (!verb || /^(all|build)$/.test(verb)))) out.gate = out.build = true;
    else if (/^(lint|vet|check|clippy|compile|analy[sz]e)$/.test(verb) || (/^(gradle|gradlew)$/.test(prog) && /^(lint|compile)/i.test(verb))) out.gate = true;
    // formatting only in check mode (plain format rewrites files): dotnet format --verify-no-changes, mix format --check-formatted
    else if (verb === 'format' && /^(dotnet|mix)$/.test(prog) && (subs.includes('--verify-no-changes') || subs.includes('--check-formatted'))) out.gate = true;
    // Terraform and Composer: validate is a gate, fmt only in check mode (plain fmt rewrites files), static analysis too
    else if (/^(terraform|tofu|composer)$/.test(prog) && (verb === 'validate' || (verb === 'fmt' && subs.includes('-check')) || /^(analy[sz]e|stan|lint)$/.test(verb))) out.gate = true;
  }
  return out;
}
export function shellRuns(command, depth = 0) {
  const c = String(command || ''), full = shellSkeleton(c, { quotes: false }), mask = shellSkeleton(c);
  const out = [];
  let from = 0, cd = null;
  const push = (to, sep) => {
    const at = from; // where this part starts in the command (a heredoc body is blanked, so the next part starts after it)
    const text = full.slice(from, to).trim().replace(/^[({]\s*/, '').replace(/\s*[)}]$/, ''); // a subshell or group: (cd x && npm test)
    from = to + sep.length;
    if (!text) return;
    const words = tokens(text), dir = /^(cd|pushd|push-location|set-location|sl|chdir)$/i.test(words[0] || '') ? words.slice(1).find((x) => !/^(\/d|-path)$/i.test(x)) : null;
    const back = /^(pop-location|popd)$/i.test(words[0] || '') || (/^cd$/i.test(words[0] || '') && words[1] === '-'); // the folder before the last push
    if (back) { cd = null; out.push({ text, gate: false, build: false, test: false, sep, cd: null, at }); return; }
    if (dir) { cd = dir; out.push({ text, gate: false, build: false, test: false, sep, cd: null, at }); return; }
    const k = classify(words), where = k.dir ? (cd ? `${cd}/${k.dir}` : k.dir) : cd;
    if (k.inner !== undefined && depth < 2) {
      const inner = shellRuns(k.inner, depth + 1);
      out.push({ text, gate: inner.some((p) => p.gate), build: inner.some((p) => p.build), test: inner.some((p) => p.test), sep, cd, at });
      return;
    }
    out.push({ text, gate: !!k.gate, build: !!k.build, test: !!k.test, sep, cd: where, at });
  };
  for (const m of mask.matchAll(/&&|\|\||[;|\n]/g)) push(m.index, m[0]);
  push(full.length, '');
  return out;
}

// A shell command that changes project files: mutating, and not only about temp/scratch or Waymark's own memory.
export const changesProject = (command) => mutatesFiles(command) && !TEMP.test(String(command || '')) && !/(\.waymark[\\/]|\.claude[\\/]projects)/i.test(String(command || ''));

// The clean copies (git worktree) a task made: the path each `git worktree add` names (its first word after the flags, or
// the value of the variable it names, assigned in the same command). A run there shows a failure is not the task's, or a
// spec red first; it is never the task's gate.
export const slash = (s) => String(s).replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();
const WORKTREE_ADD = /git\s+worktree\s+add/;
export function copyPath(cmd) {
  const words = (cmd.match(/git\s+worktree\s+add\s+(.*)/)?.[1] || '').split(/\s+/);
  let target = null;
  for (let i = 0; i < words.length && !target; i++) { if (/^-[bB]$/.test(words[i])) i++; else if (!words[i].startsWith('-')) target = words[i]; }
  target = String(target || '').replace(/^["']|["']$/g, '');
  const name = target.match(/^\$\{?(\w+)\}?$/)?.[1];
  if (name) target = cmd.match(new RegExp(`\\$?${name}\\s*=\\s*["']?([^"';&|\\s]+)`))?.[1] || '';
  return /^(?:[A-Za-z]:[\\/]|\/)/.test(target) ? slash(target) : null;
}
export const copyPaths = (commands) => [...new Set(commands.filter((c) => WORKTREE_ADD.test(c)).map(copyPath).filter((p) => p && p.length >= 8))];
// The command adds a clean copy or runs in one of `copies` (a later call naming its path, another shell, its own variable).
// Waymark's own copy root (~/.waymark/tmp, made by `waymark.mjs copy`) and its command count as a clean copy too, with no path to track.
const OWN_COPY = /waymark\.mjs["']?\s+copy(?:\s|$)|[\\/]\.waymark[\\/]tmp[\\/]/;
export const inCopy = (command, copies = []) => WORKTREE_ADD.test(command) || OWN_COPY.test(command) || copies.some((p) => slash(command).includes(p));
// Where one run executes, read from the `cd` / Push-Location before it in the same command; a variable there is resolved
// from its assignment in the command. 'temp': a scratch or temp folder (a clean copy or a helper, never the project);
// 'unknown': a variable nothing in the command assigns, so the hook cannot tell where it ran; null: the session's folder
// or a plain path.
// A scratch place for a folder: an absolute temp path, the system temp variables or the `$T` convention. A relative
// `temp/` or a variable such as $TEMPLATE_DIR is the project's.
const tempPlace = (p) => /^["']?\$T(?![\w])|^["']?\$\{?(?:env:)?(?:TEMP|TMP|TMPDIR)\}?(?![\w])|^%TEMP%|AppData[\\/]Local[\\/]Temp|^["']?(?:[A-Za-z]:)?[\\/](?:tmp|temp|var[\\/]folders)[\\/]|[\\/]scratchpad[\\/]/i.test(String(p).trim());
const assigned = (command, name) => command.match(new RegExp(`(?:^|[\\s;&(])\\$?${name}\\s*=\\s*["']?([^"';&|\\n]+)`))?.[1];
export function runPlace(command, run) {
  const cd = String(run.cd || '').replace(/^["']|["']$/g, '');
  if (!cd) return null;
  if (tempPlace(cd)) return 'temp';
  const name = cd.match(/^\$\{?(\w+)\}?(?:[\\/].*)?$/)?.[1];
  if (!name) return null;
  const value = assigned(command, name);
  if (!value) return 'unknown';
  return tempPlace(value) ? 'temp' : null;
}

// The kind of a whole command, the one question every testigo asks about a run: 'copy' (in a clean copy or a temp folder:
// never the task's gate), 'unknown' (a gate or test run whose folder the hook cannot tell: recorded, never held against
// the task), 'build', 'gate', 'test' (the strongest part of the chain), or 'aux' (anything else it runs).
export function commandKind(command, copies = []) {
  const c = String(command || '');
  if (inCopy(c, copies)) return 'copy';
  const runs = shellRuns(c), checks = runs.filter((p) => p.gate || p.build || p.test);
  const places = checks.map((p) => runPlace(c, p));
  if (checks.length && places.every(Boolean)) return places.includes('unknown') ? 'unknown' : 'copy';
  return runs.some((p) => p.build) ? 'build' : runs.some((p) => p.gate) ? 'gate' : runs.some((p) => p.test) ? 'test' : 'aux';
}
// A run that is not the task's to answer for: in a clean copy or temp folder, or from a place the hook cannot tell.
export const apart = (command, copies = []) => ['copy', 'unknown'].includes(commandKind(command, copies));

// A command that changes files and then runs a check (`python - <<'EOF' … EOF && pnpm exec tsc`, `sed -i … && (tsc; build)`) holds two events in order:
// the change, then the check that follows it. The testigos read calls, one event each, so a check inside the call that made the change counted as
// before it. → [the change's part, the rest] as two commands, or null when the command is not that shape.
const INTERP_PART = /^(?:\S*[\/])?(?:python3?|py|node|deno|ruby|perl|php)(?:\.exe)?\b/i;
export function splitAtChange(command) {
  const c = String(command || ''), parts = shellRuns(c), script = scriptWrites(c);
  let m = -1;
  parts.forEach((p, i) => { if (changesProject(p.text) || (script && INTERP_PART.test(p.text.trim()))) m = i; });
  if (m < 0) return null;
  const rest = parts.slice(m + 1);
  if (!rest.some((p) => p.gate || p.build || p.test)) return null;
  return [c.slice(0, rest[0].at), c.slice(rest[0].at)];
}
