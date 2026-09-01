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
for the guardrails and stop there - that is
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
without folder trust ([the evidence](docs/copilot-cli-capabilities.md)).

**It records a check for the projects it finds, and that is the one thing worth
understanding.** When a session starts, the repositories at or below that folder
are registered with a check read from what each project declares. It writes a
command; it never runs one. Your project's code is executed only by the post-edit
check - so a repository you open to read, and do not edit, runs nothing. Turn it
off with `"autoRegister": false` and nothing is written at all.

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
the hooks to `~/.copilot/copilot-base/hooks`, the commands to
`~/.copilot/copilot-base/scripts`, and registers the hooks at
`~/.copilot/hooks/copilot-base.json`.

**That is the whole setup.** No registration step, no config file to fill in.

> **`node scripts/...` in this README means the checkout.** Once installed, the
> same commands live at `~/.copilot/copilot-base/scripts/` and that is where you
> run them from when you are working in your own projects - they are not on
> `PATH`, so a bare `node scripts/repos.mjs` outside this clone resolves to
> nothing. The session brief prints the absolute path every session, and the
> skills write it as `<base>/scripts/...`.

### Then just work

Open a terminal in the folder that holds your projects - the folder, not one of
the repositories:

```bash
copilot
```

The session starts knowing what is there: every checkout under that folder, what
each one is, what proves each one works, and anything `MEMORY.md` records about
them. Then say what you want, in plain English:

```
implement user story ABS-312
```

That triggers the `crew` skill, which surveys the code with a handful of
`@explore` agents, works out which repository the story belongs in, sizes the
work, briefs `@implementer` and friends, runs the check, and reports back on a
branch. You do not invoke agents one at a time.

If you want it to run for a long stretch without you, start it in autopilot -
and say yes to the permission prompt it opens with:

```bash
copilot --autopilot --allow-all-tools
```

Autopilot with the prompt declined is the one configuration that looks broken:
the CLI stops asking, nothing is approved, and almost every shell command and
file edit comes back `Permission denied and could not request permission from
user`. The flag is not a hole in the guardrails - the guards in this base are
hooks, they fire whatever the permission mode is, and a hook `deny` beats
`--allow-all-tools`.

Copilot CLI has no custom slash commands - the namespace is fixed - so there is
no `/crew` to type. You do not need one; the skill triggers on the request
itself. To start a run *without* opening a session:

```bash
node scripts/crew.mjs "implement user story ABS-312"
```

### Checks, without a setup step

A session that opens a workspace infers each project's check from what the
project itself declares - a `package.json` script, a `go.mod`, a `Cargo.toml` -
and registers it so the post-edit hook has something to run. Inferred checks are
marked `[guessed]` in `node scripts/repos.mjs list` and announced as unconfirmed
in the session brief, because a guess is a guess.

Correct one the moment it is wrong, and it stays corrected - a hand-set check is
never overwritten:

```bash
node scripts/repos.mjs set orders-api verify "npm run typecheck && npm test"
```

A project that declares nothing runnable gets no check, and the brief says so out
loud rather than inventing one. To turn inference off entirely, put
`"autoRegister": false` in `~/.copilot/copilot-base/config.json` and register by
hand with `node scripts/repos.mjs add <path> --verify "<command>"`.

### Memory

Put a `MEMORY.md` in the workspace folder, beside your checkouts. Every session
started at or below it loads it verbatim - it is the only thing here that carries
a fact from one session to the next.

It is for what an agent cannot work out by reading the code: which repository
actually owns a surface, what a ticket prefix means and where to read one, a
check that passes while testing nothing, why something was deliberately not done.
`@memory-keeper` writes and prunes it; you can also just edit it yourself.

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
  crew.mjs       start a crew run from the shell, no session needed
  fanout.mjs     parallel slices across repos, in dependency waves
  fleet.mjs      named, resumable, supervised sessions
  wt.mjs         git worktree helper
docs/
  architecture.md               how it all fits together, with diagrams
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
| `@memory-keeper` | Maintain the workspace `MEMORY.md` - what a future session cannot re-derive. |

Deliberately absent, because the CLI ships them: `@explore`, `@task`,
`@code-review`, `@security-review`, `@rubber-duck`.

### Workflows

Skills, not slash commands - Copilot CLI's slash namespace is its own. Ask for
one by name ("use the multi-repo skill").

| Skill | What it runs |
|---|---|
| `crew` | **The default entry point.** One request to finished, verified work: find the repo, size it, delegate, verify, report. |
| `workspace` | install/update, correct a check, set delivery mode |
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

1. **Install, then just work.** Correct the inferred checks as you meet them.
   Highest return, lowest ceremony. Sit here for a while.
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

**Almost every shell command and file edit says `Permission denied and could not
request permission from user`.** Autopilot, with the permission prompt declined.
Autopilot is a mode, not a permission grant: with "limited permissions" the CLI
stops prompting and auto-denies anything without a standing approval rule, which
is why reads still work and nothing else does. Fix it with `/allow-all` in the
session, or start with `copilot --autopilot --allow-all-tools`. The base's guards
are hooks and keep firing either way.

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
