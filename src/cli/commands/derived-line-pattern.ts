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
