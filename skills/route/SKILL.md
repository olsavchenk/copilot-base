---
name: route
description: Pick the shallowest structure that fits a piece of work - do it inline, send a scout, plan it, fan it out, or roll it across repositories - and say why before starting. Use as the front door when you are not sure which workflow a request needs, or when handing a request to someone new to this toolkit.
---

# Route

One question: **what is the least structure this work actually needs?**

Building a plan, a fan-out and a review sweep for a one-line fix costs more than
the fix. Doing a five-service API change inline costs a week. This skill picks,
says why in one line, and hands off. It does not do the work.

## 1. Classify, out loud

State which of these it is and why, in one sentence, before doing anything else.
If you cannot tell, that itself is the answer - go to *Unclear* at the bottom.

| Shape | Tell | Go to |
|---|---|---|
| **Specified, small** | One file set, one sitting, you can name the check | Do it. No plan, no delegation. |
| **Specified, needs locating** | You know what to build, not where it lives | `@explore` with a question that has an answer, then do it. |
| **Specified, several concerns** | More than one sitting, or more than one file set | `plan` skill |
| **Specified, independent slices** | Two or more slices with disjoint files and a check each | `plan`, then `fanout` |
| **Crosses repositories** | Something other services consume changes | `multi-repo` skill |
| **Risky surface** | Auth, money, personal data, a public endpoint | Whatever the shape says, plus `harden` before the PR |
| **Outlives the session** | Days of work, specifiable once, machine-checkable | `fleet` skill |
| **Not specified** | Nobody can say what "done" is | `@spec-writer`, then **stop** |

Two rules about that table:

- **Read down, stop at the first row that fits.** The rows get more expensive.
- **"Not specified" wins over everything else.** A vague ask routed into a
  fan-out produces five confident interpretations and a merge conflict. Shape it
  first, even when the work sounds small.

## 2. Check the preconditions the row assumes

Each row further down has an entry condition, and skipping it is the usual way
this goes wrong:

- **Anything delegated** needs a runnable check. If the repository is not
  registered (`node scripts/repos.mjs list`), no check runs there and no agent's
  "done" means anything. Register it first.
- **`fanout`** needs disjoint file sets, interfaces written down verbatim,
  declared ordering, and a check per slice. The skill re-checks all four; failing
  one means sequential was faster.
- **`multi-repo`** needs every affected repository registered and green, and a
  named list of consumers. `@impact-scout` produces that list; a plan written
  before it arrives is fiction.
- **`fleet`** needs work that can be specified once and checked by a machine. If
  it will need clarification mid-flight, autonomy is fiction.

If a precondition fails, say which one and route to the row above instead. Rolling
down the ladder is a normal outcome, not a retreat.

## 3. Hand off

Say the classification, the destination, and the one precondition you checked
that mattered. Then start it. Do not narrate the table.

```
SHAPE:   <which row, and the tell that decided it>
GOING TO: <inline | @explore | plan | fanout | multi-repo | harden | fleet | @spec-writer>
BECAUSE:  <the precondition you confirmed, or the one that pushed it down a row>
```

## Unclear

If the request is ambiguous in a way that changes the *design*, ask the human -
one question, the one whose answer moves the most. If it is ambiguous only in
wording, decide it yourself and note the assumption in one line.

If it is ambiguous about what finished looks like, that is not a question, it is
`@spec-writer`.

## Rules

- **Never route up a row for thoroughness.** Extra structure is not extra care;
  it is extra places for intent to be paraphrased. The measure is whether the
  human writes fewer messages, not whether more agents ran.
- **Never route down to avoid the check.** "It is only small" is how an
  unregistered repository gets an unverified change.
- One classification per request. If the request contains two genuinely different
  pieces of work, say so and route each - do not average them into one shape.
