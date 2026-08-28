---
name: plan
description: Turn a feature request into a reviewed delegation plan - the tech-lead agent drafts slices with interfaces and runnable checks, the critic attacks them, and you present a plan that survived contact. Use before writing code on anything spanning more than one file or one session.
---

# Plan

Produce a delegation plan for the request, reviewed before anyone writes code.
This is the cheapest place to fix a design, so spend here.

## Steps

**0. Check the ask is shaped.** Can you state, in one sentence, what will be
observably different when this is done, and name something that would prove it?
If not, stop and send `@spec-writer` first, then show the human its outcomes and
open questions before drafting anything. A plan built on an unshaped ask
decomposes a guess into slices, and every slice inherits the guess. This gate
costs one agent; skipping it costs the fan-out.

**1. Ground yourself first.** Read `AGENTS.md` and skim the directory structure.
If the request touches an area you have not read, send one or two `@explore`
agents with specific questions. Do not send one to "look around" - give each a
question that has an answer. Explore runs on a cheap model in its own context
and is safe to call in parallel; that is exactly what recon should cost.

If the change touches something other repositories consume - an endpoint, a
published type, a schema, a queue - send `@impact-scout` as well. Explore is
scoped to this working directory; the scout crosses repository boundaries. Plan
from its table, because the consumer nobody remembered is what makes a plan wrong.

**2. Draft the plan.** Delegate to `@tech-lead` with: the request, what explore
found, and any constraint the human stated. Ask for the full plan format -
slices with owned file sets, interfaces written out verbatim, a runnable "done
when" per slice, and the parallel-versus-sequential call including *which*
parallel mechanism.

**3. Attack it.** Pass that plan to `@critic`. The critic reviews the plan, not
the request - it decides whether these are the right slices, whether the seams
are real, whether the parallel mechanism matches the slices, and whether
anything load-bearing was assumed rather than read.

**4. Reconcile.** Apply the critic's findings yourself. Where you disagree with a
finding, say why in one sentence rather than silently dropping it. If the
verdict is "rework", go back to step 2 with its findings - do not paper over a
rework verdict by editing around the edges.

**5. Present.** Give the human:

- the slices as a table: name, repo, files, interface, depends on, done when
- what runs in parallel and what is strictly ordered
- for multi-repo work: the rollout order and the delivery mode it assumes
- the critic's surviving concerns, if any
- the single riskiest assumption, and the cheapest way to test it early

If the plan will be fanned out, also write `slices.json` in the shape
`scripts/fanout.mjs` expects - including `repo` and `dependsOn` per slice - so
the next step is one command rather than a translation exercise.

Then stop. Do not start implementing. Planning and building in one turn is how
plans get quietly abandoned halfway through.

**Unless `crew` sent you here.** Then this skill is one stage of a longer run,
not the answer: hand the plan back and let `crew` resume at its step 3. Stopping
here would end a run that was asked to change something without changing
anything, which is the more expensive failure of the two. The safeguard the stop
exists for - a wrong plan implemented before anyone read it - is still met,
because `crew` shows the plan before it implements it.

## Rules

- No plan for code nobody read. Every claim about existing behaviour needs a
  `file:line` behind it.
- If the work turns out to be one slice, say so and say it does not need a plan.
  A one-slice answer is a good outcome, not a failed workflow.
- If the request is ambiguous in a way that changes the design, ask the human
  before drafting. Ambiguity that only changes wording, decide yourself and note
  the assumption. Ambiguity about what *finished* means is neither - that is
  step 0 and `@spec-writer`.
