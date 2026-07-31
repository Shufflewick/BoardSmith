/**
 * The single shared `Derived (p.` citation-body pattern (177-08, closing WR-01).
 *
 * `verify-derive-recheck.ts` and `ingest-archive.ts` both need to recognize a `Derived (p.N):`
 * line, including a multi-page citation body (`Derived (p.1, continues on p.2):`). Before this
 * plan the two modules carried independently-spelled literals that diverged (`\d+` vs `[^)]*`),
 * so a multi-page citation was recognized by one and missed by the other — exactly the drift class
 * this milestone keeps closing. Both modules now import THIS ONE regex rather than re-spelling it.
 *
 * Deliberately isolated in its own file with NO other imports: `verify-derive-recheck.ts` imports
 * `verify-classify.ts`, which imports `chunk-provenance.ts`, which imports `ingest-archive.ts` —
 * so `ingest-archive.ts` importing `DERIVED_LINE_RE` directly from `verify-derive-recheck.ts`
 * would close a circular import (`ingest-archive` → `verify-derive-recheck` → `verify-classify` →
 * `chunk-provenance` → `ingest-archive`) and leave `DERIVED_LINE_RE` `undefined` at module-init
 * time in whichever file loads second. Routing both consumers through this leaf module avoids the
 * cycle entirely.
 */
export const DERIVED_LINE_RE = /^Derived \(p\.[^)]*\)/i;

/**
 * The ONE list of annotation-family names (177.1-01, closing CHECK-04 decision 8).
 *
 * Before this plan, five call sites (`verify-enumerate.ts` x2, `verify-derive-recheck.ts` x2,
 * `verify-classify.ts` x1, plus `ingest-archive.ts`'s own comment naming the pattern) each
 * hand-spelled an equivalent-but-independently-maintained regex over these same three words.
 * `verify-enumerate.ts`'s own header comment called itself "the fourth instance in this
 * milestone" of the same near-miss. Phase 178 adds a fourth family (`Example`) — this is the
 * ONLY place that addition should ever need to happen.
 *
 * Order matters for `ANNOTATION_CITATION_RE`/`ANNOTATION_VOCABULARY_RE`'s `.source` byte-equality
 * with the literals they replace (both alternations list `Derived` first, `Visual` second,
 * `Named-but-undefined` third) — changing this order changes those two constants' `.source`
 * strings even though the compiled regexes remain behaviorally identical.
 */
export const ANNOTATION_FAMILIES = Object.freeze(['Derived', 'Visual', 'Named-but-undefined'] as const);

export type AnnotationFamily = (typeof ANNOTATION_FAMILIES)[number];

/**
 * Escapes every regex metacharacter in `s` so it can be embedded literally inside a
 * mechanically-assembled pattern. None of today's three family names contain a metacharacter
 * (the hyphen in `Named-but-undefined` is not special outside a character class), but this keeps
 * the assembly correct for any future family name Phase 178+ adds to `ANNOTATION_FAMILIES`
 * without anyone having to remember to escape it by hand.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The citation-keyed backstop, built mechanically from `ANNOTATION_FAMILIES` — replaces the two
 * independently hand-spelled `ANY_ANNOTATION_LINE_RE` literals in `verify-enumerate.ts` and
 * `verify-derive-recheck.ts`. Matches any of the three family names immediately followed by
 * ` (p.` anywhere in a string (no anchor, no citation-body capture — that shape is
 * `annotationLineStartRe` below).
 *
 * `.source` is pinned byte-equal in `derived-line-pattern.test.ts` to the literal it replaces
 * (`/Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\./i`) — that pin IS the zero-behavior-
 * change proof. Defined as a `const` regex literal produced once at module init: it carries no
 * `g` flag, so it has no `lastIndex` state and is safe to share across every consumer and every
 * call, unlike a stateful global-flag regex would be.
 */
export const ANNOTATION_CITATION_RE = new RegExp(
  ANNOTATION_FAMILIES.map((family) => `${escapeRegExp(family)} \\(p\\.`).join('|'),
  'i',
);

/**
 * The vocabulary-keyed backstop, built mechanically from `ANNOTATION_FAMILIES` — replaces
 * `verify-enumerate.ts`'s independently hand-spelled `ANNOTATION_VOCABULARY_RE`. Deliberately
 * does NOT require a `(p.` citation: it keys on the family word itself at line start, tolerating
 * ANY leading non-alphanumeric decoration (not an enumerated character class — see the history in
 * `verify-enumerate.ts`'s original comment, preserved at that call site). This is what catches a
 * marker-form variant (bare `Derived:`, `(Derived: ...)`) that a citation-keyed check is blind to
 * by construction.
 *
 * `.source` is pinned byte-equal in `derived-line-pattern.test.ts` to the literal it replaces
 * (`/^[^A-Za-z0-9]*(?:Derived|Visual|Named-but-undefined)\b/im`). Defined as a `const` regex
 * literal produced once at module init — no `g` flag, no `lastIndex` state, safe to share.
 */
export const ANNOTATION_VOCABULARY_RE = new RegExp(
  `^[^A-Za-z0-9]*(?:${ANNOTATION_FAMILIES.map((family) => escapeRegExp(family)).join('|')})\\b`,
  'im',
);

/**
 * Factory for the anchored, citation-body-capturing line-start pattern one specific family needs
 * (e.g. `VISUAL_LINE_RE`, `NAMED_BUT_UNDEFINED_LINE_RE` in `verify-derive-recheck.ts`, formerly
 * two more hand-spelled literals). Equivalent to `/^<family> \(p\.[^)]*\)/i` — case-insensitive,
 * tolerates a multi-page citation body (`Derived (p.1, continues on p.2)`).
 *
 * Returns a fresh `RegExp` per call rather than a cached one: callers that need this at module
 * init for several families (as `verify-derive-recheck.ts` does) each get their own instance,
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
 * while never listing `Named-but-undefined` at all — a fundamentally different shape driven by
 * presentation-schema history, not a re-spelling of the family list. `verify-classify.ts` keeps
 * its own literal for that reason; see the comment there.
 */
export const ANNOTATION_CITATION_SOURCES = Object.freeze(
  ANNOTATION_FAMILIES.map((family) => `^${escapeRegExp(family)} \\(p\\.\\d+\\):`),
);
