# copilot-base

A starting point for projects built with GitHub Copilot CLI doing a lot of the
work. Role definitions, workflow skills, deterministic guardrails, orchestration
for parallel work, and the analysis behind the choices.

It is a **template you copy** or a **plugin you install**, not a dependency.
Nothing here is tied to a language or a framework.

Requires Copilot CLI 1.0.80 or newer, and Node 20+ (the hooks and scripts are
plain Node with no dependencies).

## Quickstart

```bash
# new project
git clone git@github.com:olsavchenk/copilot-base.git my-project
cd my-project && rm -rf .git && git init -b main
```

```bash
# existing project
git clone --depth 1 git@github.com:olsavchenk/copilot-base.git /tmp/cb
cp -r /tmp/cb/.github /tmp/cb/docs /tmp/cb/scripts /tmp/cb/AGENTS.md .
```

```bash
# or install it as a plugin, leaving your repository alone
copilot plugin install olsavchenk/copilot-base
```

Then, in Copilot CLI:

```
use the adopt skill
```

That reads the actual codebase and fills in the three things that are
project-specific: the verification command, the protected paths, and an
`AGENTS.md` written from real code rather than from a template.

## What is in here

```
AGENTS.md                     operating contract, loaded automatically every session
plugin.json                   makes the repo installable as a Copilot CLI plugin
.github/
  agents/                     roles, invoked with @name
  skills/                     workflows, asked for by name
  hooks/                      deterministic guardrails
  copilot/verify-cmd          one shell line that proves the project works
  copilot/protected-paths     globs no agent may edit without a human
scripts/
  check.mjs                   proves the guardrails behave as documented
  wt.mjs                      git worktree helper
  fanout.mjs                  parallel slices, one worktree and session each
  fleet.mjs                   named, resumable, supervised sessions
docs/
  copilot-cli-capabilities.md what the CLI already does - read before building
  multi-agent-playbook.md     topologies, economics, failure modes
  workflows.md                runbooks per kind of work
```

### Roles

| Role | Job |
|---|---|
| `@tech-lead` | Decompose work into slices with interfaces and checks. Read-only; does not implement. |
| `@critic` | Attack a plan before it becomes code, and end with a verdict. |
| `@implementer` | Build one slice inside its own file set and branch. |
| `@test-author` | Tests from the spec, never from the implementation. |
| `@integrator` | Merge parallel branches and verify the union, not the parts. |
| `@docs-writer` | Keep `AGENTS.md`, README and ADRs true. |

Deliberately absent, because the CLI ships them: `@explore` (codebase recon),
`@task` (command running), `@code-review`, `@security-review`, `@rubber-duck`.
See [docs/copilot-cli-capabilities.md](docs/copilot-cli-capabilities.md).

### Workflows

Skills, not slash commands - Copilot CLI's slash namespace is its own. Ask for
one by name ("use the harden skill") or let the model pick it up from the
description.

| Skill | What it runs |
|---|---|
| `plan` | tech-lead drafts slices, critic attacks them, you get a reviewed plan |
| `fanout` | the four-precondition gate, then `/fleet` or isolated worktrees, then integration |
| `harden` | correctness, security and coverage review in parallel, ranked verdict |
| `fleet` | when a long-running fleet is justified, and how to drive it |
| `adopt` | wire this base into a real project |

### Guardrails

Hooks are commands the CLI runs itself. Unlike a convention in a document, they
do not depend on the model remembering.

| Hook | Event | Effect |
|---|---|---|
| `guard-protected-paths` | `preToolUse` | Denies edits to anything in `protected-paths`, with a reason |
| `guard-main-branch` | `preToolUse` | Denies commits and pushes on `main`/`master`/`develop`/`release/*` |
| `verify-after-edit` | `postToolUse` | Runs `verify-cmd` after code edits; failures come back into the transcript |
| `guard-subagent-done` | `subagentStop` | Refuses a subagent's "done" while the check is red, and gives up after two tries with the failure attached |
| `session-brief` | `sessionStart` | Branch, dirty state, recent commits and active worktrees, once |
| `subagent-brief` | `subagentStart` | Prepends the file-set and verification rules to every delegated brief |

Switch one off by deleting its entry in `.github/hooks/copilot-base.json`, or the
whole behaviour by deleting `verify-cmd` or `protected-paths`.

**Repository hooks are deferred until the folder is trusted.** In an interactive
session the CLI asks once and remembers. In `copilot -p` runs it does not ask -
it silently skips them unless the folder is already trusted or
`GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` is set. The scripts here set it for
every session they start; set it yourself in CI and in any `-p` run you care
about:

```bash
GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true copilot -p "..." --allow-all-tools
```

Prove they work here, without waiting for a real trigger:

```bash
node scripts/check.mjs
```

That builds a throwaway repository, exercises every guard against it, and checks
that everything the CLI loads is structurally valid. It is also what CI runs.

### Parallel work

```bash
node scripts/fanout.mjs run slices.json --dry-run   # see the gate and the briefs
node scripts/fanout.mjs run slices.json            # one worktree + session per slice
node scripts/fanout.mjs report                     # last run, as a table
```

Use `/fleet` instead when the slices only need disjoint files and one combined
commit - it is cheaper and there is nothing to clean up. Use the script when
slices need their own branches, or when the check binds a port, a database or a
build directory that two agents cannot share.

```bash
node scripts/fleet.mjs start api --brief docs/plans/api.md --worktree feat/api --autopilot 20
node scripts/fleet.mjs status api
node scripts/fleet.mjs say api "the schema changed - rebase onto main"
node scripts/fleet.mjs watch
```

```bash
node scripts/wt.mjs new feat/checkout   # isolated worktree + branch, by hand
node scripts/wt.mjs ls
node scripts/wt.mjs rm  feat/checkout   # refuses if dirty
node scripts/wt.mjs gc                  # drop worktrees whose branch is merged
```

## Where to start

Do not adopt all of it at once. The ladder is in
[docs/multi-agent-playbook.md](docs/multi-agent-playbook.md#10-the-adoption-ladder);
the short version:

1. **Hooks and `AGENTS.md` only.** Highest return, lowest ceremony. Most projects
   should sit here for a while.
2. **`@explore` and `@critic`.** When context fills up, or when a design you
   shipped turned out wrong.
3. **`plan` then `harden`.** When work spans more than one sitting.
4. **`fanout`.** When you have real tests and three or more genuinely independent
   slices.
5. **`fleet`.** When work outlives a session and you have something that can tell
   done from stuck without you.

The measure of whether any of it is working is not how many agents are running.
It is whether you are writing **fewer** messages than before.
