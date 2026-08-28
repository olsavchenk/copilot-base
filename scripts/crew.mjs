#!/usr/bin/env node
// Start a crew run from the shell, without opening an interactive session.
//
//   node scripts/crew.mjs "implement user story ABS-312"
//   node scripts/crew.mjs "fix the failing orders test" --repo orders-api
//   node scripts/crew.mjs "add rate limiting" --bg      # detached, returns at once
//
// Copilot CLI has no custom slash commands - the slash namespace is fixed - so
// `/crew` cannot exist. Inside a session you do not need it: the crew skill
// triggers on a plain request. This is the other case, starting work from a
// terminal without a session at all, which is worth exactly this much code.
//
// It is a thin front end. All it does is aim the crew skill at a goal, in a
// directory, with the guardrails on. Anything cleverer belongs in the skill,
// where a model can read it.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { registry, defaultCredits } from '../hooks/lib/config.mjs';
import {
  IS_WINDOWS,
  delegatedArgs,
  delegatedEnv,
  die,
  log,
  spawnCopilot,
  tryGit,
} from './lib/shared.mjs';

const argv = process.argv.slice(2);
const flags = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith('--')) {
    const [key, inline] = arg.slice(2).split('=');
    flags[key] = inline ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true);
  } else {
    words.push(arg);
  }
}

const goal = words.join(' ').trim();
if (!goal || flags.help) {
  log('usage: node scripts/crew.mjs "<what you want done>" [--repo <name|path>] [--bg]');
  log('');
  log('  --repo <name|path>  start in this repository (default: the current directory)');
  log('  --bg                detach and return immediately');
  log('  --credits <n>       AI credit cap for the run');
  log('  --model <name>      model override');
  process.exit(flags.help ? 0 : 1); // asking for help succeeded; forgetting the goal did not
}

/** Where the run happens: a registered name, a path, or wherever you are. */
function workingDir() {
  if (!flags.repo) return process.cwd();
  const name = String(flags.repo);
  const entry = registry().find((r) => r.name === name);
  if (entry) return entry.path;
  const path = resolve(name);
  if (tryGit(['rev-parse', '--git-dir'], path)) return path;
  die(`no registered repository named '${name}', and '${path}' is not a git checkout`);
}

const cwd = workingDir();

// The skill is named in the prompt rather than left to trigger on its own. From
// a one-shot invocation there is no conversation to disambiguate against, and a
// run that quietly did not use the workflow is worse than one that refused to.
const prompt =
  `Use the crew skill to take this all the way to verified work: ${goal}\n\n` +
  'Follow the skill exactly, including the report format and the rule about ' +
  'not pushing or opening a pull request unless the delivery mode says so.';

const args = delegatedArgs({
  prompt,
  credits: Number(flags.credits ?? defaultCredits()),
  model: flags.model ? String(flags.model) : undefined,
});

log(`crew: ${goal}`);
log(`  in: ${cwd}`);

if (flags.bg) {
  // delegatedEnv() carries the opt-in that keeps repository hooks alive in a
  // delegated session. Spawning without it starts a run with every guardrail
  // silently off, which is the one failure mode nobody would notice.
  const child = spawn('copilot', IS_WINDOWS ? args.map(quote) : args, {
    cwd,
    shell: IS_WINDOWS,
    detached: !IS_WINDOWS,
    windowsHide: true,
    stdio: 'ignore',
    env: delegatedEnv(),
  });
  child.unref();
  log(`  started in the background (pid ${child.pid})`);
  log('  it will not push or open a pull request; check back with git log and git status');
  process.exit(0);
}

spawnCopilot({
  args,
  cwd,
  onLine: () => {},
  onExit: (code) => process.exit(code ?? 0),
});

function quote(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}
