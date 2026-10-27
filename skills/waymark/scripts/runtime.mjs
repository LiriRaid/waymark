// Waymark · the runtime a stack needs (2.0.19, point 6), for any stack. A legacy app runs on the runtime of its day, not the machine's: Angular 10 wants
// Node 14, Rails 5 wants Ruby 2.7, Django 2.2 a Python before 3.10, and a machine on the newest one fails every gate the same way, in every session, until
// somebody discovers it by hand. For each language (Node, Ruby, Python, PHP, Java, Go) the version is read first from what the repo declares (`.nvmrc`,
// `volta`, `engines`, `.ruby-version`, Gemfile `ruby`, `.python-version`, `requires-python`, composer `php`, `.java-version`, `.sdkmanrc`, `.tool-versions`,
// `mise.toml`…), else from the framework it installs (a table of the old majors only: a modern framework runs on the machine's runtime). A compile target
// is a floor, not a runtime (TypeScript's `engines`, Maven's `java.version`, go.mod's `go`), so it is read last, as `>=`. When this machine's runtime is
// outside it, memory.md → Quality gates gets a `runtime` row per language naming the folder of that version on this machine (nvm, Volta, fnm, rbenv, rvm,
// pyenv, uv, SDKMAN, asdf, mise…), and the hook's own re-run of a gate puts it first on the PATH: a chained command keeps working and the machine's runtime
// is never switched. Offline, a few file reads; a language's binary is asked its version only when the repo asks for one.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { read } from './lib/fs.mjs';
import { railsVersion } from './stack.mjs';

// ---- versions ----
const parts = (v) => String(v ?? '').match(/\d+(?:\.\d+)*/)?.[0].split('.').map(Number) || [];
// Java names its 8 as 1.8 (`1.8.0_392`, `jdk1.8.0_392`): the major is the second number there.
const javaParts = (v) => { const p = parts(v); return p[0] === 1 && p.length > 1 ? p.slice(1) : p; };
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return Math.sign(d); } return 0; };
const prefixEq = (v, c, n) => c.slice(0, n).every((x, i) => v[i] === x);

// Does a version satisfy a range, compared to `p` numbers (1: Node and Java majors; 2: Ruby 2.7, Python 3.10, PHP 7.4, Go 1.20)? npm, Bundler, PEP 440 and
// Composer forms: ">=14 <17", "^16 || >=18", "14.x", "~> 2.7.0", ">=3.8,<3.11", "^7.4|^8.0", "3.8.*", "18". Enough to tell a machine that is outside it.
export function satisfies(range, version, p = 1) {
  const v = parts(version).slice(0, p);
  const alts = String(range || '').replace(/(>=|<=|>|<|\^|~>|~=|~|==|=|!=)\s+/g, '$1').split(/\|\|?/).map((a) => a.trim()).filter(Boolean); // "~> 2.7" is one constraint
  if (!alts.length) return true;
  return alts.some((alt) => alt.split(/[\s,]+/).filter(Boolean).every((c) => {
    const m = c.match(/^(>=|<=|>|<|\^|~>|~=|~|==|=|!=)?v?(\d+(?:\.(?:\d+|[x*]))*)/i);
    if (!m || m[1] === '!=') return true;
    const raw = m[2].split('.'), wild = raw.findIndex((x) => /[x*]/i.test(x));
    const orig = (wild < 0 ? raw : raw.slice(0, wild)).map(Number), at = orig.slice(0, p);
    if (wild >= 0) return prefixEq(v, orig, Math.min(orig.length, p));
    const d = cmp(v, at);
    switch (m[1]) {
      case '>=': return d >= 0; case '>': return d > 0; case '<=': return d <= 0; case '<': return d < 0;
      case '^': return d >= 0 && v[0] === at[0];
      case '~': case '~>': case '~=': return d >= 0 && prefixEq(v, orig, Math.min(Math.max(1, orig.length - 1), p));
      default: return prefixEq(v, orig, Math.min(orig.length, p));
    }
  }));
}
export const satisfiesMajor = (range, major) => satisfies(range, major, 1);

// ---- what each language reads ----
const json = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };
const firstLine = (f) => read(f).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
const toolVersions = (root, names) => { const t = read(path.join(root, '.tool-versions')); for (const n of names) { const m = t.match(new RegExp(`^${n}\\s+(\\S+)`, 'm')); if (m) return m[1]; } return null; };
const miseToml = (root, names) => { for (const f of ['mise.toml', '.mise.toml']) { const t = read(path.join(root, f)); for (const n of names) { const m = t.match(new RegExp(`^\\s*["']?${n}["']?\\s*=\\s*["']([^"']+)["']`, 'm')); if (m) return [m[1], f]; } } return null; };
const pkgOf = (root) => json(path.join(root, 'package.json'));
// the installed version when node_modules has it, else the declared range
const nodeDep = (root, pkg, name) => {
  const all = { ...(pkg?.devDependencies || {}), ...(pkg?.dependencies || {}) };
  if (!all[name]) return null;
  return json(path.join(root, 'node_modules', ...name.split('/'), 'package.json'))?.version || String(all[name]).replace(/^[~^>=<\s]+/, '');
};
const pathKey = (env) => Object.keys(env).find((k) => /^path$/i.test(k)) || 'PATH';
const match = (root, files, re) => { for (const f of files) { const m = read(path.join(root, f)).match(re); if (m) return m[1]; } return null; };

// A pinned version is the one to use and the only one that fits; a range is checked as it is, and its lowest version is the folder looked for first.
const pinned = (lang, v, from) => { const p = LANGS[lang].p, use = fmt(lang, LANGS[lang].parts(v).slice(0, p)); return v && LANGS[lang].parts(v).length ? { use, ok: [use], from } : null; };
const ranged = (lang, range, from) => { const lo = LANGS[lang].parts(range); return lo.length ? { use: fmt(lang, lo.slice(0, LANGS[lang].p)), range: String(range).trim(), from } : null; };
const declared = (lang, v, from) => (v == null ? null : /^\s*v?\d/.test(v) && !/[<>=^~*x|,\s]/.test(String(v).replace(/^v/, '').replace(/\.x$/i, '').trim()) ? pinned(lang, v, from) : ranged(lang, v, from));
const fmt = (lang, p) => (LANGS[lang].p === 1 ? p[0] : p.slice(0, LANGS[lang].p).join('.'));

// The Node majors each Angular major runs on (angular.dev/reference/versions), and the one to use when the machine's is not among them.
const ANGULAR = {
  8: { ok: [10], use: 10 }, 9: { ok: [10, 12], use: 12 },
  10: { ok: [10, 12, 14], use: 14 }, 11: { ok: [10, 12, 14], use: 14 }, 12: { ok: [12, 14, 16], use: 14 }, 13: { ok: [12, 14, 16], use: 14 }, 14: { ok: [14, 16], use: 16 },
  15: { ok: [14, 16, 18], use: 16 }, 16: { ok: [16, 18], use: 18 }, 17: { ok: [18, 20], use: 18 }, 18: { ok: [18, 20, 22], use: 20 }, 19: { ok: [18, 20, 22], use: 20 },
  20: { ok: [20, 22, 24], use: 22 }, 21: { ok: [20, 22, 24], use: 22 },
};
// The old majors of the other frameworks and the runtime they run on ([below this version, need]); a version past the last row needs nothing. Webpack 4
// (React Scripts before 5, Vue CLI before 5, Nuxt 2, Next before 12) breaks on Node 17 and later; the others are each framework's support table.
// `legacy` is the version under which a repo is legacy (stacks/generic.md → Legacy repos): slow builds and old conventions.
const FRAMEWORKS = {
  node: [
    { name: 'angular', dep: '@angular/core', legacy: '14', table: (v) => ANGULAR[parts(v)[0]] && { ...ANGULAR[parts(v)[0]] } },
    { name: 'react-scripts', dep: 'react-scripts', legacy: '5', rows: [['3', { ok: [8, 10, 12, 14, 16], use: 14 }], ['5', { ok: [10, 12, 14, 16], use: 16 }]] },
    { name: 'vue-cli', dep: '@vue/cli-service', legacy: '5', rows: [['4', { ok: [8, 10, 12, 14], use: 14 }], ['5', { ok: [10, 12, 14, 16], use: 16 }]] },
    { name: 'nuxt', dep: 'nuxt', legacy: '3', rows: [['3', { ok: [12, 14, 16], use: 16 }]] },
    { name: 'next', dep: 'next', legacy: '12', rows: [['12', { ok: [10, 12, 14, 16], use: 14 }]] },
    { name: 'nestjs', dep: '@nestjs/core', legacy: '8', rows: [['8', { ok: [10, 12, 14], use: 14 }]] },
  ],
  ruby: [{ name: 'rails', legacy: '6', version: railsVersion,
    rows: [['5', { range: '>=2.2 <2.7', use: '2.6' }], ['6', { range: '>=2.2.2 <3.0', use: '2.7' }], ['6.1', { range: '>=2.5 <3.0', use: '2.7' }], ['7', { range: '>=2.5 <3.1', use: '3.0' }]] }],
  python: [{ name: 'django', legacy: '3', version: (root) => match(root, ['requirements.txt'], /^django\s*(?:==|~=|>=)\s*(\d+\.\d+)/im) || match(root, ['Pipfile.lock'], /"django":\s*\{[^}]*"version":\s*"==(\d+\.\d+)/i)
      || match(root, ['poetry.lock'], /name = "django"\s*\nversion = "(\d+\.\d+)/i) || match(root, ['pyproject.toml', 'Pipfile'], /["']?django["']?\s*(?:=\s*["'][\^~>=]*|[>=~]=)\s*(\d+\.\d+)/i),
    rows: [['2', { range: '>=2.7 <3.8', use: '3.7' }], ['3', { range: '>=3.5 <3.10', use: '3.9' }], ['3.2', { range: '>=3.6 <3.10', use: '3.9' }], ['4', { range: '>=3.6 <3.11', use: '3.10' }],
      ['4.2', { range: '>=3.8 <3.12', use: '3.11' }], ['5', { range: '>=3.8 <3.13', use: '3.12' }]] }],
  php: [{ name: 'laravel', legacy: '8', version: (root) => match(root, ['composer.lock'], /"name":\s*"laravel\/framework",\s*"version":\s*"v?(\d+\.\d+)/) || match(root, ['composer.json'], /"laravel\/framework":\s*"[\^~>=v]*(\d+(?:\.\d+)?)/),
    rows: [['6', { range: '>=7.0 <8.0', use: '7.3' }], ['8', { range: '>=7.2 <8.1', use: '7.4' }], ['9', { range: '>=7.3 <8.2', use: '8.0' }], ['10', { range: '>=8.0 <8.3', use: '8.1' }], ['11', { range: '>=8.1 <8.4', use: '8.2' }]] }],
  java: [{ name: 'spring-boot', legacy: '2', version: (root) => match(root, ['pom.xml'], /spring-boot-starter-parent<\/artifactId>\s*<version>(\d+\.\d+)/) || match(root, ['pom.xml'], /<spring-boot\.version>(\d+\.\d+)/)
      || match(root, ['build.gradle', 'build.gradle.kts'], /org\.springframework\.boot['"]?\)?\s+version\s+['"](\d+\.\d+)/),
    rows: [['2', { range: '>=7 <9', use: 8 }], ['2.5', { range: '>=8 <16', use: 11 }], ['3', { range: '>=8 <20', use: 17 }], ['99', { range: '>=17', use: 21 }]] }],
  go: [],
};
// → { need, legacy } of the frameworks of this language the repo installs: the need of the first one with a row, and whether any is under its legacy
// major (a modern Angular beside a NestJS 7 is still legacy), or null when none says anything.
function frameworkOf(root, lang, pkg = pkgOf(root)) {
  let need = null, legacy = false;
  for (const f of FRAMEWORKS[lang]) {
    const v = f.dep ? nodeDep(root, pkg, f.dep) : f.version(root);
    if (!v || !parts(v).length) continue;
    const row = f.table ? f.table(v) : f.rows.find(([below]) => cmp(parts(v), parts(below)) < 0)?.[1];
    if (row && !need) need = { ...row, from: `${f.name} ${parts(v).slice(0, f.name === 'angular' ? 1 : 2).join('.')}` };
    legacy ||= cmp(parts(v), parts(f.legacy)) < 0;
  }
  return need || legacy ? { need, legacy } : null;
}

// Each language: how many numbers of a version matter, its binary, how it says its version, what it declares (pins and ranges, first to last), and its
// floors (a compile target), read only when no framework row says more. A Gradle toolchain is neither: Gradle provisions that JDK itself.
const LANGS = {
  node: { p: 1, parts, label: 'Node', bin: 'node', args: ['--version'], managers: 'nvm-windows, nvm, Volta, fnm, asdf or mise',
    declared(root, pkg) {
      const volta = pkg?.volta?.node;
      if (volta) return pinned('node', volta, 'package.json volta');
      for (const f of ['.nvmrc', '.node-version']) { const v = firstLine(path.join(root, f)); if (/^v?\d/.test(v)) return declared('node', v, f); }
      const tv = toolVersions(root, ['nodejs', 'node']); if (tv) return declared('node', tv, '.tool-versions');
      const mise = miseToml(root, ['node', 'nodejs']); if (mise) return declared('node', mise[0], mise[1]);
      const engines = pkg?.engines?.node;
      if (engines) { const use = parts(engines)[0]; if (use != null) return { use, range: String(engines), from: 'package.json engines' }; }
      return null;
    } },
  ruby: { p: 2, parts, label: 'Ruby', bin: 'ruby', args: ['-v'], managers: 'rbenv, rvm, chruby, RubyInstaller, asdf or mise',
    declared(root) {
      const rv = firstLine(path.join(root, '.ruby-version')).replace(/^ruby-/, ''); if (/^\d/.test(rv)) return declared('ruby', rv, '.ruby-version');
      const tv = toolVersions(root, ['ruby']); if (tv) return declared('ruby', tv, '.tool-versions');
      const mise = miseToml(root, ['ruby']); if (mise) return declared('ruby', mise[0], mise[1]);
      const gem = match(root, ['Gemfile'], /^\s*ruby\s+['"]([^'"]+)['"]/m); if (gem && /\d/.test(gem)) return declared('ruby', gem, 'Gemfile ruby');
      return null;
    } },
  python: { p: 2, parts, label: 'Python', bin: process.platform === 'win32' ? 'python' : 'python3', args: ['--version'], managers: 'pyenv, pyenv-win, uv, python.org, asdf or mise',
    declared(root) {
      const pv = firstLine(path.join(root, '.python-version')); if (/^\d/.test(pv)) return declared('python', pv, '.python-version');
      const tv = toolVersions(root, ['python']); if (tv) return declared('python', tv, '.tool-versions');
      const mise = miseToml(root, ['python']); if (mise) return declared('python', mise[0], mise[1]);
      const rt = match(root, ['runtime.txt'], /^python-(\d[\d.]*)/m); if (rt) return pinned('python', rt, 'runtime.txt');
      const pip = match(root, ['Pipfile'], /^\s*python_version\s*=\s*["']([^"']+)["']/m); if (pip) return declared('python', pip, 'Pipfile python_version');
      const req = match(root, ['pyproject.toml'], /^\s*requires-python\s*=\s*["']([^"']+)["']/m); if (req) return ranged('python', req, 'pyproject requires-python');
      const poetry = match(root, ['pyproject.toml'], /\[tool\.poetry\.dependencies\][^[]*?^\s*python\s*=\s*["']([^"']+)["']/ms); if (poetry) return ranged('python', poetry, 'pyproject poetry python');
      return null;
    } },
  php: { p: 2, parts, label: 'PHP', bin: 'php', args: ['-v'], managers: 'phpenv, Laragon, asdf or mise',
    declared(root) {
      const pv = firstLine(path.join(root, '.php-version')); if (/^\d/.test(pv)) return declared('php', pv, '.php-version');
      const tv = toolVersions(root, ['php']); if (tv) return declared('php', tv, '.tool-versions');
      const mise = miseToml(root, ['php']); if (mise) return declared('php', mise[0], mise[1]);
      const req = json(path.join(root, 'composer.json'))?.require?.php; if (req) return ranged('php', req, 'composer.json php');
      return null;
    } },
  java: { p: 1, parts: javaParts, label: 'Java', bin: 'java', args: ['-version'], managers: 'SDKMAN, asdf, mise, jabba or the system JDKs',
    declared(root) {
      const jv = firstLine(path.join(root, '.java-version')); if (/\d/.test(jv)) return pinned('java', jv, '.java-version');
      const sdk = match(root, ['.sdkmanrc'], /^\s*java\s*=\s*(\S+)/m); if (sdk) return pinned('java', sdk, '.sdkmanrc');
      const tv = toolVersions(root, ['java']); if (tv) return pinned('java', tv.replace(/^[a-z-]+?-(?=\d)/i, ''), '.tool-versions');
      const mise = miseToml(root, ['java']); if (mise) return pinned('java', mise[0].replace(/^[a-z-]+?-(?=\d)/i, ''), mise[1]);
      return null;
    },
    floor(root) {
      const pom = match(root, ['pom.xml'], /<(?:java\.version|maven\.compiler\.release|maven\.compiler\.source)>\s*([\d.]+)\s*</);
      const v = pom || match(root, ['build.gradle', 'build.gradle.kts'], /sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?([\d._]+)/);
      return v ? ranged('java', `>=${javaParts(v.replace(/_/g, '.'))[0]}`, pom ? 'pom.xml java.version' : 'gradle sourceCompatibility') : null;
    } },
  go: { p: 2, parts, label: 'Go', bin: 'go', args: ['version'], managers: 'goenv, gvm, ~/sdk, asdf or mise',
    declared(root) {
      const gv = firstLine(path.join(root, '.go-version')); if (/^\d/.test(gv)) return pinned('go', gv, '.go-version');
      const tv = toolVersions(root, ['golang', 'go']); if (tv) return pinned('go', tv, '.tool-versions');
      const mise = miseToml(root, ['go', 'golang']); if (mise) return declared('go', mise[0], mise[1]);
      return null;
    },
    floor(root) { const v = match(root, ['go.mod'], /^go\s+(\d+\.\d+)/m); return v ? ranged('go', `>=${v}`, 'go.mod go') : null; } },
};

// → the { use, ok | range, from } a repo asks of one language, or null: what it declares, else its framework's row, else its floor.
export function neededOf(root, lang, pkg = pkgOf(root)) {
  const L = LANGS[lang];
  return L.declared(root, pkg) || frameworkOf(root, lang, pkg)?.need || L.floor?.(root) || null;
}
export const neededNode = (root) => neededOf(root, 'node');

// A legacy repo, any stack: a framework under its legacy major (Angular before 14, Rails before 6, Django before 3, Laravel before 8, Spring Boot before 2…),
// or a runtime row Waymark wrote for a version older than the machine's. Its builds take minutes and its conventions are its own. Read from files only:
// the Stop hook asks this on every close. → true / false
export function legacyStack(root, memoryText = '') {
  const pkg = pkgOf(root);
  if (Object.keys(LANGS).some((lang) => frameworkOf(root, lang, pkg)?.legacy)) return true;
  return [...String(memoryText).matchAll(/^\|\s*runtime\s*\|[^|]*\|\s*to confirm: (\w+) ([\d.]+) \([^)]*\), this machine runs ([\d.]+)/gim)]
    .some(([, lang, need, machine]) => LANGS[lang] && cmp(LANGS[lang].parts(need), LANGS[lang].parts(machine).slice(0, LANGS[lang].p)) < 0);
}

// The version of a language the shell finds first on the PATH, which is the one a gate runs on (the hook itself may run under another Node a launcher
// pinned), or null when the machine has none. The folder that holds the binary names it when a manager or an installer made it (`C:\Ruby33-x64\bin`,
// `~/.pyenv/versions/3.9.18/bin`): a few stats, where asking Ruby on Windows takes 1.5 s. Asked only when the folder says nothing (a shim, /usr/bin).
const pathVersion = (lang, { env = process.env, platform = process.platform } = {}) => {
  const key = pathKey(env), exe = exeOf(lang, platform);
  for (const dir of String(env[key] || '').split(path.delimiter).filter(Boolean)) {
    if (!fs.existsSync(path.join(dir, exe))) continue;
    const named = [path.basename(dir), path.basename(path.dirname(dir))].find((n) => versionFolder(lang, n));
    return named ? fmt(lang, folderVersion(lang, named)) : undefined;
  }
  return null;
};
// A folder named by a version: two numbers (`3.9.18`, `Ruby33-x64`, `jdk1.8.0_392`), or one after `v`, `-`, `@` or `_` (`v24`, `jdk-17`, `node@18`); never
// a number glued to letters (`x64`) or a bare one (a snap revision).
const versionFolder = (lang, n) => folderVersion(lang, n).length >= 2 || /(?:^v|[-@_])\d+(?:$|[-_.])/i.test(n);
const shellVersion = (lang) => {
  const named = pathVersion(lang);
  if (named === null && lang === 'node') return Number(process.versions.node.split('.')[0]); // no node on the PATH: the one running this hook
  if (named !== undefined) return named; // a version from the folder, or null: no binary on the PATH at all
  const L = LANGS[lang];
  const v = spawnSync(L.bin, L.args, { encoding: 'utf8', timeout: 5000, windowsHide: true }); // no shell: the binary resolves on the PATH (DEP0190)
  const out = `${v.stdout || ''}\n${v.stderr || ''}`;
  const found = lang === 'go' ? out.match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1] : lang === 'java' ? out.match(/version "([^"]+)"/)?.[1] || out.match(/(\d+(?:\.\d+)+)/)?.[1] : out.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
  if (!found && lang === 'node') return Number(process.versions.node.split('.')[0]);
  return found ? fmt(lang, L.parts(found)) : null;
};

// Where each manager keeps its versions: [name, base folder, the folder of one version that holds the binary]. A folder is named by its version
// (`v14.21.3`, `ruby-2.7.8`, `11.0.21-tem`, `temurin-17.0.2+8`, `go1.20.5`, `jdk1.8.0_392`, Windows' `Ruby27-x64` and `Python310`).
const LAYOUTS = ({ env, home, platform }, lang) => {
  const win = platform === 'win32', bin = (d) => (win ? d : path.join(d, 'bin')), sub = (d) => path.join(d, 'bin');
  const asdf = (name) => ['asdf', path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'installs', name), bin];
  const mise = (name) => ['mise', path.join(env.MISE_DATA_DIR || path.join(home, '.local', 'share', 'mise'), 'installs', name), bin];
  const pf = env.ProgramFiles || 'C:\\Program Files', drive = env.SystemDrive ? `${env.SystemDrive}${path.sep}` : 'C:\\';
  return {
    node: [
      ['nvm-windows', win ? env.NVM_HOME || (env.APPDATA ? path.join(env.APPDATA, 'nvm') : null) : null, (d) => d],
      ['nvm', win ? null : path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), sub],
      ['volta', win ? (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'node') : null) : path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'tools', 'image', 'node'), bin],
      ['fnm', path.join(env.FNM_DIR || (win ? path.join(env.APPDATA || home, 'fnm') : path.join(home, '.local', 'share', 'fnm')), 'node-versions'), (d) => bin(path.join(d, 'installation'))],
      asdf('nodejs'), mise('node'),
    ],
    ruby: [['rbenv', win ? null : path.join(env.RBENV_ROOT || path.join(home, '.rbenv'), 'versions'), sub], ['rvm', win ? null : path.join(home, '.rvm', 'rubies'), sub],
      ['chruby', win ? null : path.join(home, '.rubies'), sub], ['rubyinstaller', win ? drive : null, sub], asdf('ruby'), mise('ruby')],
    python: [['pyenv', win ? null : path.join(env.PYENV_ROOT || path.join(home, '.pyenv'), 'versions'), sub], ['pyenv-win', win ? path.join(env.PYENV || path.join(home, '.pyenv', 'pyenv-win'), 'versions') : null, (d) => d],
      ['uv', win ? (env.APPDATA ? path.join(env.APPDATA, 'uv', 'python') : null) : path.join(home, '.local', 'share', 'uv', 'python'), bin],
      ['python.org', win && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'Python') : null, (d) => d], asdf('python'), mise('python')],
    php: [['phpenv', win ? null : path.join(home, '.phpenv', 'versions'), sub], ['laragon', win ? path.join(drive, 'laragon', 'bin', 'php') : null, (d) => d], asdf('php'), mise('php')],
    java: [['sdkman', path.join(env.SDKMAN_DIR || path.join(home, '.sdkman'), 'candidates', 'java'), sub], asdf('java'), mise('java'), ['jabba', path.join(home, '.jabba', 'jdk'), sub],
      ...(win ? ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto'].map((v) => ['jdk', path.join(pf, v), sub])
        : platform === 'darwin' ? [['jdk', '/Library/Java/JavaVirtualMachines', (d) => path.join(d, 'Contents', 'Home', 'bin')]] : [['jdk', '/usr/lib/jvm', sub]])],
    go: [['goenv', win ? null : path.join(env.GOENV_ROOT || path.join(home, '.goenv'), 'versions'), sub], ['gvm', win ? null : path.join(home, '.gvm', 'gos'), sub],
      ['sdk', path.join(home, 'sdk'), sub], asdf('golang'), mise('go')],
  }[lang];
};
const exeOf = (lang, platform) => { const b = lang === 'python' && platform !== 'win32' ? 'python3' : lang; return platform === 'win32' ? `${b}.exe` : b; };
// The version a folder name says: Windows' compact `Ruby27-x64` / `Python310`, else its first dotted number (`jdk-17` and `java-11-openjdk` too).
const folderVersion = (lang, name) => {
  const compact = name.match(/^(?:Ruby|Python)(\d)(\d+)/i);
  if (compact) return [Number(compact[1]), Number(compact[2])];
  if (lang === 'ruby' && name.startsWith('Ruby')) return [];
  return LANGS[lang].parts(name.replace(/^.*?(?=\d)/, ''));
};

// → { via, dir } of the newest version of `lang` this machine has that `fits` (a version's numbers → true), in a manager's folder that holds the binary.
export function runtimeFolder(lang, fits, { env = process.env, home = process.env.HOME || process.env.USERPROFILE || '', platform = process.platform } = {}) {
  const exe = exeOf(lang, platform);
  for (const [via, base, dirOf] of LAYOUTS({ env, home, platform }, lang)) {
    if (!base) continue;
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    const mine = names.map((n) => [n, folderVersion(lang, n)]).filter(([, v]) => v.length && fits(v)).sort(([, a], [, b]) => cmp(b, a));
    for (const [n] of mine) { const dir = dirOf(path.join(base, n)); if (fs.existsSync(path.join(dir, exe)) || (lang === 'python' && platform !== 'win32' && fs.existsSync(path.join(dir, 'python')))) return { via, dir }; }
  }
  return null;
}
export const nodeDir = (major, opts) => runtimeFolder('node', (v) => v[0] === major, opts);
// The folder for a need: its `use` first, then the newest that fits its list or its range.
const folderFor = (lang, need, opts) => {
  const p = LANGS[lang].p, at = (v) => fmt(lang, v.slice(0, p));
  return runtimeFolder(lang, (v) => cmp(v.slice(0, p), parts(need.use).slice(0, p)) === 0, opts)
    || runtimeFolder(lang, (v) => (need.range ? satisfies(need.range, v.join('.'), p) : need.ok.map(String).includes(String(at(v)))), opts);
};

// → [{ lang, use, from, machine, via, dir, prefix }] for each language whose need this machine's runtime does not meet (empty when it meets them all):
// `prefix` is the row's cell, `<lang> <dir>` (null when no manager here has that version: the row then says which one is needed). `machine` is a
// version or (lang) → version; `dirOf(use, lang, need)` finds the folder.
export function runtimesOf(root, { machine = null, dirOf = null } = {}) {
  const pkg = pkgOf(root), out = [];
  for (const lang of Object.keys(LANGS)) {
    const need = neededOf(root, lang, pkg);
    if (!need) continue;
    const L = LANGS[lang];
    const have = typeof machine === 'function' ? machine(lang) : machine ?? shellVersion(lang);
    if (have != null && (need.range ? satisfies(need.range, have, L.p) : need.ok.map(String).includes(String(fmt(lang, L.parts(have)))))) continue;
    const found = dirOf ? dirOf(need.use, lang, need) : folderFor(lang, need);
    out.push({ lang, use: need.use, from: need.from, machine: have ?? 'none', via: found?.via || null, dir: found?.dir || null, prefix: found ? `${lang} ${found.dir}` : null });
  }
  return out;
}
// The first of them, or null (one language, as before; a repo of two gets a row each from fillRuntime).
export const runtimeOf = (root, opts) => runtimesOf(root, opts)[0] || null;

// The folder a `<lang> <dir>` cell names, or null (a command the user wrote stays a command prefix: `nvm exec 14`, `python manage.py` is no folder).
export const runtimeDir = (cell) => { const m = String(cell || '').match(/^(node|ruby|python|php|java|go)\s+(.+)$/); return m && /[\\/]/.test(m[2]) ? m[2].trim() : null; };
// The environment that runs a gate on those runtimes: this one with the folders first on the PATH (whatever the case of its key on Windows).
export function runtimeEnv(dir, env = process.env) {
  const key = pathKey(env);
  return { ...env, [key]: `${[dir].flat().join(path.delimiter)}${path.delimiter}${env[key] || ''}` };
}

// Every cell memory.md's `runtime` rows name, skipping "none (…)" and a <placeholder>. Written by fillRuntime, or by the user in their own words.
export function runtimeCells(memoryText) {
  const rows = (String(memoryText).match(/\n## Quality gates[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] || '').split('\n').filter((r) => r.trim().startsWith('|'));
  return rows.map((r) => r.split('|').slice(1, 3).map((c) => String(c || '').replace(/`/g, '').trim()))
    .filter(([gate, cmd]) => /^runtime$/i.test(gate || '') && cmd && !/^none\b/i.test(cmd) && !/[<>]/.test(cmd)).map(([, cmd]) => cmd);
}
export const runtimePrefix = (memoryText) => runtimeCells(memoryText)[0] || null;

// The language a runtime row is for (`node <dir>`, `none (needs ruby …)`, `to confirm: python …`), or null for a command somebody wrote (`nvm exec 14`).
const rowLang = (row) => row.match(/^\|\s*runtime\s*\|\s*`?(?:none \(needs )?(node|ruby|python|php|java|go)\b/i)?.[1]?.toLowerCase() || row.match(/to confirm: (node|ruby|python|php|java|go) /)?.[1] || null;

// Writes a `runtime` row per language at the end of the Quality gates table when the repo needs another version than this machine's and no row for that
// language says so yet; never over one somebody wrote (a row of no language it can tell covers them all). → the rows' text, or null when nothing was written.
export function fillRuntime(memoryFile, root, opts) {
  const text = read(memoryFile);
  if (!text) return null;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## Quality gates/.test(l));
  if (start < 0) return null;
  let last = -1;
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (lines[i].trim().startsWith('|')) last = i;
  if (last < 0) return null;
  const have = lines.filter((l) => /^\|\s*runtime\s*\|/i.test(l)).map(rowLang);
  if (have.includes(null)) return null;
  const rts = runtimesOf(root, opts).filter((rt) => !have.includes(rt.lang));
  if (!rts.length) return null;
  const rows = rts.map((rt) => {
    const L = LANGS[rt.lang];
    const cell = rt.prefix || `none (needs ${rt.lang} ${rt.use} from ${rt.from}: no ${L.label} ${rt.use} folder in ${L.managers})`;
    return `| runtime | ${rt.prefix ? `\`${cell}\`` : cell} | to confirm: ${rt.lang} ${rt.use} (${rt.from}), this machine runs ${rt.machine}${rt.via ? ` · via ${rt.via}` : ''} |`;
  });
  lines.splice(last + 1, 0, ...rows);
  fs.writeFileSync(memoryFile, lines.join('\n'));
  return rows.join('\n');
}
