---
name: harden
description: Adversarial review sweep of the current branch - correctness, security and test coverage in parallel, then one ranked, de-duplicated verdict. Use before opening a PR, and always for anything touching auth, money, personal data or a public surface.
---

# Harden

Review the current branch from three angles at once and hand back one ranked
list.

## Steps

**1. Establish the diff.** `git diff --stat` and `git log --oneline` against the
base. If the branch is empty or identical to the base, say so and stop.

**2. Three reviewers, in parallel, in one message:**

- `@code-review` - correctness. The CLI's built-in reviewer. Ask for coverage
  rather than filtering: every finding with a concrete failure scenario and a
  confidence label, including the ones it is unsure about.
- `@security-review` - authorization, injection, secrets, SSRF, deserialization,
  dependency risk. Run it only if the diff plausibly touches any of those; say so
  and skip it if it does not.
- `@test-author` - not to write tests here, but to answer: which behaviours
  introduced or changed by this diff have no test, and which existing tests would
  fail to catch a regression here.

Give each the same base ref. Do not give them each other's output - you want
three independent reads, not one read plus two confirmations.

**3. Merge the findings.** De-duplicate where two reviewers found the same thing,
and note that they agreed: independent agreement raises confidence. Rank by what
would cost most to discover in production, not by which reviewer found it.

**4. Verify the top findings yourself.** For each of the highest-severity claims,
open the file and confirm it. Reviewers report suspicions by design; you are the
step that separates confirmed from plausible. Label each finding one or the
other.

## Report

A single ranked list. Per finding: `file:line`, the defect in one sentence, the
failure scenario, confirmed-or-plausible, severity.

Then a verdict: ship, ship after fixing the listed items, or do not ship. Say
which. A sweep that ends in "several things to consider" wasted three agents.

## Rules

- Do not fix anything here. This produces a verdict; fixing is a separate,
  deliberate step.
- Do not drop low-severity findings. Rank them last; let the human cut.
- If all three come back clean, say what was checked and where. "Nothing found"
  without coverage is indistinguishable from not having looked.
- `/review` and `/security-review` are the same agents driven by hand. Use them
  when a human wants one angle; use this skill when you want all three plus the
  ranking.
