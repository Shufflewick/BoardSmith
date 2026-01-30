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
 *   const style = getSpriteStyle(cardData.faceImage, 60, 84);
 * }
 * ```
 */

import type { CSSProperties } from 'vue';

/**
 * Parsed image information.
 * Either a URL string or sprite sheet coordinates.
 */
export type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

/**
 * Sprite sheet object format.
 */
export interface SpriteData {
  /** Path to the sprite sheet image */
  sprite: string;
  /** X coordinate in the sprite sheet (pixels) */
  x: number;
  /** Y coordinate in the sprite sheet (pixels) */
  y: number;
  /** Width of this sprite (pixels) */
  width?: number;
  /** Height of this sprite (pixels) */
  height?: number;
}

// Default card dimensions in sprite sheets (standard playing cards)
const DEFAULT_CARD_WIDTH = 238;
const DEFAULT_CARD_HEIGHT = 333;

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
 * parseImageInfo({ sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333 })
 * // => { type: 'sprite', sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333 }
 * ```
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
      return {
        type: 'sprite',
        sprite: spriteObj.sprite,
        x: spriteObj.x,
        y: spriteObj.y,
        width: spriteObj.width ?? DEFAULT_CARD_WIDTH,
        height: spriteObj.height ?? DEFAULT_CARD_HEIGHT,
      };
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
 * Get CSS styles for displaying a sprite at specified dimensions.
 * Handles proper scaling from native sprite dimensions.
 *
 * @param image - Image data (should be sprite type)
 * @param displayWidth - Target display width (default: 60)
 * @param displayHeight - Target display height (default: 84)
 * @returns CSS properties for the sprite element
 *
 * @example
 * ```vue
 * <div :style="getSpriteStyle(cardData.faceImage, 60, 84)" />
 * ```
 */
export function getSpriteStyle(
  image: unknown,
  displayWidth: number = 60,
  displayHeight: number = 84
): CSSProperties {
  const info = parseImageInfo(image);

  if (info?.type === 'sprite') {
    // Scale based on standard card dimensions
    const scaleX = displayWidth / DEFAULT_CARD_WIDTH;
    const scaleY = displayHeight / DEFAULT_CARD_HEIGHT;

    return {
      backgroundImage: `url(${info.sprite})`,
      backgroundPosition: `${-info.x * scaleX}px ${-info.y * scaleY}px`,
      backgroundSize: `${13 * DEFAULT_CARD_WIDTH * scaleX}px ${5 * DEFAULT_CARD_HEIGHT * scaleY}px`,
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
    };
  }

  return {};
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
