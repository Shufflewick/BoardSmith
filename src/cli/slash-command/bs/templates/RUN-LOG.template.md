# Run Log: <!-- work package: a chunk slug, or ingest-rules, or verify-game -->

<!-- ONE WORK PACKAGE'S DISPATCH LOG, at design/run-log/<id>.md: every dispatch of work for it and
     every review round of it (routing.md "The Run Log"). For a chunk the id is its slug, and the
     entry is written by whoever makes the dispatch: `/bs-build-game` for the chunk,
     `/bs-build-chunk` for its steps and reviewers. `/bs-ingest-rules` keeps design/run-log/ingest-rules.md and `/bs-verify-game`
     keeps design/run-log/verify-game.md for their own dispatches (a verify-game repair of a stale
     chunk runs through that chunk's build pipeline and is logged in the chunk's file). The work
     package is the one this file is named for, so an entry has no Chunk field. It is a journal,
     never an authority on chunk state: the chunk's own CHUNK.md Status wins on any disagreement.
     When chunks are built at the same time, each on its own branch, each chunk's entries are
     written in that chunk's own checkout, so this file merges with the chunk and never with anyone
     else's writes (#294). -->

<!-- Append-only. A dispatch is recorded BEFORE the subagent is launched (so a crash mid-chunk is
     visible as a dispatch with no outcome) and its Outcome is filled in once, when that dispatch
     returns and the checks run on its return (verify, claim-quote-check) have answered. Never
     delete, renumber, or rewrite an entry: a re-dispatch (after a gate is answered, after a crash,
     or a retry after a failure) is a NEW entry, not an edit of the old one. That is what makes
     the log a readable history of how many passes the work took, who did each one, and how many
     review rounds it needed.

     CHECKED AS CODE: `boardsmith ledger-check` fails when a Dispatched at or Finished at is not a
     clock read in that exact shape, when a finish is earlier than its dispatch, when a dispatch is
     earlier than the one logged before it, when Outcome and Finished at disagree about whether
     the dispatch has returned, and when a time is later than the commit in the game's history
     that recorded it. A hand-typed or estimated time is caught by that last comparison. It also
     fails a dispatch with no Work, Role or Agent, a role that does not exist, a failure answered
     twice, failed work done again without naming the failure, a retry of a first failure at any
     role but the one that failed, a third attempt at one role, a move up by anything but one role,
     a dispatch after a second failure at the top role without the designer's answer, a review
     round with no link to the finished dispatch it reviewed or one naming a dispatch a later
     finished dispatch carried on from, and a review round that did not start from a passing verify (checked against
     .boardsmith/verify/ when the result is on this machine). -->

<!-- Each "### Dispatch N" section has exactly these fields:
     - Work: what was dispatched: build-chunk | build-bot | insert-chunk for a whole chunk; the
       step name (investigate, spec, build, repair, ...) for a step; `re-investigate` for a red
       team re-investigation; for work done once per unit, the dispatch's name in routing.md's
       step table followed by the unit (`transcribe rulebook.pdf pp. 1-8`, `classify <pair id>`, `ruling-recheck Ruling 4`,
       `enumerate <slice>`, `reconcile <slice>`, `extract-example <slice>`,
       `translate-example <example id>`); a short name for a bulk edit, search or summary. A dispatch of the same Work
       after that Work failed is a retry of it, and is checked as one.
     - Role: mechanical | bounded | judgement | second-opinion (routing.md "Which Role Each Step
       Uses"; reviewers are recorded in review rounds, not here)
     - Agent: the agent type actually dispatched, as `npx boardsmith agent <role>` printed it
     - Retry of: none, also when this dispatch carries on one that stopped at a gate, its
       context ceiling or a crash (Outcome gate, context-ceiling, or still pending), which it does
       at the same role and as the same attempt; "Dispatch M" for the failed dispatch this one
       retries; or "Review Round M" for the review round that asked for changes to the work this
       one redoes. A first failure is retried once at the role that failed, a second failure there
       one role up (`npx boardsmith agent <role> --escalate`), and a second failure at the top goes
       to the designer (routing.md "When a Step Fails").
     - Designer answer: only on a dispatch that does work again after it failed twice at the top
       role and the designer answered: where their answer is recorded (a RULINGS.md or DECISIONS.md entry, or
       the triage in CHUNK.md's Findings Ledger). Leave the field out otherwise.
     - Dispatched at: ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ` (never fabricated — the
       same single sanctioned clock read state-machine.md "Session Lock" requires)
     - Finished at: `pending` while the dispatch runs, then an ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`,
       read when the dispatch returns and written together with Outcome (never fabricated, never
       copied from another entry, never typed from memory)
     - Outcome: pending | closed | gate | filing | context-ceiling | stuck | failed for a whole
       chunk; pending | done | failed | gate | context-ceiling for a step or a bulk edit. `failed`
       means its verify failed or a check run on its return refused it (claim-quote-check, for
       investigate and re-investigate; verify-run-record, for a transcribed range), or, for a whole
       chunk, that it returned `closed` but failed its check. A `build` dispatch's Outcome and
       Finished at stay `pending` until `test`'s done gate answers, since that verify is its check:
       then `done`, or `failed` with the failed check in Detail, and the `build` that retries it
       records `Retry of: Dispatch N`. A reviewer's request for changes is not written here: it is
       the review round's Outcome, and the retry names the round.
     - Detail: one line — for `gate`, which gate; for `filing`, the filing id; for `stuck`, what
       was stuck; for `failed`, which check failed; otherwise "n/a"

     Each "### Review Round N" section records one review round, once `npx boardsmith review-gate`
     is open, with exactly these fields:
     - Step: redteam | audit | final-acceptance | cross-chunk
     - Reviewed: "Dispatch M", the dispatch whose finished work (Outcome done or closed) the round
       reviews: the latest one that changed it
     - Level: light | full, as review-gate printed it (a change it sized "none" has no round)
     - Verify: the verify result the round started from, "<commit> passed", the commit
       review-gate named
     - Agents: every agent type dispatched for the round, e.g. "fidelity=bs-judgement,
       visibility=bs-review"
     - Outcome: pending | clean | changes requested

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Dispatch 1
     - Work: build-chunk
     - Role: judgement
     - Agent: bs-judgement
     - Retry of: none
     - Dispatched at: 2026-08-07T14:02:11Z
     - Finished at: 2026-08-07T14:29:02Z
     - Outcome: gate
     - Detail: design approval for the turn sequence

     ### Dispatch 2
     - Work: build-chunk
     - Role: judgement
     - Agent: bs-judgement
     - Retry of: none
     - Dispatched at: 2026-08-07T14:31:40Z
     - Finished at: 2026-08-07T15:40:23Z
     - Outcome: closed
     - Detail: n/a

     ### Dispatch 3
     - Work: build
     - Role: bounded
     - Agent: bs-bounded
     - Retry of: none
     - Dispatched at: 2026-08-07T14:40:05Z
     - Finished at: 2026-08-07T14:52:47Z
     - Outcome: failed
     - Detail: verify failed: mutation, 2 survivors in src/rules/trade.ts

     ### Dispatch 4
     - Work: build
     - Role: bounded
     - Agent: bs-bounded
     - Retry of: Dispatch 3
     - Dispatched at: 2026-08-07T14:53:30Z
     - Finished at: 2026-08-07T15:08:12Z
     - Outcome: done
     - Detail: n/a

     ### Review Round 1
     - Step: audit
     - Reviewed: Dispatch 4
     - Level: full
     - Verify: 4f2a9c81d03e passed
     - Agents: fidelity=bs-judgement, visibility=bs-review, undo=bs-review, constraints=bs-review
     - Outcome: changes requested

     ### Dispatch 5
     - Work: repair
     - Role: judgement
     - Agent: bs-judgement
     - Retry of: Review Round 1
     - Dispatched at: 2026-08-07T15:12:09Z
     - Finished at: 2026-08-07T15:25:41Z
     - Outcome: done
     - Detail: n/a

     ### Review Round 2
     - Step: audit
     - Reviewed: Dispatch 5
     - Level: full
     - Verify: 9b07e4d2a1c3 passed
     - Agents: fidelity=bs-judgement, visibility=bs-review, undo=bs-review, constraints=bs-review
     - Outcome: clean
-->
