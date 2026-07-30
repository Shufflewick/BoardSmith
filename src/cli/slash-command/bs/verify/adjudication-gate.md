# Adjudication Gate and Impact Map (VERIFY-04, VERIFY-05, VERIFY-06)

This is `verify-game.md` Step 4's delegate — the point where Step 3's recorded verdicts become a
durable consequence: a human decision on every contradiction, a rules-staleness marker on every
chunk it affects, and a scoped repair-gate disposition per chunk. Cite
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` sections by name throughout; nothing below
restates its Write Order, Authority, or Redteam Escalation rules.

## 1. When This File Runs

Only after Step 3's classification of ALL pairs completes — never mid-pass (decision 6). The
precondition is `verify-classify-status`'s own "every pair classified" condition (`pendingPairs`
empty), the same signal Step 3's Close already checks before handing off here. The gate is
deliberately batched rather than fired per-finding: the designer sees every contradiction at once,
with full context, instead of one interruption per finding scattered through the pass.

## 2. Detect

Run:

```
boardsmith verify-impact-gate --project <dir> --run-id <runId> --json
```

FORMAT its output — **formatted, never computed** by this file; every number and pair id in the
presentation below comes from that JSON, never from this file's own arithmetic. If
`summary.pending` is `0`, there is nothing to adjudicate — skip directly to sub-step 5 (Write) and
sub-step 6 (Report).

## 3. Present

For each pending contradiction the JSON names, present:

- the pair id and its provenance,
- both readings verbatim, under `Reading as built (pass 1):` and
  `Reading in the fresh transcription (pass 2):`,
- every affected chunk slug — **uncapped** (decision 15: report volume is the risk, so group and
  summarise for readability, but never drop a slug).

State explicitly, in the presentation itself, that this is **ONE question per contradictory
FINDING, never one per affected chunk.** Name the measured reason: Phase 174 found a single finding
touching 6+ chunks (`174-PROOF.md` §8), and asking once per affected chunk would put the same
question to the designer six times over — training them to click through it rather than read it
(decision 14).

## 4. Wait

Copy `build/ask.md`'s "Gate-Before-Write" discipline in this file's own words: do **not** write
anything durable — not a `RULINGS.md` entry, not a rules-staleness marker, not an impact-map
record — until the designer has answered. Presenting is not answering; only an explicit answer
authorizes the write.

**There is no flag, option, or unattended-mode carve-out that skips this.** VERIFY-04's "always
stops the pass" means exactly that: no representable option skips it, not even a documented one
reserved for automation. An unattended run stops here, records what it has, and resumes later
(decision 9) — it never proceeds past a pending contradiction on its own authority.

Then the two terminal answers, and only these two:

- **Resolved** — the designer names which reading governs, and why. Record it with:

  ```
  boardsmith verify-impact-adjudicate --project <dir> --run-id <runId> --pair-id <pairId> \
    --outcome resolved --decision "<text>" --citation "<text>" --rationale "<text>"
  ```

  This appends a `### Ruling N` entry to `RULINGS.md` in the corpus's own existing three-field
  shape (`Decision` / `Citation interpreted or overridden` / `Rationale`). The corpus's own
  informal convention governs; no new structured supersession syntax is invented here (decision 7).

- **Deferred / aborted** — record it with:

  ```
  boardsmith verify-impact-adjudicate --project <dir> --run-id <runId> --pair-id <pairId> \
    --outcome UNADJUDICATED
  ```

  The affected chunks are STILL marked rules-stale; the pass stays resumable; the lock releases
  cleanly. Cite `state-machine.md` "Redteam Escalation" as the precedent for a named, honest
  terminal state rather than a silent pass-through — the same discipline that governs a
  refuted-twice dispute there governs a deferred contradiction here. State the rule directly:
  **never silently clean** (decision 8) — `UNADJUDICATED` is a real, reportable outcome, not a
  quiet "treat as resolved."

## 5. Write

Once every pending contradiction from sub-step 2 has an answer recorded (or immediately, if
`summary.pending` was already `0`), run:

```
boardsmith verify-impact-apply --project <dir> --run-id <runId> --json
```

State what it does and in which order, citing
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Write Order" and "Authority") rather than
restating them: the rules-staleness marker lands in each affected chunk's CHUNK.md
first and SKETCH.md second — never SKETCH.md alone — with the marker's own value written last,
the same discipline the `Status:` line already follows; the impact map is appended to the run's own
ledger (never a second, standalone write path). State plainly that the command REFUSES to write
anything while any contradiction is still `pending` — so the gate has structural teeth, and this
prose is a description of that refusal, not the only thing enforcing it.

## 6. Report

Run:

```
boardsmith verify-impact-status --project <dir> --run-id <runId> --json
```

and format it: the `"N of M chunks rules-stale"` fraction (uncapped — every stale slug listed, per
decision 15), and each chunk's repair-gate disposition. **Do not enumerate the disposition values
here.** They are defined by `REPAIR_GATE_DISPOSITIONS` in `src/cli/commands/verify-impact.ts`, and
`printImpactHumanReport` iterates that array in full — so any value present in the real report must
appear in what this step formats. Reproducing a partial list here is how the list goes stale: an
earlier draft of this paragraph named three of the four and silently omitted one, which is the same
defect class the `verify-game.md` sweep (plan 176-04) had to fix in three separate places.

State that the disposition is computed entirely by the command and only formatted here, and that
performing the repair itself — walking the audit lenses, clearing the marker, flipping the chunk's
status — belongs to the repair step, never this one.

## No Skip Path, By Construction

There is no flag, option, or unattended-mode carve-out anywhere in this file's prose, and none in
the four commands it drives: `verify-impact-gate` and `verify-impact-status` are read-only reports;
`verify-impact-adjudicate` accepts exactly `resolved` or `UNADJUDICATED`, nothing else;
`verify-impact-apply` refuses outright while any contradiction is still pending. An unattended run
that reaches sub-step 4 with a pending contradiction stops there and resumes on a later invocation —
it never has a shortcut to take instead.

## Reference

Cite, never restate: `state-machine.md` "Write Order", "Authority", "Redteam Escalation", and
"Rules Staleness Marker" govern every write this file makes. This file adds no new authority rule
of its own.
