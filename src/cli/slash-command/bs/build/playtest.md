# Playtest — The Human-Verification Gate (BUILD-09)

Referenced by `build-chunk.md` Step 9 (`playtest`, first of the `{playtest, revise, close}`
session step group — see `state-machine.md` "Session Handoff Seams"). For a **milestone chunk
with visible UI**, this is the human-verification boundary: the point where the chunk's actual,
running behavior is confirmed by a human playing it, not just described. This step has **no
subagent** — the orchestrator narrates the numbered test script to the human directly, in the
main session, and records their answers itself; it never dispatches a Task-tool agent for this
step. Mirrors `build/ask.md`'s no-subagent shape exactly, not `build/redteam.md`'s or
`build/audit.md`'s Dispatch Template pattern — playtest has no dispatch prompt of its own.

## Milestone/UI Gate (SKILLAUTO-01)

The human client-playtest stop below — "The Numbered Click-By-Click Test Script" through "The
Verified Gate" — runs ONLY when BOTH are true for this chunk:

1. Its SKETCH.md entry's `Milestone:` flag (`templates/SKETCH.template.md`, set at
   sketch-derivation time — see `ingest/sketch-derivation.md`) is one of the three milestone
   values: `core-loop`, `scoring`, `final-acceptance`.
2. Its `ui:` tag is `touches` or `major` — a chunk with no visible UI (`ui: none`) is never
   routed to a human playtest, milestone or not.

`state-machine.md`'s "Human-input gates that DO stop the session" is the authority for this
scoping; this file implements it. When either condition is false, this step's human stop is
skipped entirely — but its content is NOT skipped: `build/test.md`'s random-sim/self-playtest
pass already exercised the chunk's new behavior at `test`, and that automated result is what
`Status: built → verified` relies on for a non-milestone or UI-less chunk. Write
`Status: verified` to CHUNK.md (citing the automated test/sim pass that stands in for a human
playtest here — never silently reuse the `verified` wording used for a human-confirmed chunk
without this citation), update SKETCH.md's derived-status pointer to match (CHUNK.md first, then
SKETCH.md second — "Write Order"), and flow straight through to `close`/the next chunk per
`state-machine.md` "Session Handoff Seams" — no session stop here. A genuine rules-adjudication /
open-question escalation discovered during this chunk's work is the one exception: it always
stops the session regardless of milestone/UI status (see `state-machine.md`'s human-gate list).

The remainder of this file (numbered script, Verified Gate, etc.) describes the milestone-chunk
path — read it as conditioned on the gate above.

## The User Owns the Server

This chunk's `build`/`test` steps already completed; `Status: built` is on CHUNK.md. Playtest
hands the user ONE command they run themselves — `npx boardsmith dev` — plus the URL it prints,
and nothing more. The skill never starts, stops, or otherwise controls that server; it is not
a Task-tool-dispatched process, it is the user's own terminal session for as long as they want
to keep playing. If the orchestrator needs a dev server for any other step (e.g. an audit or
design-review agent's automated capture), that server is a separate, agent-owned process that
was already started and killed before this step began — this step never touches it.

## Inputs

The orchestrator reads CHUNK.md's `## Build Manifest` (the file-by-file record `build/build.md`
wrote) and the prior chunk's still-open regression items (its own `## Playtest Test Script`
regression-check line, if this is not the first chunk) directly — the sanctioned state-file read
defined in `build-chunk.md`'s Context-Economics Hard Rule. There is no Dispatch Template here and
no fresh-context agent to seed: the orchestrator that ran `build`/`test` for this chunk is the
same orchestrator that presents this script, in the same session or a resumed one.

## The Numbered Click-By-Click Test Script

This is the designer's main gate, so `reporting.md`'s "lead with the ask" applies literally: the
message opens by naming the one thing they're being asked to do — play this and tell me if it
looks right — then what changed since they last played, then the script. What was built, tested,
audited, and recorded to get here is not part of that message.

Fill CHUNK.template.md's `## Playtest Test Script` section — cite its shape, do not redefine it.
State the seat count explicitly, then give per-seat numbered steps, each ending in an
observable, outcome-based "expect:" clause (describe what should be observed, not just what to
click):

> 1. As seat 1, click the top card of the draw pile. — expect: a new card appears in your hand
>    and the draw pile's count decreases by one.
> 2. As seat 2, ask seat 1 for a rank. — expect: seat 1 sees your request and either hands over
>    a matching card or says "go fish."

**Dev-host affordances, taught once.** Teach the dev-host affordances the human needs at the top
of the script, in one place, not repeated per numbered step — the literal commands available:

```
npx boardsmith dev                    # opens your browser, seats you as seat 1
npx boardsmith dev --players <count>  # states the seat count for this chunk; open one more
                                       # browser tab per additional seat
npx boardsmith dev --ai 1,2           # AI fills seats 1-2 so one human can solo-test a
                                       # multi-seat chunk
```

Also teach, once: the second-tab-as-player-2 technique (open a second browser tab/window at the
same printed URL, use the dev host's seat selector to join or switch to the next open seat), and
Follow-active-seat (a toggle that keeps one tab tracking whichever seat currently has the turn,
useful when solo-testing several human seats across tabs).

## Build-Stamp Freshness (no on-screen indicator — hard reload instead)

There is no build-stamp UI element anywhere in the dev host's chrome — no version, commit, or
build indicator is displayed on screen. Fill the template's `Build stamp:` field with the actual
commit hash the orchestrator captured for this chunk's `build`/`test` completion (a textual
field the human never has to look up themselves). Because Vite HMR can keep a long-open browser
tab's JS live-patched against a stale module graph, and a tab left open from a previous session
can carry a stale WebSocket connection across a dev-server restart, instruct the human directly:
close any existing `boardsmith dev` browser tab(s) and open a fresh one (a hard reload —
Cmd+R / Ctrl+R, or closing and reopening the tab) after this chunk's build and test steps have
completed, before starting the numbered script above. Do not tell the user to "check the build
stamp on screen" — there is nothing to check there.

**Freshness guard reinforced against a non-exercising run (SKILLAUTO-08).** A stale tab is one
failure mode this hard-reload instruction already catches; a second, distinct failure mode is a
human playtest that LOOKS complete but never actually reached this chunk's new behavior — the
human clicked through the numbered script on a stale build that silently fell back to prior-chunk
behavior, or a script step was skipped/misread so the new action was never triggered. This is the
human-playtest analog of `build/test.md`'s fail-loud "sim exercised this chunk" assertion (item 5
of the Ordered Sequence): the freshness guard above (fresh tab, fresh module graph) plus the
Verified Checklist's item-by-item confirmation (`## The Verified Gate` below — never a whole-script
"looks good") together are what prevent a quietly-passing playtest that never exercised its
target. If the human's confirmed script does not include at least one step that exercises this
chunk's new action, that is itself a script-authoring gap — go back and correct the numbered
script before treating any confirmation as valid, rather than accepting a clean run that tested
nothing new.

## Regression Check and Taste Check

Fill the template's standing one-line regression check ("does everything that worked in prior
chunks still work?") and its standing taste-check line, verbatim:

```
Regression check: <!-- one line -->
Taste check: does anything look off, cramped, or unreadable?
```

## Second-Seat Leak Check (Hidden-Info Chunks Only)

For chunks whose `## Visibility Declaration` is non-empty (hidden information exists — an
opponent's hand, a face-down card, a secret role), the script includes a second-seat leak
check: open a second browser tab at the same dev-host URL, use the seat switcher to view the
other seat, and describe the outcome to look for, not a gesture to perform — "you should NOT see
the other player's hand — only its back/count." This is a plain visual check; there is no
dedicated leak-inspector panel in the dev host, only the seat switcher plus looking at what
renders. For chunks with no hidden information, fill this line with "n/a — no hidden info in
this chunk" instead of omitting the line entirely.

## The Verified Gate (mirror `ask.md`'s Gate-Before-Write) — milestone chunks only

This gate applies to a milestone chunk with visible UI, per the "Milestone/UI Gate" above.

Present the numbered script, the human plays it and answers item by item as they go — this is
not a vibe check, it is an explicit item-by-item checklist confirmed one at a time. Fill
CHUNK.template.md's `## Verified Checklist` with one line per script item, and check off each
line only as the human confirms that specific item worked as expected. Do not mark the whole
checklist done because the human said "looks good" once; walk it one at a time.

Presenting the script is not verifying it — only the human's explicit, item-by-item confirmation
(or an explicit, honest choice to skip playtesting) authorizes the write. If the human explicitly
chooses to skip playtesting this chunk, record that honestly as `verified (user-waived)` rather
than silently marking `verified` — `verified (user-waived)` is a legitimate, recordable status,
never a shortcut taken without the user's explicit say-so.

Only after every `## Verified Checklist` item is individually confirmed, or the human explicitly
waives:

1. Write `Status: verified` (or `Status: verified (user-waived)`) to CHUNK.md **last**, after
   every other write for this gate has landed — cite `state-machine.md` "Write Order": the
   `Status:` line is updated last so a session that crashes mid-write leaves a file whose status
   still reflects the last fully-completed state, never a half-written one.
2. Then update this chunk's derived-status pointer in SKETCH.md to match — CHUNK.md first, then
   SKETCH.md second, per `state-machine.md` "Write Order", never SKETCH.md alone.

## Light-Path Bookkeeping (cite, never restate)

For a chunk running the light path (`build, test, playtest` — no `close` step of its own), this
same `playtest` step also performs `close`'s bookkeeping once the Verified Checklist is
confirmed: see `build/close.md`'s `## Bookkeeping Sequence` by name for the verified-hash
capture, provenance record, Status write order, decision rollup, ledger reconciliation
(SKILLAUTO-08), and terminal lock release (`Session Lock: none`) — the exact **six-item**
sequence `state-machine.md` "Step Names (exact, light path — trivial chunks)" lists — this step
performs on the light path's behalf. It does **not** detail the sketch tail: tail re-derivation is `close`'s
user-gated `## Sketch-Tail Delta Gate`, which the light path does not run (`build-chunk.md`
Step 2's lazy tail-entry detailing covers any undetailed tail entry instead). This file does not
restate that sequence here — it cites it, exactly the shape `build/close.md` itself specifies for
reuse.

## If the Human Reports Issues

Any deviation the human reports during the script — something that didn't work as expected,
looked wrong, or surfaced an idea for later — is not resolved here. It is handed to
`build/revise.md`'s triage.

## Downstream Shape (cite, never restate)

If the human confirms the entire script clean (full ceremony, no light-path shortcut), this
chunk proceeds to `build/close.md`. If the human reports any issue, this chunk proceeds to
`build/revise.md` for triage instead. This file does not restate either downstream file's
structure.
