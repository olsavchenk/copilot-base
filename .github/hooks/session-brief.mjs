// sessionStart: put the state a new session always needs into context once, so
// nobody spends three tool calls rediscovering it.
//
// Worktrees are in here for a specific reason: when a fan-out is running, the
// other agents are in those directories, and a session that does not know that
// will happily edit files someone else owns.

import { addContext, currentBranch, git, pass, readPayload, repoRoot, run } from './lib/hook-io.mjs';

run(async () => {
  const payload = await readPayload();
  const root = repoRoot(payload.cwd || process.cwd());

  const branch = currentBranch(root);
  if (!branch) pass(); // not a git repository; nothing useful to say

  const lines = [];
  const dirty = safe(() => git(root, ['status', '--porcelain'])) ?? '';
  const dirtyCount = dirty ? dirty.split(/\r?\n/).filter(Boolean).length : 0;
  lines.push(`Branch: ${branch} | uncommitted files: ${dirtyCount}`);

  const recent = safe(() => git(root, ['log', '--oneline', '-5']));
  if (recent) lines.push('', 'Recent commits:', recent);

  const worktrees = safe(() => git(root, ['worktree', 'list']));
  const others = worktrees
    ? worktrees.split(/\r?\n/).slice(1).filter(Boolean).join('\n')
    : '';
  if (others) {
    lines.push('', 'Active worktrees (other agents may be working in these):', others);
  }

  addContext(lines.join('\n'));
});

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
