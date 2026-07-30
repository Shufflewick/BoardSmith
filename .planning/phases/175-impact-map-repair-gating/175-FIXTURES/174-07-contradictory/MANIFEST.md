# 175-FIXTURES / 174-07-contradictory — rescued proof material

**Archived:** 2026-07-30, at the Phase 175 research gate.

## Why this exists

Phase 174-07 produced the milestone's only REAL `contradictory` classification by mutating
`one-two-punch`'s archived image-only `rules.pdf` (rasterize → composite a real rendered patch
reversing Fight-phase timing precedence → reassemble) and running the real pipeline end to end.

That material lived ONLY in OS scratch (`${TMPDIR}174-07-proof/`, 323MB / 10,868 files) and was
never committed. Phase 175's research found it still present but at risk of being cleared at any
time. This is the exact loss Phase 174 already paid for once: its own research found ZERO reusable
proof data because Phase 173's scratch copies had been cleaned up, which turned fixture production
into unplanned first-wave scope. Archived here so Phase 175 does not repeat that.

Only EVIDENCE is archived — not the game copies or node_modules.

## Contents

- `evidence/dispatch-prompt-*.txt` — the raw dispatch prompts (VERIFY-07's grep target)
- `evidence/subagent-*-return.txt` — the raw subagent returns, including `lineFindings[]`
- `evidence/seven-final-status.json` — the final `verify-classify-status` output
- `staged/<game>/RUN.md` — the run ledger from each mutation pass
- `staged/<game>/slices/` — the pass-2 staged slices that were actually classified

## Traceability

- Mutated `one-two-punch` rules.pdf sha256: `8a01d38c0073b9ba90d07e4dc20817d1ad6c590d3c0c747ec31655e88c35bb9c`
  (the 4.5MB PDF itself is NOT archived — the hash ties this evidence to it; regenerate via
  `174-PROOF.md` §5's recorded procedure if the artifact is needed again)
- Source phase: `.planning/phases/174-verify-classifier/174-07-SUMMARY.md`, `174-PROOF.md` §5
- Reference-game originals were confirmed byte-identical before/after in 174-07; `seven` remains
  pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`.

## Per-file sha256

```
411a74e84af0f21fb17f5bd338546cf740a23cec2f08a4d3c5a8c87d77bb9b02  ./evidence/dispatch-prompt-otp-sc3-classify.txt
455085d8b25506efd3b387c0f47a6201558655ca84a9de1f887fce02f5a1b43d  ./evidence/dispatch-prompt-otp-sc3.txt
f91cecc28d725f87549013950d8e0f5bdaae3a60cd35eed6e07207f378d29d54  ./evidence/dispatch-prompt-seven-chunkcheck-classify.txt
05445e67518131441e0ff4bd06e3762ecddfd5448ab298ca8687c53836587f19  ./evidence/seven-final-status.json
470284d9de425c26d11433beb63159b616485054db27b4efaa20dd59c0ac08f7  ./evidence/subagent-otp-sc3-classify-return.txt
922736cfe03d79ff62e35efb67a9453d13c441ecffc792efe4f3feadf14ad672  ./evidence/subagent-otp-sc3-return.txt
86038f0d81a5063327cbc586e4825fb6d47e4799a0bd1bbcf7897d30cad9f6c5  ./evidence/subagent-seven-chunkcheck-classify-return.txt
0c103aea4cca7a4a26720409018995736e1a22d8e31c0f900b72f3cb38db1928  ./staged/one-two-punch/RUN.md
75501b7e2bf5aa1bdb92136cf00c10fbc1d49aa3b1a72688ad23b17c2dc56c2d  ./staged/one-two-punch/slices/01-overview-and-contents.md
3e9ba193129c959f3cf5f0167cfc360501478940562f0ee4b7af951eecff8f86  ./staged/one-two-punch/slices/01-round-structure.md
b382ba17a5c413532bc8ff7c4fdcf16d5fb9ba74cf48635bfeec474a81b6b78f  ./staged/one-two-punch/slices/01-starting-a-new-game.md
7def8d8cc07d7f5f89972542dc60d8a6e47178a28e706549ab1ace4af61fafea  ./staged/one-two-punch/slices/02-action-cards.md
c14a7db9b44c91796ccafb30dc4b1acb172224ff654cc4a6ec78748cba3b1b6a  ./staged/one-two-punch/slices/02-end-of-game.md
87c12d2c1fac0f59d940188d47c23281a3a9663a7ef9f53874a6e5af915d6f13  ./staged/one-two-punch/slices/02-punch-examples.md
5d9691d70e7cebf09d778c12649b1e3d8e3af37a833a0e0e9cb0f9387268b431  ./staged/one-two-punch/slices/02-tips.md
ae05e2d874cfc76b9a132ad0535d6a320d4acedfa5ba4f0db7f4e7e40fdc0965  ./staged/one-two-punch/slices/superseded/01-overview-and-setup.md
7b6612d32cc71515507062545cb691797b99f05f41d1460d5d505c008fe69d22  ./staged/one-two-punch/slices/superseded/01-starting-a-new-round.md
bc34e19ce93e4827cfc37e6bb483516e4057c20d2837acbc1b1017351fb54135  ./staged/seven/RUN.md
08845c697a5a434caede1be27be35e0e2b2ac4c752d43a0b78873f9b967a6c53  ./staged/seven/slices/01-about-and-setup.md
0c3353619cc7f7d32749df5e3ccce1612bb330548b90fd457770c5f6dca70d88  ./staged/seven/slices/01-definitions.md
d05fe4f1c8b1fe96b6eb46b29f10ae5efef4a513c411555b145bd3a299f6cbef  ./staged/seven/slices/01-distribution-of-cards.md
f9f321bae2d6ed6501f75075cc8d56e0cfa28c1457e19b83f71bcc1b2f71a21b  ./staged/seven/slices/01-game-end-and-match.md
5d37202623bed3703c23cd71f7ac37e536290e0beffd618db7b128f251797da3  ./staged/seven/slices/01-round.md
3070a094a39440af0e4c6534c7f4fc22f2eb2d03559b69a42a3b99e85cd35009  ./staged/seven/slices/02-solo-variant.md
```
