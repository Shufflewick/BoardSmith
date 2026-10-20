/**
 * Image utilities for BoardSmith UI components.
 *
 * Provides consistent image parsing for cards, pieces, and other game elements.
 * Supports both URL-based images and CSS sprite sheets.
 *
 * @example
 * ```typescript
 * import { parseImageInfo, getSpriteStyle } from 'boardsmith/ui/utils/image';
 *
 * const info = parseImageInfo(cardData.faceImage);
 * if (info?.type === 'sprite') {
 *   const style = getSpriteStyle(cardData.faceImage);
 * }
 * ```
 */

import type { CSSProperties } from 'vue';
import type { ImageRef } from '../../engine/element/types.js';

/**
 * Parsed image information.
 * Either a URL string or sprite sheet coordinates.
 */
export type ImageInfo =
  | { type: 'url'; src: string }
  | ({ type: 'sprite' } & SpriteData);

/**
 * Sprite sheet object format: where one sprite sits on its sheet, the sprite's
 * own `width` and `height`, and the whole sheet image's `sheetWidth` and
 * `sheetHeight`, all in pixels.
 */
export type SpriteData = Exclude<ImageRef, string>;

const SPRITE_SIZES = ['width', 'height', 'sheetWidth', 'sheetHeight'] as const;

/**
 * Parse image data from cardData - handles both string URLs and sprite objects.
 *
 * @param image - Image data (string URL or SpriteData object)
 * @returns Parsed image info or null if invalid
 *
 * @example
 * ```typescript
 * // URL string
 * parseImageInfo('/images/card.png')
 * // => { type: 'url', src: '/images/card.png' }
 *
 * // Sprite object
 * parseImageInfo({ sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333, sheetWidth: 3094, sheetHeight: 1665 })
 * // => { type: 'sprite', sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333, sheetWidth: 3094, sheetHeight: 1665 }
 * ```
 *
 * @throws for an image object that is not one of the two shapes: `{ sprite }` alone, shown whole
 *   as a URL, or `{ sprite, x, y, width, height, sheetWidth, sheetHeight }` with every one a number.
 *   Anything else would draw the wrong thing, or nothing, with no message (#864, #1303).
 */
export function parseImageInfo(image: unknown): ImageInfo | null {
  if (!image) return null;

  // String URL
  if (typeof image === 'string') {
    return { type: 'url', src: image };
  }

  if (typeof image !== 'object') return null;
  const spriteObj = image as Record<string, unknown>;
  const { sprite } = spriteObj;
  if (typeof sprite !== 'string' || sprite === '') {
    throw new Error(
      `An image object needs "sprite", the path of its image or sprite sheet, as text. This one has ${Object.keys(spriteObj).join(', ') || 'nothing'}.`,
    );
  }

  // Just sprite path (no coordinates or sizes = use as URL)
  if (!['x', 'y', ...SPRITE_SIZES].some((key) => key in spriteObj)) return { type: 'url', src: sprite };

  const { x, y } = spriteObj;
  if (!isPixels(x) || !isPixels(y)) {
    throw new Error(
      `Sprite image '${sprite}' has ${shown(x)} for x and ${shown(y)} for y, but a sprite's place on its sheet is two numbers, x and y, in pixels. `
      + 'Give both, or leave out every coordinate and size to show the whole image.',
    );
  }
  const missing = SPRITE_SIZES.filter((key) => spriteObj[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Sprite image '${sprite}' at x ${x}, y ${y} is missing ${missing.join(', ')}. `
      + 'Give each sprite its own width and height and the whole sheet image\'s sheetWidth and sheetHeight, in pixels.',
    );
  }
  const notNumbers = SPRITE_SIZES.filter((key) => !isPixels(spriteObj[key]));
  if (notNumbers.length > 0) {
    throw new Error(
      `Sprite image '${sprite}' at x ${x}, y ${y} has ${notNumbers.map((key) => `${shown(spriteObj[key])} for ${key}`).join(', ')}, which must be ${notNumbers.length === 1 ? 'a number' : 'numbers'}.`,
    );
  }
  const { width, height, sheetWidth, sheetHeight } = spriteObj as unknown as SpriteData;
  return { type: 'sprite', sprite, x, y, width, height, sheetWidth, sheetHeight };
}

function isPixels(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A value as a message shows it: nothing, or as JSON writes it. */
function shown(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

/**
 * Check if image is a URL type.
 */
export function isUrlImage(image: unknown): boolean {
  return parseImageInfo(image)?.type === 'url';
}

/**
 * Check if image is a sprite type.
 */
export function isSpriteImage(image: unknown): boolean {
  return parseImageInfo(image)?.type === 'sprite';
}

/**
 * Get URL src from image data.
 * Returns empty string if not a URL image.
 */
export function getImageSrc(image: unknown): string {
  const info = parseImageInfo(image);
  if (info?.type === 'url') return info.src;
  return '';
}

/**
 * Get CSS background styles for displaying a sprite.
 * With no size, the styles are relative to the element, so one sprite cell fills whatever box the caller's CSS gives it.
 * With a size, they are in pixels for an element of exactly that size. The element's own size is always left to the caller's CSS.
 *
 * @param image - Image data (should be sprite type)
 * @param displayWidth - Display width in pixels, given together with displayHeight
 * @param displayHeight - Display height in pixels
 * @returns CSS properties for the sprite element
 *
 * @example
 * ```vue
 * <div class="card" :style="getSpriteStyle(cardData.faceImage)" />
 * ```
 */
export function getSpriteStyle(image: unknown): CSSProperties;
export function getSpriteStyle(image: unknown, displayWidth: number, displayHeight: number): CSSProperties;
export function getSpriteStyle(
  image: unknown,
  displayWidth?: number,
  displayHeight?: number
): CSSProperties {
  const info = parseImageInfo(image);
  if (info?.type !== 'sprite') return {};

  const base = { backgroundImage: `url(${info.sprite})`, backgroundRepeat: 'no-repeat' };
  if (displayWidth === undefined || displayHeight === undefined) {
    // A percentage position p puts the image at (box - image) * p, so the cell's offset over the sheet's spare width gives it.
    const percent = (offset: number, cell: number, sheet: number) =>
      sheet === cell ? 0 : (offset / (sheet - cell)) * 100;
    return {
      ...base,
      backgroundPosition: `${percent(info.x, info.width, info.sheetWidth)}% ${percent(info.y, info.height, info.sheetHeight)}%`,
      backgroundSize: `${(info.sheetWidth / info.width) * 100}% ${(info.sheetHeight / info.height) * 100}%`,
    };
  }

  const scaleX = displayWidth / info.width;
  const scaleY = displayHeight / info.height;
  return {
    ...base,
    backgroundPosition: `${-info.x * scaleX}px ${-info.y * scaleY}px`,
    backgroundSize: `${info.sheetWidth * scaleX}px ${info.sheetHeight * scaleY}px`,
  };
}

/**
 * Get background style for a URL image.
 *
 * @param image - Image data (should be URL type)
 * @returns CSS properties for background-image
 */
export function getBackgroundImageStyle(image: unknown): CSSProperties {
  const info = parseImageInfo(image);

  if (info?.type === 'url') {
    return {
      backgroundImage: `url(${info.src})`,
      backgroundSize: 'contain',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }

  return {};
}
