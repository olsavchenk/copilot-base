// postToolUse: run the project's verification command after code changes and
// feed failures straight back into the transcript.
//
// The point is not to be a CI replacement. It is to close the loop agents get
// wrong most often: writing code, declaring it done, and never running it. A
// failing check becomes context the agent has to deal with in the same turn.

import { addContext, pass, readPayload, repoRoot, run } from './lib/hook-io.mjs';
import { runVerify } from './lib/verify.mjs';

run(async () => {
  const payload = await readPayload();
  const root = repoRoot(payload.cwd || process.cwd());

  const result = runVerify(root);
  if (!result || result.ok) pass();

  addContext(
    `Verification failed after your edit.\n` +
      `Command: ${result.command}\nExit status: ${result.status}\n\n${result.tail}\n\n` +
      'Fix this before moving on or reporting the task complete. If the failure ' +
      'is pre-existing and unrelated to your change, say so explicitly.'
  );
});
