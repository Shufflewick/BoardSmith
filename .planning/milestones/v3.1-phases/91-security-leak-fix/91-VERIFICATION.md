---
phase: 91-security-leak-fix
verified: 2026-06-20T23:29:30Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 91: Security Leak Fix — Verification Report

**Phase Goal:** Close the information leak in `toJSONForPlayer` where hidden elements leaked `$images.face` / `$image` (card face image) to unauthorized players. Satisfy SEC-01 and SEC-02.
**Verified:** 2026-06-20T23:29:30Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A new test asserts a hidden deck card's serialized `$images` contains no face key | VERIFIED | `image-leak.test.ts` line 91–94: `$images.face` must be undefined on hidden deck card |
| 2 | The same test asserts `$images.back` IS kept | VERIFIED | `image-leak.test.ts` line 98–101: `$images.back` must equal `/cards/back.svg` |
| 3 | A non-owner viewing an owner-only hand receives no `$images.face` on any child | VERIFIED | `image-leak.test.ts` line 132–136: owner-only hand, non-owner viewer test |
| 4 | A count-only container's hidden representation leaks no `$image` / `$images.face` | VERIFIED | `image-leak.test.ts` line 192–197: count-only zone child face absent |
| 5 | A regression-guard walks the whole per-player view and asserts no `$images.face` or `$image` on any `__hidden` element | VERIFIED | `image-leak.test.ts` line 270–321: `collectAllHiddenAttrs` recursive sweep, 3 surfaces covered |
| 6 | `redactHiddenElementAttrs` helper exists and all three branches call it (not blanket `$` loops) | VERIFIED | `game.ts:260` (definition), lines 2271, 2306, 2326 (three call sites). Zero `key.startsWith('$')` matches anywhere in game.ts |
| 7 | image-leak.test.ts passes green and the full element suite stays green | VERIFIED | `npx vitest run src/engine/element/image-leak.test.ts` — 6/6 pass; `npx vitest run src/engine/element/` — 148/148 pass |

**Score:** 7/7 truths verified

---

## SEC-01 Requirement Verdict: SATISFIED

**Requirement:** A face-down / hidden card's face image refs (`$images.face`) are not sent to players who cannot see the card — `toJSONForPlayer` filters image refs by visibility.

**Evidence:**

Three hidden-element branches in `toJSONForPlayer` now all call `redactHiddenElementAttrs(...)` instead of copying `$images` verbatim:

| Branch | Location in game.ts | Output |
|--------|---------------------|--------|
| Count-only container | line 2271 | `attributes: redactHiddenElementAttrs(json.attributes ?? {})` |
| Zone hidden/count-only children | line 2306 | `attributes: { __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) }` |
| Owner-only zone, non-owner viewer | line 2326 | `attributes: { __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) }` |

The helper (`game.ts:260–280`) strips `$image` unconditionally, and for `$images` keeps only `{ back }` when present. Verified by 6 passing assertions in `image-leak.test.ts` spanning all three surfaces plus a full-tree recursive guard.

The fully-hidden placeholder branch (`game.ts:2279–2283`) returns `{ __hidden: true }` only — untouched and already safe.

---

## SEC-02 Requirement Verdict: SATISFIED

**Requirement:** The `$`-attribute whitelist in `toJSONForPlayer` is audited and constrained to genuine layout descriptors, so no value-bearing data can ride the `$`-prefix to unauthorized players.

**Evidence:**

`SAFE_LAYOUT_KEYS` at `game.ts:239–245` is an explicit `Set` of 18 verified layout-descriptor `$`-keys:

```
$type, $layout, $direction, $gap, $overlap, $fan, $fanAngle, $align,
$rowLabels, $columnLabels, $rowCoord, $colCoord,
$hexOrientation, $coordSystem, $qCoord, $rCoord, $sCoord, $hexSize
```

Cross-checked against all `$`-keys actually declared in `src/engine/element/` (excluding test files): all 18 layout keys are present; `$image` and `$images` are absent (handled separately as identity-bearing). No legitimate layout key is missing — allowlist is complete with no false-positive redaction.

`redactHiddenElementAttrs` drops any key not in `SAFE_LAYOUT_KEYS` (fail-safe). Verified by `image-leak.test.ts`: `$secretValue` (unknown key) is absent, `$image` is absent, `$direction` (allowlisted) survives.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/element/image-leak.test.ts` | Proof tests for SEC-01/SEC-02 | VERIFIED | 323 lines, 6 tests, engine-only imports, covers 3 hidden surfaces + recursive guard |
| `src/engine/element/game.ts` | `redactHiddenElementAttrs` + `SAFE_LAYOUT_KEYS` + 3 patched branches | VERIFIED | Helper at line 260, allowlist at line 239, call sites at 2271/2306/2326 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `image-leak.test.ts` | `Game.toJSONForPlayer` | direct call with hidden deck + owner-only hand | WIRED | Tests call `game.toJSONForPlayer(2)` and inspect serialized output |
| Branch 1 (count-only, ~2266) | `redactHiddenElementAttrs` | replaces `key.startsWith('$')` loop | WIRED | Confirmed at game.ts:2271 |
| Branch 2 (zone hidden/count-only children, ~2291) | `redactHiddenElementAttrs` | replaces `key.startsWith('$')` loop | WIRED | Confirmed at game.ts:2306 |
| Branch 3 (owner-only zone, ~2316) | `redactHiddenElementAttrs` | replaces `key.startsWith('$')` loop | WIRED | Confirmed at game.ts:2326 |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase modifies a serialization filter, not a rendering component. Data flow is tested directly by the unit tests which invoke `toJSONForPlayer` and assert on the output values.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 6 SEC-01/SEC-02 proof tests pass | `npx vitest run src/engine/element/image-leak.test.ts` | 6/6 pass, exit 0 | PASS |
| Full element suite regression-free | `npx vitest run src/engine/element/` | 148/148 pass, exit 0 | PASS |

---

### Probe Execution

No probes declared in PLAN files. No `scripts/*/tests/probe-*.sh` for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEC-01 | 91-01, 91-02 | Face image refs not sent to unauthorized players | SATISFIED | `redactHiddenElementAttrs` keeps only `$images.back`; `$images.face` absent on all hidden branches; 6 tests pass |
| SEC-02 | 91-01, 91-02 | `$`-attribute whitelist constrained to layout descriptors | SATISFIED | `SAFE_LAYOUT_KEYS` allowlist of 18 keys; unknown `$`-keys fail-safe dropped; `$image` dropped unconditionally |

---

### Anti-Patterns Found

Files modified by this phase: `src/engine/element/game.ts` (91-02) and `src/engine/element/image-leak.test.ts` (91-01).

| File | Pattern | Severity | Finding |
|------|---------|----------|---------|
| `game.ts` | TBD/FIXME/XXX | — | None found |
| `image-leak.test.ts` | TBD/FIXME/XXX | — | None found |
| `game.ts` | Return null / empty stubs | — | None in redaction helper; helper returns a populated object built from input |
| `game.ts` | Remaining `key.startsWith('$')` | — | Zero matches — all three blanket loops replaced |

No blockers or warnings.

---

### Allowlist Completeness Check

Engine `$`-key inventory (source files, excluding tests): `$align`, `$colCoord`, `$columnLabels`, `$coordSystem`, `$direction`, `$fan`, `$fanAngle`, `$gap`, `$hexOrientation`, `$hexSize`, `$image`, `$images`, `$layout`, `$overlap`, `$qCoord`, `$rCoord`, `$rowCoord`, `$rowLabels`, `$sCoord`, `$type`

- All 18 layout keys are in `SAFE_LAYOUT_KEYS`.
- `$image` and `$images` are intentionally excluded (handled as identity-bearing by the helper).
- No legitimate layout key is absent from the allowlist — no false-positive redaction possible.

---

### Human Verification Required

None. All assertions are fully automatable and were executed.

---

### Gaps Summary

No gaps. Both SEC-01 and SEC-02 are fully satisfied by codebase evidence.

---

_Verified: 2026-06-20T23:29:30Z_
_Verifier: Claude (gsd-verifier)_
