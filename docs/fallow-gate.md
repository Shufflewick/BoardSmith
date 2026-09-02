# The fallow gate, and why this repo has baselines

## What happened

ShufflewickPub's `.claude/hooks/fallow-gate.sh` resolves the target repository
**from the intercepted git command**, so it audits *this* repo whenever an agent
runs `cd ~/BoardSmith && git commit`. That is deliberate on its side and it is
reasonable — but it applied a gate designed for an application to a **published
library that carries an existing debt backlog**, and the first thing it did was
produce a false block.

The mechanism of the false block matters, because it will recur:

`fallow audit` is scoped to files changed against the base branch. ShufflewickPub
Phase 68 must edit `src/engine/index.ts` — a **barrel** — to make a new export
reachable from the package root. That edit is not incidental: reachability from
the package root is exactly what prevents the dropped-key defect class
ShufflewickPub has now hit three times (`asyncPlay`, `roundDeadline`,
`playerOptions`). But touching a barrel drags **every pre-existing dead
re-export in it** into audit scope.

Measured on `main` at `047227c1`:

| | count |
|---|---|
| unused exports | 48 |
| unused types | 222 |
| circular dependencies | 7 |
| functions above a complexity threshold | 293 |

None of that belongs to the change being committed. A gate that blocks correct
work on unrelated debt teaches people to bypass the gate — which
`fallow-gate.sh`'s own header warns about, in those words.

## What was done

**Three of the circular dependencies were FIXED, not baselined**, because they
were the ones the work actually surfaced and they were real:

- `src/engine/utils/enumerate-moves.ts` imported its own package barrel
  (`../index.js`). That single edge was the path **all three** reported cycles
  routed through. It now imports from the defining modules
  (`element/game.js`, `player/player.js`, `action/types.js`,
  `flow/seat-activity.js`). A barrel import is never load-bearing — every name
  had exactly one defining module.
- `enumerate-moves.ts` and `resolve-multiselect.ts` imported each other
  (`parseMultiSelect` one way, `resolveMultiSelect` the other). `parseMultiSelect`
  is a pure normalizer with no dependency on enumeration, so it **moved** beside
  its only consumer. No shim module was introduced.
- `combinationsOfSize` and `parseMultiSelect` became module-private. Both were
  public API with **no consumer anywhere** — not here, not in
  `~/BoardSmithGames`, not in MERC (checked, not assumed).
  `combinationsOfSize`'s docblock claimed it was "exported for bot import +
  testability"; no bot and no test had ever imported it, so the export was the
  stale half of that sentence rather than a contract.

**The rest is baselined**, which is fallow's own designed mechanism for exactly
this and is *not* the same as switching the gate off:

- `.fallow-dead-code-baseline.json` and `.fallow-health-baseline.json` capture
  the debt as it stood at `047227c1`.
- Anything **new** still fails. This was proven rather than assumed: moving
  `parseMultiSelect` produced a fresh "unused export" finding, the gate caught
  it, and it was fixed by making the function private. A baseline that hid new
  findings would not have flagged it.

`postcss-html` is in `ignoreDependencies` as a **verified false positive**:
`.stylelintrc.cjs:5` sets `customSyntax: 'postcss-html'`, a string reference no
static import analyzer can see.

## Regenerating the baselines

Do this deliberately — never to turn a red board green.

```bash
git worktree add /tmp/bs-baseline main
cd /tmp/bs-baseline
npx fallow dead-code --save-baseline .fallow-dead-code-baseline.json
npx fallow health   --save-baseline .fallow-health-baseline.json
cp .fallow-*.json ~/BoardSmith/
git worktree remove /tmp/bs-baseline
```

Generating from a clean `main` worktree is the point: a baseline taken from a
dirty tree bakes in the very findings the gate is supposed to catch.

## Drift is checked, not scheduled

The baselines are generated files and nothing keeps them in sync, so they drift.
When they do, the gate stops excluding a file's long-standing debt and reports
all of it against whatever change happened to touch that file. Measured on
`main`: one appended comment line in `src/engine/action/action.ts` produced
seven critical complexity findings, none of them introduced by the change, and
the commit was blocked (issue #159). That reads as a gate catching something
rather than as a stale generated file — which is exactly the shape that teaches
people to bypass gates.

The answer is neither a regeneration schedule (a cron that rots quietly is the
same failure one step removed) nor `// fallow-ignore-next-line complexity` on
each hotspot (which hides the debt the baseline exists to record, and needs
re-adding for every hotspot that comes after). Drift is made into a named
finding of its own:

```bash
boardsmith audit --health-baseline
```

It saves a fresh `fallow health` baseline from the working tree, compares it
against the committed one entry by entry, and reports every drifted
(file, category) with which direction it drifted:

- **the tree has more than the baseline forgives** — the next edit to that file
  is blocked on debt it did not add. This is the false-block mechanism above.
- **the baseline still forgives debt that is gone** — a real regression could
  slip back in under the old allowance.

Either way the report names the regeneration command. It runs as part of a bare
`boardsmith audit`, so the drift surfaces on the sweep you already run after a
refactor rather than on whoever next edits a drifted file.

## A `duplicate_exports` key can fail while already being baselined

Recognise this one before you go hunting for new duplication, because the
finding looks new and is not.

A `duplicate_exports` baseline key is the exported name followed by **every
file that exports it**:

```
ActionResult|src/client/types.ts|src/engine/action/types.ts|src/session/game-session.ts|src/ui/composables/useActionControllerTypes.ts
```

The two sides of the comparison are built differently. The baseline is saved by
`fallow dead-code --save-baseline` over the WHOLE repository, so its key lists
all of the exporting files. `fallow audit` is scoped to the files changed since
the base branch, so its key lists only the exporting files **that the branch
happens to touch**. A branch touching some of them therefore produces a strict
SUBSET key, which matches nothing, and already-accepted debt is reported as a
fresh failure.

It surfaced on the AI-to-Bot rename (issue #28), which dragged four such files
into scope at once and failed on `ActionResult`, `FollowUpAction`, `Player` and
`RefWithRole` — each already baselined under a longer list.

How to tell it apart from real duplication, in one step: compare the finding's
file list against the baselined entry for the same name. If the finding's list
is a subset, the branch did not add an export; it only brought fewer of the
existing ones into scope. A subset means strictly LESS duplication than what is
already accepted.

The fix is to append the scoped key alongside the full one. Both spellings of
the same debt then live in the baseline, which is why the file can hold two
entries for one name. This is recording the debt in the only vocabulary the key
format has, not widening the exemption: a genuinely new exporting file produces
a key that is not a subset of anything, and still fails.

Do not reach for `fallow-ignore` comments here, and do not regenerate the
baseline hoping to clear it — a full-repo run reproduces the long keys and
changes nothing. The durable fix belongs in fallow itself: match a finding whose
file list is a subset of a baselined entry with the same name.

## The backlog is real and is not cancelled by this

48 dead exports, 222 dead types, 4 remaining cycles and 293 over-threshold
functions are a genuine maintenance backlog for this repo. Baselining records
them; it does not forgive them. They deserve their own work, sized and scheduled
on their own merits — not paid down accidentally by whichever change happens to
touch a barrel.
