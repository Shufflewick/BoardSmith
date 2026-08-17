/**
 * Image parsing for custom UIs. A game declares an element's art either as a
 * URL or as sprite-sheet coordinates; every renderer routes through these
 * helpers, so a misparse shows up as a blank card rather than an error.
 */
import { describe, it, expect } from 'vitest';
import {
  parseImageInfo,
  isUrlImage,
  isSpriteImage,
  getImageSrc,
  getSpriteStyle,
  getBackgroundImageStyle,
} from './image.js';

const SPRITE = { sprite: '/cards.png', x: 238, y: 333, width: 238, height: 333 };

describe('parseImageInfo', () => {
  it('reads a string as a URL image', () => {
    expect(parseImageInfo('/images/card.png')).toEqual({ type: 'url', src: '/images/card.png' });
  });

  it('reads a sprite object with coordinates as a sprite image', () => {
    expect(parseImageInfo(SPRITE)).toEqual({
      type: 'sprite', sprite: '/cards.png', x: 238, y: 333, width: 238, height: 333,
    });
  });

  it('accepts coordinates of zero', () => {
    expect(parseImageInfo({ sprite: '/cards.png', x: 0, y: 0 })).toMatchObject({
      type: 'sprite', x: 0, y: 0,
    });
  });

  it('defaults to standard playing-card dimensions when none are given', () => {
    expect(parseImageInfo({ sprite: '/cards.png', x: 0, y: 0 })).toMatchObject({
      width: 238, height: 333,
    });
  });

  it('treats a sprite path with no coordinates as a plain URL', () => {
    expect(parseImageInfo({ sprite: '/back.png' })).toEqual({ type: 'url', src: '/back.png' });
  });

  it('treats partial coordinates as a plain URL rather than guessing the other axis', () => {
    expect(parseImageInfo({ sprite: '/cards.png', x: 10 })).toEqual({ type: 'url', src: '/cards.png' });
  });

  it('returns null for a missing image', () => {
    for (const empty of [null, undefined, '', 0, false]) {
      expect(parseImageInfo(empty)).toBeNull();
    }
  });

  it('returns null for an object that is not an image at all', () => {
    expect(parseImageInfo({ foo: 'bar' })).toBeNull();
    expect(parseImageInfo({ x: 1, y: 2 })).toBeNull();
  });

  it('returns null for a number or boolean', () => {
    expect(parseImageInfo(42)).toBeNull();
    expect(parseImageInfo(true)).toBeNull();
  });

  it('does not mutate the sprite object it reads', () => {
    const input = { ...SPRITE };
    parseImageInfo(input);
    expect(input).toEqual(SPRITE);
  });
});

describe('isUrlImage / isSpriteImage', () => {
  it('classifies a string as a URL', () => {
    expect(isUrlImage('/card.png')).toBe(true);
    expect(isSpriteImage('/card.png')).toBe(false);
  });

  it('classifies a coordinate sprite as a sprite', () => {
    expect(isSpriteImage(SPRITE)).toBe(true);
    expect(isUrlImage(SPRITE)).toBe(false);
  });

  it('classifies a coordinate-less sprite path as a URL', () => {
    expect(isUrlImage({ sprite: '/back.png' })).toBe(true);
    expect(isSpriteImage({ sprite: '/back.png' })).toBe(false);
  });

  it('says no to both for a missing image', () => {
    expect(isUrlImage(null)).toBe(false);
    expect(isSpriteImage(null)).toBe(false);
  });

  it('are mutually exclusive for every input', () => {
    for (const input of ['/a.png', SPRITE, { sprite: '/b.png' }, null, 7]) {
      expect(isUrlImage(input) && isSpriteImage(input)).toBe(false);
    }
  });
});

describe('getImageSrc', () => {
  it('returns the URL of a URL image', () => {
    expect(getImageSrc('/card.png')).toBe('/card.png');
  });

  it('returns the path of a coordinate-less sprite object', () => {
    expect(getImageSrc({ sprite: '/back.png' })).toBe('/back.png');
  });

  it('returns an empty string for a sprite, which has no single src', () => {
    expect(getImageSrc(SPRITE)).toBe('');
  });

  it('returns an empty string rather than undefined for a missing image', () => {
    expect(getImageSrc(null)).toBe('');
    expect(getImageSrc(undefined)).toBe('');
  });
});

describe('getSpriteStyle', () => {
  it('points the background at the sprite sheet', () => {
    expect(getSpriteStyle(SPRITE).backgroundImage).toBe('url(/cards.png)');
  });

  it('sizes the element to the requested display size', () => {
    const style = getSpriteStyle(SPRITE, 60, 84);
    expect(style.width).toBe('60px');
    expect(style.height).toBe('84px');
  });

  it('defaults to a 60x84 card', () => {
    const style = getSpriteStyle(SPRITE);
    expect(style.width).toBe('60px');
    expect(style.height).toBe('84px');
  });

  it('offsets the background negatively so the requested cell shows', () => {
    const style = getSpriteStyle(SPRITE, 238, 333);
    expect(style.backgroundPosition).toBe('-238px -333px');
  });

  it('scales the offset with the display size', () => {
    const style = getSpriteStyle(SPRITE, 119, 166.5);
    expect(style.backgroundPosition).toBe('-119px -166.5px');
  });

  it('puts the top-left cell at the origin', () => {
    const style = getSpriteStyle({ sprite: '/cards.png', x: 0, y: 0 }, 60, 84);
    expect(style.backgroundPosition).toBe('0px 0px');
  });

  it('scales the whole 13x5 sheet to match the cell size', () => {
    const style = getSpriteStyle(SPRITE, 238, 333);
    expect(style.backgroundSize).toBe(`${13 * 238}px ${5 * 333}px`);
  });

  it('returns no styles for a URL image', () => {
    expect(getSpriteStyle('/card.png')).toEqual({});
  });

  it('returns no styles for a missing image', () => {
    expect(getSpriteStyle(null)).toEqual({});
  });
});

describe('getBackgroundImageStyle', () => {
  it('sets the background image for a URL', () => {
    expect(getBackgroundImageStyle('/card.png').backgroundImage).toBe('url(/card.png)');
  });

  it('fits the art inside the element without repeating it', () => {
    expect(getBackgroundImageStyle('/card.png')).toMatchObject({
      backgroundSize: 'contain',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
  });

  it('works for a coordinate-less sprite path, which parses as a URL', () => {
    expect(getBackgroundImageStyle({ sprite: '/back.png' }).backgroundImage).toBe('url(/back.png)');
  });

  it('returns no styles for a sprite — that is getSpriteStyle territory', () => {
    expect(getBackgroundImageStyle(SPRITE)).toEqual({});
  });

  it('returns no styles for a missing image', () => {
    expect(getBackgroundImageStyle(null)).toEqual({});
    expect(getBackgroundImageStyle('')).toEqual({});
  });
});
