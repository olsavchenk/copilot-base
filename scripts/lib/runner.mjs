#!/usr/bin/env node
// Detached launcher for one fleet member.
//
// `fleet start` returns immediately, so something has to outlive it and record
// how the session ended. That is this: it spawns the CLI, streams the JSONL
// event stream to a file, and writes result.json when the child exits. Without
// it, a supervisor cannot tell "finished" from "died".
//
//   node scripts/lib/runner.mjs <member-dir>
//
// <member-dir>/spawn.json  {"args": [...], "cwd": "..."}  written by fleet.mjs

import { createWriteStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, spawnCopilot } from './shared.mjs';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: node scripts/lib/runner.mjs <member-dir>\n');
  process.exit(1);
}

const spec = readJson(join(dir, 'spawn.json'));
if (!spec) {
  process.stderr.write(`no spawn.json in ${dir}\n`);
  process.exit(1);
}

const events = createWriteStream(join(dir, 'events.jsonl'), { flags: 'a' });
const startedAt = new Date().toISOString();

const child = spawnCopilot({
  args: spec.args,
  cwd: spec.cwd,
  onLine: (line) => events.write(line + '\n'),
  onExit: (code) => {
    writeFileSync(
      join(dir, 'result.json'),
      JSON.stringify({ exitCode: code, startedAt, finishedAt: new Date().toISOString() }, null, 2)
    );
    events.end();
    process.exit(0);
  },
});

writeFileSync(join(dir, 'child.pid'), String(child.pid ?? ''));

child.on('error', (error) => {
  writeFileSync(
    join(dir, 'result.json'),
    JSON.stringify({ exitCode: null, error: String(error), startedAt }, null, 2)
  );
  process.exit(1);
});
