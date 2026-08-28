# AGENTS.md

Operating contract for agents working in **this** repository - the toolkit
itself. Copilot CLI loads this file automatically.

If you are looking for how to use the toolkit in your own work, that is the
`workspace` skill and [README.md](README.md), not this file.

## What this repository is

A machine-level toolkit for agent-assisted development with GitHub Copilot CLI:
role definitions (`agents/`), workflow skills (`skills/`), deterministic
guardrails (`hooks/`), orchestration for parallel and multi-repo work
(`scripts/`), and the reasoning behind them
([docs/multi-agent-playbook.md](docs/multi-agent-playbook.md)).

It is **installed**, not copied into projects: `node scripts/install.mjs` puts
the agents, skills and hooks under `~/.copilot`, where they apply in every
repository on the machine. Per-repository facts live in a registry at
`~/.copilot/copilot-base/repos.json`, never in the repositories themselves.

## Non-negotiables

1. **Never commit to `main`, `master`, `develop` or `release/*`.** Work happens
   on a branch and arrives through a PR. A hook enforces this; do not route
   around it.
2. **Never write anything into a work repository except code changes.** No
   config files, no run artifacts, no worktrees. Everything the toolkit needs
   lives under `~/.copilot/copilot-base/`. This one is load-bearing: people use
   this on repositories they do not own.
3. **Never report work complete on a failing check.** For subagents this is
   enforced: the `subagentStop` hook blocks a completion while the check is red.
4. **Never make a check pass by weakening it.** No deleted assertions, no added
   skips, no loosened tolerances, no narrowed inputs, no `--no-verify`. Rule 3 is
   the pressure that produces a gamed test - it makes red block your completion,
   so the cheapest escape is to make red go away dishonestly. That escape is
   closed. Work that cannot pass honestly is reported failing, with the reason.
5. **Every claim about existing behaviour carries a `file:line`.** If you have
   not read it, do not assert it.
6. **Stay inside the file set you were given.** If the work requires a file
   outside it, stop and report the collision. Another agent may own that file,
   possibly in another repository.
7. **Do not reimplement what the CLI already ships.** See the table below.
8. **Never push or open a pull request unless delivery mode says so.** The mode
   is configuration, not a judgement call: `local` means branches and commits
   only, however finished the work looks.

## Do not rebuild these

| Instead of writing... | Use |
|---|---|
| a codebase-search role | built-in `@explore` - cheap model, read-only, safe in parallel |
| a code-review role | built-in `@code-review`, or `/review` |
| a security-review role | built-in `@security-review`, or `/security-review` |
| a generic second opinion | built-in `@rubber-duck` |
| a shell-output summariser | built-in `@task` |
| your own parallel dispatcher | `/fleet` in one tree, `scripts/fanout.mjs` across branches or repos |
| your own agent messaging | `list_agents`, `read_agent`, `write_agent`, or `fleet say` |
| your own budget guard | `--max-ai-credits`, `/limits` |

The full inventory is in
[docs/copilot-cli-capabilities.md](docs/copilot-cli-capabilities.md). Read it
before building anything that sounds like infrastructure.

## Where things live

| Thing | Path | Installed to |
|---|---|---|
| Roles | `agents/*.agent.md` | `~/.copilot/agents/` |
| Workflows | `skills/<name>/SKILL.md` | `~/.copilot/skills/` |
| Guardrails | `hooks/*.mjs` + `hooks/copilot-base.hooks.json` | `~/.copilot/copilot-base/hooks/` + `~/.copilot/hooks/copilot-base.json` |
| Machine defaults | `config/protected-paths`, `config/verify-cmd` | `~/.copilot/copilot-base/config/` |
| Registry and settings | - | `~/.copilot/copilot-base/repos.json`, `config.json` |
| Orchestration | `scripts/*.mjs` | run from this checkout |

Workflows are skills and roles are agents, deliberately. A skill loads into the
**main** agent's context, so it can orchestrate subagents. An agent *is* a
subagent, and a subagent orchestrating subagents is not something to bet on.

Scripts are **not** installed: they run from this checkout, so anything that
resolves a path must do so from `import.meta.url` or from the payload's `cwd` -
never from "the current repository", which is usually somebody else's.

## How work is sized

| Shape | Approach |
|---|---|
| Nobody can say what "done" is | `@spec-writer` first, then stop for a human. |
| You cannot tell which row this is | `route` skill - it classifies and hands off. |
| One file, one sitting | Do it. No plan, no delegation. |
| Several files, one concern | Do it, sending `@explore` first if you need to locate things. |
| Multiple concerns, one session | `plan` skill, then implement in order. |
| Independent slices, one repo, one commit | `/fleet`. |
| Independent slices needing their own branches | `fanout` skill. |
| One change across several repositories | `multi-repo` skill. |
| Anything touching auth, money, personal data | `harden` skill before the PR. |

Delegation has a floor cost. If explaining the task takes longer than doing it,
do it.

## Delegation rules

- **Give a slice, not the whole plan.** Extra context is extra ways to wander.
- **Write interfaces down before parallel work starts.** Verbatim. Across
  repositories, also say what each side resolves the contract *from* - a package
  version, a generated client, a spec file. "Both sides agree" is not a mechanism.
- **Fan out only on disjoint file sets** within a repository. Ordering between
  slices is declared with `dependsOn` and runs as waves, never assumed.
- **Integration is a stage, not a `git merge`** - and across repositories it is
  not a merge at all, it is `@rollout`.
- **Send `@explore` for volume, `@impact-scout` across repositories.**
- **Cap what you spawn.** Every background session gets `--max-ai-credits`.

## Verification

Every registered repository has one shell line that proves it still works. It
runs after every code edit and again when a subagent tries to finish. A
repository with no registry entry runs unverified, on purpose.

This repository's own check:

```
node scripts/check.mjs
```

It must pass before anything here is called done. It builds throwaway
repositories and a throwaway `COPILOT_HOME`; it never touches the real config,
and neither should any test you add.

## Communicating

Lead with the outcome. The first sentence after finishing answers "what
happened", not "what I did first".

Report faithfully: if tests fail, say so with the output; if a step was skipped,
say that; when something is done and verified, say it plainly without hedging.
A slice that is 80% done and honestly labelled is useful. A slice reported as
finished that fails on first use costs more than not starting it.

Do not narrate routine actions. Write when you find something, change direction,
or hit a blocker.

## Writing code

Match the code around you: naming, error handling, layering, comment density,
test style. The correct style for this repo is the style already in this repo.

Do the simplest thing that satisfies the requirement. No speculative
abstraction, no configuration nobody asked for, no error handling for states
that cannot occur. If you think the design is wrong, say so in one sentence and
implement it as specified.

Comment to state a constraint the code cannot show. Not to say what the next
line does.

---

## This project, specifically

- **What it is:** a set of `.agent.md` roles, `SKILL.md` workflows, Node hooks
  and Node orchestration scripts, installed into `~/.copilot` and driven from a
  checkout. No runtime, no build, no dependencies.
- **Run it:** `node scripts/install.mjs`, then `node scripts/repos.mjs list`.
- **Test it:** `node scripts/check.mjs` - and it runs on Linux and Windows in CI,
  because the shell and path assumptions differ and that is where they break.
- **Layering rule:** `hooks/lib/config.mjs` is the only place that decides where
  a fact about a repository comes from. Hooks and scripts ask it; nothing else
  reads the registry or guesses a path.
- **preToolUse fails closed:** a hook that throws denies every tool call. Every
  hook entry point exits 0 unconditionally and decides only through stdout.
- **Never change without a human:** the delivery default (`local`), the
  machine-wide protected paths, and anything that makes a guard fail open.
