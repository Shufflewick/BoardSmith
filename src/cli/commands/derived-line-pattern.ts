/**
 * The single shared `Derived (p.` citation-body pattern (177-08, closing WR-01).
 *
 * `verify-derive-check.ts`, `verify-enumerate.ts`, `verify-classify.ts`, and `ingest-archive.ts`
 * all need to recognize a `Derived (p.N):` line, including a multi-page citation body
 * (`Derived (p.1, continues on p.2):`). Before 177-08 these modules carried independently-spelled
 * literals that diverged (`\d+` vs `[^)]*`), so a multi-page citation was recognized by some and
 * missed by others — exactly the drift class this milestone keeps closing. Every consumer now
 * imports THIS ONE regex rather than re-spelling it.
 *
 * Deliberately isolated in its own file with NO other imports: `verify-derive-check.ts` imports
 * `verify-classify.ts`, which imports `chunk-provenance.ts`, which imports `ingest-archive.ts` —
 * so `ingest-archive.ts` importing `DERIVED_LINE_RE` directly from `verify-derive-check.ts`
 * would close a circular import (`ingest-archive` → `verify-derive-check` → `verify-classify` →
 * `chunk-provenance` → `ingest-archive`) and leave `DERIVED_LINE_RE` `undefined` at module-init
 * time in whichever file loads second. Routing every consumer through this leaf module avoids the
 * cycle entirely.
 */
export const DERIVED_LINE_RE = /^Derived \(p\.[^)]*\)/i;

/**
 * The ONE list of CITATION-keyed annotation-family names (177.1-01, extended by 178-01 Task 3).
 *
 * Before 177-08, five call sites (`verify-enumerate.ts` x2, the retired blind-derivation module
 * x2, `verify-classify.ts` x1, plus `ingest-archive.ts`'s own comment naming the pattern) each
 * hand-spelled an equivalent-but-independently-maintained regex over these same three words.
 * `verify-enumerate.ts`'s own header comment called itself "the fourth
 * instance in this milestone" of the same near-miss. Phase 178 adds a fourth family (`Example`) —
 * this is the ONLY place that addition should ever need to happen for the CITATION-keyed form
 * (`Example (p.N):`, `annotationLineStartRe('Example')`, `ANNOTATION_CITATION_RE`).
 *
 * `Example` is deliberately NOT added to `VOCABULARY_KEYED_FAMILIES` below — see that constant's
 * comment for the measured reason (178-01-MEASUREMENT/RESULTS.md). This list and that one used to
 * be the same array; 178-01 Task 3 splits them because the two backstops need different scope.
 *
 * Order matters for `ANNOTATION_CITATION_RE`'s `.source`: it is built by mapping this array in
 * order, so appending `Example` at the end keeps the first three alternatives' relative order
 * (and therefore their `.source` substring) unchanged, minimizing the diff to "one more
 * alternative appended," not a reordering.
 */
export const ANNOTATION_FAMILIES = Object.freeze([
  'Derived',
  'Visual',
  'Named-but-undefined',
  'Example',
] as const);

export type AnnotationFamily = (typeof ANNOTATION_FAMILIES)[number];

/**
 * Escapes every regex metacharacter in `s` so it can be embedded literally inside a
 * mechanically-assembled pattern. None of today's four family names contain a metacharacter
 * (the hyphen in `Named-but-undefined` is not special outside a character class), but this keeps
 * the assembly correct for any future family name a later phase adds to `ANNOTATION_FAMILIES`
 * without anyone having to remember to escape it by hand.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The citation-keyed backstop, built mechanically from `ANNOTATION_FAMILIES` — replaces the two
 * independently hand-spelled `ANY_ANNOTATION_LINE_RE` literals formerly in `verify-enumerate.ts`
 * and the retired blind-derivation module. Matches any of the four family names
 * immediately followed by ` (p.` anywhere in a string (no anchor, no citation-body capture — that
 * shape is `annotationLineStartRe` below).
 *
 * `.source` CHANGED in 178-01 Task 3 (177.1-01's three-name pin no longer holds — this is the
 * intended behavior change, and the updated pin in `derived-line-pattern.test.ts` IS its record):
 * it now equals `Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\.|Example \(p\.`. This is
 * SAFE to widen (unlike `ANNOTATION_VOCABULARY_RE` below) because it requires the `(p.` citation
 * form: Task 1's measurement found ZERO `Example (p.` lines in any of the three reference games
 * today, so this widening is behavior-neutral on the entire live corpus
 * (178-01-MEASUREMENT/RESULTS.md). Defined as a `const` regex literal produced once at module
 * init: it carries no `g` flag, so it has no `lastIndex` state and is safe to share across every
 * consumer and every call, unlike a stateful global-flag regex would be.
 */
export const ANNOTATION_CITATION_RE = new RegExp(
  ANNOTATION_FAMILIES.map((family) => `${escapeRegExp(family)} \\(p\\.`).join('|'),
  'i',
);

/**
 * The VOCABULARY-keyed family list — deliberately narrower than `ANNOTATION_FAMILIES` above.
 * `Example` is EXCLUDED here on purpose (178-01 Task 1's measured hazard, confirmed live against
 * all three reference games): `seven/rulebook/01-definitions-and-components.md:6,12` contains the
 * REAL, directly-quoted rulebook prose `"example: 5, 5, 5"` / `"example: 5, 6, 7"` — an
 * `isSet`/`isRun` definition illustration, not an annotation of any kind. `ANNOTATION_VOCABULARY_RE`
 * is case-insensitive and tolerates leading non-alphanumeric decoration (the opening `"`), so if
 * `Example` joined this list, both lines would match a vocabulary-keyed check that requires no
 * citation at all. Measured behavior (178-01-MEASUREMENT/RESULTS.md "Correction" section) is that
 * `buildEnumeratorPayload` would not throw on this — it would SILENTLY STRIP both real quote lines
 * from CHECK-04's dispatch payload before its own backstop ever ran, changing a CLOSED
 * requirement's measured payload composition with no error signal. Keeping `Example` out of this
 * list is what prevents that: `Example` is recognized ONLY in citation form
 * (`ANNOTATION_CITATION_RE`, `annotationLineStartRe('Example')`), never by bare vocabulary.
 */
export const VOCABULARY_KEYED_FAMILIES = Object.freeze([
  'Derived',
  'Visual',
  'Named-but-undefined',
] as const);

/**
 * The vocabulary-keyed backstop, built mechanically from `VOCABULARY_KEYED_FAMILIES` (NOT
 * `ANNOTATION_FAMILIES` — see that constant's comment above) — replaces `verify-enumerate.ts`'s
 * independently hand-spelled `ANNOTATION_VOCABULARY_RE`. Deliberately does NOT require a `(p.`
 * citation: it keys on the family word itself at line start, tolerating ANY leading
 * non-alphanumeric decoration (not an enumerated character class — see the history in
 * `verify-enumerate.ts`'s original comment, preserved at that call site). This is what catches a
 * marker-form variant (bare `Derived:`, `(Derived: ...)`) that a citation-keyed check is blind to
 * by construction.
 *
 * `.source` MUST STAY byte-equal (177.1-01's original pin, deliberately held through 178-01):
 * `^[^A-Za-z0-9]*(?:Derived|Visual|Named-but-undefined)\b`. `derived-line-pattern.test.ts` asserts
 * this explicitly. Defined as a `const` regex literal produced once at module init — no `g` flag,
 * no `lastIndex` state, safe to share.
 */
export const ANNOTATION_VOCABULARY_RE = new RegExp(
  `^[^A-Za-z0-9]*(?:${VOCABULARY_KEYED_FAMILIES.map((family) => escapeRegExp(family)).join('|')})\\b`,
  'im',
);

/**
 * Factory for the anchored, citation-body-capturing line-start pattern one specific family needs
 * (e.g. `VISUAL_LINE_RE`, `NAMED_BUT_UNDEFINED_LINE_RE`, `EXAMPLE_LINE_RE` in
 * `verify-derive-check.ts`, formerly two more hand-spelled literals). Equivalent to
 * `/^<family> \(p\.[^)]*\)/i` — case-insensitive, tolerates a multi-page citation body
 * (`Derived (p.1, continues on p.2)`, `Example (p.1, continues on p.2)`).
 *
 * Returns a fresh `RegExp` per call rather than a cached one: callers that need this at module
 * init for several families (as `verify-derive-check.ts` does) each get their own instance,
 * matching the shape of the literals this factory replaces.
 */
export function annotationLineStartRe(family: AnnotationFamily): RegExp {
  return new RegExp(`^${escapeRegExp(family)} \\(p\\.[^)]*\\)`, 'i');
}

/**
 * Per-family regex SOURCE strings in `PRESENTATION_EXCLUSION_MARKERS` shape (a bare citation-body
 * form, `\d+` rather than `[^)]*`, no qualifier group) — offered for a future consumer that needs
 * the family list in that exact shape. `verify-classify.ts`'s actual
 * `PRESENTATION_EXCLUSION_MARKERS` was measured NOT to be element-wise derivable from this list
 * (177.1-01 finding): it carries a `(?: \([^:]*\))?` qualifier-group tolerance on every entry, and
 * lists `Derived` twice under two schema-specific suffixes (`— diagram description`, `— art`)
 * while never listing `Named-but-undefined` (or `Example`) at all — a fundamentally different
 * shape driven by presentation-schema history, not a re-spelling of the family list.
 * `verify-classify.ts` keeps its own literal for that reason; see the comment there.
 *
 * Now has FOUR entries (178-01 Task 3), one per `ANNOTATION_FAMILIES` name including `Example` —
 * `ANNOTATION_FAMILIES` is the citation-keyed list this array mirrors, and `Example (p.N):` is a
 * citation-keyed form like the other three.
 */
export const ANNOTATION_CITATION_SOURCES = Object.freeze(
  ANNOTATION_FAMILIES.map((family) => `^${escapeRegExp(family)} \\(p\\.\\d+\\):`),
);
