#!/usr/bin/env node
// Fan out independent slices - across one repository or several - one isolated
// worktree and one Copilot session per slice, then hand the result to a rollout.
//
// Why this exists when the CLI already has /fleet: fleet subagents share one
// working tree and one HEAD. That is fine when slices only need disjoint files
// and one combined commit. It is not fine when each slice needs its own branch,
// when the check cannot run twice in the same tree at once, or when the slices
// are in *different repositories* - which is the whole point of a coordinated
// API change.
//
//   node scripts/fanout.mjs run slices.json [--credits 200] [--max-parallel 4]
//   node scripts/fanout.mjs run slices.json --model "Claude Haiku 4.5 (copilot)" --effort low
//   node scripts/fanout.mjs run slices.json --dry-run
//   node scripts/fanout.mjs report [<run-dir>]
//
// slices.json:
//   {
//     "notes": "context every brief gets",
//     "slices": [
//       {
//         "name": "orders-provider",
//         "repo": "orders-api",            registry name, or a path
//         "branch": "feat/user-email",     optional, defaults to feat/<name>
//         "dependsOn": [],                 slices that must be green first
//         "files": ["src/api/**"],         the file set it owns
//         "interface": "...verbatim...",   the contract, copied into the brief
//         "doneWhen": "npm test -- api",   optional; defaults to the repo's check
//         "model": "Claude Haiku 4.5 (copilot)",   optional; --model overrides it
//         "effort": "low",                         optional; --effort overrides it
//         "brief": "..."                   or "briefFile": "docs/plans/api.md"
//       }
//     ]
//   }
//
// Nothing is written inside a work repository: worktrees and run artifacts live
// under ~/.copilot/copilot-base/.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  copilotHome,
  defaultCredits,
  registry,
  runsRoot,
  verifyCommandFor,
  worktreeRoot,
} from '../hooks/lib/config.mjs';
import {
  delegatedArgs,
  die,
  ensureDir,
  git,
  invoke,
  log,
  newSummary,
  readJson,
  slug,
  spawnCopilot,
  summariseEvent,
  tryGit,
  writeJson,
} from './lib/shared.mjs';

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

// ------------------------------------------------------------- repositories

/**
 * Resolve a slice's repo to a usable absolute path, or null.
 *
 * A registry entry is checked, not trusted: an entry can name a path that was
 * moved, deleted, or hand-edited into a form this platform cannot open. Finding
 * that out at the gate produces one clear line; finding it out mid-run produces
 * a stack trace after some slices have already started.
 */
function repoPath(slice) {
  if (!slice.repo) {
    const here = tryGit(['rev-parse', '--show-toplevel'], process.cwd());
    return here || null;
  }
  const entry = registry().find((r) => r.name === slice.repo);
  const candidate = entry ? entry.path : resolve(String(slice.repo));
  return tryGit(['rev-parse', '--git-dir'], candidate) ? candidate : null;
}

function branchFor(slice) {
  return slice.branch ?? `feat/${slug(slice.name ?? 'slice')}`;
}

const BUILTIN_AGENTS = new Set(['task', 'explore', 'code-review', 'security-review', 'rubber-duck', 'research']);

/**
 * Is this agent actually available to the sessions we are about to start?
 *
 * Worth checking at the gate: a missing agent fails every slice identically,
 * one wasted session at a time, and the CLI's error ("No such agent") only
 * appears inside a transcript nobody is watching yet.
 */
function agentAvailable(name, repo) {
  if (BUILTIN_AGENTS.has(name)) return true;
  if (existsSync(join(copilotHome(), 'agents', `${name}.agent.md`))) return true;
  if (repo && existsSync(join(repo, '.github', 'agents', `${name}.agent.md`))) return true;
  return false;
}

// ---------------------------------------------------------------- the gate

/**
 * Fan-out is only cheaper than sequential work when the slices are genuinely
 * independent *within a wave*. These are the preconditions from the playbook,
 * checked rather than hoped for.
 */
function gate(plan) {
  const problems = [];
  const slices = plan.slices ?? [];

  if (slices.length < 2) {
    problems.push(
      `only ${slices.length} slice(s) - a fan-out of one is pure overhead, do the work directly`
    );
  }

  const names = new Set();
  for (const slice of slices) {
    if (!slice.name) problems.push('a slice has no name');
    if (names.has(slice.name)) problems.push(`duplicate slice name: ${slice.name}`);
    names.add(slice.name);

    if (!briefText(slice)) problems.push(`slice ${slice.name} has no brief`);
    if (!slice.files?.length) {
      problems.push(`slice ${slice.name} does not say which files it owns - overlap cannot be checked`);
    }
    const path = repoPath(slice);
    if (!path) {
      const entry = registry().find((r) => r.name === slice.repo);
      problems.push(
        entry
          ? `slice ${slice.name} names repo "${slice.repo}", registered at ${entry.path}, which is not a usable git repository right now`
          : `slice ${slice.name} names repo "${slice.repo}", which is neither registered nor a git repository (${invoke('repos.mjs')} list)`
      );
    }

    const agent = slice.agent ?? 'implementer';
    if (!agentAvailable(agent, path)) {
      problems.push(
        `slice ${slice.name} wants the '${agent}' agent, which is not installed - run: ${invoke('install.mjs')}`
      );
    }
  }

  for (const dep of slices.flatMap((s) => s.dependsOn ?? [])) {
    if (!names.has(dep)) problems.push(`dependsOn names a slice that is not in this plan: ${dep}`);
  }

  // Two slices in different repositories cannot collide on the filesystem, so
  // only compare file sets within one repository.
  for (const [a, b] of pairs(slices)) {
    if (String(a.repo ?? '') !== String(b.repo ?? '')) continue;
    const clash = overlap(a.files ?? [], b.files ?? []);
    if (clash) {
      problems.push(
        `slices ${a.name} and ${b.name} are in the same repo and both claim ${clash} - that is one slice`
      );
    }
  }

  const branches = new Map();
  for (const slice of slices) {
    const id = `${slice.repo ?? '.'}#${branchFor(slice)}`;
    if (branches.has(id)) problems.push(`two slices want ${branchFor(slice)} in the same repo`);
    branches.set(id, slice.name);
  }

  try {
    waves(slices);
  } catch (error) {
    problems.push(String(error.message));
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

/**
 * Slices grouped into dependency waves. Everything in a wave runs in parallel;
 * the next wave does not start until this one is green. An API change is
 * exactly this shape: the provider has to land before its consumers can be
 * built against it.
 */
export function waves(slices) {
  const done = new Set();
  const out = [];
  let remaining = [...slices];

  while (remaining.length) {
    const ready = remaining.filter((s) => (s.dependsOn ?? []).every((d) => done.has(d)));
    if (!ready.length) {
      throw new Error(
        `dependsOn cannot be satisfied - a cycle, or a missing slice, among: ${remaining
          .map((s) => s.name)
          .join(', ')}`
      );
    }
    out.push(ready);
    for (const slice of ready) done.add(slice.name);
    remaining = remaining.filter((s) => !ready.includes(s));
  }
  return out;
}

// ---------------------------------------------------------------- briefs

function briefText(slice) {
  if (slice.brief) return slice.brief;
  if (slice.briefFile) {
    try {
      return readFileSync(resolve(process.cwd(), slice.briefFile), 'utf8');
    } catch {
      return null;
    }
  }
  return null;
}

function writeBrief(dir, slice, plan, check, repo) {
  const body = [
    `# Slice: ${slice.name}`,
    '',
    `Repository: ${slice.repo ?? '(current)'}  ->  ${repo}`,
    `Branch: ${branchFor(slice)}`,
    '',
    '## What you own',
    '',
    'Only these files, in this repository. If the work needs anything outside',
    'this set, stop and report the collision instead of editing it - another',
    'agent owns it right now, possibly in another repository.',
    '',
    ...(slice.files ?? []).map((f) => `- \`${f}\``),
    '',
    ...(slice.interface
      ? ['## Interface you must satisfy, verbatim', '', '```', slice.interface, '```', '']
      : []),
    '## Done when',
    '',
    check ?? '(no check configured for this repository - say so in your report)',
    '',
    '## The work',
    '',
    briefText(slice) ?? '',
    '',
    '## When you finish',
    '',
    `Commit on \`${branchFor(slice)}\`. Do not push: delivery is handled after all`,
    'slices are green. Then report: what you built, the check you ran with its',
    'output verbatim, anything you touched outside the expected shape of the',
    'slice, and anything a dependent slice needs to know.',
    ...(plan.notes ? ['', '## Context from the plan', '', plan.notes] : []),
  ].join('\n');

  const path = join(dir, 'BRIEF.md');
  writeFileSync(path, body);
  return path;
}

// ---------------------------------------------------------------- running

/** Where this branch is already checked out, if anywhere. */
export function existingWorktree(repo, branch) {
  const porcelain = tryGit(['worktree', 'list', '--porcelain'], repo);
  if (!porcelain) return null;

  let current = null;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim();
    if (line.trim() === `branch refs/heads/${branch}` && current) return current;
  }
  return null;
}

/**
 * A worktree for this slice's branch.
 *
 * Git allows a branch to be checked out in exactly one worktree, so "create a
 * new one" is not always available: a previous run that died, or a worktree
 * root that has since moved, leaves the branch claimed somewhere else. Reusing
 * that checkout is right - the branch is the identity, not the path - and it is
 * a great deal better than a stack trace half way through a wave.
 */
export function makeWorktree(repo, repoLabel, branch, base) {
  const path = join(worktreeRoot(), slug(repoLabel), slug(branch));
  if (tryGit(['rev-parse', '--git-dir'], path)) return { path, reused: true };

  // Clears registrations for directories that no longer exist.
  tryGit(['worktree', 'prune'], repo);

  const claimed = existingWorktree(repo, branch);
  if (claimed) return { path: claimed, reused: true, elsewhere: true };

  ensureDir(join(worktreeRoot(), slug(repoLabel)));
  const from = base ?? (tryGit(['symbolic-ref', '--short', 'HEAD'], repo) ?? 'main');
  const exists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repo) !== null;
  if (exists) git(['worktree', 'add', path, branch], repo);
  else git(['worktree', 'add', '-b', branch, path, from], repo);
  return { path, reused: false };
}

function runCheck(command, worktree) {
  if (!command) return { command: null, ok: true, status: 0, tail: 'no check configured' };
  const result = spawnSync(command, {
    cwd: worktree,
    shell: true,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const status = result.status ?? 1;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
      ok: status === 0,
    status,
    tail: output.split(/\r?\n/).slice(-20).join('\n').trim(),
  };
}

async function run() {
  const planPath = positional[0];
  if (!planPath) die(`usage: ${invoke('fanout.mjs')} run <slices.json> [--dry-run]`);

  const plan = readJson(resolve(process.cwd(), planPath));
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
  const runDir = ensureDir(join(runsRoot(), stamp));
  const credits = Number(flags.credits ?? plan.credits ?? defaultCredits());
  const grouped = waves(plan.slices);

  const jobs = plan.slices.map((slice) => {
    const repo = repoPath(slice);
    const label = slice.repo ?? 'repo';
    const sliceDir = ensureDir(join(runDir, slug(slice.name)));
    const check = slice.doneWhen ?? verifyCommandFor(repo);
    return {
      slice,
      repo,
      label,
      branch: branchFor(slice),
      sliceDir,
      check,
      brief: writeBrief(sliceDir, slice, plan, check, repo),
    };
  });

  log(`Fan-out ${stamp}: ${plan.slices.length} slices in ${grouped.length} wave(s), ${credits} credits each`);
  log(`  worktrees: ${worktreeRoot()}`);
  log(`  artifacts: ${runDir}\n`);

  if (flags['dry-run']) {
    grouped.forEach((wave, index) => {
      log(`  wave ${index + 1}:`);
      for (const slice of wave) {
        const job = jobs.find((j) => j.slice.name === slice.name);
        log(`    ${slice.name}  [${job.label}]  ->  ${job.branch}`);
        log(`        files: ${(slice.files ?? []).join(', ')}`);
        log(`        check: ${job.check ?? '(none)'}`);
        log(`        brief: ${job.brief}`);
      }
    });
    log('\nDry run: nothing spawned, no worktrees created.');
    return;
  }

  const results = [];
  let halted = null;

  for (const [index, wave] of grouped.entries()) {
    log(`wave ${index + 1} of ${grouped.length}: ${wave.map((s) => s.name).join(', ')}`);
    const batch = wave.map((slice) => jobs.find((j) => j.slice.name === slice.name));
    const limit = Number(flags['max-parallel'] ?? batch.length);

    for (const group of chunk(batch, limit)) {
      await Promise.all(group.map((job) => runSlice(job, runDir, credits, index + 1, results)));
    }

    const red = results.filter((r) => r.wave === index + 1 && (!r.check?.ok || r.exitCode !== 0));
    if (red.length) {
      halted = { wave: index + 1, red: red.map((r) => r.name) };
      log(`\nwave ${index + 1} came back red (${halted.red.join(', ')}); later waves are not started.`);
      break;
    }
  }

  const order = plan.slices.map((s) => s.name);
  results.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  const skipped = plan.slices.filter((s) => !results.some((r) => r.name === s.name)).map((s) => s.name);
  const report = { run: stamp, runDir, waves: grouped.map((w) => w.map((s) => s.name)), halted, skipped, results };
  writeJson(join(runDir, 'report.json'), report);
  printReport(report);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function runSlice(job, runDir, credits, wave, results) {
  const { slice, repo, label, branch, sliceDir, brief, check } = job;
  return new Promise((done) => {
    const { path: worktree, reused, elsewhere } = makeWorktree(
      repo,
      label,
      branch,
      flags.base ? String(flags.base) : undefined
    );
    const events = join(sliceDir, 'events.jsonl');
    const transcript = join(sliceDir, 'transcript.md');
    const summary = newSummary();
    const lines = [];

    log(
      `  [${slice.name}] ${label} -> ${branch}` +
        (elsewhere ? ` (reusing worktree at ${worktree})` : reused ? ' (existing worktree)' : '')
    );

    const args = delegatedArgs({
      prompt:
        `Read ${brief} and carry out exactly the slice it describes. ` +
        'Stay strictly inside the file set it names, in this repository only.',
      agent: slice.agent ?? 'implementer',
      credits: Number(slice.credits ?? credits),
      model: flags.model ?? slice.model,
      // A slice can raise its own level above whatever its agent pins - the
      // same work is harder in one repository than another - which is why this
      // stays per slice rather than being left to the agent definition.
      effort: flags.effort ?? slice.effort,
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
        const outcome = runCheck(check, worktree);
        results.push({
          name: slice.name,
          repo: label,
          repoPath: repo,
          wave,
          branch,
          worktree,
          exitCode: code,
          events: summary.events,
          tools: summary.tools,
          check: outcome,
          transcript,
          lastMessage: summary.lastMessage,
        });
        log(`  [${slice.name}] exit ${code} - check ${outcome.ok ? 'green' : 'RED'} (${summary.tools} tool calls)`);
        done();
      },
    });

    child.on('error', (error) => {
      results.push({ name: slice.name, repo: label, wave, branch, worktree, exitCode: null, error: String(error) });
      log(`  [${slice.name}] failed to start: ${error.message}`);
      done();
    });
  });
}

// ---------------------------------------------------------------- reporting

function printReport(report) {
  log('\nSlice              Repo            Wave  Branch                Exit  Check');
  log('---------------------------------------------------------------------------');
  for (const r of report.results) {
    log(
      `${pad(r.name, 18)} ${pad(r.repo, 15)} ${pad(String(r.wave), 5)} ${pad(r.branch, 21)} ` +
        `${pad(String(r.exitCode ?? 'err'), 5)} ${r.check?.ok ? 'green' : 'RED'}`
    );
  }

  const red = report.results.filter((r) => !r.check?.ok || r.exitCode !== 0);
  log('');
  if (red.length) {
    log(`${red.length} slice(s) came back red. Read their transcripts before going further:`);
    for (const r of red) log(`  ${r.name}: ${r.transcript}`);
  } else {
    log('All slices green.');
  }
  if (report.skipped?.length) {
    log(`Not started because an earlier wave failed: ${report.skipped.join(', ')}`);
  }

  log('');
  log('Next: hand this to @rollout - it sequences the repositories, verifies each');
  log('consumer against its provider, and delivers according to your delivery mode.');
  log(`  report: ${join(report.runDir, 'report.json')}`);
}

function pad(text, width) {
  return String(text).padEnd(width).slice(0, width);
}

function report() {
  const dir = positional[0] ?? latestRun();
  if (!dir) die(`no fan-out runs found under ${runsRoot()}`);
  const data = readJson(join(resolve(dir), 'report.json'));
  if (!data) die(`no report.json in ${dir}`);
  printReport(data);
}

function latestRun() {
  try {
    const runs = readdirSync(runsRoot()).sort();
    return runs.length ? join(runsRoot(), runs[runs.length - 1]) : null;
  } catch {
    return null;
  }
}

// Guarded so `waves()` can be imported and unit-tested without running the CLI.
if (process.argv[1]?.endsWith('fanout.mjs')) {
  switch (command) {
    case 'run':
      await run();
      break;
    case 'report':
      report();
      break;
    default:
      log(`usage: ${invoke('fanout.mjs')} <run|report> [args]`);
      if (!existsSync(runsRoot())) log(`(no runs yet; artifacts will go to ${runsRoot()})`);
      process.exit(command ? 1 : 0);
  }
}
