#!/usr/bin/env node
// The check for this repository: do the guardrails behave as documented, does
// config resolve the way the docs claim, and is everything the CLI loads
// structurally valid.
//
//   node scripts/check.mjs
//
// Everything runs against throwaway git repositories and a throwaway
// COPILOT_HOME, so it exercises the real code paths - branch detection,
// registry matching, glob matching, the installer - without touching your
// machine's actual config.

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
const HOOKS = join(ROOT, 'hooks');

const SEP = String.fromCharCode(92); // a literal backslash
const probeId = `probe-${process.pid}-${Date.now()}`;
let failures = 0;
let checks = 0;
const aliases = [];

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

// ------------------------------------------------------------------ fixtures

/** A throwaway COPILOT_HOME, so no test can read or write the real config. */
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'copilot-base-home-'));
process.env.COPILOT_HOME = FAKE_HOME;

/** Run a hook with a payload on stdin and return its stdout. */
function hook(script, payload, home = FAKE_HOME) {
  const result = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_HOME: home },
  });
  return (result.stdout ?? '').trim();
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function decision(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function makeRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `copilot-base-${name}-`));
  const run = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'check@example.invalid']);
  run(['config', 'user.name', 'check']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const ok = true;\n');
  run(['add', '-A']);
  run(['commit', '-m', 'fixture']);
  return { dir, run };
}

function writeRegistry(repos) {
  mkdirSync(join(FAKE_HOME, 'copilot-base'), { recursive: true });
  writeFileSync(join(FAKE_HOME, 'copilot-base', 'repos.json'), JSON.stringify({ repos }, null, 2));
}

function writeSettings(settings) {
  mkdirSync(join(FAKE_HOME, 'copilot-base'), { recursive: true });
  writeFileSync(join(FAKE_HOME, 'copilot-base', 'config.json'), JSON.stringify(settings, null, 2));
}

/** A second, equally valid spelling of a directory: junction or symlink. */
function aliasFor(dir) {
  const link = join(tmpdir(), `copilot-base-alias-${process.pid}-${aliases.length}`);
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

const registered = makeRepo('registered');
const unregistered = makeRepo('unregistered');

writeRegistry([
  {
    name: 'registered-fixture',
    path: registered.dir,
    verify: 'exit 0',
    protected: ['src/generated/**'],
  },
]);
writeSettings({ delivery: 'local', credits: 200 });

try {
  // -------------------------------------------------------------- resolution

  section('config resolution');

  const config = await import('../hooks/lib/config.mjs');

  check(
    'a registered repository resolves its check',
    config.verifyCommandFor(registered.dir) === 'exit 0'
  );
  check(
    'an unregistered repository has no check',
    config.verifyCommandFor(unregistered.dir) === null,
    String(config.verifyCommandFor(unregistered.dir))
  );
  check(
    'protected paths are the union of global and registry',
    config.protectedPatternsFor(registered.dir).includes('.env') &&
      config.protectedPatternsFor(registered.dir).includes('src/generated/**')
  );
  check(
    'an unregistered repository still gets the global list',
    config.protectedPatternsFor(unregistered.dir).includes('.env') &&
      !config.protectedPatternsFor(unregistered.dir).includes('src/generated/**')
  );
  check(
    'the registry matches through an aliased path',
    config.repoEntry(aliasFor(registered.dir))?.name === 'registered-fixture'
  );

  section('delivery mode');

  check('defaults to local', config.deliveryFor(registered.dir) === 'local');
  check('an explicit flag wins', config.deliveryFor(registered.dir, 'pr') === 'pr');

  writeRegistry([
    { name: 'registered-fixture', path: registered.dir, verify: 'exit 0', protected: ['src/generated/**'], delivery: 'pr' },
  ]);
  check('a registry entry beats the machine setting', config.deliveryFor(registered.dir) === 'pr');
  check(
    'an unregistered repository follows the machine setting',
    config.deliveryFor(unregistered.dir) === 'local'
  );

  writeSettings({ delivery: 'pr' });
  check(
    'the machine setting applies where nothing overrides it',
    config.deliveryFor(unregistered.dir) === 'pr'
  );
  writeSettings({ delivery: 'local', credits: 200 });
  writeRegistry([
    { name: 'registered-fixture', path: registered.dir, verify: 'exit 0', protected: ['src/generated/**'] },
  ]);

  section('dependency waves');

  const { waves } = await import('../scripts/fanout.mjs');
  const ordered = waves([
    { name: 'consumer', dependsOn: ['provider'] },
    { name: 'provider' },
    { name: 'other-consumer', dependsOn: ['provider'] },
  ]);
  check('providers run before consumers', ordered.length === 2 && ordered[0][0].name === 'provider');
  check('independent consumers share a wave', ordered[1].length === 2);

  let cycleRejected = false;
  try {
    waves([
      { name: 'a', dependsOn: ['b'] },
      { name: 'b', dependsOn: ['a'] },
    ]);
  } catch {
    cycleRejected = true;
  }
  check('a cycle is rejected rather than hanging', cycleRejected);

  // ------------------------------------------------------------------- hooks

  section('protected paths');

  check(
    'denies an edit to .env',
    decision(hook('guard-protected-paths.mjs', { cwd: registered.dir, toolName: 'edit', toolArgs: { path: '.env' } }))
      ?.permissionDecision === 'deny'
  );
  check(
    'allows an ordinary source file',
    hook('guard-protected-paths.mjs', { cwd: registered.dir, toolName: 'create', toolArgs: { path: 'src/app.ts' } }) === ''
  );
  check(
    'handles toolArgs sent as a JSON string',
    decision(
      hook('guard-protected-paths.mjs', {
        cwd: registered.dir,
        toolName: 'edit',
        toolArgs: JSON.stringify({ path: 'infra/main.tf' }),
      })
    )?.permissionDecision === 'deny'
  );
  check(
    'reads file names out of an apply_patch body',
    decision(
      hook('guard-protected-paths.mjs', {
        cwd: registered.dir,
        toolName: 'apply_patch',
        toolArgs: { input: '*** Update File: migrations/001.sql\n@@\n-a\n+b\n' },
      })
    )?.permissionDecision === 'deny'
  );
  check(
    'enforces a pattern that only this repository declares',
    decision(
      hook('guard-protected-paths.mjs', {
        cwd: registered.dir,
        toolName: 'create',
        toolArgs: { path: 'src/generated/api.ts' },
      })
    )?.permissionDecision === 'deny'
  );
  check(
    'does not apply one repository rule to another',
    hook('guard-protected-paths.mjs', {
      cwd: unregistered.dir,
      toolName: 'create',
      toolArgs: { path: 'src/generated/api.ts' },
    }) === ''
  );
  check(
    'denies through an equivalent but differently spelled cwd',
    decision(
      hook('guard-protected-paths.mjs', {
        cwd: aliasFor(registered.dir),
        toolName: 'edit',
        toolArgs: { path: 'infra/main.tf' },
      })
    )?.permissionDecision === 'deny'
  );

  section('integration branches');

  check(
    'denies a commit on main',
    decision(hook('guard-main-branch.mjs', { cwd: registered.dir, toolName: 'bash', toolArgs: { command: 'git commit -m x' } }))
      ?.permissionDecision === 'deny'
  );
  check(
    'denies a push on main in an unregistered repository too',
    decision(hook('guard-main-branch.mjs', { cwd: unregistered.dir, toolName: 'bash', toolArgs: { command: 'git push origin main' } }))
      ?.permissionDecision === 'deny'
  );
  check(
    'allows an unrelated command',
    hook('guard-main-branch.mjs', { cwd: registered.dir, toolName: 'bash', toolArgs: { command: 'ls -la' } }) === ''
  );
  check(
    'honours the documented override',
    hook('guard-main-branch.mjs', {
      cwd: registered.dir,
      toolName: 'bash',
      toolArgs: { command: 'COPILOT_BASE_ALLOW_DIRECT=1 git commit -m x' },
    }) === ''
  );

  registered.run(['checkout', '-q', '-b', 'feat/probe']);
  check(
    'allows a commit on a feature branch',
    hook('guard-main-branch.mjs', { cwd: registered.dir, toolName: 'bash', toolArgs: { command: 'git commit -m x' } }) === ''
  );

  section('context injection');

  const brief = decision(hook('session-brief.mjs', { cwd: registered.dir, source: 'startup' }));
  check('session brief names the registered repository', brief?.additionalContext?.includes('registered-fixture') === true);
  check('session brief reports the branch', brief?.additionalContext?.includes('feat/probe') === true);

  const strangerBrief = decision(hook('session-brief.mjs', { cwd: unregistered.dir, source: 'startup' }));
  check(
    'session brief says when a repository is not registered',
    strangerBrief?.additionalContext?.includes('not registered') === true
  );

  const subagent = decision(hook('subagent-brief.mjs', { cwd: registered.dir, agentName: 'implementer' }));
  check('subagent brief names the repository it is in', subagent?.additionalContext?.includes('registered-fixture') === true);
  check('subagent brief carries the file-set rule', subagent?.additionalContext?.includes('Stay inside the file set') === true);
  check('subagent brief lists the protected paths', subagent?.additionalContext?.includes('src/generated/**') === true);

  section('workspace mode and memory');

  // A folder holding several checkouts and not being one itself. This is the
  // zero-setup entry point: nothing here has been registered by hand.
  const workspace = mkdtempSync(join(tmpdir(), 'copilot-base-workspace-'));
  const wsHome = mkdtempSync(join(tmpdir(), 'copilot-base-wshome-'));

  function repoIn(parent, name, files) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    const run = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    run(['init', '-b', 'main']);
    run(['config', 'user.email', 'check@example.invalid']);
    run(['config', 'user.name', 'check']);
    for (const [file, body] of Object.entries(files)) {
      writeFileSync(join(dir, file), body);
    }
    run(['add', '-A']);
    run(['commit', '-m', 'fixture']);
    return dir;
  }

  const declaring = repoIn(workspace, 'declaring-api', {
    'package.json': JSON.stringify({ name: 'declaring-api', scripts: { typecheck: 'tsc', test: 'vitest' } }),
    'index.ts': 'export const ok = true;\n',
  });
  repoIn(workspace, 'silent-lib', { 'README.md': 'no build system here\n' });

  const wsBrief = decision(hook('session-brief.mjs', { cwd: workspace, source: 'startup' }, wsHome));
  const wsText = wsBrief?.additionalContext ?? '';

  check('a workspace folder still produces a brief', wsText.length > 0);
  check('the brief names every checkout it found', wsText.includes('declaring-api') && wsText.includes('silent-lib'));
  check('the brief infers a check from what the project declares', wsText.includes('npm run typecheck'));
  check('an inferred check is labelled as unconfirmed', wsText.includes('inferred from the project'));
  check('the brief says which projects cannot be verified', wsText.includes('silent-lib') && wsText.includes('No check could be inferred'));
  check('the brief warns against working at the workspace level', wsText.includes('not a project'));

  // Auto-registration: what makes the check exist without a setup step.
  const autoRegistry = readJsonOrNull(join(wsHome, 'copilot-base', 'repos.json'));
  const autoEntry = (autoRegistry?.repos ?? []).find((r) => r.name === 'declaring-api');
  check('a discovered repository is registered automatically', Boolean(autoEntry));
  check('the auto entry carries the inferred check', autoEntry?.verify === 'npm run typecheck && npm test');
  check('an auto entry is marked as guessed', autoEntry?.auto === true);
  check(
    'a project declaring nothing runnable is not registered',
    !(autoRegistry?.repos ?? []).some((r) => r.name === 'silent-lib')
  );

  // A hand-registered entry must survive a session that rediscovers it.
  const keepHome = mkdtempSync(join(tmpdir(), 'copilot-base-keephome-'));
  mkdirSync(join(keepHome, 'copilot-base'), { recursive: true });
  writeFileSync(
    join(keepHome, 'copilot-base', 'repos.json'),
    JSON.stringify(
      { repos: [{ name: 'declaring-api', path: declaring.split(SEP).join('/'), verify: 'my own command' }] },
      null,
      2
    )
  );
  hook('session-brief.mjs', { cwd: workspace, source: 'startup' }, keepHome);
  const kept = readJsonOrNull(join(keepHome, 'copilot-base', 'repos.json'));
  const keptEntry = (kept?.repos ?? []).filter((r) => r.name === 'declaring-api');
  check('auto-registration never overwrites a hand-registered check', keptEntry.length === 1 && keptEntry[0].verify === 'my own command');

  // The opt-out.
  const offHome = mkdtempSync(join(tmpdir(), 'copilot-base-offhome-'));
  mkdirSync(join(offHome, 'copilot-base'), { recursive: true });
  writeFileSync(join(offHome, 'copilot-base', 'config.json'), JSON.stringify({ autoRegister: false }));
  hook('session-brief.mjs', { cwd: workspace, source: 'startup' }, offHome);
  const off = readJsonOrNull(join(offHome, 'copilot-base', 'repos.json'));
  check('autoRegister:false registers nothing', (off?.repos ?? []).length === 0);

  // Memory: the one thing that carries a fact between sessions.
  writeFileSync(
    join(workspace, 'MEMORY.md'),
    '# Workspace memory\n\n- orders-api owns the canonical User type\n'
  );

  const withMemory = decision(hook('session-brief.mjs', { cwd: workspace, source: 'startup' }, wsHome));
  check('MEMORY.md is injected verbatim', withMemory?.additionalContext?.includes('orders-api owns the canonical User type') === true);
  check('memory is labelled as fact, not as instructions', withMemory?.additionalContext?.includes('not as instructions from the user') === true);

  const fromInside = decision(hook('session-brief.mjs', { cwd: declaring, source: 'startup' }, wsHome));
  check(
    'a session inside a checkout finds the workspace memory above it',
    fromInside?.additionalContext?.includes('orders-api owns the canonical User type') === true
  );
  check('a session inside a checkout still reports its branch', fromInside?.additionalContext?.includes('main') === true);

  section('verification');

  check(
    'stays quiet in a repository with no check',
    hook('verify-after-edit.mjs', { cwd: unregistered.dir, toolName: 'edit', toolArgs: { path: 'src/app.ts' } }) === ''
  );

  writeRegistry([{ name: 'registered-fixture', path: registered.dir, verify: 'exit 1' }]);
  const failed = decision(hook('verify-after-edit.mjs', { cwd: registered.dir, toolName: 'edit', toolArgs: { path: 'src/app.ts' } }));
  check('feeds a failing check back into the transcript', failed?.additionalContext?.includes('Verification failed') === true);

  const blocked = decision(hook('guard-subagent-done.mjs', { cwd: registered.dir, agentId: probeId + '-1', response: 'all done' }));
  check('refuses a subagent stop while the check is red', blocked?.decision === 'block');
  const second = decision(hook('guard-subagent-done.mjs', { cwd: registered.dir, agentId: probeId + '-1', response: 'all done' }));
  check('refuses a second time', second?.decision === 'block');
  const third = decision(hook('guard-subagent-done.mjs', { cwd: registered.dir, agentId: probeId + '-1', response: 'all done' }));
  check('gives up after the limit and labels the response red', third?.decision === 'allow');
  check(
    'the released response says the check is still failing',
    third?.modifiedResponse?.includes('VERIFICATION STILL FAILING') === true
  );

  writeRegistry([{ name: 'registered-fixture', path: registered.dir, verify: 'exit 0' }]);
  check(
    'allows a subagent stop on a green check',
    hook('guard-subagent-done.mjs', { cwd: registered.dir, agentId: probeId + '-2', response: 'done' }) === ''
  );

  section('worktrees');

  const wt = (args, cwd) =>
    spawnSync(process.execPath, [join(HERE, 'wt.mjs'), ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, COPILOT_HOME: FAKE_HOME },
    });

  registered.run(['checkout', '-q', 'main']);
  const created = wt(['new', 'feat/wt-probe', '--repo', 'registered-fixture'], ROOT);
  const worktreePath = created.stdout.trim();
  check('creates a worktree for a repository by name', created.status === 0 && existsSync(worktreePath), created.stderr?.trim());
  check(
    'puts it under the machine worktree root, not beside the repository',
    worktreePath.replace(/\\/g, '/').includes('/copilot-base/worktrees/'),
    worktreePath
  );
  check(
    'a worktree still resolves to its registry entry',
    config.repoEntry(worktreePath)?.name === 'registered-fixture'
  );
  const removed = wt(['rm', 'feat/wt-probe', '--repo', 'registered-fixture'], ROOT);
  check('removes it again', removed.status === 0, removed.stderr?.trim());

  section('fan-out gate');

  const planFile = join(FAKE_HOME, 'slices.json');
  const fanout = (plan, extra = []) => {
    writeFileSync(planFile, JSON.stringify(plan));
    return spawnSync(process.execPath, [join(HERE, 'fanout.mjs'), 'run', planFile, ...extra], {
      encoding: 'utf8',
      env: { ...process.env, COPILOT_HOME: FAKE_HOME },
    });
  };

  writeRegistry([
    { name: 'registered-fixture', path: registered.dir, verify: 'exit 0' },
    { name: 'second-fixture', path: unregistered.dir, verify: 'exit 0' },
  ]);

  check(
    'refuses a slice whose agent is not installed',
    fanout({
      slices: [
        { name: 'a', repo: 'registered-fixture', files: ['src/a/**'], brief: 'x' },
        { name: 'b', repo: 'second-fixture', files: ['src/b/**'], brief: 'y' },
      ],
    }).stdout.includes("'implementer' agent, which is not installed")
  );

  // From here on, pretend the install has happened.
  mkdirSync(join(FAKE_HOME, 'agents'), { recursive: true });
  writeFileSync(join(FAKE_HOME, 'agents', 'implementer.agent.md'), '---\nname: implementer\ndescription: fixture\n---\n');

  check(
    'refuses a fan-out of one',
    fanout({ slices: [{ name: 'solo', repo: 'registered-fixture', files: ['src/**'], brief: 'x' }] }).status === 1
  );

  check(
    'refuses overlapping slices in one repository',
    fanout({
      slices: [
        { name: 'a', repo: 'registered-fixture', files: ['src/api/**'], brief: 'x' },
        { name: 'b', repo: 'registered-fixture', files: ['src/api/routes/**'], brief: 'y' },
      ],
    }).status === 1
  );

  check(
    'allows the same file set in two different repositories',
    fanout(
      {
        slices: [
          { name: 'a', repo: 'registered-fixture', files: ['src/api/**'], brief: 'x' },
          { name: 'b', repo: 'second-fixture', files: ['src/api/**'], brief: 'y' },
        ],
      },
      ['--dry-run']
    ).status === 0
  );

  check(
    'refuses a slice naming an unknown repository',
    fanout({
      slices: [
        { name: 'a', repo: 'registered-fixture', files: ['src/a/**'], brief: 'x' },
        { name: 'b', repo: 'no-such-repo', files: ['src/b/**'], brief: 'y' },
      ],
    }).status === 1
  );

  const waved = fanout(
    {
      slices: [
        { name: 'provider', repo: 'registered-fixture', files: ['src/api/**'], brief: 'x' },
        { name: 'consumer', repo: 'second-fixture', dependsOn: ['provider'], files: ['src/client/**'], brief: 'y' },
      ],
    },
    ['--dry-run']
  );
  check('plans a provider and its consumer as two waves', waved.stdout.includes('wave 2'), waved.stdout.trim().split('\n')[0]);
  check(
    'the dry run creates no worktree for its slices',
    !existsSync(join(FAKE_HOME, 'copilot-base', 'worktrees', 'registered-fixture', 'feat-provider'))
  );

  section('worktree reuse');

  const { makeWorktree, existingWorktree } = await import('../scripts/fanout.mjs');
  const strayRoot = mkdtempSync(join(tmpdir(), 'copilot-base-stray-'));
  const stray = join(strayRoot, 'claimed');
  execFileSync('git', ['-C', registered.dir, 'worktree', 'add', '-b', 'feat/claimed', stray], { stdio: 'ignore' });

  check('finds a branch already checked out elsewhere', Boolean(existingWorktree(registered.dir, 'feat/claimed')));

  const reuse = makeWorktree(registered.dir, 'registered-fixture', 'feat/claimed');
  check('reuses that checkout instead of failing', reuse.reused === true && reuse.elsewhere === true);

  execFileSync('git', ['-C', registered.dir, 'worktree', 'remove', '--force', stray], { stdio: 'ignore' });
  rmSync(strayRoot, { recursive: true, force: true });

  section('install');

  const installHome = mkdtempSync(join(tmpdir(), 'copilot-base-install-'));
  const install = (args) =>
    spawnSync(process.execPath, [join(HERE, 'install.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, COPILOT_HOME: installHome },
    });

  const dry = install(['--dry-run']);
  check('dry run writes nothing', dry.status === 0 && !existsSync(join(installHome, 'agents')));

  const installed = install([]);
  check('installs agents', installed.status === 0 && readdirSync(join(installHome, 'agents')).length >= 8);
  check('installs skills', existsSync(join(installHome, 'skills', 'multi-repo', 'SKILL.md')));
  check('registers the hooks', existsSync(join(installHome, 'hooks', 'copilot-base.json')));

  const registration = JSON.parse(readFileSync(join(installHome, 'hooks', 'copilot-base.json'), 'utf8'));
  const commands = Object.values(registration.hooks).flat().map((entry) => entry.command);
  check('no placeholder survives into the registration', !commands.some((c) => c.includes('{{')));
  check(
    'every hook command points at a file that exists',
    commands.every((command) => {
      const path = command.match(/"([^"]+)"/)?.[1];
      return path && existsSync(path);
    }),
    commands[0]
  );
  check('creates settings and a registry', existsSync(join(installHome, 'copilot-base', 'config.json')));
  check(
    'delivery starts as local on a fresh install',
    JSON.parse(readFileSync(join(installHome, 'copilot-base', 'config.json'), 'utf8')).delivery === 'local'
  );

  const uninstalled = install(['--uninstall']);
  check('uninstall removes the agents', uninstalled.status === 0 && !existsSync(join(installHome, 'agents', 'rollout.agent.md')));
  check('uninstall removes the registration', !existsSync(join(installHome, 'hooks', 'copilot-base.json')));
  check('uninstall keeps your registry unless purged', existsSync(join(installHome, 'copilot-base', 'repos.json')));

  rmSync(installHome, { recursive: true, force: true });
} finally {
  for (const dir of [registered.dir, unregistered.dir, FAKE_HOME]) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const link of aliases) {
    try {
      if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', link], { stdio: 'ignore' });
      else rmSync(link, { force: true });
    } catch {
      // best effort
    }
  }
}

// ------------------------------------------------------------------ structure

section('structure');

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

const template = JSON.parse(readFileSync(join(HOOKS, 'copilot-base.hooks.json'), 'utf8'));
check('hook template declares version 1', template.version === 1);
for (const [event, entries] of Object.entries(template.hooks)) {
  check(`${event} is a documented hook event`, KNOWN_EVENTS.has(event));
  for (const entry of entries) {
    const script = entry.command.match(/\{\{HOOKS\}\}\/([\w-]+\.mjs)/)?.[1];
    check(`${event} -> ${script ?? entry.command} uses the {{HOOKS}} placeholder`, Boolean(script));
    if (script) check(`${event} -> ${script} exists`, existsSync(join(HOOKS, script)));
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

for (const [dir, pattern, label] of [
  [join(ROOT, 'agents'), /\.agent\.md$/, 'agent'],
  [join(ROOT, 'skills'), /SKILL\.md$/, 'skill'],
]) {
  for (const file of walk(dir).filter((f) => pattern.test(f))) {
    const text = readFileSync(file, 'utf8');
    const name = file.slice(ROOT.length + 1);
    // Tolerate CRLF: a Windows checkout without .gitattributes produces it.
    check(`${label} ${name} starts with frontmatter`, /^---\r?\n/.test(text));
    check(`${label} ${name} has a description`, /^description:/m.test(text.split('---')[1] ?? ''));
    // An agent with no `model:` silently inherits whatever the session chose,
    // which is the opposite of routing a role to a model on purpose.
    if (label === 'agent') {
      check(`${label} ${name} pins a model`, /^model: \S/m.test(text.split('---')[1] ?? ''));
      // Effort is per agent too, and an unset one inherits the session level -
      // so a cheap executing role would think as hard as the run that spawned it.
      check(
        `${label} ${name} pins a reasoning effort`,
        /^reasoning-effort: (none|minimal|low|medium|high|xhigh|max)\s*$/m.test(text.split('---')[1] ?? '')
      );
    }
  }
}

// Losing this would disable every guardrail in delegated sessions silently.
const sharedSource = readFileSync(join(HERE, 'lib', 'shared.mjs'), 'utf8');
check(
  'delegated sessions opt in to repository hooks',
  sharedSource.includes('GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS')
);

for (const file of [...walk(HERE), ...walk(HOOKS)].filter((f) => f.endsWith('.mjs'))) {
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
