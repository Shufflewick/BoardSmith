# Run Log: <!-- chunk slug -->

<!-- ONE CHUNK'S DISPATCH LOG, at design/run-log/<slug>.md: every dispatch of work for this chunk
     and every review round of it (routing.md "The Run Log"). Whoever dispatches writes the entry:
     `/bs-build-game` for the chunk, `/bs-build-chunk` for its steps and reviewers. The chunk is the
     one this file is named for, so an entry has no Chunk field. It is a journal, never an
     authority on chunk state: the chunk's own CHUNK.md Status wins on any disagreement. When
     chunks are built at the same time, each on its own branch, each chunk's entries are written
     in that chunk's own checkout, so this file merges with the chunk and never with anyone else's
     writes (#294). -->

<!-- Append-only. A dispatch is recorded BEFORE the subagent is launched (so a crash mid-chunk is
     visible as a dispatch with no outcome) and its Outcome is filled in once, when that dispatch
     returns. Never delete, renumber, or rewrite an entry: a re-dispatch (after a gate is
     answered, after a crash, or one role up after a failure) is a NEW entry, not an edit of the
     old one. That is what makes the log a readable history of how many passes the chunk took,
     who did each one, and how many review rounds it needed.

     CHECKED AS CODE: `boardsmith ledger-check` fails when a Dispatched at or Finished at is not a
     clock read in that exact shape, when a finish is earlier than its dispatch, when a dispatch is
     earlier than the one logged before it, when Outcome and Finished at disagree about whether
     the dispatch has returned, and when a time is later than the commit in the game's history
     that recorded it. A hand-typed or estimated time is caught by that last comparison. It also
     fails a dispatch with no Work, Role or Agent, a role that does not exist, an escalation that
     is not exactly one role up from a failed dispatch, a failed dispatch retried at the same role
     below judgement, and a review round that did not start from a passing verify. -->

<!-- Each "### Dispatch N" section has exactly these fields:
     - Work: what was dispatched: build-chunk | build-bot | insert-chunk for a whole chunk; the
       step name (investigate, spec, build, repair, ...) for a step; a short name for a bulk edit,
       search or summary
     - Role: mechanical | bounded | judgement (routing.md "Which Role Each Step Uses")
     - Agent: the agent type actually dispatched, as `npx boardsmith agent <role>` printed it
     - Escalated from: none, or "Dispatch M" for the failed dispatch this one retries one role up
       (`npx boardsmith agent <role> --escalate`)
     - Dispatched at: ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ` (never fabricated — the
       same single sanctioned clock read state-machine.md "Session Lock" requires)
     - Finished at: `pending` while the dispatch runs, then an ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`,
       read when the dispatch returns and written together with Outcome (never fabricated, never
       copied from another entry, never typed from memory)
     - Outcome: pending | closed | gate | filing | context-ceiling | stuck for a whole chunk;
       pending | done | failed | gate | context-ceiling for a step or a bulk edit. `failed` means
       its verify failed or its reviewer asked for changes.
     - Detail: one line — for `gate`, which gate; for `filing`, the filing id; for `stuck`, what
       was stuck; for `failed`, which check failed or what the reviewer asked for; otherwise "n/a"

     Each "### Review Round N" section records one review round, once `npx boardsmith review-gate`
     is open, with exactly these fields:
     - Step: redteam | audit | final-acceptance | cross-chunk
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
     - Escalated from: none
     - Dispatched at: 2026-08-07T14:02:11Z
     - Finished at: 2026-08-07T14:29:02Z
     - Outcome: gate
     - Detail: design approval for the turn sequence

     ### Dispatch 2
     - Work: build-chunk
     - Role: judgement
     - Agent: bs-judgement
     - Escalated from: none
     - Dispatched at: 2026-08-07T14:31:40Z
     - Finished at: 2026-08-07T15:40:23Z
     - Outcome: closed
     - Detail: n/a

     ### Dispatch 3
     - Work: build
     - Role: bounded
     - Agent: bs-bounded
     - Escalated from: none
     - Dispatched at: 2026-08-07T14:40:05Z
     - Finished at: 2026-08-07T14:52:47Z
     - Outcome: failed
     - Detail: verify failed: mutation, 2 survivors in src/rules/trade.ts

     ### Dispatch 4
     - Work: build
     - Role: judgement
     - Agent: bs-judgement
     - Escalated from: Dispatch 3
     - Dispatched at: 2026-08-07T14:53:30Z
     - Finished at: 2026-08-07T15:08:12Z
     - Outcome: done
     - Detail: n/a

     ### Review Round 1
     - Step: audit
     - Level: full
     - Verify: 4f2a9c81d03e passed
     - Agents: fidelity=bs-judgement, visibility=bs-review, undo=bs-review, constraints=bs-review
     - Outcome: clean
-->
