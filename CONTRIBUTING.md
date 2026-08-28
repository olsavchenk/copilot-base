# Contributing

Bug reports, new roles, new runbooks and corrections to the docs are all welcome.
This file covers what you need to know that is not obvious from the tree.

If you are here to *use* the toolkit rather than change it, you want
[docs/getting-started.md](docs/getting-started.md) instead.

## The one command

```bash
node scripts/check.mjs
```

It must pass before anything is called done, and it is what CI runs on Ubuntu and
Windows. It builds throwaway repositories and a throwaway `COPILOT_HOME`,
exercises every guard, the config resolution, the wave ordering and the
installer. It never touches your real config, and neither should any check you
add to it.

There is no build, no dependency install, no test framework. Node 20 and git are
the whole toolchain.

## Trying a change

The install **copies**; it does not link. So the development loop is:

```bash
node scripts/install.mjs
```

...after every edit to `agents/`, `skills/`, `hooks/` or `config/`. Scripts under
`scripts/` are run from your checkout and need no reinstall.

To try something without disturbing your real setup, point `COPILOT_HOME` at a
scratch directory first - the installer honours it, and so does every hook.

## How the pieces are meant to divide

| If it is... | It goes in | Because |
|---|---|---|
| A role with a job and a report | `agents/<name>.agent.md` | An agent *is* a subagent. It receives a brief and returns a report. |
| A procedure that orchestrates others | `skills/<name>/SKILL.md` | A skill loads into the **main** agent's context, which is the only one that should be spawning subagents. |
| A rule that must hold whatever the model decides | `hooks/*.mjs` | A convention in a document is advice. A hook is a command the CLI runs regardless. |
| Bookkeeping across sessions or repositories | `scripts/*.mjs` | Deterministic work with no judgment in it does not need a model. |

A subagent orchestrating subagents is not something to bet on, which is why
workflows are never agents.

## Adding a role

Two questions decide whether it earns its place. Both have to answer yes.

**1. Does it have a boundary the existing roles do not?** Ideally a *tool*
boundary - `@tech-lead` and `@critic` are read-only because a role that cannot
write is a stronger guarantee than one asked not to, and `@spec-writer` can
create a new file but not edit an existing one, so a spec cannot quietly become
an implementation. A role that differs only in wording is a prompt, not an agent.

**2. What does its report force it to say?** Name a field the existing roles
would omit. `@critic` must end with a verdict; `@implementer` must fill in NOT
DONE and NOTICED, NOT TOUCHED; `@spec-writer` must list OPEN QUESTIONS. If you
cannot name the field, you are duplicating a role that exists.

Then check it is not something the CLI already ships - `@explore`, `@task`,
`@code-review`, `@security-review` and `@rubber-duck` are deliberately absent
here. [docs/copilot-cli-capabilities.md](docs/copilot-cli-capabilities.md) is the
inventory; read it before building anything that sounds like infrastructure.

When you do add one, wire it into the routing that would select it - the `route`
skill's table, the relevant workflow, the README table - because an agent nobody
names is an agent nobody picks.

Tool names for the `tools:` allowlist are listed in
[copilot-cli-capabilities.md](docs/copilot-cli-capabilities.md).

## Adding a skill

A skill is a runbook. Keep it to the shape the others use: when to reach for it,
the preconditions that must hold, the steps, the report, and the rules that stop
it going wrong. State the *entry condition* explicitly - most of the damage here
comes from a workflow used one rung too high on the ladder, not from a workflow
being wrong.

## Adding a hook

Two invariants, and both are enforced by `check.mjs`:

- **`preToolUse` fails closed.** A hook that throws denies every tool call. So
  every hook entry point exits 0 unconditionally and decides only through what it
  writes to stdout.
- **`hooks/lib/config.mjs` is the only place that decides where a fact about a
  repository comes from.** Hooks and scripts ask it. Nothing else reads the
  registry or guesses a path.

Add the guard's behaviour to `check.mjs` in the same change. A guardrail with no
test is a claim.

## Writing style, code and prose

Match what is already there. That is not politeness, it is the same rule the
agents work under, and this repository is the reference implementation of its own
conventions.

- Do the simplest thing that satisfies the requirement. No speculative
  abstraction, no configuration nobody asked for, no error handling for states
  that cannot occur.
- Comment to state a constraint the code cannot show, not to say what the next
  line does.
- Every claim about behaviour in the docs is verified before it is written. If
  you have not read it, do not assert it. Commands in the docs get run.
- Lead with the outcome. Documentation of a removed feature is a trap - when you
  change something, grep the docs for what they said before.

Scripts resolve paths from `import.meta.url` or from the payload's `cwd`, **never**
from "the current repository" - which is usually somebody else's.

## Things that need a human, not a pull request

Changing any of these is a conversation first:

- The delivery default (`local`)
- The machine-wide protected paths
- Anything that makes a guard fail open

## Pull requests

Branch, commit, and open a PR - the template asks for the verification command
and its real output, not "tested locally". CI runs `check.mjs` on Ubuntu and
Windows; both have to pass, because the shell and path assumptions differ and
Windows is where they break.

If a change alters how the system works or how someone is meant to work on it,
update the docs in the same PR. `@docs-writer` exists for exactly this.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
