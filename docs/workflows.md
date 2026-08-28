# Workflows

Runbooks for the recurring shapes of work. Each one names the topology it uses
and the check that decides it is finished. Theory is in
[multi-agent-playbook.md](multi-agent-playbook.md); what the CLI provides is in
[copilot-cli-capabilities.md](copilot-cli-capabilities.md).

---

## Not sure which of these applies

**Topology:** none yet.

Say what you want. The `crew` skill triggers on the request itself, reads down
one sizing table, stops at the first row that fits, and then carries the work out
- it does not hand you back to another workflow. It is the front door for anyone
who has not memorised the rest of this file.

The one answer it gives that is not a runbook below: if nobody can say what
"done" means, it sends `@spec-writer` and stops. Go no further until that comes
back.

---

## Ask with no definition of done

**Topology:** solo, one adversarial artifact.

1. Send `@spec-writer` with the request as stated, however vague.
2. It reads the current behaviour, restates the ask as an observable change, and
   writes outcomes with falsifiable acceptance criteria - or reports that it
   cannot, and says what it needs to know.
3. **Read its OPEN QUESTIONS and answer them.** These are product decisions, and
   they are yours. An agent that picks for you is the failure this step exists to
   prevent.
4. Only then go to the `plan` skill.

Do not compress steps 1-4 into "just start and we will see". Ambiguity is the one
input that multiplies across agents: one confused agent produces one confused
result; five produce five incompatible ones and a merge conflict.

---

## Feature, small (one sitting, one file set)

**Topology:** solo.

1. Read the code you are about to change. All of it.
2. Write the change and its tests together.
3. The verification hook runs on every edit; fix red before continuing.
4. Branch, commit, PR.

Do not plan this. Do not delegate this. The overhead exceeds the work.

---

## Feature, large (multiple slices)

**Topology:** pipeline, then fan-out if the slices are independent.

1. Ask for the `plan` skill - it produces slices reviewed by the critic.
2. Read the plan yourself. You are approving a delegation, and a bad plan
   executed by five agents is five times the cleanup.
3. If the slices are independent, use the `fanout` skill - it picks between
   `/fleet` and isolated worktrees for you and states why. If they are not,
   implement in dependency order, one at a time.
4. `harden` on the resulting branch.
5. Fix what the sweep found. Re-run `harden` if the fixes were substantial.
6. PR with the plan linked in the description.

**Cut point:** if the plan comes back with one slice, skip to the small-feature
runbook. That is a success, not a failure of planning.

---

## Bug, reported

**Topology:** solo with a scout, adversarial at the end.

1. **Reproduce first.** No fix before a failing case exists. If you cannot
   reproduce, that is the finding - report it and stop.
2. Send `@explore` for the code path if it is not obvious: give it the symptom
   and ask where the behaviour is produced.
3. Write the regression test **before** the fix. Run it against the unfixed code
   and confirm it fails. A regression test never seen red is a guess.
4. Fix the cause. If the fix is in a different place than the symptom, say so in
   the commit message.
5. Confirm the test passes and the suite is still green.
6. `@code-review` on the diff if the fix touched anything shared.

---

## Investigation ("why is X slow / wrong / flaky")

**Topology:** parallel scouts, then one synthesiser.

1. Write down the question as something with an answer. "Why is checkout slow" is
   not; "which call in the checkout path takes the most wall-clock time on a cold
   cache" is.
2. Fan out `@explore` agents on **different hypotheses**, not different
   directories. One per hypothesis, each with its own question. They run on a
   cheap model in their own contexts and are safe in parallel.
3. Synthesise yourself. Rank hypotheses by evidence. Name the ones you ruled out
   and how, so nobody repeats the search.
4. Output is a written finding with `file:line` evidence, not a fix.

`/research` is the built-in version of this when the answer is likely to be
outside the repository - GitHub issues, upstream changelogs, the web.

Investigations that end in a fix in the same session tend to fix the first
plausible thing found. Separate the steps.

---

## API change across several repositories

**Topology:** fan-out across repositories, in dependency waves.

The full runbook is the `multi-repo` skill; this is the shape of it and the
places it goes wrong.

1. **`@impact-scout` first**, with the concrete identifier - the route, the type,
   the field - not the feature name. Everything downstream is built on its list of
   consumers, and the consumer nobody remembered is the usual reason a rollout
   fails halfway.
2. **Register every affected repository** before planning:
   `node scripts/repos.mjs add <path> --verify "<check>"`. An unregistered
   repository has no check, so a slice there cannot be graded.
3. **Write the contract once**, verbatim, and say what each consumer resolves it
   *from* - a package version, a generated client, a spec file. Two repositories
   cannot share a type by agreeing to.
4. **Plan it as waves.** Provider slices have no dependencies; consumer slices
   declare `dependsOn` on the provider. The `plan` skill emits `slices.json` in
   the shape `fanout.mjs` expects.
5. **Run it.** `node scripts/fanout.mjs run slices.json --dry-run` first: it
   prints the waves, the branches and the briefs without spawning anything.
6. **Roll out** with `@rollout`, which keeps the order and obeys the delivery
   mode - `local` prints the push and PR sequence, `pr` opens the cross-linked
   pull requests.
7. **Harden the provider.** It is the one whose mistake reaches everybody.

**Cut point:** if the change is backwards compatible, stop after the provider.
Consumers can move at their own pace, and a coordinated rollout you did not need
is expensive.

---

## Systematic refactor / migration

**Topology:** fan-out. This is the pattern's best case.

Mechanical, repetitive, independently verifiable per unit - exactly what parallel
agents are good at.

1. Do **one** instance by hand, completely, including tests. This is the
   reference.
2. Write down the transformation as a rule precise enough that an agent can apply
   it without judgment calls.
3. Enumerate every remaining site. Group into batches with disjoint file sets.
4. Fan out with the reference implementation in every brief. If the batches only
   touch different files and one commit is fine, `/fleet` is enough; if you want
   each batch revertable on its own, use `scripts/fanout.mjs`.
5. The integrator merges in dependency order and runs the full suite.
6. Grep for the old pattern to confirm none survived. This is the check that the
   migration is actually complete.

**Precondition:** step 2 must be possible. If each site needs a judgment call,
this is not a migration, it is N small features, and fan-out will produce N
inconsistent answers.

---

## Long-running slice (a day or more)

**Topology:** fleet member.

1. Write the brief as a file. It has to survive restarts and be re-readable by
   the member: what to build, the file set, the interface, the check.
2. `node scripts/fleet.mjs start <name> --repo <registry name> --brief <file>
   --worktree feat/<name> --autopilot 20 --credits 400`
3. `node scripts/fleet.mjs watch` in a spare terminal, or check `status` when you
   think of it. Silence from a member is not evidence of progress.
4. Correct it with `say` rather than restarting it - a restart loses what it
   learned; a turn on the same session does not.
5. When it finishes, review the branch like any other: `harden`, then deliver it
   the way the delivery mode says - members never push.

Rules for anything unattended:

1. **It reports; it does not act** on anything irreversible. Until the reports
   have been right several times in a row, an unattended agent that fixes things
   is an unattended agent that breaks things at 3am.
2. **Silence must mean something.** If a member dies quietly you will assume
   green. That is what `watch` and `incidents.log` are for.
3. **It runs against a check, not a vibe.** "Look for problems" produces noise
   that trains you to ignore it.

---

## Pre-merge gate

**Topology:** parallel adversarial.

1. `harden` - correctness, security and coverage in parallel, ranked and
   de-duplicated.
2. Fix confirmed findings. For plausible-but-unconfirmed ones, either verify or
   record why you are shipping anyway.
3. Full check on the final state, not on the state before the fixes.
4. PR description: what changed, why, what was checked, what was deliberately
   left.

---

## Handing work to the cloud

**Topology:** delegation.

`/delegate` sends the current session to GitHub, where the cloud agent finishes
the work and opens a PR. Worth it when the work is well-specified, the check is
in CI, and you want your machine back. The same rules apply: it needs a brief it
can act on without you, and a check that decides completion.

---

## When to abandon a workflow

Stop and do it yourself when:

- the same slice has come back wrong twice
- you have spent longer briefing than the work would have taken
- two agents are negotiating an interface you could settle in one sentence
- your own message count is going **up** rather than down

The last one is the general test. The point of all of this is fewer messages from
you, not more agents.
