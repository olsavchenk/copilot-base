# The first fifteen minutes

For someone who has just cloned this and wants to know whether it earns its
place. By the end you will have it installed and one real change made under the
guardrails, without having configured anything.

You need Copilot CLI 1.0.80+, Node 20+, and a folder holding some repositories
you actually work in.

---

## 1. Install it, after reading what it will write (2 min)

```bash
node scripts/install.mjs --dry-run
```

Every path it prints is under `~/.copilot`. Nothing goes into your projects -
that property is [load-bearing](../README.md#what-it-will-and-will-not-do-to-your-machine),
not a nicety, because this is meant to be safe to have on while you read
somebody else's code.

```bash
node scripts/install.mjs
```

Confirm the CLI can see it, from any directory:

```bash
copilot skill list
```

You should see `crew`, `plan`, `fanout`, `harden`, `multi-repo`, `fleet` and
`workspace`. If you see nothing, jump to
[Troubleshooting](../README.md#troubleshooting).

**That is the setup.** There is no registration step and no config file to fill
in.

## 2. Open a session where your projects live (1 min)

Not inside one repository - in the folder that *holds* them:

```bash
copilot
```

The first thing in the session is a brief listing every checkout under that
folder: what each one is, what branch it is on, whether it is dirty, and what
command proves it still works. That last one was read from each project - a
`package.json` script, a `go.mod`, a `Cargo.toml` - and registered so the
post-edit hook has something to run.

Two things worth noticing in that brief:

- **Checks marked `(inferred from the project, not confirmed)`.** A guess, read
  from the project, never invented. Correct one the first time it matters and it
  stays corrected: `node scripts/repos.mjs set <name> verify "<command>"`.
- **Projects listed under "No check could be inferred".** Those declare nothing
  runnable. Work there cannot be verified, and the brief says so rather than
  pretending otherwise.

## 3. Just ask for the work (5 min)

Plain English. No prefix, no agent names, no slash command:

```
implement user story ABS-312
```

or, if you have no ticket handy:

```
add a --json flag to the export command in go-site
```

The `crew` skill takes it from there. It works out which repository the work
belongs in, decides how much structure the work needs, does it or delegates it,
runs the check, and reports on a branch. You do not invoke agents one at a time.

What it does *not* do: push, or open a pull request. Delivery mode is `local`
until you change it, so the run ends with commits on a branch and a note about
what it would push.

If the request is a bare ticket reference and nothing in the workspace explains
what `ABS-` is, it will ask you once rather than inventing the story. That is the
correct behaviour - a confidently-built wrong story is the most expensive thing
this can produce, because the code looks right.

To start a run without opening a session at all:

```bash
node scripts/crew.mjs "implement user story ABS-312"
```

## 4. Watch a guardrail fire (2 min)

On purpose, ask it to commit on the main branch:

```
commit this on main
```

The commit is denied by `guard-main-branch`, with the reason. Note what happened:
the model did not decide to comply. A hook is a command the CLI runs regardless
of what the model thinks, which is the whole reason the guardrails live there
rather than in a prompt.

## 5. Give it a memory (5 min)

Create a `MEMORY.md` in that same folder, beside your checkouts. Every session
started at or below it loads it verbatim, forever. It is the only thing here that
carries a fact from one session to the next.

```markdown
# Workspace memory

## Projects
- **go-site** - the public marketing site. Owns nothing other services consume.
- **orders-api** - owns the canonical User type; billing consumes it.

## Conventions
- Tickets are `ABS-<n>` in Jira; branches are `feat/ABS-<n>-<slug>`.

## Checks that lie
- orders-api: `npm test` passes without covering the payment path.
  The real check is `npm run test:integration`.
```

The test for what belongs in there is one question: **would an agent reading the
code work this out anyway?** If yes, leave it out. Memory is for what the code
does not say - which repository owns what, what a ticket prefix means, which
check is a lie, and why something was deliberately not done.

Do not put secrets in it. It is loaded into every session.

Once there is something worth recording, hand it to the agent that maintains it:

```
@memory-keeper we learned the orders-api test suite skips the payment path
```

It verifies before writing, keeps the file short enough to load every session,
and fixes lines that have gone stale rather than appending corrections below
them.

---

## What to do next, and what to leave alone

**Do next:** work normally for a week. Correct the inferred checks as you meet
them, and add to `MEMORY.md` when you catch yourself explaining the same thing
twice.

**Leave alone for now:** `fanout`, `multi-repo` and `fleet`. `crew` reaches for
them when the work genuinely calls for it. Reaching for them yourself, before the
[entry conditions](multi-agent-playbook.md#10-the-adoption-ladder) hold, is how
you end up reviewing five branches by hand.

**The metric:** are you writing fewer messages than before? If your message count
is going up, something is wrong with the setup, not with you. That is the only
number that says whether any of this is working.

## Where to read further

| Question | Document |
|---|---|
| Which workflow for this kind of work? | [workflows.md](workflows.md) |
| Why is it built this way? | [multi-agent-playbook.md](multi-agent-playbook.md) |
| What does the CLI already do natively? | [copilot-cli-capabilities.md](copilot-cli-capabilities.md) |
| How do I add a role or a runbook? | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| What rules do agents work under here? | [../AGENTS.md](../AGENTS.md) |
