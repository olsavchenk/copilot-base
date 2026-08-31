// Shared plumbing for the orchestration scripts.
//
// Zero dependencies on purpose: these drive work in repositories of every
// language, most of which are not JavaScript projects at all, and `npm install`
// is not a reasonable precondition for starting an agent.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

/**
 * How to invoke a sibling command, spelled the way the caller can actually
 * retype it.
 *
 * These scripts are installed under `~/.copilot/copilot-base/scripts` and are
 * not on `PATH`, so a usage line reading `node scripts/repos.mjs` is a command
 * that fails everywhere except this project's own checkout. Deriving the
 * directory from `process.argv[1]` means the hint always names the copy that is
 * actually running, installed or checked out.
 */
export function invoke(script, args = '') {
  const dir = dirname(process.argv[1] ?? '.').split('\\').join('/');
  return `node ${dir}/${script}${args ? ' ' + args : ''}`;
}

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function tryGit(args, cwd = process.cwd()) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function repoRoot(cwd = process.cwd()) {
  const root = tryGit(['rev-parse', '--show-toplevel'], cwd);
  if (!root) die('not a git repository');
  return root;
}

export function basename(p) {
  return p.split(/[\\/]/).filter(Boolean).pop();
}

export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Windows resolves `copilot` to a .cmd shim, which Node refuses to spawn
 * without a shell. Quoting every argument ourselves keeps that safe: the
 * arguments here are paths, UUIDs and fixed sentences, never user prose.
 */
function quote(arg) {
  const text = String(arg);
  if (!IS_WINDOWS) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Start a Copilot CLI session as a child process.
 *
 * `onLine` receives each stdout line - with --output-format json that is one
 * JSON event per line. Returns the ChildProcess so callers can wait, kill, or
 * detach it.
 */
export function spawnCopilot({ args, cwd, detached = false, onLine, onExit }) {
  const command = IS_WINDOWS ? args.map(quote) : args;
  const child = spawn('copilot', command, {
    cwd,
    shell: IS_WINDOWS,
    detached,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: delegatedEnv(),
  });

  if (onLine) {
    let buffer = '';
    const consume = (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) onLine(line);
      }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
  }

  if (onExit) child.on('close', onExit);
  return child;
}

/**
 * This base installs its guards as user-level hooks, which fire everywhere. A
 * repository may also carry its own `.github/hooks/*.json`, and those are
 * DEFERRED in prompt mode unless the folder has been trusted or this opt-in is
 * set - silently, which is the dangerous part.
 *
 * Every session these scripts start therefore carries the opt-in, so a
 * repository's own hooks run too rather than being quietly skipped.
 */
export function delegatedEnv(extra = {}) {
  return { ...process.env, GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: 'true', ...extra };
}

/**
 * The standard argument set for a delegated, non-interactive run.
 *
 * --allow-all-tools is required for non-interactive mode; the guard rails come
 * back in through --deny-tool and the hooks, which still fire for these
 * sessions. --no-ask-user because nobody is watching. --max-ai-credits because
 * a fan-out multiplies model calls by design and an unbounded one is a bill.
 *
 * On `effort`: reasoning effort is a property of the *session*, not of an agent.
 * There is no `effort:` in agent frontmatter, so every subagent a session starts
 * inherits the level set here. Per-unit effort is only real where each unit gets
 * its own process, which means fanout slices. The CLI also rejects an effort
 * level when the model is `auto`, so that combination is refused here with a
 * readable message rather than a dozen slices failing to start.
 */
export function delegatedArgs({ prompt, agent, credits, model, effort, transcript, extraDeny = [] }) {
  const args = [
    '-p',
    prompt,
    '--allow-all-tools',
    '--no-ask-user',
    '--output-format',
    'json',
    '--deny-tool',
    'shell(git push)',
  ];
  for (const deny of extraDeny) args.push('--deny-tool', deny);
  if (agent) args.push('--agent', agent);
  if (model) args.push('--model', model);
  if (effort) {
    if (model === 'auto') die('--effort is not supported with the auto model; name a model or drop the effort');
    args.push('--effort', effort);
  }
  if (credits) args.push('--max-ai-credits', String(credits));
  if (transcript) args.push('--share', transcript);
  return args;
}

/**
 * Lenient event counting. The JSONL schema is large and evolves; anything that
 * depends on an exact event name would rot. Count what is there, keep the last
 * assistant text, and leave the readable record to the --share transcript.
 */
export function summariseEvent(state, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return state;
  }

  const type = String(event.type ?? event.event ?? '');
  state.events += 1;
  if (/tool/i.test(type) && /start|request/i.test(type)) state.tools += 1;
  if (/error|abort/i.test(type)) state.errors += 1;

  const text = event.data?.text ?? event.data?.content ?? event.text;
  if (typeof text === 'string' && text.trim() && /assistant|message/i.test(type)) {
    state.lastMessage = text.trim().slice(-2000);
  }
  return state;
}

export function newSummary() {
  return { events: 0, tools: 0, errors: 0, lastMessage: '' };
}

