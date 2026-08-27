#!/usr/bin/env node
// Worktree helper for parallel agent work, across any registered repository.
//
// Parallel agents need isolated checkouts or they fight over the working tree.
// Copilot CLI subagents do not get one - a fleet shares the tree and HEAD - so
// anything that needs its own branch, its own commits, or its own test run gets
// a worktree from here.
//
// Worktrees live under ~/.copilot/copilot-base/worktrees/<repo>/<branch>, never
// beside your checkouts, so nothing appears in or next to a work repository.
//
//   node scripts/wt.mjs new feat/checkout [--repo orders-api]
//   node scripts/wt.mjs ls  [--repo orders-api]
//   node scripts/wt.mjs rm  feat/checkout [--repo orders-api]
//   node scripts/wt.mjs gc  [--repo orders-api]
//
// Without --repo, the repository containing the current directory is used.

import { join } from 'node:path';
import { registry, worktreeRoot } from '../hooks/lib/config.mjs';
import { die, ensureDir, git, log, slug, tryGit } from './lib/shared.mjs';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const [key, inline] = args[i].slice(2).split('=');
    flags[key] = inline ?? (args[i + 1]?.startsWith('--') ? true : args[++i] ?? true);
  } else {
    positional.push(args[i]);
  }
}

const [command, branchArg] = positional;

function target() {
  if (flags.repo) {
    const entry = registry().find((r) => r.name === String(flags.repo));
    if (entry) return { root: entry.path, label: entry.name };
    if (tryGit(['rev-parse', '--git-dir'], String(flags.repo))) {
      return { root: String(flags.repo), label: slug(String(flags.repo).split(/[\\/]/).pop()) };
    }
    die(`no registered repository named '${flags.repo}' (node scripts/repos.mjs list)`);
  }
  const root = tryGit(['rev-parse', '--show-toplevel'], process.cwd());
  if (!root) die('not in a git repository, and no --repo given');
  const entry = registry().find(
    (r) => r.path.replace(/\\/g, '/').toLowerCase() === root.replace(/\\/g, '/').toLowerCase()
  );
  return { root, label: entry?.name ?? root.split(/[\\/]/).pop() };
}

const { root, label } = target();
const wtRoot = join(worktreeRoot(), slug(label));

export function pathFor(branch) {
  return join(wtRoot, slug(branch));
}

function create(branch) {
  if (!branch) die('usage: node scripts/wt.mjs new <branch> [--repo <name>]');
  const path = pathFor(branch);
  if (tryGit(['rev-parse', '--git-dir'], path)) die(`already exists: ${path}`);

  ensureDir(wtRoot);
  const base = tryGit(['symbolic-ref', '--short', 'HEAD'], root) ?? 'main';
  const exists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root) !== null;

  if (exists) git(['worktree', 'add', path, branch], root);
  else git(['worktree', 'add', '-b', branch, path, base], root);

  log(path);
}

function remove(branch) {
  if (!branch) die('usage: node scripts/wt.mjs rm <branch> [--repo <name>]');
  const path = pathFor(branch);
  const status = tryGit(['status', '--porcelain'], path);
  if (status === null) die(`no worktree at ${path}`);
  if (status) die(`worktree is dirty, refusing: ${path}\n${status}`);
  git(['worktree', 'remove', path], root);
  log(`removed ${path}`);
}

function list() {
  log(`${label} (${root})`);
  log(git(['worktree', 'list'], root));
}

/** Remove worktrees whose branch is already an ancestor of the base branch. */
function gc() {
  git(['worktree', 'prune'], root);
  const base = tryGit(['symbolic-ref', '--short', 'HEAD'], root) ?? 'main';
  const porcelain = git(['worktree', 'list', '--porcelain'], root).split(/\r?\n/);

  let current = null;
  for (const line of porcelain) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (!line.startsWith('branch ') || !current) continue;

    const branch = line.slice('branch refs/heads/'.length);
    const path = current;
    if (path.replace(/\\/g, '/') === root.replace(/\\/g, '/')) continue;

    const merged = tryGit(['merge-base', '--is-ancestor', branch, base], root) !== null;
    if (!merged) continue;

    if (tryGit(['status', '--porcelain'], path)) {
      log(`merged but dirty, kept: ${branch} (${path})`);
      continue;
    }
    git(['worktree', 'remove', path], root);
    log(`removed merged ${branch} (${path})`);
  }
}

switch (command) {
  case 'new':
    create(branchArg);
    break;
  case 'ls':
    list();
    break;
  case 'rm':
    remove(branchArg);
    break;
  case 'gc':
    gc();
    break;
  default:
    log('usage: node scripts/wt.mjs <new|ls|rm|gc> [branch] [--repo <name>]');
    process.exit(command ? 1 : 0);
}
