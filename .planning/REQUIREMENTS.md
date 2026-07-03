# Requirements — Milestone v4.5: Pit of Success Hardening (Audit #3 Fixes)

**Source:** `boardsmith-audit-report-3.html` (2026-07-02 adversarial multi-agent audit). Every FIX requirement maps 1:1 to a confirmed finding (F1–F38) in that report; the report carries the full trap description, suggested fix, and verifier reasoning for each.

**Process mandate (applies to every FIX requirement):** each finding is independently re-verified (executable repro or file:line code trace) BEFORE any fix is written. A finding that fails re-verification gets a documented rejection (finding ID + evidence) instead of a fix. Legitimate findings are fixed at the source, docs updated, and all example games + MERC brought into compliance.

## v4.5 Requirements

### Process (PROC)

- [x] **PROC-01**: Every finding F1–F38 has a recorded verification verdict (LEGITIMATE with repro/trace evidence, or REJECTED with reasoning) before its fix is planned or written
- [x] **PROC-02**: Every legitimate finding's fix includes a regression test that fails on the pre-fix code

### Critical — Hidden-Information Integrity (SEC)

- [x] **SEC-01**: Zone visibility (`contentsHidden`/`contentsVisibleToOwner`/`contentsCountOnly`) survives every snapshot restore path (undo, rewind, `GameSession.restore`, `GameRunner.fromSnapshot`, stateless ops) — `toJSONForPlayer(opponent)` is identical before/after restore, including visibility changed at runtime (F1, F7)
- [x] **SEC-02**: `static visibleAttributes` is either implemented (non-listed attributes filtered from non-owners in `toJSONForPlayer`) or deleted entirely, with docs corrected either way — no documented no-op security control remains (F2)
- [x] **SEC-03**: `state.players` is routed through the same per-viewer visibility filtering as the board view — custom Player attributes and Player-child elements no longer broadcast unfiltered to all seats and spectators (F8)
- [x] **SEC-04**: `registerDebug()` data is not broadcast to players/spectators by default — debug payloads are gated (dev-only or explicit opt-in) and the docs no longer model dumping hidden state into it (F15)

### High — Engine Correctness (ENG)

- [ ] **ENG-01**: `putInto()` onto the element's own descendant (or itself) throws an actionable error instead of silently detaching the subtree (F3)
- [ ] **ENG-02**: `eachPlayer` with `startingPlayer` wraps around so every player gets a turn; docs/common-patterns.md dealer pattern and TurnOrder presets corrected to match (F4)
- [ ] **ENG-03**: A failed action inside `simultaneousActionStep` surfaces `actionError`, returns failure to the client, and is NOT recorded in `actionHistory` (F5)
- [ ] **ENG-04**: `chooseFrom` multiSelect min/max is enforced server-side in `validateSelection` (count + array-type checks), matching the elements branch (F6)
- [ ] **ENG-05**: `resolveArgs` no longer coerces arbitrary numeric non-selection args into GameElements (F12)
- [ ] **ENG-06**: `forEach` over a mutated collection no longer silently skips items (snapshot the collection or document + guard the live-mutation case loudly) (F13)
- [ ] **ENG-07**: `switchOn` with no matching case and no default fails loudly (throw or dev-warn) instead of silently no-oping (F27)
- [ ] **ENG-08**: An action built without `.execute()` (default no-op) is rejected at build/registration time or requires an explicit opt-in (F28)

### High/Medium — Restore Fidelity (RST)

- [x] **RST-01**: `onEnter`/`onExit` handlers registered in the game constructor still fire after snapshot restore (F10)
- [x] **RST-02**: `teachingDisabled` (LOCK-01 anti-cheat lockout) persists across `GameSession.restore()` (F16)

### Session API (SESS)

- [ ] **SESS-01**: `session.runner.performAction()` is not reachable as an easy wrong path next to `session.performAction()` — runner access is restricted, renamed, or guarded so persistence/broadcast/checkpoints can't be silently skipped (F29)

### UI Interaction (UIX)

- [ ] **UIX-01**: Custom-UI action failures are surfaced — `lastError` is consumed by shipped UI (or an equivalent loud channel) and `start()`/submission APIs return a result the caller can act on (F17)
- [ ] **UIX-02**: `fill()` rejects a scalar for a multiSelect pick with an actionable error (F18)
- [ ] **UIX-03**: Responsive custom boards (percentage widths / container-type) no longer collapse to zero inside the zoom container's `width:max-content` (F19)
- [ ] **UIX-04**: `dragProps()` honors its documented `when` option (or the option is removed from API + docs) (F30)
- [ ] **UIX-05**: `setBeforeAutoExecute()` either supports multiple hooks or fails loudly when silently replacing a previously registered hook (F31)

### CLI & Dev Experience (CLIX)

- [ ] **CLIX-01**: Player-count has ONE source of truth — boardsmith.json `playerCount` vs `gameDefinition` disagreement is impossible or errors loudly; scaffold no longer hardcodes both (F9)
- [ ] **CLIX-02**: `boardsmith validate` rejects unknown boardsmith.json keys (catches misspelled `gameOptions`/`playerOptions`/`colorPalette`) (F22)
- [ ] **CLIX-03**: Bundle-size validation enforces the actual server limit its comment states (F21)
- [ ] **CLIX-04**: `boardsmith dev` host binding matches its documented default (localhost unless `--host` given), or help text corrected to state 0.0.0.0 with rationale (F32)
- [ ] **CLIX-05**: `boardsmith init -t/--template` either works or is removed from the CLI surface and docs (F33)
- [ ] **CLIX-06**: `--players` out-of-range/NaN values error loudly instead of silently clamping; `--ai` validates against the final count (F34)

### Client SDK & Protocol (SDK)

- [ ] **SDK-01**: Callers can await `GameConnection` becoming open (promise/event), and actions sent before open fail loudly rather than resolving `{success:false}` silently (F23)
- [ ] **SDK-02**: `disconnect()` → `connect()` restores auto-reconnect behavior predictably; the `reconnect()`-only asymmetry is removed or made impossible to miss (F24)
- [ ] **SDK-03**: `MeepleClient` methods have ONE consistent error contract (all throw or all return results) — no silent raw-JSON failure half (F25)
- [ ] **SDK-04**: Client SDK imports canonical protocol types from `src/types/` instead of redefining them; existing drift (CreateGameRequest, WS message union) resolved (F26)
- [ ] **SDK-05**: `WebSocketMessage` union includes all message types actually sent (adds `UpdateSlotPlayerOptionsMessage`) (F35)
- [ ] **SDK-06**: The playerId error message points at a field that exists (message or config type fixed) (F38)

### Testing Utilities (TST)

- [ ] **TST-01**: `TestGame.doAction` failures are loud — throws by default (or equivalent), and the flagship doc example no longer models ignoring the result (F36)
- [ ] **TST-02**: `TestGame`'s default seed is deterministic (fixed literal, not `Date.now()`) (F37)

### Documentation Corrections (DOCX)

- [ ] **DOCX-01**: docs/core-concepts.md no longer teaches the removed event-sourcing command model or nonexistent `element.setAttribute()` (F11)
- [ ] **DOCX-02**: `registerActions()` JSDoc models the real API (F14)
- [ ] **DOCX-03**: docs/getting-started.md documents the CLI that actually exists (F20)
- [ ] **DOCX-04**: Every API changed by this milestone has its docs updated in the same phase as the fix (cross-cutting; grep-verified like v4.4 DOC)

### Cross-Repo Migration (GAMES)

- [ ] **GAMES-01**: All 8 example games in `~/BoardSmithGames/` comply with the changed API surface; every suite green
- [ ] **GAMES-02**: MERC re-vendored onto the new version and green; gaps surfaced during migration fixed in BoardSmith `src/`, not worked around

## Future Requirements

None deferred from this milestone at definition time. (Fix-level deferrals may emerge if a finding is REJECTED during PROC-01 verification — rejections are recorded, not deferred.)

## Out of Scope

- The 4 refuted audit claims (restoreGame seed/options, shuffle(random) signature, SnapshotSessionHost seat check, triggerElementSelect no-op) — killed by the skeptic verification pass; see report's "Refuted claims" section
- New features beyond fixing the audited traps — no new game helpers, no host skin, no tutorial work
- Backward-compatibility shims — per the No Backward Compatibility rule, clean breaks with migration notes

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROC-01 | Phase 131 | Complete |
| PROC-02 | Phase 131 | Complete |
| SEC-01 | Phase 131 | Complete |
| SEC-02 | Phase 131 | Complete |
| SEC-03 | Phase 131 | Complete |
| SEC-04 | Phase 131 | Complete |
| RST-01 | Phase 131 | Complete |
| RST-02 | Phase 131 | Complete |
| ENG-01 | Phase 132 | Pending |
| ENG-05 | Phase 132 | Pending |
| ENG-06 | Phase 132 | Pending |
| ENG-08 | Phase 132 | Pending |
| ENG-02 | Phase 133 | Pending |
| ENG-03 | Phase 133 | Pending |
| ENG-04 | Phase 133 | Pending |
| ENG-07 | Phase 133 | Pending |
| SESS-01 | Phase 134 | Pending |
| UIX-01 | Phase 134 | Pending |
| UIX-02 | Phase 134 | Pending |
| UIX-03 | Phase 134 | Pending |
| UIX-04 | Phase 134 | Pending |
| UIX-05 | Phase 134 | Pending |
| CLIX-01 | Phase 135 | Pending |
| CLIX-02 | Phase 135 | Pending |
| CLIX-03 | Phase 135 | Pending |
| CLIX-04 | Phase 135 | Pending |
| CLIX-05 | Phase 135 | Pending |
| CLIX-06 | Phase 135 | Pending |
| SDK-01 | Phase 136 | Pending |
| SDK-02 | Phase 136 | Pending |
| SDK-03 | Phase 136 | Pending |
| SDK-04 | Phase 136 | Pending |
| SDK-05 | Phase 136 | Pending |
| SDK-06 | Phase 136 | Pending |
| TST-01 | Phase 137 | Pending |
| TST-02 | Phase 137 | Pending |
| GAMES-01 | Phase 138 | Pending |
| GAMES-02 | Phase 138 | Pending |
| DOCX-01 | Phase 139 | Pending |
| DOCX-02 | Phase 139 | Pending |
| DOCX-03 | Phase 139 | Pending |
| DOCX-04 | Phase 139 | Pending |

**Coverage:** 42/42 requirements mapped. 100% — no orphans, no duplicates.
</content>
