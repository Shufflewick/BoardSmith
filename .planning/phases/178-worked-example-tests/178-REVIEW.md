---
phase: 178-worked-example-tests
reviewed: 2026-08-01T03:00:27Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - src/cli/commands/example-derivation.ts
  - src/cli/commands/verify-example-replay.ts
  - src/cli/commands/example-test-emit.ts
  - src/cli/lib/sandbox-scan.ts
  - src/cli/commands/derived-line-pattern.ts
  - src/cli/cli.ts
  - src/cli/slash-command/bs/build/test.md
  - src/cli/slash-command/bs/verify-game.md
  - src/cli/slash-command/bs/verify/extract-example.md
  - src/cli/slash-command/bs/verify/translate-example.md
findings:
  critical: 3
  warning: 3
  info: 0
  total: 6
status: fixed
fixed_at: 2026-08-01
fix_report: 178-REVIEW-FIX.md
disposition:
  CR-01: fixed
  CR-02: fixed
  CR-03: fixed
  WR-01: deferred
  WR-02: fixed
  WR-03: fixed
---

# Phase 178: Code Review Report

**Reviewed:** 2026-08-01T03:00:27Z
**Depth:** deep
**Files Reviewed:** 8 primary + supporting test/skill files read for cross-reference
**Status:** issues_found

## Summary

Reviewed the SC-3 shared derivation module, the CHECK-06 ledger/replay/record/translate command
module, the TEST-01 build-side test-emission module, the sandbox-scan split, the deliberate
`derived-line-pattern.ts` regex-family split, four new CLI registrations, and the four skill prose
files that route dispatch. The `ANNOTATION_FAMILIES`/`VOCABULARY_KEYED_FAMILIES` split holds — no
code path re-merges them, verified by tracing every import site. The advisory exit-0 contract
holds — no `process.exitCode` assignment anywhere in `verify-example-replay.ts`. The 178-12
content-free-slice guard has exactly one caller.

Three provable blockers, however, sit exactly at the "sharpest edge" this review was asked to
scrutinize — model-controlled text becoming runnable code on disk, and the caller-assigned-identity
guarantee the milestone's own header comments repeatedly claim to have fixed:

1. `GENERATED_TEST_SANDBOX_RULES` claims to gate generated test code against five rules, but two
   of them can **never** fire — confirmed empirically, not just by inspection.
2. Generated TypeScript test files interpolate untrusted/model-controlled text (`chunkSlug`,
   `reason`, `pageCitation`) into string literals and `//` comments without escaping quotes or
   newlines, before that file is written to disk and executed by the project's test runner.
3. `workedExampleId`'s `lineNumber` component — the exact class of value 177.1's review fixed by
   moving identity off model-supplied text — is itself taken directly from the model's own JSON
   return with no validation against the real line numbers the caller's own payload builder
   produced, reopening the identity-collision hazard one layer down.

## Critical Issues

### CR-01: `GENERATED_TEST_SANDBOX_RULES` silently never enforces 2 of its 5 named rules

**File:** `src/cli/lib/sandbox-scan.ts:35-56` (config) and `src/cli/commands/example-test-emit.ts:49-64` (consumer)

**Issue:** `FLAT_CONFIG.rules` in `sandbox-scan.ts` is built from `{ ...SECURITY_RULES, ...DETERMINISM_RULES }` — exactly 5 rules: `no-network`, `no-filesystem`, `no-eval`, `no-timers`, `no-nondeterministic`. It does **not** include `boardsmith/no-element-identity-comparison` or `boardsmith/no-element-array-state`.

`GENERATED_TEST_SANDBOX_RULES` (`example-test-emit.ts:49-55`) names five rules the generated-test gate is supposed to enforce, including those exact two. `scanGeneratedTestCode` restricts the *reported* violation set to `ruleIds`, but the underlying `linter.verify(code, FLAT_CONFIG, relPath)` call in `scanSourceForSandboxViolations` (`sandbox-scan.ts:150-176`) only ever produces messages for rules that are *enabled* in the config passed to it. Since `no-element-identity-comparison`/`no-element-array-state` are never enabled in `FLAT_CONFIG`, ESLint never runs them — restricting the report to a rule id that was never active is a no-op, not a filter.

Confirmed empirically:
```
$ npx tsx <script using scanSourceForSandboxViolations with a textbook
  `if (a === b)` GameElement identity comparison, restricted to
  ['boardsmith/no-element-identity-comparison']>
[]   // zero violations reported, even though the standalone rule fires
     // correctly when enabled directly against the same code
```
Also confirmed by test-suite silence: `example-test-emit.test.ts` only exercises the `no-network` (fetch) positive case for `scanGeneratedTestCode`; no test ever exercises `no-element-identity-comparison`/`no-element-array-state` firing, because it can't.

**Why it matters:** This is the gate the translation contract (`translate-example.md:120-141`) tells the model is the hard backstop against exactly these two anti-patterns before model-generated code is written to disk and executed inside a real game project (`example-test-emit.ts`'s own header comment: "the FIRST check in the milestone that writes AND then executes generated code"). Two-fifths of the stated protection is structurally absent — a translated test that compares `GameElement` instances by `===` or persists an element array as state will be accepted and written, silently.

**Fix:** Add the two rules to `FLAT_CONFIG.rules` (they are already registered in the plugin and used in `plugin.configs.recommended`), or build a dedicated config for `scanSourceForSandboxViolations`'s superset that includes all seven plugin rules and let `ruleIds` narrow the report as documented:
```ts
const FLAT_CONFIG: Linter.Config[] = [{
  // ...
  rules: {
    ...SECURITY_RULES,
    ...DETERMINISM_RULES,
    'boardsmith/no-element-identity-comparison': 'error',
    'boardsmith/no-element-array-state': 'error',
  },
}, /* ... */];
```
Then add a positive-case test for both rules to `example-test-emit.test.ts`, matching the existing `fetch`/`no-network` pattern, so this class of gap fails loudly next time.

---

### CR-02: Generated test files interpolate unescaped model/agent-controlled text into TS source

**File:** `src/cli/commands/example-test-emit.ts:184-186` (`escapeTestTitle`, unused), `:246` (`describe(...)`), `:248-254` (exempt comment loop), `:195-202` (`renderCitationComment`)

**Issue:** `renderExampleTestFile` builds the generated `.ts` file's text with raw template-literal interpolation of caller/model-controlled strings, without escaping quote or newline characters:

- `chunkSlug` (validated only against `/[\\/]/`, `'..'`, `'.'` in `generatedTestFilePath`, `example-test-emit.ts:76-84` — nothing else) is interpolated directly into a single-quoted JS string: `` describe(`${chunkSlug} — worked examples`, ...) `` is actually `describe('${chunkSlug} — worked examples', ...)` at `:246`. A slug containing a `'` breaks out of the string literal into raw code.
- `record.reason` (a free-text field from the translator/extractor's JSON return, validated only for non-emptiness and absence of the ledger's own fence markers in `createExampleReplayRecord`) is interpolated raw into a `//` line comment at `:248-254`:
  ```ts
  lines.push(
    `  // ${record.verdict.toUpperCase()} — ${record.slicePath}:${record.lineNumber}: ` +
      `${record.reason}`,
  );
  ```
  A `reason` value containing an embedded newline breaks out of the `//` comment — everything after the newline becomes live, unscanned TypeScript source, appended directly inside the `describe()` body.
- `renderCitationComment` (`:195-202`) correctly splits `entry.sourceText` per line and re-prefixes each with `//`, but does the same **not** apply to `entry.pageCitation`, which is interpolated on one raw line (`:197`) with no newline handling.

The function `escapeTestTitle` (`:184-186`) exists — `.replace(/\\/g, '\\\\').replace(/'/g, "\\'")` — and is clearly written for exactly this purpose, but it is **never called anywhere in the file**. It is dead code sitting next to the exact unescaped interpolation it was presumably meant to guard.

**Why it matters:** This file is written to disk under the generated game project's `tests/` directory and then *executed* by the project's own test runner (`build/test.md` step 4f: "RUN that file with the project's own test runner"). Any untrusted text that reaches this template without escaping is a code-injection surface into a file that gets `vitest run`. `reason`/`pageCitation` are model-authored text from a subagent dispatch (the whole point of this milestone's threat model, per the prompt's own framing) — a benign multi-sentence reason with a line break, let alone an adversarial one, corrupts or hijacks the generated file with no error signal at write time; the corruption only surfaces as a confusing test-runner failure, or worse, silently executes injected code.

**Fix:** Route every interpolated string through an escaping helper before it lands in generated source:
```ts
function commentSafeLine(text: string): string {
  return text.replace(/\r?\n/g, ' ');           // never let one field emit a raw newline into a `//` line
}
function stringLiteralSafe(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}
```
Apply `stringLiteralSafe` to `chunkSlug` at the `describe(...)` call site (wiring up the existing `escapeTestTitle`, or replacing it with a helper that also strips newlines, since chunkSlug already fails the "no path separator" check but not the "no quote/newline" check). Apply `commentSafeLine` to `record.reason` and `entry.pageCitation` before pushing them into a `//` line. Add a test asserting a `reason`/`chunkSlug` containing `'`/`` ` ``/newline produces syntactically valid output (parse the emitted file, don't just string-match).

---

### CR-03: `workedExampleId`'s `lineNumber` component is trusted from the model's own return, unvalidated

**File:** `src/cli/commands/verify-example-replay.ts:785, 910, 982, 1174` (all four `workedExampleId({ slicePath, lineNumber: <raw model field> })` call sites in `verifyExampleRecordCommand`/`verifyExampleTranslateCommand`)

**Issue:** `example-derivation.ts`'s header comment (and this module's own header comment, `verify-example-replay.ts:26-33`) states the fix for 177.1's CR-01/CR-02 is that identity is composed "only by `slicePath` + `lineNumber`, which the CALLER (never the model) supplies." In practice, every call site that builds a `workedExampleId` in the record/translate commands passes `lineNumber: raw.lineNumber` (or `entry.lineNumber`) — a field read straight out of the extractor's/translator's `--extraction`/`--translation` JSON file, i.e. the model's own return. `verify-example-replay.ts:805`'s own doc comment even states this in the same breath it contradicts: `"workedExampleId({ slicePath: --slice-path, lineNumber: <the returned lineNumber> })` — never a model-supplied field"`.

Nothing in `createWorkedExampleSpec` (`example-derivation.ts:127-221`) or anywhere in `verify-example-replay.ts` cross-checks `raw.lineNumber` against the actual line numbers `buildExampleExtractionPayload(...).lines` produced for that slice (the set the extractor was actually shown). `createWorkedExampleSpec` only verifies that `sourceText` is a verbatim substring of the slice text — it never verifies `lineNumber` points at where that substring actually is.

**Why it matters:** `slicePath` is the only genuinely caller-supplied half of the id (`--slice-path` is a CLI flag, not model output); `lineNumber` — the half that actually disambiguates one example from another on the same slice — is 100% model-controlled and unchecked. This reopens the exact hazard class 177.1's review closed, one field over:
- A model that reports a fabricated or off-by-one `lineNumber` for a genuine example produces an id that doesn't correspond to any real citation, silently breaking traceability.
- Two independent dispatches for the SAME example that report slightly different (wrong) line numbers are treated as two *different* examples rather than deduplicated (`collectWorkedExampleSpecs`'s fail-closed collision check never fires, because the ids differ).
- Worse, on a later invocation, `recordExampleReplayVerdicts`'s upsert (`:323-334`) replaces any existing record with the same `exampleId` — if a fabricated `lineNumber` from one dispatch happens to coincide with another, genuinely different example's real `lineNumber` on a later run, the later write **silently overwrites** the earlier, unrelated example's ledger entry with no error, exactly the "last-write-wins" failure mode this module's own comments (`:224-228`) name as the defect class it exists to prevent.

**Fix:** In `verifyExampleRecordCommand`/`verifyExampleTranslateCommand`, recompute the slice's retained extraction lines via `buildExampleExtractionPayload({ path: slicePath, text: sliceText }).lines` (already available — `sliceText` is already read in both commands) and reject any `raw.lineNumber` that isn't in that set, before it is ever used to build an id:
```ts
const validLineNumbers = new Set(buildExampleExtractionPayload({ path: slicePath, text: sliceText }).lines.map(l => l.lineNumber));
for (const raw of extractionRaw) {
  if (!validLineNumbers.has(raw.lineNumber)) {
    throw new Error(`${slicePath}:${raw.lineNumber} is not a line number this slice's extraction payload offered.\n...`);
  }
}
```

## Warnings

### WR-01: `verify-example-replay.ts` bundles three CLI commands + the ledger schema in one 1236-line file

**File:** `src/cli/commands/verify-example-replay.ts` (entire file)

**Issue:** The file accumulated across waves 3 (ledger + replay), 4 (record), 5 (translate), 8, and the 178-12 fix into one module containing: the record/ledger schema and choke-point constructor, the atomic upsert-append triad, `verifyExampleReplayCommand`, `verifyExampleRecordCommand`, and `verifyExampleTranslateCommand`. No duplicated logic was found (the `resolveSlicePathWithinRulebook`/`keyRawExampleEntriesByLocation`/`readRequiredExampleJsonFile` helpers are correctly shared, not copy-pasted), but the file mixes three independently-invoked CLI surfaces with distinct option shapes and distinct raw-entry interfaces (`RawExampleExtractionEntry`, `RawExampleTranslationEntry`, `RawExampleTranslateExtractionEntry` — three near-identical, subtly-different shapes for "an extraction entry" all live in this one file).

**Why it matters:** A file this size covering three separately-registered CLI commands makes the blast radius of any future change hard to reason about at a glance, and the three near-duplicate raw-entry interfaces are exactly the kind of drift-prone shape this milestone's own commentary elsewhere (`derived-line-pattern.ts`) explicitly calls out as a historical failure mode.

**Fix:** Split along the existing task boundaries into `verify-example-replay.ts` (ledger schema + `verifyExampleReplayCommand`), `verify-example-record.ts` (`verifyExampleRecordCommand`), and `verify-example-translate.ts` (`verifyExampleTranslateCommand`), re-exporting the ledger types from one canonical module — mirroring how `verify-derive-check.ts`/`verify-derive-record` and `verify-enumerate.ts` are already separated elsewhere in this codebase. Consider also consolidating the three raw-entry interfaces into one shared shape in `example-derivation.ts` if their divergence isn't load-bearing.

**Disposition (178-REVIEW-FIX.md, 2026-08-01): DEFERRED, explicitly.** This is a real file-organization
debt, not disputed, but splitting it now is NOT the mechanical, low-risk move `verify-derive-check.ts`
made it sound like: this file's three commands share a live, load-bearing `EXAMPLE_REPLAY_LEDGER_BEGIN`/
`_END` choke point AND the SC-3 "one export site per symbol" test (`example-derivation.test.ts`) asserts
exact import provenance across this exact file — a split done inside a fix-pass (rather than its own
planned unit) risks silently changing which module is "the" canonical export site and tripping that
assertion, or worse, passing it by accident while actually duplicating a re-export. CR-01/CR-02/CR-03
(this same review) already touch this file at three separate sites; layering a structural extraction on
top of those changes, un-reviewed as its own step, is exactly the kind of "half-do it" this finding's own
Fix explicitly warns against. Recorded here as open tech debt for a dedicated future plan, not silently
dropped.

### WR-02: `readExampleReplayVerdicts` doesn't validate ledger fence ordering

**File:** `src/cli/commands/verify-example-replay.ts:358-365`

**Issue:** `beginIdx`/`endIdx` are located independently via `indexOf`. If a hand-edited or corrupted ledger has the end marker before the begin marker (or the begin marker appears twice, etc.), `beginIdx < endIdx` is not checked — `body = text.slice(beginIdx + BEGIN.length, endIdx)` can silently produce an empty or nonsensical slice (e.g. a negative-length slice yields `''`) rather than the "malformed ledger" error the function's own doc comment promises for "fence markers... absent or unbalanced."

**Fix:** Add `if (beginIdx > endIdx) throw new Error(...)` alongside the existing `-1` checks.

### WR-03: `pageCitation` not newline-guarded in the generated citation comment

**File:** `src/cli/commands/example-test-emit.ts:195-202`

**Issue:** `renderCitationComment` splits `entry.sourceText` per-line before emitting each as its own `//`-prefixed line, but `entry.pageCitation` (also model-controlled) is interpolated on a single raw line (`slicePath:lineNumber (pageCitation)`) with no equivalent per-line handling. Same class of issue as CR-02, called out separately because it's a different field the same fix (CR-02's `commentSafeLine`) should also cover.

**Fix:** Apply the same newline-stripping helper recommended in CR-02 to `pageCitation` at this call site.

---

_Reviewed: 2026-08-01T03:00:27Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
