// Finding repositories, and guessing how to verify them, without being told.
//
// This is what makes the zero-setup path work: you open Copilot in a folder
// that holds several checkouts and the session already knows what is there and
// what proves each one works. Before this, both facts had to be registered by
// hand first.
//
// A guess is still a guess. `proposeVerify` only ever returns a command the
// project itself declares - a package.json script, a go.mod, a Cargo.toml - so
// the worst case is a command that fails for a reason you can read, not one
// invented out of nothing. Anything hand-registered wins over anything guessed.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonFile, registryPath } from './config.mjs';

/** Directories never worth descending into when looking for checkouts. */
const SKIP = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  '__pycache__', '.venv', 'venv', 'Library', 'Pods', 'coverage', 'tmp',
]);

/**
 * Propose a verification command from what the project actually declares.
 *
 * Proposes - never silently adopts something invented. A wrong check is worse
 * than no check: it fails on work that is fine, and everyone learns to ignore
 * the hook that runs it.
 */
export function proposeVerify(path) {
  try {
    const pkgPath = join(path, 'package.json');
    if (existsSync(pkgPath)) {
      const scripts = readJsonFile(pkgPath, {}).scripts ?? {};
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
    if (existsSync(join(path, 'pyproject.toml')) || existsSync(join(path, 'setup.cfg'))) {
      return 'pytest -q';
    }
    if (existsSync(join(path, 'go.mod'))) return 'go build ./... && go test ./...';
    if (existsSync(join(path, 'Cargo.toml'))) return 'cargo check --quiet';
    const entries = readdirSync(path);
    if (entries.some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) {
      return 'dotnet build --nologo -v q';
    }
  } catch {
    // Unreadable project; no proposal. Never throw from here - a hook that
    // throws on preToolUse denies every call in the session.
  }
  return null;
}

/**
 * One line describing what a project is, for the session brief. Cheap reads
 * only: this runs inside a hook with a 15 second budget and a folder may hold
 * a dozen checkouts.
 */
export function describeProject(path) {
  try {
    const pkg = readJsonFile(join(path, 'package.json'), null);
    if (pkg) {
      const bits = [];
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const [name, label] of [
        ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'],
        ['@nestjs/core', 'NestJS'], ['express', 'Express'], ['fastify', 'Fastify'],
      ]) {
        if (deps[name]) bits.push(label);
      }
      if (deps.typescript) bits.push('TypeScript');
      return bits.length ? `Node - ${bits.slice(0, 3).join(', ')}` : 'Node';
    }
    if (existsSync(join(path, 'go.mod'))) return 'Go';
    if (existsSync(join(path, 'Cargo.toml'))) return 'Rust';
    if (existsSync(join(path, 'pyproject.toml')) || existsSync(join(path, 'setup.cfg'))) {
      return 'Python';
    }
    if (readdirSync(path).some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) return '.NET';
  } catch {
    // fall through
  }
  return null;
}

/**
 * Git checkouts at or below `root`, nearest first, never descending into one
 * that was already found. `limit` bounds the walk so a session opened in a
 * directory holding a hundred projects still starts promptly.
 */
export function findRepos(root, { depth = 2, limit = 25 } = {}) {
  const found = [];
  const visit = (dir, level) => {
    if (level > depth || found.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes('.git')) {
      found.push(dir);
      return; // a repository is a leaf; its submodules are its own business
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP.has(entry)) continue;
      const path = join(dir, entry);
      try {
        if (statSync(path).isDirectory()) visit(path, level + 1);
      } catch {
        // unreadable directory; skip
      }
    }
  };
  try {
    visit(resolve(root), 0);
  } catch {
    // never throw
  }
  return found;
}

/**
 * Register repositories a session found beneath its own working directory,
 * with the check each project declares.
 *
 * This is the whole of the zero-setup path: without it, nothing is verified
 * until someone runs a registration command, and an unverified agent is the
 * failure this base exists to prevent.
 *
 * Three properties keep it from being reckless:
 *
 *   - It never overwrites an existing entry. Anything you registered by hand,
 *     or corrected later, wins permanently.
 *   - It records `auto: true` and the workspace it came from, so `repos.mjs
 *     list` can show which checks were guessed and by what.
 *   - It writes a command; it never runs one. Your project's code is executed
 *     by the post-edit check, in a repository you opened and edited.
 *
 * Written through a temporary file and renamed, because two sessions starting
 * at once in the same workspace would otherwise interleave into one JSON file
 * and corrupt it.
 */
export function rememberRepos(rows) {
  const additions = (rows ?? []).filter((r) => r?.path && r?.verify);
  if (!additions.length) return 0;

  const path = registryPath();
  const data = readJsonFile(path, { repos: [] });
  const repos = Array.isArray(data.repos) ? data.repos : [];
  const known = new Set(
    repos.map((e) => String(e?.path ?? '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, ''))
  );

  let added = 0;
  for (const row of additions) {
    const normalised = resolve(row.path).replace(/\\/g, '/');
    if (known.has(normalised.toLowerCase().replace(/\/+$/, ''))) continue;
    if (repos.some((e) => e?.name === row.name)) continue;
    repos.push({
      name: row.name,
      path: normalised,
      verify: row.verify,
      auto: true,
      addedAt: new Date().toISOString(),
    });
    known.add(normalised.toLowerCase());
    added += 1;
  }
  if (!added) return 0;

  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...data, repos }, null, 2) + '\n');
    renameSync(tmp, path);
  } catch {
    return 0; // a session that cannot record this still works, just unverified
  }
  return added;
}
