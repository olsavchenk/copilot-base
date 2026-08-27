#!/usr/bin/env node
// Worktree helper for parallel agent work.
//
// Parallel agents need isolated checkouts or they fight over the working tree.
// Copilot CLI subagents do not get one - a fleet shares the tree and HEAD - so
// anything that needs its own branch, its own commits, or its own test run gets
// a worktree from here.
//
//   node scripts/wt.mjs new feat/checkout   create ../<repo>-wt/feat-checkout
//   node scripts/wt.mjs ls                  list worktrees and their branches
//   node scripts/wt.mjs rm  feat/checkout   remove it (refuses if dirty)
//   node scripts/wt.mjs gc                  drop worktrees whose branch is merged

import { join } from 'node:path';
import { die, ensureDir, git, log, repoRoot, slug, tryGit, worktreeDir } from './lib/shared.mjs';

const [command, argument] = process.argv.slice(2);
const root = repoRoot();
const wtRoot = worktreeDir(root);

export function pathFor(branch) {
  return join(wtRoot, slug(branch));
}

function create(branch) {
  if (!branch) die('usage: node scripts/wt.mjs new <branch>');
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
  if (!branch) die('usage: node scripts/wt.mjs rm <branch>');
  const path = pathFor(branch);
  const status = tryGit(['status', '--porcelain'], path);
  if (status === null) die(`no worktree at ${path}`);
  if (status) die(`worktree is dirty, refusing: ${path}\n${status}`);
  git(['worktree', 'remove', path], root);
  log(`removed ${path}`);
}

function list() {
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
    create(argument);
    break;
  case 'ls':
    list();
    break;
  case 'rm':
    remove(argument);
    break;
  case 'gc':
    gc();
    break;
  default:
    log('usage: node scripts/wt.mjs <new|ls|rm|gc> [branch]');
    process.exit(command ? 1 : 0);
}
