---
name: fanout
description: Run independent slices of a plan in parallel and bring them back as one working branch - checks the four preconditions, chooses between in-tree fleet mode and isolated worktrees, then integrates and verifies the union. Use when a plan has two or more genuinely independent slices.
---

# Fan out

Run the slices in parallel and bring them back as one working branch.

## Before anything - the gate

Fan-out is only cheaper than sequential work when the slices are genuinely
independent. Check all four, and abort if any fails:

1. **Disjoint file sets.** Compare them literally. Any overlap means those two
   slices are one slice.
2. **Written interfaces.** Every point where slices meet has its type, signature
   or schema written down *now*, before anyone starts. Not "they'll agree" - the
   actual text.
3. **No ordering dependency.** If B needs A's output, they are sequential. Run A,
   then B. Two agents waiting on each other is worse than one agent doing both.
4. **A runnable check each.** A slice whose completion cannot be verified cannot
   be delegated - you will not be able to tell whether it came back done.

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
  "base": "main",
  "credits": 200,
  "slices": [
    {
      "name": "api",
      "files": ["src/api/**"],
      "interface": "type User = { id: string; email: string }",
      "doneWhen": "npm test -- api",
      "brief": "One paragraph: what this slice is."
    }
  ]
}
```

The script enforces the gate itself, writes each slice a `BRIEF.md`, spawns one
capped session per slice, runs each slice's check in its own worktree, and
writes `.fanout/<run>/report.json`.

Do not hand a slice the whole plan. Each brief gets its slice, its file set, its
interface, and this instruction, which the generated brief already carries:
*if you need to touch a file outside your set, stop and report the collision
instead of editing it*.

## While it runs

Do not poll and do not narrate. Use the wait to prepare integration: reread the
interface definitions and note which merge order the dependency graph implies.

## Bringing it together

Delegate to `@integrator` with the report path, the plan, and the merge order. It
merges in dependency order, resolves conflicts by reading both sides, hunts
interface drift, and runs the **full** check on the union - not the per-slice
checks.

Then run `@code-review` on the combined diff. Per-slice review misses exactly the
class of bug that fan-out creates: two correct halves that are wrong together.

## Report

- Which slices ran in parallel, and what each returned.
- Conflicts hit and how they were resolved.
- Interface drift found.
- The union check, verbatim.
- Anything that came back incomplete, named plainly.

## Rules

- Never fan out onto overlapping files. This is the rule that makes the rest work.
- Never merge without running the full check on the union.
- If a slice reports a collision, stop and re-slice. Do not tell it to proceed
  anyway - the plan was wrong, and pushing through produces a conflict you will
  resolve later with less information.
