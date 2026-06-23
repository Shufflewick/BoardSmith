// TEMPORARY ignore list — Phase 99 (Theming Swap) empties this as it sweeps each file's
// neon literals into `--bsg-*` tokens; this list MUST end at zero exclusions.
// Do not add files here to silence new violations.
//
// When Phase 99 is complete every entry below is removed, and `lint:css` enforces
// color-no-hex with zero exclusions across all of src/ui/**/*.vue.

/** @type {import('stylelint').Config} */
module.exports = {
  // postcss-html parses <style> blocks inside Vue SFCs (.vue files).
  // Required so stylelint can inspect the CSS within single-file components.
  customSyntax: 'postcss-html',

  rules: {
    // Forbid raw hex literals (e.g. #ff0000, #fff). Use --bsg-* tokens instead.
    // theme.ts is exempt — it is the sole sanctioned home for color literals and
    // is never linted by this config (theme.ts is .ts, not .vue).
    'color-no-hex': true,
  },

  // Files still containing neon hex literals pending the Phase 99 sweep.
  // Phase 99 removes each entry here as it migrates that file's literals to --bsg-* tokens.
  // DO NOT add new entries to this list to silence violations in new or already-clean files.
  ignoreFiles: [
    // Auto-UI renderer components — neon hex sweep deferred to Phase 99
    'src/ui/components/auto-ui/renderers/*.vue',

    // Auto-UI top-level components — swept in Phase 99
    'src/ui/components/auto-ui/ActionPanel.vue',
    'src/ui/components/auto-ui/AutoRenderer.vue',
    'src/ui/components/auto-ui/AutoUI.vue',
    'src/ui/components/auto-ui/DoneButton.vue',

    // Auto-UI archetype components — swept in Phase 99
    'src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue',

    // Chrome shell components — swept in Phase 99
    'src/ui/components/GameShell.vue',
    'src/ui/components/WaitingRoom.vue',
    'src/ui/components/DebugPanel.vue',
    'src/ui/components/GameHeader.vue',
    'src/ui/components/GameHistory.vue',
    'src/ui/components/GameLobby.vue',
    'src/ui/components/HamburgerMenu.vue',
    'src/ui/components/PlayersPanel.vue',
    'src/ui/components/Toast.vue',

    // Helper/overlay components — swept in Phase 99
    'src/ui/components/helpers/Button.vue',
    'src/ui/components/helpers/FlyingCardsOverlay.vue',
    'src/ui/components/helpers/ZoomPreviewOverlay.vue',
  ],
};
