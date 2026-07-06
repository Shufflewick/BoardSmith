# Requirements — v4.7 Playtest Follow-Up Fixes

Closes the three tracked follow-ups from v4.6's human playtest (see `milestones/v4.6-MILESTONE-AUDIT.md` Reopened Scope + `milestones/v4.6-phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md`). These harden the `bs-` pipeline's OUTPUT and the dev-host, and propagate the already-landed DEF-B session fix to MERC.

## v4.7 Requirements

### ASSET — Generated-game asset completeness (DEF-A class)

- [x] **ASSET-01**: The `bs-build-chunk` skill guarantees a generated game never renders broken images — it either emits the asset files it references (card/piece art) OR the generated UI degrades cleanly to a self-drawn fallback when an `$images` path resolves to nothing. Verified by a freshly regenerated game whose board renders every card with zero broken `<img>`s (no reliance on a hand-added asset set).
- [x] **ASSET-02**: The skill's automated verification (build/test step) includes an asset-reachability / broken-`<img>` check so an asset-referencing game that ships no assets FAILS the pipeline's own bar rather than passing green (the gap that let DEF-A ship).

### DEVHOST — Dev-host multi-client turn consistency (DEF-C)

- [ ] **DEVHOST-01**: The dev-host multiplayer path (`MultiplayerHost` + `SnapshotSessionHost`) is reliably reproduced failing on the reconnect/seat-takeover turn-desync (a repeatable multi-client scenario where a client's view goes stale — shows "your turn" when the server has moved on), establishing the root cause before any fix.
- [ ] **DEVHOST-02**: The desync is fixed at the source so every connected client's turn view (`isMyTurn`/`currentPlayer`) stays consistent with the server across reload, reconnect, and AI-seat takeover — a client is never told it is its turn when it is not. Covered by a multi-client regression test that fails before the fix and passes after.

### VENDOR — MERC re-vendor of the DEF-B fix

- [ ] **VENDOR-01**: MERC's vendored BoardSmith copy (`~/Dropbox/MERC/BoardSmith/MERC`) is re-vendored to include the DEF-B dev-host lost-update fix (`281e8155`) and any v4.7 dev-host/asset fixes; MERC's full test suite passes against the re-vendored copy (integration proof the fix reaches the vendored consumer).

## Future Requirements (deferred)

- Full multi-chunk dry-run of the `bs-` pipeline (books/scoring/final-acceptance) — beyond the chunk-1 scope validated in v4.6.
- Live installed-skills run (via the Phase-148 installer into a separate designer project) to close the Pitfall-2 harness-mapping question.

## Out of Scope

- New game features or new `bs-` skills — v4.7 is fixes/hardening only.
- Broader dev-host multiplayer redesign — v4.7 fixes the specific reconnect/takeover desync (DEF-C) and propagates DEF-B, not a rearchitecture.
- The AI insta-acknowledge race (dev-host-ai-op-race #2) — a separate latent issue, not surfaced by the v4.6 playtest; deferred.

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| ASSET-01 | Phase 152 | Complete |
| ASSET-02 | Phase 152 | Complete |
| DEVHOST-01 | Phase 153 | Pending |
| DEVHOST-02 | Phase 153 | Pending |
| VENDOR-01 | Phase 154 | Pending |

**Coverage:** 5/5 requirements mapped, no orphans, no duplicates.
