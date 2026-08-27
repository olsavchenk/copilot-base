// Shared plumbing for the hooks in this directory.
//
// Three things bite here, and each is handled once, in this file:
//
//   1. `toolArgs` arrives as an object in some CLI builds and as a JSON string
//      in others (github/copilot-cli#3349). Callers get an object either way.
//   2. A preToolUse hook that crashes or exits non-zero DENIES the tool call.
//      Every entry point therefore exits 0, whatever happened inside it.
//   3. Hooks may run from a plugin directory rather than from the repository
//      being worked on. Nothing here resolves paths relative to this file -
//      the payload's `cwd` is the only source of truth for where work is
//      happening.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const SEPARATOR = String.fromCharCode(92); // a literal backslash
const ESCAPE_THESE = '.+^${}()|[]' + SEPARATOR;

/** Read the hook payload from stdin. Returns {} rather than throwing. */
export async function readPayload() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {};
  } catch {
    return {};
  }
}

/** `toolArgs` as an object, whether the CLI sent an object or a JSON string. */
export function toolArgs(payload) {
  const raw = payload?.toolArgs ?? payload?.toolInput ?? payload?.tool_input;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/** preToolUse / permissionRequest: refuse, and say why in terms the agent can act on. */
export function deny(reason) {
  emit({ permissionDecision: 'deny', permissionDecisionReason: reason });
  process.exit(0);
}

/** sessionStart / subagentStart / postToolUse: put something into context. */
export function addContext(text) {
  emit({ additionalContext: text });
  process.exit(0);
}

/** subagentStop / agentStop: refuse the finish and hand back a next-turn prompt. */
export function blockStop(reason) {
  emit({ decision: 'block', reason });
  process.exit(0);
}

/** Say nothing and fall through to the CLI's normal handling. */
export function pass() {
  process.exit(0);
}

/**
 * Entry point wrapper. Guarantees exit 0 - a guard that throws must not turn
 * into a guard that denies everything.
 */
export function run(fn) {
  Promise.resolve()
    .then(fn)
    .catch(() => {})
    .finally(() => process.exit(0));
}

export function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function repoRoot(cwd) {
  const dir = cwd || process.cwd();
  try {
    return git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    return dir;
  }
}

/**
 * Current branch, or null outside a repository. symbolic-ref rather than
 * rev-parse: on a branch with no commits yet, rev-parse fails and symbolic-ref
 * still gives the right answer.
 */
export function currentBranch(root) {
  try {
    return git(root, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    try {
      return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch {
      return null;
    }
  }
}

/** Read one of the files under .github/copilot/, minus comments and blanks. */
export function configLines(root, name) {
  try {
    return readFileSync(resolve(root, '.github/copilot', name), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/** Repo-relative, forward-slashed, so the globs stay portable. */
export function relativeToRoot(root, path, cwd) {
  const absolute = isAbsolute(path) ? path : resolve(cwd || root, path);
  return relative(root, absolute).split(SEPARATOR).join('/');
}

/**
 * Glob to RegExp, matching the subset the protected-paths file uses:
 *   leading "**" + "/"   optional leading directories, so it matches at the root too
 *   "**"                 any characters, slashes included
 *   "*"                  any characters except a slash
 *   "?"                  one character except a slash
 */
export function globToRegExp(glob) {
  let body = glob;
  let prefix = '';
  if (body.startsWith('**/')) {
    prefix = '(?:.*/)?';
    body = body.slice(3);
  }
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '*') {
      if (body[i + 1] === '*') {
        i++;
        out += '.*';
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (ESCAPE_THESE.includes(c)) {
      out += SEPARATOR + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + prefix + out + '$');
}

/**
 * A pattern without a slash matches by basename anywhere in the tree, which is
 * how the CLI's own `write(.env)` permission pattern behaves. Anchor a pattern
 * to one location by giving it a directory: `config/.env`.
 */
export function matchesAny(relPath, patterns) {
  const base = relPath.split('/').pop();
  for (const pattern of patterns) {
    const re = globToRegExp(pattern);
    if (re.test(relPath)) return pattern;
    if (!pattern.includes('/') && re.test(base)) return pattern;
  }
  return null;
}
