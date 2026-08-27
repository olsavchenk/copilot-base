#!/usr/bin/env node
// Fan out independent slices, one isolated worktree and one Copilot session per
// slice, then hand the result to an integrator.
//
// Why this exists when the CLI already has /fleet: fleet subagents share one
// working tree and one HEAD. That is fine when slices only need disjoint files
// and one combined commit. It is not fine when each slice needs its own branch,
// or when the check cannot run twice in the same tree at once - a dev server
// port, a test database, a build directory. That is most real projects.
//
//   node scripts/fanout.mjs run slices.json [--credits 200] [--max-parallel 4]
//   node scripts/fanout.mjs run slices.json --dry-run
//   node scripts/fanout.mjs report [.fanout/<run>]
//
// slices.json:
//   {
//     "base": "main",
//     "credits": 200,
//     "slices": [
//       {
//         "name": "api",
//         "branch": "feat/api",           optional, defaults to feat/<name>
//         "agent": "implementer",         optional
//         "files": ["src/api/**"],        the file set it owns - checked for overlap
//         "interface": "...verbatim...",  optional, copied into the brief
//         "doneWhen": "npm test -- api",  optional, defaults to the repo verify command
//         "brief": "..."                  or "briefFile": "docs/plans/api.md"
//       }
//     ]
//   }

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runVerify } from '../.github/hooks/lib/verify.mjs';
import {
  delegatedArgs,
  die,
  ensureDir,
  git,
  log,
  newSummary,
  readJson,
  repoRoot,
  slug,
  spawnCopilot,
  summariseEvent,
  tryGit,
  worktreeDir,
  writeJson,
} from './lib/shared.mjs';

const root = repoRoot();
const [command, ...rest] = process.argv.slice(2);

const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (arg.startsWith('--')) {
    const [key, inline] = arg.slice(2).split('=');
    flags[key] = inline ?? (rest[i + 1]?.startsWith('--') ? true : rest[++i] ?? true);
  } else {
    positional.push(arg);
  }
}

// ---------------------------------------------------------------- the gate

/**
 * Fan-out is only cheaper than sequential work when the slices are genuinely
 * independent. These are the preconditions from the playbook, checked rather
 * than hoped for.
 */
function gate(plan) {
  const problems = [];
  const slices = plan.slices ?? [];

  if (slices.length < 2) {
    problems.push(
      `only ${slices.length} slice(s) survived the gate - a fan-out of one is pure overhead, do the work directly`
    );
  }

  const names = new Set();
  const branches = new Set();
  for (const slice of slices) {
    if (!slice.name) problems.push('a slice has no name');
    if (names.has(slice.name)) problems.push(`duplicate slice name: ${slice.name}`);
    names.add(slice.name);

    const branch = branchFor(slice);
    if (branches.has(branch)) problems.push(`two slices want the same branch: ${branch}`);
    branches.add(branch);

    if (!briefText(slice)) problems.push(`slice ${slice.name} has no brief`);
    if (!slice.files?.length) {
      problems.push(`slice ${slice.name} does not say which files it owns - overlap cannot be checked`);
    }
  }

  for (const [a, b] of pairs(slices)) {
    const clash = overlap(a.files ?? [], b.files ?? []);
    if (clash) {
      problems.push(
        `slices ${a.name} and ${b.name} both claim ${clash} - overlapping file sets mean they are one slice`
      );
    }
  }

  return problems;
}

function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

/**
 * Practical overlap check, not a general glob intersection: identical patterns,
 * or one pattern's fixed prefix containing the other's. Catches the mistakes
 * people actually make when slicing.
 */
function overlap(a, b) {
  const fixed = (pattern) => pattern.split(/[*?]/)[0].replace(/\/+$/, '');
  for (const left of a) {
    for (const right of b) {
      if (left === right) return left;
      const l = fixed(left);
      const r = fixed(right);
      if (l && r && (l === r || l.startsWith(r + '/') || r.startsWith(l + '/'))) {
        return `${left} / ${right}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- briefs

function branchFor(slice) {
  return slice.branch ?? `feat/${slug(slice.name ?? 'slice')}`;
}

function briefText(slice) {
  if (slice.brief) return slice.brief;
  if (slice.briefFile) {
    try {
      return readFileSync(resolve(root, slice.briefFile), 'utf8');
    } catch {
      return null;
    }
  }
  return null;
}

function writeBrief(dir, slice, plan) {
  const check = slice.doneWhen ?? '(the repository verification command)';
  const body = [
    `# Slice: ${slice.name}`,
    '',
    '## What you own',
    '',
    'Only these files. If the work needs anything outside this set, stop and',
    'report the collision instead of editing it - another agent owns it right now.',
    '',
    ...(slice.files ?? []).map((f) => `- \`${f}\``),
    '',
    ...(slice.interface
      ? ['## Interface you must satisfy, verbatim', '', '```', slice.interface, '```', '']
      : []),
    '## Done when',
    '',
    check,
    '',
    '## The work',
    '',
    briefText(slice) ?? '',
    '',
    '## When you finish',
    '',
    `Commit on branch \`${branchFor(slice)}\`, then report: what you built, the`,
    'check you ran with its output verbatim, anything you touched outside the',
    'expected shape of the slice, and anything the next slice needs to know.',
    ...(plan.notes ? ['', '## Context from the plan', '', plan.notes] : []),
  ].join('\n');

  const path = join(dir, 'BRIEF.md');
  writeFileSync(path, body);
  return path;
}

// ---------------------------------------------------------------- running

function makeWorktree(branch) {
  const path = join(worktreeDir(root), slug(branch));
  if (tryGit(['rev-parse', '--git-dir'], path)) return { path, reused: true };

  ensureDir(worktreeDir(root));
  const base = flags.base ?? tryGit(['symbolic-ref', '--short', 'HEAD'], root) ?? 'main';
  const exists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root) !== null;
  if (exists) git(['worktree', 'add', path, branch], root);
  else git(['worktree', 'add', '-b', branch, path, base], root);
  return { path, reused: false };
}

function checkSlice(slice, worktree) {
  if (slice.doneWhen) {
    const result = spawnSync(slice.doneWhen, {
      cwd: worktree,
      shell: true,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const status = result.status ?? 1;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return {
      command: slice.doneWhen,
      ok: status === 0,
      status,
      tail: output.split(/\r?\n/).slice(-20).join('\n').trim(),
    };
  }
  return runVerify(worktree) ?? { command: null, ok: true, status: 0, tail: 'no check configured' };
}

async function run() {
  const planPath = positional[0];
  if (!planPath) die('usage: node scripts/fanout.mjs run <slices.json> [--dry-run]');

  const plan = readJson(resolve(root, planPath));
  if (!plan) die(`cannot read ${planPath}`);

  const problems = gate(plan);
  if (problems.length) {
    log('Fan-out gate failed:\n');
    for (const problem of problems) log(`  - ${problem}`);
    log('\nRe-slice, or do the work directly. Pushing through produces a conflict');
    log('you will resolve later with less information.');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runDir = ensureDir(join(root, '.fanout', stamp));
  const credits = Number(flags.credits ?? plan.credits ?? 200);
  const maxParallel = Number(flags['max-parallel'] ?? plan.slices.length);

  log(`Fan-out ${stamp}: ${plan.slices.length} slices, ${credits} credits each\n`);

  const jobs = plan.slices.map((slice) => {
    const branch = branchFor(slice);
    const sliceDir = ensureDir(join(runDir, slug(slice.name)));
    const brief = writeBrief(sliceDir, slice, plan);
    return { slice, branch, sliceDir, brief };
  });

  if (flags['dry-run']) {
    for (const job of jobs) {
      log(`  ${job.slice.name}  ->  ${job.branch}  (${(job.slice.files ?? []).join(', ')})`);
      log(`      brief: ${job.brief}`);
    }
    log('\nDry run: nothing spawned, worktrees not created.');
    return;
  }

  const results = [];
  for (const batch of chunk(jobs, maxParallel)) {
    await Promise.all(batch.map((job) => runSlice(job, runDir, credits, results)));
  }

  const report = { run: stamp, root, runDir, base: flags.base ?? null, results };
  writeJson(join(runDir, 'report.json'), report);
  printReport(report);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function runSlice({ slice, branch, sliceDir, brief }, runDir, credits, results) {
  return new Promise((done) => {
    const { path: worktree, reused } = makeWorktree(branch);
    const events = join(sliceDir, 'events.jsonl');
    const transcript = join(sliceDir, 'transcript.md');
    const summary = newSummary();
    const lines = [];

    log(`  [${slice.name}] started in ${worktree}${reused ? ' (existing worktree)' : ''}`);

    const args = delegatedArgs({
      prompt:
        `Read ${brief} and carry out exactly the slice it describes. ` +
        'Stay strictly inside the file set it names.',
      agent: slice.agent ?? 'implementer',
      credits: Number(slice.credits ?? credits),
      model: flags.model ?? slice.model,
      transcript,
    });
    args.push('--add-dir', runDir, '-n', `fanout-${slice.name}`);

    const child = spawnCopilot({
      args,
      cwd: worktree,
      onLine: (line) => {
        lines.push(line);
        summariseEvent(summary, line);
      },
      onExit: (code) => {
        writeFileSync(events, lines.join('\n') + '\n');
        const check = checkSlice(slice, worktree);
        const result = {
          name: slice.name,
          branch,
          worktree,
          exitCode: code,
          events: summary.events,
          tools: summary.tools,
          errors: summary.errors,
          check,
          transcript,
          lastMessage: summary.lastMessage,
        };
        results.push(result);
        log(
          `  [${slice.name}] exit ${code} - check ${check.ok ? 'green' : 'RED'} ` +
            `(${summary.tools} tool calls)`
        );
        done();
      },
    });

    child.on('error', (error) => {
      results.push({ name: slice.name, branch, worktree, exitCode: null, error: String(error) });
      log(`  [${slice.name}] failed to start: ${error.message}`);
      done();
    });
  });
}

// ---------------------------------------------------------------- reporting

function printReport(report) {
  log('\nSlice              Branch                    Exit   Check   Tools');
  log('-----------------------------------------------------------------');
  for (const r of report.results) {
    log(
      `${pad(r.name, 18)} ${pad(r.branch, 25)} ${pad(String(r.exitCode ?? 'err'), 6)} ` +
        `${pad(r.check?.ok ? 'green' : 'RED', 7)} ${r.tools ?? '-'}`
    );
  }

  const red = report.results.filter((r) => !r.check?.ok || r.exitCode !== 0);
  log('');
  if (red.length) {
    log(`${red.length} slice(s) came back red. Read their transcripts before integrating:`);
    for (const r of red) log(`  ${r.name}: ${r.transcript}`);
  } else {
    log('All slices green.');
  }

  log('');
  log('Next: hand this to the integrator - it merges in dependency order, hunts');
  log('interface drift, and runs the full check on the union rather than the parts.');
  log(`  report: ${join(report.runDir, 'report.json')}`);
}

function pad(text, width) {
  return String(text).padEnd(width).slice(0, width);
}

function report() {
  const dir = positional[0] ?? latestRun();
  if (!dir) die('no fan-out runs found under .fanout/');
  const data = readJson(join(resolve(root, dir), 'report.json'));
  if (!data) die(`no report.json in ${dir}`);
  printReport(data);
}

function latestRun() {
  try {
    const runs = readdirSync(join(root, '.fanout')).sort();
    return runs.length ? join(root, '.fanout', runs[runs.length - 1]) : null;
  } catch {
    return null;
  }
}

switch (command) {
  case 'run':
    await run();
    break;
  case 'report':
    report();
    break;
  default:
    log('usage: node scripts/fanout.mjs <run|report> [args]');
    process.exit(command ? 1 : 0);
}
