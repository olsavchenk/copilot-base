// The verification command, shared by the two hooks that run it: after an edit,
// and before a subagent is allowed to report done.
//
// Where the command comes from is config.mjs's problem. What matters here is
// that an unregistered repository returns nothing and both hooks stay silent -
// a machine-wide install must not run some other project's test suite in a
// repository you only opened to read.

import { spawnSync } from 'node:child_process';
import { verifyCommandFor } from './config.mjs';

const TIMEOUT_MS = 300_000;

export function verifyCommand(root) {
  return verifyCommandFor(root);
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
