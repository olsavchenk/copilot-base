// subagentStart: prepend the rules a delegated agent has to follow, whether or
// not the brief it was given remembered to include them.
//
// Kept deliberately short. This text is prepended to every subagent prompt, so
// it is paid for on every delegation - it carries the rules that are expensive
// to get wrong, and nothing else.

import { addContext, configLines, currentBranch, readPayload, repoRoot, run } from './lib/hook-io.mjs';
import { verifyCommand } from './lib/verify.mjs';

run(async () => {
  const payload = await readPayload();
  const root = repoRoot(payload.cwd || process.cwd());

  const lines = ['Rules for delegated work in this repository:', ''];

  const branch = currentBranch(root);
  if (branch) lines.push(`- You are on branch '${branch}'. Never commit to main, master, develop or release/*.`);

  lines.push(
    '- Stay inside the file set you were given. If the work needs a file outside it, stop and report the collision instead of editing it - another agent may own it.',
    '- Every claim about existing behaviour carries a file:line. If you have not read it, do not assert it.'
  );

  const verify = verifyCommand(root);
  if (verify) {
    lines.push(
      `- The check is: ${verify}`,
      '- Run it before you finish and quote its output verbatim in your report. A stop on a red check will be refused.'
    );
  }

  const protectedPaths = configLines(root, 'protected-paths');
  if (protectedPaths.length) {
    lines.push(`- These are off limits without a human decision: ${protectedPaths.join(', ')}`);
  }

  addContext(lines.join('\n'));
});
