# Close — Bookkeeping + Sketch-Tail Delta Gate (BUILD-11)

Referenced by `build-chunk.md` Step 10 (`close`, third and last of the
`{playtest, revise, close}` session step group — see `state-machine.md` "Session Handoff Seams"). This is the
step that leaves a durable, git-anchored, resumable trail behind a just-verified chunk, and
re-derives the sketch tail as a reviewable delta rather than a silent rewrite. Runs immediately
after `playtest` (and any `revise` round it triggered) confirms `Status: verified` (or `verified
(user-waived)`) on CHUNK.md.

## Inputs

CHUNK.md's `Status:` line (already `verified` or `verified (user-waived)` from `playtest`), its
`## Revision Rounds` section (if a revise round ran), and SKETCH.md's `## Ordered Chunk List`
tail entries beyond the chunk that just closed. The orchestrator reads these directly — the
sanctioned state-file read defined in `build-chunk.md`'s Context-Economics Hard Rule — it does
not re-open the rulebook slices behind the chunk's own claims (those were settled at `ask`).

## Bookkeeping Sequence

A self-contained numbered sequence. `playtest.md`'s light-path close-bookkeeping note cites this
section BY NAME — a light-path chunk (`build, test, playtest`, no `close` step of its own) runs
this exact sequence from inside its own `playtest` step, on this chunk's behalf, once its
Verified Checklist is confirmed.

The light path reuses **only** this six-item sequence. It does NOT run the `## Sketch-Tail
Delta Gate` or `## Propose the Next Chunk` sections below — both are user-gated duties of a full
`close`. A light-path chunk therefore defers sketch-tail re-derivation and the next-chunk
proposal to `build-chunk.md` Step 2's lazy tail-entry detailing (which derives any undetailed
tail entry when routing next reaches it) or to the next full chunk's `close`; it never silently
details the tail from inside `playtest`. This matches `state-machine.md` "Step Names (exact, light
path — trivial chunks)", which lists exactly these six light-path bookkeeping items (status
already landed, commit hash, provenance record, decision rollup, ledger reconciliation, lock
release) and no tail detailing.

1. **Status already landed; this step's own duty starts after.** `playtest` already wrote
   `Status: verified` (or `verified (user-waived)`) to CHUNK.md and mirrored the derived pointer
   to SKETCH.md — CHUNK.md first, then SKETCH.md second, cite `state-machine.md` "Write Order".
   `close` does not repeat that write; its own bookkeeping starts at step 2 below.

2. **Record the verified commit hash.** Run:

   ```bash
   git rev-parse HEAD
   ```

   and write the literal hash into CHUNK.md's `## Verified Commit Hash` section
   (`templates/CHUNK.template.md`). Cite `state-machine.md` "Git Protocol" for why this hash
   matters — the bisect anchor for any later regression and the diff base for "what changed
   since the human last said yes" — and for the `chunk-<slug>/step-<name>` commit convention this
   hash sits alongside. Do not restate that rationale or that format in new words here; cite it
   by name.

3. **Record what this chunk was verified against.** Run `boardsmith chunk-check <slug>`. It
   computes the verification scope, resolves this chunk's cited slices, and writes the
   machine-owned `## Verified Against` block. A NON-ZERO exit means it had to write or repair the
   block: re-read `chunks/<slug>/CHUNK.md` (the copy in context is stale) and re-run the command,
   which will then pass. Do not hand-author anything between the block's fences — that section is
   written by this command and by nothing else.

4. **Roll up decisions.** Append this chunk's settled house-rule/adaptation choices and any
   revise-round resolutions into `DECISIONS.md`'s append-only ledger, one entry per decision, so
   a future session (or `/bs-check-status`) can see what this chunk actually settled without
   re-reading its whole CHUNK.md.

5. **Reconcile the paperwork ledgers (SKILLAUTO-08).** Before the lock is released, audit the
   paperwork, not just the code: reconcile, against what this chunk actually changed, the three
   ledgers this pipeline keeps —
   - the **filings / library-gap ledger** — `build/build.md` "Boundaries" `## 3` (a library gap is
     FILED, never patched) — did this chunk file any new gap, and does an EARLIER filing this
     chunk's own fix touched still read accurately?
   - the **asset-debt ledger** — `check-status.md` item 5, "Outstanding asset debts" (reads
     `ASSETS.md`'s `## Ledger`) — did this chunk receive an asset that was previously a debt row?
   - the **waived-chunk ledger** — `check-status.md` item 4, "Waived verifications" — did this
     chunk's own work (a fix, a revise round) touch a chunk that is still `verified (user-waived)`
     and now deserves a real playtest instead of remaining waived?

   These three ledgers are exactly the ones `check-status.md` surfaces (cite it by name, do not
   re-derive the scan logic here — `check-status.md` remains the single read-only reader of
   `ASSETS.md`'s `## Ledger` and the `## Ordered Chunk List` waived scan). This step's job is
   narrower and different from `check-status.md`'s: it is not a report, it is the point where a
   fix this chunk landed **re-touches** the filing or ruling it resolved or advanced — mark a
   closed library-gap filing resolved, update an advanced one, and do not leave the paperwork
   stale once the code that made it stale has already landed. If nothing this chunk did changes
   any of the three ledgers, record that explicitly ("no ledger changes this chunk") rather than
   omitting the step — a reconciliation that never appears is indistinguishable from one that
   never ran.

6. **Release the lock.** The FINAL write of this Bookkeeping Sequence: set SKETCH.md's
   `Session Lock:` line back to `Session Lock: none` (`templates/SKETCH.template.md`), so a
   cleanly-closed chunk leaves NO live lock behind — cite `state-machine.md` "Session Lock" for
   the release semantics. This release is the terminal write of the sequence: every
   CHUNK.md/SKETCH.md write above (the Status write already landed by `playtest`, the commit hash,
   the decision rollup, the ledger reconciliation) is append-only — never a rewrite/overwrite of
   existing CHUNK.md content, cite `state-machine.md` "Write Order" — and the lock release is the
   last thing written. Because this section is reused BY NAME from `playtest.md`'s light path (see
   above), the light path runs this release too: a verified terminal chunk closed on the light
   path also ends with `Session Lock: none`.

## Sketch-Tail Delta Gate

Modeled on `build/ask.md`'s fixed-format rigidity (`ask.md` "The Fixed 4-Part Presentation
Format" — same negotiate-then-gate posture, applied here to the sketch tail instead of a single
chunk's design). Now this chunk's citations are settled, re-derive the next 2-3 sketch-level tail
entries in SKETCH.md's `## Ordered Chunk List` against the rulebook, and present ONLY the
**delta** — entries changed, split, merged, or newly detailed — never the full tail restated as
if nothing were already there. This is never a silent rewrite: SKETCH.md's tail is not
overwritten until the user has explicitly approved the delta presented below.

Present each changed entry in this fixed named structure — pin the structure so a future drift
test can verify it byte-for-byte:

```
before: <the tail entry as it read before this chunk closed>
after:  <the tail entry as it would read now>
why:    <the one-line reason this chunk's outcome changed the tail>
```

For example:

> before: "Chunk 'auction': players may bid on declined properties."
> after: "Chunk 'auction-basic': players may bid on declined properties. Chunk
> 'auction-improvements': players may add houses/hotels mid-auction."
> why: this chunk's rulebook citations revealed the auction and the improvements rule are
> independently testable and shouldn't ship as one chunk.

An entry with no change is simply omitted from this presentation — only the delta is shown, per
the "never a silent rewrite" rule above.

**Gate it exactly like `ask.md`:** present the delta, require the user's explicit approval, and
only after that explicit yes write SKETCH.md's `## Ordered Chunk List` to match. Presenting is not
approving; do not write anything durable to SKETCH.md's tail until the user has said yes. If the
user pushes back on the delta, negotiate the same way `ask.md`'s Gate-Before-Write does — their
answer wins unless a hard rulebook dependency is violated, in which case name the dependency
concretely and propose the minimal resolution.

## Chunk-Complete Line (SKILLAUTO-07)

Immediately after this chunk's `Status` is written `verified` (or `verified (user-waived)`) and
before the next-chunk proposal below, emit a single **lighter, chunk-level completion line** —
distinct from the loud game-level banner `build/final-acceptance.md` "Game-Complete Banner +
Summary Card" emits only once, at the game's own terminus. This line is one-per-chunk, every
chunk, plain narration rather than a delimited block:

`chunk '<slug>' complete — verified` (or `— verified (user-waived)` for a waived chunk)

This line does not itself stop the session or wait for acknowledgment — it is purely a progress
marker inside the same auto-advance narration this file's "Then auto-advance" section already
produces; the auto-advance framing below governs whether the session continues, this line does
not change that.

## Propose the Next Chunk

Once the delta is approved and written, propose the next chunk in the (possibly newly-updated)
Ordered Chunk List, naming its `ui:` tag (`none | touches | major`) so the user knows up front
whether the a11y floor and design-review lens will apply to it. Print the exact next command for
a non-programmer handoff — e.g. "Run `/bs-build-chunk` again to start the next chunk,
`auction-basic` (ui: touches)."

**`close` does NOT create the next chunk's `chunks/<slug>/CHUNK.md`.** Proposing the next chunk
names it and prints the command; it never derives that chunk's CHUNK.md. CHUNK.md creation is
always lazy — `build-chunk.md` Step 2's "Sketch-level tail-entry target" path details an
undetailed tail entry when routing first reaches it, on the next `/bs-build-chunk` run. This is
the reconciled close-gate duty (146-REVIEW WR-02): `build-chunk.md` Step 2 owns detailing; `close`
owns only tail *description* re-derivation (the `## Sketch-Tail Delta Gate` above) and the
next-chunk proposal.

**Then auto-advance — the printed command is a crash fallback, never the default (cross-chunk
continuation, SKILLAUTO-04/05).** Proposing the next chunk and printing its command is never the
default end-of-close signal — the residual print-and-hand-off stop is retired. Per
`state-machine.md` "Session Handoff Seams" → "Cross-chunk continuation", once the delta gate is
resolved the same session **auto-advances**: it rolls straight into the next chunk, re-entering
`build-chunk.md` Step 2, routing to the next chunk's `investigate` (Step 2 lazily details its tail
entry first), and running `investigate → redteam` continuously, stopping at that chunk's `ask`
gate (or, for a light-path next chunk, its `playtest` gate; or, for the mandated final-acceptance
chunk, dispatch `build/final-acceptance.md`; or, when the sketch's next mandated step is
`bs-generate-ai`, auto-advance carries the same way into that chunk and on into the
final-acceptance chunk that follows it — the generate-AI → final-acceptance progression is one
continuous run, not two separately re-invoked sessions). The printed command exists **only** as
the cold-resume/crash fallback for the case where a stop condition *does* fire at this boundary —
the user said stop, context has crossed the 60% low-water mark, or an automated step is
stuck/unrecoverable. It is never the default end-of-close signal: presenting the proposal lets the
user see the next chunk (and say "stop") before its first gate, but silence means auto-advance, not
a wait for re-invocation.

## Downstream Shape (cite, never restate)

Once the delta is approved and the next chunk is proposed, this chunk's lifecycle is complete —
its `Status` is `verified` (or `verified (user-waived)`), its `## Verified Commit Hash` is set,
and SKETCH.md reflects the (possibly updated) tail. By default **the same session auto-advances**
into a fresh `{investigate, redteam, ask}` group for the proposed chunk (`state-machine.md`
"Session Handoff Seams" → "Cross-chunk continuation"), stopping at its `ask` gate — or, if the
sketch's `## Mandated Chunks` final-acceptance chunk is next, dispatches `build/final-acceptance.md`
instead — carrying the same auto-advance through a `bs-generate-ai` chunk into the
final-acceptance chunk that follows it. Only when a stop condition fires at the chunk boundary does
the printed command's cold-resume/crash fallback come into play, picked up by a fresh
`/bs-build-chunk` invocation. This file does not restate either downstream shape.
