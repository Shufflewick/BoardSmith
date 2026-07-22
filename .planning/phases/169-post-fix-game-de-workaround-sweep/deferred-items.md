# Deferred items (out of scope for the 169-0x sweeps)

## seven — `refuses a published-discard undo from every seat EXCEPT seat 1 staging last — and does so for engine reasons, not .notUndoable()` (tests/game.test.ts)

**Discovered during:** 169-03 Task 1, baseline `npx vitest run` on `~/BoardSmithGames/seven` BEFORE any
sweep edits (pre-existing failure, not caused by this sweep).

**Symptom:** seats 2 and 3's forged `{type:'undo'}` after a published discard barrier now get
`"No actions to undo"` instead of the test's expected `/not your turn/`.

**Root cause (not investigated further — out of scope):** the test's own title says it is testing
"engine reasons, not `.notUndoable()`" — i.e. general simultaneous-step undo-eligibility semantics
(`computeUndoEligibility` in `session/utils.ts`, the D4/SIM-02 family), NOT the D1/UNDO-01 or
D24/SPACE-03 targets this sweep is gated on. BSR-7/BSR-8 (seven's own SIM-family filings) are marked
"out-of-scope for this crosswalk's fix-present checklist" in 169-CROSSWALK.md Section 1 — this failure
is in the same family.

**Disposition:** left failing, unmodified. Not a regression (same failure on the untouched baseline).
Recommend a future SIM-family-specific plan (analogous scope to BSR-7/BSR-8) investigate whether
`"No actions to undo"` is now the CORRECT message for a simultaneous-step participant that has acted
but is not the tail-of-history seat, in which case the test's own expectation is stale and should be
updated — or whether this is a genuine regression in `computeUndoEligibility`'s message selection.

## doom-machine — 6 pre-existing deck-secrecy / anonymous-entry test failures (baseline, not green)

**Discovered during:** 169-05 Task 1, baseline `npx vitest run` on `~/BoardSmithGames/doom-machine`
immediately after `git checkout -b sweep/v4.8-dework` off `master`, BEFORE any sweep edit. `git status
--porcelain` was empty before branching (no pre-existing dirty tree; confirmed on `master` too — same
commit, `c8472f1`, "chunk-final-acceptance/step-close — VERIFIED at Milestone 3; GAME COMPLETE").

**Result:** `Test Files 3 failed | 35 passed (38)` / `Tests 6 failed | 399 passed (405)` — NOT a green
baseline, contrary to this plan's Task 1 wording ("record the green baseline"). This is doom-machine's
actual pre-sweep state; the sweep did not cause it (zero edits had been made when this run was captured).

**Failing tests:**
- `tests/machine-phase.board.test.ts` > "completes a whole turn from the keyboard, and the phase redraws
  the board"
- `tests/machine-phase.board.test.ts` > "never calls a deck it has not seen yet 'empty'"
- `tests/machine-phase.test.ts` > "sends the undrawn deck cards as anonymous entries — no partId,
  title, image or order"
- `tests/machine-phase.test.ts` > "sends the removed pile as anonymous entries too — the removal is a
  secret (Ruling 32)"
- `tests/machine-phase.test.ts` > "reveals a card only by DRAWING it — the drawn part is fully public in
  the row"
- `tests/roll-condition-symbology.test.ts` > "the machine-deck and removed-parts children are anonymous
  — no identity leaks to the client"

**Symptom pattern:** all six assert on `deck.children` / anonymous-entry counts for the machine deck
and removed-parts pile (hidden-zone `Space`s) — e.g. `expect(deck.children).toHaveLength(DECK_SIZE - 1)`
receiving `undefined`, and `expect(deckChildren).toHaveLength(7)` receiving `0`. This is the same
surface family as the library's own D24/WR-01 hidden-zone flow-relink regression fixed at
`713cc644` ("fix(engine): relink hidden-zone flow vars to their container, not a dead marker") and its
own review-closure at `8b7fa31a`/`90dd3f35` (Phase 163 review) — confirmed via `git merge-base
--is-ancestor 713cc644 HEAD` (returns true; the fix IS an ancestor of the library commit this sweep ran
against). So this is either (a) a residual, differently-shaped hidden-zone regression the WR-01 fix
did not fully close, or (b) a doom-machine test/fixture staleness unrelated to that fix. **Not
investigated further — out of scope for this conservative, gated sweep** (Task 1 is baseline-recording
only; the plan's removal gates (D9 defer, D12/D23 assess) do not touch machine-deck/removed-pile
visibility code, and this failure predates every sweep edit).

**Disposition:** left failing, unmodified, throughout 169-05. Confirmed identical failure count/names
after every sweep task (Task 1 comment-refresh, Task 2 gated assessment, Task 3 ledger reconciliation)
— the sweep introduces NO NEW failures relative to this recorded baseline. Recommend a follow-up plan
investigate the hidden-zone deck/removed-pile visibility path in doom-machine against the current
library `src/engine/element/game.ts` D24 serializer branch, independent of this sweep.
