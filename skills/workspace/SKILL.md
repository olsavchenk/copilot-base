---
name: workspace
description: Set up or inspect this machine's copilot-base install and its repository registry - install and update the agents, skills and hooks, register repositories with their check commands, and see how work is delivered. Use once when setting up, and whenever a new repository joins the workspace.
---

# Workspace

This base is installed on the **machine**, not into your projects. The agents,
skills and guardrails are active in every repository you open, and the per-repo
facts - what "the check" is, what is protected, how work is delivered - live in a
registry outside those repositories. Nothing is written into a work repo except
branches and commits.

## Install or update

```
node scripts/install.mjs --dry-run     # see exactly what would be written
node scripts/install.mjs               # install or update
```

That copies the agents to `~/.copilot/agents`, the skills to `~/.copilot/skills`,
the hook scripts to `~/.copilot/copilot-base/hooks`, and registers the hooks at
`~/.copilot/hooks/copilot-base.json` with absolute paths.

User-level hooks fire in every repository with no folder trust and no opt-in
variable, which is why the guardrails are installed here rather than copied into
each project. Editing this repository changes nothing until you re-run the
install - it copies rather than links, because file symlinks on Windows need
elevation.

Confirm it took:

```
copilot skill list          # the skills, from any directory
node scripts/check.mjs      # the guardrails, against a throwaway repo
```

## Register the repositories you work across

```
node scripts/repos.mjs scan D:/work          # look, propose a check per repo
node scripts/repos.mjs scan D:/work --add    # then register them
node scripts/repos.mjs list
```

Registration is what opts a repository in. Until then it gets the machine-wide
protected paths and nothing else - in particular **no verification command
runs**, which is the property that makes a global install safe to have on while
you poke around in someone else's code.

`scan` proposes a check from what the project declares (`package.json` scripts,
`pyproject.toml`, `go.mod`, `Cargo.toml`, a `.csproj`). It proposes; it does not
adopt. Read them, then fix any that are wrong:

```
node scripts/repos.mjs set orders-api verify "npm run typecheck && npm test"
node scripts/repos.mjs set orders-api role provider
```

Then prove they are green **before** an agent depends on them:

```
node scripts/repos.mjs check
```

A check that is already red teaches everyone to ignore the hook. Fix it now,
while it is cheap and nobody is waiting.

## Delivery mode

How finished work leaves the machine:

| Mode | Behaviour |
|---|---|
| `local` (default) | Branches and commits. Nothing is pushed; `@rollout` prints the push and PR sequence it would run. |
| `pr` | Branches are pushed and one PR per repository is opened, in dependency order, cross-linked. |

```
node scripts/repos.mjs list                        # shows the effective mode
node scripts/repos.mjs set orders-api delivery pr  # one repository
```

The machine-wide default lives in `~/.copilot/copilot-base/config.json`. A repo
you do not own, or one with protected branches, can be pinned to `local` while
everything else opens PRs.

`local` is the default deliberately: pushing and opening pull requests is
outward-facing and awkward to undo, so it is something you turn on rather than
something you discover happened.

## Machine-wide protected paths

`~/.copilot/copilot-base/config/protected-paths` applies in **every** repository,
registered or not. Keep it to things that are dangerous everywhere - `.env`,
secrets, infrastructure, migrations. Per-repository additions go in the registry
entry's `protected` list; they add to the global list and cannot weaken it.

## Uninstall

```
node scripts/install.mjs --uninstall           # removes exactly what it installed
node scripts/install.mjs --uninstall --purge   # and the settings and registry
```
