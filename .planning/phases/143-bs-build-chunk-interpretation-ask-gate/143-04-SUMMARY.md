---
phase: 143-bs-build-chunk-interpretation-ask-gate
plan: 04
subsystem: bs-build-chunk skill (CLI slash-command reference files)
tags: [bs-skills, redteam, adversarial-review, markdown-reference]
dependency graph:
  requires: [build/investigate.md (143-01), state-machine.md, templates/RULINGS.template.md]
  provides: [build/redteam.md — the 3-way independent adversarial redteam step reference]
  affects: [build/ask.md (143-05, downstream consumer of the settled interpretation)]
tech-stack:
  added: []
  patterns: ["fresh-context Task-tool fan-out dispatch (mirrors ingest/transcription.md)", "citation-not-restatement of state-machine.md authority rules", "vote-privacy escalation framing (plain-language question, never raw tally)"]
key-files:
  created:
    - src/cli/slash-command/bs/build/redteam.md
  modified: []
decisions:
  - "Prohibit confidence adjectives in dispatch prompts (e.g. 'the investigator believes') to prevent investigator framing from correlating the 3 independent agents"
  - "Refuters default to REFUTED on uncertainty rather than defaulting to stands — uncertainty is treated as a finding, not a pass"
  - "Escalation logic and repair-loop bound are cited from state-machine.md, never restated, per the phase's citation-not-restatement convention"
metrics:
  duration: "~15 minutes"
  completed: 2026-07-04
---

# Phase 143 Plan 04: Redteam Reference File Summary

Authored `src/cli/slash-command/bs/build/redteam.md` — the 3-way independent adversarial review
reference file (BUILD-03) that catches misinterpretations in a chunk's claims list before the
human ever sees a proposal.

## What Was Built

- **`src/cli/slash-command/bs/build/redteam.md`** (121 lines): specifies 3 independent
  fresh-context Task-tool dispatches — 2 identical-prompt refuters plus 1 coverage adversary —
  each receiving ONLY raw slice paths + the numbered claims list (no investigator framing, no
  confidence adjectives). Refuters default to REFUTED when uncertain. Escalation logic cites
  `state-machine.md` "Redteam Escalation" (max 1 re-investigate round on refuted-once; refuted-
  twice escalates to the user) and "Repair Loop Bound," rather than restating either. Vote-
  privacy section states raw verdicts/tallies are never shown to the user — only a distilled
  plain-language question with concrete options. Refuted-twice rulings are recorded as a
  `### Ruling N` entry filling `templates/RULINGS.template.md`'s Decision / Citation / Rationale
  shape. Footer cites `build/investigate.md` (upstream claims producer + re-investigate owner)
  and `build/ask.md` (downstream consumer).

## Verification

`npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-03"` — 5/5 passed.

Full-file run of `build-chunk.test.ts` shows 33 passed / 5 failed — the 5 failures are all for
`build-chunk.md` and `build/ask.md`, which are authored in later plans (143-02/143-05) and are
out of scope for this plan; this is the expected Wave-0-first partial-green state described in
the test file's own header comment.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This is a pure markdown reference file with no data flow to stub.

## Threat Flags

None. Per the plan's own threat model, this file has no trust boundary (LLM-instruction markdown
only; no auth/network/session/input-parsing surface). The two identified threats (T-143-04
framing-leakage, T-143-05 silent-vote-auto-resolution) are both mitigated as specified: the
dispatch prompt is slice-paths-plus-claims-only with confidence adjectives prohibited, and
refuted-twice always escalates to a durable, auditable `RULINGS.md` entry rather than an
auto-resolved vote count.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build/redteam.md
- FOUND: d124cae7 (git log --oneline --all | grep d124cae7)
