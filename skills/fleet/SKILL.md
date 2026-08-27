---
name: fleet
description: Run long-lived, named Copilot sessions that can be addressed, resumed, restarted and supervised across processes. Use when work outlives a single session - multi-day slices, several concurrent workstreams, or anything you want to check on and nudge rather than watch.
---

# Fleet

`scripts/fleet.mjs` runs work as **named sessions** rather than as processes you
have to babysit. A session survives the process that started it, so a member can
be addressed later by name: nudged, restarted, or asked what it did.

This is the top of the ladder. Before reaching for it, be honest about whether
you have the preconditions - most work does not need it, and a fleet you cannot
review is worse than sequential work you can.

## When it is justified

All four have to be true:

1. **The work can be specified once.** If it needs clarification mid-flight,
   autonomy is fiction and you will spend the day answering questions.
2. **Completion is machine-checkable.** Otherwise nothing but you can tell a
   finished member from a stuck one.
3. **There is enough concurrent work** to keep several members busy. With one
   workstream, this is ceremony around a single session.
4. **Conventions are written down.** Whatever is not in `AGENTS.md` gets
   re-decided, differently, by each member.

If any is false, use `/fleet` for in-session parallelism or the `fanout` skill
for a bounded parallel run, and come back to this later.

## Driving it

```
node scripts/fleet.mjs start orders --repo orders-api --brief plans/orders.md --worktree feat/email --autopilot 20
node scripts/fleet.mjs list
node scripts/fleet.mjs status orders
node scripts/fleet.mjs say orders "the User schema changed - rebase onto main and adjust"
node scripts/fleet.mjs restart orders
node scripts/fleet.mjs stop orders
node scripts/fleet.mjs watch --interval 120 --max-restarts 3
```

- **start** puts the member in a repository (`--repo <registry name or path>`,
  defaulting to the one you are standing in), gives it its own worktree and
  branch when `--worktree` is passed, its own session id, and a credit cap.
  `--autopilot N` is what buys long autonomy: the session continues itself up to
  N times instead of stopping at the end of one turn.
- **say** takes a turn on an existing session, which is how you correct a member
  without restarting it and losing what it knows. It refuses while the member is
  still running - two processes on one session fight.
- **watch** is the supervisor: it restarts members that died and stops trying
  after `--max-restarts`, logging to `~/.copilot/copilot-base/fleet/incidents.log`.

The fleet is machine-wide, not per repository: state lives under
`~/.copilot/copilot-base/fleet/`, so `list` shows every member across every
repository you are working in, which is the view you want when a change is
landing in five services at once. Members never push - delivery is `@rollout`'s
job, and it obeys the delivery mode.

## On supervising the supervisors

The published version of this pattern is two lead agents that hold each other
accountable and restart whichever one failed. The part that matters is turning a
*silent* failure into a *detected* one - and a watchdog loop does that
deterministically, for free, and cannot convince itself that everything is fine.

So: `watch` handles liveness. Use a lead agent for the part that actually needs
judgment - reading `status` output and deciding whether a stalled member should
be re-briefed, restarted, or killed. That is a decision, not a heartbeat.

## The metric

The point of a fleet is that **you write fewer messages**, not that more agents
are running. If your message count is going up, roll back down the ladder. A
fleet whose output you cannot review is not capacity, it is a queue of work you
will have to redo.
