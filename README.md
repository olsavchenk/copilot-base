# copilot-base

A machine-level toolkit for working with GitHub Copilot CLI across **all** your
repositories: role definitions, workflow skills, deterministic guardrails,
orchestration for parallel and multi-repo work, and the analysis behind the
choices.

Installed once into `~/.copilot`, active everywhere. Your work repositories get
branches, commits and pull requests - nothing else is ever written into them.

Requires Copilot CLI 1.0.80 or newer and Node 20+ (no dependencies).

## Install

```bash
git clone git@github.com:olsavchenk/copilot-base.git
cd copilot-base
node scripts/install.mjs
```

That copies the agents to `~/.copilot/agents`, the skills to `~/.copilot/skills`,
the hooks to `~/.copilot/copilot-base/hooks`, and registers them at
`~/.copilot/hooks/copilot-base.json`.

User-level hooks fire in **every** repository, with no folder trust and no opt-in
variable. Repository hooks do not - the CLI defers them until the folder is
trusted - and plugin installs register no hooks at all. That is why this installs
here; the evidence is in [docs/copilot-cli-capabilities.md](docs/copilot-cli-capabilities.md).

Then tell it which repositories you work in:

```bash
node scripts/repos.mjs scan D:/work          # look, and propose a check per repo
node scripts/repos.mjs scan D:/work --add    # register them
node scripts/repos.mjs check                 # prove those checks are green today
```

Registration is what opts a repository in. Until then it gets the machine-wide
protected paths and nothing else - in particular **no check runs there**, which
is what makes it safe to have this on while you read someone else's code.

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
  copilot-cli-capabilities.md   what the CLI already does - read before building
  multi-agent-playbook.md       topologies, economics, failure modes
  workflows.md                  runbooks per kind of work
```

State lives under `~/.copilot/copilot-base/`: `config.json`, `repos.json`,
`worktrees/`, `runs/`, `fleet/`.

### Roles

| Role | Job |
|---|---|
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
| `workspace` | install/update, register repositories, set delivery mode |
| `plan` | tech-lead drafts slices, critic attacks them, you get a reviewed plan |
| `multi-repo` | impact scout, contract written once, waves, rollout |
| `fanout` | the gate, then parallel slices in isolated worktrees |
| `harden` | correctness, security and coverage review in parallel, ranked verdict |
| `fleet` | long-running, addressable sessions across repositories |

### Guardrails

Hooks are commands the CLI runs itself, in every repository.

| Hook | Event | Effect |
|---|---|---|
| `guard-protected-paths` | `preToolUse` | Denies edits to protected globs, with a reason. Global list plus this repo's registry entry. |
| `guard-main-branch` | `preToolUse` | Denies commits and pushes on `main`/`master`/`develop`/`release/*`. |
| `verify-after-edit` | `postToolUse` | Runs the repo's registered check after edits; failures return to the transcript. |
| `guard-subagent-done` | `subagentStop` | Refuses a subagent's "done" while the check is red; gives up after two tries with the failure attached. |
| `session-brief` | `sessionStart` | Repo, branch, dirty state, worktrees, and other repos with work in progress. |
| `subagent-brief` | `subagentStart` | Prepends the repo, file-set and verification rules to every delegated brief. |

Prove they work:

```bash
node scripts/check.mjs
```

That builds throwaway repositories and a throwaway `COPILOT_HOME`, exercises
every guard, the config resolution, the wave ordering and the installer. It is
what CI runs.

### Multi-repo work

```bash
node scripts/fanout.mjs run slices.json --dry-run   # waves, briefs, branches
node scripts/fanout.mjs run slices.json            # one worktree + session per slice
node scripts/fanout.mjs report                     # last run, as a table
```

Slices name a `repo` from the registry and may declare `dependsOn`, which groups
them into **waves**: providers finish and go green before consumers start, and a
red wave stops the run rather than building consumers against a broken provider.

Use `/fleet` instead when the work is in one repository, needs only disjoint
files, and one combined commit is fine.

```bash
node scripts/fleet.mjs start orders --repo orders-api --brief plans/orders.md --worktree feat/email
node scripts/fleet.mjs list      # every member, across every repository
node scripts/fleet.mjs say orders "the schema changed - rebase onto main"
node scripts/fleet.mjs watch
```

### Delivery mode

How finished work leaves the machine:

| Mode | Behaviour |
|---|---|
| `local` (default) | Branches and commits. Nothing pushed; `@rollout` prints the push and PR sequence it would run. |
| `pr` | Branches pushed, one cross-linked PR per repository, opened in dependency order. |

```bash
node scripts/repos.mjs list                        # the effective mode per repo
node scripts/repos.mjs set orders-api delivery pr  # one repository
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
