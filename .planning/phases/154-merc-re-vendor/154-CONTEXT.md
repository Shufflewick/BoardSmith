# Phase 154: MERC Re-Vendor - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per infra-detection: goal is a vendor sync, all success criteria are technical, no user-facing behavior)

<domain>
## Phase Boundary

MERC's vendored BoardSmith copy (`~/Dropbox/MERC/BoardSmith/MERC/vendor/boardsmith-*.tgz`) is refreshed
to current BoardSmith HEAD so it carries the DEF-B dev-host lost-update fix (`281e8155`) plus the v4.7
Phase 152 (asset completeness) and Phase 153 (dev-host turn-desync) fixes, proven by MERC's own test
suite staying green at or above its last known-green baseline. This is a propagation/integration
phase — no BoardSmith library changes; the deliverable is the re-vendored MERC + a passing MERC suite.
</domain>

<decisions>
## Implementation Decisions

### Re-Vendor Method (follows MERC's established pattern)
- Use BoardSmith's own pack-and-integrate command from the BoardSmith repo root:
  `node bin/boardsmith.js pack --target ~/Dropbox/MERC/BoardSmith/MERC`
  (`src/cli/commands/pack.ts` — packs a timestamped `boardsmith-0.0.1-<ts>.tgz` via `npm pack` +
  `prepack`/`build:cli`, copies it into MERC's `vendor/`, rewrites MERC's `package.json` `boardsmith`
  dependency to `file:./vendor/<new>.tgz` + nested overrides, and runs `npm install` in MERC).
- BoardSmith HEAD must be clean and carry the fixes before packing (verified: `281e8155` is an
  ancestor of HEAD; `asset-scan.ts` + `generateAssetImageVue` (Phase 152) and `connection-handler.ts`
  (Phase 153) are present). The pack reflects current source, so it propagates all three.
- The prior vendored build is `boardsmith-0.0.1-20260703202418.tgz` (2026-07-03, v4.5-era) — pre-DEF-B
  and pre-v4.7, confirming the re-vendor is needed.

### Verification & Baseline
- MERC test command: `npm test` (= `vitest --run`) run from `~/Dropbox/MERC/BoardSmith/MERC`.
- Baseline: MERC's last known-green is **738 passing / 7** (per prior-milestone campaign records). The
  re-vendored suite must pass at the SAME or BETTER pass rate.
- Also run MERC's `boardsmith validate` / `lint` if its scripts define them, as a secondary sanity
  check, but the test suite is the load-bearing gate.

### Compatibility-Gap Handling (SC-3 — no silent patching)
- If MERC's suite regresses after the re-vendor, the failure is a REAL MERC-side compatibility gap
  surfaced by the v4.7 changes — **document it** (what broke, which v4.7 change caused it, the minimal
  MERC-side adjustment or a BoardSmith-side follow-up) rather than silently patching MERC to go green.
- Minimal MERC-side bookkeeping edits that the re-vendor pattern itself requires (the `package.json`
  dep bump, `package-lock.json`, any `boardsmith.json` cleanup the pattern shows in prior re-vendor
  commits) are expected and NOT a compatibility gap.

### Commit
- Commit the re-vendor IN the MERC repo following its established message pattern:
  `chore: re-vendor boardsmith (v4.7 playtest follow-up: DEF-B + ASSET/DEVHOST fixes)`. MERC is a
  separate git repo under `~/Dropbox`; this commit is the phase's integration proof and is authorized
  by the milestone's VENDOR-01 requirement.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/pack.ts` — the pack-and-integrate command (`--target` copies to a consumer's
  vendor/ + updates deps + npm install). This IS the re-vendor tool; do not hand-roll a tarball copy.
- MERC re-vendor history (`git -C ~/Dropbox/MERC/BoardSmith/MERC log`): commits like `ad70aa8`
  ("chore: re-vendor boardsmith (v4.5 …)") show the pattern touches `package.json`,
  `package-lock.json`, and occasionally `boardsmith.json` — minimal, mechanical.

### Established Patterns
- MERC uses a VENDORED tgz (NOT a symlink like `~/BoardSmithGames/*`), so it only picks up BoardSmith
  changes when re-vendored — that is the entire reason this phase exists (memory: MERC vendored copy).
- Re-vendor-as-integration-test is a recurring BoardSmith practice (v4.3/v4.4/v4.5 each ended with a
  MERC re-vendor that caught real cross-repo breakage).

### Integration Points
- The pack respects BoardSmith's `package.json` `files`/`prepack` (`build:cli`) — the tgz is the
  publishable `boardsmith` package, so MERC consumes the same surface a real install would.
</code_context>

<specifics>
## Specific Ideas

- This is the milestone's capstone integration proof: it validates that the v4.7 fixes reach the
  vendored consumer and don't break the most complex game. A green MERC suite closes VENDOR-01.
- Keep the BoardSmith repo itself unchanged in this phase — the only BoardSmith-side artifacts are the
  planning docs; all real changes land in the MERC repo.
</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase, scope is the single re-vendor + verification.
</deferred>
</content>
