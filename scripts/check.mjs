#!/usr/bin/env node
// The check for this repository: do the guardrails behave as documented, and is
// everything the CLI loads structurally valid.
//
//   node scripts/check.mjs
//
// The hook tests run against a throwaway git repository in the system temp
// directory, so they exercise the real code paths - branch detection, config
// reading, glob matching - without depending on the state of this one.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const HOOKS = join(ROOT, '.github', 'hooks');

const probeId = `probe-${process.pid}-${Date.now()}`;
let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    process.stdout.write(`  ok    ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

/** Run a hook with a payload on stdin and return its stdout. */
function hook(script, payload) {
  const result = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return (result.stdout ?? '').trim();
}

function decision(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ fixture

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'copilot-base-check-'));
  const run = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'check@example.invalid']);
  run(['config', 'user.name', 'check']);

  mkdirSync(join(dir, '.github', 'copilot'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const ok = true;\n');
  writeFileSync(
    join(dir, '.github', 'copilot', 'protected-paths'),
    '# test fixture\n.env\n**/secrets.*\ninfra/**\nmigrations/**\n'
  );
  writeFileSync(join(dir, '.github', 'copilot', 'verify-cmd'), '# nothing configured\n');

  run(['add', '-A']);
  run(['commit', '-m', 'fixture']);
  return { dir, run };
}

function setVerify(dir, line) {
  writeFileSync(join(dir, '.github', 'copilot', 'verify-cmd'), `# fixture\n${line}\n`);
}

/**
 * A second, equally valid spelling of the same directory, or the input if the
 * platform will not give us one. A junction on Windows (no elevation needed,
 * unlike a symlink) and a symlink everywhere else.
 */
function aliasFor(dir) {
  const link = join(tmpdir(), `copilot-base-alias-${process.pid}`);
  try {
    rmSync(link, { recursive: true, force: true });
    if (process.platform === 'win32') {
      spawnSync('cmd', ['/c', 'mklink', '/J', link, dir], { stdio: 'ignore' });
    } else {
      symlinkSync(dir, link, 'dir');
    }
    if (!existsSync(link)) return dir;
    aliases.push(link);
    return link;
  } catch {
    return dir;
  }
}

const aliases = [];

// ------------------------------------------------------------------ hooks

const { dir: repo, run: gitIn } = makeRepo();

try {
  section('protected paths');

  check(
    'denies an edit to .env',
    decision(hook('guard-protected-paths.mjs', { cwd: repo, toolName: 'edit', toolArgs: { path: '.env' } }))
      ?.permissionDecision === 'deny'
  );

  check(
    'allows an ordinary source file',
    hook('guard-protected-paths.mjs', { cwd: repo, toolName: 'create', toolArgs: { path: 'src/app.ts' } }) === ''
  );

  check(
    'handles toolArgs sent as a JSON string',
    decision(
      hook('guard-protected-paths.mjs', {
        cwd: repo,
        toolName: 'edit',
        toolArgs: JSON.stringify({ path: 'infra/main.tf' }),
      })
    )?.permissionDecision === 'deny'
  );

  check(
    'reads file names out of an apply_patch body',
    decision(
      hook('guard-protected-paths.mjs', {
        cwd: repo,
        toolName: 'apply_patch',
        toolArgs: { input: '*** Update File: migrations/001.sql\n@@\n-a\n+b\n' },
      })
    )?.permissionDecision === 'deny'
  );

  check(
    'matches a bare pattern by basename anywhere in the tree',
    decision(
      hook('guard-protected-paths.mjs', { cwd: repo, toolName: 'create', toolArgs: { path: 'packages/api/.env' } })
    )?.permissionDecision === 'deny'
  );

  // The payload cwd and git's toplevel do not always spell the same directory
  // the same way: Windows hands out 8.3 short names in TEMP, and a symlinked
  // checkout has two valid names. If the guard cannot see through that, every
  // directory glob stops matching and it fails open without saying so.
  const alias = aliasFor(repo);
  check(
    'denies through an equivalent but differently spelled cwd',
    alias === repo ||
      decision(
        hook('guard-protected-paths.mjs', { cwd: alias, toolName: 'edit', toolArgs: { path: 'infra/main.tf' } })
      )?.permissionDecision === 'deny',
    alias === repo ? 'no alias available on this platform' : `alias: ${alias}`
  );

  section('integration branches');

  check(
    'denies a commit on main',
    decision(hook('guard-main-branch.mjs', { cwd: repo, toolName: 'bash', toolArgs: { command: 'git commit -m x' } }))
      ?.permissionDecision === 'deny'
  );

  check(
    'denies a push on main',
    decision(hook('guard-main-branch.mjs', { cwd: repo, toolName: 'bash', toolArgs: { command: 'git push origin main' } }))
      ?.permissionDecision === 'deny'
  );

  check(
    'allows an unrelated command',
    hook('guard-main-branch.mjs', { cwd: repo, toolName: 'bash', toolArgs: { command: 'ls -la' } }) === ''
  );

  check(
    'honours the documented override',
    hook('guard-main-branch.mjs', {
      cwd: repo,
      toolName: 'bash',
      toolArgs: { command: 'COPILOT_BASE_ALLOW_DIRECT=1 git commit -m x' },
    }) === ''
  );

  gitIn(['checkout', '-q', '-b', 'feat/probe']);
  check(
    'allows a commit on a feature branch',
    hook('guard-main-branch.mjs', { cwd: repo, toolName: 'bash', toolArgs: { command: 'git commit -m x' } }) === ''
  );

  section('context injection');

  const brief = decision(hook('session-brief.mjs', { cwd: repo, source: 'startup' }));
  check('session brief reports the branch', brief?.additionalContext?.includes('feat/probe') === true);
  check('session brief reports recent commits', brief?.additionalContext?.includes('fixture') === true);

  const subagent = decision(hook('subagent-brief.mjs', { cwd: repo, agentName: 'implementer' }));
  check(
    'subagent brief carries the file-set rule',
    subagent?.additionalContext?.includes('Stay inside the file set') === true
  );
  check(
    'subagent brief lists the protected paths',
    subagent?.additionalContext?.includes('infra/**') === true
  );

  section('verification');

  check(
    'stays quiet when no verify command is configured',
    hook('verify-after-edit.mjs', { cwd: repo, toolName: 'edit', toolArgs: { path: 'src/app.ts' } }) === ''
  );

  setVerify(repo, 'exit 1');
  const failed = decision(hook('verify-after-edit.mjs', { cwd: repo, toolName: 'edit', toolArgs: { path: 'src/app.ts' } }));
  check('feeds a failing check back into the transcript', failed?.additionalContext?.includes('Verification failed') === true);

  const blocked = decision(hook('guard-subagent-done.mjs', { cwd: repo, agentId: probeId + '-1', response: 'all done' }));
  check('refuses a subagent stop while the check is red', blocked?.decision === 'block');

  const second = decision(hook('guard-subagent-done.mjs', { cwd: repo, agentId: probeId + '-1', response: 'all done' }));
  check('refuses a second time', second?.decision === 'block');

  const third = decision(hook('guard-subagent-done.mjs', { cwd: repo, agentId: probeId + '-1', response: 'all done' }));
  check('gives up after the limit and labels the response red', third?.decision === 'allow');
  check(
    'the released response says the check is still failing',
    third?.modifiedResponse?.includes('VERIFICATION STILL FAILING') === true
  );

  setVerify(repo, 'exit 0');
  check(
    'allows a subagent stop on a green check',
    hook('guard-subagent-done.mjs', { cwd: repo, agentId: probeId + '-2', response: 'done' }) === ''
  );

  section('worktree helper');

  const wt = (args) =>
    spawnSync(process.execPath, [join(HERE, 'wt.mjs'), ...args], { cwd: repo, encoding: 'utf8' });

  gitIn(['checkout', '-q', 'main']);
  const created = wt(['new', 'feat/wt-probe']);
  check('creates a worktree', created.status === 0 && existsSync(created.stdout.trim()), created.stderr?.trim());
  check('lists it', wt(['ls']).stdout.includes('wt-probe'));
  const removed = wt(['rm', 'feat/wt-probe']);
  check('removes it again', removed.status === 0, removed.stderr?.trim());
} finally {
  rmSync(repo, { recursive: true, force: true });
  const siblings = join(dirname(repo), `${repo.split(/[\\/]/).pop()}-wt`);
  rmSync(siblings, { recursive: true, force: true });
  for (const link of aliases) rmSync(link, { force: true });
}

// ------------------------------------------------------------------ structure

section('structure');

const manifest = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8'));
check('plugin.json has a name and a description', Boolean(manifest.name && manifest.description));
for (const key of ['agents', 'skills', 'hooks']) {
  check(`plugin.json ${key} path exists`, existsSync(join(ROOT, manifest[key])), manifest[key]);
}

const KNOWN_EVENTS = new Set([
  'sessionStart',
  'sessionEnd',
  'userPromptSubmitted',
  'userPromptTransformed',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'preCompact',
  'agentStop',
  'subagentStart',
  'subagentStop',
  'errorOccurred',
  'permissionRequest',
  'notification',
]);

const hookConfig = JSON.parse(readFileSync(join(HOOKS, 'copilot-base.json'), 'utf8'));
check('hook config declares version 1', hookConfig.version === 1);
for (const [event, entries] of Object.entries(hookConfig.hooks)) {
  check(`${event} is a documented hook event`, KNOWN_EVENTS.has(event));
  for (const entry of entries) {
    const script = String(entry.command).split(/\s+/).pop().replace('./', '');
    check(`${event} -> ${script} exists`, existsSync(join(HOOKS, script)));
    if (entry.matcher) {
      let valid = true;
      try {
        new RegExp(`^(?:${entry.matcher})$`);
      } catch {
        valid = false;
      }
      check(`${event} -> ${script} matcher compiles`, valid, entry.matcher);
    }
  }
}

// Repository hooks are deferred in prompt mode unless the folder is trusted or
// this opt-in is set. Losing it would disable every guardrail in delegated
// sessions without a single error message, so it is checked rather than trusted.
const sharedSource = readFileSync(join(HERE, 'lib', 'shared.mjs'), 'utf8');
check(
  'delegated sessions opt in to repository hooks',
  sharedSource.includes('GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS')
);
for (const script of ['fanout.mjs', 'fleet.mjs']) {
  const source = readFileSync(join(HERE, script), 'utf8');
  const spawnsDirectly = /spawnSync\('copilot'/.test(source);
  check(
    `${script} passes the hook opt-in to every session it starts`,
    !spawnsDirectly || source.includes('delegatedEnv()')
  );
}

for (const [dir, pattern, label] of [
  [join(ROOT, '.github', 'agents'), /\.agent\.md$/, 'agent'],
  [join(ROOT, '.github', 'skills'), /SKILL\.md$/, 'skill'],
]) {
  for (const file of walk(dir).filter((f) => pattern.test(f))) {
    const text = readFileSync(file, 'utf8');
    const name = file.slice(ROOT.length + 1);
    // Tolerate CRLF: a Windows checkout without .gitattributes produces it, and
    // the frontmatter is still valid.
    check(`${label} ${name} starts with frontmatter`, /^---\r?\n/.test(text));
    check(`${label} ${name} has a description`, /^description:/m.test(text.split('---')[1] ?? ''));
  }
}

const scripts = [...walk(HERE), ...walk(HOOKS)].filter((f) => f.endsWith('.mjs'));
for (const file of scripts) {
  const parsed = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  check(`${file.slice(ROOT.length + 1)} parses`, parsed.status === 0, parsed.stderr?.split('\n')[2]);
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
