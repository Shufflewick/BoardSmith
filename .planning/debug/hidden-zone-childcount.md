---
status: diagnosed
trigger: "Root-cause hidden-zone child-count/anonymous-entry test failures across doom-machine, BoardSmithGames2/seven, and BoardSmithGames/seven after D24/SPACE-03 + WR-01 (713cc644)"
created: 2026-07-22T00:00:00Z
updated: 2026-07-22T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — D24/SPACE-03 (commit 8e74abda) intentionally redefined `Space.contentsHidden()`
('hidden' zone-visibility mode) from "anonymized count-preserving placeholders" (its behavior for the
entire life of the library, since 7d495fa6) to "true zero-leak concealment" (no `children`, no
`childCount` key at all). This was a deliberate, planned, documented API contract change (163-CONTEXT.md
D24/SPACE-03, explicitly anticipating "Phase 169 removes game workarounds"), not a library regression.
Two of the three games (doom-machine, BoardSmithGames2/seven) called `.contentsHidden()` expecting the
OLD count-preserving contract (their own doc comments say so) and are now broken by the correct new
contract. The third game (BoardSmithGames/seven) explicitly REQUESTED this exact change (BSR-1 in its
own BOARDSMITH-REQUESTS.md) and is NOT broken by it — its one failure (`tests/game.test.ts` undo test)
is an unrelated pre-existing SIM-family issue.
test: reproduced one failing test per repo; read library source (before/after D24 diff), library test
diffs from the same commit, and each game's own source-code doc comments describing intended semantics.
expecting: N/A — investigation complete.
next_action: N/A — return diagnosis, no fix applied per instructions.

## Symptoms

expected: (per objective) determine whether hidden-zone child-count leak fix belongs in library or games.
actual: doom-machine and BoardSmithGames2/seven fail because their hidden decks/piles now serialize with
no `children`/`childCount` at all instead of the anonymized-placeholder-with-count shape they expect.
errors: "expected [] to have a length of 7 but got +0"; "Cannot read properties of undefined (reading
'length')"; "expected 0 to be greater than 0" (rendered `.mess__card` DOM nodes).
reproduction:
  - doom-machine: `cd ~/BoardSmithGames/doom-machine && npx vitest run tests/machine-phase.test.ts`
  - BoardSmithGames2/seven: `cd ~/BoardSmithGames2/seven && npx vitest run tests/leak-audit.test.ts`
  - BoardSmithGames/seven (control, NOT broken by this): `cd ~/BoardSmithGames/seven && npx vitest run`
    → only failure is the unrelated undo/SIM-family test.
started: after library commit 8e74abda (163-02, D24/SPACE-03) landed and games picked it up live via
symlinked node_modules/boardsmith.

## Eliminated

- hypothesis: "Library over-concealment regression — D24's 'hidden' serializer branch should emit
  anonymous entries preserving count, and the fix belongs in game.ts."
  evidence: (1) 163-CONTEXT.md D24/SPACE-03 decision text explicitly specifies "'hidden' emits NEITHER
  childCount nor per-child placeholders (true concealment); 'count-only' keeps the count (that is its
  defined purpose)" — a deliberate two-mode split, not a bug. (2) Library's own tests
  (visible-attributes.test.ts, image-leak.test.ts, mcts-redaction.test.ts) were updated in the SAME
  commit to assert the new true-concealment shape, i.e. this is the library's intended, verified
  contract. (3) BoardSmithGames/seven's BOARDSMITH-REQUESTS.md BSR-1 shows a GAME TEAM explicitly
  requested this exact change ("A hidden Space still leaks its exact child count") and confirms it
  RESOLVED their Ruling-8 requirement (mess size must never be exposed) with zero game-side workaround
  needed. A regression cannot simultaneously be a correctly-fulfilled, requested feature for one
  consumer and a bug for the others — the API's NEW meaning is correct; the two broken consumers are
  calling the wrong API for what they want.
  timestamp: 2026-07-22

## Evidence

- timestamp: 2026-07-22
  checked: `git show 8e74abda` (D24/SPACE-03) full diff of src/engine/element/game.ts and its own test
  changes.
  found: Before this commit, `toJSONForPlayer`'s zone-visibility branch treated `'hidden'` and
  `'count-only'` identically — both built anonymized placeholder children (negative synthetic ids,
  `__hidden: true`, redacted attrs) AND set `childCount: element._t.children.length`. This commit splits
  them: `'hidden'` now destructures `children` out and returns nothing but the container's own
  (whitelist-redacted) attributes — no `children` key, no `childCount` key. `'count-only'` is unchanged
  (byte-for-byte) and still produces the anonymized-placeholder-with-count shape.
  implication: `contentsHidden()` (which sets zone mode `'hidden'`) silently changed its serialized
  output shape for every existing caller. `contentsCountOnly()` (mode `'count-only'`) is unaffected and
  is the API that now provides the old `contentsHidden()` behavior.

- timestamp: 2026-07-22
  checked: `git show 8e74abda~1:src/engine/element/game.ts` (pre-D24 serializer) vs current
  `src/engine/element/space.ts:265-274` (`contentsHidden()`/`contentsCountOnly()` definitions, unchanged
  by D24 — only the serializer branching changed).
  found: `contentsHidden()` → `setZoneVisibility('hidden')`; `contentsCountOnly()` →
  `setZoneVisibility('count-only')`. Both methods and their names are untouched by D24 — only what the
  serializer DOES with `'hidden'` mode changed underneath the existing method name.
  implication: This is a breaking API-contract change disguised as a same-named-method behavior change,
  not a new API addition. Any consumer who called `.contentsHidden()` for its OLD (count-preserving)
  behavior is now silently broken with no compile-time signal — TypeScript can't catch a semantic
  change to a `void`-returning method.

- timestamp: 2026-07-22
  checked: 163-CONTEXT.md (D24/SPACE-03 decision, "Specific Ideas", "Deferred" sections);
  169-engine-space-lifecycle.../163-REVIEW.md; 169-post-fix-game-de-workaround-sweep/deferred-items.md.
  found: 163-CONTEXT.md line 47-48: "The `concealFromEverySeat` 'smell' is games hiding each child
  individually to fake concealment ... the `'hidden'` mode now makes that workaround unnecessary." Line
  114: "D22/D24/D25 Seven; D23 Doom; D26 Lanternfall. All engine-layer; Phase 169 removes game
  workarounds." Line 124 (Deferred): "Removing per-game concealFromEverySeat-style workarounds — Phase
  169." 169-post-fix deferred-items.md independently confirms (Task 1 baseline runs, BEFORE any sweep
  edit) that doom-machine and BoardSmithGames2/seven both have this exact 4-6-test childCount/anonymous-
  entry failure family, unrelated to the 169 sweep's own scope, and recommends "a follow-up plan
  investigate the hidden-zone deck/removed-pile visibility path ... against the current library D24
  serializer branch."
  implication: D24 was planned with FULL knowledge it would obsolete/break existing per-game hidden-zone
  workarounds; Phase 169 was pre-scheduled to clean those up but its actual sweep (169-03/05/06) only
  touched the unrelated undo-workaround and BSR-1 (Seven's own `concealFromEverySeat`); it explicitly
  deferred the doom-machine and BSG2/seven childCount failures as "out of scope," leaving them
  unresolved — exactly the gap this investigation was asked to close.

- timestamp: 2026-07-22
  checked: doom-machine `src/rules/elements.ts:38-56` (MachineDeck doc comment) and
  `src/rules/game.ts:656,660` (`machineDeck.contentsHidden()`, `removedParts.contentsHidden()`); reran
  `npx vitest run tests/machine-phase.test.ts`.
  found: Doc comment: "the engine serializes them to the client as anonymous `__hidden` entries with
  every identity-bearing attribute stripped, so the client can see the deck's THICKNESS ... but never a
  card's face." Test itself (`tests/machine-phase.test.ts:715-717`) comments "The deck's THICKNESS is
  public — a physical deck's height is th[e...]" then asserts `cards` (from `deck.children`) has length
  7 (`DECK_SIZE`). Actual: `deck.children` is `undefined`/`[]` (0 entries) post-D24.
  implication: doom-machine's explicit, documented design intent (count/thickness visible, identity
  hidden) is the `count-only` contract. It is calling the wrong method for its own stated intent —
  `contentsHidden()` no longer means what its own doc comment says.

- timestamp: 2026-07-22
  checked: BoardSmithGames2/seven `src/rules/game.ts:226` (`this.mess.contentsHidden()`); reran
  `npx vitest run tests/leak-audit.test.ts`.
  found: Tests assert `wrapper.findAll('.mess__card')` renders N face-down card DOM nodes matching
  `game.mess.count(SevenCard)` (byte-identical, no bonus tell) — i.e. count must be visible for
  rendering, identity must not. Actual: 0 DOM nodes rendered (serializer emits no children to render).
  implication: Same as doom-machine — this repo's `mess` wants the `count-only` contract but calls
  `contentsHidden()`.

- timestamp: 2026-07-22
  checked: BoardSmithGames/seven `src/rules/elements.ts:550-569` (`Mess.concealFromEverySeat()` doc
  comment, explicitly citing "BOARDSMITH-REQUESTS.md BSR-1 = D24/SPACE-03 shipped"); that repo's own
  `BOARDSMITH-REQUESTS.md` BSR-1 entry ("RESOLVED (169-03 sweep, 2026-07-21) — fixed upstream as
  D24/SPACE-03 ... The redaction test in tests/game.test.ts ... still passes unmodified."); reran
  `npx vitest run` (full suite).
  found: Doc comment states RULINGS.md Ruling 8 requires the mess's exact remaining-card count to NEVER
  be exposed to any seat — the game's own team filed BSR-1 asking for exactly the true-concealment
  behavior D24 now provides, and confirms it's resolved with no workaround needed. Full suite run: only
  1 failure, `tests/game.test.ts` "refuses a published-discard undo..." — an unrelated SIM-family
  message-text assertion (`"No actions to undo"` vs `/not your turn/`), not a childCount/hidden-zone
  issue at all.
  implication: This third repo is NOT part of the broken family. D24's new 'hidden' contract is exactly
  what it wants and requested. It should not be touched by any fix.

## Resolution

root_cause: |
  D24/SPACE-03 (BoardSmith commit 8e74abda, "163-02") is a DELIBERATE, planned, and (for one downstream
  game) explicitly REQUESTED API contract change: `Space.contentsHidden()` (zone-visibility mode
  `'hidden'`) went from emitting anonymized, count-preserving placeholder children (its behavior since
  the library's earliest history) to emitting NEITHER `children` NOR `childCount` at all (true
  zero-count concealment). `Space.contentsCountOnly()` (mode `'count-only'`) is byte-for-byte unchanged
  and still provides the old anonymized-placeholder-with-count behavior. This is NOT a library
  over-concealment bug — it is a same-named-method breaking behavior change that two of the three
  downstream games' call sites did not migrate for, because they actually want the count-preserving
  contract (their own doc comments/tests say so: "the client can see the deck's THICKNESS," "byte-
  identical face-down cards" rendered from a real count). WR-01 (713cc644) is unrelated to these
  failures — it only fixed flow-variable relinking for hidden containers and does not affect
  `toJSONForPlayer`'s children/childCount emission.
fix: |
  NOT APPLIED (diagnosis-only per instructions). Recommended fix location: THE GAMES, not the library.
  - doom-machine: `src/rules/game.ts:656` (`this.machineDeck.contentsHidden()`) and `:660`
    (`this.removedParts.contentsHidden()`) → change both to `.contentsCountOnly()`. Update the doc
    comments in `src/rules/elements.ts:38-56` (MachineDeck) and `:58-68` (RemovedParts) to say
    `contentsCountOnly()` instead of `contentsHidden()`.
  - BoardSmithGames2/seven: `src/rules/game.ts:226` (`this.mess.contentsHidden()`) → change to
    `.contentsCountOnly()`.
  - BoardSmithGames/seven: NO CHANGE — its `Mess.concealFromEverySeat()` (`src/rules/elements.ts:567-
    569`, calling `contentsHidden()`) is already correct and intentionally requested this exact
    behavior (BSR-1). Its one failing test is the unrelated undo/SIM-family issue, out of scope here.
  The library itself needs no change — D24's contract is correct and intentional, confirmed by its own
  updated tests and by BSR-1's explicit request/resolution from a downstream consumer.
verification: N/A — no fix applied; recommendation only.
files_changed: []
