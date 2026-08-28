# copilot-base

A machine-level toolkit for working with GitHub Copilot CLI across **all** your
repositories: role definitions, workflow skills, deterministic guardrails,
orchestration for parallel and multi-repo work, and the analysis behind the
choices.

Installed once into `~/.copilot`, active everywhere. Your work repositories get
branches, commits and pull requests - nothing else is ever written into them.

[Install](#install) · [First 15 minutes](docs/getting-started.md) ·
[Workflows](docs/workflows.md) · [Playbook](docs/multi-agent-playbook.md) ·
[Contributing](CONTRIBUTING.md)

---

## The problem it solves

Copilot CLI gives you one capable agent per session. Past a certain size of work
that agent runs into four walls, and they are the same four every time:

| Wall | What it looks like | What this adds |
|---|---|---|
| **Context fills up** | The agent re-reads files it already read, or contradicts itself | Roles that delegate the *reading* and keep only the answer |
| **"Done" is a claim** | An agent says the tests pass. They don't. | A per-repository check, run by a hook the model cannot skip |
| **Parallel work collides** | Two agents edit one file in one tree and both are now wrong | A fan-out that refuses to start on overlapping file sets, and gives each slice its own worktree |
| **One change, five services** | The provider ships, a consumer nobody listed breaks in production | Cross-repository impact search, a contract written once, dependency waves, an ordered rollout |

If none of those is hurting yet, you do not need most of this. Install it anyway
for the guardrails, register your repositories, and stop there - that is
[stage 0](docs/multi-agent-playbook.md#10-the-adoption-ladder), and most people
should sit on it for a while.

## What it will and will not do to your machine

Worth reading before you run the installer, because it installs **globally**.

**It writes to exactly two places:**

- `~/.copilot/` - the agents, the skills, and one hook registration file
- `~/.copilot/copilot-base/` - the hook scripts, your settings, your repository
  registry, worktrees and run artifacts

**It never writes inside a work repository.** Not a config file, not a run log,
not a worktree. Everything the toolkit needs lives under your home directory.
This one is load-bearing: people run this against repositories they do not own.

**The hooks run in every repository you open**, including one you just cloned to
read. That is deliberate - user-level hooks are the only kind Copilot CLI fires
without folder trust ([the evidence](docs/copilot-cli-capabilities.md)) - so an
unregistered repository gets the machine-wide protected paths and **nothing
else**. In particular no check runs there. Opting a repository in is a deliberate
act, and it is what makes a global install safe.

**Nothing is pushed by default.** Delivery mode starts at `local`: branches and
commits only. Pull requests are something you turn on, not something you
discover happened.

**`node scripts/install.mjs --uninstall` removes exactly what it wrote**, from a
manifest, and leaves your settings and registry alone unless you add `--purge`.

## Requirements

- **GitHub Copilot CLI 1.0.80 or newer** - check with `copilot --version`
- **Node 20 or newer** - check with `node --version`
- **git**, and the repositories you work in already cloned
- Linux, macOS or Windows. CI runs the test suite on Ubuntu and Windows, because
  that is where the path and shell assumptions break.

No dependencies, no build step, no runtime. It is Markdown and plain Node.

## Install

```bash
git clone https://github.com/olsavchenk/copilot-base.git
```

```bash
node scripts/install.mjs --dry-run
```

The dry run lists every file it would write, and writes none. Read it, then:

```bash
node scripts/install.mjs
```

That copies the agents to `~/.copilot/agents`, the skills to `~/.copilot/skills`,
the hooks to `~/.copilot/copilot-base/hooks`, and registers them at
`~/.copilot/hooks/copilot-base.json`.

Then tell it which repositories you work in:

```bash
node scripts/repos.mjs scan ~/work --add
```

```bash
node scripts/repos.mjs check
```

`scan` proposes a check per repository from what the project declares -
`package.json` scripts, `pyproject.toml`, `go.mod`, `Cargo.toml`, a `.csproj`.
It proposes; you approve. Drop `--add` first if you want to read the proposals
before anything is registered. Fix any it got wrong:

```bash
node scripts/repos.mjs set orders-api verify "npm run typecheck && npm test"
```

**Do not skip `repos.mjs check`.** A check that is already red teaches everyone -
you included - to ignore the hook that runs it.

### Confirm it took

```bash
copilot skill list
```

```bash
node scripts/check.mjs
```

`check.mjs` builds its own throwaway repositories and its own `COPILOT_HOME`,
exercises every guard, the config resolution, the wave ordering and the
installer, and touches nothing real. It is what CI runs.

Editing this repository changes nothing until you re-run `install.mjs` - it
copies rather than links, because file symlinks on Windows need elevation.

**New to it?** [docs/getting-started.md](docs/getting-started.md) walks through
the first fifteen minutes with a real task.

## What is in here

```
agents/          roles, invoked with @name in any repository
skills/          workflows, asked for by name
hooks/           guardrails + the template installed into ~/.copilot/hooks
config/          machine-wide defaults: protected-paths, verify-cmd
scripts/
  install.mjs    install, update, uninstall
  repos.mjs      the repository registry
  check.mjs      proves the guardrails behave as documented
  fanout.mjs     parallel slices across repos, in dependency waves
  fleet.mjs      named, resumable, supervised sessions
  wt.mjs         git worktree helper
docs/
  getting-started.md            the first fifteen minutes
  copilot-cli-capabilities.md   what the CLI already does - read before building
  multi-agent-playbook.md       topologies, economics, failure modes
  workflows.md                  runbooks per kind of work
```

State lives under `~/.copilot/copilot-base/`: `config.json`, `repos.json`,
`worktrees/`, `runs/`, `fleet/`.

### Roles

Invoked with `@name`, in any repository, once installed.

| Role | Job |
|---|---|
| `@spec-writer` | Turn a vague ask into falsifiable acceptance criteria. Stops for the decisions a human owns. |
| `@tech-lead` | Decompose work into slices with interfaces, checks and a rollout order. Read-only. |
| `@critic` | Attack a plan before it becomes code, and end with a verdict. |
| `@implementer` | Build one slice inside its own file set and branch. |
| `@test-author` | Tests from the spec, never from the implementation. |
| `@integrator` | Merge parallel branches in one repo and verify the union. |
| `@impact-scout` | Find every consumer of an API across repositories, before you change it. |
| `@rollout` | Sequence a change across repositories and deliver it. |
| `@docs-writer` | Keep AGENTS.md, READMEs and ADRs true. |

Deliberately absent, because the CLI ships them: `@explore`, `@task`,
`@code-review`, `@security-review`, `@rubber-duck`.

### Workflows

Skills, not slash commands - Copilot CLI's slash namespace is its own. Ask for
one by name ("use the multi-repo skill").

| Skill | What it runs |
|---|---|
| `route` | Classify the work, pick the shallowest structure that fits, hand off. Start here if unsure. |
| `workspace` | install/update, register repositories, set delivery mode |
| `plan` | tech-lead drafts slices, critic attacks them, you get a reviewed plan |
| `multi-repo` | impact scout, contract written once, waves, rollout |
| `fanout` | the gate, then parallel slices in isolated worktrees |
| `harden` | correctness, security and coverage review in parallel, ranked verdict |
| `fleet` | long-running, addressable sessions across repositories |

### Guardrails

Hooks are commands the CLI runs itself, in every repository. They are the only
mechanism here that does not depend on a model choosing to comply.

| Hook | Event | Effect |
|---|---|---|
| `guard-protected-paths` | `preToolUse` | Denies edits to protected globs, with a reason. Global list plus this repo's registry entry. |
| `guard-main-branch` | `preToolUse` | Denies commits and pushes on `main`/`master`/`develop`/`release/*`. |
| `verify-after-edit` | `postToolUse` | Runs the repo's registered check after edits; failures return to the transcript. |
| `guard-subagent-done` | `subagentStop` | Refuses a subagent's "done" while the check is red; gives up after two tries with the failure attached. |
| `session-brief` | `sessionStart` | Repo, branch, dirty state, worktrees, and other repos with work in progress. |
| `subagent-brief` | `subagentStart` | Prepends the repo, file-set and verification rules to every delegated brief. |

A hook that blocks completion on a red check is also what creates the incentive
to *game* the check, so the prohibition is stated where the enforcement is:
non-negotiable 4 in [AGENTS.md](AGENTS.md), restated in `@implementer` and
`@test-author`. No deleted assertions, no skips, no loosened tolerances.

Prove they work:

```bash
node scripts/check.mjs
```

### Multi-repo work

```bash
node scripts/fanout.mjs run slices.json --dry-run
```

```bash
node scripts/fanout.mjs run slices.json
```

Slices name a `repo` from the registry and may declare `dependsOn`, which groups
them into **waves**: providers finish and go green before consumers start, and a
red wave stops the run rather than building consumers against a broken provider.
`node scripts/fanout.mjs report` prints the last run as a table.

Use `/fleet` instead when the work is in one repository, needs only disjoint
files, and one combined commit is fine.

```bash
node scripts/fleet.mjs start orders --repo orders-api --brief plans/orders.md --worktree feat/email
```

`fleet list` shows every member across every repository, `fleet say <name>
"<message>"` takes a turn on one without restarting it, and `fleet watch`
restarts members that died.

### Delivery mode

How finished work leaves the machine:

| Mode | Behaviour |
|---|---|
| `local` (default) | Branches and commits. Nothing pushed; `@rollout` prints the push and PR sequence it would run. |
| `pr` | Branches pushed, one cross-linked PR per repository, opened in dependency order. |

```bash
node scripts/repos.mjs set orders-api delivery pr
```

Resolution is: `--delivery` flag, then the repository's registry entry, then
`~/.copilot/copilot-base/config.json`, then `local`. It defaults to `local`
because pushing is outward-facing and awkward to undo - it should be something
you turn on, not something you discover happened.

## Where to start

The ladder is in
[docs/multi-agent-playbook.md](docs/multi-agent-playbook.md#10-the-adoption-ladder);
the short version:

1. **Install, register your repos, set their checks.** Highest return, lowest
   ceremony. Sit here for a while.
2. **`@explore`, `@critic`, `@impact-scout`.** When context fills up, or when you
   are about to change something other services consume.
3. **`plan` then `harden`.** When work spans more than one sitting.
4. **`fanout`.** When you have real checks and two or more independent slices.
5. **`multi-repo`.** When one change has to land in several services together.
6. **`fleet`.** When work outlives a session.

The measure of whether any of it is working is not how many agents are running.
It is whether you are writing **fewer** messages than before.

## Troubleshooting

**`copilot skill list` does not show the skills.** The install went somewhere
else. Check whether `COPILOT_HOME` is set in your environment - the installer
honours it. Re-run `node scripts/install.mjs --dry-run` and read the first path
it prints.

**Nothing is being verified.** The repository is not registered, which is the
designed default. `node scripts/repos.mjs list` shows what is; `node
scripts/repos.mjs add <path> --verify "<check>"` opts one in.

**The check fires constantly and is slow.** It runs after every edit, so it has
to take seconds, not minutes. Register the fast half - typecheck plus unit tests
- and leave the slow suite for the pull request.

**An agent cannot commit.** That is `guard-main-branch`, and it is correct: you
are on `main`, `master`, `develop` or `release/*`. Branch first.

**An edit was denied, citing a protected path.** That is
`guard-protected-paths`, reading
`~/.copilot/copilot-base/config/protected-paths` plus the repository's registry
entry. Edit that file if a pattern is wrong for you; per-repository entries add
to the global list and cannot weaken it.

**I changed a file in this repo and nothing happened.** The install copies rather
than links. Run `node scripts/install.mjs` again.

**I want it all off.**

```bash
node scripts/install.mjs --uninstall
```

Add `--purge` to remove your settings and registry as well. Without it they are
kept, so a reinstall picks up where you left off.

## Contributing

Bug reports, new roles and new runbooks are welcome.
[CONTRIBUTING.md](CONTRIBUTING.md) covers how the pieces fit together, what earns
a new role, and the one command that has to pass.

## License

[MIT](LICENSE).
