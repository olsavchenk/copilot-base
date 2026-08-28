---
name: multi-repo
description: Land one change across several repositories at once - find every consumer, write the contract once, run the repos in dependency waves, then roll out. Use for API, schema, shared-type or client-library changes that break more than one service.
---

# A change across several repositories

> `<base>` is the copilot-base install, `~/.copilot/copilot-base`. Substitute the
> absolute path the session brief prints - these scripts are not on `PATH`.

The shape this exists for: one API changes, and five services that call it have
to change with it. Doing that repository by repository means the contract gets
re-decided five times, and you find out on the fifth that the first one was
wrong.

## 1. Establish the blast radius before designing anything

Send `@impact-scout` with the concrete identifier - the route, the type, the
field, the queue - not the feature name. It searches across the organisation and
the local clones and comes back with a table of consumers.

Two outputs from that table matter more than the rest:

- **Consumers nobody knew about.** These are why the first plan is usually wrong.
- **Affected repositories that are not registered.** Nothing can fan out into
  them until they are: `node <base>/scripts/repos.mjs add <path> --verify "<check>"`.

## 2. Write the contract once, before anyone starts

This is the multi-repo version of the interface-first rule, and it is stricter,
because two repositories cannot see each other's types. Write the new contract
out **verbatim** - the schema, the OpenAPI fragment, the type definition - and
say what each consumer resolves it *from*: a published package version, a
generated client, a spec file, a copied type. "Both sides agree" is not a
mechanism; a version number is.

If the contract cannot be expressed that concretely, the change is not ready to
fan out.

## 3. Plan it as waves

Use the `plan` skill. The plan needs, per slice: the repository, the file set,
the contract, a runnable check, and `dependsOn` naming the slices that must be
green first. Providers have no dependencies; consumers depend on the provider
slice.

`@critic` reviews it as usual, with one extra question for this shape: does every
consumer slice actually resolve the contract from somewhere real, or is it
assuming a type it cannot see?

## 4. Run it

```
node <base>/scripts/fanout.mjs run slices.json --dry-run   # waves, briefs, branches
node <base>/scripts/fanout.mjs run slices.json
```

Each slice gets its own worktree, its own branch in its own repository, its own
capped session, and its own check. Waves run in order: the provider finishes and
goes green before any consumer starts. If a wave comes back red, later waves do
not start - a consumer built against a broken provider is worse than a consumer
that was never started.

Nothing is written inside your work repositories: worktrees and run artifacts
live under `~/.copilot/copilot-base/`.

## 5. Roll out

Hand the run report to `@rollout`. It checks the order still holds, verifies each
consumer against its provider, and then delivers according to the mode:

- **`local`** - prints the exact push and PR sequence, pushes nothing
- **`pr`** - pushes each branch and opens a cross-linked PR per repository, in
  dependency order

Check which mode you are in before you start (`node <base>/scripts/repos.mjs list`), not
after.

## 6. Harden what matters

Run the `harden` skill on the repositories where the change is risky rather than
on all of them. For an API change that is usually the provider - it is the one
whose mistake reaches everybody.

## When not to use this

- **One repository.** Use `plan` and `fanout` directly.
- **The same kind of work, done separately in each repository.** Upgrading the
  dependencies everywhere, adding a licence header everywhere, fixing one lint
  rule everywhere - these span repositories without binding them. There is no
  contract to write once, nothing for a consumer to resolve, and no order that
  protects anything. Use `fanout`, which runs across several repositories
  natively; each repository is its own slice with its own check. The tell is step
  2: if you cannot name what one repository publishes and the others consume,
  you are in the wrong skill, and you will find that out at the contract step
  having already paid for the scout.
- **The consumers can be updated later.** If the change is backwards compatible,
  ship the provider and let consumers move at their own pace. A coordinated
  rollout is expensive and should be reserved for changes that actually break.
- **You cannot name the consumers.** Then the first task is `@impact-scout`, and
  a plan built before that answer arrives is fiction.

## The failure this exists to prevent

Half the repositories move and half do not. Everything passed its own check;
production is broken at the seam. The countermeasures are all above and none of
them are optional: waves so a consumer never lands against a broken provider, a
contract written once, and a rollout that keeps the order rather than pushing
everything at once and hoping.
