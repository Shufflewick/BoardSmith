# Follow Active Seat (dev-host) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime "follow active seat" toggle to the `boardsmith dev` multiplayer host so one client (the *follower*) controls whichever seat is currently awaiting input, pausing AI — letting a browser-automation agent drive a whole game solo.

**Architecture:** Override, don't reassign. The follower keeps its own seat; the host (a) attributes the follower's actions to the currently-due seat, (b) routes the due seat's view to the follower (re-`init` on change), and (c) pauses/resumes the AI pump by mutating the shared `aiSeats` array in place. All three hooks live in `MultiplayerHost`. The active seat is computed with the engine's existing `dueSeats(flowState)`; the host reads it from `session.host.flowState` (set before each broadcast). A WS op (`follow`) and a DevHost toolbar button toggle it.

**Tech Stack:** TypeScript (Node), Vitest (socket-free host unit tests), Vue 3 (DevHost.vue).

---

## File Structure

- `src/cli/dev-host/multiplayer-host.ts` — **modify.** Add `follow` to the
  `ClientInbound`/`HostOutbound` unions; add follower state + helpers; wire the
  three hook points; auto-disable on disconnect.
- `src/cli/dev-host/multiplayer-host.test.ts` — **modify.** Add an alternating
  finite test game and the follow-mode integration tests.
- `src/cli/dev-host/DevHost.vue` — **modify.** Add the toolbar toggle + reflect
  the echoed `follow` state.

No change is needed in `dev.ts` (its WS dispatch forwards any non-`hello`
message straight to `host.handleMessage`) or in `bridge.ts` (the host reads
`session.host.flowState` directly; `dueSeats` is imported from the engine).

---

### Task 1: Protocol — add the `follow` messages

**Files:**
- Modify: `src/cli/dev-host/multiplayer-host.ts` (the `HostOutbound` union at lines 38-44 and the `ClientInbound` union at lines 47-52)

- [ ] **Step 1: Add `follow` to both message unions**

In `src/cli/dev-host/multiplayer-host.ts`, change the `HostOutbound` union to add a `follow` echo (last member):

```typescript
/** Messages the host sends to a client. */
export type HostOutbound =
  | { type: 'lobby'; phase: LobbyPhase; seats: SeatInfo[]; minPlayers: number; playerCount: number }
  | { type: 'joined'; seat: number }
  | { type: 'error'; message: string }
  | { type: 'init'; seat: number }
  | { type: 'game_state'; view: unknown; isComplete: boolean; winners: number[] }
  | { type: 'server_response'; requestId: string | null; result: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean; seat: number };
```

And change the `ClientInbound` union to add the toggle (last member):

```typescript
/** Messages a client sends to the host. */
export type ClientInbound =
  | { type: 'hello' }
  | { type: 'join'; seat: number; name?: string; color?: string }
  | { type: 'leave' }
  | { type: 'restart' }
  | { type: 'server_request'; requestId: string; op: string; payload: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no new errors). The new `follow` arm isn't handled in the
`handleMessage` switch yet, but TypeScript's `switch` on a union without a
`default` does not error on unhandled cases here, so this compiles. (It will be
handled in Task 3.)

- [ ] **Step 3: Commit**

```bash
git add src/cli/dev-host/multiplayer-host.ts
git commit -m "feat(dev-host): add follow-active-seat WS message types"
```

---

### Task 2: Import `dueSeats` and add follower state + helpers

**Files:**
- Modify: `src/cli/dev-host/multiplayer-host.ts`

- [ ] **Step 1: Import `dueSeats` and its state type**

At the top of `src/cli/dev-host/multiplayer-host.ts`, below the existing imports (after line 19 `import type { Op, OpResult } from '../../session/index.js';`), add:

```typescript
import { dueSeats, type SeatActivityState } from '../../engine/index.js';
```

Verify the engine barrel re-exports them:

Run: `grep -n "dueSeats\|SeatActivityState" src/engine/index.ts`
Expected: both names appear in the export list. If `SeatActivityState` is not
exported there, import it from `'../../engine/flow/seat-activity.js'` instead
and keep `dueSeats` from the barrel.

- [ ] **Step 2: Add follower fields**

In the `MultiplayerHost` class, right after the `aiSeats` field (line 95
`private aiSeats: Array<{ seat: number; level?: string }> = [];`), add:

```typescript
  /** The client (if any) that follows the active seat — it controls whichever
   *  seat is currently awaiting input, and AI is paused while it is set. */
  private followerClientId: string | null = null;
  /** The active seat last shown to the follower, to re-init only on change. */
  private lastFollowerSeat: number | null = null;
```

- [ ] **Step 3: Add the `effectiveActiveSeat` + `rebuildAiSeats` helpers**

In the `// ── Seat helpers ──` region, after `addAiSeat` (after line 250), add:

```typescript
  /**
   * The seat a follower acts as / sees right now: the first seat awaiting input,
   * falling back to the follower's own seat when nothing is due (execute blocks,
   * game over). The follower steals every active seat unconditionally.
   */
  private effectiveActiveSeat(): number {
    const due = this.session
      ? dueSeats(this.session.host.flowState as SeatActivityState | null)[0]
      : undefined;
    const own =
      this.followerClientId !== null ? this.clientSeat.get(this.followerClientId) : undefined;
    return due ?? own ?? 1;
  }

  /** Rebuild the shared AI-seat list in place from currently open seats. */
  private rebuildAiSeats(): void {
    this.aiSeats.length = 0;
    for (let seat = 1; seat <= this.opts.playerCount; seat++) {
      const info = this.seats.get(seat);
      const heldByConnectedHuman = info?.clientId && info.connected;
      if (!heldByConnectedHuman) this.aiSeats.push({ seat, level: this.opts.aiLevel });
    }
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS. (`effectiveActiveSeat`/`rebuildAiSeats` are currently unused — that
is fine; they're consumed in Task 3. If your tsconfig has
`noUnusedLocals`/private-unused checks that flag this, ignore until Task 3, where
they get callers. `tsc` does not error on unused private methods by default.)

- [ ] **Step 5: Commit**

```bash
git add src/cli/dev-host/multiplayer-host.ts
git commit -m "feat(dev-host): follower state + active-seat/ai-seat helpers"
```

---

### Task 3: Wire the three hook points + enable/disable + disconnect

**Files:**
- Modify: `src/cli/dev-host/multiplayer-host.ts`

- [ ] **Step 1: Route the `follow` message in `handleMessage`**

In `handleMessage` (the switch at lines 154-167), add a `follow` case before the
closing brace of the switch:

```typescript
      case 'server_request':
        return this.handleServerRequest(clientId, msg);
      case 'follow':
        return this.handleFollow(clientId, msg);
```

- [ ] **Step 2: Add the `handleFollow` method**

Add this method right after `handleServerRequest` (after line 225):

```typescript
  /** Toggle "follow active seat" for a client (must be seated and in a game). */
  private async handleFollow(
    clientId: string,
    msg: Extract<ClientInbound, { type: 'follow' }>,
  ): Promise<void> {
    if (!msg.enabled) {
      // Disable: only the current follower can turn it off.
      if (this.followerClientId !== clientId) return;
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.rebuildAiSeats();
      const own = this.clientSeat.get(clientId);
      this.send(clientId, { type: 'follow', enabled: false, seat: own ?? 0 });
      if (own !== undefined && this.phase === 'playing') this.reinitSeat(clientId, own);
      await this.session?.host.runAITurns(); // resume AI for the seats it covered
      return;
    }
    // Enable.
    if (this.phase !== 'playing' || !this.session) {
      this.send(clientId, { type: 'error', message: 'Start a game before enabling follow-active-seat.' });
      return;
    }
    if (!this.clientSeat.has(clientId)) {
      this.send(clientId, { type: 'error', message: 'Take a seat before enabling follow-active-seat.' });
      return;
    }
    this.followerClientId = clientId;
    this.aiSeats.length = 0; // pause AI for every seat the follower now covers
    const active = this.effectiveActiveSeat();
    this.lastFollowerSeat = active;
    this.send(clientId, { type: 'follow', enabled: true, seat: active });
    this.reinitSeat(clientId, active);
  }
```

- [ ] **Step 3: Hook action attribution in `handleServerRequest`**

In `handleServerRequest`, replace the seat lookup (lines 219-223):

```typescript
    const seat = this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, { type: 'error', message: 'You are not seated in this game.' });
      return;
    }
    await this.session.handleServerRequest(seat, msg.requestId, msg.op, msg.payload);
```

with the follower override:

```typescript
    // A follower acts as whichever seat is currently due, not its own seat.
    const seat =
      clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
    if (seat === undefined) {
      this.send(clientId, { type: 'error', message: 'You are not seated in this game.' });
      return;
    }
    await this.session.handleServerRequest(seat, msg.requestId, msg.op, msg.payload);
```

- [ ] **Step 4: Hook view routing — replace the `postGameState` callback**

In `startGame`, replace the inline `postGameState` callback (lines 285-291):

```typescript
      postGameState: (seat, view, meta) =>
        this.sendToSeat(seat, {
          type: 'game_state',
          view,
          isComplete: meta.isComplete,
          winners: meta.winners,
        }),
```

with a call to a new method:

```typescript
      postGameState: (seat, view, meta) => this.deliverGameState(seat, view, meta),
```

Then add the `deliverGameState` method right after `sendToSeat` (after line 361):

```typescript
  /**
   * Send a `game_state` frame to the seat's client. For the follower, override
   * the seat with the currently-active seat: re-`init` when it changes, and send
   * that seat's freshly-computed view (so the follower drives whoever is due).
   */
  private deliverGameState(
    seat: number,
    view: unknown,
    meta: { isComplete: boolean; winners: number[] },
  ): void {
    const info = this.seats.get(seat);
    if (!info?.clientId || !info.connected) return;
    if (info.clientId === this.followerClientId) {
      const active = this.effectiveActiveSeat();
      if (active !== this.lastFollowerSeat) {
        this.send(info.clientId, { type: 'init', seat: active });
        this.lastFollowerSeat = active;
      }
      const activeView = this.session?.viewForSeat(active);
      this.send(info.clientId, {
        type: 'game_state',
        view: activeView ?? view,
        isComplete: meta.isComplete,
        winners: meta.winners,
      });
      return;
    }
    this.send(info.clientId, {
      type: 'game_state',
      view,
      isComplete: meta.isComplete,
      winners: meta.winners,
    });
  }
```

- [ ] **Step 5: Reset follow-mode on restart**

`restart` calls `startGame`, which reassigns `aiSeats` — a stale follower would
leave the flag set while AI runs. Reset it. In `handleRestart` (lines 169-176),
before `await this.startGame();`, add:

```typescript
    if (this.followerClientId !== null) {
      const ex = this.followerClientId;
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.send(ex, { type: 'follow', enabled: false, seat: this.clientSeat.get(ex) ?? 0 });
    }
```

- [ ] **Step 6: Auto-disable follow on the follower's disconnect**

In `disconnect` (lines 140-150), before the final `this.broadcastLobby();`, add:

```typescript
    if (this.followerClientId === clientId) {
      // The follower drove every seat; resume AI so the game isn't stuck on it.
      this.followerClientId = null;
      this.lastFollowerSeat = null;
      this.rebuildAiSeats();
      void this.session?.host.runAITurns();
    }
```

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli/dev-host/multiplayer-host.ts
git commit -m "feat(dev-host): follow-active-seat hooks (attribution, view, ai pause)"
```

---

### Task 4: Integration tests for follow-mode

**Files:**
- Modify: `src/cli/dev-host/multiplayer-host.test.ts`

- [ ] **Step 1: Add a finite alternating test game**

In `src/cli/dev-host/multiplayer-host.test.ts`, update the engine import (line 2)
to include `eachPlayer` (it already imports `actionStep`, `loop`, `defineFlow`):

```typescript
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
```

Then, after the existing `PassGame`/`def` block (after line 26), add a finite
game where seats alternate and the game ENDS after each seat acts once (so
"AI moved vs. paused" is observable via `isComplete`):

```typescript
// Each seat passes exactly once (no outer loop), then the flow completes →
// game over. Lets tests observe whether AI played the open seat (isComplete)
// and whether the follower borrows the active seat as it rotates.
class AlternateGame extends Game<AlternateGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    );
  }
}

const altDef: GameDefinitionLike = {
  gameClass: AlternateGame as new (...args: unknown[]) => unknown,
  gameType: 'alternate',
  minPlayers: 2,
  maxPlayers: 2,
};

function makeAltHost() {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    makeSeed: () => 'alt',
    executeOp: (gameOptions, snap, pend, op) => executeOp(altDef, gameOptions, snap, pend, op),
    send: (clientId, msg) => sent.push({ clientId, msg }),
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const has = (clientId: string, type: HostOutbound['type']) => to(clientId).some((m) => m.type === type);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type) as any;
  const pass = (clientId: string, requestId: string) =>
    host.handleMessage(clientId, {
      type: 'server_request',
      requestId,
      op: 'action',
      payload: { actionName: 'pass', args: {} },
    });
  return { host, sent, to, has, lastOfType, pass, clear: () => (sent.length = 0) };
}
```

- [ ] **Step 2: Run the existing suite to confirm the new game/harness compiles and nothing regressed**

Run: `npx vitest run src/cli/dev-host/multiplayer-host.test.ts`
Expected: PASS — the 9 existing tests still pass; the new helpers add no tests yet.

- [ ] **Step 3: Write the baseline test — AI plays the open seat (control case)**

Add this `describe` block at the end of the file (after the closing `});` of the
existing `describe`):

```typescript
describe('MultiplayerHost — follow active seat', () => {
  it('baseline: without follow, AI plays the open seat and the game completes', async () => {
    const { host, lastOfType, pass } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = AI
    await pass('A', 'r1'); // A passes seat 1 → AI passes seat 2 → flow completes
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });
```

- [ ] **Step 4: Run it to verify the baseline passes**

Run: `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "AI plays the open seat"`
Expected: PASS. (If it fails because `isComplete` is false, the AI did not play
seat 2 — confirm `aiTurn` runs for seat 2 in this harness before proceeding.)

- [ ] **Step 5: Write the follow-pauses-AI + borrows-active-seat test**

Add inside the same `describe`:

```typescript
  it('enabling follow pauses AI and lets one client drive both seats', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = AI
    clear();

    // Enable follow while seat 1 (A's own seat) is active.
    await host.handleMessage('A', { type: 'follow', enabled: true });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: true, seat: 1 });

    // A passes as seat 1. AI must NOT play seat 2 — instead the follower is
    // handed seat 2 (init seat 2) and the game is NOT complete.
    clear();
    await pass('A', 'r1');
    expect(lastOfType('A', 'init').seat).toBe(2);
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);

    // A now passes as seat 2 (attributed to the active seat) → flow completes.
    clear();
    await pass('A', 'r2');
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "drive both seats"`
Expected: PASS.

- [ ] **Step 7: Write the disable-resumes-AI test**

Add inside the same `describe`:

```typescript
  it('disabling follow mid-game resumes AI for the open seat', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // seat 1 passed; now seat 2 is active, AI paused
    clear();

    // Disable while seat 2 is active → seat 2 reverts to AI, which passes →
    // flow completes.
    await host.handleMessage('A', { type: 'follow', enabled: false });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });
```

- [ ] **Step 8: Write the precondition + disconnect tests**

Add inside the same `describe`, then close it:

```typescript
  it('rejects enabling follow when the client holds no seat', async () => {
    const { host, lastOfType } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A seated, game live
    await host.handleMessage('B', { type: 'hello' }); // B unseated (seat-picker)
    await host.handleMessage('B', { type: 'follow', enabled: true });
    expect(lastOfType('B', 'error').message).toMatch(/take a seat/i);
  });

  it('the follower disconnecting resumes AI so the game is not stuck', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // seat 2 active, AI paused
    host.disconnect('A'); // follower gone → AI should resume and finish
    // Let the fire-and-forget AI pump settle.
    await new Promise((r) => setTimeout(r, 0));
    clear();
    // Reconnect to observe the now-complete state.
    await host.handleMessage('A', { type: 'hello' });
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });

  it('restart resets follow-mode and echoes it disabled', async () => {
    const { host, lastOfType } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
  });
});
```

- [ ] **Step 9: Run the full file**

Run: `npx vitest run src/cli/dev-host/multiplayer-host.test.ts`
Expected: PASS — all existing tests plus the 6 new follow tests.

- [ ] **Step 10: Commit**

```bash
git add src/cli/dev-host/multiplayer-host.test.ts
git commit -m "test(dev-host): follow-active-seat integration tests"
```

---

### Task 5: DevHost toolbar toggle

**Files:**
- Modify: `src/cli/dev-host/DevHost.vue`

- [ ] **Step 1: Add the `followActive` ref**

In `DevHost.vue`, after `const errorMsg = ref<string | null>(null);` (line 45), add:

```typescript
const followActive = ref(false);
```

- [ ] **Step 2: Reflect the echoed `follow` state**

In `onHostMessage`'s switch (after the `server_response` case, before the
closing `}` of the switch, line 125), add:

```typescript
    case 'follow':
      followActive.value = msg.enabled as boolean;
      break;
```

- [ ] **Step 3: Add the `toggleFollow` action**

After the `newGame` function (line 170), add:

```typescript
function toggleFollow(): void {
  wsSend({ type: 'follow', enabled: !followActive.value });
}
```

- [ ] **Step 4: Add the toolbar button**

In the in-game chrome's `dev-chrome__bar-actions` (lines 275-277), add the
toggle before the "New game" button:

```html
          <div class="dev-chrome__bar-actions">
            <button
              type="button"
              class="btn"
              :class="{ 'btn--on': followActive }"
              :aria-pressed="followActive"
              @click="toggleFollow"
            >
              {{ followActive ? 'Following active seat' : 'Follow active seat' }}
            </button>
            <button type="button" class="btn btn--start" @click="newGame">New game</button>
          </div>
```

- [ ] **Step 5: Add the `btn--on` style**

In the `/* ── Buttons ── */` section, after the `.btn--start:disabled` rule
(line 445), add:

```css
.btn--on {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.15);
  color: #00d9ff;
}
```

- [ ] **Step 6: Verify the Vue file type-checks / builds**

Run: `npx vue-tsc --noEmit -p tsconfig.json 2>/dev/null || npx tsc --noEmit -p tsconfig.json`
Expected: PASS. (If the project has no `vue-tsc`, the plain `tsc` check from the
earlier tasks plus the build below is sufficient.)

- [ ] **Step 7: Commit**

```bash
git add src/cli/dev-host/DevHost.vue
git commit -m "feat(dev-host): follow-active-seat toolbar toggle"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the dev-host test suite**

Run: `npx vitest run src/cli/dev-host/`
Expected: PASS — all dev-host tests green.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 3: Lint the touched files**

Run: `npx eslint src/cli/dev-host/multiplayer-host.ts src/cli/dev-host/DevHost.vue`
Expected: PASS (no new errors).

- [ ] **Step 4: Manual browser smoke test (Chrome extension)**

Start the dev server on an example game with one AI seat:

```bash
cd ~/BoardSmithGames/checkers   # or any 2-player example
boardsmith dev --ai 2
```

Then in the browser (via the Claude-in-Chrome tools): open the dev URL, confirm
you're auto-seated as seat 1, click **Follow active seat**, take your turn, and
verify that when it becomes seat 2's turn the board flips to seat 2's view (the
seat badge updates) and you can play seat 2's move — with the AI not auto-playing.
Toggle it off and confirm the AI resumes seat 2.

**Kill the dev server when done** (do not leave it running).

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(dev-host): follow-active-seat verification cleanup" --allow-empty
```

---

## Notes for the implementer

- **Shared-array invariant:** `aiSeats` is shared by reference with the session's
  AI pump. NEVER reassign `this.aiSeats` after the session is created — only
  mutate in place (`.length = 0`, `.push`, `.splice`). `startGame` reassigns it
  *before* creating the session (line 263), which is fine; everything after must
  mutate in place. The helpers in this plan all do.
- **Why `effectiveActiveSeat` reads `session.host.flowState`:** `apply()` in
  `SnapshotSessionHost` sets `this.flowState = res.flowState` *before* calling
  `broadcast`, so during the `postGameState`/`deliverGameState` callback the host's
  `flowState` already reflects the post-op state — exactly the seat that's now due.
- **Read-only ops:** `resolve_choices`/`selection_step` from the follower are also
  attributed to `effectiveActiveSeat()`. That's correct — they belong to the seat
  the follower is currently driving.
