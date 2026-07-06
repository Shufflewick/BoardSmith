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
project's `PLAYTEST-SCRIPT.md`, captured at the 149-02 build commit). The
original 149 dry-run ran in a throwaway scratch dir
(`/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/`, since OS-temp-cleaned); Phase 150
re-ran the same ingest + chunk-1 build legs into a durable, non-throwaway
location so this script has a stable pipeline-OUTPUT project to point at.

---

## What to run

Two options, either is a valid UAT run:

1. **`~/BoardSmithGames/go-fish-dryrun/`** — the Phase-150 regeneration of the
   dry-run's chunk-1 project (compiling, tested, serve-verified, and
   preserved — not a scratch dir). This is the actual pipeline OUTPUT being
   validated, the most direct proof.
2. **The hand-built `~/BoardSmithGames/go-fish/`** — a side-by-side taste
   comparison against the reference implementation the pipeline output was
   compared to in `149-DRYRUN-REPORT.md` §2.

```bash
cd ~/BoardSmithGames/go-fish-dryrun && npx boardsmith dev --players 2
```

(Or, for the taste-comparison option: `cd ~/BoardSmithGames/go-fish && npx boardsmith dev --players 2`.)

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

- [ ] Item 1 confirmed (hit — gives all matching cards, extra turn) — **BLOCKED by DEF-B**
- [ ] Item 2 confirmed (miss — go fish, correct turn-passing) — **BLOCKED by DEF-B**
- [ ] Item 3 confirmed (seat 2 can take its own turn) — **BLOCKED by DEF-B**
- [ ] Regression check confirmed
- [x] Taste check confirmed — **FAILED: all cards render as broken images (DEF-A)**
- [ ] Second-seat leak check confirmed (no hand/drawn-card leak visible) — could not reach (DEF-B); note the automated `diffPlayerViews`/`assertNoHiddenInfoLeak` proofs remain green

**Status: PLAYED 2026-07-05 — NOT verified; two this-chunk defects recorded.**

---

## Playtest Results (2026-07-05, Phase 151 — human browser playtest, seat-2 `boardsmith dev --players 2`)

The human playtest was RUN against the Phase-150 regenerated
`~/BoardSmithGames/go-fish-dryrun/`. It surfaced **two real this-chunk
defects** that the entire automated bar (38/38 tests incl. random-sim, a11y
floor, and both hidden-info leak checks) did not catch — which is precisely
the value of this deferred human gate. Both are triaged **this-chunk defect**
(the ask→give/go-fish→turn-advance loop and card rendering ARE chunk-1's scope).

### DEF-A — All cards render as broken images (this-chunk defect, root cause PROVEN)

- **Symptom:** every card (hands, pond) shows a broken-image link, not card art.
- **Root cause:** generated `src/rules/game.ts` hardcodes
  `card.$images = { face: '/cards/${rank}${suit}.svg', back: '/cards/back.svg' }`
  (lines 71-74; pond back line 49) — copying the hand-built go-fish's
  convention — but the pipeline never emitted the 53 `public/cards/*.svg`
  assets the hand-built game ships (`~/BoardSmithGames/go-fish/public/cards/`
  has 53 svgs; `go-fish-dryrun/public/cards/` does not exist). Vite's SPA
  fallback serves `index.html` (`HTTP 200`, `Content-Type: text/html`) for the
  missing paths, so each `<img src="/cards/AH.svg">` receives HTML → broken.
  The UI's CSS-drawn fallback (`GameTable.vue:224` `v-else`) never fires because
  `$images.face` is truthy.
- **Pipeline gap:** `build-chunk` emitted asset-referencing rules code without
  emitting the assets OR guarding the UI to fall back when assets are absent.
  No automated check catches a broken `<img src>` (tests assert DOM/handlers,
  not rendered image bytes).

### DEF-B — Ask action locks up in the dev-host 2-seat path (this-chunk defect, LOCALIZED)

- **Symptom (user):** "when I pick something to ask the other player, it locks
  up and I cannot proceed. It does not give me their card. It does not advance
  to the next player's turn."
- **Localization:** the ask MECHANICS pass in every in-process test —
  `tests/game.test.ts` drives `doAction('ask', {target, rank})` and asserts
  correct hit/miss/extra-turn/turn-passing (lines 195-283), and
  `tests/a11y-keyboard-completion.test.ts` drives the REAL `useActionController`
  + real `createHeadlessSession` via keyboard for BOTH picks and passes. The
  lockup is therefore specific to the **dev-host multiplayer WS path**
  (`boardsmith dev --players 2` → `SnapshotSessionHost`/`multiplayer-host.ts`),
  which NO test and NO Phase-149/150 pipeline step ever exercised — the pipeline
  only did an HTTP-200 reachability check, never a real WS playthrough.
- **Status:** exact nature (real WS/turn-pass bug vs. two-tab UX vs. a BoardSmith
  dev-host-library issue) pending: browser extension was not bridged this
  session and Playwright's browser binary is not installed, so a full dev-host
  repro was deferred to the disposition decision below.

### Meta-finding (about the SKILLS, not just this game)

The deferred human gate did its job: it caught two browser-level failures the
pipeline's automated discipline is blind to. This is evidence the `bs-`
pipeline needs (a) an asset-completeness / broken-`<img>` check, and (b) a real
dev-host WS playthrough step — not just an HTTP reachability ping — before a
generated game is called playable.

---

## Resolution (2026-07-05, Phase 151 — both defects fixed + re-verified)

Both defects were root-caused and fixed; the pipeline-built game now renders and
plays cleanly. Re-verified via headless-browser automation (Playwright against
the real `boardsmith dev` WS host).

### DEF-A — FIXED (generated artifact)
- **Fix:** generated the 52 face + 1 back card SVGs the game references, via
  `~/BoardSmithGames/go-fish-dryrun/scripts/generate-cards.mjs` →
  `public/cards/*.svg` (go-fish-dryrun commit `98d3d15`). The game now SHIPS the
  art it references.
- **Verified:** `/cards/AH.svg` serves `Content-Type: image/svg+xml`; in-browser,
  15 card `<img>`s render with 0 broken (naturalWidth > 0). Face cards show
  rank+suit in correct red/black; backs show the patterned back.
- **Skill-gap (follow-up):** `bs-build-chunk` should emit card assets (or
  CSS-fallback-guard the UI so a missing `$images` path degrades to the drawn
  fallback instead of a broken `<img>`). Tracked for the `bs-` skills.

### DEF-B — FIXED (BoardSmith dev-host library)
- **Root cause:** the latent dev-host lost-update race — `SnapshotSessionHost`'s
  `handleOp` and `runAITurns` were unserialized, so a human op arriving during the
  AI pump's think-time clobbered state and wedged the game. Pre-existing
  (pre-v4.4), library-wide, NOT a generated-game bug (human-vs-human play was
  proven flawless; the MCTS bot plays the game fine).
- **Fix:** per-host async op queue serializing all mutating op sequences
  (BoardSmith commit `281e8155`), + regression tests. Full suite 2653/2653.
- **Verified:** 15 rapid ask cycles deliberately racing the AI-pump boundary →
  97 log entries of smooth play, no wedge, 0 server errors.
- **MERC note:** MERC uses a vendored BoardSmith copy — a re-vendor is needed for
  it to pick up this fix (tracked as follow-up).

## Verified Checklist (post-fix)

- [x] Item 1 (hit — gives all matching cards, extra turn) — verified (log: "Player 2 gives Player 1 …")
- [x] Item 2 (miss — go fish, correct turn-passing) — verified (log: "Go Fish! … play passes to the next player")
- [x] Item 3 (seat 2 can take its own turn) — verified (2-human: seat-2 ask resolved; AI-seat: "Player 2 asks Player 1 …")
- [x] Regression check — n/a (first playable chunk)
- [x] Taste check — cards now render (DEF-A fixed); board legible
- [x] Second-seat leak check — seat 1 sees only card BACKS for Player 2's hand (UI); automated `diffPlayerViews`/`assertNoHiddenInfoLeak` remain green

### DEF-C — Action rejected "Not Player 1's turn" in 2-browser play (INVESTIGATED — not reproducible post-fix)

- **Symptom (one occurrence):** during a 2-browser human-vs-human re-playtest, Seat 1's
  ask was rejected with "Not Player 1's turn" while its own panel showed its turn.
- **Diagnosis (client + host instrumentation, guided repro):** the UI action pipeline
  is **correct** — browser traces showed `fill → isReady:true → auto-execute → sendAction`
  all firing; the server simply (correctly) rejected the action because it was actually
  Seat 2's turn. Host-side traces (`deliverGameState` with per-seat `currentPlayer`/`isMyTurn`)
  showed **broadcasts reach Seat 1 on every move and report the correct turn**, including
  through the AI-seat takeover — it is **not** a dropped-broadcast or a generated-game bug.
- **Outcome:** DEF-C **did not reproduce** in two clean guided re-playtests (both played
  fine per the user); the one occurrence correlated with a reload/reconnect storm (repeated
  hard-reloads) and/or a stale pre-fix tab. Most plausibly a transient symptom of the DEF-B
  AI/op lost-update race (now fixed) or stale client state. **Watch item**, not an open
  blocker — the diagnosis + instrumentation approach are on file if it recurs.

**Status: RESOLVED — DEF-A + DEF-B fixed and verified; the pipeline-built game's rules,
UI action pipeline, hidden-info redaction, and turn handling (incl. AI-seat takeover) all
verified correct in clean play. DEF-C not reproducible post-fix (watch item). VAL-01's
human gate is CLOSED.**
