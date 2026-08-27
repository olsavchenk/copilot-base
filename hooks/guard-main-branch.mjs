// preToolUse: refuse commits and pushes that would land straight on an
// integration branch. Work happens on a branch and arrives via a PR.
//
// Override a single command by prefixing it with COPILOT_BASE_ALLOW_DIRECT=1,
// or by exporting that variable before starting the session. Both are visible
// choices a human makes, which is the point.

import { deny, git, pass, readPayload, repoRoot, run, toolArgs } from './lib/hook-io.mjs';

const PROTECTED = /^(main|master|develop|release\/.*)$/;
const LANDS_ON_REMOTE = /\bgit\s+(commit|push)\b/;
const OVERRIDE = 'COPILOT_BASE_ALLOW_DIRECT=1';

function commandText(args) {
  return [args.command, args.input, args.text, args.script]
    .filter((v) => typeof v === 'string')
    .join('\n');
}

run(async () => {
  if (process.env.COPILOT_BASE_ALLOW_DIRECT === '1') pass();

  const payload = await readPayload();
  const command = commandText(toolArgs(payload));

  if (!command || command.includes(OVERRIDE)) pass();
  if (!LANDS_ON_REMOTE.test(command)) pass();

  const cwd = payload.cwd || process.cwd();
  const root = repoRoot(cwd);

  // symbolic-ref, not rev-parse: on an unborn branch rev-parse reports "HEAD".
  let branch;
  try {
    branch = git(root, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    pass();
  }

  if (!PROTECTED.test(branch)) pass();

  deny(
    `You are on '${branch}', which is an integration branch. Create a working ` +
      'branch first (git checkout -b <type>/<slug>) and open a PR. If landing ' +
      'directly is genuinely intended, the human has to say so, and the command ' +
      `must be prefixed with ${OVERRIDE}.`
  );
});
