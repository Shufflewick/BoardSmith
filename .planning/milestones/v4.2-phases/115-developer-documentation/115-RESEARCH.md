# Phase 115: Developer Documentation — Research

**Researched:** 2026-06-30
**Confidence:** HIGH — this phase documents substrate that is fully built and verified across v4.1 (checkers) and v4.2 Phases 112–114 (go-fish). The authoritative source/API map is in 115-CONTEXT.md `<code_context>`; this file adds the doc-writing approach + validation architecture.

## RESEARCH COMPLETE

## Summary

A BoardSmith-only documentation phase: author `docs/teaching-and-tutorials.md` (one guide, linked from `docs/README.md`) covering DOC-01..04 with REAL, codebase-verified checkers (grid) + go-fish (cards) worked examples side-by-side, then verify every claim/snippet against the live source with a doc-verifier pass.

## Authoring approach

- **Author** with a doc-writer that READS the real sources (BoardSmith `src/`, `~/BoardSmithGames/checkers`, `~/BoardSmithGames/go-fish`) and excerpts concise, accurate snippets with `file` references — never invented API.
- **Verify** with a doc-verifier that checks each API name, type, method, flag, and snippet against the live code (no drift). Fix any mismatch before completion.
- **Match the existing docs style** (flat `docs/*.md`, fenced TypeScript examples, headings) — mirror a sibling guide like `docs/custom-ui-guide.md` for tone/structure.

## Source map

See 115-CONTEXT.md `<code_context>` for the full file:symbol map. Key sources:
- Substrate: `src/engine/tutorial/{types,gate}.ts`, `src/ui/composables/useBoardInteraction.ts` (`anchorAttrs`), `src/ui/components/helpers/{overlay-utils,TutorialOverlay,HintOverlay,ActionHelpPopover}.vue`, `src/session/game-session.ts` (requestHint/startDemo/startTutorial/teachingDisabled), `src/engine/action/{types,action-builder}.ts` (`.help()`), `src/testing/` (`simulateTutorial`/`assertTutorialCompletes`), `src/cli/dev-host` (`--lock-teaching`).
- Checkers (grid worked example): `~/BoardSmithGames/checkers/src/rules/{tutorial,index,actions}.ts`, `tests/{tutorial,hint-target}.test.ts`.
- Go-fish (card worked example): `~/BoardSmithGames/go-fish/src/rules/{tutorial,actions,ai,index}.ts`, `src/ui/components/GameTable.vue`, `tests/{tutorial,hint-target,demo,action-help,host-lockout,no-hidden-info-leak}.test.ts`.

## Pitfalls
1. **Drift:** the #1 risk for docs. Every code reference MUST be verified against the live source (doc-verifier). Prefer short excerpts + file references over pasting whole files (which rot).
2. **Parity lesson is the point:** the guide must make the board-square `notation` vs card `name` anchoring path legible, and state that custom UIs must emit `anchorAttrs` (AutoUI does it automatically). Do not bury this.
3. **Honesty over polish:** document the real caveats (auto-advance/R-05, custom-UI anchorAttrs requirement, dev-host AI-seat gating for the demo, heatmap-board-only + showHint-gating quirk). Omitting them would mislead the next author.
4. **Heatmap board-only** must be explicit (DOC-03) — it shades grid cells; gridless card games don't get it.

## Open Questions (RESOLVED)
1. **One guide or several?** RESOLVED: one (`docs/teaching-and-tutorials.md`), per the goal "a single guide" (CONTEXT Area 1).
2. **Real code or pseudo-code?** RESOLVED: real, codebase-verified snippets (CONTEXT Area 2 + doc-verifier).

## Validation Architecture
A docs phase's "tests" are factual-accuracy checks, not unit tests:
- **Coverage:** the guide contains a section addressing each of DOC-01 (TutorialDefinition + lifecycle + gating + overlay targets cell/piece/card/panel/action), DOC-02 (predicate triggers + `simulateTutorial` CI + green→red), DOC-03 (hint + demo + heatmap[board-only] + `teachingDisabled` lockout + `.help()`), DOC-04 (checkers + go-fish worked examples side-by-side + the `anchorAttrs` parity path). A coverage check (grep for the required concepts/anchors) confirms each requirement is present.
- **Accuracy (doc-verifier):** every named symbol/type/method/flag and every code excerpt is verified to exist in the live source (BoardSmith + checkers + go-fish). No invented API; no drifted signatures.
- **Discoverability:** `docs/README.md` links the new guide.
- **No regressions:** docs-only — BoardSmith `npm test` stays green (no `src/` changes); the guide is markdown.

Verification method: doc-verifier agent reads the guide + the cited source files and reports per-claim PASS/MISMATCH; coverage grep for DOC-01..04 concepts; README link present; BoardSmith suite green.
