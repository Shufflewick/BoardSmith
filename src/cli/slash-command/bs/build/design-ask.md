# Design Ask — The First-UI-Chunk Visual Identity Gate (UIQ-01)

Referenced by `build/ask.md` (first-UI-chunk detection: this chunk's `## ui:` tag is
`touches`|`major` AND DESIGN.md does not yet exist on disk). For the first UI chunk **the ask IS
the design ask**: this file supplies the visual-identity direction menu that opens that single
ask, presented alongside ask.md's 4-part interpretation gate under **one** human-approval
boundary — not a separate earlier "explicit yes" (see "Gate-Before-Write" below). This is the
one-time decision of this game's visual identity before any UI chunk writes a single line of
styling — every UI chunk after the first reads the settled `DESIGN.md` this decision writes; it
never re-asks this question.

## Inputs

`rulebook/00-visual-survey.md` (written at ingest — see `ingest-rules.md` Step 3's visual
identity survey) is read as evidence: box art, component photos/descriptions, physical palette
and mood notes the designer already supplied. This step does not re-interview the designer for
raw visual facts already captured there; it uses them to inform which of the three directions
below fits, and to fill the Theme Block and Component Recipes once a direction is chosen.

## The Three Directions

Present exactly these three, in this order, never fewer or more:

**(A) Adopt** — use the physical game's own identity as the digital game's identity. Requires
user-supplied box art, component photos, or equivalent reference material; carries a trade-dress
caution when the underlying game is someone else's commercial product (their box art and
trademarked visual identity are not this project's to reuse without rights). Choose this only
when the user has supplied real source material and has the standing to use it.

**(B) Derive** — an original web design expressed in the physical game's palette and mood,
without depending on any supplied asset. This is the **default recommendation**: it needs no
asset dependence, carries no trade-dress risk, and still feels like "this game" through palette
and tone alone. Recommend Derive whenever the user has no strong preference or no source art.

**(C) Original** — invoke the `frontend-design` skill to produce 2-3 one-page throwaway HTML
mood sketches, then choose a direction from among them. Reserve this for a user who explicitly
wants a from-scratch visual identity independent of the physical game's look.

Present the three, name Derive as the default recommendation, and let the user's choice govern —
same negotiate-then-gate posture as `build/ask.md`'s "Gate-Before-Write".

## Gate-Before-Write

Present the three directions plus the rationale for the recommendation as the opening of this
chunk's single ask, **together with** ask.md's 4-part interpretation presentation, then negotiate.
Do **not** write `DESIGN.md` — not a partial draft, not a placeholder — and do not run a separate
earlier approval turn here: the direction choice is authorized by the **same** single explicit
"yes" that clears ask.md's "Gate-Before-Write", where `DESIGN.md` is written first (its Step 0)
before that gate's other durable writes. Presenting is not approving; only that one explicit yes
authorizes the write.

Only after that explicit yes, fill `templates/DESIGN.template.md`'s sections in the template's
own order — cite these section names, never restructure or rename them:

1. `## Chosen Direction` — the direction (Adopt/Derive/Original) and the rationale for it.
2. `## Theme Block (--bsg-* / applyTheme() overrides)` — every color override as a `--bsg-*`
   custom property or `applyTheme()` call; the ONLY place a color literal may appear in this
   game's UI.
3. `## Typography & Spacing` — font/spacing choices, referencing tokens where one already exists.
4. `## Component Recipes` — reusable component patterns this game's UI will implement repeatedly.
5. `## Placeholder Policy` — the concrete placeholder treatment for a missing asset (see below).
6. `## Do / Don't` — a short concrete list, always including the token-discipline hard rule
   verbatim (see "Token Discipline" below).

## Never-Blocking Placeholder Policy

A missing asset never blocks this gate or any chunk that depends on it: "I don't have art yet"
never blocks. If the user has no final art, `DESIGN.md`'s `## Placeholder Policy` records a
designed placeholder instead — correct aspect ratio (from the component inventory), styled with
this file's own tokens, so a placeholder looks "not-yet-final," never "broken." The debt itself
is recorded in `ASSETS.md`'s ledger (`templates/ASSETS.template.md`), never hidden — this mirrors
`build/ask.md`'s "Assets — Never-Blocking Placeholder Request" for the same reason: absence of an
asset is a tracked, visible debt, not a silent gap.

## Changing DESIGN.md Later Is Itself a Chunk

State this explicitly to the user before writing: editing `DESIGN.md` after this gate — any
change that re-styles or re-lays-out a previously verified surface — is itself a chunk. It flips
every affected, previously-verified chunk back to `built` (see `state-machine.md`
"Restyle/Cutover Rule"). There is no silent "we'll re-verify later"; the flip happens immediately
and is visible in the affected chunks' `CHUNK.md` files and in `SKETCH.md`. This is not a reason
to avoid changing the design later — it is a reason to make the choice deliberately now.

## Token Discipline

State this hard rule verbatim in `DESIGN.md`'s `## Do / Don't` section: color literals live ONLY
in the Theme Block; everywhere else, this game's UI code references `--bsg-*` tokens (or values
derived from them) via `applyTheme()`, never a literal hex/rgb/hsl color. This is what makes the
game inherit BoardSmith's Slate WCAG 2.2 AA contrast guarantees "for free" — a literal color
anywhere outside the Theme Block is a pit-of-failure that silently breaks that guarantee.

No fenced implementation code belongs in this file's own output beyond the Theme Block's CSS
custom-property overrides already specified by `templates/DESIGN.template.md` — this is directive
prose, not a code review.

## Downstream Shape (cite, never restate)

Once `DESIGN.md` is written, it is the upstream authority every subsequent `ui: touches|major`
chunk's `build/build.md` step reads for token discipline, component recipes, and placeholder
treatment (see `build/build.md`'s "UIQ-02 — Designed Placeholders" citation of `## Placeholder
Policy`). This file does not restate `build/build.md`'s own structure.
