# Ingest Harness

An automated stand-in for a human `/bs-ingest-rules` ingest gate. It exercises the real skill
text end-to-end against a real headless agent session and asserts on the artifacts a run
actually produces, rather than on skill-text strings.

Background: the 2026-07-27 human proof run (`.planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN.md`)
found that `bs-ingest-rules` does not execute its skill text literally — every contract test for
INGEST-01..04 stayed green while the real run failed 7 of 9 checklist items. A contract test
proves an instruction *exists*; it cannot prove an agent *received or followed* it. This harness
closes that gap by inspecting the produced project directory itself.

## Why this is NOT wired into `npm test` or CI

Three reasons, all load-bearing:

1. **LLM output varies run to run.** The repo runs 3211+ tests on every commit and they must stay
   deterministic; a flaky live-agent test would be quarantined within a week and then ignored.
2. **A real ingest session costs real tokens and minutes.** CI cost per commit is the wrong place
   to pay it.
3. **The determinism that CI *should* pin already exists elsewhere.** `check.test.mjs` pins the
   checker's own judgment against static fixtures and does run in `npm test`. What varies is the
   agent run; what is invariant is the checker. Splitting them is what lets each be tested
   honestly.

The rule this creates: **a skill-text change is not verified by a green contract test. It is
verified by `npm run harness:ingest` reporting the relevant check green.** Contract tests remain
useful fast regression pins (they catch a reword that deletes a required string), but they are
explicitly **not** the acceptance bar for this phase — every one of them was green on 2026-07-27
while all four INGEST requirements failed against a real run.

## Reference-game read-only invariant

The harness reads a real rulebook (`~/BoardSmithGames/seven/rules.pdf` by default) from a
reference game repo, but that repo is **read-only** for the entire run:

- `stage` hard-stops if the reference repo's source file hash doesn't match `--expect-hash`, or
  if the reference repo's working tree is dirty.
- The source rulebook is then **copied** into the throwaway project tree
  (`{workDir}/source-under-test/<filename>`), and the driven agent session is granted **no
  filesystem path outside `{workDir}` at all** — the reference repo is structurally unreachable
  from the session, not merely forbidden.
- `assert` re-checks the reference repo's git cleanliness and HEAD commit against what `stage`
  recorded, and fails loudly on any difference.

## Usage

```bash
# Run all three steps in order (the common case):
npm run harness:ingest

# Or invoke each step individually:
node scripts/ingest-harness/run.mjs stage    # fresh throwaway project + current skill text install
node scripts/ingest-harness/run.mjs drive    # real headless agent session against it
node scripts/ingest-harness/run.mjs assert   # report the ten checks, exit 0 only if all pass

# Options (see --help for the full list and defaults):
node scripts/ingest-harness/run.mjs --work-dir /tmp/my-harness-run --model sonnet
```

`stage`, `drive`, and `assert` share state via `{workDir}/.harness-stage-state.json` — `drive` and
`assert` read what `stage` recorded (the staged copy's path, the recorded source hash, the
reference repo's baseline HEAD) rather than re-deriving it.

### `stage`

Recreates `{workDir}` from scratch, installs this repo's **current working tree's** skill text
into it project-locally (`node bin/boardsmith.js claude --local --force`), verifies the install
landed, asserts the operator's global `~/.claude/skills/` tree was untouched, verifies the
reference repo's source hash and cleanliness, and copies the source rulebook into
`{workDir}/source-under-test/`.

### `drive`

Spawns a real `claude --print --dangerously-skip-permissions` session with `cwd` set to
`{workDir}`, invoking `/bs-ingest-rules` against the staged copy's path. No additional-directory
access grant is passed — the session's tool access is bounded to `{workDir}`. The prompt never
restates or paraphrases the ingest contract; it only names the invocation, the rulebook's path,
and the no-human-present operating instructions. The session is instructed to stop after Step 3
(Synthesis) and print `HARNESS-STEP3-COMPLETE`, since Step 3 is where every artifact under test
is written.

### `assert`

Locates the single project directory the run produced, calls `checkIngestArtifacts()` (the
deterministic checker from `check.mjs`) for the nine produced-artifact checks, re-verifies the
reference repo's git cleanliness/HEAD as gate item (g), prints a ten-row table, and exits 0 only
when all ten pass.

## Acceptance bar

For every remaining plan in Phase 170 that changes skill text: **a green harness run — not a
green contract test — is what closes the requirement.** Contract tests catch regressions cheaply;
they do not prove live-agent conformance.
