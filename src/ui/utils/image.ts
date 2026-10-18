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
 * @throws if a sprite with coordinates lacks its width, height, sheetWidth or sheetHeight
 */
export function parseImageInfo(image: unknown): ImageInfo | null {
  if (!image) return null;

  // String URL
  if (typeof image === 'string') {
    return { type: 'url', src: image };
  }

  // Sprite object
  if (typeof image === 'object' && image !== null) {
    const spriteObj = image as SpriteData;

    // Full sprite with coordinates
    if (spriteObj.sprite && typeof spriteObj.x === 'number' && typeof spriteObj.y === 'number') {
      const missing = SPRITE_SIZES.filter((key) => typeof spriteObj[key] !== 'number');
      if (missing.length > 0) {
        throw new Error(
          `Sprite image '${spriteObj.sprite}' at x ${spriteObj.x}, y ${spriteObj.y} is missing ${missing.join(', ')}. `
          + 'Give each sprite its own width and height and the whole sheet image\'s sheetWidth and sheetHeight, in pixels.',
        );
      }
      const { sprite, x, y, width, height, sheetWidth, sheetHeight } = spriteObj;
      return { type: 'sprite', sprite, x, y, width, height, sheetWidth, sheetHeight };
    }

    // Just sprite path (no coordinates = use as URL)
    if (spriteObj.sprite) {
      return { type: 'url', src: spriteObj.sprite };
    }
  }

  return null;
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
