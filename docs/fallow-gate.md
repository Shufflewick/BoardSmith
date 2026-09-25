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

## The complexity rule is cyclomatic 9, and it says so (#277)

```json
"health": {
  "maxCyclomatic": 9,
  "maxCognitive": 15,
  "maxCrap": 1000000000
}
```

A function over cyclomatic 9 or cognitive 15 fails the gate, and the way down is
to split it. That is the whole rule. `maxCrap` is parked at a number nothing can
reach, which is fallow's only way to switch the CRAP check off.

Before #277 there was no `health` block here at all, so the gate ran on fallow's
defaults — `maxCyclomatic: 20`, `maxCognitive: 15`, `maxCrap: 30` — and the
number that actually bit was none of them.

### Why CRAP is off rather than tuned

CRAP is `CC^2 * (1 - coverage/100)^3 + CC`, and it is a good metric when the
coverage term is measured. **In this gate it was never measured.** `fallow audit`
is handed no Istanbul data, so fallow fills the term in from the module graph:

| what the module graph says about a function | coverage it is assigned |
|---|---|
| a test file names this export directly | 85% |
| reachable only *through* such an export | 40% |
| no test root reaches it at all | 0% |

Re-measured on this repository rather than taken from Pub: of the 225 functions
fallow scored above `maxCrap: 30`, the implied coverage was 40% for 212 of them,
85% for 6 and 0% for 7 — those three values and nothing else. So `maxCrap: 30`
was not a coverage rule. It was three cyclomatic rules at once, selected by a
reachability class nobody reads:

- **40%** — 212 of 225 here: every private or internal function, because a test
  reaches one only through its public caller. `CRAP = CC^2 * 0.216 + CC`, so
  CC 9 scores 26.5 and CC 10 scores 31.6: the real ceiling was **9**.
- **0%** — `scripts/ingest-harness/*.mjs`, `.vue` components, anything no test
  root reaches. `CRAP = CC^2 + CC`, so CC 5 scores exactly 30.0: the real
  ceiling was **4**. The smallest of the 104 findings below was
  `scripts/ingest-harness/run.mjs` `turnDiagnosticLine`, at cyclomatic 5.
- **85%** — a function a test imports by name: the ceiling was **29**.

Meanwhile the config said nothing, and fallow's own default said 20.

**104 findings on this tree had `crap` as their only exceeded threshold**, and
225 in total carried fallow's `add-tests` action — *"Add test coverage for X to
lower its CRAP score"*. For the 40% and 0% tiers that instruction cannot be
carried out. The score came from the import graph, so no test moves it; only
editing the graph or the function does. A gate whose advice cannot be followed
is one people learn to route around, and this repo's CLAUDE.md treats the audit
as a gate rather than a courtesy — which only holds while its findings are
legible.

### Why not wire in a real coverage report

That was the preferred answer and it does not work, measured on fallow 2.48.0:

- **`fallow audit` cannot read coverage at all.** It has no `--coverage` flag,
  there is no `health.coverage` key in `fallow config-schema`, and it ignores
  `FALLOW_COVERAGE` — pointed at a genuine Istanbul report it returns
  byte-identical CRAP scores with no `istanbul_matched` in its summary. Only
  `fallow health` reads coverage, and `fallow health` cannot be what the gate
  runs: it has no dead-code and no duplication verdict.
- **A partial report is worse than none.** fallow scores a function it cannot
  match in the report as 0% covered, so a three-file report does not degrade to
  the old estimate — it degrades to something more confidently wrong.

So the choice was between a rule nobody can read and a rule that is written
down. `maxCyclomatic: 9` is the second one.

### Why 9 and not something looser

9 is **exactly the ceiling the CRAP estimate was already enforcing** on the 40%
tier, which is 94% of everything it scored here. Picking it changes nothing about
the standard the bulk of this codebase was already held to; it only makes the
standard readable. Any looser number — 12, 15 — would be a number nothing was
enforcing, and would *relax* the rule for the code the gate was working on. Any
tighter one would be new.

Two things did change, both deliberately:

- **Loosened:** code no test root reaches statically — the ingest harness
  scripts, `.vue` components — was being held to cyclomatic 4. Nobody chose that
  and it is not the standard now.
- **Tightened:** a function a test imports by name used to be allowed up to
  cyclomatic 29.

**324 functions in this tree exceed cyclomatic 9, and 9 more exceed cognitive 15
without exceeding cyclomatic: 333 findings, against 287 before.** All 333 are
recorded in `.fallow-health-baseline.json`, which was regenerated as part of
#277 — that is what the health baseline is for, and it is the only baseline this
change touched. `.fallow-dupes-baseline.json` is derived and was not regenerated;
`.fallow-dead-code-baseline.json` is unaffected by a `health` block.

Of those 333, 284 were already findings under the old rule. **These 49 are the
ones the tightening newly exposes** — functions that were passing on the 85%
tier's allowance of 29, or that the old CRAP rule never scored. They are
baselined, so they are not blocking anything today; they will be findings the
next time their file is edited, and the answer will be to split them:

| function | cyclomatic | cognitive |
|---|---|---|
| `src/cli/commands/verify-impact.ts` `parseRulesStaleness` | 18 | 14 |
| `src/engine/command/inverse.ts` `createInverseCommand` | 18 | 1 |
| `src/world/definition.ts` `createWorld` | 18 | 11 |
| `src/cli/commands/audit.ts` `auditCommand` | 16 | 10 |
| `src/engine/flow/walk-flow-nodes.ts` `walkFlowNodes` | 16 | 9 |
| `src/engine/utils/serializer.ts` `deserializeValue` | 16 | 13 |
| `src/ui/components/auto-ui/auto-ui-helpers.ts` `resolvePieceVisual` | 16 | 15 |
| `src/cli/commands/verify-ruling-recheck.ts` `verifyRulingRecordCommand` | 15 | 14 |
| `src/cli/commands/contract.ts` `contractCommand` | 14 | 14 |
| `src/cli/commands/validate.ts` `checkMetadataIssues` | 14 | 15 |
| `src/ui/components/auto-ui/presentation.ts` `resolvePresentation` | 14 | 13 |
| `src/ui/theme.ts` `applyTheme` | 14 | 14 |
| `src/cli/commands/build.ts` `buildCommand` | 13 | 14 |
| `src/cli/commands/game-runtime.ts` `boardsmithSourceEntries` | 13 | 14 |
| `src/cli/commands/lint.ts` `lintCommand` | 13 | 15 |
| `src/cli/commands/verify-derive-check.ts` `createDeriveCheckRecord` | 13 | 12 |
| `src/engine/flow/builders.ts` `stateAwareLoop` | 13 | 12 |
| `src/engine/utils/arg-builder.ts` `buildActionArgs` | 13 | 13 |
| `src/engine/utils/dev-state.ts` `restoreDevState` | 13 | 15 |
| `src/world/definition.ts` `readWorldDefinition` | 13 | 12 |
| `src/cli/commands/init.ts` `initCommand` | 12 | 13 |
| `src/cli/commands/verify-derive-check.ts` `verifyDeriveRecordCommand` | 12 | 10 |
| `src/engine/utils/serializer.ts` `serializeValue` | 12 | 12 |
| `src/session/utils.ts` `computeUndoEligibility` | 12 | 11 |
| `src/testing/debug.ts` `toDebugString` | 12 | 14 |
| `src/world/action.ts` `assertWorldAction` | 12 | 13 |
| `src/world/budgets.ts` `worldBudgets` | 12 | 11 |
| `src/cli/commands/build.ts` `deriveManifest` | 11 | 10 |
| `src/cli/commands/chunk-provenance.ts` `computeVerificationScope` | 11 | 11 |
| `src/cli/commands/validate.ts` `checkTaxonomyShape` | 11 | 11 |
| `src/cli/commands/verify-classify.ts` `resolveProvenance` | 11 | 13 |
| `src/cli/commands/verify-close-record.ts` `verifyCloseRecordCommand` | 11 | 14 |
| `src/engine/tutorial/progress.ts` `autoAdvanceTutorial` | 11 | 10 |
| `src/ui/composables/useFLIP.ts` `useFLIP` | 11 | 12 |
| `src/ui/composables/useGameViewHelpers.ts` `findElement` | 11 | 13 |
| `src/ui/utils/image.ts` `parseImageInfo` | 11 | 11 |
| `src/cli/commands/chunk-provenance.ts` `renderVerifiedAgainst` | 10 | 12 |
| `src/cli/commands/install-claude-command.ts` `installClaudeCommand` | 10 | 12 |
| `src/cli/commands/pack.ts` `packCommand` | 10 | 12 |
| `src/cli/commands/validate.ts` `validateBundleSize` | 10 | 14 |
| `src/cli/commands/validate.ts` `validateAssetPaths` | 10 | 10 |
| `src/cli/commands/verify-enumerate.ts` `composeArithmeticClaim` | 10 | 12 |
| `src/cli/commands/verify-ruling-recheck.ts` `verifyRulingRecheckCommand` | 10 | 10 |
| `src/cli/commands/verify-run.ts` `verifyRunInitCommand` | 10 | 10 |
| `src/cli/dev-host/config-types.ts` `coerceGameOptionValue` | 10 | 12 |
| `src/engine/flow/seat-activity.ts` `availableActionsForSeat` | 10 | 8 |
| `src/engine/utils/dev-state.ts` `restoreFromDevCheckpoint` | 10 | 13 |
| `src/testing/assertions.ts` `assertGameFinished` | 10 | 9 |
| `src/world/migration.ts` `declaredSources` | 10 | 12 |

Roughly half sit in `src/cli/commands/`, which is touched often. That is the
real cost of the number and it is the intended one: those are the functions the
gate should have something to say about.

### Proven on a real finding

`src/runtime/runner.ts` `fromSnapshot`, cyclomatic 16, cognitive 10 — one of the
104:

| | old rule | new rule |
|---|---|---|
| severity | `high` | `moderate` |
| exceeded | `crap` (71.3) | `cyclomatic` (16 > 9) |
| action | `add-tests` — "Add test coverage for `fromSnapshot` to lower its CRAP score" | `refactor-function` — "extract helper functions, simplify branching" |

Same function, same gate, and the reason given is now the one that is true.
Going the other way, `scripts/ingest-harness/run.mjs` `turnDiagnosticLine`
(cyclomatic 5, cognitive 4, CRAP exactly 30.0) stops being a finding at all,
because cyclomatic 4 was never a standard anyone chose.

Across the whole tree after the change: **0 findings carry an `add-tests` action
and 0 carry a `crap` field.** Audit wall-clock over a five-commit scope is
unchanged at ~5.3s end to end, of which fallow's health pass is 0.36s before and
after.

`scripts/fallow-gate-honesty.test.mjs` holds it there. It generates a function at
`maxCyclomatic` and one at `maxCyclomatic + 1` **from the config**, runs the real
fallow binary over them in a throwaway project with no test root — the 0% tier,
the worst case — and requires that the first is silent, that the second is
reported as `cyclomatic`, and that no finding carries an `add-tests` action or a
`crap` field. With no `health` block, or with one that leaves `maxCrap` at 30,
it fails.

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
GameElement|src/engine/element/game-element.ts|src/ui/components/auto-ui/AutoRenderer.vue|src/ui/components/auto-ui/renderers/board-renderer-a11y.test-helper.ts
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

### The key DID move once, and fallow was not why (#241)

This section used to carry a caveat: fallow decides where a clone group starts
and ends, so a large enough edit elsewhere in the same file might cut the same
debt a line or two differently and change its key. Two sightings were put down
to that. Neither was that, and the caveat was wrong.

`fallow dupes --format json` prints several megabytes, and `boardsmith audit`
read it through `runToolCapturingStdout`, which decoded **each arriving chunk of
the stream on its own**. A chunk boundary can fall inside a multi-byte UTF-8
character, and decoding the two halves separately replaces them with U+FFFD. So
the fragment being hashed was not the source text. Where a boundary lands
depends on the byte offsets of everything printed before it, which is exactly
why the symptom looked like fallow re-cutting groups:

- inserting ~25 lines in the MIDDLE of one test file renumbers every group
  reported after it, shifting all later byte offsets, and moved the keys of two
  accepted groups in four unrelated, byte-identical files;
- appending the same lines at the END of that file renumbers nothing and moved
  no keys at all.

Measured on the tree that reported it, 1085 groups either way: with the
per-chunk decode, the insertion produced six U+FFFD characters and key set
`e113ef05ac8add6c`, and reverting it produced zero and `f3e15d025a1935ad`. With
the stream decoded once at the end, both trees produce zero U+FFFD and
`f3e15d025a1935ad`. The group addresses were byte-identical across the
insertion on both sides, so no boundary had ever moved.

The fix is in `src/cli/lib/run-tool.ts`, the single point every `boardsmith`
command spawns a tool from: stdout is buffered whole and decoded once. The
content key was always a pure function of the clone group's own text; what it
now also gets is that text.

Normalising the fragments before hashing would have hidden this rather than
fixed it, and would have cost the gate the property it exists for -- an edit to
duplicated code must change its key. Keying on the file pair instead would have
put back the address dependence the content key removed. Treating a re-key as
routine would have left the record unable to tell new duplication from a
mangled character, which is the whole point of it.

### The line-keyed file is now derived

`fallow audit` reads `.fallow-dupes-baseline.json` and the key format is
fallow's, not ours, so the file stays -- as a generated address book. Both
committed files come from one scan:

```bash
boardsmith audit --dupes-baseline   # the check, which re-addresses as it goes
boardsmith audit --rekey-dupes      # drop allowances that are gone, or record a tree from scratch
```

The check asks two questions in order, because they have different answers:

- **Does the accepted CONTENT match?** If not, that is a finding about the
  code: duplication nothing accepted, or accepted debt that is gone. It FAILS,
  named with its files, and nothing is written -- so a failing run cannot have
  laundered anything into the record.
- **Do the addresses match?** If not, nothing about the debt changed, so the
  check RE-ADDRESSES them itself and says it did. See "An address move is not a
  decision" below.

`--rekey-dupes` REFUSES to write anything when the tree holds duplication the
record does not accept. That is what stops it being a button that turns a red
board green: new duplication has no entry to re-address, and there is no
spelling of the command that accepts it. An accepted entry whose duplication is
gone is different: dropping it only narrows the record, so `--rekey-dupes` does
that, and the failure text for it names the command (#353). Before #353 the
command refused that case too, the text named no command, and one stale entry
for `action-builder.ts` failed every branch's audit until someone edited the
record by hand. Recording a tree wholesale is a separate, deliberate act -- it
requires the record to be absent, and it shows up as a large diff to a
committed file, which is the point.

The failure text for duplication nothing accepted deliberately does NOT name a
command. It used to read "delete `.fallow-dupes-accepted.json` and run
`--rekey-dupes`", which is the one action that widens the record wholesale: the
visible remedy was the dangerous one, and it is what a person under time
pressure reaches for. The text now names the duplication and points here.

### An address move is not a decision, so the audit makes it (#256)

The address drift above used to be reported as a FAILURE naming
`boardsmith audit --rekey-dupes`. That was wrong in a way worth stating,
because the measurement is unambiguous. Landing #246, #248, #249, #251, #252
and #253 in one session produced three separate instances -- 16 groups, then 2,
then 1079 -- and every single re-address reported *"every one matched by
content, so no debt was forgiven."*

So the human in the loop had nothing to decide. The step was mechanical, it
carried no judgement, and its only real property was that someone had to
remember it. When they did not, the derived file stayed pointed at the wrong
lines, `main` said nothing (a run with nothing in scope gives no verdict), and
the bill arrived as a blocked commit for whoever next edited one of the moved
files -- a person whose own change was clean. The right thing was the thing you
had to remember and the wrong thing was silent, which is the Pit of Success
inverted.

`boardsmith audit` now re-addresses those groups itself and reports that it
did, in the past tense, telling you to commit the two files. It exits 0.

This is a strictly narrower power than `--rekey-dupes`, and the narrowness is
structural rather than a matter of care: the re-address runs only after the
content comparison found **no difference at all**, so the set of content keys it
writes is exactly the set it read. There is no tree in which it accepts a group
the record did not already accept. What still fails, unchanged and with the same
clarity:

- a clone group whose CONTENT no longer matches an accepted entry (edited
  duplication is new debt wearing an old key);
- any NEW unaccepted duplication;
- an accepted allowance whose duplication is gone.

None of those is an address move, and none of them writes anything.

#### Where it runs, and why there

Inside `boardsmith audit`, as the FIRST check of the run -- ahead of the
changed-files audit. `--changes` is the check that shells out to `fallow audit`,
which is the thing that reads `.fallow-dupes-baseline.json`. Re-addressing
after it would grade the branch against an address book the same run was about
to correct: #232's false block, reproduced inside the tool that exists to remove
it.

That placement is also the answer to "so a merge cannot land drifted". This repo
has no CI and no merge hook of its own, and the ShufflewickPub commit hook runs
a raw `fallow audit` with no `boardsmith` in the loop, so it cannot be the place
either. The audit every task runs before it merges is the one point in reach,
and putting the re-address there means the addresses a merge publishes are the
addresses of the tree that was merged. A merge can still shift lines that
neither parent's audit saw -- but that residue is no longer a trap. It is a
thing the next audit fixes silently and reports, instead of a block against a
stranger.

Selector runs stay honest: `boardsmith audit --changes` on its own does not
scan duplication and so does not re-address anything. A flag asks for one check
and gets one check. The un-flagged run -- the one this repo tells you to run
after a refactor and before a merge -- is the one that heals.

#### Why the derived file is still COMMITTED

Generating it on demand would delete this failure mode outright, and it was
weighed. It is the wrong trade, for one measurable reason: **`.fallowrc.json`
names the file, and the thing that actually runs automatically is a raw
`fallow audit`** -- ShufflewickPub's `.claude/hooks/fallow-gate.sh` intercepts
`git commit`, resolves this repository from the command, and runs fallow
directly. If the baseline were gitignored, a fresh clone's first commit would be
audited with no duplication baseline at all, and all ~1100 accepted clone groups
would report against whatever file that commit happened to touch.

That trades a stale address book for no address book. It replaces drift, which
is now self-healing and costs nobody a block, with a guaranteed false block on
every path that does not go through `boardsmith audit` -- a deeper pit, reached
by a shorter fall. Generating on demand would also make the cheap `--changes`
path pay for the expensive full-repository dupes scan every time.

So the file stays committed, and the audit keeps it true.

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

## The gate cannot see a duplicate whose halves never change together (#265)

`fallow audit` reports a duplicate export only when more than one of the files
declaring the name is in the diff being audited. So a duplicate whose two
halves live in files that never change together is invisible for as long as
that holds, and nothing ever asks the whole repository the question.

The `ElementRef` triplicate of #263 had been in the tree for as long as its
three declarations existed. It surfaced because #258 touched
`src/types/protocol.ts` and #260 touched
`src/ui/composables/useBoardInteraction.ts` inside one merge window, which put
both in a single audit scope by coincidence. Three public barrels were handing
out three different types under one name the whole time.

Duplicate exports are the only finding with this property, and the reason is
structural: every other dead-code category is a property of a single file -- an
unused export is unused in the file that declares it, so the changed-files
audit sees it the moment that file is touched. A duplicate export's identity is
a SET of files, which is also why its baseline key is the name followed by
every exporting file, and why a scoped run that sees only some of them produces
the subset key described above.

### The sweep

```bash
boardsmith audit --sweep              # report
boardsmith audit --sweep --file-issue # report, and open a ticket for anything new
```

It asks fallow for the whole repository's duplicate exports with
`.fallow-dead-code-baseline.json` applied, so what it reports is exactly what
nothing has accepted. For each finding it prints the export, every file and
line that declares it, and the baseline key that would accept it.

**It never gates.** It exits 0 whatever it finds, and it is not one of the
checks a bare `boardsmith audit` runs. Making the whole-repository view
blocking would drop the repo's accepted backlog onto whoever merges next, which
is the exact failure mode the baselines exist to prevent. A latent duplicate
deserves a ticket, not a red board. The one thing that does exit non-zero is a
scan that produced nothing readable, because a broken tool must not be reported
as a clean sweep.

### Why not `--backlog`, and why not a wider `--since`

`boardsmith audit --backlog` already reports the whole repository, but with the
baselines set ASIDE. It answers "how much accepted debt is there" -- the
hundreds of findings recorded above -- rather than "what is here that nothing
has accepted". A latent duplicate is one line in that flood.

`boardsmith audit --since <first commit>` does put the whole tree in scope with
the baselines applied, and it passes today. But it is a gate: it exits non-zero
on findings, and it drags the jscpd duplication sweep and the health-baseline
drift check along with it, both of which report this repo's accepted backlog
over a whole-repository scope. On a schedule it would be red forever, which is
what teaches people to stop reading a gate.

So no new analysis and no new scope rule was added. What was missing was a run
that asks the one question that can go latent and FILES rather than blocks.

### Filing, and why it cannot spam

`--file-issue` opens one GitHub issue per finding through `gh`. Each body
carries a fingerprint -- a hash of the baseline key, spelled as one lowercase
alphanumeric token because GitHub's issue search splits on punctuation -- and
the sweep searches open AND closed issues for that token before filing.

Searching closed issues too is deliberate. A closed issue is a human's ruling
on this exact finding, and re-filing it every run is the auto-filer that spams,
which is worse than no auto-filer. The sweep still REPORTS the finding and says
which issue already covers it; the way to stop it recurring is to fix the
duplication or to record it in `.fallow-dead-code-baseline.json`.

The fingerprint follows the debt rather than its address: code moving above a
declaration does not change it, and a third file starting to export the name
does -- so a widened duplicate is a new finding and gets its own ticket.

### The cadence

**This repository has no CI.** There is no `.github/` directory and no
workflow, so there is nowhere a scheduled job could live, and inventing one
would be a mechanism nobody runs. The sweep is an on-demand command first: run
it after a merge window, or whenever you have been reading barrels.

To run it weekly on a machine that has this checkout, the GitHub CLI and node,
add one `launchd` job (macOS) or one crontab line (Linux):

```
# crontab -e -- Mondays at 09:00
0 9 * * 1 cd ~/BoardSmith && /usr/bin/env node bin/boardsmith.js audit --sweep --file-issue
```

`cron` runs with a bare `PATH`, so give `node` and `gh` absolute paths if they
are not on it. If a scheduled run cannot reach `gh`, the sweep says so and
names the command to run by hand; it does not silently report a clean sweep.
