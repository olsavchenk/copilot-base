---
name: adopt
description: Wire this base into a real project - set the verification command, the protected paths, and an AGENTS.md written from the actual codebase rather than from a template. Use once, right after copying or installing the base into a repository.
---

# Adopt

The base only earns its keep once it is pointed at this specific codebase. Three
things are project-specific and must be filled in; everything else works as
shipped.

## Steps

**1. Learn the project before writing anything about it.**

Read the manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
`*.csproj`), the CI workflow if one exists, and the directory layout. Send
`@explore` agents for anything the layout does not answer: where the entry point
is, how tests are run, what the layering rule is, whether there is a generated
directory nobody should edit by hand.

State what you found before proceeding. If the project is empty or a green
field, say so - the answers below are then choices to make, not facts to
discover, and you should ask the human.

**2. Wire `.github/copilot/verify-cmd`.**

One shell line that proves the project still works. It runs after every code
edit *and* blocks a subagent from reporting done, so it has to be fast - target
under a minute. Typecheck plus unit tests is usually the right level; a full e2e
suite is not.

Derive it from the project's own scripts rather than inventing one, then **run
it** and confirm it passes on a clean tree. A verify command that is already red
trains everyone to ignore the hook.

**3. Wire `.github/copilot/protected-paths`.**

Start from the shipped list, then add what is actually dangerous here: generated
files, vendored code, schema and migration directories, deployment config,
anything with a "do not edit by hand" comment at the top. Remove entries that do
not exist in this project - a list of irrelevant globs stops being read.

**4. Write `AGENTS.md` for this project.**

Delegate to `@docs-writer`. Not a generic template: the conventions that are
actually true here, the invariants an agent would otherwise break, and the
things newcomers get wrong. Every claim verified against the code. Keep it to
about two screens; overflow goes to `docs/`.

The sections that earn their place in almost every project:

- what this system is, in three sentences
- how to run it and how to test it
- the layering or module rule, stated as a hard constraint
- what must never change without a human decision, and why
- conventions that are not obvious from reading one file

If the project already has an `AGENTS.md`, a `CLAUDE.md`, or a
`.github/copilot-instructions.md`, merge into it. Do not overwrite someone's
accumulated knowledge with a fresh template.

**5. Check the guardrails actually fire here.**

```
node scripts/check.mjs
```

That exercises the hooks against a throwaway repository and reports what passed.
Then confirm the CLI itself sees everything: run `/env` in an interactive session
and check that the agents, skills and hooks from this base are listed.

Two things to tell the human explicitly, because both are silent failures:

- **Trust the folder.** Repository hooks are deferred until it is trusted. An
  interactive session asks once; `copilot -p` never asks and just runs without
  guardrails. For scripted or CI runs, set
  `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true`.
- **The verify command runs on every edit and blocks a subagent from finishing.**
  If it is slow, the whole session is slow. Time it before settling on it.

**6. Report.** What you wired, what you found out about the project, what you had
to guess, and which of the shipped defaults you removed as irrelevant.

## Rules

- Never write an `AGENTS.md` claim you have not verified in the code.
- Never ship a `verify-cmd` you have not run.
- Do not adopt the whole ladder at once. Hooks plus a true `AGENTS.md` is the
  highest-return, lowest-ceremony stage, and most projects should sit there for a
  while. The rungs are in `docs/multi-agent-playbook.md`.
