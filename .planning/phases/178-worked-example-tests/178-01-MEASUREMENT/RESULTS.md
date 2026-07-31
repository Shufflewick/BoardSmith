# 178-01 Task 1 Measurement Results

Measured directly against the LIVE `rulebook/*.md` slices of all three reference games —
`seven`, `one-two-punch`, `doom-machine` — using the REAL `quoteLinesOnly` and a faithful,
parameterized clone of the REAL `buildEnumeratorPayload` construction-site logic (imported
directly from `src/cli/commands/verify-derive-check.ts`, not reimplemented from memory). Script:
`.planning/phases/178-worked-example-tests/178-01-MEASUREMENT/scan.mjs`. Raw per-line data:
`178-01-MEASUREMENT/raw-report.json`. Raw counts only, no percentage (178-CONTEXT decision 16).

## Per-game counts

| Game | Citation-keyed `Example (p.` lines | Vocabulary-keyed NEW matches (Example-only) | `buildEnumeratorPayload` throws — today's 3-name families | `buildEnumeratorPayload` throws — naive 4-name variant |
|---|---|---|---|---|
| seven | 0 | 2 | 0 | 0 |
| one-two-punch | 0 | 0 | 0 | 0 |
| doom-machine | 0 | 0 | 0 | 0 |

Zero games carry a citation-keyed `Example (p.` line today, confirming
178-CONTEXT `<measured_reality>` #2/#4: no reference game has been transcribed with the marker.
A citation-keyed `Example (p.N):` recognizer is therefore behavior-neutral on the entire existing
corpus, as the plan's `<measured_hazard>` states.

## The vocabulary-only new matches (seven, both real quote lines)

`seven/rulebook/01-definitions-and-components.md:6`:
```
"example: 5, 5, 5"
```

`seven/rulebook/01-definitions-and-components.md:12`:
```
"example: 5, 6, 7"
```

Both are REAL directly-quoted rulebook prose (`isSet`/`isRun` definition illustrations — see
178-CONTEXT `<measured_reality>` #3, #4). Widening `ANNOTATION_VOCABULARY_RE` to include
`Example` (a naive single-list `ANNOTATION_FAMILIES` append) makes both match the vocabulary
backstop where they did not before. This is the load-bearing confirmation of the plan's
`<measured_hazard>` block.

## Correction to the plan's stated failure mode (measured, not assumed)

The plan's `<measured_hazard>` states the naive widening "makes `buildEnumeratorPayload`'s
construction-site backstop THROW on `seven`'s slice." **Measured behavior is different and, on
inspection, more dangerous, not less:** it does **not** throw. `buildEnumeratorPayload` strips any
line matching `ANNOTATION_VOCABULARY_RE` from the payload BEFORE running the backstop check
(`cleaned = quotes.filter((line) => !ANNOTATION_VOCABULARY_RE.test(line))`). If `ANNOTATION_FAMILIES`
were naively widened to four names in a single list (driving both `ANNOTATION_CITATION_RE` and
`ANNOTATION_VOCABULARY_RE` together, as the pre-178.1... i.e. pre-178-01 code does today), the
`"example: 5, 5, 5"` / `"example: 5, 6, 7"` lines would be **silently stripped from the payload
before the backstop ever runs against them** — so the backstop sees a payload that no longer
contains the offending text and passes cleanly. `buildEnumeratorPayload` returns successfully, with
`seven`'s two real quote lines silently missing from what reaches the enumerator dispatch. This
is CHECK-04's payload composition changing with **zero error signal** — strictly worse than a
loud throw, because nothing calls attention to it. This is the exact reason the plan's Task 3
splits `ANNOTATION_FAMILIES` (citation-keyed, four names) from a new `VOCABULARY_KEYED_FAMILIES`
(three names, `Example` excluded) rather than widening a single list — the split is what prevents
BOTH failure modes (a throw AND a silent strip), not just the one originally hypothesized.

This correction does not change the plan's conclusion (the naive one-list widening is unsafe and
must not ship) — it changes *why*, and that "why" is exactly what a citation-only,
vocabulary-excluded `Example` addition avoids by construction: `ANNOTATION_VOCABULARY_RE` never
gains `Example`, so neither the strip nor a throw can ever be triggered by an `Example`-shaped
vocabulary match.

## `buildEnumeratorPayload` throw status (both variants, all three games)

Zero throws in either variant, on any of the three games — because seven's only affected lines
are silently stripped rather than triggering the backstop (see correction above). No slice/line
threw in either configuration.
