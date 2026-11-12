import { transform } from 'esbuild';
import type { Plugin } from 'vite';

/**
 * The oldest browsers a built game supports (#1633), as esbuild targets: Safari and iOS 16.4 (the
 * human's choice, and Tailwind v4's floor) with the Chrome, Edge and Firefox releases Tailwind pairs
 * with it. docs/custom-ui-guide.md states it for authors; build-browser-floor.test.ts holds it there.
 */
export const BROWSER_FLOOR = ['safari16.4', 'ios16.4', 'chrome111', 'edge111', 'firefox128'];

const BROWSER_NAMES: Record<string, string> = { safari: 'Safari', ios: 'iOS', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' };
const named = BROWSER_FLOOR.map((target) => target.replace(/^(\D+)(.*)$/, (_, name: string, version: string) => `${BROWSER_NAMES[name]} ${version}`));

/** The floor as a reader says it: "Safari 16.4, iOS 16.4, ... and Firefox 128". */
export const BROWSER_FLOOR_NAMES = `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;

/** The build options that target the floor, for the UI bundle's `viteBuild`. */
export const floorBuildOptions = { target: BROWSER_FLOOR, cssTarget: BROWSER_FLOOR };

const REGEXP_FEATURES = ['dot-all-flag', 'lookbehind-assertions', 'match-indices', 'named-capture-groups', 'set-notation', 'sticky-and-unicode-flags', 'unicode-property-escapes'];

/**
 * esbuild options for the UI bundle. Regular expressions stay as written so `browserFloorCheck`
 * sees them: esbuild otherwise rewrites one the floor lacks into a `new RegExp` that throws on the
 * old browser instead of failing the build.
 */
export const floorEsbuildOptions = { supported: Object.fromEntries(REGEXP_FEATURES.map((feature) => [`regexp-${feature}`, true])) };

/** The at-rules every floor browser parses, with those `@font-feature-values` holds (Safari 16.4 has no `@counter-style`). */
const FLOOR_AT_RULES = new Set([
  'charset', 'import', 'namespace', 'media', 'supports', 'font-face', 'keyframes', '-webkit-keyframes', 'page', 'layer', 'container', 'property', 'font-palette-values',
  'font-feature-values', 'stylistic', 'historical-forms', 'styleset', 'character-variant', 'swash', 'ornaments', 'annotation',
]);

// shortcut: a hand list of the newer CSS functions and selectors most likely to be reached for; check MDN's compat data instead when the floor moves or one slips past.
const ABOVE_FLOOR_CSS = /light-dark\(|:user-(?:valid|invalid)\b|:popover-open\b|:state\(|::details-content\b/;

const fix = 'Rewrite it with what those browsers have; docs/custom-ui-guide.md, "Check it on a real phone", states the floor.';

/** Why `code` (a built JavaScript file) holds syntax the floor cannot parse, or undefined when it does not. */
async function jsProblem(file: string, code: string): Promise<string | undefined> {
  // esbuild lowers only what its target lacks, so output that changes under the floor used something newer.
  const [floor, latest] = await Promise.all([BROWSER_FLOOR, 'esnext'].map(async (target) => (await transform(code, { target })).code.split('\n')));
  const at = latest.findIndex((line, i) => line !== floor[i]);
  if (at === -1) return undefined;
  return `${file} holds JavaScript that ${BROWSER_FLOOR_NAMES} cannot parse: ${latest[at].trim().slice(0, 200)}\n${fix}`;
}

/** Why `css` (a built stylesheet) holds CSS the floor cannot parse, or undefined when it does not. */
function cssProblem(file: string, css: string): string | undefined {
  // An escape (Tailwind's `\@` or `\"` in a class name) is one character, never a string or an at-rule.
  const code = css.replace(/\\[\s\S]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|url\([^)]*\)/g, (token) => (token[0] === '\\' ? '_' : '""'));
  const found = [...code.matchAll(/@([\w-]+)/g)].find(([, name]) => !FLOOR_AT_RULES.has(name.toLowerCase()))?.[0] ?? code.match(ABOVE_FLOOR_CSS)?.[0];
  return found && `${file} holds CSS that ${BROWSER_FLOOR_NAMES} cannot parse: ${found}\n${fix}`;
}

/** Fails the build when an emitted JavaScript or CSS file holds anything the floor cannot parse (#1633). */
export function browserFloorCheck(): Plugin {
  return {
    name: 'boardsmith:browser-floor',
    // After Vite's own generateBundle hooks, which emit the one stylesheet of `cssCodeSplit: false`.
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const problems = await Promise.all(Object.values(bundle).map((file) => {
        if (file.type === 'chunk') return jsProblem(file.fileName, file.code);
        return file.fileName.endsWith('.css') ? cssProblem(file.fileName, String(file.source)) : undefined;
      }));
      const found = problems.filter((problem) => problem !== undefined);
      if (found.length > 0) this.error(found.join('\n\n'));
    },
  };
}
