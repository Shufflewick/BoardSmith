# Design

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

<!-- This is the visual-design contract for this game's UI. It is written by the design session
     (ingest/design-session.md) at the moment the designer signs off, after the sketch is
     approved and before any chunk is built. It does not exist before then, and no chunk is built
     until it does.

     CHANGING THIS FILE IS ITSELF A CHUNK: any edit here, or to the theme file it names, that
     re-styles or re-lays-out a previously verified surface flips those chunks back to `built`
     (see state-machine.md "Restyle Rule"). There is no silent "we'll re-verify later" — the flip
     happens immediately and is visible in the affected chunks' CHUNK.md files and in SKETCH.md.

     THE HARD RULE: color literals live ONLY in the theme file named below (`src/ui/theme.css`).
     Everywhere else in this game's UI code, styling references `--bsg-*` or `--game-*` tokens
     (or values derived from them), never a literal hex/rgb/hsl color. The palette passed the
     contrast and colorblind checks at sign-off; a literal color anywhere else silently escapes
     them. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, "## Sign-Off",
     "## Chosen Design", "## Theme File", "## Typography & Spacing", "## Component Recipes",
     "## Motion Intents", "## Placeholder Policy", "## Do / Don't". If any required heading is
     missing, a resuming session STOPS and asks the user — it never guesses the intended state.
     See state-machine.md "Cold-Resume Parse Contract". -->

## Sign-Off

<!-- Who signed the design off and when, and what the checks found. Written once, at sign-off. -->

- Signed off by: <!-- the designer, as they gave their name -->
- Signed off at: <!-- ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ` -->
- Recorded in: <!-- QUESTIONS.md Question N -->
- Gallery: design/gallery/index.html <!-- the archived mocks, kept as reference -->
- Contrast check: <!-- axe color-contrast over the chosen design, light and dark, 1440px and 390px: 0 violations -->
- Colorblind check: <!-- protanopia, deuteranopia, tritanopia, achromatopsia: what was checked, and that every distinction still reads without color -->

## Chosen Design

<!-- The whole-screen direction the designer chose, and every component they took from a
     different direction or variant (the gallery's per-component switcher). One line each, in
     the designer's own words where they gave reasons. -->

- Direction: <!-- e.g. "B — Lantern-lit market: warm brass on deep ink" -->
- <!-- component -->: <!-- direction/variant, e.g. "Card: D (the stamped-paper card)" -->

## Theme File

<!-- The ONLY place color literals may appear in this game's UI: `src/ui/theme.css`, written at
     sign-off from the chosen design and imported by the game's UI entry (`src/ui/index.ts`). It
     holds the `--bsg-*` overrides for both schemes, in the four selectors docs/ui-components.md
     "Theming" gives, and the game's own `--game-*` tokens. The CSS lives there, not here, so the
     signed-off design is carried into code as-is rather than re-interpreted. List here what each
     `--game-*` token is for. -->

- File: src/ui/theme.css
- <!-- --game-token -->: <!-- what it colors -->

## Typography & Spacing

<!-- Font family/size/weight choices (if diverging from Slate defaults) and any spacing-scale
     notes specific to this game's components. References tokens, not literal px values, where
     a token already exists for the value. -->

## Component Recipes

<!-- Reusable component patterns this game's UI relies on repeatedly, as the chosen mocks show
     them (e.g. "card face uses a 2:3 aspect-ratio frame with a token-colored border and a
     corner-pip layout"). Each recipe should be concrete enough that a new chunk's `build` step
     can implement a new instance of the same component without re-deriving the pattern from
     scratch, and names the gallery mock it comes from. -->

## Motion Intents

<!-- One line per key interaction: what moves, from where to where, and what it tells the player
     (e.g. "card flies from deck to hand: you drew it"). Recorded at the design session, never
     built there: the animation chunk builds them once the screens are stable, and the designer
     picks among two or three motion variants of each in its playtest. -->

- <!-- interaction -->: <!-- intent -->

## Placeholder Policy

<!-- How this game handles a missing asset (see ASSETS.md) at the presentation layer.
     A missing asset never blocks a chunk: record a designed placeholder here — correct aspect
     ratio, styled with the theme file's tokens, so a placeholder never looks "broken," only
     "not-yet-final." State the concrete placeholder treatment (e.g. "a token-colored rounded
     rect at the asset's declared aspect ratio, with the component's label centered on it"). -->

## Do / Don't

<!-- A short, concrete list of do's and don'ts specific to this game's visual design — the
     kind of thing a fresh-context build session needs to know without re-reading every prior
     chunk's UI code. Always include, verbatim, the hard rule below. -->

- Do: reference `--bsg-*` or `--game-*` tokens (or values derived from them) for every color in
  every component.
- Don't: hardcode a literal color (hex/rgb/hsl) anywhere outside the theme file —
  color literals live only in the theme file, everything else references tokens.
- Do: keep the Action Panel beside the board on every screen; every action is in it.
- Do: <!-- game-specific do -->
- Don't: <!-- game-specific don't -->
