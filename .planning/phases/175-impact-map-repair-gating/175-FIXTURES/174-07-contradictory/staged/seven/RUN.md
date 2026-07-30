# Verify Run Ledger — 2026-07-29T23-25-24Z

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
{"unitId":"01-about-and-setup","slicePath":"01-about-and-setup.md","sha256":"08845c697a5a434caede1be27be35e0e2b2ac4c752d43a0b78873f9b967a6c53","recordedAt":"2026-07-29T23:27:56.297Z","rangeId":"1-2"}
{"unitId":"01-round","slicePath":"01-round.md","sha256":"5d37202623bed3703c23cd71f7ac37e536290e0beffd618db7b128f251797da3","recordedAt":"2026-07-29T23:27:57.099Z","rangeId":"1-2"}
{"unitId":"01-game-end-and-match","slicePath":"01-game-end-and-match.md","sha256":"f9f321bae2d6ed6501f75075cc8d56e0cfa28c1457e19b83f71bcc1b2f71a21b","recordedAt":"2026-07-29T23:27:57.916Z","rangeId":"1-2"}
{"unitId":"01-definitions","slicePath":"01-definitions.md","sha256":"0c3353619cc7f7d32749df5e3ccce1612bb330548b90fd457770c5f6dca70d88","recordedAt":"2026-07-29T23:27:58.760Z","rangeId":"1-2"}
{"unitId":"01-distribution-of-cards","slicePath":"01-distribution-of-cards.md","sha256":"d05fe4f1c8b1fe96b6eb46b29f10ae5efef4a513c411555b145bd3a299f6cbef","recordedAt":"2026-07-29T23:27:59.597Z","rangeId":"1-2"}
{"unitId":"02-solo-variant","slicePath":"02-solo-variant.md","sha256":"3070a094a39440af0e4c6534c7f4fc22f2eb2d03559b69a42a3b99e85cd35009","recordedAt":"2026-07-29T23:28:00.421Z","rangeId":"1-2"}
{"kind":"range-complete","rangeId":"1-2","recordedAt":"2026-07-29T23:28:01.283Z"}
{"kind":"classification","pairId":"pages-1-2","units":["01-about-and-setup","01-round","01-game-end-and-match","01-definitions","01-distribution-of-cards","02-solo-variant"],"liveSlices":["rulebook/01-definitions-and-components.md","rulebook/01-overview-setup-and-play.md","rulebook/02-solo-variant.md"],"stagedSlices":["01-about-and-setup.md","01-round.md","01-game-end-and-match.md","01-definitions.md","01-distribution-of-cards.md","02-solo-variant.md"],"provenance":"unknown","ruleDelta":"sharper","stale":true,"evidence":"Nearly all rule-bearing content agrees verbatim. One rule-bearing delta: pass 1 explicitly records the bonus point card's scoring effect as UNDEFINED in the text, while pass 2 asserts each bonus point card is worth +1 point. Compatible plus non-identical consequence = sharper. | Pass 1 quote: \"Named-but-undefined (p.1): bonus point cards (depicted as a black \"+1\" card; the text does not define its scoring effect beyond Game End's instruction to add bonus point cards to your score)\" | Pass 2 quote: \"Derived (p.1): Each bonus point card is worth +1 point, as printed on its face.\"","recordedAt":"2026-07-30T01:45:20.787Z","quotedPass1":"Named-but-undefined (p.1): bonus point cards (depicted as a black \"+1\" card; the text does not define its scoring effect beyond Game End's instruction to add bonus point cards to your score)","quotedPass2":"Derived (p.1): Each bonus point card is worth +1 point, as printed on its face."}
<!-- boardsmith:verify-run:end -->
