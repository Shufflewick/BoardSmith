# Design

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

<!-- This is the visual-identity contract for this game's UI. It is written at the FIRST UI
     chunk's `ask` step (the first chunk tagged `ui: touches` or `ui: major` in SKETCH.md), not
     at ingest — there is no visual identity to decide until a UI chunk actually needs one.

     CHANGING THIS FILE IS ITSELF A CHUNK: any edit here that re-styles or re-lays-out a
     previously verified surface flips those chunks back to `built` (see state-machine.md
     "Restyle/Cutover Rule"). There is no silent "we'll re-verify later" — the flip happens
     immediately and is visible in the affected chunks' CHUNK.md files and in SKETCH.md.

     THE HARD RULE: color literals live ONLY in the theme block below. Everywhere else in this
     game's UI code, styling references `--bsg-*` tokens (or values derived from them), never a
     literal hex/rgb/hsl color. This is what makes the game inherit BoardSmith's Slate WCAG 2.2
     AA contrast guarantees "for free" — a literal color anywhere outside the theme block is a
     pit-of-failure that silently breaks that guarantee. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, "## Chosen Direction",
     "## Theme Block (--bsg-* / applyTheme() overrides)", "## Typography & Spacing",
     "## Component Recipes", "## Placeholder Policy", "## Do / Don't". If any required heading
     is missing, a resuming session STOPS and asks the user — it never guesses the intended
     state. See state-machine.md "Cold-Resume Parse Contract". -->

## Chosen Direction

<!-- One of exactly three directions, plus the rationale for choosing it:
     - Adopt: use BoardSmith's default Slate palette/typography as-is, no overrides.
     - Derive: keep Slate's structure/contrast guarantees but override specific tokens (e.g. a
       different accent hue) to give the game its own identity.
     - Original: a from-scratch visual identity, still expressed entirely through --bsg-* token
       overrides (never through literal colors outside the theme block below).

     State which direction was chosen and why (e.g. "Derive — the rulebook's box art uses a
     forest-green palette; Slate's neutral graphite chrome stays, accent token overridden to
     match"). -->

Direction: <!-- Adopt | Derive | Original -->

Rationale: <!-- why this direction fits this game -->

## Theme Block (--bsg-* / applyTheme() overrides)

<!-- The ONLY place color literals may appear in this game's UI. Every override here is a
     --bsg-* custom property or an applyTheme() call; nothing outside this block may hardcode a
     color. If Direction is "Adopt", this block may be empty (explicitly state "no overrides —
     using Slate defaults" rather than leaving the section blank). -->

```css
:root {
  /* --bsg-accent: #...; */
}
```

## Typography & Spacing

<!-- Font family/size/weight choices (if diverging from Slate defaults) and any spacing-scale
     notes specific to this game's components. References tokens, not literal px values, where
     a token already exists for the value. -->

## Component Recipes

<!-- Reusable component patterns this game's UI relies on repeatedly (e.g. "card face uses a
     2:3 aspect-ratio frame with a token-colored border and a corner-pip layout"). Each recipe
     should be concrete enough that a new chunk's `build` step can implement a new instance of
     the same component without re-deriving the pattern from scratch. -->

## Placeholder Policy

<!-- How this game handles a missing asset (see ASSETS.md) at the presentation layer.
     A missing asset never blocks a chunk: record a designed placeholder here — correct aspect
     ratio, styled with this file's own tokens, so a placeholder never looks "broken," only
     "not-yet-final." State the concrete placeholder treatment (e.g. "a token-colored rounded
     rect at the asset's declared aspect ratio, with the component's label centered on it"). -->

## Do / Don't

<!-- A short, concrete list of do's and don'ts specific to this game's visual identity — the
     kind of thing a fresh-context build session needs to know without re-reading every prior
     chunk's UI code. Always include, verbatim, the hard rule below. -->

- Do: reference `--bsg-*` tokens (or values derived from them) for every color in every
  component.
- Don't: hardcode a literal color (hex/rgb/hsl) anywhere outside the Theme Block above —
  color literals live only in the theme block, everything else references tokens.
- Do: <!-- game-specific do -->
- Don't: <!-- game-specific don't -->
