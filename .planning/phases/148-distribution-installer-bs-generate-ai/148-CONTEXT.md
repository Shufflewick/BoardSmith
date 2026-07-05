# Phase 148: Distribution — Installer & `/bs-generate-ai` - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewire `src/cli/commands/install-claude-command.ts` (REAL production TypeScript) so one install pass gives a designer the complete `bs-` skill family — `/bs-ingest-rules`, `/bs-build-chunk`, `/bs-check-status`, `/bs-insert-chunk`, `/bs-generate-ai` — plus the shared reference files the skills read by relative path (`build/`, `ingest/`, `templates/*.template.md`, `state-machine.md`, `aspects/`), and removes the dead `/design-game` path entirely. Rename `/generate-ai` → `/bs-generate-ai`. Requirements DIST-01, DIST-02. End-to-end pipeline dry-run is Phase 149.

Canonical contract: `.planning/bs-skills-plan.md` §Distribution + §Reuse from the Existing Skill + §AI Opponents. No-backward-compat rule: remove `/design-game`, don't deprecate.

</domain>

<decisions>
## Implementation Decisions

### Install Layout & Reference Resolution
- The `bs-` skills reference sibling files by RELATIVE PATH (each skill's "Installed location" paragraph states relative paths resolve against the skill file's own directory — the bs/ tree is copied as a unit). The installer must copy the whole reference tree (`build/`, `ingest/`, `templates/`, `state-machine.md`, and the `aspects/` shared files) to the install target preserving structure, so those relative refs resolve at runtime — NOT the current single-file-embed-inline model (which only works for a self-contained skill with no sibling reads)
- Install the 5 command entry points so they are invocable as `/bs-*`. RESEARCH MUST confirm the exact Claude Code slash-command discovery + sibling-file resolution mechanism (does a command file resolve relative paths / read sibling files at runtime? does subdirectory namespacing map to `/bs-*` or `/bs:*`? are `@`-references supported?). If Claude Code CANNOT resolve runtime relative reads from a command file, the plan adapts — options the researcher should evaluate: (a) copy the bs/ tree to a known location and have thin command files point to absolute/`@`-paths, (b) namespaced subdir commands, (c) a documented layout the skills' existing "Installed location" wording already assumes. The skills were authored assuming (a-style) relative resolution against their own dir — the installer must deliver exactly that layout.
- Exclude the `.test.ts` files (ingest.test.ts, build-chunk.test.ts, status-tools.test.ts, templates.test.ts) from the installed set — they are BoardSmith's drift tests, not shipped skill content
- Preserve `local` (project `.claude/`) vs global (`~/.claude/`) install modes and `--force`; keep the `npm link` global-linking step

### generate-ai Rename & design-game Removal
- `/generate-ai` → `/bs-generate-ai`: keep the existing 5-hook AI-generator instructions (generate-ai-instructions.md content — objectives/threatResponseMoves/playoutPolicy/moveOrdering/uctConstant, Hex reference), and add framing positioning it as a LATE sketch chunk (invoked after game-end/scoring exists, since MCTS needs terminal states; also usable earlier for --ai solo-playtest seat-fill per the plan). The AI-generation CAPABILITY is preserved, only renamed + repositioned
- `/design-game` FULLY removed (no-backward-compat): drop it from the installer's install list, the uninstaller, the CLI command descriptions/help text (cli.ts line ~126 "Remove /design-game and /generate-ai"), and delete the now-dead `instructions.md` + `design-game.template.md` source files. No residual `design-game` references anywhere in the installed set or the installer code
- Update the installer's console output (the "Commands:" listing, the "/design-game skill is self-contained" blurb) to list the 5 bs- skills and describe the new model; the install changelog states the old-skill migration path (ingest offers the one-time conversion — already built in Phase 142)

### Verification — real installer test
- REAL vitest unit test (`install-claude-command.test.ts` or similar, mirroring project-scaffold.test.ts's real-install-to-temp-dir pattern): install to a temp dir, assert all 5 `bs-*` command entry points present, all shared reference files present with correct relative layout (so skills' refs resolve), `.test.ts` files excluded, `design-game` command + template ABSENT, `generate-ai` command absent and `bs-generate-ai` present
- No-residual-references check: grep the installed set (and the installer source) for `design-game` → zero hits post-removal
- End-to-end: the executor runs the real installer into a scratch temp dir once, verifies the layout + that a bs- skill's relative refs point at files that exist, then cleans up (no leftover global install, no npm link side-effects in the test — test the file-copy layer, not the npm link step)
- Behavioral proof that the installed skills actually RUN in Claude Code is Phase 149 (dry-run) / inherently manual

### Claude's Discretion
- Exact installer function decomposition, temp-dir test helper structure, whether to keep a single install function or split copy-tree vs install-commands, console-output wording

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/install-claude-command.ts` — the file to rewire: `installCommand()` (currently embeds instructions inline), the install/uninstall entry points, the design-game/generate-ai maps (lines ~52, ~66, ~127-128, ~155-156, ~186-189, ~204-218), the `npm link` step
- `src/cli/cli.ts` — command registration (line 122 install action, 126 uninstall description mentioning design-game)
- `src/cli/slash-command/bs/` — the 5 entry-point skills + `build/` (11) + `ingest/` (4) + `templates/` (6) + `state-machine.md`; the 4 `.test.ts` files to EXCLUDE from install
- `src/cli/slash-command/generate-ai-instructions.md` — the AI-generator content to rename/reframe as bs-generate-ai
- `src/cli/slash-command/aspects/` — shared reference files (dice/hex-grid/playing-cards/square-grid/index.md) the plan says ship with the skills
- `src/cli/slash-command/instructions.md` + `design-game.template.md` — the dead design-game sources to DELETE
- `src/cli/lib/project-scaffold.ts` + `project-scaffold.test.ts` — the real-code + real-install-to-temp-dir test PATTERN to mirror for the installer test (Phase 144 precedent)
- The bs- skills' "Installed location" paragraphs (ingest-rules.md:207, build-chunk.md:395, check-status.md:124, insert-chunk.md:137) — the layout contract the installer must satisfy

### Established Patterns
- Real-code TDD (RED test → GREEN impl) as in project-scaffold.test.ts; install-to-temp-dir, assert layout, clean up; never leave global side-effects in tests
- No-backward-compat: delete the bad thing, add the good thing
- Never leave a process/link dangling in tests (test the copy layer, not npm link)

### Integration Points
- Phase 149 dry-runs the installed skills end-to-end against a real rulebook
- The generated-game scaffold (Phase 144's project-scaffold.ts axe-core change) is downstream of ingest's scaffold step, unaffected here
- MERC/example games are NOT affected (this is Claude tooling install, not the library)

</code_context>

<specifics>
## Specific Ideas

- The whole point: no dead `/design-game` path left behind — a residual reference is a verification failure, not a cosmetic nit
- `/bs-generate-ai` is positioned as a late sketch chunk (MCTS needs terminal states) but also serves earlier --ai solo-playtest seat-fill
- The install must be ONE pass delivering a self-consistent family (DIST-01)
- Relative-path resolution is the load-bearing risk — if the mechanism doesn't work, the skills' cross-references (authored across phases 141-147) are all broken; research must de-risk this before planning locks the install layout

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
