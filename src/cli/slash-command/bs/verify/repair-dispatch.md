# Repair Dispatch (CHECK-02) — Routing Stale Chunks Into the Existing Audit/Repair Loop

This is `verify-game.md`'s delegate for CHECK-02. By the time this file runs, Step 4's
`verify/adjudication-gate.md` has already written the rules-staleness marker and the impact map
(`boardsmith verify-impact-status --json`); this file consumes that map's `stale === true`
entries and routes each one, in turn, into `build/audit.md`'s three lenses and
`build/repair.md`'s bounded loop — **the SAME audit lenses and the SAME loop the build pipeline
already trusts, reused by reference, never forked.**

## Why by reference, not by copy

`build/audit.md`'s three lens templates and `build/repair.md`'s bounded loop are cited here
**by pointer** — `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md` and
`${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md` — the same "delegates by reference, never
copies the prose" discipline `verify/classification-dispatch.md` and `verify/staging-dispatch.md`
already hold for `ingest/transcription-subagent.md`. **This file must not paste, restate,
paraphrase, or reword any lens template body or any repair-loop prose.** A forked lens is a lens
that can drift from the pipeline this phase's own goal says it must stay identical to — the exact
discipline Phase 173 held for the transcription subagent contract ("it is never forked here").
Any verify-specific framing sentence belongs HERE, in this orchestration file, never injected
into a lens prompt itself — injecting framing into the template text is the precise anti-pattern
this reuse rule forbids.

## 1. Select the stale chunks (decision 5)

Only chunks the impact map marks `stale === true` are dispatched into this loop — never every
chunk, and never a chunk this phase re-derives staleness for on its own. Phase 175's impact map
already did that work; consuming a broader set here would discard the scoping Phase 175 bought.

## 2. Resolve the fresh staged slice paths (decision 9) — never live

For each stale chunk, resolve its fresh STAGED slice paths — the run's own re-transcription, not
the live `rulebook/` slices the chunk originally cited. Auditing against the live slices would
re-check the code against the very text this verify pass just called into question. If the fresh
transcription is unavailable for a chunk, report SCOPE-LIMITED following PROV-02's pattern —
there is no fallback to live slices, silent or otherwise (decision 10).

## 3. Dispatch the three lenses by reference, plus the 4th where the build rule already says to

Dispatch `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md`'s three lens templates — fidelity,
visibility, undo — each as its own separate fresh-context dispatch, exactly as `build/audit.md`
already specifies. **The only substitution points across all three templates are:**

- `{gameName}`
- `{slug}`
- `{slicePaths}` — bound to this chunk's FRESH STAGED paths from Step 2 above, never the live
  paths a build-time audit would have used (decision 9). Nothing else in the templates changes:
  every other word in all three templates is fixed prose, reused unchanged (decision 6).
- `{codeFilePaths}`
- `{visibilityDeclarationText}` — visibility lens only.

For `ui: touches|major` chunks, dispatch the 4th (design-review) lens exactly as `build/audit.md`
already specifies — no new verify-side policy in either direction (decision 7). Its findings land
in the same `## Findings Ledger` as the three lenses above, through this orchestrator, never a
separate track.

**`## Interpretation` remains absolutely forbidden to every lens dispatched here, per
`build/audit.md`'s own no-framing rule — restated as MORE important for a rules-stale chunk, not
less (decision 11).** A stale chunk's `## Interpretation` was written by `investigate`/`redteam`
against rules that have since MOVED — if a lens read it, it would inherit an interpretation
error grounded in a rulebook state that no longer exists, and audit is the one place left in the
pipeline that can still catch an interpretation error at all. Do not read `## Interpretation` to
"save time" understanding the chunk before dispatching lenses; the lenses read the raw fresh
slices and `RULINGS.md` directly, exactly as `build/audit.md` requires for a build-time audit.

## 4. Persist the round, then dispatch repair — both by reference

Follow `build/audit.md`'s "Persisting the Round — Write to the Findings Ledger BEFORE Repair
Starts" exactly: append this round's `### Audit Round N` entry before repair begins, and follow
its cold-resume rule for a partial or missing current-round entry. Then dispatch
`${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md`'s bounded loop exactly as written — the two
repair actions (fix, refute-with-citation), the three terminal dispositions
(`fixed`/`deferred`/`refuted`), and `build/repair.md`'s own round-3 user triage with its three
plain-language options. Cite `build/repair.md`'s "Repair Loop Bound" section for the round-count
policy itself — this file states only that a fresh budget applies per verify-episode (below), it
does not restate the bound's own governing sentence as a second policy statement of its own.

## 5. The round bound is per-verify-episode, not per-chunk-lifetime (decision 17)

Each verify pass opens a **fresh 3-round budget** for a chunk, appended AFTER that chunk's
existing rounds — never renumbering history. `state-machine.md` "Write Order" is the authority
for round entries being append-only across a chunk's whole life; this file applies that rule to
a new kind of round (a verify episode's), it does not re-derive the rule itself.

**Why this matters concretely, not abstractly:** four of the real stale chunks in this
milestone's own reference games — `best-seven-selection`, `table-and-draw`, `block`, `jab` —
already carry exactly 3 recorded `### Audit Round` entries from their original build. Under a
per-chunk-lifetime reading of the round bound, all four would receive zero lens dispatches and
route straight to round-3 triage on arrival here — CHECK-02 would be permanently unavailable to
exactly the chunks with the most audit history, and that fraction only grows as chunks mature.
The bound is a loop guard against one session's audit/repair cycling forever, not a lifetime
quota; a chunk re-checked against a changed rulebook is a new question, not a continuation of the
old one. A reader of CHUNK.md must still be able to tell which rounds belong to which episode —
the episode boundary is a counting rule, not a license to blur a verify round into the build's
own round sequence.

## 6. Re-derive the repair gate AFTER the loop closes — never Step 4's snapshot (decision 12)

Once every finding across this chunk's verify-episode rounds has a disposition and no round
remains open, re-derive the repair-gate disposition from freshly re-checked post-repair code
state — never reuse the pre-repair `ImpactMapEntry.gate` Step 4 already computed. **Repair MAY
change code, and that changes the gate's answer:** a chunk whose code changed during repair
re-opens the human playtest gate (`reopen-playtest`); a chunk that passes the lenses with no code
change closes without re-playtesting (`close-without-replaytest`). State this seam plainly rather
than leaving it implicit — it is exactly the linkage between this phase and Phase 175's VERIFY-06
gate, and treating Step 4's snapshot as still authoritative after repair has run would silently
misreport a chunk whose code moved as already-clean.

## 7. Scope-limited and report-don't-fix, restated for this step

If a chunk's fresh transcription is unavailable, this step reports SCOPE-LIMITED for that chunk
and moves on — it never substitutes a live slice (decision 10). This step records findings and
repair dispositions on the chunk it is dispatched for; it never fixes reference-game content
outside that chunk's own code, and never edits a ruling — reporting is the boundary Phase 172
held and this file holds again (decision 16).

## Reference

Cite, never restate: `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md` (the three lens templates,
the 4th-lens rule, the no-`## Interpretation` rule, the persist-before-repair and cold-resume
rules), `${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md` (the two repair actions, the three
terminal dispositions, the round-3 triage), and
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Write Order" and "Repair Loop Bound". This
file adds no new lens content and no new repair-loop mechanic of its own — it is the route that
binds a stale chunk's staged paths into the pipeline those three files already define.
