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
so and pick the matching row in step 2.

**What proves it works?** The check from the session brief. If it was inferred
rather than registered, **run it once now, before any edit**, and say what
happened. An inferred check that was already red is not a check - report that and
ask whether to continue unverified. If there is no check at all, say so plainly:
work here cannot be verified, and everything you report about it is a claim.

## 1b. If you have to ask, ask once - and never idle while you wait

Some requests carry a policy the code cannot settle: which upgrades are allowed,
whether a dirty worktree is in or out, what counts as in scope. Ask. But two
things about asking, and both are about cost:

**Gather every question into one round.** Before you send it, walk the work
forward in your head to the end and collect everything you will need. A second
blocking round costs the user another wait for something you could have seen the
first time. And **check your own question for contradictions** before sending it:
if one answer would make another impossible - "don't touch the lockfile" and
"upgrade the dependencies" are the same instruction pulling both ways - say so
inside the question and offer the resolution, rather than accepting both answers
and discovering the conflict a stage later.

**Do everything the answer does not gate, while you wait.** Read-only work almost
never depends on a policy: the survey, the inventory, the current state of each
candidate, the baseline check. Run it now, and come back to the user with the
findings *attached* to the question - they answer better with the data in front
of them, and the work is already done whichever way they answer. Stopping dead
with nothing gathered is the one shape to avoid; a blocking question should
arrive with a report behind it.

## 2. Size it, and take the shallowest path that fits

Read down. Stop at the first row that fits. The rows get more expensive.

| The work is | Do this |
|---|---|
| Undefined - nobody can say what "done" is | `@spec-writer`, show the user its outcomes and open questions, **stop** |
| One file set, one sitting | Do it yourself. Branch, change, check, commit. |
| Findable but not obvious where | `@explore` with a question that has an answer, then do it yourself |
| Several concerns, one repository | `@tech-lead` for slices, `@critic` on the plan, then implement in order |
| Two or more genuinely independent slices - in one repository or several | plan as above, then the `fanout` skill |
| Repositories that must change **together**, because one contract binds them | the `multi-repo` skill - `@impact-scout` first, contract written once |
| Touching auth, money, personal data, a public surface | whatever the row above says, plus `harden` before the PR |

Three rules about that table:

- **"Undefined" wins over everything.** A vague ask routed into a fan-out
  produces five confident interpretations and a merge conflict. Shape it first,
  even when the work sounds small.
- **Never climb a row for thoroughness.** Extra structure is not extra care, it
  is extra places for the intent to be paraphrased. Most requests are row two.
- **Count contracts, not repositories.** The last two rows both touch several
  repositories, and the number of repositories does not tell them apart. Ask
  instead: *does one of these repositories publish something the others resolve -
  a route, a type, a schema, a package version - such that landing one without
  the others breaks the seam?* If yes, that is `multi-repo`, and the wave order
  exists to protect that seam. If the repositories merely have the same **kind**
  of work done to them - upgrade the dependencies in each, add a licence header
  to each, fix the same lint rule in each - they are independent slices that
  happen to live in different repositories, and that is `fanout`, which runs
  across several repositories perfectly well. Routing independent work into
  `multi-repo` buys you a contract step with no contract to write, and you will
  notice halfway through that there is nothing to sequence.

Say which row you picked and the tell that decided it. One line.

## 3. Do it

**You own the run from here to step 5, including the parts another skill does
for you.** `plan`, `fanout`, `multi-repo` and `harden` each end with their own
stop - `plan` in particular ends "do not start implementing", which is right when
a human invoked it directly and wrong here, where it is one stage of yours. When
a nested skill hands its output back, **come back to this step and keep going**.
The run is not over because a stage finished; it is over when step 5 has printed
a report.

There is exactly one exception, and it is the `@spec-writer` row: an undefined
ask stops for the human, because everything after it would be built on a guess.

If a nested skill produced a plan, show it, then implement it. Do not present a
plan as the answer to a request that asked for work to be done - a plan the user
has to hand back to you is half a turn, and this skill exists to close it.

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
- **Stop at the report - and not before it.** The line this rule draws is
  between committing and *delivering*: finish the work, verify it, report it, and
  do not push or open a pull request off your own bat. It is not a licence to
  stop at a plan. A run that ends with a plan for a request that asked for a
  change has delivered nothing, and the user has to spend another turn telling
  you to do the thing they already asked for.
- **Finish what the request asked for.** If the ask was "check X and fix it",
  a check with no fix is half done. Say what you did not do and why - a
  deliberate exclusion the user chose is fine and belongs under NOT DONE - but
  do not let a stage boundary quietly become the end of the run.
