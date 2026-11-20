/**
 * The colour a reader sees behind an element: its own background and its
 * ancestors', composited the way the browser draws them, down to the first
 * opaque one. Used to judge whether text in a seat colour reads where it sits
 * (#1733), since the theme, a game's theme.css and a host's overrides all decide
 * that background at run time.
 */
import { composite, type Rgb, type Rgba } from './color-contrast.js';

const COMPUTED_RGB = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/;
const COMPUTED_SRGB = /^color\(srgb ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)(?: \/ ([\d.]+))?\)$/;

/** A computed `background-color`: `rgb()`/`rgba()`, or `color(srgb ...)`, which a `color-mix()` computes to. */
function parseComputed(value: string): Rgba {
  const rgb = value.match(COMPUTED_RGB);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  const srgb = value.match(COMPUTED_SRGB);
  if (srgb) return { r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: srgb[4] === undefined ? 1 : +srgb[4] };
  throw new Error(
    `The background "${value}" is not in rgb() or color(srgb), so its contrast cannot be judged. ` +
      'Give the theme colour in hex, rgb() or hsl().',
  );
}

/**
 * The opaque colour drawn behind `el`.
 *
 * @throws {Error} when nothing behind `el` is opaque, a layer paints an image or
 *   gradient, or a layer is in a colour space this cannot read: each way the
 *   contrast cannot be judged.
 */
export function effectiveBackground(el: Element): Rgb {
  const layers: Rgba[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.backgroundImage !== 'none') {
      throw new Error(`A background image (${style.backgroundImage}) is behind this element, so its contrast cannot be judged.`);
    }
    const layer = parseComputed(style.backgroundColor);
    if (layer.a === 0) continue;
    if (layer.a < 1) {
      layers.push(layer);
      continue;
    }
    return layers.reduceRight<Rgb>((under, over) => composite(over, under), layer);
  }
  throw new Error('Nothing behind this element has an opaque background, so its contrast cannot be judged.');
}
