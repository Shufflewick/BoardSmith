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

The duplication baseline is NOT in that list, and must not be regenerated this
way: it is derived from `.fallow-dupes-accepted.json` by
`boardsmith audit --rekey-dupes`, which re-addresses only the debt whose content
still matches. A raw `fallow dupes --save-baseline` would forgive whatever new
duplication the tree happened to hold. See "The duplication baseline is keyed by
CONTENT" below.

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

## The browser regressions are entry points, not dead files (#230)

`scripts/*-browser.mjs` are deliberate runs: BoardSmith depends on no browser,
so they are not in `npx vitest run` and nothing imports them. Static analysis is
right that they are unreachable, and the first one was recorded in
`.fallow-dead-code-baseline.json` for that reason.

That stopped working the moment there were two of them. #230 added a second, and
extracting the ~200 lines of plumbing they shared into `browser-harness.mjs`
turned one accepted unused FILE into nine unused EXPORTS — a module that is
genuinely used, reported as debt because both of its consumers were themselves
invisible.

So `.fallowrc.json` now declares them:

```json
"entry": ["scripts/*-browser.mjs"]
```

That is a statement of fact rather than an exemption. Both scripts and their
shared harness came OUT of the dead-code baseline as a result, and a NEW
unreachable file elsewhere still fails. Any future browser regression under that
name is a root the moment it is written, which is the point: the shape that
makes the gate honest should be the shape that is easiest to reach for.

## The duplication baseline is keyed by CONTENT, not by line (#232)

`.fallow-dupes-baseline.json` used to be the record, and it keys a clone group
by `file:start-end`. That address is not a property of the debt; it is a
property of everything ABOVE the debt. Insert a line at the top of a file and
every accepted group in it is mis-addressed, silently, because `fallow audit`
has nothing in scope on `main` and never looks. The bill arrives for whoever
next edits one of the named files, as their change being blamed for clone
groups that predate it.

#230 measured it: a four-line edit to `GameShell.vue` surfaced six baselined
groups keyed 22 to 31 lines above where the code actually sat, and `main` had
already drifted 25 lines before that edit touched anything. #230 re-keyed those
six by hand. That fixed the instance and left the class.

**The record is now `.fallow-dupes-accepted.json`, and its key is a hash of the
clone group's own text** -- the SHA-256 of the group's instance fragments,
sorted lexicographically, which is exactly what `fallow dupes --format json`
already reports per instance.

That key is invariant under every change that is not this debt:

- code moving above it, below it, or in another file does not touch it;
- renaming the file does not touch it;
- moving the whole group to another file does not touch it, and should not --
  relocated duplication is the same duplication;
- two instances swapping places in one file do not either, because the
  fragments are sorted by their own text rather than by position.

And it still fails on what should fail. Copy-pasting an accepted clone into one
more place makes the group's fragment multiset larger, so the key changes and
the group reports as new. Editing the duplicated code changes its text, so it
reports as new too -- which is the honest answer, and it is the check this
document used to ask a human to do by eye before re-keying anything.

It is not absolute, and it is worth knowing why. Fallow decides where a clone
group starts and ends, so a large enough edit elsewhere in the same file can
make it cut the same debt a line or two differently, which is a new key for
what a reader would call the same clone. That was seen once, when extracting a
stub controller out of four ActionPanel test files moved the boundary of an
unrelated accepted group in one of them. It is a re-record rather than an
ambush, and it is orders of magnitude rarer than an address that moves whenever
anything above it does.

### The line-keyed file is now derived

`fallow audit` reads `.fallow-dupes-baseline.json` and the key format is
fallow's, not ours, so the file stays -- as a generated address book. Both
committed files come from one scan:

```bash
boardsmith audit --dupes-baseline   # the check
boardsmith audit --rekey-dupes      # re-address what still matches
```

The check asks two questions in order, because they have different answers:

- **Does the accepted CONTENT match?** If not, that is a finding about the
  code: duplication nothing accepted, or accepted debt that is gone. Named,
  with its files, and not re-keyable.
- **Do the addresses match?** If not, nothing about the debt changed and
  re-keying is provably safe, because the content matched first. The report
  says exactly that and names `--rekey-dupes`.

`--rekey-dupes` REFUSES to write anything when the content does not match. That
is what stops it being a button that turns a red board green: new duplication
has no entry to re-address, and there is no spelling of the command that
accepts it. Recording a tree wholesale is a separate, deliberate act -- delete
`.fallow-dupes-accepted.json` and re-key -- and it shows up as a large diff to
a committed file, which is the point.

### What the migration recorded, honestly

Measured when the content key was introduced, against a baseline that had gone
untended for some time:

| | count |
|---|---|
| clone groups in the tree | 1096 |
| already accepted at the right address | 953 |
| accepted, but silently mis-addressed (the #232 class) | 58 |
| accepted allowances whose duplication is gone | 24 |
| clone groups no baseline had ever accepted | 85 |

Those 85 were already in the tree and would each have arrived as a blocked
commit for whoever next edited one of the files holding them; 111 of the 143
unmatched groups are between test files. Recording them is what a baseline IS,
and the same thing `.fallow-dead-code-baseline.json` did for dead code at
`047227c1`: it records the debt, it does not forgive it, and it deserves its
own work sized on its own merits. What it does mean from here on is that
nothing NEW joins them without being named.

### Why the other two baselines keep their own keys

Neither carries an address, so neither can be invalidated this way.
`.fallow-dead-code-baseline.json` keys a finding by symbol name and file;
`.fallow-health-baseline.json` keys a per-file, per-category COUNT. Both still
drift, but they drift in what they RECORD rather than in where they POINT --
which is why #159's answer for the health baseline is the drift report above
and not a re-key, and why a content key would tell you nothing about either.
