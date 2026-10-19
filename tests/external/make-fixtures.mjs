#!/usr/bin/env node
// Waymark 2.0.18 · point 1: builds tests/external/fixtures/ from the repositories pinned in corpus.json, so the external test
// runs on committed files and needs no clone and no network. Stack detection reads only the names at the top of a repository
// (and one level down for an Android module's manifest) and a few manifests' contents, so a fixture is exactly that: the
// names as empty files, the manifests with their real text at the pinned commit, and an empty placeholder for the task's
// sample file. No source code is copied.
//   node tests/external/make-fixtures.mjs        needs network (a blobless fetch of each pinned commit, into a temp folder it deletes)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');
// The manifests whose content the detection reads; every other name is kept as an empty file.
export const MANIFEST_NAMES = /^(Cargo\.toml|composer\.json|package\.json|pyproject\.toml|requirements\.txt|go\.mod|Gemfile|pom\.xml|(settings|build)\.gradle(\.kts)?|CMakeLists\.txt|Makefile)$/;
// What a fixture keeps from the full list of paths: the top-level files, an Android module's manifest, the task's sample file.
export const keep = (p, sample) => !p.includes('/') || /^[^/]+\/(src\/main\/)?AndroidManifest\.xml$/.test(p) || p === sample;

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-fixtures-'));
  const index = { schema: 'waymark.external-fixtures/v1', repos: {} };
  try {
    for (const e of corpus.repos) {
      const repo = path.join(work, e.id);
      fs.mkdirSync(repo);
      git(repo, ['init', '-q']);
      git(repo, ['remote', 'add', 'origin', e.url]);
      git(repo, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', e.commit]);
      const paths = git(repo, ['ls-tree', '-r', '--name-only', '-z', e.commit]).split('\0').filter(Boolean).filter((p) => keep(p, e.sample));
      const out = path.join(FIXTURES, e.id);
      fs.rmSync(out, { recursive: true, force: true });
      const withContent = [];
      for (const p of paths) {
        fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true });
        const isManifest = !p.includes('/') && MANIFEST_NAMES.test(p);
        fs.writeFileSync(path.join(out, p), isManifest ? git(repo, ['show', `${e.commit}:${p}`]) : '');
        if (isManifest) withContent.push(p);
      }
      index.repos[e.id] = { commit: e.commit, files: paths.sort(), withContent: withContent.sort() };
      console.log(`${e.id}: ${paths.length} names, ${withContent.length} manifests`);
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  fs.writeFileSync(path.join(FIXTURES, 'fixtures.json'), JSON.stringify(index, null, 1) + '\n');
}
