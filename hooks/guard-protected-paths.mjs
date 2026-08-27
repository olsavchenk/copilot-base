// preToolUse: refuse edits to files that must not change without a human.
//
// The matcher in the hook config has already narrowed this to write-shaped
// tools, so the work here is finding which path each one touches - the argument
// name differs per tool, and apply_patch does not use an argument at all.
//
// The patterns are the union of the machine-wide list, the registry entry for
// this repository, and any file the repository carries itself, so a global rule
// applies everywhere including repositories nobody registered.

import {
  deny,
  pass,
  readPayload,
  relativeToRoot,
  repoRoot,
  matchesAny,
  run,
  toolArgs,
} from './lib/hook-io.mjs';
import { protectedPatternsFor } from './lib/config.mjs';

const PATH_ARGS = [
  'path',
  'file_path',
  'filePath',
  'target_file',
  'file',
  'source',
  'destination',
  'old_path',
  'new_path',
];

// apply_patch carries its file list inside the patch body, not in an argument.
const PATCH_TARGET = /^\*\*\*\s+(?:Add|Update|Delete|Move)\s+File:\s*(.+?)\s*$/gm;

function targets(args) {
  const found = [];

  for (const key of PATH_ARGS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) found.push(value.trim());
  }

  if (Array.isArray(args.paths)) {
    found.push(...args.paths.filter((p) => typeof p === 'string' && p.trim()));
  }

  const patch = [args.input, args.patch, args.diff].find((v) => typeof v === 'string');
  if (patch) {
    for (const match of patch.matchAll(PATCH_TARGET)) found.push(match[1]);
  }

  return found;
}

run(async () => {
  const payload = await readPayload();
  const cwd = payload.cwd || process.cwd();
  const root = repoRoot(cwd);

  const patterns = protectedPatternsFor(root);
  if (patterns.length === 0) pass();

  for (const target of targets(toolArgs(payload))) {
    const rel = relativeToRoot(root, target, cwd);
    const pattern = matchesAny(rel, patterns);
    if (pattern) {
      deny(
        `${rel} matches the protected pattern "${pattern}". Changing it needs an ` +
          'explicit human decision: say what should change and why, and ask ' +
          'before editing. (Protected paths come from the copilot-base config ' +
          'and this repository\'s registry entry.)'
      );
    }
  }

  pass();
});
