---
phase: 180
plan: "01"
subsystem: verify-cli / bs-verify-game skill prose
tags: [json-transport, session-lock, gap-closure]
dependency-graph:
  requires: []
  provides:
    - parseSubagentJsonInput fence/prose tolerance (SubagentJsonParseResult)
    - Session Lock released-value classification rule (state-machine.md)
  affects:
    - verify-derive-record CLI result shape (+repairs)
    - verify-example-record CLI result shape (+repairs)
    - verify-example-translate CLI result shape (+repairs)
    - verify-example-emit CLI result shape (+repairs)
tech-stack:
  added: []
  patterns:
    - single-choke-point JSON transport repair, reported never silent
    - byte-level leading-token classification rule (prose, no runtime parser)
key-files:
  created: []
  modified:
    - src/cli/commands/verify-derive-check.ts
    - src/cli/commands/verify-derive-check.test.ts
    - src/cli/commands/verify-example-replay.ts
    - src/cli/commands/example-test-emit.ts
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/status-tools.test.ts
decisions:
  - "JSON transport repair lives in parseSubagentJsonInput only (verify-derive-check.ts), the pre-existing single export site — no second implementation."
  - "Session Lock rule stays in prose, not code: the entire bs- skill directory has zero runtime parsers (100% .md consumed by an agent session), so introducing a code module here would be the first exception to that convention rather than a fix of one."
metrics:
  duration: "~40min"
  completed: 2026-08-01
---

# Phase 180 Plan 01: Install Gap & Interactive Orchestrator Proof — gap-closure fix Summary

Fixed the two 180-PROOF.md interactive-run findings that can break a real designer's session: unparseable subagent JSON transport (finding 5) and the Session Lock released-value misclassification (finding 2). Findings 1, 3, 4, 6, 7 left untouched as instructed.

## Finding 5 — JSON transport tolerance

**Fix location:** `parseSubagentJsonInput` in `src/cli/commands/verify-derive-check.ts` — the single existing export site already shared by every `--enumerator-a`/`--enumerator-b`/`--reconciler`/`--extraction`/`--translation`/`--translated` file read (`verify-derive-check.ts`, `verify-example-replay.ts`, and a fourth call site in `example-test-emit.ts` that the plan's file list didn't name but uses the same function).

The function now attempts, in order, only when a bare `JSON.parse` fails:
1. Strip a markdown fence (``` ``` `` or `` ```json ``) wrapping the *entire* document.
2. Discard prose before the first `{`/`[` and after the last matching `}`/`]`.

Each attempt that changes the candidate text pushes one entry to a new `repairs: string[]` array; a repair is never applied without being logged. The array is threaded through to every caller's `--json` result (`VerifyDeriveRecordResult.repairs`, `VerifyExampleRecordResult.repairs`, `VerifyExampleTranslateResult.repairs`, `VerifyExampleEmitResult.repairs`) and echoed as `⚠ JSON transport repair —` lines in the human-readable output. If still unparseable after both attempts, the original actionable error (naming the flag and file path, never a raw `SyntaxError`) fires.

**Proving tests** (`verify-derive-check.test.ts`, `describe('parseSubagentJsonInput', ...)`):
- `'180-01 finding 5 fixture: strips a whole-document wrapping \`\`\`json fence and reports the repair'` — uses the exact enumerator-B shape from 180-PROOF.md finding 5.
- `'180-01 finding 7 fixture: discards a forbidden-fence prose prefix and reports the repair'` — uses the exact reconciler shape from 180-PROOF.md finding 7 (`` ```json is forbidden, returning raw JSON. `` prefix).
- `'still fails loudly, naming the flag and file path, when the content is not valid JSON even after both repair attempts'`.
- `'180-01 finding 5, end-to-end: a fence-wrapped --enumerator-b and a prose-prefixed --reconciler both still record, and result.repairs names both files'` (in `describe('verifyDeriveRecordCommand', ...)`) — full command run through real temp files, asserting `result.repairs` names both flags.
All four are new and fail on the pre-fix `parseSubagentJsonInput` (which threw on both fixtures); they pass post-fix.

**CR-04 confirmation — untouched:** `'CR-04 is untouched by this repair: a fence marker INSIDE a field value survives transport repair and is still rejected at record construction'` (in the same describe block). Feeds `parseSubagentJsonInput` a document that is itself fence-wrapped (a legitimate transport artifact) AND whose `reason` field, once unwrapped, contains a forged `DERIVE_CHECK_LEDGER_BEGIN` marker as content. Asserts the outer fence *was* stripped (`repairs` has one entry) but `createDeriveCheckRecord` still throws `/reason.*ledger fence marker/s` on the unwrapped value — proving the two layers (transport-fence tolerance vs. ledger-corruption fence rejection) are genuinely independent and CR-04's existing choke point is unmodified. The two pre-existing CR-04 tests at lines 255–308 (`'throws when reason contains the ledger BEGIN fence marker...'`, `'...END fence marker (CR-04, the corrupting shape)'`, etc.) were left byte-identical and still pass.

## Finding 2 — Session Lock released-value rule

**Decision:** kept in prose (`src/cli/slash-command/bs/state-machine.md`, `## Session Lock`), not code. The entire `src/cli/slash-command/bs/` tree — `state-machine.md`, `build/*.md`, `verify/*.md`, `ingest/*.md`, `templates/*` — has zero runtime `.ts` parsers; every file is markdown an agent session reads and follows, and the only `.ts` files in that directory are prose-pin tests (`*.test.ts` that `readFileSync` the `.md` and assert exact substrings). Introducing a code classifier here would be the *first* exception to that convention, not a fix consistent with it. The rule instead is stated as a byte-level, mechanically-applicable algorithm, worded precisely enough that an agent following it cannot misapply it — this is exactly the register the rest of `state-machine.md` (e.g. the "Cold-Resume Parse Contract" section) already uses.

**The rule** (added to `state-machine.md`, replacing the old bare "`none` is the released/no-lock value" sentence):
1. Trim whitespace.
2. If wholly wrapped in one pair of parentheses, strip that one outer pair.
3. Read the leading token: characters up to the first whitespace char, the first em dash (`—`), or end-of-string — **an ASCII hyphen is explicitly NOT a boundary** (chunk slugs contain hyphens, e.g. `player-movement`).
4. RELEASED iff that leading token is exactly `none` (case-sensitive). Anything else — including a token merely containing `none` as a substring — is a LOCK, classified against the existing three staleness outcomes.

This cannot misclassify a real lock because a real lock's `<slug> @ <session-id> — locked at <ISO timestamp>` grammar always has the chunk slug (never the word `none`) as its leading token, and the hyphen exclusion specifically prevents any hyphenated slug from ever accidentally reducing to a `none`-prefixed leading token.

Four worked examples were added to the prose, byte-exact:
- Bare `none` → RELEASED.
- `seven`'s real verbatim value `(none — final-acceptance closed 2026-07-20; sketch complete except ai-opponent, deferred on BSR-12)` → RELEASED (the actual evidence from 180-PROOF.md finding 2 — read, never modified, `~/BoardSmithGames/seven` was not touched).
- A real lock in the documented grammar → LOCK.
- The adversarial `"none-the-wiser @ session-ghost — locked at ..."` → LOCK (proves the rule can't be satisfied by a naive "starts with none" or "stops at first hyphen" implementation).

**Proving tests** (`status-tools.test.ts`, new `describe('Session Lock released-value rule (180-01 finding 2)', ...)`):
- A prose-pin test asserting the rule text and all four worked examples exist verbatim in `state-machine.md` (fails before the prose edit, passes after).
- A locally-mirrored `classifySessionLockValue` function (mirrors the prose algorithm step-for-step, not production code — there is none to call) exercised against all four required cases: bare `none` → released; `seven`'s real string verbatim → released; a real lock line → lock; the adversarial `none-the-wiser` value → lock. All four assertions pass.

## CR-04 status

**Untouched, confirmed strict.** Existing tests `'throws when reason contains the ledger BEGIN fence marker, naming the field "reason"'`, `'...END fence marker (CR-04, the corrupting shape)'`, `'throws when derivedLineText contains a ledger fence marker...'`, `'throws when a groundedQuotes string contains a ledger fence marker...'` (all in `createDeriveCheckRecord` describe block, verify-derive-check.test.ts) are byte-identical to before this plan and still pass. New test `'CR-04 is untouched by this repair: a fence marker INSIDE a field value survives transport repair and is still rejected at record construction'` additionally proves the new transport-repair layer cannot be used to smuggle a forged fence marker past CR-04.

## Test counts

- **Before:** 4368 tests / 249 files, 0 failing (stated baseline).
- **After:** 4378 tests / 249 files, 0 failing — full `npx vitest run` confirmed green.
- Net +10 tests: 4 new in `parseSubagentJsonInput` describe, 1 new end-to-end in `verifyDeriveRecordCommand` describe, both `--json` shape assertions in `verify-derive-check.test.ts` updated in place (not counted as new), 6 new in the Session Lock describe block in `status-tools.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] A fourth `parseSubagentJsonInput` call site not named in the plan's file list**
- **Found during:** running the full suite after fixing the two named files (`verify-derive-check.ts`, `verify-example-replay.ts`) — 5 pre-existing tests in `example-test-emit.test.ts` failed because `readRequiredTranslatedJsonFile` there also calls `parseSubagentJsonInput` and was passing its raw `unknown` result straight to `Array.isArray` instead of unwrapping the new `{ value, repairs }` shape.
- **Fix:** updated `readRequiredTranslatedJsonFile` and `verifyExampleEmitCommand` in `src/cli/commands/example-test-emit.ts` the same way as the other three call sites: unwrap `.value`, thread `.repairs` through to a new `VerifyExampleEmitResult.repairs` field, log any repairs in non-JSON output.
- **Files modified:** `src/cli/commands/example-test-emit.ts`.
- **Commit:** `a3ba7954` (same commit as the rest of this plan — found before the first commit, so folded in rather than split into a second commit).

No other deviations. CR-04, the annotation-family regex split, and every advisory exit-0 contract were left unmodified.

## Self-Check: PASSED

- `src/cli/commands/verify-derive-check.ts` — FOUND
- `src/cli/commands/verify-derive-check.test.ts` — FOUND
- `src/cli/commands/verify-example-replay.ts` — FOUND
- `src/cli/commands/example-test-emit.ts` — FOUND
- `src/cli/slash-command/bs/state-machine.md` — FOUND
- `src/cli/slash-command/bs/status-tools.test.ts` — FOUND
- Commit `a3ba7954` — FOUND (`git log --oneline --all | grep a3ba7954`)
- `npx vitest run` — 249 files, 4378 tests, 0 failing — CONFIRMED
