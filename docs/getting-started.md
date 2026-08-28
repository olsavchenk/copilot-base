# The first fifteen minutes

For someone who has just cloned this and wants to know whether it earns its
place. By the end you will have it installed, one repository registered, and one
real change made under the guardrails.

You need Copilot CLI 1.0.80+, Node 20+, and one repository you actually work in.

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

You should see `route`, `plan`, `fanout`, `harden`, `multi-repo`, `fleet` and
`workspace`. If you see nothing, jump to
[Troubleshooting](../README.md#troubleshooting).

At this point the guardrails are live in every repository, but they are doing
almost nothing - no repository is registered, so no check runs anywhere. That is
the correct state to be in five seconds after installing.

## 2. Register one repository (3 min)

Pick one you know well and whose tests currently pass.

```bash
node scripts/repos.mjs scan ~/work
```

That looks at each repository under the directory and proposes a check from what
the project declares. It writes nothing. Read the proposals - the one for your
repository is probably close and possibly wrong.

```bash
node scripts/repos.mjs add ~/work/orders-api --verify "npm run typecheck && npm test"
```

The check you pick has one hard requirement and one soft one:

- **Hard: it must be green right now.** Prove it. A check that is already red
  teaches you to ignore the hook that runs it, and from then on the whole thing
  is decoration.
- **Soft: it should take seconds.** It runs after *every* edit. Typecheck plus
  unit tests is usually the right slice; the full integration suite is not.

```bash
node scripts/repos.mjs check
```

Green? Then that repository now has a machine-checkable definition of "working",
and everything else in this toolkit is built on top of that one fact.

## 3. Watch a guardrail fire (2 min)

Open Copilot in that repository. The `sessionStart` hook prints a brief first -
the repo, the branch, whether the tree is dirty, and whether other repositories
have work in progress.

Now, on purpose, ask it to do something on `main`:

```
commit this on main
```

The commit is denied by `guard-main-branch`, with the reason. Note what happened:
the model did not decide to comply. A hook is a command the CLI runs regardless
of what the model thinks, which is the whole reason the guardrails live there
rather than in a prompt.

Then make a small edit on a branch and watch `verify-after-edit` run your check
and hand any failure straight back into the transcript.

That is stage 0, and it is most of the value. Plenty of people should stop here
for a few weeks.

## 4. Use one role (3 min)

The cheapest habit to build first is delegating *reading*.

```
@explore where does the order total get calculated, and what rounds it?
```

`@explore` ships with the CLI. It reads in its own context and hands you back the
answer, so the four hundred lines it waded through never enter your session.
Send it questions that have answers - "look around" comes back with a summary of
everything, which is what you were trying to avoid.

Then the second habit, before you write code for anything non-trivial:

```
@critic here is my plan: <paste>. Attack it.
```

It ends with an explicit verdict. A review that trails off in "some
considerations" leaves the decision exactly where it started, so the role is
written to refuse that.

## 5. Use one workflow (5 min)

When you are not sure how much structure a piece of work needs:

```
use the route skill: <what you want to build>
```

It reads down one table, stops at the first row that fits, checks that row's
precondition, and names the shape in one line before starting. Its most useful
answer is the cheapest one - "this is one sitting, just do it" - which is why it
exists. Structure is not care; it is places for your intent to get paraphrased.

Two answers worth recognising when you get them:

- **`@spec-writer`, then stop.** It decided nobody can say what "done" is. That
  is not the workflow failing. Ambiguity is the one input that multiplies across
  agents: one confused agent gives you one confused result, five give you five
  incompatible ones plus a merge conflict.
- **A row lower than you expected, with a precondition named.** Usually an
  unregistered repository, or slices that share a file. Fix the precondition
  rather than routing around it.

For real feature work, the sequence is `plan` (tech-lead drafts, critic attacks),
then implement, then `harden` before the pull request. The runbooks for every
recurring shape are in [workflows.md](workflows.md).

---

## What to do next, and what to leave alone

Follow the [adoption ladder](multi-agent-playbook.md#10-the-adoption-ladder) and
resist skipping. Each stage has an entry condition; skipping produces the
elaborate-but-useless setup the playbook exists to prevent.

**Do next:** register the rest of your repositories, fix the checks that are
wrong, and build the `@explore`-first habit until it is automatic.

**Leave alone for now:** `fanout`, `multi-repo` and `fleet`. Their entry
conditions are real. Fan-out with weak verification means you personally review
every branch, which is slower than having done the work yourself.

**The metric:** are you writing fewer messages than before? If your message count
is going up, roll back down the ladder. That is the only number that says whether
any of this is working.

## Where to read further

| Question | Document |
|---|---|
| Which workflow for this kind of work? | [workflows.md](workflows.md) |
| Why is it built this way? | [multi-agent-playbook.md](multi-agent-playbook.md) |
| What does the CLI already do natively? | [copilot-cli-capabilities.md](copilot-cli-capabilities.md) |
| How do I add a role or a runbook? | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| What rules do agents work under here? | [../AGENTS.md](../AGENTS.md) |
