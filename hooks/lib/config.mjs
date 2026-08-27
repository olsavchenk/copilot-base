// Where the facts about a repository come from, now that the base lives on the
// machine rather than inside any one project.
//
// Two roots, deliberately separate:
//
//   packageRoot  the installed (or checked out) copy of this base - ships the
//                default protected paths and an empty verify command
//   baseHome     the machine's own state: settings, the repository registry,
//                worktrees, run artifacts, fleet state. Under COPILOT_HOME so a
//                test can point the whole thing at a throwaway directory.
//
// The rule that makes a machine-wide install safe: a repository nobody
// registered gets the global protected paths and nothing else. No verify
// command runs in a repository you never opted in.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalDir, fileLines, git, repoConfigLines } from './hook-io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The checked-out or installed copy of this base. */
export function packageRoot() {
  return dirname(HERE.endsWith('lib') ? dirname(HERE) : HERE);
}

/** The machine's state directory. COPILOT_HOME is honoured for tests. */
export function baseHome() {
  if (process.env.COPILOT_BASE_HOME) return process.env.COPILOT_BASE_HOME;
  const copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot');
  return join(copilotHome, 'copilot-base');
}

export function copilotHome() {
  return process.env.COPILOT_HOME || join(homedir(), '.copilot');
}

export function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function settingsPath() {
  return join(baseHome(), 'config.json');
}

export function registryPath() {
  return join(baseHome(), 'repos.json');
}

export function settings() {
  return readJsonFile(settingsPath(), {});
}

export function registry() {
  const data = readJsonFile(registryPath(), { repos: [] });
  return Array.isArray(data.repos) ? data.repos : [];
}

/**
 * A global config file, preferring the machine's copy over the shipped default
 * so editing the installed one is how you change the defaults.
 */
function globalLines(name) {
  const installed = join(baseHome(), 'config', name);
  if (existsSync(installed)) return fileLines(installed);
  return fileLines(join(packageRoot(), 'config', name));
}

function key(path) {
  return canonicalDir(path).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * The main checkout behind a path, so a worktree resolves to the repository it
 * belongs to. Without this, every agent working in a fan-out worktree would
 * look unregistered: no verification command, and only the machine-wide
 * protected paths - exactly the guarantees the fan-out is relying on.
 */
export function mainRepoRoot(root) {
  try {
    const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common) return null;
    const normalised = common.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalised.endsWith('/.git') ? normalised.slice(0, -'/.git'.length) : null;
  } catch {
    return null;
  }
}

/** The registry entry for a repository root, or null if it is not registered. */
export function repoEntry(root) {
  if (!root) return null;
  const candidates = [root];
  const main = mainRepoRoot(root);
  if (main && key(main) !== key(root)) candidates.push(main);

  const repos = registry();
  for (const candidate of candidates) {
    const target = key(candidate);
    for (const entry of repos) {
      if (entry?.path && key(entry.path) === target) return entry;
    }
  }
  return null;
}

/**
 * The check for this repository, or null when there is nothing to run.
 *
 * Repo-local file first (a v1 repository still works), then the registry, then
 * the global default - which ships empty, because one command cannot be right
 * for every repository on the machine.
 */
export function verifyCommandFor(root) {
  const local = repoConfigLines(root, 'verify-cmd')[0];
  if (local) return local;

  const entry = repoEntry(root);
  if (entry?.verify) return entry.verify;

  return globalLines('verify-cmd')[0] ?? null;
}

/**
 * Union, never replacement: a repository may add protected paths but cannot
 * drop one the machine set.
 */
export function protectedPatternsFor(root) {
  const entry = repoEntry(root);
  return [
    ...globalLines('protected-paths'),
    ...(Array.isArray(entry?.protected) ? entry.protected : []),
    ...repoConfigLines(root, 'protected-paths'),
  ].filter((pattern, index, all) => all.indexOf(pattern) === index);
}

/**
 * How finished work leaves the machine. Most specific wins: an explicit flag,
 * then this repository's entry, then the machine setting, then `local`.
 *
 * `local` is the default on purpose. Pushing and opening pull requests is
 * outward-facing and awkward to undo, so it is something you turn on rather
 * than something you discover happened.
 */
export function deliveryFor(root, override) {
  const valid = (value) => (value === 'local' || value === 'pr' ? value : null);
  return (
    valid(override) ?? valid(repoEntry(root)?.delivery) ?? valid(settings().delivery) ?? 'local'
  );
}

export function worktreeRoot() {
  return settings().worktrees
    ? resolve(String(settings().worktrees).replace(/^~/, homedir()))
    : join(baseHome(), 'worktrees');
}

export function runsRoot() {
  return join(baseHome(), 'runs');
}

export function fleetRoot() {
  return join(baseHome(), 'fleet');
}

export function defaultCredits() {
  const value = Number(settings().credits);
  return Number.isFinite(value) && value >= 30 ? value : 200;
}
