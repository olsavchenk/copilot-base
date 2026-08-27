# AGENTS.md

Operating contract for agents working in this repository. Read this before
doing anything else. GitHub Copilot CLI loads this file automatically.

> **If you are adopting this base into a real project**, use the `adopt` skill -
> it rewrites this file from that project's actual code. Everything below the
> line marked *Project-specific* is a placeholder until you do.

## What this repository is

A base for agent-assisted development with GitHub Copilot CLI: role definitions,
workflow skills, deterministic guardrails, orchestration scripts, and the
reasoning behind them ([docs/multi-agent-playbook.md](docs/multi-agent-playbook.md)).
It is copied into new projects or installed as a plugin, not depended on as a
package.

## Non-negotiables

These hold in every project built from this base.

1. **Never commit to `main`, `master`, `develop` or `release/*`.** Work happens
   on a branch and arrives through a PR. A hook enforces this; do not route
   around it.
2. **Never edit anything matched by `.github/copilot/protected-paths`.** If a
   change genuinely requires it, say what and why, and ask.
3. **Never report work complete on a failing check.** If the check fails, fix it
   or say plainly that it fails and why. For subagents this is enforced: the
   `subagentStop` hook blocks a completion while the verify command is red.
4. **Every claim about existing behaviour carries a `file:line`.** If you have
   not read it, do not assert it.
5. **Stay inside the file set you were given.** If the work requires a file
   outside it, stop and report the collision. Another agent may own that file.
6. **Do not reimplement what the CLI already ships.** See the table below.

## Do not rebuild these

Copilot CLI provides them; a hand-rolled copy is worse and costs credits.

| Instead of writing... | Use |
|---|---|
| a codebase-search role | built-in `explore` agent - cheap model, read-only, safe in parallel |
| a code-review role | built-in `code-review` agent, or `/review` |
| a security-review role | built-in `security-review` agent, or `/security-review` |
| a generic second opinion | built-in `rubber-duck` agent, or `/rubber-duck` |
| a shell-output summariser | built-in `task` agent - runs a command, returns a summary on success, full output on failure |
| your own parallel dispatcher | `/fleet` for in-tree work, `scripts/fanout.mjs` when slices need their own branch |
| your own agent messaging | `list_agents`, `read_agent`, `write_agent` |
| your own budget guard | `--max-ai-credits`, `/limits` |

The full inventory, with what is native and what this repo adds, is in
[docs/copilot-cli-capabilities.md](docs/copilot-cli-capabilities.md). Read it
before building anything that sounds like infrastructure.

## Where things live

| Thing | Path | How it is invoked |
|---|---|---|
| Roles | `.github/agents/*.agent.md` | `@name` in a prompt, `/agent name`, `--agent name` |
| Workflows | `.github/skills/<name>/SKILL.md` | ask for it by name: "use the harden skill" |
| Guardrails | `.github/hooks/copilot-base.json` + `*.mjs` | the CLI runs them; nothing to invoke |
| Verification command | `.github/copilot/verify-cmd` | run by the hooks after edits and before a subagent may finish |
| Protected paths | `.github/copilot/protected-paths` | read by the path guard |
| Parallel work | `scripts/fanout.mjs`, `scripts/fleet.mjs`, `scripts/wt.mjs` | `node scripts/<name>.mjs` |

Workflows are skills and roles are agents, deliberately. A skill loads into the
**main** agent's context, so it can orchestrate subagents. An agent *is* a
subagent, and a subagent orchestrating subagents is not something to bet on.

## How work is sized

| Shape | Approach |
|---|---|
| One file, one sitting | Do it. No plan, no delegation. |
| Several files, one concern | Do it, sending `@explore` first if you need to locate things. |
| Multiple concerns, one session | `plan` skill, then implement in order. |
| Multiple independent slices, one branch | `/fleet`. |
| Multiple independent slices, own branches | `fanout` skill. |
| Anything touching auth, money, personal data | `harden` skill before the PR. |

Delegation has a floor cost. If explaining the task takes longer than doing it,
do it.

## Delegation rules

- **Give a slice, not the whole plan.** Extra context is extra ways to wander.
- **Write interfaces down before parallel work starts.** Verbatim: the actual
  type, signature, or schema. Agents that each invent one produce two half
  systems.
- **Fan out only on disjoint file sets.** Overlap means the slices are one slice.
- **Integration is a stage, not a `git merge`.** Every slice can pass its own
  check while the union fails.
- **Send `@explore` for volume.** Anything that produces output you will not need
  again belongs in a subagent's context, not yours.
- **Cap what you spawn.** Every background process gets `--max-ai-credits`.
  Parallel subagents multiply model calls by design.

## Verification

`.github/copilot/verify-cmd` holds one shell line that proves the project still
works. It runs after every code edit, and again when a subagent tries to finish.
Failures come back into the transcript.

If it is not wired up, wire it up before writing code. Work that cannot be
checked cannot be delegated, and mostly should not be trusted either.

One thing to know before relying on any of this: the CLI defers repository hooks
until the folder is trusted. Interactive sessions ask once; `copilot -p` runs
skip the hooks silently unless `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` is
set. The scripts in `scripts/` set it for every session they start.

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

## Project-specific

*Replaced by the `adopt` skill with facts from the real codebase. Until then,
this section is empty on purpose - a template full of plausible-sounding
conventions that are not true here is worse than nothing, because agents believe
it.*

- **What this system is:** _(three sentences)_
- **Run it:** _(command)_
- **Test it:** _(command, same as `.github/copilot/verify-cmd`)_
- **Layering rule:** _(the constraint that must not be violated)_
- **Never change without a human:** _(what, and why)_
