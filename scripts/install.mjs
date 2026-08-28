#!/usr/bin/env node
// Install this base onto the machine, so it is active in every repository.
//
//   node scripts/install.mjs              install or update
//   node scripts/install.mjs --dry-run    list what would be written, write nothing
//   node scripts/install.mjs --uninstall  remove exactly what was installed
//   node scripts/install.mjs --uninstall --purge   also drop settings and the registry
//
// Why user-level rather than a plugin or a per-repo copy: user-level hooks fire
// in every repository with no folder trust and no opt-in variable, while
// repository hooks are deferred until the folder is trusted, and plugin installs
// do not register hooks at all (and namespace the agents, which breaks @name
// references). Verified against CLI 1.0.80; see docs/copilot-cli-capabilities.md.
//
// Files are copied, not linked: file symlinks on Windows need elevation. The
// development loop is re-running this command.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = dirname(dirname(fileURLToPath(import.meta.url)));
const COPILOT_HOME = process.env.COPILOT_HOME || join(homedir(), '.copilot');
const BASE_HOME = join(COPILOT_HOME, 'copilot-base');
const MANIFEST = join(BASE_HOME, 'installed.json');

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const written = [];

function say(text) {
  process.stdout.write(text + '\n');
}

function ensureDir(path) {
  if (!dryRun) mkdirSync(path, { recursive: true });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Copy a tree, recording every destination so uninstall can be exact. */
function copyTree(from, to, filter = () => true) {
  if (!existsSync(from)) return;
  for (const source of walk(from)) {
    if (!filter(source)) continue;
    const dest = join(to, relative(from, source));
    ensureDir(dirname(dest));
    if (!dryRun) copyFileSync(source, dest);
    written.push(dest);
  }
}

function copyIfMissing(from, to) {
  if (!existsSync(from) || existsSync(to)) return;
  ensureDir(dirname(to));
  if (!dryRun) copyFileSync(from, to);
  written.push(to);
}

/**
 * `track: false` for files that become yours the moment they exist - settings
 * and the registry. They are seeded once and never recorded in the manifest, so
 * an uninstall cannot take your workspace with it. `--purge` removes them
 * explicitly, which is the only path that should.
 */
function writeJson(path, value, track = true) {
  ensureDir(dirname(path));
  if (!dryRun) writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  if (track) written.push(path);
}

// ------------------------------------------------------------------ uninstall

if (flags.has('--uninstall')) {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  if (!manifest) {
    say(`nothing to uninstall: no manifest at ${MANIFEST}`);
    process.exit(0);
  }

  let removed = 0;
  for (const path of manifest.files ?? []) {
    if (!existsSync(path)) continue;
    if (!dryRun) rmSync(path, { force: true });
    removed += 1;
  }

  // Directories the install created, deepest first, removed only when empty.
  for (const dir of [
    join(COPILOT_HOME, 'skills'),
    join(COPILOT_HOME, 'agents'),
    join(BASE_HOME, 'hooks', 'lib'),
    join(BASE_HOME, 'hooks'),
    join(BASE_HOME, 'scripts', 'lib'),
    join(BASE_HOME, 'scripts'),
    join(BASE_HOME, 'config'),
  ]) {
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0 && !dryRun) rmSync(dir, { recursive: true });
    } catch {
      // leave anything we cannot clean; better than deleting someone else's files
    }
  }

  if (!dryRun) rmSync(MANIFEST, { force: true });

  if (flags.has('--purge')) {
    for (const path of [join(BASE_HOME, 'config.json'), join(BASE_HOME, 'repos.json')]) {
      if (!dryRun) rmSync(path, { force: true });
    }
    say('purged settings and the repository registry');
  } else {
    say(`kept your settings and registry (${BASE_HOME}); pass --purge to remove them too`);
  }

  say(`${dryRun ? 'would remove' : 'removed'} ${removed} file(s)`);
  process.exit(0);
}

// -------------------------------------------------------------------- install

copyTree(join(PACKAGE, 'agents'), join(COPILOT_HOME, 'agents'), (p) => p.endsWith('.agent.md'));
copyTree(join(PACKAGE, 'skills'), join(COPILOT_HOME, 'skills'));
copyTree(join(PACKAGE, 'hooks'), join(BASE_HOME, 'hooks'), (p) => p.endsWith('.mjs'));

// The scripts have to be installed too, and beside the hooks rather than
// anywhere else: `repos.mjs`, `fanout.mjs`, `fleet.mjs` and `wt.mjs` all import
// `../hooks/lib/config.mjs`, so the installed layout has to mirror the checkout.
//
// Without this the skills are installed machine-wide while the commands they
// tell you to run only resolve inside the clone - which is every directory
// except the one you actually work in.
copyTree(join(PACKAGE, 'scripts'), join(BASE_HOME, 'scripts'), (p) => p.endsWith('.mjs'));

// Shipped defaults are copied once and then left alone - they are yours to edit.
copyIfMissing(join(PACKAGE, 'config', 'protected-paths'), join(BASE_HOME, 'config', 'protected-paths'));
copyIfMissing(join(PACKAGE, 'config', 'verify-cmd'), join(BASE_HOME, 'config', 'verify-cmd'));

// The hook registration, with the template's {{HOOKS}} replaced by a real path.
// Hook commands are not tilde-expanded, so this has to be absolute.
const hooksDir = join(BASE_HOME, 'hooks').split('\\').join('/');
const template = readFileSync(join(PACKAGE, 'hooks', 'copilot-base.hooks.json'), 'utf8');
const registration = join(COPILOT_HOME, 'hooks', 'copilot-base.json');
ensureDir(dirname(registration));
if (!dryRun) writeFileSync(registration, template.split('{{HOOKS}}').join(hooksDir));
written.push(registration);

if (!existsSync(join(BASE_HOME, 'config.json'))) {
  writeJson(join(BASE_HOME, 'config.json'), { delivery: 'local', credits: 200 }, false);
}
if (!existsSync(join(BASE_HOME, 'repos.json'))) {
  writeJson(join(BASE_HOME, 'repos.json'), { repos: [] }, false);
}

if (!dryRun) {
  writeFileSync(
    MANIFEST,
    JSON.stringify({ installedAt: new Date().toISOString(), from: PACKAGE, files: written }, null, 2) + '\n'
  );
}

if (dryRun) {
  say(`would write ${written.length} file(s) under ${COPILOT_HOME}:`);
  for (const path of written.slice(0, 12)) say(`  ${path}`);
  if (written.length > 12) say(`  ... and ${written.length - 12} more`);
  process.exit(0);
}

const agents = readdirSync(join(COPILOT_HOME, 'agents')).filter((f) => f.endsWith('.agent.md')).length;
const skills = readdirSync(join(COPILOT_HOME, 'skills')).length;

say(`Installed into ${COPILOT_HOME}`);
say(`  ${agents} agents, ${skills} skills, hooks registered at ${registration}`);
say(`  settings: ${join(BASE_HOME, 'config.json')}   registry: ${join(BASE_HOME, 'repos.json')}`);
say('');
say('That is the whole setup. Next:');
say('');
say('  cd <the folder holding your repositories>');
say('  copilot');
say('  > implement user story ABS-312');
say('');
say('The session brief lists what is there and infers a check per project; the');
say('crew skill takes the request from there. Two things worth knowing:');
say('');
say(`  node ${join(BASE_HOME, 'scripts', 'repos.mjs').split('\\').join('/')} list`);
say('      - checks marked [guessed] are inferred, not confirmed');
say('  MEMORY.md in that folder             loaded into every session, verbatim');
say('');
say('That scripts path is what every skill means by <base>/scripts. The session');
say('brief prints it, so you rarely have to type it.');
say('');
say('Delivery defaults to "local": branches and commits, nothing pushed.');
say('Switch a repo or the machine to "pr" when you want pull requests opened.');
