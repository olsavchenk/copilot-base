// sessionStart: put the state a new session always needs into context once, so
// nobody spends three tool calls rediscovering it.
//
// Worktrees are in here for a specific reason: when a fan-out is running, the
// other agents are in those directories, and a session that does not know that
// will happily edit files someone else owns.
//
// The workspace line exists for the multi-repo case: when a change is landing
// across several API repositories, the state of the *other* repositories is
// part of what this session needs to know before it touches anything.

import { addContext, currentBranch, git, pass, readPayload, repoRoot, run } from './lib/hook-io.mjs';
import { registry, repoEntry } from './lib/config.mjs';

run(async () => {
  const payload = await readPayload();
  const root = repoRoot(payload.cwd || process.cwd());

  const branch = currentBranch(root);
  if (!branch) pass(); // not a git repository; nothing useful to say

  const entry = repoEntry(root);
  const lines = [];
  const dirty = safe(() => git(root, ['status', '--porcelain'])) ?? '';
  const dirtyCount = dirty ? dirty.split(/\r?\n/).filter(Boolean).length : 0;

  lines.push(
    `Repo: ${entry?.name ?? '(not registered)'} | branch: ${branch} | uncommitted files: ${dirtyCount}`
  );
  if (!entry) {
    lines.push(
      'This repository is not in the copilot-base registry, so no verification command runs here.'
    );
  }

  const recent = safe(() => git(root, ['log', '--oneline', '-5']));
  if (recent) lines.push('', 'Recent commits:', recent);

  const worktrees = safe(() => git(root, ['worktree', 'list']));
  const others = worktrees ? worktrees.split(/\r?\n/).slice(1).filter(Boolean).join('\n') : '';
  if (others) {
    lines.push('', 'Active worktrees (other agents may be working in these):', others);
  }

  const busy = otherRepos(root);
  if (busy.length) {
    lines.push('', 'Other repositories in this workspace with work in progress:', ...busy);
  }

  addContext(lines.join('\n'));
});

/** Registered repositories, other than this one, that have uncommitted work. */
function otherRepos(root) {
  const here = root.replace(/\\/g, '/').toLowerCase();
  const out = [];
  for (const entry of registry()) {
    if (!entry?.path || entry.path.replace(/\\/g, '/').toLowerCase() === here) continue;
    const dirty = safe(() => git(entry.path, ['status', '--porcelain']));
    if (dirty === null) continue;
    const count = dirty ? dirty.split(/\r?\n/).filter(Boolean).length : 0;
    const branch = safe(() => git(entry.path, ['symbolic-ref', '--short', 'HEAD'])) ?? '?';
    if (count > 0) out.push(`  ${entry.name}: ${count} uncommitted on ${branch}`);
  }
  return out.slice(0, 10);
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
