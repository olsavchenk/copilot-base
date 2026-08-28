#!/usr/bin/env node
// The repository registry: what used to live in each project, kept outside it.
//
//   node scripts/repos.mjs scan D:/work [--add]
//   node scripts/repos.mjs add D:/work/orders-api --verify "npm test" --role provider
//   node scripts/repos.mjs list
//   node scripts/repos.mjs set orders-api delivery pr
//   node scripts/repos.mjs check [name]
//   node scripts/repos.mjs remove orders-api
//
// A repository that is not registered gets the machine-wide protected paths and
// nothing else - in particular, no verification command runs there. Registering
// one is how you opt it in.

import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import {
  deliveryFor,
  registry,
  registryPath,
  settings,
} from '../hooks/lib/config.mjs';
// Discovery and check inference live beside the hooks, because a session brief
// needs them too. One implementation, so a repository is described the same way
// whether you registered it by hand or a session found it.
import { findRepos, proposeVerify } from '../hooks/lib/discover.mjs';
import { die, invoke, log, readJson, tryGit, writeJson } from './lib/shared.mjs';

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (arg.startsWith('--')) {
    const [key, inline] = arg.slice(2).split('=');
    flags[key] = inline ?? (rest[i + 1]?.startsWith('--') ? true : rest[++i] ?? true);
  } else {
    positional.push(arg);
  }
}

function load() {
  return readJson(registryPath(), { repos: [] });
}

function save(data) {
  writeJson(registryPath(), data);
}

function normalise(path) {
  return resolve(path).split('\\').join('/');
}

// ------------------------------------------------------------------ commands

function scan() {
  const root = positional[0];
  if (!root) die(`usage: ${invoke('repos.mjs')} scan <dir> [--depth 3] [--add]`);

  const depth = Number(flags.depth ?? 3);
  const found = findRepos(root, { depth, limit: 200 });
  if (!found.length) die(`no git repositories under ${root} within ${depth} levels`);

  const data = load();
  const known = new Set(data.repos.map((r) => normalise(r.path).toLowerCase()));

  log(`${found.length} repositor${found.length === 1 ? 'y' : 'ies'} under ${root}:\n`);
  log('Name                 Registered  Proposed check');
  log('---------------------------------------------------------------');

  const additions = [];
  for (const path of found) {
    const name = basename(path);
    const verify = proposeVerify(path);
    const already = known.has(normalise(path).toLowerCase());
    log(`${pad(name, 20)} ${pad(already ? 'yes' : 'no', 11)} ${verify ?? '(none detected)'}`);
    if (!already) additions.push({ name, path: normalise(path), verify: verify ?? null });
  }

  if (!flags.add) {
    log('');
    log('Nothing was written. Re-run with --add to register the unregistered ones,');
    log('or add them one at a time with an explicit check:');
    log(`  ${invoke('repos.mjs')} add <path> --verify "<command>"`);
    return;
  }

  data.repos.push(...additions);
  save(data);
  log('');
  log(`registered ${additions.length} repositor${additions.length === 1 ? 'y' : 'ies'}`);
  const missing = additions.filter((r) => !r.verify).map((r) => r.name);
  if (missing.length) {
    log(`no check detected for: ${missing.join(', ')}`);
    log('Set one, or those repositories run unverified:');
    log(`  ${invoke('repos.mjs')} set <name> verify "<command>"`);
  }
}

function add() {
  const path = positional[0];
  if (!path) die(`usage: ${invoke('repos.mjs')} add <path> [--name x] [--verify "..."]`);
  const full = normalise(path);
  if (!tryGit(['rev-parse', '--git-dir'], full)) die(`not a git repository: ${full}`);

  const data = load();
  const name = String(flags.name ?? basename(full));
  if (data.repos.some((r) => r.name === name)) die(`already registered: ${name}`);

  const entry = { name, path: full };
  entry.verify = flags.verify ? String(flags.verify) : (proposeVerify(full) ?? null);
  if (flags.role) entry.role = String(flags.role);
  if (flags.delivery) entry.delivery = String(flags.delivery);

  data.repos.push(entry);
  save(data);

  log(`registered ${name} -> ${full}`);
  log(`  check:    ${entry.verify ?? '(none - this repository will run unverified)'}`);
  log(`  delivery: ${deliveryFor(full)}`);
}

function list() {
  const repos = registry();
  if (!repos.length) {
    log('no repositories registered');
    log(`  ${invoke('repos.mjs')} scan <dir> --add`);
    return;
  }
  log(`registry: ${registryPath()}`);
  log(`machine delivery default: ${settings().delivery ?? 'local'}\n`);
  log('Name                 Delivery  Role       Check');
  log('---------------------------------------------------------------------');
  for (const r of repos) {
    log(
      `${pad(r.name, 20)} ${pad(deliveryFor(r.path), 9)} ${pad(r.role ?? '-', 10)} ` +
        `${r.verify ?? '(none)'}${r.auto ? '   [guessed]' : ''}`
    );
  }

  if (repos.some((r) => r.auto)) {
    log('');
    log('[guessed] - inferred from the project when a session opened this workspace,');
    log('not confirmed by anyone. Run it, and correct what is wrong:');
    log(`  ${invoke('repos.mjs')} set <name> verify "<command>"`);
  }
}

function set() {
  const [name, key, ...valueParts] = positional;
  const value = valueParts.join(' ');
  if (!name || !key) die(`usage: ${invoke('repos.mjs')} set <name> <verify|delivery|role|path> <value>`);
  if (!['verify', 'delivery', 'role', 'path'].includes(key)) die(`cannot set '${key}'`);
  if (key === 'delivery' && !['local', 'pr'].includes(value)) die("delivery must be 'local' or 'pr'");

  const data = load();
  const entry = data.repos.find((r) => r.name === name);
  if (!entry) die(`no repository named '${name}'`);
  entry[key] = key === 'path' ? normalise(value) : value;
  save(data);
  log(`${name}.${key} = ${entry[key]}`);
}

function remove() {
  const name = positional[0];
  if (!name) die(`usage: ${invoke('repos.mjs')} remove <name>`);
  const data = load();
  const before = data.repos.length;
  data.repos = data.repos.filter((r) => r.name !== name);
  if (data.repos.length === before) die(`no repository named '${name}'`);
  save(data);
  log(`removed ${name}`);
}

/** Run each registered check once, so a red one is found before an agent finds it. */
function check() {
  const only = positional[0];
  const repos = registry().filter((r) => !only || r.name === only);
  if (!repos.length) die(only ? `no repository named '${only}'` : 'no repositories registered');

  let red = 0;
  for (const repo of repos) {
    if (!repo.verify) {
      log(`${pad(repo.name, 20)} skipped   (no check configured)`);
      continue;
    }
    const started = Date.now();
    const result = spawnSync(repo.verify, {
      cwd: repo.path,
      shell: true,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    const ok = (result.status ?? 1) === 0;
    if (!ok) red += 1;
    log(`${pad(repo.name, 20)} ${ok ? 'green' : 'RED  '}     ${seconds}s   ${repo.verify}`);
    if (!ok) {
      const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/).slice(-8);
      for (const line of tail) if (line.trim()) log(`    ${line}`);
    }
  }

  if (red) {
    log('');
    log(`${red} repository check(s) are red before any agent has touched anything.`);
    log('Fix them or correct the command - a check that is already failing trains');
    log('everyone to ignore the hook.');
    process.exit(1);
  }
}

function pad(text, width) {
  return String(text).padEnd(width).slice(0, width);
}

switch (command) {
  case 'scan':
    scan();
    break;
  case 'add':
    add();
    break;
  case 'list':
    list();
    break;
  case 'set':
    set();
    break;
  case 'remove':
    remove();
    break;
  case 'check':
    check();
    break;
  default:
    log(`usage: ${invoke('repos.mjs')} <scan|add|list|set|check|remove> [args]`);
    log(`registry lives at ${registryPath()}`);
    process.exit(command ? 1 : 0);
}
