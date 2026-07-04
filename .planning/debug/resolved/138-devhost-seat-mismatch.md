---
status: awaiting_human_verify
trigger: "Root-cause and fix boardsmith dev host seat-identity mismatch bug surfaced by Phase 138 browser smokes (go-fish: isMyTurn never true; cribbage: human seat's discard silently auto-played by AI). Prove root cause, fix, verify with blocked smokes."
created: 2026-07-03T00:00:00Z
updated: 2026-07-03T00:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "`npx boardsmith dev` unconditionally calls `await open(hostUrl)` (src/cli/commands/dev.ts:766, using the `open` npm package), which launches the machine's real default GUI browser and points it at the dev host URL. That real browser tab connects over WS milliseconds later and, per MultiplayerHost.hello()'s 'first arrival auto-seats' rule (src/cli/dev-host/multiplayer-host.ts:196-206), claims seat 1 before any scripted/headless driver (Playwright) can connect. The scripted driver then arrives as the SECOND client, lands in the seat-picker, and joins whatever seat is left/open (typically seat 2). For go-fish (strict turn order starting at seat 1) the scripted client's seat is never due -> isMyTurn never true. For cribbage (simultaneousActionStep discard phase), seat 2 was AI-owned during the brief window between game start and the scripted client's join (aiSeats/humanSeats snapshot taken in startGame() before the scripted client joins), so the AI pump (runAITurns(), called synchronously at the end of startGame()) auto-plays/discards for that seat before the scripted client can ever act on it."
  confirming_evidence:
    - "Direct WS probe (scratchpad/ws-probe-gofish.mjs) against a freshly spawned `npx boardsmith dev --port 5199` (go-fish) showed a 'lobby' broadcast with seat 1 ALREADY held by a DIFFERENT, unrecognized clientId ('c-786b7ophtn6-mqgpwutx') and connected:true, arriving before my own probe client's hello ever got an 'init'/'joined' response -- i.e. some other real client beat the probe to seat 1 within ~4s of server start, with nothing else running that could have connected."
    - "src/cli/commands/dev.ts:766 -- `await open(hostUrl);` executes unconditionally, no flag or environment check gates it. `import open from 'open'` (line 9) is the cross-platform 'launch this URL in the default browser' package -- exactly matches an uncontrolled extra WS client appearing."
    - "In-process harness proof (scratchpad/probe-seat.mts) confirms MultiplayerHost's assignSeat->reinitSeat->viewForSeat chain itself is 100% correct in isolation: seat 1 sent to the first hello, isMyTurn:true, currentPlayer:1 -- eliminating the assignSeat/init-message chain itself as the bug, and redirecting to 'who arrives first' as the actual variable."
    - "git log -L on dev.ts:760-768 shows `await open(hostUrl)` was introduced in c793992c ('always-on multiplayer -- WS host + seat-picker client, no flag') and has been unconditional ever since (through Phase 111/135) -- i.e. this is a PRE-EXISTING characteristic of the always-on-multiplayer dev host, not a v4.5/Phase 135/138 regression. It only surfaces as a blocker now because Phase 138 is the first time an agent has driven `boardsmith dev` headlessly/scripted end-to-end via Playwright on a machine with a real default browser available."
  falsification_test: "Re-run the exact same Playwright smokes with the dev server spawned via `BROWSER=none npx boardsmith dev` (or with the new `--no-open` flag) -- if the scripted client is now consistently the FIRST (and only) WS client, auto-seated to seat 1, with isMyTurn true immediately for go-fish and no AI auto-discard race window for cribbage, the hypothesis is confirmed. If the mismatch persists identically with auto-open suppressed, the hypothesis is wrong and investigation must resume."
  fix_rationale: "The correct fix is NOT to change MultiplayerHost's seat-assignment logic (proven correct in isolation) -- it is to stop an uncontrolled second WS client (the auto-opened real browser) from silently competing for seat 1 in exactly the scenario (headless/scripted driving of `boardsmith dev`) where a human isn't there to notice/ignore that extra tab. Add a `--no-open` CLI flag (commander's negatable-option convention) threaded into DevOptions and guarding the `await open(hostUrl)` call. This is a minimal, targeted, root-cause fix (addresses 'who else connects', not 'what seat do we compute') and does not touch the game-session/seat logic that 175+ existing tests already cover."
  blind_spots: "Have not yet verified with a live browser+Playwright run using --no-open that the ORIGINAL blocked smokes (exactly-one-toast for go-fish, discard-not-auto-played for cribbage) now pass end-to-end -- only proven the auto-open mechanism exists and is unconditional, and proven the seat-assignment logic is correct in isolation. Need to re-run the actual verify-138-*.mjs scripts (updated to pass --no-open) to close the loop per CLAUDE.md 'verify behavior by running the application, not just reviewing code.'"
test: implement --no-open flag, then re-run verify-138-gofish.mjs / verify-138-cribbage.mjs (updated to spawn with --no-open) against the real dev servers
expecting: both scripts' previously-blocked assertions (exactly-one-toast, discard-not-auto-played) now pass
next_action: add --no-open option in src/cli/cli.ts + src/cli/commands/dev.ts, write a red-first regression test in dev.test.ts asserting open() is NOT called when --no-open/open:false is passed, then re-run the two smokes

## Symptoms

expected: connecting client (no --ai flag) claims first open non-AI seat; isMyTurn reflects server's actual seat assignment; in simultaneous-action-steps (cribbage discard) only the human should act for their own seat.
actual: go-fish - server internally consistent (aiSeats correct, flowState.currentPlayer correct) but client-displayed seat (badge, debug panel playerSeat, actionController.isMyTurn) disagrees with server's computed assignment for that client -> isMyTurn never true -> action bar never renders -> 'ask' action returns {success:false, error:'Not your turn'} forever. cribbage - same mismatch manifests as the real AI seat auto-playing a discard that client mislabels as "Player 2 (You)" during a simultaneousActionStep.
errors: "Not your turn" (go-fish execute('ask', ...) rejection)
reproduction: `npx boardsmith dev` in go-fish or cribbage example game repo (~/BoardSmithGames/), take seat as sole human (no --ai flag), 5/5 repro per prior smoke run (138-02-SUMMARY.md)
started: discovered by Phase 138 Plan 02 browser smokes (2026-07-04 per that summary); unknown yet if pre-existing latent bug (per dev-host-ai-op-race.md memory) or v4.5 regression (Phase 135 touched dev.ts seat-count/127.0.0.1 changes)

## Eliminated

## Evidence

- timestamp: 2026-07-03T00:00
  checked: .planning/debug/knowledge-base.md
  found: no matching prior resolved session (only checkers multi-jump hang, unrelated)
  implication: no shortcut hypothesis from KB; proceed with fresh investigation informed by dev-host-ai-op-race.md memory (documents 2 latent bugs in this exact subsystem: lost-update race in handleOp/runAITurns, and AI insta-acknowledge in simultaneousActionStep dueSeats)

## Resolution

root_cause: |
  `npx boardsmith dev` unconditionally calls `await open(hostUrl)` (src/cli/commands/dev.ts, using the `open` npm package) to auto-launch the machine's real default browser. That real browser tab connects over WS and, per MultiplayerHost.hello()'s "first arrival auto-seats" rule, claims seat 1 before any scripted/headless driver (Playwright) connects. The scripted driver then arrives as the SECOND client and lands in the seat-picker / joins whatever's left (seat 2). For go-fish (strict turn order, seat 1 due first) the scripted client's seat is never due -> isMyTurn never true. For cribbage's simultaneousActionStep discard phase, seat 2 was AI-owned during the brief window between game-start and the scripted client's join (humanSeats/aiSeats snapshotted in startGame() before the scripted client joins, and runAITurns() fires synchronously at the end of startGame()), so the AI auto-discarded for that seat before the scripted client could act. Confirmed pre-existing (not a v4.5/Phase 135/138 regression) via `git log -L` on dev.ts:760-768 — `await open(hostUrl)` has been unconditional since the "always-on multiplayer" feature (c793992c), well before Phase 111/135/138. It only surfaced now because Phase 138 is the first headless/scripted end-to-end drive of `boardsmith dev` on a machine with a real default browser available. The seat-assignment logic itself (assignSeat -> reinitSeat -> viewForSeat) was proven correct in isolation via an in-process MultiplayerHost harness probe (seat 1, isMyTurn:true, currentPlayer:1) before the auto-open hypothesis was formed.
  Direct evidence: a WS probe against a freshly spawned `npx boardsmith dev --port 5199` showed a 'lobby' broadcast with seat 1 already held by an unrecognized clientId (connected:true) arriving before the probe's own hello could claim it — proving a real browser tab auto-connected within ~4s of server start.
fix: |
  Added a `--no-open` CLI flag (commander negatable-option convention) threaded through `DevOptions.open` and a new pure/testable `shouldOpenBrowser(options)` helper guarding the `await open(hostUrl)` call in devCommand. Default behavior is unchanged (auto-opens a browser for normal interactive dev use); `--no-open` lets scripted/CI drivers of `boardsmith dev` become the sole WS client so seat assignment behaves deterministically.
verification: |
  1. Full BoardSmith suite: 175 files / 2371 tests green (including 3 new red-first `shouldOpenBrowser` tests in dev.test.ts, confirmed red before the fix, green after).
  2. Re-ran the two previously-BLOCKED Phase 138 Plan 02 smokes with the dev server spawned via `npx boardsmith dev --no-open`:
     - verify-138-gofish.mjs: PASS — sole client auto-seated straight into the game (no seat-picker), flow correctly awaiting seat 1 (its own seat), hidden-info checks clean before/after restore, exactly one failure toast on a rejected `ask` (UIX-01 + SEC-01 both green).
     - verify-138-cribbage.mjs: PASS — hand went 6 -> 4 cards via the script's own multiSelect clicks (not an AI auto-discard), flow correctly advanced from `discarding` to `play` waiting on seat 1.
  3. `lsof -ti:5173` / `:5199` confirmed empty after every run — no dev servers left running.
files_changed:
  - src/cli/commands/dev.ts
  - src/cli/commands/dev.test.ts
  - src/cli/cli.ts
