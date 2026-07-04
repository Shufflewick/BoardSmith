# Phase 135: CLI & Dev Experience - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

`boardsmith` CLI commands catch misconfiguration and invalid input instead of silently diverging, clamping, or ignoring flags. Covers audit findings F9, F21, F22, F32, F33, F34 (requirements CLIX-01..06; PROC-01/PROC-02 discipline applies fractally). Scope: `src/cli/` (cli.ts, commands/dev.ts, commands/validate.ts, commands/init.ts, project-scaffold.ts, publish path), plus scaffold templates and related docs.

</domain>

<decisions>
## Implementation Decisions

### Config Integrity
- **CLIX-01 (F9)**: **`gameDefinition` (code) is the single source of truth for player count.** Remove `playerCount` from boardsmith.json and the scaffold entirely; publish/manifest derives min/max players from the gameDefinition; `boardsmith validate` flags a leftover `playerCount` key with a pointed migration message (ties into CLIX-02's unknown-key rejection). Scaffold no longer hardcodes the value in two places.
- **CLIX-02 (F22)**: **`boardsmith validate` rejects unknown top-level boardsmith.json keys** with did-you-mean suggestions ("Unknown key 'gameOption' — did you mean 'gameOptions'?"). `boardsmith dev` startup warns loudly on the same unknown keys. Ship the JSON schema in the package and point `$schema` at a path/URL that resolves (or drop the dead `$schema` URL).
- **CLIX-03 (F21)**: **One shared bundle-size constant aligned to the actual server enforcement value** — research determines whether the real server limit is 50MB (per the comment) or 200MB (per the code); constant, comment, and server enforcement must agree, sourced from one place so they cannot drift.

### Dev Host & Flags
- **CLIX-04 (F32)**: **`boardsmith dev` defaults to 127.0.0.1.** LAN play is explicit: `--host 0.0.0.0` (plus a `--lan` shorthand). When binding non-localhost, print a loud startup line ("Serving to your whole network — pass --host 127.0.0.1 for local-only"). Help text corrected to match the actual default.
- **CLIX-05 (F33)**: **Remove `-t/--template` from `boardsmith init` entirely** until multiple templates exist (No Backward Compatibility; a flag that parses and does nothing is the canonical silent no-op). Docs mentioning it corrected same-phase.
- **CLIX-06 (F34)**: **Fail fast on invalid numeric flags**: non-numeric `--players`/`--port`/`--ai` values error immediately with actionable messages; out-of-range `--players` ERRORS ("--players 6 exceeds this game's max of 4 players") instead of silently clamping; `--ai` seats validated against the effective final player count.

### Process (carried over from Phases 131-134 locked decisions)
- PROC-01 verify-first: per-finding verdict in `135-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED recorded in SUMMARY.
- Same-phase doc updates (DOCX-04). Full suite green per wave.

### Claude's Discretion
- Exact schema-validation implementation for boardsmith.json (hand-rolled key check vs shipped JSON schema file — no new dependencies without discussion; a hand-rolled validator with the shipped schema as documentation is fine).
- Where the shared bundle-size constant lives (types/protocol constants vs cli module) — pick the spot both validate and any server code can import.
- Whether `--lan` is a boolean flag aliasing `--host 0.0.0.0` or documented usage only.
- Migration notes for games whose boardsmith.json still has playerCount (Phase 138 does the actual cross-repo sweep).

</decisions>

<code_context>
## Existing Code Insights

### Key trace points (from audit; re-verify per PROC-01)
- `src/cli/commands/dev.ts:358-359` — minPlayers resolution chain (`gameDefinition.minPlayers ?? config.playerCount?.min ?? config.minPlayers ?? 2`); `:282` — host default '0.0.0.0'; `:392` — silent clamp; `:301` — --ai validated pre-clamp; `:316` — raw JSON.parse of boardsmith.json.
- `src/cli/project-scaffold.ts:109` — scaffold writes playerCount into boardsmith.json; `:244-245` — AND hardcodes minPlayers/maxPlayers into src/rules/index.ts gameDefinition; `:105` — dead `$schema` URL.
- `src/cli/commands/validate.ts:94-128` — validateMetadata checks only name/displayName/description/playerCount/ui; `:222-226` — bundle-size comment says 50MB, code says 200MB; publish.ts:102 runs the same validate.
- `src/cli/cli.ts:27` — `-t, --template` registered with fake default; `:35` — misleading --host help text.
- `src/session/multiplayer-host.ts:141` — `for (seat = 1; seat <= NaN)` zero-seat consequence.

### Established Patterns
- Fail-loud error conventions from Phases 131-134 (actionable messages naming the fix).
- CLI tests: check existing src/cli test files for command-level test patterns (validate/dev arg parsing).
- v4.4 `boardsmith simulate` CLI (SIM) added recent CLI surface — follow its arg-validation style if it has one.

### Integration Points
- Publish path (publish.ts) shares validate; INFRA-04 (recent commit 72dafc0) stamps bundle protocol version into manifests — manifest playerCount derivation belongs near that code.
- Example games' boardsmith.json files contain playerCount — Phase 138 migrates them; BoardSmith's own fixtures/templates must be updated in this phase so the suite stays green.
- `boardsmith dev` default-host change affects anyone relying on LAN-by-default — release notes/migration note needed (breaking behavior change, intentional).

</code_context>

<specifics>
## Specific Ideas

- CLIX-04 is the high-severity security-flavored one (LAN exposure at a coffee shop) — its regression test should assert the default bind host without actually opening sockets on 0.0.0.0 in CI.
- Suite baseline after Phase 134: 169 files / 2230 tests green.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
