# 180-PROOF — the first real interactive orchestrator run of `/bs-verify-game`

**Run 2026-08-01.** The skill was loaded by a Claude Code session from `~/.claude/skills/` and
followed as written. No `claude -p` proxy, no pasted skill text, no repo-driven substitute.

## Why this run exists

`/bs-verify-game` **was not installed** until this phase. Installed skills dated from Jul 27
11:24; `verify-game.md` was created Jul 28 (`b10f91ff`). Every proof in Phases 173-179 ran
`boardsmith` CLI commands from the repo and dispatched via `claude -p` — a path that never loads
the installed skill. See `180-EVIDENCE/PRE-INSTALL-STATE.txt`.

## Result: the mode works end-to-end, and seven divergences were found

**SC-1 install** — MET. All 12 `verify/` contracts installed; retired `derive-recheck.md` /
`derive-compare.md` correctly ABSENT (so `--force` replaced rather than merged).

**SC-3 interactive run** — MET for the source-free path. Step 0 → Step 1 → `source-free-mode.md`
→ CHECK-03 → CHECK-05 → Step 7 (3 live dispatches) → Step 8 → Step 9 Close.

**SC-4 source-free (VERIFY-09)** — MET. Read back FROM DISK, `chunks/best-seven-selection/CHUNK.md`:
```
Scope: code-conformance-only
Reason: source-missing
```
`verify-close-record` recorded 17 chunks, 0 errors, exit 0. Original `seven` whole-tree clean.

**SC-2 unchecked classes** — MET. Exactly 5, designer-facing, each naming its check.

**Minimum findings** — CHECK-03 232 findings; CHECK-05 16 findings (16 drifted / 1 clean). Both exit 0.

## The headline: 177.1's CR-03 fix fired on live data, for the first time

Recording the CHECK-04 verdict produced:

> `quotedFromB` matches 3 distinct facts in enumerator B's list at equal strength … and this
> claim's own statement ("The deck has 4 colors.") does not disambiguate among them — **refusing
> to guess which fact this claim grounds to.**

Consequence: the composed fact could not be built, so the reconciler's `corroborated-by-composition`
was **downgraded to `uncorroborated` rather than trusted.**

CR-03 was the 177.1 critical where `findMatch` silently took the first equal-strength match,
letting a wrong `claimedResult` validate against a substituted operand. The fix made it fail
closed. It had unit tests; **it had never fired in a real dispatch until now.** Note the direction:
`112` is arithmetically CORRECT, and the check still declined to claim corroboration it could not
ground — `uncorroborated`, never `contradicted`. Exactly the "variance entirely in the safe
direction" CHECK-04's closure note promises.

## Findings (SC-5) — none findable without the installed skill

| # | Finding | Severity |
|---|---|---|
| 1 | `## Invocation` says "No arguments… current directory"; a passed path is silently ignored. Designer must `cd` first. | minor |
| 2 | **Real shipped data breaks the lock contract.** `seven`'s cleanly-closed `SKETCH.md` reads `Session Lock: (none — final-acceptance closed 2026-07-20; …)`. `state-machine.md` says only exact `none` is the released value and "only a non-`none` lock line is ever classified" — so a strict reader treats a closed project as LIVE-LOCKED, with no parseable timestamp and none of the required `<slug> @ <session-id> — locked at <ISO>` grammar. No guidance exists for this shape. | **real** |
| 3 | Shared contracts under `bs-shared/` carry unsubstituted `${CLAUDE_SKILL_DIR}`; substitution reaches only the loaded `SKILL.md`. The orchestrator must resolve manually. | minor |
| 4 | Step 7 names exact model ids (`claude-opus-5`, `claude-haiku-4-5-20251001`, `claude-sonnet-5`) from the command's `models` field. The orchestrator's dispatch takes **tier names**; the mapping is unverifiable from inside the session. Prose written against a capability the orchestrator lacks. | **real** |
| 5 | **2 of 3 live dispatches returned unparseable JSON.** Enumerator B wrapped its object in a ```` ```json ```` fence; the reconciler prefixed prose. Both fail `JSON.parse`. **The skill has NO repair step**, and the ledger's fence-injection guard (CR-04) rejects fence markers. The `.planning/` harnesses in 177/178 CARRIED JSON repair — the skill does not, and no CLI-path proof could ever have shown that. | **significant** |
| 6 | Enumerator B quoted sentence FRAGMENTS as `sourceSentence` ("Each starts with 3"). Same Rule-2 grounding-violation class 177-21 documented for the reconciler, now seen in an enumerator. | real |
| 7 | Instructing the reconciler NOT to use a fence caused it to emit the literal fence marker in prose. A negative instruction about a forbidden token can induce the token. | real |

## What this run did NOT establish — stated plainly

- **The full-source path (Steps 2-6) was NOT interactively exercised.** This was the source-free
  run, which by design has no input for those steps. Staging, classification, the adjudication
  gate, ruling re-check, and repair remain proven only via the CLI/`claude -p` path.
- **Step 8's dispatches were not completed.** The command runs and reports 3 dispatchable slices;
  the extract/translate dispatch pair was not driven to a recorded verdict in this run. CHECK-06's
  dispatch path remains proven only by Phase 178's harness.
- **Step 7 covered 1 of 2 pending slices** (3 live dispatches). Not a re-measurement of CHECK-04.
- Findings 1-7 are documentation/contract defects, not demonstrated data corruption. None was
  fixed in this run.

## The conclusion that matters

Phase 170's foundational finding was that the orchestrator "reliably fails to convey mechanical
work." SC-5 predicted a clean run would be the SURPRISING outcome. **It was not clean.** Seven
divergences surfaced in a single partial run, and the most serious — a skill with no JSON-repair
step meeting a 2-in-3 unparseable-return rate — is invisible from every proof this milestone
previously ran.
