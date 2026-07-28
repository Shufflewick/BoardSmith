# Source Resolution — Gated Adoption (VERIFY-01, decision 1)

This is the step `verify-game.md` Step 1 delegates to before any staging run is allocated. Its
job is to decide, honestly and without guessing, which archived rulebook this verify pass runs
against — and, when nothing is archived yet, to gate the one live write this whole pipeline
performs behind an explicit designer confirmation.

Determine which of four cases applies by running `boardsmith chunk-provenance-status --json` and
inspecting its `projectProvenanceState` field, then, if needed, listing files at the project
root (`ls`, never a `**/glob` that searches subfolders).

## Case 1 — Already archived: proceed

`rulebook/source/` is present and `chunk-provenance-status --json` reports
`projectProvenanceState: "complete"` (or `"partial"`, which still means an archive exists — only
some chunks' `## Verified Against` blocks predate it). Nothing to adopt. Proceed straight to
`verify-game.md` Step 2.

## Case 2 — Exactly one candidate at root: STOP AND ASK, then adopt

`rulebook/source/` is absent (`chunk-provenance-status --json` reports
`projectProvenanceState: "pre-provenance"`) and exactly ONE candidate source file sits at the
project root (e.g. `rules.pdf`).

**STOP AND ASK the designer once before doing anything.** State plainly why the gate exists: this
is the one live write the entire verify pass performs — it creates `rulebook/source/` and
rewrites `rulebook/INDEX.md`'s provenance header — and per
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Autonomy Scope: How, Never What (PROC-02)"),
acquiring a source-of-truth is the designer's call, never the session's, no matter how
unblocked the rest of this pass could otherwise run.

On confirmation, run:

```
boardsmith ingest-archive <candidate> --project <dir>
```

with **no `--edition` flag.** The repaired command preserves an existing `Edition:` value when
`--edition` is omitted; supplying one here would overwrite the designer's already-recorded text
with nothing to replace it with.

**Then independently re-check `rulebook/INDEX.md` and CONFIRM it now carries a well-formed
`Source hash:` line matching a fresh `shasum -a 256` of the archived file at
`rulebook/source/<candidate>`.** Do not infer that adoption succeeded from `ingest-archive`'s exit
code alone — `ingest-archive` has reported success while silently failing to do its one job before
(`173-CONTEXT.md` decision 1b). If `rulebook/INDEX.md` has no `Source hash:` line, or its value
does not match the archived file's hash, STOP and report it; that is exactly the false-success
failure this independent re-check exists to catch.

**Do NOT use `chunk-provenance-status --json`'s `projectProvenanceState` field for this re-check.**
It answers a different, per-chunk question — whether any chunk in the project has ever had
`chunk-check` run on it — and does not flip away from `"pre-provenance"` when `ingest-archive`
succeeds; only a later, separate `chunk-check` invocation changes it. Checking it here produces a
false STOP on every successful Case-2 adoption, since ordinary `/bs-verify-game` usage never runs
`chunk-check`. `173-PROOF.md`'s wave-1 "Hedge Refutation" section documents this distinction in
full; `computeVerificationScope()`'s own doc comment in `chunk-provenance.ts` is the code-level
source of truth this file mirrors — `Source hash:` presence-and-match is exactly the disk-state
test that function performs.

## Case 3 — Multiple candidates at root: STOP AND ASK, never guess

`rulebook/source/` is absent and MULTIPLE candidate source files sit at the project root.

**STOP AND ASK. Never guess which one is authoritative.** This is
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`'s Cold-Resume Parse Contract rule applied to
an ambiguous root, not just to a malformed state file: on an ambiguous state the session stops and
asks, and never silently picks the most likely candidate. Newest-mtime and largest-file are
guesses wearing results' clothing — a file's timestamp or size says nothing about which document
the designer actually wants verified against, and picking one silently would mean every later
citation in this run is anchored to a rulebook the designer never chose.

## Case 4 — Archived, but the hash no longer matches: record and proceed

An archived source already exists at `rulebook/source/`, but its hash does not match
`rulebook/INDEX.md`'s `Source hash:` line. This is the `source-changed` SIGNAL, not an error —
re-verifying against a new edition of the rulebook is the entire point of this pipeline. Record
the mismatch and PROCEED with the current archived copy. **Never overwrite the archived file on
this signal** — the old archive is what the previous verdict was made against, and overwriting it
destroys the ability to reproduce that verdict.

## Negative case — no candidate anywhere: STOP

`rulebook/source/` is absent and no candidate source file exists at the project root either. STOP
and say so, naming exactly what was looked for (`rulebook/source/`, then the project root) and
where. Source-free operation does not exist yet in this pipeline — do not improvise a degraded
verification mode in its place.
