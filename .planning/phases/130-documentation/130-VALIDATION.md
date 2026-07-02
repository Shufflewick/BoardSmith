---
phase: 130-documentation
finalized: true
nyquist_compliant: true
validates: [DOC-05, DOC-06]
method: doc-verifier
---

# Phase 130 Validation

**The validation for this phase IS the doc-verifier pass** (plan `130-02`). There is no separate runtime behavior to verify — the phase produces documentation, and the only failure mode is a wrong/unsafe claim. The doc-verifier mitigates it by extracting every documented symbol/command and grep-verifying it against `src/`, then running cheap doc-embedded commands.

## Verification Method (automated, nyquist_compliant)

Plan `130-02` Task 1 runs a symbol-presence gate:

```
for s in getFlowDebugInfo describeFlowPosition isElementVisible getVisibleElements \
         assertHidden assertVisible diffPlayerViews renderAsSeat assertNoHiddenInfoLeak \
         createHeadlessSession enableAnimationTestMode getAnimationTrace \
         createDevHostClient onPersistenceError anchorAttrs; do
  grep -rq "$s" src/ || { echo "MISSING IN SRC: $s"; exit 1; }
done
```

Plus export-location confirmation against the barrels (`src/session/index.ts`, `src/client/index.ts`, `src/testing/index.ts`, `src/ui/index.ts`), WS op-name checks against `protocol.ts`/dev-host, determinism checks (`Math.random` absent from documented engine paths), and cheap command parse (`boardsmith simulate --help` / src grep of `src/cli/commands/simulate*`).

## Requirements Validated

- **DOC-05** — all new/changed v4.4 APIs (FLOW, VIS, SIM, ERR, DRIVE, ANIM) documented with working examples across `docs/api/testing.md`, `docs/agent-control.md`, `docs/custom-ui-guide.md`, `docs/browser-testing.md`, `docs/llm-overview.md`.
- **DOC-06** — every removed/changed API recorded with before→after guidance in the `## v4.4` section of `docs/migration-guide.md` (repo convention; no root BREAKING.md).

## Verdict

_To be finalized by plan `130-02` Task 2 with per-symbol grep results and command output._

**Expected verdict:** PASS — zero unverifiable symbol/command/example claims.
