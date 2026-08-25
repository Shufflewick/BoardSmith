# Simultaneous and Interrupt Semantics When Players Are Hours Apart

This document is the specification deliverable for Phase 68 / BSMITH-05. It is
written **before** the code that implements it and before the tests that hold
it, because a test written after the code proves the code does what it does,
not what it should.

It answers one question: **what happens to a submission composed against a flow
position that has since moved on?**

---

## 1. "Interrupt" — a definition this phase MADE, not one it inherited

`grep -rn "interrupt" src/engine/ src/session/ src/runtime/` returns **zero**
matches. The `FlowNode` union (`src/engine/flow/types.ts:250`, exhaustively
switched at `src/engine/flow/describe-flow-position.ts`) has no such variant:

| `FlowNode` variant | More than one seat may legally act? |
|---|---|
| `sequence` | no — structural, holds no seat |
| `loop` | no — structural |
| `repeat` | no — structural |
| `each-player` | no — structural; it *iterates* seats, one at a time |
| `for-each` | no — structural |
| `if` | no — structural |
| `switch` | no — structural |
| `phase` | no — structural |
| `execute` | no — no player input at all |
| `action-step` | no — exactly one seat is up |
| `simultaneous-action-step` | **yes** |

So the requirement's second noun names nothing in the engine. Rather than
silently treat "interrupt" as a synonym for "simultaneous step" — which would
hide the fact that a choice was made — this phase **defines** it:

> **Interrupt** — any flow position at which *more than one seat may legally
> act*. Its only implementation in BoardSmith today is
> `simultaneousActionStep`.

The definition is deliberately about the *position*, not about the node type,
so it survives the addition of a new node. Everything in section 2 onward is
stated in terms of the boundary key, which is derived from the flow position
and not from the node type, so **a genuine interrupt node added later inherits
this specification automatically**. What such a node WOULD have to do to stay
covered is: advance `position.path` when its window closes, exactly as
`loop`/`repeat`/`each-player` already do (see
`src/engine/flow/boundary-key.ts`). A node that re-opened a fresh window
*without* moving `path` would be invisible to every consumer of the key, and
that is the one way this specification could be defeated.

## 2. The rule for an hours-apart submission

A simultaneous round may span days. Between a seat rendering the board and that
seat pressing the button, the round it was looking at can close and the **same
step can re-open for the next round**, with the same seats due and the same
actions available. Nothing in a seat set can see that: a 2-seat round
transitions `[1,2] → [1,2]` across a real boundary.

Therefore:

> **A submission names the boundary it was composed against, and the engine
> refuses a submission that names a boundary which has closed.**

Concretely:

- The `action` and `selectionStep` ops carry a **required** `boundaryKey:
  string`. Required, not optional: an optional token is a bypass that every
  un-updated caller takes by default, and silently.
- The engine compares `op.boundaryKey` with `flowBoundaryKey(<the flow state of
  the snapshot the op is being run against>)` **before** the action is
  performed.
- On a mismatch, the op is **refused** — `success: false` with an actionable
  message. Not thrown, not an `ENGINE_ERROR`, not applied to the current round.

The refusal is graceful and per-seat, matching the contract
`resumeSimultaneousAction` already keeps for double-submits and stale clients
(`src/engine/flow/engine.ts`): *"ordinary player-input races in concurrent play
— not developer errors."* The staleness refusal is the same kind of thing, and
it produces the same kind of result.

### The token is opaque, and minted by the engine

The key rides OUT to each seat on the broadcast it already receives
(`meta.turnBoundary.key`, added in 68-03) and is **echoed back** on the
submission. Consumers do not compute it: the ShufflewickPub browser client
cannot — `boardsmith` is not one of its dependencies.

The engine therefore treats `boundaryKey` as **a token it minted and is being
handed back**. It is compared for **equality and nothing else**. It is never
parsed, never destructured, and a structurally-similar-but-different value is
never accepted as "close enough". Equality or refusal.

That is safe to hand to an untrusted client because the key's material is
`position.path` and `complete` only — both of which already fan out to every
seat and to the spectator in `buildViews`. The key discloses nothing.

## 3. The message contract

> *"A cap that wedges the system when it is hit is not a guardrail — it is a
> trap you built. Every refusal must leave the caller a way forward."*

The refusal names what happened and what to do. The exact sentence is:

```
The round you acted in has closed; reload to see the current round.
```

And the rule the sentence exists to serve:

- **The seat is NOT wedged.** After a refusal, the seat remains able to act in
  the CURRENT round. Re-submitting the same action with the current boundary
  key succeeds. A refusal costs the player a reload, never their turn.
- **The message carries no internals.** No stack trace, no file path, no
  frame path, no internal identifier. It names the round state and the recovery
  action, and nothing else.
- **No `errorCode` is fabricated.** Per the rule already stated on `OpResult`,
  `errorCode` is "undefined for protocol-level failures that have no upstream
  errorCode to forward — never fabricated." A staleness refusal is detected in
  the session layer before any runner call, so there is no upstream code to
  forward and the field is absent.

## 4. The authorization rule

**This is the security-load-bearing sentence of this document.**

> The boundary key is a **rejection input only**. It can narrow what is
> permitted; it can never widen it.

Which means, precisely:

- The comparison runs **before** `performAction` / `processSelectionStep`, and
  its only two outcomes are "refuse" and "carry on to the checks that already
  existed".
- `canPlayerAct` / `dueSeats` / `awaitingPlayers` / the game author's
  `.condition(...)` remain the **sole** authorities on whether an action is
  legal. A correct boundary key is not a permission and buys nothing.
- A submission carrying a *correct* key from a seat that may not act is refused
  with exactly the message the engine gives today (`Player N has already
  completed their action`, `Action X is not available for player N`, `Not
  <name>'s turn`). Those strings are unchanged by this phase.
- **An absent key is refused, never defaulted.** There is no
  `?? flowBoundaryKey(current)` anywhere on any path. A default there would
  make the whole mechanism decorative while every suite stayed green — it is
  the exact defect this specification exists to close.
- **A malformed key is a mismatch, and nothing more.** A key of the wrong type,
  the wrong shape, or an absurd length is not parsed, not validated by a
  separate path, and never throws. It simply is not equal to the current key,
  so it takes the same single refusal contract every other mismatch takes.

## 5. What this specification does NOT cover

- **Deadline expiry, caretaker takeover, and round scheduling** are *platform
  policy*, not engine semantics. `scheduleRoundExpiry` and `resolveExpiredSeats`
  live in ShufflewickPub's Durable Object and decide *when* a round is allowed
  to close and who acts for a silent seat. The engine has no opinion; it only
  states which round it is in, and refuses submissions from a round that is not
  that one.
- **Un-takeover / seat reclamation** — what happens to a seat that a caretaker
  bot acted for, when the human returns — is deferred and is deliberately not
  specified here.
- **Ordering.** The boundary key is an identity, not a clock. It says "this is a
  different round", never "this is a later round". A consumer that needs
  ordering keeps its own monotonic counter and advances it when the key changes
  (the platform's `turnSeq` does exactly this).

## 6. The cases the tests hold

Held by `src/session/testing/stale-submission.test.ts`, driven on
`src/session/testing/fixtures/simultaneous-rounds-fixture.ts` (multi-round
simultaneous) and `src/session/testing/fixtures/collect-turns-fixture.ts`
(sequential, real `eachPlayer` turn boundaries, plus a selection-step action).

| # | Case | Expected |
|---|---|---|
| 1 | Simultaneous: a `commit` composed in round 1, submitted after round 2 has opened | Refused. The action does **not** land in round 2 — seat 1's `committed` flag in round 2 is still false. |
| 2 | The refusal message | Exactly the sentence in §3 — named, not pattern-matched loosely. |
| 3 | The refusal is not a wedge | Immediately re-submitting with the CURRENT key succeeds and the seat commits in round 2. |
| 4 | No crash | The refusal resolves an `OpResult`; it never throws, and `errorCode` is absent (§3). |
| 5 | Authorization narrows only | A **correct** key from a seat that has already completed is still refused, with the engine's pre-existing message, unchanged. |
| 6 | Sequential games too | On a sequential fixture, a previous turn's key is refused and the current key succeeds. The rule is not simultaneous-only. |
| 7 | `selectionStep` | A mid-action selection composed against a closed boundary is refused, by the same single guard. |
| 8 | Malformed key | A wrong-typed / absurd key is a plain mismatch: the same graceful refusal, no separate parse path, no throw. |

### On case 7, and why the selection path is still guarded

A multi-step selection is *itself* the thing that can span a boundary: a seat
opens an action, is presented with a pick, and answers it hours later. The
snapshot the selection runs against may by then be in a different round, and
the seat's `pendingState` alone cannot see that — it names an action and a
selection, never a round. So the selection path is guarded by the **same single
comparison** as `action`, not by a second one.

There is exactly ONE comparison site, in `executeOp`, keyed on the presence of
the `boundaryKey` field rather than on a list of op types. That is deliberate:
any op that is later given a boundary key is guarded the moment it has one, and
a token-bearing op that bypasses the guard is not expressible.

## 7. Who legitimately stamps the current key

The distinction that matters is **whose intent is being carried**.

- A **player's** submission must echo the key it was rendered with. Stamping the
  current key on a player's behalf is the defect, not the fix.
- A **server-composed op acting NOW** — the AI pump, a demo playback step, an
  in-process headless driver — legitimately stamps the current key, because
  there is no interval between composing and submitting for a round to close
  in. Every such site says so in a comment at the site.

