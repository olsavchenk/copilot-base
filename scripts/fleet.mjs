#!/usr/bin/env node
// A fleet of named, resumable Copilot sessions.
//
// The unit here is a *session*, not a process. `copilot -p` exits when the turn
// ends, but the session survives in the CLI session store, so a member can be
// addressed again later by id: that is what makes `say`, `restart` and a
// watchdog possible without building a message bus.
//
//   node scripts/fleet.mjs start api --brief docs/plans/api.md --worktree feat/api
//   node scripts/fleet.mjs list
//   node scripts/fleet.mjs status [api]
//   node scripts/fleet.mjs say api "the schema changed, rebase onto main"
//   node scripts/fleet.mjs restart api
//   node scripts/fleet.mjs stop api
//   node scripts/fleet.mjs watch --interval 120 --max-restarts 3
//
// Autonomy comes from autopilot, not from a long-lived process:
//   node scripts/fleet.mjs start api --brief b.md --autopilot 20
//
// On supervision: two lead agents watching each other is a way to turn a silent
// failure into a detected one. A watchdog loop does the same job deterministically,
// at no credit cost, and it cannot itself hallucinate that everything is fine.
// Use `watch` for liveness; use a lead agent for the judgment call about whether
// a stalled member should be re-briefed, restarted or killed.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  IS_WINDOWS,
  delegatedArgs,
  delegatedEnv,
  die,
  ensureDir,
  log,
  readJson,
  repoRoot,
  slug,
  tryGit,
  worktreeDir,
  writeJson,
  git,
} from './lib/shared.mjs';

const root = repoRoot();
const fleetDir = join(root, '.fleet');
const statePath = join(fleetDir, 'state.json');

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

function state() {
  return readJson(statePath, { members: {} });
}

function saveState(next) {
  writeJson(statePath, next);
}

function member(name) {
  const found = state().members[name];
  if (!found) die(`no fleet member named '${name}' - run: node scripts/fleet.mjs list`);
  return found;
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function memberDir(name) {
  return join(fleetDir, slug(name));
}

function incident(text) {
  ensureDir(fleetDir);
  appendFileSync(join(fleetDir, 'incidents.log'), `${new Date().toISOString()} ${text}\n`);
}

// ---------------------------------------------------------------- start

function briefFor(dir) {
  if (flags.brief) {
    const path = resolve(root, String(flags.brief));
    if (existsSync(path)) return path;
    die(`brief file not found: ${path}`);
  }
  if (flags.prompt) {
    const path = join(dir, 'BRIEF.md');
    writeFileSync(path, String(flags.prompt) + '\n');
    return path;
  }
  die(`start needs --brief <file> or --prompt "<text>"`);
}

function workdirFor() {
  const branch = flags.worktree ? String(flags.worktree) : null;
  if (!branch) return { cwd: root, branch: tryGit(['symbolic-ref', '--short', 'HEAD'], root) };

  const path = join(worktreeDir(root), slug(branch));
  if (!tryGit(['rev-parse', '--git-dir'], path)) {
    ensureDir(worktreeDir(root));
    const base = tryGit(['symbolic-ref', '--short', 'HEAD'], root) ?? 'main';
    const exists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root) !== null;
    if (exists) git(['worktree', 'add', path, branch], root);
    else git(['worktree', 'add', '-b', branch, path, base], root);
  }
  return { cwd: path, branch };
}

function launch({ name, dir, cwd, sessionId, prompt, agent, resume }) {
  const args = delegatedArgs({
    prompt,
    agent,
    credits: Number(flags.credits ?? 300),
    model: flags.model,
    transcript: join(dir, 'transcript.md'),
  });

  if (resume) args.push('--resume', sessionId);
  else args.push('--session-id', sessionId, '-n', `fleet-${name}`);

  if (flags.autopilot) {
    args.push('--autopilot');
    const continues = flags.autopilot === true ? 10 : Number(flags.autopilot);
    args.push('--max-autopilot-continues', String(continues));
  }
  args.push('--add-dir', dir);

  writeJson(join(dir, 'spawn.json'), { args, cwd });

  const runner = spawn(process.execPath, [join(root, 'scripts', 'lib', 'runner.mjs'), dir], {
    cwd: root,
    detached: !IS_WINDOWS,
    windowsHide: true,
    stdio: 'ignore',
  });
  runner.unref();
  return runner.pid;
}

function start() {
  const name = positional[0];
  if (!name) die('usage: node scripts/fleet.mjs start <name> --brief <file> [--worktree <branch>]');

  const current = state();
  if (current.members[name] && alive(current.members[name].pid)) {
    die(`'${name}' is already running (pid ${current.members[name].pid})`);
  }

  const dir = ensureDir(memberDir(name));
  const brief = briefFor(dir);
  const { cwd, branch } = workdirFor();
  const sessionId = randomUUID();
  const agent = flags.agent ? String(flags.agent) : 'implementer';

  const pid = launch({
    name,
    dir,
    cwd,
    sessionId,
    agent,
    prompt: `Read ${brief} and carry out exactly what it describes. Stay strictly inside the file set it names.`,
  });

  current.members[name] = {
    name,
    sessionId,
    pid,
    agent,
    cwd,
    branch,
    brief,
    dir,
    startedAt: new Date().toISOString(),
    restarts: 0,
  };
  saveState(current);

  log(`${name}: session ${sessionId} started in ${cwd} (pid ${pid})`);
  log(`  transcript: ${join(dir, 'transcript.md')}`);
}

// ---------------------------------------------------------------- inspect

function describe(m) {
  const result = readJson(join(m.dir, 'result.json'));
  const running = alive(m.pid) && !result;
  const status = running ? 'running' : result ? (result.exitCode === 0 ? 'finished' : 'failed') : 'gone';
  return { ...m, status, result, running };
}

function list() {
  const members = Object.values(state().members);
  if (!members.length) return log('no fleet members');
  log('Name            Status     Branch                Restarts  Session');
  log('----------------------------------------------------------------------');
  for (const m of members.map(describe)) {
    log(
      `${pad(m.name, 15)} ${pad(m.status, 10)} ${pad(m.branch ?? '-', 21)} ` +
        `${pad(String(m.restarts), 9)} ${m.sessionId.slice(0, 8)}`
    );
  }
}

function status() {
  const name = positional[0];
  if (!name) return list();

  const m = describe(member(name));
  log(`${m.name}: ${m.status}`);
  log(`  session   ${m.sessionId}`);
  log(`  agent     ${m.agent}`);
  log(`  cwd       ${m.cwd}`);
  log(`  branch    ${m.branch ?? '-'}`);
  log(`  restarts  ${m.restarts}`);
  if (m.result) log(`  exit      ${m.result.exitCode} at ${m.result.finishedAt ?? '-'}`);

  const transcript = join(m.dir, 'transcript.md');
  if (existsSync(transcript)) {
    const tail = readFileSync(transcript, 'utf8').split(/\r?\n/).filter(Boolean).slice(-12);
    log('\n  last of the transcript:');
    for (const line of tail) log(`    ${line}`);
  }

  if (m.branch) {
    const dirty = tryGit(['status', '--porcelain'], m.cwd);
    log(`\n  uncommitted files: ${dirty ? dirty.split(/\r?\n/).filter(Boolean).length : 0}`);
    const commits = tryGit(['log', '--oneline', '-3'], m.cwd);
    if (commits) log(`  recent commits:\n${commits.split(/\r?\n/).map((l) => '    ' + l).join('\n')}`);
  }
}

// ---------------------------------------------------------------- talk

/**
 * A turn on an existing session. This is the cross-process equivalent of
 * messaging a running agent - the CLI's own `write_agent` tool only reaches
 * subagents inside one session.
 */
function say() {
  const [name, ...words] = positional;
  const message = words.join(' ');
  if (!name || !message) die('usage: node scripts/fleet.mjs say <name> "<message>"');

  const m = describe(member(name));
  if (m.running && !flags.force) {
    die(
      `'${name}' is still running. Two processes on one session will fight; wait, ` +
        'or pass --force if you know it is wedged.'
    );
  }

  const args = ['--resume', m.sessionId, '-p', message, '--allow-all-tools', '--no-ask-user', '-s'];
  const result = spawnSync('copilot', IS_WINDOWS ? args.map((a) => `"${String(a).replace(/"/g, '""')}"`) : args, {
    cwd: m.cwd,
    shell: IS_WINDOWS,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: delegatedEnv(),
  });

  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) process.stderr.write(result.stderr ?? '');
}

function restart(name = positional[0], reason = 'manual restart') {
  if (!name) die('usage: node scripts/fleet.mjs restart <name>');
  const current = state();
  const m = current.members[name];
  if (!m) die(`no fleet member named '${name}'`);

  if (alive(m.pid) && !flags.force) die(`'${name}' is still running; stop it first or pass --force`);

  const pid = launch({
    name,
    dir: m.dir,
    cwd: m.cwd,
    sessionId: m.sessionId,
    agent: m.agent,
    resume: true,
    prompt:
      'Your previous run ended before the work was finished. Re-read your brief at ' +
      `${m.brief}, check what you have already changed with git status and git diff, ` +
      'and continue from there. Do not start over.',
  });

  m.pid = pid;
  m.restarts = (m.restarts ?? 0) + 1;
  m.restartedAt = new Date().toISOString();
  saveState(current);
  incident(`restarted ${name} (${reason}), attempt ${m.restarts}`);
  log(`${name}: restarted on session ${m.sessionId} (pid ${pid}, restart ${m.restarts})`);
}

function stop() {
  const name = positional[0];
  if (!name) die('usage: node scripts/fleet.mjs stop <name>');
  const current = state();
  const m = current.members[name];
  if (!m) die(`no fleet member named '${name}'`);

  const child = readJson(join(m.dir, 'result.json')) ? null : readPid(join(m.dir, 'child.pid'));
  for (const pid of [child, m.pid].filter(Boolean)) killTree(pid);

  m.stoppedAt = new Date().toISOString();
  saveState(current);
  incident(`stopped ${name}`);
  log(`${name}: stopped`);
}

function readPid(path) {
  try {
    const value = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function killTree(pid) {
  try {
    if (IS_WINDOWS) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------- watch

async function watch() {
  const interval = Number(flags.interval ?? 120) * 1000;
  const maxRestarts = Number(flags['max-restarts'] ?? 3);
  log(`watching ${Object.keys(state().members).length} member(s) every ${interval / 1000}s`);
  log('ctrl-c to stop\n');

  for (;;) {
    const current = state();
    const members = Object.values(current.members).map(describe);
    const running = members.filter((m) => m.running);
    const broken = members.filter((m) => m.status === 'failed' || m.status === 'gone');

    log(
      `${new Date().toISOString()}  running ${running.length}  ` +
        `finished ${members.filter((m) => m.status === 'finished').length}  broken ${broken.length}`
    );

    for (const m of broken) {
      if (m.stoppedAt) continue; // stopped on purpose
      if ((m.restarts ?? 0) >= maxRestarts) {
        log(`  ${m.name}: ${m.status}, ${m.restarts} restarts already - leaving it for a human`);
        continue;
      }
      log(`  ${m.name}: ${m.status}, restarting`);
      restart(m.name, m.status);
    }

    if (members.length && members.every((m) => m.status === 'finished' || m.stoppedAt)) {
      log('\nall members finished');
      return;
    }

    await new Promise((r) => setTimeout(r, interval));
  }
}

function pad(text, width) {
  return String(text).padEnd(width).slice(0, width);
}

switch (command) {
  case 'start':
    start();
    break;
  case 'list':
    list();
    break;
  case 'status':
    status();
    break;
  case 'say':
    say();
    break;
  case 'restart':
    restart();
    break;
  case 'stop':
    stop();
    break;
  case 'watch':
    await watch();
    break;
  default:
    log('usage: node scripts/fleet.mjs <start|list|status|say|restart|stop|watch> [args]');
    process.exit(command ? 1 : 0);
}
