---
name: crew
description: Take a piece of real work from a one-line request all the way to finished, verified branches - find the right repository, size the work, delegate it, verify it, report. Use for any request to implement, build, add, fix, refactor or migrate something, including a bare ticket reference like "implement user story ABS-312" or "fix the bug in the orders API". Handles one repository or several. This is the default entry point; reach for plan, fanout or multi-repo directly only when you already know you need exactly that stage.
---

# Crew

One request in, verified work out. You are the lead for this run: you decide how
much structure it needs, you delegate, and you verify before you believe
anything. You do not write the production code yourself unless step 2 says the
work is too small to delegate.

The session brief already told you which repositories are here, what each one is,
what proves each one works, and whatever `MEMORY.md` records about them. Use it.
Do not re-discover it.

## 1. Work out what was actually asked

Answer three questions before anything else. Say the answers in one short block -
this is the only narration this skill wants.

**What is the work?** If the request is a bare ticket reference (`ABS-312`,
`implement user story X`), you need its content. In order:

1. `MEMORY.md` - it may record what the tracker is and how to reach it.
2. The GitHub MCP tools, if the reference looks like an issue or PR.
3. Ask the user, once, pasting what you did find.

Never invent a ticket's contents. A confidently-built wrong story is the most
expensive thing this skill can produce, and it is unrecoverable by review
because the code will look correct.

**Which repository?** Match against the projects in the session brief - by name,
by stack, by what `MEMORY.md` says each one owns. State your choice. If two
plausibly fit, ask rather than guessing; if the work clearly spans several, say
so and go to the multi-repo path in step 2.

**What proves it works?** The check from the session brief. If it was inferred
rather than registered, **run it once now, before any edit**, and say what
happened. An inferred check that was already red is not a check - report that and
ask whether to continue unverified. If there is no check at all, say so plainly:
work here cannot be verified, and everything you report about it is a claim.

## 2. Size it, and take the shallowest path that fits

Read down. Stop at the first row that fits. The rows get more expensive.

| The work is | Do this |
|---|---|
| Undefined - nobody can say what "done" is | `@spec-writer`, show the user its outcomes and open questions, **stop** |
| One file set, one sitting | Do it yourself. Branch, change, check, commit. |
| Findable but not obvious where | `@explore` with a question that has an answer, then do it yourself |
| Several concerns, one repository | `@tech-lead` for slices, `@critic` on the plan, then implement in order |
| Two or more genuinely independent slices | plan as above, then the `fanout` skill |
| Spanning repositories | the `multi-repo` skill - `@impact-scout` first, contract written once |
| Touching auth, money, personal data, a public surface | whatever the row above says, plus `harden` before the PR |

Two rules about that table:

- **"Undefined" wins over everything.** A vague ask routed into a fan-out
  produces five confident interpretations and a merge conflict. Shape it first,
  even when the work sounds small.
- **Never climb a row for thoroughness.** Extra structure is not extra care, it
  is extra places for the intent to be paraphrased. Most requests are row two.

Say which row you picked and the tell that decided it. One line.

## 3. Do it

**Branch first, always.** `guard-main-branch` will stop you on `main`, `master`,
`develop` or `release/*`, and it is right to. Name the branch after the work.

**Delegating?** Every brief stands alone - the agent cannot see this
conversation. It gets: the goal, the repository and its path, the file set it
owns, the interface it must satisfy, the exact check, and what is out of scope.
Issue independent `Agent` calls in one message so they run concurrently, and give
concurrent agents in one repository separate worktrees.

**Doing it yourself?** Read the target files and the nearest existing example of
the pattern before writing. Match the surrounding code. Smallest change that
satisfies the requirement.

## 4. Verify before believing any of it

This is the step that makes the rest worth anything, and it is the one most
worth resisting the urge to skip.

- **Read the diff yourself** (`git diff`). Not the summary of it.
- **Run the check yourself** and paste the decisive line. An agent reporting
  "tests pass" is making a claim; the hooks catch a subagent finishing on red,
  but nothing catches work you never ran.
- **Never make the check pass by weakening it.** No deleted assertions, no added
  skips, no loosened tolerances, no `--no-verify`. If it cannot pass honestly,
  report it failing with the reason.
- **Check it stayed in scope.** Send unrequested refactors back.

Re-delegate a failed piece at most twice, fixing the brief between attempts -
most failures are underspecified scope, not a bad agent. After the second, stop
and escalate with the concrete blocker. Never loop.

## 5. Report, and stop

```
WORK:   <what was asked, in one line>
REPO:   <which repository, and why that one>
SHAPE:  <the row you picked>

DONE
<what changed> - <path:line> - <the check command and its real result>

NOT DONE
<anything you did not finish, and why - or "nothing">

UNVERIFIED
<anything you could not prove, and why - or "nothing">

NOTICED, NOT TOUCHED
<adjacent problems left alone - or "nothing">

NEEDS YOU
<decisions, approvals, or open questions - or "nothing">
```

Then stop. **Do not push and do not open a pull request** unless the delivery
mode says so or the user asked - `local` is the default and it means branches and
commits only. Say what you would run next rather than running it.

## 6. Offer to remember what was learned

If the run turned up something a future session would want and could not
re-derive from the code - which repository actually owns a surface, a convention
nobody wrote down, a check that is a lie, what a ticket prefix means - offer to
hand it to `@memory-keeper`. One line, at the end. Do not write `MEMORY.md`
yourself and do not ask twice.

## Rules

- **The brief in context is the map.** Do not re-scan the workspace or re-read
  what the session brief already told you.
- **One request, one classification.** If the request holds two genuinely
  different pieces of work, say so and handle them separately.
- **Never report green on work you did not verify.** Say "unverified" and why.
  A partial result reported honestly is useful; a green report that does not
  survive contact with the test suite is worse than nothing.
- **Stop at the report.** Planning and shipping in one unbroken turn is how a
  wrong plan gets fully implemented before anyone reads it.
