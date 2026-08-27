// The verification command, shared by the two hooks that run it: after an edit,
// and before a subagent is allowed to report done.
//
// The command is one shell line in .github/copilot/verify-cmd. No file, or a
// file with only comments in it, means no verification is configured and both
// hooks stay out of the way - a project that has nothing to run pays nothing.

import { spawnSync } from 'node:child_process';
import { configLines } from './hook-io.mjs';

const TIMEOUT_MS = 300_000;

export function verifyCommand(root) {
  return configLines(root, 'verify-cmd')[0] ?? null;
}

/** Returns null when nothing is configured, otherwise {command, status, tail}. */
export function runVerify(root) {
  const command = verifyCommand(root);
  if (!command) return null;

  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const status = result.status ?? (result.error ? 1 : 0);

  return {
    command,
    status,
    ok: status === 0,
    // Keep the tail: compilers put the useful part last.
    tail: output.split(/\r?\n/).slice(-40).join('\n').trim(),
  };
}
