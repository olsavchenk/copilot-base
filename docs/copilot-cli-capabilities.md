# What Copilot CLI already does

Read this before building anything that sounds like infrastructure. Most of the
machinery a multi-agent setup needs is already in the CLI, and a hand-rolled
version of it is worse, slower and costs credits.

Verified against **GitHub Copilot CLI 1.0.80** on 2026-08-27, from
`copilot --help`, the `copilot help` topics, and the agent definitions and
schemas shipped inside the npm package. Re-verify with the commands at the
bottom - this moves fast.

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

### Repository hooks are deferred until the folder is trusted

This one is worth knowing before you trust a guardrail. In prompt mode
(`copilot -p ...`) the CLI loads `.github/hooks/*.json` **only** when one of
these is true:

- the working directory is in `trustedFolders` (granted interactively, once)
- `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true`
- `COPILOT_ALLOW_ALL=true` (the environment variable, not the `--allow-all` flag)

Otherwise the session runs with no protected-path guard, no branch guard and no
verification - and says nothing about it. The debug log is the only tell:
*"Loading repo hooks in prompt mode (folder is trusted or opt-in set)"*.

Everything in `scripts/` sets the opt-in explicitly for the sessions it starts,
rather than depending on whether someone happened to trust the folder. Do the
same in CI. Verified empirically: a `sessionStart` hook that writes a marker file
does not run without it, and does with it.

Both command forms resolve against the repository root, so either works:

```json
{ "command": "node ./guard.mjs", "cwd": ".github/hooks" }
{ "command": "node .github/hooks/guard.mjs" }
```

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
- `--effort none|minimal|low|medium|high|xhigh|max` - reasoning effort.
- `--mode interactive|plan|autopilot`, `--plan`, `--autopilot`,
  `--max-autopilot-continues <n>` - autopilot is what buys long autonomy in one
  process.
- `--output-format json` - JSONL, one event per line. The full schema ships in
  the package at `schemas/session-events.schema.json`.
- `--model`, `COPILOT_MODEL`, `/model`.

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

Only two things are missing for the way this base works, and everything in
`scripts/` exists because of them:

1. **No custom slash commands.** Workflows are skills instead. Cost: you ask for
   them by name rather than typing `/name`.
2. **No filesystem isolation between parallel agents.** `scripts/fanout.mjs`
   gives each slice a git worktree, its own branch, its own capped session, its
   own transcript and its own check run.

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
