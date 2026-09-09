# The engine contract

**Who this is for:** anyone changing BoardSmith, and anyone maintaining
ShufflewickPub. It replaces the ad-hoc "tell the platform team when something
big changes" convention with a mechanism that runs on every test.

---

## The problem it solves

A published game does not carry an engine. `boardsmith build` marks
`boardsmith` and all its subpaths as `external`, so `dist/rules/rules.js`
contains only game code. At runtime the ShufflewickPub executor supplies the
engine from **its own vendored copy** of BoardSmith.

The consequence is unintuitive and worth stating plainly:

> A game's rules run on the engine **the platform vendored**, not the engine
> the game was built against.

So "we changed BoardSmith" does not mean "the platform changed". And "a game
re-published" does not mean "it picked up the new engine". Those only happen
when the platform **re-vendors**. Two failure modes follow, and both are silent:

1. **The platform lags.** An engine fix or behaviour change never reaches
   production because nobody re-vendored. This is how the `Deck` default
   stopped reporting draw-pile counts for months without anyone noticing.
2. **The platform lags *and* a game moves ahead.** A game built against a newer
   BoardSmith uses an API the vendored engine does not have. It publishes fine
   and breaks at runtime, usually as something baffling like a blank action bar.

`BUNDLE_PROTOCOL_VERSION` already existed but cannot catch either: by design it
bumps only when an already-built `rules.js` stops running at all, which is rare
and is a different question from "should the platform re-vendor?"

---

## The three numbers, and what each one means

| Number | Lives in | Bumped when | Who reads it |
|---|---|---|---|
| `revision` | `src/contract/engine-contract.json` | the platform-reachable API surface, the player-view payload, or the world serialization format changes | the platform's `vendor:check`; stamped into every manifest as `engineRevision` |
| `bundleProtocol` | same file | an already-built `rules.js` would stop working — a true ABI break | the games worker, which rejects mismatched bundles outright |
| package `version` | `package.json` | never, in practice | nobody; it is not a release channel |

`revision` is the everyday one. `bundleProtocol` is the emergency one. They are
deliberately separate: conflating them would either force every game to be
rebuilt for a harmless change, or let a real break slip through unannounced.

The JSON file is the **single source of truth for both**.
`src/engine/protocol-version.ts` reads `bundleProtocol` from it rather than
declaring a literal, so the constant the engine exports and the number the
platform's tooling reads cannot drift apart.

---

## How a change gets noticed

Three fingerprints, all recomputed by `src/contract/engine-contract.test.ts` on
every test run:

- **`surfaceHash`** — the sorted runtime export names of the three entrypoints
  the platform can reach: `boardsmith` and `boardsmith/session` (supplied to
  game rules by the executor's `sandboxedRequire`) and
  `boardsmith/session-host` (imported directly by the games worker). Catches
  added, removed, and renamed API.
- **`payloadHash`** — what a fixed fixture in `src/contract/fingerprint.ts`
  ships to clients, on **both backends**. Catches semantic changes that leave
  the API identical but alter what a player receives.

  On the TABLE side it is a canonical per-player view: a default `Deck`, an
  owner-visible hand, an explicitly count-only pile and an explicitly hidden
  pile, because those are the shapes whose defaults have actually bitten us —
  plus the serialized flow position the platform stores and restores.

  On the WORLD side it is **one seat's projected view** of a five-seat village
  whose declaration names a subset of its partitions, with one resident
  partition it does not name and a holding that references its owner. A world
  view is pruned twice — to the partitions the seat declared, and to the seat's
  own player — and those prunes decide what every watcher of every world
  receives. Before BoardSmith #181 no fixture projected a world view at all, so
  a change to that minted no revision.

  What the world side does NOT cover is everything a world *does* rather than
  shows: the fixture registers no actions, so dispatch, event routing, the
  dirty set, scheduling and refusals move neither hash. The world *wire*'s
  shape — including an event's narration `text`/`type` — is covered by
  `WORLD_WIRE_FIXTURE`, but as a hand-written literal rather than something the
  engine produced.
- **`formatHash`** — the stored form of a **world's durable partitions**: a
  round trip over `src/contract/format-fixture.json`, a committed corpus of
  partition bytes this engine once wrote. The hash covers the corpus, what the
  engine writes today, and what it writes after *reading the corpus back* —
  once with a single partition resident and once with both, so a reference into
  a partition that is not resident is exercised.

  It is deliberately a round trip and not a hash of an output. The one format
  break already in ShufflewickPub's world archive was **reader-only**: the
  `WORLD_PARTITION_ID_FLOOR` check entered `adoptSubtree` in r46, no byte
  changed, and every world written before it stopped being adoptable. A
  writer-side hash calls r44 and r46 the same format and licenses exactly the
  swap that corrupts the world.

  This is the fingerprint a **live world's durability** turns on. Two revisions
  declaring the same `formatHash` can be swapped under a running world;
  ShufflewickPub reads it to decide which archived runner a world gets, instead
  of pinning the world to its launch engine for life (ShufflewickPub #390).

  What it does NOT cover: the parent-to-child checkpoint answer *shape*, views,
  offers, flow position, refusals, `applyCommand`, `onEvent`, scheduling and
  the game root's own `toJSON` fields. None of those is a byte a partition
  holds, and a format hash that moved for them would refuse runner swaps that
  are safe.

  An engine that can no longer read the corpus **cannot produce this hash at
  all**, and says so by name. That is a deliberate format break: it ends every
  live world holding the old bytes, there is no migration because nothing can
  read them, and `boardsmith contract --regenerate-format` is how someone
  accepts that cost rather than a way around it.

If any of the three moves and the contract was not updated, the test fails with
the command to run. **That is the whole enforcement story** — you cannot land a
platform-visible engine change without either recording it or deleting a test.

### The known limit

`surfaceHash` sees runtime values only. `verbatimModuleSyntax` erases type-only
exports, so changing an exported **type** — adding an optional field to
`PlayerStateView`, say — moves neither hash unless it also changes a real
payload. Type-level contract changes still need a judgement call. If you make
one, extend the fixture so the change becomes visible, then update the contract.

This limit is stated rather than hidden because a fingerprint people
over-trust is worse than one they understand.

---

## Protocol: changing BoardSmith

1. Make your change.
2. Run `boardsmith test` (or `boardsmith contract` on its own for just this check).
3. If `engine contract` fails, that is the system working. Record the change:

   ```
   boardsmith contract --update --summary "Deck defaults to count-only; draw piles report size again"
   ```

   `--summary` is required. It is the text the platform maintainer reads when
   deciding whether to re-vendor, so write it for them, not for yourself.
   For a true ABI break add `--breaking`, which also bumps `bundleProtocol`.
4. Commit `src/contract/engine-contract.json` with your change.

The command refuses to bump when nothing actually moved, so revisions stay
meaningful.

### When nothing moved and the platform still has to run it

A performance fix alters no surface, no payload and no stored byte, so no
fingerprint can see it — and the platform archives each engine BUILD under its
revision number and refuses to overwrite one, because a revision must identify
exactly one engine. A build with no number of its own therefore cannot reach a
live world at all.

`--adopt` records a revision for exactly that: a change the platform must
archive and run, that nothing here can detect.

```
boardsmith contract --update --adopt --summary "<why the platform must run this build>"
```

It is refused when the contract DID move, so "the platform must adopt this"
cannot become the sentence every revision carries.

## Protocol: updating the platform

On ShufflewickPub:

```
npm run vendor:check       # is our vendored engine behind? what changed?
npm run vendor:boardsmith  # re-pack, install into games/ and executor/, verify
```

`vendor:check` compares the installed engine's contract against BoardSmith's
current one and prints every intervening revision summary, so the decision is
made from a changelog rather than a hash. It classifies the result:

- **in sync** — nothing to do.
- **behind** — re-vendor when convenient; game behaviour on the platform is
  frozen at the older engine until you do.
- **behind, ABI break** — re-vendor *and* rebuild/republish every game; already
  published bundles are invalid.

See `docs/BOARDSMITH-VENDORING.md` in the ShufflewickPub repo for the full
platform-side runbook.

## Protocol: publishing a game

`boardsmith build` stamps both `engineProtocol` and `engineRevision` into the
manifest automatically — game authors never set them, and a hand-edited value
in `boardsmith.json` is overwritten rather than merged.

The games worker rejects an upload whose `engineRevision` **exceeds** the
platform's own. That is the asymmetry that matters: a game built on an older
engine is fine (the newer engine still runs it, and `bundleProtocol` guards the
case where it would not), but a game built on a *newer* engine may call
something the vendored engine does not have. The rejection message names both
revisions and says to re-vendor.

So the ordering rule is simply: **re-vendor the platform before publishing
games built against a newer BoardSmith.**
