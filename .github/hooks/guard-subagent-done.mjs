// subagentStop: a subagent may not report done while the check is red.
//
// This is the one guardrail with no equivalent in a prompt. "Never report work
// complete on a failing check" is advice a model can forget; here the harness
// refuses the completion and hands back the failure as the next turn's prompt.
//
// Two ways this could go wrong, both handled:
//   - an agent that cannot fix the failure would loop forever. After
//     MAX_BLOCKS refusals the stop is allowed through, with the failure
//     stapled to the response so the caller sees a red slice instead of a
//     confident one.
//   - a pre-existing failure unrelated to the subagent's work would trap it.
//     Same escape hatch, and the appended note says the check was already red.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockStop, emit, pass, readPayload, repoRoot, run } from './lib/hook-io.mjs';
import { runVerify } from './lib/verify.mjs';

const MAX_BLOCKS = 2;
const STATE = join(tmpdir(), 'copilot-base-subagent-blocks.json');
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Count how many times this agent has been refused, and prune entries older
 * than a session plausibly lasts. Without the pruning the file grows forever,
 * and an agent id reused later would start life already at its limit.
 */
function recordBlock(key) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    state = {};
  }

  const now = Date.now();
  for (const [id, entry] of Object.entries(state)) {
    if (!entry?.at || now - entry.at > STALE_AFTER_MS) delete state[id];
  }

  const next = (state[key]?.n ?? 0) + 1;
  state[key] = { n: next, at: now };

  try {
    writeFileSync(STATE, JSON.stringify(state));
  } catch {
    // Losing the counter costs one extra retry, not correctness.
  }
  return next;
}

run(async () => {
  const payload = await readPayload();
  const root = repoRoot(payload.cwd || process.cwd());

  const result = runVerify(root);
  if (!result || result.ok) pass();

  const key = payload.agentId || payload.sessionId || 'unknown';
  const attempts = recordBlock(key);

  if (attempts > MAX_BLOCKS) {
    emit({
      decision: 'allow',
      modifiedResponse:
        `${payload.response ?? ''}\n\n---\n` +
        `VERIFICATION STILL FAILING after ${MAX_BLOCKS} attempts to fix it.\n` +
        `Command: ${result.command}\nExit status: ${result.status}\n\n${result.tail}\n\n` +
        'Treat this slice as incomplete. Either the failure is pre-existing and ' +
        'unrelated, or the work is not finished; check which before merging.',
    });
    process.exit(0);
  }

  blockStop(
    `The verification command is failing, so this work is not done.\n` +
      `Command: ${result.command}\nExit status: ${result.status}\n\n${result.tail}\n\n` +
      'Fix it and finish. If the failure is pre-existing and unrelated to your ' +
      'slice, say so explicitly in your report and finish anyway.'
  );
});
