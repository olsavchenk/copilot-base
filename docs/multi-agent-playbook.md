# The multi-agent development playbook

A working analysis of how agent-assisted development is actually organised, what
each topology buys, what it costs, and when to use which. Written to be read once
by a human and then referenced by agents.

The mechanics here are GitHub Copilot CLI's. The inventory of what the CLI
provides natively is in [copilot-cli-capabilities.md](copilot-cli-capabilities.md);
this document is about which shapes to use and when.

---

## 1. What multi-agent actually solves

Every topology below exists to relieve one of exactly four constraints. Naming
which one you are relieving is the difference between a useful setup and an
elaborate one.

| Constraint | What it looks like | What relieves it |
|---|---|---|
| **Context pollution** | Reading a 4,000-line log to find one error poisons the rest of the session | An isolated subagent: it reads, you get the answer |
| **Wall-clock latency** | Six independent changes done one after another | Parallel agents, isolated when they write |
| **Single-perspective blindness** | The author of a design cannot see its flaws | Adversarial roles: critic, reviewer, red team |
| **Human attention** | You are the bottleneck because every decision routes through you | A supervisor tier that absorbs routine decisions |

If a proposed setup does not clearly relieve one of these, it is decoration. The
most common mistake is spawning agents for *parallelism* on work that is
sequential, which relieves nothing and adds coordination cost.

There is also a fifth thing multi-agent does **not** solve, and it is worth
stating: it does not make a bad specification good. Ambiguity multiplies across
agents. One agent with a vague brief produces one confused result; five agents
with a vague brief produce five mutually incompatible confused results and a
merge conflict.

---

## 2. The primitives

The pieces the topologies are built from, in Copilot CLI terms.

**Subagent.** A separate agent with its own context window, its own tool set and
its own model. It receives a brief, works, and returns a report; its transcript
never enters the caller's context. Reached with `@name`, `/agent`, `--agent`, or
the `task` tool. This is the atom.

**Custom agent.** A `*.agent.md` role definition, installed to `~/.copilot/agents/` so it is available in every repository. This is how
a topology stops being something you re-explain every time. The `tools:` field is
load-bearing: a read-only role that *cannot* write is a stronger guarantee than a
role that has been asked not to.

**Skill.** A `SKILL.md` procedure, installed to `~/.copilot/skills/` and loaded into the **main**
agent's context. Workflows live here because orchestration has to happen in the
session that can spawn subagents.

**Fleet mode.** `/fleet` makes the main agent an orchestrator: it splits the
objective, dispatches independent subtasks to background subagents, waits on
dependencies, and synthesises. The subagents share one working tree and one HEAD.

**Worktree isolation.** Not native. A git worktree gives an agent its own
checkout sharing one object store, which is what makes parallel *writing* with
separate branches possible. `scripts/fanout.mjs` and `scripts/wt.mjs` provide it.

**Direct messaging.** `list_agents`, `read_agent` and `write_agent` let an agent
address a running subagent inside its own session. Across sessions, the addressing
mechanism is the session id itself: `--session-id` on the way in, `--resume` on
the way back, which is what `scripts/fleet.mjs say` uses.

**Session persistence.** A session outlives its process. This is the difference
between "an agent that is running" and "an agent you can come back to".

**Autopilot.** `--autopilot --max-autopilot-continues N` lets one run continue
itself instead of stopping at the end of a turn. This is where multi-day autonomy
actually comes from.

**Hooks.** Deterministic commands the CLI runs at fixed lifecycle points,
independent of what the model decides. The only mechanism here that does not
depend on a model choosing to comply.

**Budgets.** `--max-ai-credits` caps a session and everything it spawns. In a
fan-out this is not an optimisation, it is a safety rail.

**Delegation to the cloud.** `/delegate` hands the session to GitHub, which
finishes the work and opens a PR. Another machine's problem, another machine's
wall clock.

---

## 3. The topologies

Seven shapes, ordered by coordination cost. Each has a real cost and a real
failure mode; none is strictly better than the ones above it.

### 3.1 Solo

One agent, one context, sequential work.

**Use when** the task fits in one context window and the steps depend on each
other. This is most work, most of the time, and it should be the default.

**Cost** Cheapest per unit of work. No coordination, no merge, no briefing
overhead.

**Fails when** the context fills with material that mattered for step two and is
noise by step nine. The tell is the agent re-reading files it already read, or
contradicting something it established earlier. `/compact` buys a little room;
a new session buys more.

### 3.2 Scout (context isolation)

The main agent delegates *reading* to short-lived subagents and keeps only their
answers.

```
main ──▶ @explore ──▶ (reads 400 lines) ──▶ "it's in auth/session.ts:88"
```

**Use when** an answer requires wading through volume: logs, wide greps, "which
of these 30 files does X", dependency archaeology. Use `@task` for the same
reason on command output - it returns one line on success and the full failure on
failure.

**Cost** Near zero coordination. One extra model call, on a cheap model, and you
save the difference between what it read and what it reported - permanently, for
the rest of the session.

**Fails when** the question is underspecified. An agent sent to "look around"
returns a summary of everything, which is exactly what you were avoiding. Send
questions that have answers.

**This is the highest return-per-effort pattern on the list.** It is also the one
people skip, because it does not feel like multi-agent anything.

### 3.3 Adversarial pair

Two roles with opposed incentives on the same artifact: author and critic,
implementer and reviewer, generator and red team.

```
@tech-lead ──▶ plan ──▶ @critic ──▶ findings ──▶ revised plan
```

**Use when** the failure mode is *plausible but wrong* rather than *broken*. A
design that compiles, a plan that reads well, code that passes its own tests.
Single-perspective blindness is not fixed by asking the same agent to check its
work; it is fixed by an agent whose stated job is to find fault.

**Cost** One extra pass per artifact. Small, and paid at the cheapest possible
moment if you do it at the plan stage.

**Fails when** the critic has no teeth. A reviewer told "flag only important
issues" will faithfully filter, and you will measure a drop in findings and
conclude the code got better. Ask for coverage with confidence labels, and filter
downstream.

### 3.4 Pipeline

Fixed sequence of specialised stages, each consuming the last one's output.

```
plan ──▶ implement ──▶ test ──▶ review ──▶ integrate
```

**Use when** the stages are genuinely different kinds of work and the ordering is
real. The value is not parallelism (there is none) but that each stage gets a
clean context and a single job.

**Cost** Latency is the sum of all stages. Handoffs lose information: each stage
knows only what the previous one wrote down.

**Fails when** a late stage discovers the early stage was wrong. The whole
pipeline reruns. Mitigate by putting the cheap adversarial check early: a critic
after `plan` costs one pass, a reviewer after `implement` costs a rebuild.

### 3.5 Fan-out (map)

N agents, N disjoint slices, in parallel, then a merge.

```
                ┌─▶ implementer A ─┐
plan ──▶ split ─┼─▶ implementer B ─┼─▶ integrator ──▶ review
                └─▶ implementer C ─┘
```

**Use when** you have several genuinely independent slices and wall-clock time
matters.

Two mechanisms, and the choice is not stylistic:

- **`/fleet`** - subagents in one working tree. Right when the slices need only
  disjoint *files* and one combined commit.
- **`scripts/fanout.mjs`** - a worktree, a branch, a capped session and a
  transcript per slice. Right when slices need their own commits, or when the
  check binds something exclusive: a port, a test database, a build directory.

**Cost** The one people underestimate: **integration**. Merge conflicts, interface
drift, and the class of bug where every slice passes its own check and the union
does not. Budget the integrator as a real stage, not a `git merge`. Fleet mode
also multiplies model calls, so it multiplies credits.

**Fails when** the slices were not actually disjoint. The four preconditions are
non-negotiable: disjoint file sets, interfaces written down before anyone starts,
declared ordering rather than assumed ordering, a runnable check per slice. Fail
any one and sequential would have been faster. `scripts/fanout.mjs` refuses to
start if it can see the failure.

### 3.5b Fan-out across repositories

The same shape, with the seams moved to repository boundaries: one change, N
services, one branch each.

```
impact-scout ──▶ contract ──▶ wave 1: provider ──▶ wave 2: consumers ──▶ rollout
```

Three things change, and each of them is a new way to fail:

**The interface is not a type any more, it is a published thing.** Two slices in
one repository can share a type because the compiler sees both. Two repositories
cannot. The contract has to be written once and *resolved from* something real -
a package version, a generated client, a spec file. "Both sides agree" is not a
mechanism.

**Ordering is real.** The provider must be green before consumers build against
it, so the slices form waves rather than one flat batch. This costs wall-clock
time by construction; it is the price of not discovering at merge time that the
contract moved.

**There is no union to verify.** Nothing merges these into one branch, so the
integrator has nothing to run. What replaces it is a rollout: the order held, the
consumers verified against the provider, and delivery per the configured mode.

**Fails when** the consumer list was wrong. This is the dominant failure and it
happens before any agent runs - which is why `@impact-scout` comes first and why
"repositories affected but not registered" is the line of its report that matters.

### 3.6 Supervisor tree

A hierarchy: leads that delegate to mid-tier agents that delegate to workers.
Humans talk mostly to the top.

```
human ──▶ lead ──▶ project agent ──▶ worker
                                 └─▶ worker
```

**Use when** the number of concurrent workstreams exceeds what one human can
brief and review directly. The tier exists to absorb decisions, not to add
ceremony: a middle tier that forwards everything upward is pure latency.

**Cost** Every layer is a lossy translation. The worker acts on the lead's
paraphrase of your intent. Errors compound downward and are discovered late.
Requires each tier to have real decision authority, which requires you to have
written down what "good" means well enough that an agent can judge it.

**Fails when** the tree is deeper than the work is complex, or when a tier has no
authority. Two levels is a lot. Three is rare and usually a sign the slices are
too small.

### 3.7 Peer mesh

Long-lived agents that coordinate without routing through a human.

**Use when** agents run long enough to need mid-flight coordination: "I changed
the interface", "I am blocked on your slice", "you died, restarting you". Inside
one session, `write_agent` does this natively. Across sessions,
`scripts/fleet.mjs say` takes a turn on another member's session, and `watch`
handles liveness.

**Cost** Highest. It is a distributed system with the failure modes of one:
deadlock (two agents waiting on each other), livelock (two agents endlessly
renegotiating), partition (an agent that died and nobody noticed), and messages
whose content nobody audited. Debugging is genuinely hard because there is no
single transcript.

**Fails when** there is no supervision of the supervisors - and note that the
countermeasure does not have to be another model. A watchdog loop detects a dead
member deterministically, for free, and cannot talk itself into believing
everything is fine.

---

## 4. The published fleet, dissected

The most complete public account of a working fleet comes from Daisy, an engineer
on the Claude Code team:

> My daily driver currently looks like: two lead agents that keep each other
> accountable and restart the other if either fails. These delegate to tech lead
> or PM agents for the 8-10 projects I'm running at any one time, and each
> project has 5-10 IC agents, generalists or specialists depending on the
> problem. Across all of these I'm still only doing 30-50 prompts per day, and my
> IC agents typically work autonomously for 2-3 days. About 60% of my interaction
> is with the leads, 35% with a project lead, and 5% is when something has gone
> off the rails. All of these agents communicate directly with the SendMessage
> tool.

Seven design decisions, each doing specific work, and what each maps to here.

**Two leads, not one.** A single top-level agent is a single point of failure:
when it dies the fleet is orphaned and nobody notices until you look. Redundancy,
not throughput. → `fleet watch` is the deterministic version, and it is the part
worth copying first.

**Mutual restart.** Not "alert the human" - the fleet self-heals for the failure
mode that would otherwise consume the human's attention. Note what this
presupposes: that "progress" is observable from outside. → `fleet restart` resumes
the member's own session rather than starting over, so the work survives.

**A tier per project.** 8-10 projects, one lead agent each, because 8-10
concurrent contexts do not fit in one agent. Two levels, no more.

**5-10 workers per project, generalist or specialist by need.** The choice is made
per problem, not by policy. A specialist role is worth defining when you will use
it repeatedly. → `agents/` is where the repeatable ones live.

**2-3 days of autonomy per worker.** This number reveals what kind of work is
being delegated: something specifiable once, needing no clarification, with a
check that determines completion without a human. That is a strong filter. Most
feature work does not qualify; migrations, test coverage, systematic refactors and
investigations do. → `--autopilot` with a credit cap, plus a `subagentStop` hook
that refuses "done" on a red check.

**30-50 prompts per day from the human.** The success metric, and the one most
people invert. The purpose of the fleet is not more agents or more output. It is
that the human writes fewer messages. Any change that increases your message count
is a regression, whatever else it improves.

**60 / 35 / 5.** Most interaction at the top tier, some at project level, a little
firefighting. If firefighting is 30%, the tree is wrong.

**Direct messaging.** Without it, every coordination fact routes through the
human, and the human becomes the message bus. → `write_agent` within a session,
`fleet say` across them.

### What it presupposes

Copying the shape without the preconditions produces a mess:

1. **Work that can be specified once.** Otherwise autonomy is fiction.
2. **Machine-checkable completion.** Otherwise no tier can judge a worker's output
   and everything escalates to you.
3. **Enough concurrent work to saturate the tree.** With one project, the tiers
   have nothing to absorb.
4. **Written conventions.** Whatever is not in `AGENTS.md` gets re-decided,
   differently, by each worker.

If you have one project and no written conventions, the correct topology is 3.1
with a bit of 3.2. Start there and let the constraints push you up.

---

## 5. The economics

### Context

Context is the scarce resource, and it behaves worse than intuition suggests.
Every turn re-reads the entire conversation, so the cost of turn N is proportional
to the whole history and a long session is superlinear. Two consequences:

- Start a new session between unrelated tasks rather than carrying one all day.
- Delegate anything that generates volume you will not need again. `@explore`
  reading 400 lines and reporting 6 is not a stylistic choice, it is a change in
  the growth rate of your context.

`/context` shows where you actually are; `/compact` buys room at the cost of
detail.

### Credits

A subagent re-establishes context, so delegation has a floor cost. Below some task
size the briefing costs more than doing it inline. The threshold is roughly:
*would explaining this take longer than doing it?* If yes, do it.

Fleet mode is explicitly more expensive than doing the same work in one agent -
more independent model interactions, by design. Cap it: `--max-ai-credits` on
every spawned session, and `/limits` on your own.

### Latency

Fan-out converts wall-clock into coordination. Three slices in parallel finish in
roughly the time of the slowest, plus integration. If integration is 40% of the
work, three-way fan-out buys much less than it looks like it should.

Sequential is often faster than it feels, because the slowest part of parallel
work is not the work.

### Human attention

The real budget. Every agent you run is a thing that can come back wrong, and
reviewing wrong output costs more than producing it did. This sets a hard ceiling
on fleet size that has nothing to do with compute: **you cannot run more agents
than you can review.**

The only way to raise that ceiling is to make output checkable without you.

---

## 6. Verification is the binding constraint

Everything above depends on being able to tell, without a human reading it,
whether an agent's output is correct.

**The rule: never automate what you cannot verify.** An agent that fixes flaky
tests works because it reruns the tests until they pass - the loop has a
termination condition the agent can evaluate. An agent that "improves the code"
has no such condition and will either stop arbitrarily or keep going forever.

Verification, in rough order of strength:

| Level | Mechanism | Enables |
|---|---|---|
| 0 | A human reads it | Nothing beyond solo work |
| 1 | Compiler / typecheck | Slices with typed interfaces |
| 2 | Unit tests | Independent slices, fan-out |
| 3 | Integration tests | Multi-slice merges |
| 4 | Golden sets, evals, property checks | Long autonomy, self-correcting loops |
| 5 | Production signals with rollback | Scheduled and unattended work |

You can only run a topology whose coordination assumes level N if you actually
have level N. Fan-out with level 0 verification means you personally review every
branch, which is slower than having done the work yourself.

**Hooks are the enforcement layer.** A convention in a document is advice the
model may or may not follow. A hook is a command the CLI runs regardless. If a
rule matters - never commit to main, never edit generated files, always run the
typecheck after an edit - it belongs in a hook.

The strongest one available here is `subagentStop`: it can refuse a subagent's
completion and hand the failure back as the next turn's prompt. "Never report done
on a failing check" stops being advice and becomes a property of the system.

**Design the check before the work.** The plan format requires a runnable "done
when" per slice for exactly this reason. A slice whose completion cannot be
checked cannot be safely delegated, and finding that out before you spawn five
agents is much cheaper than after.

---

## 7. Coordination cost, and where it stops paying

Adding agents adds communication paths. Agents are cheap to add and free to brief
in parallel, but *integration* cost grows with the number of seams, and
integration is done by something that has to hold all the pieces at once.

- **Optimise for fewer, larger slices** that fit one agent. Three slices that land
  beat eight that need coordination.
- **A seam is expensive.** Two slices that share an interface cost more than the
  sum of two independent ones. If two slices need to negotiate, they are one.
- **Depth costs more than width.** Five workers under one lead is manageable.
  Three levels of delegation means your intent is paraphrased three times.
- **Integration does not parallelize.** It is the serial fraction, and it sets the
  ceiling on what fan-out can buy.

---

## 8. Failure modes

| Failure | Looks like | Countermeasure |
|---|---|---|
| **Interface drift** | Two slices implement the same contract differently; the union fails | Write the interface verbatim in the plan before spawning |
| **Overlapping writes** | Merge conflicts everywhere; two agents undoing each other | Disjoint file sets, checked at the gate rather than hoped for |
| **Shared-tree collision** | Two fleet subagents run the same test suite in one checkout | Use worktrees when the check is not concurrency-safe |
| **Green parts, red whole** | Every slice passes; the system does not work | The integrator runs the full suite on the union, plus the cross-seam path |
| **Confident wrongness** | An agent reports done; it isn't | Machine-checkable done criteria, and a `subagentStop` hook that enforces them |
| **Gamed verification** | The check is green because an assertion was deleted, a test skipped or a tolerance loosened | State the prohibition wherever the enforcement is - a hook that blocks red is what creates the incentive |
| **Silent stall** | An agent stopped and nobody noticed | `fleet watch`, or a scheduled progress check |
| **Context poisoning** | An early wrong fact propagates through everything | Isolate reading in subagents; verify load-bearing claims with `file:line` |
| **Review theatre** | The reviewer says it looks good, to everything | Demand coverage with confidence labels, not filtered severity |
| **Ambiguity amplification** | Five agents, five interpretations | Specify once, centrally, before fan-out |
| **Runaway cost** | A fan-out nobody capped | `--max-ai-credits` on every spawned session |
| **Fleet maintenance** | You spend the day managing agents | Watch the prompts-per-day metric; if it rises, roll back |
| **Missed consumer** | The change ships; a service nobody listed breaks in production | `@impact-scout` before planning, across repositories and local clones |
| **Cross-repo contract drift** | Each repository has its own copy of "the" type, and they diverge | Name what each side resolves the contract from, not just what it says |
| **Partial rollout** | Three repositories moved, two did not; the seam is broken | Waves, plus a rollout that keeps the order and stops on red |
| **Silent unguarded session** | Work happens in a repository with no check and nobody notices | The session brief says "not registered" out loud |

---

## 9. What this repository implements

| Concept | Where |
|---|---|
| Scout pattern | built-in `@explore` and `@task`; the base deliberately ships no replacement |
| Cross-repository recon | `agents/impact-scout.agent.md` |
| Shaping an unspecified ask | `agents/spec-writer.agent.md`, gated at step 0 of `skills/plan` |
| Choosing the shallowest topology | the sizing table in `skills/crew/SKILL.md` |
| Adversarial pair | `agents/critic.agent.md` on plans; built-in `@code-review` and `@security-review` on diffs |
| Pipeline | `skills/plan` then `fanout` then `harden` |
| Fan-out with a real gate | `skills/fanout/SKILL.md` and the gate inside `scripts/fanout.mjs` |
| Dependency waves | `waves()` in `scripts/fanout.mjs` |
| Worktree isolation | `scripts/fanout.mjs`, `scripts/wt.mjs` |
| Integration as a first-class stage | `agents/integrator.agent.md` (one repo), `agents/rollout.agent.md` (several) |
| Multi-repo runbook | `skills/multi-repo/SKILL.md` |
| Supervisor tree / peer mesh | `scripts/fleet.mjs`, `skills/fleet/SKILL.md` |
| Verification enforcement | `hooks/verify-after-edit.mjs`, `hooks/guard-subagent-done.mjs`, the registry's per-repo check |
| Protected surfaces | `hooks/guard-protected-paths.mjs`, `config/protected-paths` + registry entries |
| No direct commits to integration branches | `hooks/guard-main-branch.mjs` |
| Session and delegation grounding | `hooks/session-brief.mjs`, `hooks/subagent-brief.mjs` |
| Where per-repo facts live | `~/.copilot/copilot-base/repos.json`, read only by `hooks/lib/config.mjs` |
| Delivery as configuration | `deliveryFor()` in `hooks/lib/config.mjs`; `@rollout` obeys it |
| Written conventions | `AGENTS.md`, and the `workspace` skill for machine setup |
| Facts that outlive a session | `MEMORY.md` at the workspace root, `agents/memory-keeper.agent.md`, injected by `hooks/session-brief.mjs` |
| Zero-setup verification | `proposeVerify()` and `rememberRepos()` in `hooks/lib/discover.mjs` |
| Least privilege per role | `tools:` in the agent frontmatter; `--deny-tool` in the orchestration scripts |
| Anti-gaming of the check | non-negotiable 4 in `AGENTS.md`, restated in `implementer` and `test-author` |

---

## 10. The adoption ladder

Do not start at the top. Each stage has an entry condition, and skipping stages
produces the elaborate-but-useless setup this document exists to prevent.

**Stage 0 - solo, with hooks.** One agent. The toolkit installed, your
repositories registered, each with a check that is green today. *Entry: you have
a project.* This stage alone eliminates the most common class of error, and most
people should stop here for a while.

**Stage 1 - scouts and critics.** Delegate volume reading to `@explore`; run
`@critic` or `@rubber-duck` on plans before implementing. *Entry: your sessions
are long enough that context fills, or you have shipped a design you regretted.*

**Stage 2 - pipeline.** `plan`, then implement, then `harden`, as distinct stages
with clean contexts. *Entry: work regularly spans more than one sitting.*

**Stage 3 - fan-out.** `/fleet` for in-tree work; `scripts/fanout.mjs` when slices
need their own branches. *Entry: you have level 2+ verification and three or more
genuinely independent slices.*

**Stage 4 - multi-repo.** One change landing across several services: impact
scout, a contract written once, waves, rollout. *Entry: every affected repository
is registered with a check that passes, and you can name the consumers. Without
both, this stage produces a half-finished change spread over five repositories.*

**Stage 5 - supervisor tree.** A lead tier absorbing routine decisions. *Entry:
more concurrent workstreams than you can brief directly.*

**Stage 6 - fleet with supervision.** Long-running members, addressed by name,
restarted by a watchdog. *Entry: agents running unattended for days, and level 4+
verification.*

Most solo builders and small teams live productively at stages 0-2 and reach for
3 occasionally. Stage 4 is where a team with several services actually lives, and
it is worth noticing that its entry condition is bookkeeping - a registry and
green checks - rather than anything clever. Stages 5 and 6 are rarer than they
look. The value of knowing about the top of the ladder is recognising the moment
you actually arrive there, and recognising that the shape you copy has
preconditions attached.

---

## Sources

- Daisy, Engineer on Claude Code, quoted in *This week in Claude Code: /design,
  Concise output style, and more* (Claude Code newsletter, August 2026).
- GitHub, [Copilot CLI documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview) -
  hooks, custom agents, skills, fleet mode, plugins, the programmatic reference.
- Anthropic, [The Claude Code guide for startups](https://claude.com/blog/claude-code-guide-for-startups) -
  the verification-before-automation rule and the worktree rebuild pattern.
- Anthropic, [Maximizing the value of your Claude Code sessions](https://claude.com/blog/maximizing-the-value-of-your-claude-code-sessions) -
  the context and token economics in section 5.
