---
name: fanout
description: Run independent slices of a plan in parallel - across one repository or several - in isolated worktrees with dependency waves, then integrate or roll out. Use when a plan has two or more slices that can proceed without waiting on each other.
---

# Fan out

Run the slices in parallel and bring them back as working branches.

## Before anything - the gate

Fan-out is only cheaper than sequential work when the slices are genuinely
independent *within a wave*. Check all four, and abort if any fails:

1. **Disjoint file sets.** Compare them literally. Any overlap between two slices
   in the same repository means they are one slice. Slices in different
   repositories cannot collide, so this only applies within a repo.
2. **Written interfaces.** Every point where slices meet has its type, signature
   or schema written down *now*, before anyone starts. Not "they'll agree" - the
   actual text. Across repositories, also say what each side resolves it *from*.
3. **Ordering is declared, not assumed.** If B needs A, that is `dependsOn: ["A"]`
   and they run in different waves. What is fatal is an undeclared dependency:
   two agents silently waiting on each other's output.
4. **A runnable check each.** A slice whose completion cannot be verified cannot
   be delegated - you will not be able to tell whether it came back done. Every
   repository involved has to be registered, or it has no check at all.

If fewer than two slices survive, say so and do the work directly. A fan-out of
one is pure overhead.

## Choosing the mechanism

Two ways to run this, and the choice is not stylistic:

**`/fleet`** - the CLI's own parallel subagents. Each gets its own context
window; they **share this working tree and this HEAD**. Use it when the slices
only need disjoint *files* and one combined commit is fine. Cheapest option,
nothing to clean up afterwards.

**`node scripts/fanout.mjs run slices.json`** - one git worktree and one
Copilot session per slice. Use it when any of these is true:

- each slice needs its own branch or its own commits
- the check binds something exclusive: a port, a test database, a build directory
- you want per-slice transcripts and exit codes to audit afterwards
- a slice may need to be thrown away without touching the others

When in doubt, use the script. The failure it prevents - two agents running the
same test suite in one tree - is silent and confusing.

## Running the script

```
node scripts/fanout.mjs run slices.json --dry-run    # see the gate and the briefs
node scripts/fanout.mjs run slices.json
```

`slices.json` is written by the `plan` skill, or by hand:

```json
{
  "notes": "context every brief gets",
  "slices": [
    {
      "name": "orders-provider",
      "repo": "orders-api",
      "dependsOn": [],
      "files": ["src/api/**"],
      "interface": "type User = { id: string; email: string }",
      "doneWhen": "npm test -- api",
      "brief": "One paragraph: what this slice is."
    },
    {
      "name": "billing-consumer",
      "repo": "billing-api",
      "dependsOn": ["orders-provider"],
      "files": ["src/clients/**"],
      "brief": "Adopt the new contract."
    }
  ]
}
```

`repo` is a name from the registry (`node scripts/repos.mjs list`) or a path.
Omit it for the repository you are standing in. `doneWhen` defaults to that
repository's registered check.

The script enforces the gate itself, groups the slices into dependency **waves**,
writes each slice a `BRIEF.md`, spawns one capped session per slice, runs each
slice's check in its own worktree, and writes the run report under
`~/.copilot/copilot-base/runs/<stamp>/`. Nothing is written inside a work repo.

A wave that comes back red stops the run: later waves are not started, and the
report names what was skipped. A consumer built against a broken provider is
worse than a consumer that was never started.

Do not hand a slice the whole plan. Each brief gets its slice, its file set, its
interface, and this instruction, which the generated brief already carries:
*if you need to touch a file outside your set, stop and report the collision
instead of editing it*.

## While it runs

Do not poll and do not narrate. Use the wait to prepare what comes next: reread
the interface definitions and note the order the dependency graph implies.

## Bringing it together

**One repository:** delegate to `@integrator` with the report path, the plan and
the merge order. It merges in dependency order, resolves conflicts by reading
both sides, hunts interface drift, and runs the **full** check on the union - not
the per-slice checks. Then run `@code-review` on the combined diff; per-slice
review misses exactly the class of bug fan-out creates, two correct halves that
are wrong together.

**Several repositories:** there is no union to merge. Delegate to `@rollout`,
which keeps the order, verifies each consumer against its provider, and delivers
according to the configured mode (`local` prints the sequence, `pr` opens the
pull requests).

## Report

- Which slices ran in which wave, in which repository, and what each returned.
- Anything that was skipped because an earlier wave failed.
- Conflicts hit and how they were resolved, or the rollout order if multi-repo.
- Interface drift found.
- The union check verbatim (one repo), or each repository's check (several).
- Anything that came back incomplete, named plainly.

## Rules

- Never fan out onto overlapping files in one repository. This is the rule that
  makes the rest work.
- Never merge without running the full check on the union.
- Never start a later wave when an earlier one is red.
- If a slice reports a collision, stop and re-slice. Do not tell it to proceed
  anyway - the plan was wrong, and pushing through produces a conflict you will
  resolve later with less information.
- **Re-run a failed slice at most twice, then stop.** Fix the brief before the
  second attempt - most failures are underspecified scope, a missing constraint
  or two slices sharing a file, not a bad agent. After the second, escalate to
  the human with the concrete blocker. Never loop.
- Never accept a slice green because it reported green. Read the diff and re-run
  its check yourself. An unverified claim is the one defect this shape
  manufactures at scale.
