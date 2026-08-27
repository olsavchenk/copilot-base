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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  baseHome,
  deliveryFor,
  registry,
  registryPath,
  settings,
} from '../hooks/lib/config.mjs';
import { die, log, readJson, tryGit, writeJson } from './lib/shared.mjs';

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

/**
 * Propose a verification command from what the project actually declares.
 * Proposes - never silently adopts. A wrong check is worse than no check: it
 * fails on work that is fine, and everyone learns to ignore the hook.
 */
function proposeVerify(path) {
  const pkgPath = join(path, 'package.json');
  if (existsSync(pkgPath)) {
    const scripts = readJson(pkgPath, {}).scripts ?? {};
    const runner = existsSync(join(path, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(path, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
    const run = (name) => (runner === 'npm' ? `npm run ${name}` : `${runner} ${name}`);
    const parts = [];
    if (scripts.typecheck) parts.push(run('typecheck'));
    else if (scripts.build) parts.push(run('build'));
    if (scripts.test) parts.push(runner === 'npm' ? 'npm test' : `${runner} test`);
    if (parts.length) return parts.join(' && ');
  }
  if (existsSync(join(path, 'pyproject.toml')) || existsSync(join(path, 'setup.cfg'))) return 'pytest -q';
  if (existsSync(join(path, 'go.mod'))) return 'go build ./... && go test ./...';
  if (existsSync(join(path, 'Cargo.toml'))) return 'cargo check --quiet';
  if (readdirSync(path).some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) {
    return 'dotnet build --nologo -v q';
  }
  return null;
}

function findRepos(root, depth) {
  const found = [];
  const visit = (dir, level) => {
    if (level > depth) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes('.git')) {
      found.push(dir);
      return; // do not descend into a repository
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const path = join(dir, entry);
      try {
        if (statSync(path).isDirectory()) visit(path, level + 1);
      } catch {
        // unreadable directory; skip
      }
    }
  };
  visit(resolve(root), 0);
  return found;
}

// ------------------------------------------------------------------ commands

function scan() {
  const root = positional[0];
  if (!root) die('usage: node scripts/repos.mjs scan <dir> [--depth 3] [--add]');

  const depth = Number(flags.depth ?? 3);
  const found = findRepos(root, depth);
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
    log('  node scripts/repos.mjs add <path> --verify "<command>"');
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
    log('  node scripts/repos.mjs set <name> verify "<command>"');
  }
}

function add() {
  const path = positional[0];
  if (!path) die('usage: node scripts/repos.mjs add <path> [--name x] [--verify "..."]');
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
    log('  node scripts/repos.mjs scan <dir> --add');
    return;
  }
  log(`registry: ${registryPath()}`);
  log(`machine delivery default: ${settings().delivery ?? 'local'}\n`);
  log('Name                 Delivery  Role       Check');
  log('---------------------------------------------------------------------');
  for (const r of repos) {
    log(
      `${pad(r.name, 20)} ${pad(deliveryFor(r.path), 9)} ${pad(r.role ?? '-', 10)} ` +
        `${r.verify ?? '(none)'}`
    );
  }
}

function set() {
  const [name, key, ...valueParts] = positional;
  const value = valueParts.join(' ');
  if (!name || !key) die('usage: node scripts/repos.mjs set <name> <verify|delivery|role|path> <value>');
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
  if (!name) die('usage: node scripts/repos.mjs remove <name>');
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
    log('usage: node scripts/repos.mjs <scan|add|list|set|check|remove> [args]');
    log(`registry lives at ${join(baseHome(), 'repos.json')}`);
    process.exit(command ? 1 : 0);
}
