# 149-HUMAN-UAT: Chunk-1 Go Fish Browser Playtest

**Status:** partial / pending (verification status: `human_needed` by design)
**Requirement:** VAL-01
**Feeds:** `/gsd:audit-uat`, the v4.6 milestone audit

---

## Why this exists

Phase 149's dry-run ran the entire `bs-` skill pipeline (ingest → chunk-1 build →
test → audit) autonomously against Go Fish, up to but not including the one
gate that is human-by-design: the live browser playtest (`bs/build/playtest.md`).
Every automated check the pipeline can run on its own (compile, lint,
unit/integration tests, random simulation, a11y floor, the two-seat hidden-info
leak diff) passed — see `149-DRYRUN-REPORT.md` §1-2. This item captures the one
thing only a human can confirm: does the generated game actually feel right and
correctly hide opponent information when a real person clicks through it.

This file is self-contained (the script below is copied from the scratch
project's `PLAYTEST-SCRIPT.md`, captured at the 149-02 build commit) so it
survives scratch-workspace cleanup — the scratch dir at
`/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/` is throwaway and OS-temp-cleaned.

---

## What to run

Two options, either is a valid UAT run:

1. **The dry-run's own generated chunk-1 project** (if the scratch dir still
   exists at `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/`) — this is the actual
   pipeline OUTPUT being validated, the most direct proof.
2. **The hand-built `~/BoardSmithGames/go-fish/`** — a side-by-side taste
   comparison against the reference implementation the pipeline output was
   compared to in `149-DRYRUN-REPORT.md` §2.

```bash
cd <chosen project dir>
npx boardsmith dev --players 2
```

Kill the server (`Ctrl+C`) when done — do not leave it running.

---

## Numbered click-by-click script (2 seats)

Captured per `bs/build/playtest.md`, verbatim from the scratch project's
`PLAYTEST-SCRIPT.md`:

### Dev-host affordances (taught once)

```
npx boardsmith dev                    # opens your browser, seats you as seat 1
npx boardsmith dev --players 2        # this chunk needs 2 seats — open a second
                                       # browser tab for seat 2
npx boardsmith dev --ai 2             # AI fills seat 2 so one human can solo-test
```

Open a second browser tab/window at the same printed URL, use the dev host's
seat selector to switch to seat 2. Use Follow-active-seat to keep one tab
tracking whichever seat currently has the turn.

**Hard reload before starting:** close any existing `boardsmith dev` browser
tab(s) and open a fresh one (Cmd+R / Ctrl+R) before starting the script below.

### Script

1. As seat 1, click "Ask", choose seat 2, then choose a rank seat 1 holds
   that seat 2 also holds. — expect: all matching cards move into seat 1's
   hand, and it is still seat 1's turn (the panel re-offers "Ask").
2. As seat 1, ask seat 2 for a rank seat 2 does NOT hold. — expect: a
   "Go Fish!" message appears; if the drawn card matches the rank you asked
   for, it stays your turn; otherwise the turn indicator switches to seat 2.
3. As seat 2 (second tab), confirm you can now take your own turn once it
   passes to you, asking seat 1 for a rank in the same way.

### Regression check

n/a — first playable chunk, nothing prior to regress.

### Taste check

Does anything look off, cramped, or unreadable?

### Second-seat leak check (hidden-info chunk — the highest-value manual check)

Switch to seat 2's tab during/after seat 1's ask. You should NOT see seat 1's
hand contents, and you should NOT see the identity of any card seat 1 drew
from the pond on a miss (only the public "Go Fish!" / match-or-not outcome is
visible). The automated `diffPlayerViews`/`assertNoHiddenInfoLeak` checks
already proved this programmatically (`149-DRYRUN-REPORT.md` §1-2) — this
manual step is the human-eyes confirmation of the same guarantee.

---

## Verified Checklist

- [ ] Item 1 confirmed (hit — gives all matching cards, extra turn)
- [ ] Item 2 confirmed (miss — go fish, correct turn-passing)
- [ ] Item 3 confirmed (seat 2 can take its own turn)
- [ ] Regression check confirmed
- [ ] Taste check confirmed
- [ ] Second-seat leak check confirmed (no hand/drawn-card leak visible)

**Status: NOT waived, NOT verified.** This is the single manual-verification
item the v4.6 milestone ships with outstanding — route to the user via
`/gsd:audit-uat`.
