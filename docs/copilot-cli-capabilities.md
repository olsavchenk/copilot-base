# What Copilot CLI already does

Read this before building anything that sounds like infrastructure. Most of the
machinery a multi-agent setup needs is already in the CLI, and a hand-rolled
version of it is worse, slower and costs credits.

Verified against **GitHub Copilot CLI 1.0.80** on 2026-08-27, from
`copilot --help`, the `copilot help` topics, and the agent definitions and
schemas shipped inside the npm package; the model and effort section re-verified
against **1.0.81** on 2026-08-31. Re-verify with the commands at the bottom -
this moves fast.

---

## Instructions

Loaded automatically, no configuration:

| Scope | Files |
|---|---|
| Repository | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md` |
| Personal | `~/.copilot/copilot-instructions.md`, `~/.copilot/instructions/**/*.instructions.md` |

`--no-custom-instructions` turns the lot off; `/instructions` lists what is
loaded and toggles individual files. Extra search directories come from
`COPILOT_CUSTOM_INSTRUCTIONS_DIRS`.

This base uses `AGENTS.md` as the operating contract.

## Agents and subagents

Custom agents are `*.agent.md` files with YAML frontmatter:

| Location | Precedence |
|---|---|
| `.github/agents/` | repository |
| `~/.copilot/agents/` | personal, wins over a repository agent of the same name |
| plugin `agents/` | whatever the plugin ships |

Frontmatter: `description` (required), `name`, `tools`, `model`, `target`,
`mcp-servers`, `metadata`, `disable-model-invocation`, `user-invocable`.
`tools` accepts a comma-separated string or a list, `["*"]` for everything,
`[]` for nothing, and MCP-namespaced entries like `github-mcp-server/get_commit`.
Prompt bodies are capped at 30,000 characters.

**There is no `effort:` key.** Model is per agent; reasoning effort is not - see
[Model and effort](#model-and-effort) below, because the difference decides where
in this base each one can be set.

Invoke one with `@name` in a prompt, `/agent name`, or `--agent name`. Work done
by a custom agent runs in a subagent with its own context window.

**Built-in agents - do not reimplement these:**

| Agent | What it is |
|---|---|
| `task` | Runs a command and reports a one-line summary on success, full output on failure. Cheap model. Exists to keep build and test output out of the main context. |
| `explore` | Codebase search and question answering in a separate context. Read-only tool set, cheap model, safe to call in parallel. |
| `code-review` | Reviews changes for defects. Also `/review`. |
| `security-review` | Reviews staged and unstaged changes for vulnerabilities. Also `/security-review`. |
| `rubber-duck` | Constructive critic for a proposal, design or implementation. Also `/rubber-duck`. |
| `research` | Deep investigation across GitHub and the web. Also `/research`. |

The model can also reach running subagents directly: `list_agents`,
`read_agent`, `write_agent`. That last one is the message-into-a-running-agent
primitive - it works inside one session, between a parent and its subagents.

## Skills

`SKILL.md` files, discovered from:

```
Project   .github/skills/  .agents/skills/  .claude/skills/
Personal  ~/.copilot/skills/  ~/.agents/skills/
Plugin    bundled with an installed plugin
Custom    copilot skill add <directory>
```

Frontmatter: `name`, `description`, `user-invocable`. Skills load into the
**main** agent's context, which is why this base puts workflows in skills and
roles in agents: a workflow has to be able to orchestrate subagents, and an
agent is itself a subagent.

There are no custom slash commands. The slash namespace is the CLI's own
(github/copilot-cli#618, #1113 track the request). Ask for a skill by name.

## Hooks

Shell commands the CLI runs at fixed lifecycle points, independent of what the
model decides. Configured in `.github/hooks/*.json` (repository),
`~/.copilot/hooks/*.json` (personal), plugin `hooks.json`, the settings files,
or an admin policy directory.

Events: `sessionStart`, `sessionEnd`, `userPromptSubmitted`,
`userPromptTransformed`, `preToolUse`, `postToolUse`, `postToolUseFailure`,
`preCompact`, `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`,
`permissionRequest`, `notification`.

Entry types are `command` (with `bash` / `powershell` / cross-platform
`command`), `http`, and `prompt`. `matcher` is a regex tested against `toolName`
and anchored by the CLI as `^(?:PATTERN)$` - write alternations without your own
anchors.

What each event can return:

| Event | Output |
|---|---|
| `sessionStart` | `additionalContext` |
| `subagentStart` | `additionalContext`, prepended to the subagent's prompt; cannot block |
| `preToolUse` | `permissionDecision` `allow`/`deny` + `permissionDecisionReason` |
| `postToolUse` | `additionalContext`, `modifiedResult` |
| `agentStop` / `subagentStop` | `decision: "block"` + `reason`; `subagentStop` may also rewrite with `modifiedResponse` |
| `userPromptSubmitted` | `modifiedPrompt` only - `additionalContext` is dropped |

Two behaviours worth knowing before you write one:

- **`preToolUse` fails closed.** Exit 2, a crash, or any non-zero exit denies the
  tool call. A guard that throws is a guard that blocks everything, so the hooks
  in this base exit 0 unconditionally and decide only through stdout.
- **Timeouts always fail open**, including for `preToolUse`. A hook that hangs is
  a hook that is not enforcing anything.

`toolArgs` may arrive as an object or as a JSON-encoded string depending on the
build (github/copilot-cli#3349). Parse defensively.

### User-level hooks fire everywhere; repository hooks do not

The single most useful finding for a machine-wide setup, and the reason this base
installs into `~/.copilot` rather than copying itself into projects.

**`~/.copilot/hooks/*.json` fires in every repository**, including one you have
never opened before, in non-interactive `-p` mode, with no folder trust and no
opt-in variable. Verified in an unrelated scratch repository: a `sessionStart`
hook injected context the model quoted back, and a `preToolUse` hook denied a
file creation that then did not exist.

Two practical consequences:

- Hook commands are **not** tilde-expanded. `node ~/.copilot/...` silently does
  nothing; use an absolute path. `scripts/install.mjs` substitutes one in.
- A user-level hook applies to every project on the machine, so whatever it
  enforces must be true everywhere. Anything repository-specific belongs behind a
  registry lookup, which is what `hooks/lib/config.mjs` does.

**Repository hooks are deferred until the folder is trusted.** In prompt mode
(`copilot -p ...`) the CLI loads `.github/hooks/*.json` **only** when one of
these is true:

- the working directory is in `trustedFolders` (granted interactively, once)
- `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true`
- `COPILOT_ALLOW_ALL=true` (the environment variable, not the `--allow-all` flag)

Otherwise the session runs with no protected-path guard, no branch guard and no
verification - and says nothing about it. The debug log is the only tell:
*"Loading repo hooks in prompt mode (folder is trusted or opt-in set)"*.

Otherwise the session runs with no guards and says nothing about it. The debug
log is the only tell: *"Loading repo hooks in prompt mode (folder is trusted or
opt-in set)"*. Everything in `scripts/` sets the opt-in for the sessions it
starts, so a repository that carries its own hooks still gets them; the base's
own guards do not depend on it.

For repository hooks, both command forms resolve against the repository root:

```json
{ "command": "node ./guard.mjs", "cwd": ".github/hooks" }
{ "command": "node .github/hooks/guard.mjs" }
```

### Plugins are not a way to ship hooks

`copilot plugin install <owner>/<repo>` of this base reported *"Installed 5
skills"* - the skills loaded, the agents loaded but **namespaced** as
`copilot-base:tech-lead` (which breaks every `@tech-lead` reference), and the
hooks did not load at all. The CLI also warns that direct repo, URL and local
path installs are deprecated in favour of marketplace installs.

So: plugins are a fine way to distribute skills, and a bad way to distribute a
guardrail system. This base uses a plain installer instead.

## Permissions

Far more granular than a simple allow list, and worth using instead of writing
your own guard where it fits:

```
shell(git:*)              all git subcommands
shell(git push)           one exact subcommand
write(.env)               any file named .env, in any directory
write(/abs/path/.env)     that one file
url(https://*.github.com) a domain pattern, protocol-aware
MyMCP(tool_name)          one tool from one MCP server
```

`--allow-tool` / `--deny-tool` control prompting; deny always wins, even over
`--allow-all-tools`. `--available-tools` / `--excluded-tools` control what the
model can see at all. File access defaults to the working directory subtree plus
the system temp directory; `--add-dir` extends it, `--allow-all-paths` disables
it.

Non-interactive runs need `--allow-all-tools` (or `--allow-all`), which is why
this base narrows them back down with `--deny-tool` and leans on the hooks,
which fire for those sessions too.

## Sessions

Sessions outlive the process that created them, which is what makes a fleet
possible without a message bus:

| Flag | Effect |
|---|---|
| `--session-id <uuid>` | set the id for a new session, or attach to an existing one |
| `--resume[=id\|name\|prefix]` | resume a previous session |
| `--continue` | resume the most recent one |
| `-n, --name <name>` | name a session so you can find it later |
| `--share[=path]` / `--share-gist` | export the transcript after a non-interactive run |

Interactive equivalents: `/resume`, `/rename`, `/fork`, `/session`, `/compact`,
`/rewind`, `/chronicle`.

## Parallelism

`/fleet` turns the main agent into an orchestrator: it splits the objective,
dispatches independent work to background subagents, waits on prerequisites and
synthesises the result. `/tasks` lists background work. `/subagents` sets the
models they use.

The constraint that shapes everything in this base: **fleet subagents share one
working tree and one HEAD.** Disjoint files are fine. Separate branches, separate
commits, or a check that cannot run twice at once are not. That is what
`scripts/fanout.mjs` is for.

## Budgets and modes

- `--max-ai-credits <n>` and `/limits` - a soft cap per session, shared by its
  subagents. Fleet mode multiplies model calls by design; cap it.
- `--effort none|minimal|low|medium|high|xhigh|max` (alias `--reasoning-effort`)
  - reasoning effort, per session.
- `--mode interactive|plan|autopilot`, `--plan`, `--autopilot`,
  `--max-autopilot-continues <n>` - autopilot is what buys long autonomy in one
  process.
- `--output-format json` - JSONL, one event per line. The full schema ships in
  the package at `schemas/session-events.schema.json`.
- `--model`, `COPILOT_MODEL`, `/model`.

## Model and effort

The two knobs are not symmetrical, and the asymmetry is the whole story.

**Model is per agent.** `model:` in `*.agent.md` frontmatter binds a model to a
role, and it holds wherever that agent runs - invoked as `@name`, dispatched by
`/fleet`, or started by `--agent`. Model ids in 1.0.81 include `claude-opus-5`,
`claude-sonnet-5`, `claude-haiku-4.5`, `claude-opus-4.8-fast`, the `gpt-5.x`
family and `gemini-3.x`. `--model`, `COPILOT_MODEL` and `/model` set the session
default that an agent without a `model:` inherits.

**Effort is per session.** It is resolved once, when the session starts, and
every subagent that session dispatches inherits it. So within one run, the agent
doing the thinking and the agent doing the typing necessarily share a level.
Effort becomes per-unit only where each unit gets its own process - which in this
base means `fanout.mjs` slices, one `copilot` invocation each.

The CLI refuses an effort level when the model is `auto`
(*"Reasoning effort is not supported when using the auto model"*), so
`delegatedArgs()` refuses that pair up front rather than letting a fan-out fail
one slice at a time.

Built-in subagents have their own settings, reachable through `/subagents`:
`copilot_cli_execution_subagent_model` for `task` and
`copilot_cli_search_subagent_model` for `explore`. Both default to a cheap model
already; there is no reason to raise them.

The assignment this base ships:

| Agents | Model | Why |
|---|---|---|
| `tech-lead`, `critic`, `spec-writer`, `rollout`, `integrator` | `claude-sonnet-5` | decompose, judge, resolve conflicts - work where a wrong call is expensive downstream |
| `implementer`, `test-author`, `docs-writer`, `impact-scout`, `memory-keeper` | `claude-haiku-4.5` | execute a written brief, or search and summarise |

`integrator` sits on the thinking side deliberately: reconciling interfaces that
drifted apart is a judgement call, not a merge.

## Tool names

Needed for `tools:` allowlists, `--allow-tool` filters and hook matchers:

```
read     view  grep  glob  rg  lsp  read_agent  list_agents
edit     create  edit  str_replace_editor  apply_patch  insert  write_bash
move     move
delete   delete
execute  bash  read_bash  stop_bash  powershell  read_powershell  stop_powershell
web      web_search  web_fetch
agents   task  read_agent  write_agent  list_agents
ask      ask_user   (disable with --no-ask-user)
mcp      <server-name>/<tool-name>
```

## Everything else, briefly

**Plugins** bundle agents, skills, hooks, MCP servers and LSP servers behind one
`plugin.json`. Install from a marketplace, a GitHub repository, or a local
directory with `--plugin-dir`. Two marketplaces ship by default:
`github/copilot-plugins` and `github/awesome-copilot`.

**MCP** config comes from `~/.copilot/mcp-config.json`, `.mcp.json` or
`.github/mcp.json`, plus `--additional-mcp-config`. The GitHub MCP server is
built in.

**`/delegate`** hands the current session to GitHub, where the cloud agent
finishes the work and opens a PR.

**Sandboxing** (`/sandbox`, experimental) runs shell commands inside an OS-level
sandbox via Microsoft Execution Containers.

**Observability**: `COPILOT_OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` export
traces and metrics; `--log-dir`, `--log-level` and `/diagnose` cover the local
case.

**BYOK / offline**: `COPILOT_PROVIDER_*` points the CLI at another provider;
`COPILOT_OFFLINE=true` with a local provider takes it off the network entirely.

---

## What this base adds, and why

Four gaps, and everything in `scripts/` exists because of them:

1. **No custom slash commands.** Workflows are skills instead. Cost: you ask for
   them by name rather than typing `/name`.
2. **No filesystem isolation between parallel agents.** `scripts/fanout.mjs`
   gives each slice a git worktree, its own branch, its own capped session, its
   own transcript and its own check run.
3. **No notion of "which repository is this, and what proves it works".** A
   user-level hook runs everywhere, which means it needs a per-repository answer
   from somewhere. `scripts/repos.mjs` keeps that registry outside the
   repositories, and `hooks/lib/config.mjs` is the only thing that reads it.
4. **No ordering between parallel units, and no cross-repository delivery.**
   `/fleet` dispatches independent subtasks; nothing expresses "the provider has
   to be green before the consumers start", and nothing sequences branches in
   five repositories into a reviewable set of pull requests. Waves in
   `fanout.mjs` and the `@rollout` agent cover those.

`scripts/fleet.mjs` is a thinner argument: the CLI has everything needed for
long-lived work (named sessions, resume, autopilot, credit caps) but nothing that
tracks a set of them, notices when one dies, or restarts it. That is a
bookkeeping problem, and 300 lines of Node beats a second lead agent watching the
first one.

## Re-verifying this document

```bash
copilot --version
copilot --help
copilot help commands          # slash commands, including /fleet and /tasks
copilot help permissions       # the permission pattern grammar
copilot help limits            # credit caps
copilot help environment       # every environment variable
copilot skill list             # what this repository exposes
copilot plugin list --plugin-dir .
```

The built-in agent definitions and the JSONL event schema are readable in the
installed package:

```bash
ls "$(dirname "$(readlink -f "$(command -v copilot)")")"/../definitions
```

Docs: [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference),
[custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration),
[programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference),
[fleet](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet),
[plugins](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins).
