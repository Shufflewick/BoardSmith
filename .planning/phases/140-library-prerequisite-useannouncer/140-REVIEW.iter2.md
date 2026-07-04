---
phase: 140-library-prerequisite-useannouncer
reviewed: 2026-07-04T17:52:18Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/ui/composables/useAnnouncer.ts
  - src/ui/composables/useAnnouncer.test.ts
  - src/ui/components/GameShell.announcer.test.ts
  - src/ui/components/GameShell.vue
  - src/ui/index.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 140: Code Review Report

**Reviewed:** 2026-07-04T17:52:18Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the new `useAnnouncer()` composable, its unit tests, the GameShell wiring tests, the GameShell.vue integration (lines 341-361, live-region watchers at 1748-1821), and the public export in `src/ui/index.ts`. The composable is small, well-documented, and follows the established `createX`/`provideX`/`useX` pattern (useAnimationEvents). Exports are complete (`useAnnouncer`, `provideAnnouncer`, `createAnnouncer`, `ANNOUNCER_KEY`, `UseAnnouncerReturn`). The no-provider fallback is safe (no-op + dedup'd dev warning) and tested.

However, the deferred clear-then-set write scheduling interacts badly with GameShell's own synchronous live-region writes, producing a real (if narrow) race that can silently drop GameShell's turn-change/game-over/error announcements from the live region — and the docstring's "last-write-wins" claim is not actually honored in call order. There is now a second, divergent write discipline to the same refs, which is the root cause.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Deferred `nextTick` write can clobber a later GameShell announcement — "last-write-wins" contract is not honored

**File:** `src/ui/composables/useAnnouncer.ts:73-79` (interacting with `src/ui/components/GameShell.vue:1750-1821`)
**Issue:** `announce()` clears the target ref synchronously and commits the message on `nextTick`:

```typescript
target.value = '';
void nextTick().then(() => {
  target.value = message;
});
```

GameShell's own watchers write the same refs synchronously (`politeMessage.value = text` at GameShell.vue:1753, 1761, 1795; `assertiveMessage.value = text` at 1777, 1819). Both write paths are commonly triggered by the same state broadcast in the same tick — e.g., a custom UI watching state calls `announce('3 cards remain')` while GameShell's `isMyTurn` watcher fires "Your turn". Sequence: descendant's `announce()` clears and queues its deferred set → GameShell watcher writes "Your turn" synchronously → the pending `nextTick` callback overwrites it with the descendant's message. GameShell's announcement never reaches the live region (only its `emitAnnounce` postMessage relay fires), even though it was written *after* the descendant's call. This directly contradicts the docstring at useAnnouncer.ts:35 ("Collisions with GameShell's own announcements are last-write-wins") — the deferred write wins regardless of call order. Turn-change, game-over, and action-error announcements are exactly the ones a screen-reader user must not lose.
**Fix:** Make all writers share one scheduling discipline. Route GameShell's own five write sites through `announcer.announce(text)` / `announcer.announce(text, { assertive: true })` instead of raw ref assignment (this also removes the duplicated `emitAnnounce` calls). Alternatively, guard the deferred commit with a per-target write-sequence counter so a superseded deferred set is dropped:

```typescript
let seq = { polite: 0, assertive: 0 };
function announce(message, opts) {
  const level = opts?.assertive ? 'assertive' : 'polite';
  const target = level === 'assertive' ? assertiveMessage : politeMessage;
  const mySeq = ++seq[level];
  target.value = '';
  void nextTick().then(() => {
    if (seq[level] === mySeq) target.value = message;
  });
  emitAnnounce(level, message);
}
```

(Routing GameShell through the announcer is the pit-of-success fix: one write path, contract holds by construction.)

### WR-02: Two divergent write disciplines to the same live-region refs; GameShell's direct writes never re-announce duplicates

**File:** `src/ui/components/GameShell.vue:1750-1821`
**Issue:** The phase introduced clear-then-set semantics for descendant announcements but left GameShell's own five announcement sites writing `target.value = text` directly. Beyond enabling WR-01, this means repeated identical GameShell announcements do not re-announce (e.g., disconnect → reconnect → disconnect producing the same `announceConnectionChange` text leaves the ref value unchanged, so `aria-live` fires nothing on the repeat), while descendant announcements do re-announce. Same refs, two behaviors — the inconsistency will surprise the next person who touches either path.
**Fix:** Same as WR-01's preferred fix: replace each `politeMessage.value = text; emitAnnounce('polite', text);` pair with `announcer.announce(text)` (and the assertive pair with `announcer.announce(text, { assertive: true })`), making `createAnnouncer` the single chokepoint for live-region writes.

## Info

### IN-01: `emitAnnounce` relay fires for messages that may never reach the live region; empty messages unguarded

**File:** `src/ui/composables/useAnnouncer.ts:74-79`
**Issue:** The postMessage relay fires synchronously for every `announce()` call, but the live-region write is deferred and can be superseded by a subsequent call in the same tick (only the last message renders). A future host page relaying these messages will announce things the in-page live region never showed — acceptable, but worth a comment. Also, `announce('')` is not guarded: it clears the region and posts a relay message with empty text for no effect.
**Fix:** Early-return on empty/whitespace-only messages: `if (!message.trim()) return;`. Add a comment noting the relay is fire-per-call while the live region is last-render-wins.

### IN-02: GameShell's actual announcer wiring (lines 360-361) has no direct test coverage

**File:** `src/ui/components/GameShell.announcer.test.ts:10-14`
**Issue:** The test file deliberately mounts inline replica components rather than the real GameShell.vue (documented rationale, consistent with the existing GameShell.live-region.test.ts precedent — verified that file exists). Consequence: if GameShell.vue's `createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce })` call at line 360 drifted (e.g., refs swapped, `provideAnnouncer` removed), all tests would stay green. The replicas prove the composable, not the integration.
**Fix:** Acceptable given the established precedent, but note it in the phase verification as a known gap; a browser smoke test (announce from a game UI, inspect the `role="status"` node at GameShell.vue:1919) would close it.

### IN-03: Misleading dev warning when `useAnnouncer()` is called outside any component setup context

**File:** `src/ui/composables/useAnnouncer.ts:98-110`
**Issue:** If `useAnnouncer()` is called entirely outside `setup()` (no current instance), Vue's `inject()` returns `undefined` after logging its own "inject() can only be used inside setup" warning, and then `devWarn` reports "no ancestor GameShell providing an announcer" — the wrong diagnosis for that failure mode. Behavior is still safe (no-op returned).
**Fix:** Optionally check `getCurrentInstance()` first and emit a distinct message ("useAnnouncer() must be called during component setup"). Low priority; the same gap exists in sibling composables.

---

_Reviewed: 2026-07-04T17:52:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
