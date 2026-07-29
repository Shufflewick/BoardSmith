# 174-FIXTURES Manifest

Real pass-1-vs-pass-2 rulebook material, archived from disposable `cp -R` scratch copies so it
survives scratch cleanup. Produced by `174-01-PLAN.md`; full transcript and measurements in
`../174-PROOF.md` section 1. Nothing in this tree is hand-written — every file is a byte-for-byte
copy of a real command output (`ingest-archive`, `verify-run-init/-record/-status`, and a real
`claude -p` transcription-subagent dispatch), copied unmodified — no reformatting, no truncation,
no redaction.

## Source repo state at time of production

| Repo | HEAD | Notes |
|---|---|---|
| `~/BoardSmithGames/seven` | `a03f38d4792af9dfc7c798be69686fc3230f54dd` | READ-ONLY, pinned; `git status --porcelain` empty before and after |
| `~/BoardSmithGames/one-two-punch` | `7e69471bd8980a854f3e351f2f486e1fb6f712b9` | Known pre-existing unrelated dirty state — not asserted porcelain-empty, per Phase 173's documented exception |

Both originals' whole-tree `sha256` manifests were captured before and after this plan's work and
diffed empty (byte-identical) — see `174-PROOF.md` section 1.

## Run IDs

| Game | Run ID | Ranges | Staged units |
|---|---|---|---|
| `seven` | `2026-07-29T23-25-24Z` | `1-2` (single dispatch) | 6 |
| `one-two-punch` | `2026-07-29T23-28-06Z` | `1-2` (single dispatch) | 6 |

## Exact command sequence that reproduces this tree

Run against a fresh `cp -R <original> $SCRATCH/<game>` copy — never against the original directly:

```bash
SCRATCH="${TMPDIR:-/tmp}/174-proof"
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH"

# Preflight (originals)
git -C ~/BoardSmithGames/seven rev-parse HEAD            # must be a03f38d4792af9dfc7c798be69686fc3230f54dd
git -C ~/BoardSmithGames/seven status --porcelain          # must be empty
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD      # record verbatim, no porcelain assertion
find ~/BoardSmithGames/seven -type f -exec shasum -a 256 {} + | sort > "$SCRATCH/seven.before"
find ~/BoardSmithGames/one-two-punch -type f -exec shasum -a 256 {} + | sort > "$SCRATCH/otp.before"

# Copies + skill install
cp -R ~/BoardSmithGames/seven "$SCRATCH/seven"
cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"
( cd "$SCRATCH/seven" && npx boardsmith claude --local --force )
( cd "$SCRATCH/one-two-punch" && npx boardsmith claude --local --force )

# Source adoption (Case 2 of source-resolution.md — exactly one root candidate, no --edition)
( cd "$SCRATCH/seven" && boardsmith ingest-archive rules.pdf --project . --json )
( cd "$SCRATCH/one-two-punch" && boardsmith ingest-archive rules.pdf --project . --json )

# Pass-2 staging run + real subagent dispatch (per staging-dispatch.md), one game shown —
# repeat identically for the other with its own run-id
( cd "$SCRATCH/seven" && boardsmith verify-run-init --project . --ranges '["1-2"]' --json )
# -> take runId, stagingDir from the JSON
cat > "$SCRATCH/dispatch-prompt-seven.txt" << 'EOF'
BS-DISPATCH-V2

Read `.claude/skills/bs-shared/ingest/transcription-subagent.md` in full and follow it exactly.

Your page range: 1-2
Rulebook path:   rulebook/source/rules.pdf
Write slices to: rulebook/.verify/<runId>/slices
EOF
( cd "$SCRATCH/seven" && claude -p "$(cat "$SCRATCH/dispatch-prompt-seven.txt")" \
    --allowedTools Read,Write,Bash > "$SCRATCH/subagent-seven-return.txt" )
# For each unit the return names (never opening the staged file):
( cd "$SCRATCH/seven" && boardsmith verify-run-record --run-id <runId> --unit <unitId> \
    --slice <unitId>.md --range 1-2 --project . --json )
( cd "$SCRATCH/seven" && boardsmith verify-run-record --run-id <runId> --complete-range 1-2 \
    --project . --json )
( cd "$SCRATCH/seven" && boardsmith verify-run-status --project . --run-id <runId> --json )

# Archive into repo
mkdir -p .planning/phases/174-verify-classifier/174-FIXTURES/<game>/{live,staged}
cp "$SCRATCH/<game>/rulebook"/*.md .planning/phases/174-verify-classifier/174-FIXTURES/<game>/live/
cp "$SCRATCH/<game>/rulebook/.verify/<runId>/slices"/*.md \
   .planning/phases/174-verify-classifier/174-FIXTURES/<game>/staged/
cp "$SCRATCH/<game>/rulebook/.verify/<runId>/RUN.md" \
   .planning/phases/174-verify-classifier/174-FIXTURES/<game>/RUN.md

# Originals re-verification
find ~/BoardSmithGames/seven -type f -exec shasum -a 256 {} + | sort > "$SCRATCH/seven.after"
find ~/BoardSmithGames/one-two-punch -type f -exec shasum -a 256 {} + | sort > "$SCRATCH/otp.after"
diff "$SCRATCH/seven.before" "$SCRATCH/seven.after"   # must be empty
diff "$SCRATCH/otp.before" "$SCRATCH/otp.after"       # must be empty
```

## Archived file hashes

Origin path is relative to `$SCRATCH/<game>` (the disposable scratch copy this plan's real
commands ran against), never the untouched `~/BoardSmithGames/<game>` original.

| Archived path | sha256 | Origin path (inside scratch copy) |
|---|---|---|
| `seven/live/00-visual-survey.md` | `c8227114ef85bd489c0b787b4b22f559a11ea81241c9255e18f650991abdd9c5` | `seven/rulebook/00-visual-survey.md` |
| `seven/live/01-definitions-and-components.md` | `809d361f26bb1417c6a4e5eea646ce2a316c6a2b2dc6a6303c9fc833849d70f3` | `seven/rulebook/01-definitions-and-components.md` |
| `seven/live/01-overview-setup-and-play.md` | `dd2dc8eb5fb5d0525513bf3f0e5b3309e5762df332ee1afd37c982f498cbe456` | `seven/rulebook/01-overview-setup-and-play.md` |
| `seven/live/02-solo-variant.md` | `8e2d9761465b9b5ed05dba16e8f3ad0042c31368e1a0c566f64c24c76baa6843` | `seven/rulebook/02-solo-variant.md` |
| `seven/live/INDEX.md` | `b9e6c436b13d00d671585e055f967b61a3ddd66d15a37edc770b7bdb7628aaf5` | `seven/rulebook/INDEX.md` (post-adoption, carries `Source hash:`) |
| `seven/RUN.md` | `0a87047005e2e3253ea0fc9fff41a8d6ddbb86eb4b1acca48cbeb97fbb5a47e9` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/RUN.md` |
| `seven/staged/01-about-and-setup.md` | `08845c697a5a434caede1be27be35e0e2b2ac4c752d43a0b78873f9b967a6c53` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/slices/01-about-and-setup.md` |
| `seven/staged/01-definitions.md` | `0c3353619cc7f7d32749df5e3ccce1612bb330548b90fd457770c5f6dca70d88` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/slices/01-definitions.md` |
| `seven/staged/01-distribution-of-cards.md` | `d05fe4f1c8b1fe96b6eb46b29f10ae5efef4a513c411555b145bd3a299f6cbef` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/slices/01-distribution-of-cards.md` |
| `seven/staged/01-game-end-and-match.md` | `f9f321bae2d6ed6501f75075cc8d56e0cfa28c1457e19b83f71bcc1b2f71a21b` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/slices/01-game-end-and-match.md` |
| `seven/staged/01-round.md` | `5d37202623bed3703c23cd71f7ac37e536290e0beffd618db7b128f251797da3` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/slices/01-round.md` |
| `seven/staged/02-solo-variant.md` | `3070a094a39440af0e4c6534c7f4fc22f2eb2d03559b69a42a3b99e85cd35009` | `seven/rulebook/.verify/2026-07-29T23-25-24Z/slices/02-solo-variant.md` |
| `one-two-punch/live/00-visual-survey.md` | `9e8b23a1247ba38282d34460c9e96fb05e86173778203ca1ff58c0dcce166b2b` | `one-two-punch/rulebook/00-visual-survey.md` |
| `one-two-punch/live/01-setup-and-round-structure.md` | `19dd7e2f0635ce128391bdaa008f606ed77a4e98729789091884a7ddfc6572cd` | `one-two-punch/rulebook/01-setup-and-round-structure.md` |
| `one-two-punch/live/02-action-cards-and-resolution.md` | `dca5e0d99ab8c7c229a8b62d760388fc517b2c4011fe235a4f918cefc2ee8cfd` | `one-two-punch/rulebook/02-action-cards-and-resolution.md` |
| `one-two-punch/live/INDEX.md` | `b2f69177703b91fc7f0135d5bc7e00a489c9aa2638863891bd280a31bcb5bf7c` | `one-two-punch/rulebook/INDEX.md` (post-adoption, carries `Source hash:`) |
| `one-two-punch/RUN.md` | `3534f23d80778d8cccdcc42f5065caaf5a28ede754aee17dffca7657510a77a8` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/RUN.md` |
| `one-two-punch/staged/01-overview-setup.md` | `522e0316b96bdbb17812f7b702df757f781d11e5fba8beb01b2af65214a2c6cf` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/slices/01-overview-setup.md` |
| `one-two-punch/staged/01-round-structure.md` | `e5db38c9f19c21850f0351f7fbde6af92f25e63ad74c179a7fdba28b9e175f9d` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/slices/01-round-structure.md` |
| `one-two-punch/staged/02-action-cards.md` | `86f91e3b4fe8eb12d29a9e9308252b925d8203a7ddb163993bf4f98a4f6fd272` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/slices/02-action-cards.md` |
| `one-two-punch/staged/02-end-of-game.md` | `ce93f0e9cae141e12122cb2c0246615d10c4874b9284c117b63d1359b391eaac` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/slices/02-end-of-game.md` |
| `one-two-punch/staged/02-punch-examples-discard.md` | `11542ee05e00480c9daf4b4a4aa0fee7ba75981310b6b34ecafedfe309bb7f4e` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/slices/02-punch-examples-discard.md` |
| `one-two-punch/staged/02-tips.md` | `bce4e25a968007e39cf213e6acc36c55c75d9449ccfc4ec3322a625e1caa2ca0` | `one-two-punch/rulebook/.verify/2026-07-29T23-28-06Z/slices/02-tips.md` |

All 23 rows independently re-checked (`shasum -a 256` of the archived file, compared against this
table) — see `174-PROOF.md` section 1.
