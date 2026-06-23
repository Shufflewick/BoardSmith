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

  // Phase 99 (Theming Swap) is complete — all neon hex literals migrated to --bsg-* tokens.
  // color-no-hex is enforced with zero exclusions across all of src/ui/**/*.vue.
  ignoreFiles: [],
};
