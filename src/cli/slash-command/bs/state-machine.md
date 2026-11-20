# BS Skills — State-Machine Authority Rules

Every `bs-` skill (`bs-ingest-rules`, `bs-build-game`, `bs-build-chunk`, `bs-check-status`, `bs-insert-chunk`, `bs-build-bot`) cites this file rather than restating its rules. If you are authoring or extending a `bs-` skill, link to the relevant section below instead of copying rule text.

## Project Layout — Where Every Path in This Protocol Lives

Every design artifact this protocol names lives under the project's **`design/`** directory:

```
<game>/
  boardsmith.json
  design/
    BRIEF.md  SKETCH.md  DESIGN.md  DECISIONS.md  RULINGS.md  ASSETS.md
    QUESTIONS.md  FILINGS.md  RUN.md
    chunks/<slug>/CHUNK.md
    chunks/<slug>/evidence/      <- committed; every script or capture a claim relies on
    rulebook/INDEX.md  rulebook/NN-*.md  rulebook/source/
  src/  tests/  public/          <- the game itself; never a design artifact
  .boardsmith/scratch/           <- gitignored; every throwaway script goes here
```

`QUESTIONS.md` (every question put to the designer and the answer they gave), `FILINGS.md` (every
BoardSmith bug/library gap found while building), and `RUN.md` (the orchestrated run's journal) are
the three newest of these; the first two are written by any skill that asks a question or hits a
library gap, the third only by `/bs-build-game`. See `orchestrate/questions.md`,
`orchestrate/filings.md`, and `orchestrate/run-state.md`.

**Every path named in these skills — `SKETCH.md`, `RULINGS.md`, `chunks/<slug>/CHUNK.md`,
`rulebook/02-*.md` — is written relative to `design/`.** On disk that means `design/SKETCH.md`,
`design/chunks/<slug>/CHUNK.md`, and so on: prepend `design/` whenever you Read, Write, or `cd` to
one. The paths are design-relative and not project-relative because that is exactly how citations
are written inside CHUNK.md's Build Manifest and `## Interpretation` — one grammar, not two, so a
citation copied out of a doc resolves the same way the `boardsmith` commands resolve it. The
whole rule, which every command applies to every path in a design record: a path naming something
`design/` owns (`rulebook/`, `chunks/`, `run-log/`, a ledger) or climbing out of it (`../src/...`)
is read from `design/`; any other path (`src/...`, `tests/...`, `design/...`) from the project root.
So a file of your own in `design/` (one no skill names, like `design/NOTES.md`) is written with its
`design/` prefix.

**Two places for a script, and the test is whether anything will cite it.**

- **Throwaway scripts go in `.boardsmith/scratch/`, never the project root.** A one-off probe, a
  quick repro you run once and discard, a conversion one-off: anything nobody will point at
  later is written to `.boardsmith/scratch/<name>.mjs`. That directory is gitignored, so scratch
  can never be committed by accident. (It has been: `_dbg.mjs`, `_cap_tmp.mjs` and friends were
  tracked in a real game, which is what issue #6 was filed about.)
- **Evidence goes in `chunks/<slug>/evidence/`, and it is committed.** A measurement harness, a
  playtest driver, a screenshot or recording: anything a ledger entry,
  a CHUNK.md claim, or a sign-off cites as the reason something is true. Write it there from the
  start, or move it there from scratch the moment you decide to cite it, and commit it with the
  chunk. Cite it by that path (`chunks/<slug>/evidence/food-invariant.mjs`), never by a bare file
  name. BoardSmith's own source and docs are cited from the installed package
  (`../node_modules/boardsmith/src/engine/element/game.ts`), which is the copy this project runs,
  and every check reads it there. A path in any other repository is written `<repo>:<path>`
  (`other-game:src/rules/duel.ts`) so it is not read as this game's.
  The design review's screenshots are not evidence: they are deleted when the review ends and no
  ledger entry cites them (`build/design-review.md`).
- **A repro that proves a fix is a regression test, not evidence.** Scripts are split by purpose
  (designer ruling, 2026-10-03, #485). A repro that proves a fix goes in `tests/` with a Spec
  Manifest row (`build/build.md`), where `boardsmith test-step-check` shows it can fail. `evidence/`
  keeps only measurement harnesses among scripts, which are exempt from the Spec Manifest even when
  vitest would collect them. This is the one statement of the split; other steps cite it here.

`boardsmith ledger-check` enforces the split as code, and `build/close.md` runs it before a chunk
closes: every script or capture that `RULINGS.md`, `DECISIONS.md` or a verified CHUNK.md (its
sign-off included) cites must be a committed file in the project. A cited file that is missing,
not yet added, gitignored (anything in scratch) or outside the project fails the close, and so
does a citation of lines (`path:N` or `path:N-M`) the file does not have. A BoardSmith file cited
from the installed package is not in the game's git, so it must be in the installed package, with
the lines cited, instead. That is
the failure this rule exists for: a harness in scratch, cited as the proof behind `verified`,
exists nowhere once the session ends.

**`boardsmith doctor` is the check.** Every `bs-` skill runs `boardsmith doctor` before it does
anything else. It exits non-zero when a design artifact is loose in the project root or a scratch
script has escaped; `boardsmith doctor --fix` moves them into place with `git mv`, never deleting
anything. A project built before this layout existed is migrated by that one command.

## Companion Authority: How Any of This Is Said

This file governs what the pipeline DOES. `reporting.md` governs what the designer READS, and the
two never mix: every enum value, marker, step name, lock grammar, and requirement tag defined below
is internal machinery. None of it belongs in a message to the designer — it gets translated into
what it means for their game (see `reporting.md` "Never in the Body"). A status write and the
sentence announcing it are separate acts with separate rules.

## Status Enum (exact)

The chunk status enum, in order, is exactly:

`proposed` | `approved` | `built` | `verified` | `verified (user-waived)`

- `proposed` — the chunk exists in SKETCH.md but its CHUNK.md has not been approved yet.
- `approved` — the chunk's interpretation is settled at the `ask` step: every rules question answered by the designer, every default recorded in `DECISIONS.md` for their review.
- `built` — the code exists and has passed automated `test`.
- `verified` — the human playtested the chunk and confirmed every item on the verification checklist.
- `verified (user-waived)` — the human explicitly chose to skip playtesting this chunk; recorded honestly rather than silently marked `verified`.

CHUNK-level stale marker (set by `/bs-insert-chunk` when an already-detailed pending CHUNK.md is invalidated by a sketch change):

`stale — re-derive before build`

(NOTE: the dash in `stale — re-derive before build` is an em-dash "—", not a hyphen.)

## Rules Staleness Marker

Rules-staleness is a SECOND, INDEPENDENT axis from the Status Enum above — NOT a new enum value. A `verified` chunk that goes rules-stale stays `verified`: a human really did playtest it, and that fact does not change. What changes is that the rulebook basis it was built and verified against has since moved underneath it. Folding the two together would multiply the Status Enum combinatorially (`built`+stale, `verified`+stale, `verified (user-waived)`+stale) and make every consumer parse a product space instead of two orthogonal facts.

The marker's two values:

`clear` | `rules-stale — rulebook moved since this chunk was verified`

(NOTE: the dash in `rules-stale — rulebook moved since this chunk was verified` is an em-dash "—", not a hyphen — the same convention as the stale marker above.)

It lives in a machine-owned fenced `## Rules Staleness` section in the chunk's own CHUNK.md (see `templates/CHUNK.template.md`), and is reflected as a DERIVED pointer in SKETCH.md's detailed entry (`- Rules Staleness (derived from chunks/<slug>/CHUNK.md): <value>`) — never an independently-decided value there, following the same Authority rule the Status line uses.

`boardsmith verify-impact-apply` is this marker's only writer. Only a successful repair close (see the repair-gating phase that owns re-checking stale chunks) clears it back to `clear` — a verify pass never clears it, and there is no manual clear path.

Distinct from the CHUNK-level stale marker above: `stale — re-derive before build` means "a PENDING chunk's CHUNK.md was invalidated by a sketch change — never built." The rules-staleness marker means the opposite situation: an already-built, already-playtested chunk whose rulebook basis has since moved. Both remain independently recognizable; neither is ever mistaken for the other.

## Step Names (exact, full ceremony)

The 11-step `/bs-build-chunk` pipeline, in order, is exactly:

`investigate, redteam, ask, spec, build, test, audit, repair, playtest, revise, close`

`spec` writes this chunk's executable tests from the ask-approved interpretation and observes them
FAILING before any implementation exists (`build/spec.md`); `build` then makes those exact tests
pass. The two are separate steps, with separate commits, specifically so the red-before-green claim
is auditable from git history rather than taken on faith.

## Step Names (exact, light path — trivial chunks)

Chunks tagged trivial at proposal time (e.g. "swap in the real card images") run the light path instead of the full 11-step ceremony:

`build, test, playtest`

The user is told which path is in effect when a chunk is proposed.

The light path has no `spec` step, and that is what bounds what may be tagged `light`: a chunk may
only be proposed as `light` if it introduces **no new game behavior** — no new action, no new rule,
no change to how an existing rule resolves. Asset swaps, restyles, and copy changes qualify; a
chunk with a rules claim to pin does not, and runs the full ceremony so its claims get tests before
code. If a `light` chunk turns out mid-build to need new behavior, that is a re-proposal (full
ceremony), not something `build` absorbs. A light chunk that writes no test names that in its
`## Spec Manifest` as the one `| exempt | <reason> | n/a |` row (`build/spec.md` "Exemptions"),
written by `build`: that row is what lets its fast checks (`Git Protocol`) pass on typecheck alone.

Light-path status transitions: the light path has no `ask` step, so `approved` is unreachable
for light chunks. A light chunk moves `proposed → built` directly when the user accepts the
proposal (proposal acceptance is the light path's ask-equivalent authorization gate) and
`build` + `test` complete; it then moves `built → verified` (or `verified (user-waived)`)
when the human confirms the playtest checklist. Because the light path has no `close` step,
for light chunks the `playtest` step also performs `close`'s bookkeeping: it records the
verified commit hash in CHUNK.md (the bisect anchor — see Git Protocol), records what the chunk
was verified against (`boardsmith chunk-check <slug>`, writing the machine-owned
`## Verified Against` block), updates the Status line (CHUNK.md first, SKETCH.md second, per
Write Order), rolls up decisions, reconciles the filings/library-gap, asset-debt, and
waived-chunk ledgers against what this chunk changed (SKILLAUTO-08, see `build/close.md`
"Bookkeeping Sequence" item 5), and — as the terminal write — releases the session lock
(`Session Lock: none`, see "Session Lock" above and `build/close.md` "Bookkeeping Sequence").
It then ends the way every close ends, with `build/close.md` "The Done Gate": commit, run
`boardsmith verify --chunk <slug>` for that commit, and `boardsmith verify --check --chunk <slug>`
as the last command.

## Authority

CHUNK.md wins on contradiction. Specifically:

1. **CHUNK.md owns its chunk's status.** It is the single authoritative record of that chunk's state.
2. **SKETCH.md holds only the ordered chunk list and derived pointers.** It never independently decides a chunk's status — it reflects what CHUNK.md says.
3. **On contradiction, CHUNK.md wins.** If SKETCH.md's derived status for a chunk disagrees with that chunk's own CHUNK.md, CHUNK.md is correct. The session logs the contradiction and repairs SKETCH.md to match — it never repairs CHUNK.md to match SKETCH.md.

This is the TMPL-03 authority rule.

## Write Order

- **Write order is always CHUNK.md first, then SKETCH.md second.** Never the reverse, and never SKETCH.md alone.
- Every write must leave the file valid for a cold resume:
  - Round entries (revise rounds, audit rounds) are **append-only** — never overwritten or renumbered.
  - The `Status:` line is updated **last**, after all other content for that write has landed. This means a session that crashes mid-write leaves a file whose `Status:` line still reflects the last fully-completed state, not a half-written one.
- **`close`'s Bookkeeping Sequence is append-only end-to-end, and its lock release is the terminal
  write.** Every CHUNK.md/SKETCH.md write `close` makes (the commit-hash record, the decision
  rollup) is append-only — never a rewrite/overwrite of existing CHUNK.md content — and the very
  last write of the sequence releases the session lock (see "Session Lock" above and
  `build/close.md` "Bookkeeping Sequence"). This is the CHUNK.md-overwrite guard: a close that
  crashes before the release leaves CHUNK.md intact (never half-overwritten) and a resumable lock,
  never a corrupted state file.

## Cold-Resume Parse Contract

Not every state file carries a status. The files that do are CHUNK.md (its authoritative status line) and SKETCH.md (one derived per-chunk pointer per entry); RULINGS.md, DECISIONS.md, DESIGN.md, and ASSETS.md carry no status line at all, and their parse contracts do not require one. Where a status is carried, it lives on one line matching `Status: <enum-value>` (case-sensitive), at the location its template documents:

- CHUNK.md: exactly one authoritative line, `Status: <enum-value>`.
- SKETCH.md detailed entries: `- Status (derived from chunks/<slug>/CHUNK.md): <enum-value>` — the `(derived from ...)` qualifier is what distinguishes a derived pointer from CHUNK.md's authoritative line.
- SKETCH.md tail (sketch-level-only) entries: exactly `- Status: proposed (sketch-level — no CHUNK.md yet)`; when a tail entry is detailed, this line is rewritten to the derived form above.

**If a state file does not parse against its template — required headings missing, malformed, or a `Status:` line that doesn't match a recognized enum value — the session STOPS and asks the user. It never guesses the intended state.**

Where present, the rules-staleness marker (see "Rules Staleness Marker" above) parses against its own two-value set, independently of the `Status:` line — see Consistency Check item 5 below.

This is the TMPL-02 parse-contract rule. "Guessing" includes silently picking the most likely status, silently repairing the file without telling the user, or proceeding as if the file were valid. All of these are prohibited; the only correct behavior on a parse failure is to stop and ask.

## Upgrading State Written Before the Design Session

A project built before the design session existed has state files the parse contracts below no
longer accept. Every `bs-` entry point converts them once, before the consistency check, tells the
designer in a sentence what it converted, and commits the conversion on its own:

- **`SKETCH.md` with `## UI Strategy` and no `## Design Session`:** replace that section with the
  template's `## Design Session` (`templates/SKETCH.template.md`), its status `signed-off` when
  `DESIGN.md` exists and `pending` otherwise. A sketch whose strategy was `autoui-with-cutover`
  keeps its named cutover chunk in the Ordered Chunk List: building it re-lays-out every verified
  surface, so it flips every chunk verified against AutoUI back to `built` ("Restyle Rule").
- **`DESIGN.md` with `## Chosen Direction` and `## Theme Block`:** the designer signed it off at a
  chunk's `ask`, so it stands. Rename `## Chosen Direction` to `## Chosen Design` and
  `## Theme Block (--bsg-* / applyTheme() overrides)` to `## Theme File`, keeping their text; under
  `## Theme File` name where the game's theme lives in code now. Add `## Sign-Off` reading "signed
  off at the first UI chunk's ask, before the design session existed", and an empty
  `## Motion Intents`, which the animation chunk fills, in the template's order.

## Consistency Check (every bs- entry point, before proceeding)

Every `bs-` skill, on entry, runs a consistency check before doing any other work:

1. Every sketch slug with a detailed SKETCH.md entry (one carrying a derived-status pointer,
   `Status (derived from chunks/<slug>/CHUNK.md): ...`) has a corresponding `chunks/<slug>/`
   directory. Tail entries marked `Status: proposed (sketch-level — no CHUNK.md yet)` are
   exempt — by design, ingest details only the next 2-3 chunks and does NOT create stub
   directories for sketch-level tail entries; a tail entry gains its `chunks/<slug>/` directory
   when it is detailed at a close gate.
2. Every `chunks/<slug>/` directory has a corresponding entry in SKETCH.md.
3. All statuses parse against a recognized value: the Status Enum above, the CHUNK-level stale
   marker (`stale — re-derive before build`), or — in SKETCH.md tail entries only — the
   sketch-level marker `proposed (sketch-level — no CHUNK.md yet)`. Any of these three is a
   valid parse; anything else is a parse failure (stop and ask).
4. There is no stale session lock (see Session Lock below).
5. Where a chunk's CHUNK.md carries a `## Rules Staleness` marker (see "Rules Staleness Marker"
   above), it parses against its own two-value set (`clear` |
   `rules-stale — rulebook moved since this chunk was verified`) — separately from item 3's
   Status Enum check, since this marker never touches the `Status:` line. A malformed marker, a
   missing fence, or an unrecognized value here is ALSO a parse failure (stop and ask), exactly
   like item 3.

Any problems found are reported to the user, who confirms how to proceed, before the skill continues.

## Rulings Outrank Rulebook

Every agent that reads a rulebook slice — `investigate`, `redteam`, `audit` — also reads `RULINGS.md`. The rulebook plus `RULINGS.md` together form the composite source of truth. This is what stops an audit agent from "fixing" a deliberate house rule or adaptation back to the printed rule.

**Close-time re-touch (SKILLAUTO-08).** `RULINGS.md` is not a write-once log — it is a shared,
cross-session, per-game store every future chunk's `investigate`/`redteam`/`audit` reads. When a
fix lands during this chunk's work (a `revise` round, a `repair` cycle, or a build-time
correction) that resolves, supersedes, or narrows a ruling already recorded in `RULINGS.md`,
`build/close.md`'s ledger-reconciliation step (Bookkeeping Sequence item 5) re-touches that
ruling entry — updates it to reflect the outcome — rather than leaving `RULINGS.md` describing a
house rule the code no longer actually implements. A ruling entry that silently drifts from what
the code does is exactly the "paperwork lagging the code" failure this re-touch exists to
prevent; the same rulebook-plus-`RULINGS.md` composite-source-of-truth guarantee above only holds
if `RULINGS.md` itself stays current.

## Restyle Rule

Any change that re-styles or re-lays-out previously verified surfaces flips those chunks back to `built`. Changing `DESIGN.md` or the theme file it names (`src/ui/theme.css`) after the design sign-off flips every chunk whose verified surface it re-styles or re-lays-out. There is no AutoUI stage and no cutover: every game builds its own board from the first chunk, in the signed-off design. There is no silent "we'll re-verify later" — the flip happens immediately and is visible in CHUNK.md and SKETCH.md.

## Session Lock

- `SKETCH.md` carries a lightweight session lock note: which chunk is in progress, plus a
  session/chunk identity and a timestamp — the exact grammar lives in
  `templates/SKETCH.template.md`'s `Session Lock:` line and its comment.
- The timestamp is **always** produced by running `date -u +%Y-%m-%dT%H:%M:%SZ` at the moment the
  lock is taken or refreshed. It is never fabricated, estimated, or typed from memory — this is
  the only sanctioned source for the lock's ISO timestamp.
- The lock line carries a **session/chunk identity** — `"<slug> @ <session-id> — locked at <ISO
  timestamp>"` — so a lock unambiguously names both which chunk and which session holds it.
- A second concurrent session, on entry, sees the lock note and **warns the user instead of silently clobbering** the in-progress session's work.
- **Release:** a cleanly-closed chunk's terminal write sets `Session Lock: none` — see
  `build/close.md` "Bookkeeping Sequence", whose final numbered step is exactly this release, and
  this is the terminal write of that sequence. Because a clean close always releases to `none`, a
  later same-day session that resumes a DIFFERENT next chunk finds no live lock at all and does
  not warn — this is the root fix for the same-day false-alarm defect (SKILLDEF-01).
- **The released-value classification rule (180-01 finding 2).** A lock VALUE — the text after
  `Session Lock: ` — classifies as RELEASED, never a live lock, under this exact mechanical test,
  applied in order:
  1. Trim surrounding whitespace.
  2. If the trimmed value is wholly wrapped in one pair of parentheses (starts with `(` and ends
     with `)`), strip that one outer pair before continuing.
  3. Read the LEADING TOKEN: every character from the start up to (not including) the first
     whitespace character, the first em dash (`—`), or the end of the string — whichever comes
     first. An ASCII hyphen (`-`) is NOT a token boundary — chunk slugs routinely contain hyphens
     (e.g. `player-movement`), so a bare hyphen can never be trusted to end a word.
  4. The value is RELEASED if and only if that leading token is exactly the four characters
     `none` (lowercase, case-sensitive — matching this file's case-sensitive `Status:` convention,
     "Cold-Resume Parse Contract" above). Anything else — including a token that merely CONTAINS
     `none` as a substring, or a value where the word `none` appears somewhere other than the
     leading token — is a LOCK, and is classified against the three staleness outcomes below,
     exactly like any other lock.

  This is a byte-level rule, not a semantic one: it exists so a human-written closing annotation
  next to the released marker (commentary about WHY or WHEN a project closed) can never be misread
  as an active lock, while a real lock's `<slug> @ <session-id> — locked at <ISO timestamp>`
  grammar — whose leading token is always the chunk slug, never `none` — can never be misread as
  released.

  - Worked example — bare release: `Session Lock: none` → leading token `none` → **RELEASED**.
  - Worked example — a real shipped project's cleanly-closed value (verbatim, from a game
    built with this pipeline): `Session Lock: (none — final-acceptance closed 2026-07-20; sketch complete except
    bot-opponent, deferred on BSR-12)` → outer parens stripped → leading token `none` (the em dash
    ends the token) → **RELEASED**, despite carrying no parseable ISO timestamp and none of the
    lock grammar below — this parenthetical is commentary, not a lock.
  - Worked example — a real lock: `Session Lock: "movement @ session-f3a1 — locked at
    2026-07-31T14:22:00Z"` → leading token `movement` → **LOCK**, classified against the three
    staleness outcomes below by its timestamp.
  - Worked adversarial example — a none-ISH value that MUST still classify as a lock:
    `Session Lock: "none-the-wiser @ session-ghost — locked at 2026-07-31T00:00:00Z"` → leading
    token `none-the-wiser` (the hyphen is not a boundary, so the whole slug-shaped word is read) —
    this is NOT the exact string `none`, so it is **LOCK**, never released, even though the
    substring `none` appears at its start. A rule that stopped at the first hyphen, or merely
    tested "starts with `none`", would misclassify this as released — this worked example exists
    specifically to pin against that mistake.
- **A parallel batch's lock** (#294, `orchestrate/chunk-dispatch.md` "Parallel Dispatch") names
  every chunk of the batch, comma-separated with no spaces, as its leading token:
  `"trading,quests @ run-7 — locked at <ISO timestamp>"`. A dispatched chunk whose slug is one of
  those names classifies the lock as its own (a same-chunk resume). The lock belongs to the run in
  the main checkout: each chunk's worktree releases only its own copy at close, and
  `boardsmith chunk-merge` keeps the main checkout's lock line when it merges.
- **Staleness criterion** (evaluated by consistency-check item 4, and only ever reached for a
  value the rule above classifies as a LOCK): a lock is **stale** when its
  timestamp is more than 24 hours old — a crashed or abandoned session, not a live one; the
  session reports it and the user confirms clearing it. A lock naming the same chunk the
  entering session is resuming is **not** stale and does not warn — the session refreshes the
  lock's timestamp (a fresh `date -u +%Y-%m-%dT%H:%M:%SZ` read) and continues (this is the
  normal resume path). Any other lock (less than 24 hours old, naming different work) is treated
  as a live concurrent session and triggers the warning above.

## Ledger Numbers on a Parallel Branch

Numbered ledger entries (`### Ruling N`, `### Decision N`, `### Filing N`, `### Question N`, and
`### C<n>` / `### G<n>` in `CONSTRAINTS.md`) are cited by number, so a number must mean one thing.
Built one at a time, a chunk takes the next unused number. Built on a parallel branch
(`orchestrate/chunk-dispatch.md` "Parallel Dispatch"), a chunk cannot know the next number, because
another branch may be taking it at the same moment. So on a parallel branch every new entry gets a
provisional id scoped to the chunk's own slug: `Ruling @<slug>.<n>` (and `Decision @<slug>.<n>`,
`Filing @<slug>.<n>`, `Question @<slug>.<n>`, `C@<slug>.<n>`, `G@<slug>.<n>`), counting from 1 per
ledger, and every citation of it uses that id. `boardsmith chunk-merge` allocates the real numbers
on the combined tree and rewrites every citation. This is enforced as code: `chunk-merge` refuses a
branch that added a real number, `ledger-check` and `constraint-check` treat a provisional id like
any other (a duplicate is a finding), a citation of a provisional id nobody declared stops the
merge, and `ledger-check` run in the main checkout fails any provisional id it finds there, as a
heading or cited in any file of the project, since one can only get there by a merge that skipped
`chunk-merge` or a citation it could not rewrite.

An example id (a reproduction in a filing, a form like `Ruling @<slug>.<n>`) goes in a code span or
a fenced code block. In a Markdown file an id inside a code span, a fenced block or an HTML comment
is quoted text and never a citation: `chunk-merge` neither rewrites it nor asks for an entry headed
with it. Written bare in prose, `Filing @x.1` is a citation, and a citation of an id no entry
declares stops the merge. Inside an HTML block such as `<details>` Markdown is not read, so an id in
backticks or `<code>` there is a citation; quote it in an HTML comment, or in a code span on a line of
its own after a blank line (not inside `<pre>`, `<script>`, `<style>` or `<textarea>`, which end only
at their closing tag).

A citation writes its kind, then its id: `Ruling @<slug>.<n>`. In a list the kind word may be
written once, plural, and every id after it takes that kind: `Rulings 8 and @<slug>.1`,
`Questions @<slug>.14, @<slug>.15 or 16`. A list runs across commas, "and", "or" and "&", and a
new kind word inside it switches the kind. `chunk-merge` rewrites every provisional id in such a
list. A provisional id with no kind before it in its list (`as settled in @<slug>.1`) says nothing
about which ledger it names, so it stops the merge; write the kind in front of it.

A run of one chunk's ids may be shortened after the first: `Decisions @<slug>.1, .2` names
`@<slug>.1` and `@<slug>.2`, and `Rulings @<slug>.1 to .3` is a range (so is `through`, or a dash
right before the next id). `chunk-merge` rewrites each shortened id to its real number. It
rewrites a range only when the ids in it became one unbroken run of numbers; otherwise (an id in
the range has no entry, the entries were headed out of order, or the range starts at a real
number) it stops the merge, and the fix is to write the ids out as a list. It also stops on
shorthand that names no id it can map: a dash then a plain number after a provisional id
(`@<slug>.1-3`), a shortened id straight after a kind word (`Decision .2`), and a shortened id
that a word or a parenthetical separates from its provisional id (`Decision @<slug>.2 supersedes .1`),
which is not in its list, or that follows a constraint letter (`G@<slug>.1 and G.2`); write that id
in full. Only shorthand on a line the branch wrote stops it, so shorthand the main line already had,
even in a file the branch renamed, does not.

## Git Protocol

- Commit at every step completion. Message convention: `chunk-<slug>/step-<name>` (e.g. `chunk-movement/step-build`).
- Revise rounds use `chunk-<slug>/revise-2` (etc.) as the commit message convention.
- Commit **before** `spec` starts, so work-in-progress is always distinguishable from the last verified baseline.
- `chunk-<slug>/step-spec` is the **RED anchor**: failing tests and signature-only stubs, no implementation. `chunk-<slug>/step-build` is GREEN. Never conflate them into one commit — that erases the only durable evidence the tests preceded the code (`build/spec.md` "Git Protocol").
- `close` records the verified commit hash in CHUNK.md — this is the bisect anchor for any later regression and the diff base for "what changed since the human last said yes."
- **The chunk's verify base** is the commit before the chunk's first `chunk-<slug>/` commit: where
  this chunk's work started. Every `boardsmith verify` run for chunk work (`build/test.md`,
  `build/repair.md`, `build/playtest.md`, `build/close.md`) names the chunk, and the command finds
  that commit itself. Run from the chunk's checkout:

  ```bash
  npx boardsmith verify --chunk <slug>
  ```

  That is the chunk's fast checks, and the only verify chunk work runs: the test files the chunk
  added or changed since its verify base, picked by the command itself, and typecheck. A chunk
  that added or changed no test file fails it, unless its Spec Manifest marks it exempt
  (`build/spec.md` "Exemptions"): an exempt chunk passes on typecheck alone. Before `spec`, the
  step that writes the chunk's tests, no test of its own is asked for: while every
  `chunk-<slug>/` commit is `step-investigate`, `step-redteam` or `step-ask`, the chunk passes on
  typecheck alone too (#995). Those steps write only files under `design/`: a
  `step-investigate`, `step-redteam` or `step-ask` commit that changes any other file fails the
  fast checks and chunk-merge, naming the commit and file (#1201). Only commits not yet pushed to
  any remote are checked, since those are the ones still safe to rewrite; in a repository with no
  remote every commit is checked. The full checks (the whole suite, build, validate,
  the smoke test and the verbs check) run once, before the game is published
  (`boardsmith publish` refuses without a full `boardsmith verify` for the commit), not per chunk.

  Never run a bare `boardsmith verify` for chunk work. It runs the full checks, which no chunk
  gate accepts. When `--chunk <slug>` says the chunk has no commit yet, commit its work under the
  `chunk-<slug>/step-<name>` convention first. `chunk-signoff <slug>`, `review-gate <slug>` and
  `verify --check --chunk <slug>` accept only the result `verify --chunk <slug>` made for that
  chunk, so a full result, such as a `npx boardsmith verify --base HEAD` run, satisfies no chunk's
  sign-off.

## Branches and Landing

A game's `main` moves only through the repository's merge, `agent-policy merge`, which checks the
merged tree with what the game's `.agent-policy.json` names (`boardsmith init` writes it, with the
scaffold commit on `main`). No step commits on `main`, and each piece of work lands before the next
piece of work starts, so nothing is built on work that has not landed.

**One plain branch per piece of work**, made from `main` in the main checkout before the piece's
first commit. The designer's session makes it, as soon as it knows the piece is next and before the
piece's first record or dispatch: `git switch -c <branch> main`. Everything the piece commits,
every record about it included, goes on that branch.

| Piece of work | Branch | The record that lands it |
|---------------|--------|--------------------------|
| Kickoff: the rulebook through the approved sketch (`ingest-rules.md`) | `ingest-rules` | `record sketch` (Step 7) |
| The design session (`ingest/design-session.md`) | `design-session` | `record design sign-off` |
| A chunk built in the main checkout, bot and final acceptance included | `chunk-<slug>` | the record of its `closed` return (`build-game.md` Step 4) |
| A parallel batch, named after its first chunk: `chunk-merge` merges each chunk's worktree branch into it | `batch-<slug>` | the record after its last chunk merged and any cross-chunk audit ruled |
| A sketch reshape (`insert-chunk.md`), named after the reshaped chunk | `insert-chunk-<slug>` | the reshape agent's own commit |
| A re-verification (`verify-game.md`), the repairs it dispatches included | `verify-game` | the lock release (Step 9) |

**Landing.** The piece's last record writes everything that falls at that point (its outcomes,
`RUN.md`, the lock), so the agent that writes its last record lands it, from the main checkout:

1. Commit; `git status --porcelain` prints nothing.
2. `agent-policy verify`.
3. `agent-policy merge --summary "<what the piece adds to the game> (<branch>)"`. It lands the
   branch on `main`, pushes `main`, and deletes the branch.

It returns the merge commit, or the refusal word for word. The session never merges a branch by
hand and never patches a refusal; it routes it:

- **A failed check** is a failed dispatch of the piece (`routing.md`): the piece goes back to the
  agent that built it, the `judgement` role's for a chunk, with the refusal, to fix on its branch;
  then the landing runs again.
- **A risk** (`--approve <code>`, such as a first `.agent-policy.json`): put the risks to the
  designer, and once they agree, the session runs the printed command itself.
- **A missing prerequisite** (no `origin` remote, `main` behind it, `agent-policy` not installed):
  stop and give the designer the refusal's own remedy.

**A piece that waits on the designer.** A serial chunk parked at a question while the run builds
other chunks (`build-game.md` Step 4) lands as it stands, by the record that parks it, so the next
branch carries its question and `RUN.md`'s `Open Gate:`. Its commits so far are its `investigate`,
`redteam` and `ask`, which change only `design/`, since only those steps park a chunk. When its
answer comes, it resumes on a new `chunk-<slug>` branch from `main`, made once the piece checked out
then has landed, and the record of the answer is that branch's first record. A chunk of a parallel
batch parked the same way leaves the batch: the batch lands once its other chunks have merged, and
the parked chunk stays in its worktree until its answer comes, then lands through `chunk-merge` as
a batch of one, on a new `batch-<slug>` branch named after it. A run that stops (`orchestrate/run-state.md` "Stop Conditions")
leaves its piece's branch checked out, and the next run resumes on it: on entry, any branch other
than `main` is the piece in progress.

## Repair Loop Bound

- Maximum **3 audit rounds** per chunk.
- Round N+1 auditors see the existing findings ledger (stable IDs) and report **only NEW findings** — they do not re-litigate findings already recorded.
- After round 3, any remaining findings are triaged with the user: real blocker, defer to a later chunk, or auditor was wrong (refuted).
- The rounds follow the role ladder (`routing.md`): a repair runs at the role that last changed the work on its first failure there and one role up on its second, and the triage after round 3 ends the loop wherever the ladder stands. Each later round reviews only the change since the round before (`boardsmith review-gate` reads the round before from the run log).

## Redteam Escalation

- **Refuted once:** re-investigate with the specific objections attached. Maximum **one** re-investigate round.
- **Refuted twice:** that is by definition an ambiguity. Escalate to the user as a plain-language question; the ruling is recorded in `RULINGS.md`.
- Disputes go to the human, never to more agents.
- The re-investigate round runs at `judgement` again, the same role that wrote the claims: the claims' one retry at that role (`routing.md`).

## Autonomy Scope: How, Never What (PROC-02)

Every autonomy behavior this file and `build-chunk.md` describe — run-while-away, auto-advance,
the batched-question queue — governs **HOW** the game gets built: which
step runs next, when a session persists and stops, how open items get queued and surfaced. None of
it EVER governs **WHAT the rules of the game ARE.** Autonomy is a building-process lever, not a
rules-authorship license.

A genuine rules ambiguity — any point where the rulebook plus `RULINGS.md` do not determine the
answer, and (per `build/ask.md`'s Ask Triple-Gate) the choice is load-bearing with no reasonable
default — is always **surfaced** to the user: batched into the open-questions queue and presented
at the next human gate/milestone (see "Batched-question queue" below), or raised immediately if it
blocks the current chunk. It is **never fabricated** — no step, subagent, or orchestrator invents a
rule, guesses at a rules interpretation, or silently decides the rulebook's meaning on the human's
behalf, no matter how much unblocked work there is to keep moving on. This is the same
surface-don't-fabricate boundary the Cold-Resume Parse Contract enforces for state files ("the
session STOPS and asks the user... it never guesses the intended state") and the Redteam Escalation
enforces for adversarially-contested claims ("Disputes go to the human, never to more agents") —
autonomy widens *when* a session keeps going, it never widens *what* it is allowed to decide about
the rules.

## Session Handoff Seams (cold-resume checkpoints, not mandatory stops)

The four step groups are:

1. `{investigate, redteam, ask}`
2. `{spec, build, test}`
3. `{audit, repair}`
4. `{playtest, revise, close}`

Every one of the 11 full-ceremony steps belongs to exactly one group. These group boundaries are
the skill's **cold-resume/persistence checkpoints** — a seam marks where a session's work is
guaranteed durable enough to stop and resume cleanly, NOT a point where the session must hand off.
Each step still persists its own state to `CHUNK.md` before the next starts, and a commit still
lands at every step completion (see "Write Order" and "Git Protocol"). What has changed is the
stopping policy: **a single session now runs continuously across these group boundaries, and the
run carries on across chunk boundaries.** It stops only when (a) it reaches a human-input gate — it needs the user
to answer a question or to test/playtest something — or (b) an automated step hits an unrecoverable or stuck state it
cannot resolve on its own (a gate that keeps failing and `repair` cannot fix, a subagent that dies
on a terminal error, a typecheck that will not go green) — which it surfaces to the user rather than
looping or plowing ahead. Between those points it flows straight through: after `ask` settles the interpretation it
runs `spec → build → test → audit → repair` into `playtest`, where it stops for the human client-playtest
gate ONLY if this chunk is one of the sketch's checkpoint chunks with visible UI (see the `playtest`
bullet below, SKILLAUTO-01) — a non-milestone or UI-less chunk runs its internal `playtest`
verification (test/self-sim) and flows straight through into `revise`/`close` with no human stop.
After a human playtest stop (and any `revise` loop) it runs `close`, stops at close's sketch-tail
delta gate **only if that gate needs approval**, and then returns, and the run goes straight on to
the next chunk (see "Cross-chunk continuation" below).

**The planned blocking checkpoints — the human-input gates that DO stop the session:**

- The **design sign-off** — the design session after sketch approval and before the first chunk
  (`ingest/design-session.md`). No game code is written until the designer signs off.
- The `playtest` human-verification gate — **scoped to the sketch's checkpoint chunks, not every
  chunk** (SKILLAUTO-01). SKETCH.md's `Milestone:` flag (`templates/SKETCH.template.md`'s "## Mandated
  Chunks", set at sketch-derivation time and approved with the sketch — see
  `ingest/sketch-derivation.md`) names them: `core-loop`, the `mid-build` checkpoints, `scoring`
  (game-end/scoring/winner-determination), `animation`, and `final-acceptance`. Only a chunk
  whose `Milestone:` flag is non-`none` AND which has visible UI (its `ui:` tag is `touches` or
  `major`) routes to the human client-playtest stop — the human plays the numbered test script and
  confirms it item-by-item; no subagent can stand in for this, and `boardsmith chunk-signoff`
  refuses an automated sign-off for it. A chunk with no visible UI (`ui: none`) is NEVER routed to a
  human playtest, milestone or not. Every non-milestone chunk keeps all of its internal steps
  unchanged — `test`, `audit`, and its self-playtest/sim pass in `playtest` all still run exactly as
  before — only the *human* client-playtest stop moves off of it; the chunk auto-advances through
  `playtest` into `revise`/`close` without waiting on a human (see "Cross-chunk continuation"
  below). Each blocking playtest opens with the designer's batch review of every decision taken
  since the last one (`build/playtest.md` "Reviewing the Decisions").

**Not a stop: the `ask` step, and a rules question.** The `ask` step settles the interpretation
and records it, with every default it took, in `DECISIONS.md` for the designer's batch review; it
never waits for approval (`build/ask.md`). A **rules question** — the rules themselves, not the
build approach, genuinely undetermined, or a redteam refuted-twice escalation (a claim refuted
twice is by definition an ambiguity, see "Redteam Escalation") — parks only the
chunk that needs the answer: it is put to the designer and recorded in `RULINGS.md` when they
answer, and the work continues on every chunk that does not depend on it. The `/bs-build-game`
run records the chunk in `RUN.md`'s `Open Gate:`
and stops only when every remaining chunk waits on the designer (`boardsmith next-chunk`,
`build-game.md` Step 3).

**The rare stops:**

- A **repair round-3 triage** — after 3 audit rounds any remaining findings are triaged with the
  user: real blocker, defer, or refuted (see "Repair Loop Bound").
- Any step that has failed twice at the `judgement` role, the top of the ladder (`routing.md`):
  the user is told what failed and what was tried, and nothing more is dispatched for it until
  they answer.
- The `close` sketch-tail delta approval gate — the user explicitly approves the tail's delta
  before SKETCH.md's `## Ordered Chunk List` is rewritten (never a silent rewrite).

Between these gates the session continues automatically across seams — it does not hand off after
each group. `close` belongs to group 4: the same session that runs the human playtest gate (and its
revise loop — `revise-1`, `revise-2`, … appended as needed until every this-chunk-defect item has a
recorded disposition) also closes the chunk — marking it verified, recording the verified commit
hash, and rolling up decisions. The group name's `revise` denotes that whole loop, not a hard cap
of one revision.

**Batched-question queue (SKILLAUTO-03 — the GSD-autonomous model).** Not every open item is a
human-input gate. An item that clears `build/ask.md`'s ask triple-gate (SKILLAUTO-02 —
genuinely undetermined AND load-bearing AND no reasonable default) but does not block THIS
chunk's own progress — because it concerns a later chunk, or a cross-cutting design choice this
chunk doesn't need settled to proceed — is appended to an open-questions queue instead of
stopping the session. **Unblocked work continues**: the session keeps building whatever chunks
and steps do not depend on the queued item's answer, exactly as it would if the item didn't
exist. The queue is not read one item at a time as it accrues; instead the whole batch **surfaces
at the next human gate/milestone** — the next blocking checkpoint `playtest` stop, or `close`'s
sketch-tail delta gate, whichever comes first — presented together rather than as a string of
one-off interruptions. This is distinct from a **blocking** rules question: one this chunk's own
design cannot proceed without parks that chunk at its `ask` (`build/ask.md` "Parking the Chunk on a
Rules Question"); it is never queued past the chunk that needs it answered.

**Cross-chunk continuation (the chunk→chunk seam) — run-while-away + auto-advance (SKILLAUTO-04/
05).** The boundary between one chunk's `close` and the next chunk's `investigate` is a seam the
run flows across, exactly like the four intra-chunk group boundaries — it is NOT a run terminus.
When `close` finishes (its bookkeeping written, its sketch-tail delta gate resolved — approved if
there was a delta, silently skipped if there was none), the dispatched session returns
`outcome: closed`, and the `/bs-build-game` run's loop dispatches the next chunk into its own fresh
subagent of the `judgement` role (`build-game.md` Step 3) rather than stopping to tell the designer to re-invoke. If
neither stop condition (a)/(b) above applies and the designer has not said stop, the run
**auto-advances**: the pipeline keeps making progress on reasonable defaults, bounded only by the
planned checkpoints (SKILLAUTO-01's checkpoint chunks), a genuine rules question that leaves
nothing else to build, and the stuck-state condition above — this is the run-while-away model the
designer being away does not pause. Auto-advance is not limited to ordinary chunk-to-chunk
continuation: it carries into the next LOGICAL step across chunk types, including the
**generate-bot → final-acceptance** progression — once a sketch's `bs-build-bot` chunk closes, the
run dispatches the final-acceptance chunk that follows it exactly as it would any other next chunk.
A `/clear` or a crash is resumed by re-invoking `/bs-build-game`, which picks up at the first
incomplete step (`orchestrate/run-state.md`).

**The ingest→build seam is a continuation seam too.** `/bs-ingest-rules` Step 7 writing `SKETCH.md`
and the first `CHUNK.md` files is the same kind of boundary as `close`→next chunk: durable, and NOT
a session terminus. The ingest session auto-advances into the build — by default the whole-game run
(`/bs-build-game`, see "Orchestrated Runs" below), which opens with the design session and then
dispatches the first chunk's `/bs-build-chunk` work — and stops at the design sign-off, the run's
first human gate, subject to the identical (a)/(b) stop conditions. See `ingest-rules.md` "Step 8: Continue Into the Build".

**There is no context stop.** A session never winds down, wraps up, or suggests a `/clear` because
its context "feels" full: a model cannot read its own context usage reliably, the harness compacts
context on its own, and every chunk of an orchestrated run gets a fresh subagent. What a `/clear`
or a crash costs is bounded by the per-step saves above, not by a context budget: each step
persists to `CHUNK.md` and commits before the next starts, so a re-invocation resumes at the first
incomplete step.

**Sub-agent offload keeps the main thread lean.** Heavy work classes — research, audits, large reads, and
repairs — are dispatched to sub-agents rather than performed inline by the orchestrator (each as the role `routing.md` gives it: research at the `judgement` role, audits at the `judgement` and `review` roles, large reads at the `mechanical` role, repairs at the role whose work failed, one role up after a second failure there), so the
main thread's own context fills slowly across a long autonomous run instead of spiking on any one
step. This is the same mechanism `build-chunk.md`'s Context-Economics Hard Rule already codifies
("the orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself") —
that rule is what makes sub-agent offload possible in the first place, and it is preserved here
unchanged: the orchestrator reads structured return-shapes and chunk state, never the big stuff
behind them.

**Final-acceptance chunk exception.** The sketch's one mandated final-acceptance chunk (`templates/SKETCH.template.md` "## Mandated Chunks") has a fixed 4-item Step Checklist `[final-acceptance, playtest, revise, close]` (`build-chunk.md` "Final-acceptance chunk target"). Its leading `final-acceptance` content step — a coverage check plus a 7-point design-QA pass with a fresh-context agent dispatch and two human-narrated checks — is by far the heaviest single step in the skill. The seam between `final-acceptance` and `playtest` is therefore a first-class **resume checkpoint**: because that content step is so heavy it is the most likely place a crash or a `/clear` lands, and its sub-parts persist individually so a resume re-enters mid-pass rather than re-running the whole step. It is NOT a mandatory auto-stop — the same session flows from `final-acceptance` straight into the `{playtest, revise, close}` group and stops at the human `playtest` gate that follows, exactly like any other chunk. See `build/final-acceptance.md` "Sub-Step Resumability and the Handoff Seam Before `playtest`" for the sub-part persistence that keeps a mid-pass crash resumable.

## Orchestrated Runs (`/bs-build-game`)

Everything above describes one session running the pipeline. `/bs-build-game` adds one level above
that: a **run** that builds many chunks by dispatching each into its own fresh subagent
(`orchestrate/chunk-dispatch.md`). Every chunk is built this way: a designer typing
`/bs-build-chunk` is handed to the run (`build-chunk.md` "Typed by the Designer"). Three rules
govern the seam between the run and a dispatched chunk:

1. **Orchestrated mode is declared, never inferred.** A subagent is told, in its brief, that it is
   running in orchestrated mode for exactly one named chunk, builds that one chunk, and returns. A
   session that was not told this is the designer's, and builds nothing itself.
2. **A dispatched subagent has no designer.** It never asks a question, never waits for approval,
   and never assumes approval — it stops at a human gate (a rules question, a checkpoint playtest,
   a triage) and returns the gate's own text for the orchestrator to put to the designer.
   Gate-before-write is unchanged: no ruling and no verified checklist until a later dispatch
   arrives carrying the designer's actual answer. Only *who relays* the answer changes, never *who decides* it (the same "How, Never What"
   boundary "Autonomy Scope" above draws).
3. **The run journal is not an authority.** `RUN.md` records which gate is open, why a run stopped,
   and how many passes a chunk took. Chunk status still lives in `CHUNK.md` with `SKETCH.md`'s
   derived pointer, and on any disagreement `CHUNK.md` wins and `RUN.md` is repaired to match — the
   same "Authority" rule this file applies to `SKETCH.md`.

The batched-question queue gets a durable home under a run: an open question is a `QUESTIONS.md`
entry whose answer is still pending, and a settled one is never re-asked because every dispatch
carries the settled answers with it (`orchestrate/questions.md`). A library gap is still FILED and
never patched (`build/build.md` "Boundaries"), and a run additionally offers to report it upstream
(`orchestrate/filings.md`).
