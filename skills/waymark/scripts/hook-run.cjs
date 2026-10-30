#!/usr/bin/env node
// Waymark · the command every hook is registered with (docs/adr/0040): `node hook-run.cjs <hook script> [args]`.
// The hooks use syntax a Node older than MIN does not parse (`??=`), and the agent starts them with whatever `node` is first on
// the PATH, which a version manager changes per project. A hook that dies on a parse error runs nothing and says nothing: the
// task is not recorded and its Cierre is not checked. So this file is plain CommonJS and ES2015, readable by any Node that
// can start it, and it does one thing: run the hook with a Node that can run it.
//   - the active Node is new enough → the hook runs in this process (no second process per call);
//   - else the first of: WAYMARK_NODE, the Node pinned by install-hooks (~/.waymark/node), the newest nvm version ≥ MIN
//     (nvm for Windows, nvm for Unix) runs it, with the same stdin, stdout and exit code;
//   - else it says so in a message the agent shows, and exits 0: the hook did not run, and the user is told.
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var url = require('url');

var MIN = 18; // the lowest Node the suite is run on (docs/adr/0040)
var script = process.argv[2];
var rest = process.argv.slice(3);
var active = process.env.WAYMARK_ACTIVE_NODE || process.versions.node; // the override is for the tests: a Node that reports itself old
var exe = process.platform === 'win32' ? 'node.exe' : 'node';

function major(v) { return parseInt(String(v).replace(/^v/, '').split('.')[0], 10) || 0; }
function tell(text) { // a systemMessage where the agent shows a hook's output, and stderr for its log
  try { fs.writeSync(1, JSON.stringify({ systemMessage: text }) + '\n'); } catch (e) { /* no stdout to write to */ } // synchronous: the exit that follows cannot cut it
  process.stderr.write(text + '\n');
}
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function list(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }
function ranked(versions) { // 'v24.15.0' names, newest first
  return versions.filter(function (d) { return /^v?\d+\.\d+\.\d+$/.test(d); }).sort(function (a, b) {
    var x = a.replace(/^v/, '').split('.').map(Number), y = b.replace(/^v/, '').split('.').map(Number);
    return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]);
  });
}
function versionOf(file) { // asks a Node what it is, for the ones whose folder does not say
  var r = cp.spawnSync(file, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? String(r.stdout).trim() : '';
}

// The Node to hand the hook to: an executable at least MIN, or null.
function findNode() {
  var home = os.homedir();
  var explicit = [];
  if (process.env.WAYMARK_NODE) explicit.push(process.env.WAYMARK_NODE);
  try { explicit.push(fs.readFileSync(path.join(process.env.WAYMARK_HOME || path.join(home, '.waymark'), 'node'), 'utf8').trim()); } catch (e) { /* nothing pinned */ }
  for (var i = 0; i < explicit.length; i++) {
    if (explicit[i] && isFile(explicit[i]) && major(versionOf(explicit[i])) >= MIN) return explicit[i];
  }
  var roots = []; // [folder holding one folder per version, where the executable sits inside it]
  if (process.env.NVM_HOME) roots.push([process.env.NVM_HOME, '']);
  if (process.env.APPDATA) roots.push([path.join(process.env.APPDATA, 'nvm'), '']);
  roots.push([path.join(process.env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), 'bin']);
  for (var j = 0; j < roots.length; j++) {
    var names = ranked(list(roots[j][0]));
    for (var k = 0; k < names.length; k++) {
      if (major(names[k]) < MIN) break;
      var file = path.join(roots[j][0], names[k], roots[j][1], exe);
      if (isFile(file)) return file;
    }
  }
  return null;
}

// Each run's milliseconds (from the process start, as the agent waits for it) go to <WAYMARK_HOME>/latency.log, one tab-separated
// line: when, the hook, ms, and the tag the hook set (project:session:transcript KB). `waymark.mjs check` names an event whose p95 passes its cap. The log keeps its last 2,000 lines.
function logLatency() {
  try {
    var file = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'latency.log');
    var line = new Date().toISOString() + '\t' + path.basename(script).replace(/\.[cm]?js$/, '') + '\t' + Math.round(process.uptime() * 1000) + (process.env.WAYMARK_LATENCY_TAG ? '\t' + process.env.WAYMARK_LATENCY_TAG : '') + '\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (isFile(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-2000).join('\n') + '\n');
    fs.appendFileSync(file, line);
  } catch (e) { /* the hook's work matters more than its timing */ }
}

if (!script) {
  tell('Waymark: hook-run.cjs was started with no hook script to run.');
  process.exit(0);
} else if (major(active) >= MIN) {
  process.on('exit', logLatency);
  process.argv.splice(1, 1); // the hook sees itself as the script: [node, <hook>, ...args], as when it is started directly
  import(url.pathToFileURL(path.resolve(script)).href).catch(function (e) {
    process.stderr.write('Waymark: ' + path.basename(script) + ' failed to load: ' + (e && e.stack || e) + '\n');
    process.exit(1);
  });
} else {
  var other = findNode();
  var name = path.basename(script);
  if (!other) {
    tell('Waymark: the active Node is v' + active + ' and the Waymark hooks need Node ' + MIN + ' or newer, so ' + name +
      ' did not run: this task is not recorded and its Cierre is not checked. Switch to a newer Node (nvm use <version>), or set WAYMARK_NODE to a node executable, or run install-hooks with a newer Node to pin one.');
    process.exit(0);
  }
  process.on('exit', logLatency);
  var r = cp.spawnSync(other, [path.resolve(script)].concat(rest), { stdio: 'inherit' });
  if (r.error) {
    tell('Waymark: ' + name + ' could not run with ' + other + ' (' + r.error.message + ').');
    process.exit(0);
  }
  process.exit(r.status === null ? 1 : r.status);
}
