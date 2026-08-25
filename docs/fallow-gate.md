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

## The backlog is real and is not cancelled by this

48 dead exports, 222 dead types, 4 remaining cycles and 293 over-threshold
functions are a genuine maintenance backlog for this repo. Baselining records
them; it does not forgive them. They deserve their own work, sized and scheduled
on their own merits — not paid down accidentally by whichever change happens to
touch a barrel.
