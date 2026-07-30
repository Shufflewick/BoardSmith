# Verify Run Ledger — 2026-07-30T01-31-49Z

<!-- MACHINE-OWNED. Do not write between the fences below by hand, and do not move or
     delete them. This file is written by `boardsmith verify-run-init`/`verify-run-record`
     and read by `boardsmith verify-run-status`. -->

<!-- The manifest below is the page-range dispatch plan, decided ONCE at verify-run-init
     time and never rewritten — resume reads it rather than re-deriving the range
     decomposition. -->

<!-- boardsmith:verify-run:manifest:begin -->
{"rangeId":"1-2"}
<!-- boardsmith:verify-run:manifest:end -->

<!-- The ledger below is append-only. Each line between the fences is one self-delimiting
     JSON record for one completed slice-unit, or one range-level marker
     (range-complete/range-reset). -->

<!-- boardsmith:verify-run:begin -->
{"unitId":"01-overview-and-contents","slicePath":"01-overview-and-contents.md","sha256":"75501b7e2bf5aa1bdb92136cf00c10fbc1d49aa3b1a72688ad23b17c2dc56c2d","recordedAt":"2026-07-30T01:40:00.490Z","rangeId":"1-2"}
{"unitId":"01-starting-a-new-game","slicePath":"01-starting-a-new-game.md","sha256":"b382ba17a5c413532bc8ff7c4fdcf16d5fb9ba74cf48635bfeec474a81b6b78f","recordedAt":"2026-07-30T01:40:01.288Z","rangeId":"1-2"}
{"unitId":"01-round-structure","slicePath":"01-round-structure.md","sha256":"3e9ba193129c959f3cf5f0167cfc360501478940562f0ee4b7af951eecff8f86","recordedAt":"2026-07-30T01:40:02.150Z","rangeId":"1-2"}
{"unitId":"02-action-cards","slicePath":"02-action-cards.md","sha256":"7def8d8cc07d7f5f89972542dc60d8a6e47178a28e706549ab1ace4af61fafea","recordedAt":"2026-07-30T01:40:03.038Z","rangeId":"1-2"}
{"unitId":"02-punch-examples","slicePath":"02-punch-examples.md","sha256":"87c12d2c1fac0f59d940188d47c23281a3a9663a7ef9f53874a6e5af915d6f13","recordedAt":"2026-07-30T01:40:03.851Z","rangeId":"1-2"}
{"unitId":"02-end-of-game","slicePath":"02-end-of-game.md","sha256":"c14a7db9b44c91796ccafb30dc4b1acb172224ff654cc4a6ec78748cba3b1b6a","recordedAt":"2026-07-30T01:40:04.676Z","rangeId":"1-2"}
{"unitId":"02-tips","slicePath":"02-tips.md","sha256":"5d9691d70e7cebf09d778c12649b1e3d8e3af37a833a0e0e9cb0f9387268b431","recordedAt":"2026-07-30T01:40:05.484Z","rangeId":"1-2"}
{"kind":"range-complete","rangeId":"1-2","recordedAt":"2026-07-30T01:40:06.315Z"}
{"kind":"classification","pairId":"pages-1-2","units":["01-overview-and-contents","01-starting-a-new-game","01-round-structure","02-action-cards","02-punch-examples","02-end-of-game","02-tips"],"liveSlices":["rulebook/01-setup-and-round-structure.md","rulebook/02-action-cards-and-resolution.md"],"stagedSlices":["01-overview-and-contents.md","01-starting-a-new-game.md","01-round-structure.md","02-action-cards.md","02-punch-examples.md","02-end-of-game.md","02-tips.md"],"provenance":"source-changed","ruleDelta":"contradictory","stale":true,"evidence":"Rule-bearing lines compared line by line after excluding presentation notes on both schemas. The single non-cosmetic delta is the FIGHT-phase resolution-order rule: pass 1 quotes 'lower timing ... resolve their action first', pass 2 quotes 'higher timing ... must resolve their action first'. As rule statements these cannot both be true of the same printed sentence and invert resolution order in every non-tied exchange. Remaining deltas (credit-name spelling, 'next to' vs 'in front of', punctuation, 'one player' vs 'your player') are cosmetic per the consequence test. | Pass 1 quote: \"The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.\" | Pass 2 quote: \"The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.\"","recordedAt":"2026-07-30T01:41:59.573Z","quotedPass1":"The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.","quotedPass2":"The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time."}
<!-- boardsmith:verify-run:end -->
