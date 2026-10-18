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

// A standard 13x5 deck of 238x333 cards.
const SHEET = { sheetWidth: 13 * 238, sheetHeight: 5 * 333 };
const SPRITE = { sprite: '/cards.png', x: 238, y: 333, width: 238, height: 333, ...SHEET };
const ORIGIN = { sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333, ...SHEET };

describe('parseImageInfo', () => {
  it('reads a string as a URL image', () => {
    expect(parseImageInfo('/images/card.png')).toEqual({ type: 'url', src: '/images/card.png' });
  });

  it('reads a sprite object with coordinates as a sprite image', () => {
    expect(parseImageInfo(SPRITE)).toEqual({
      type: 'sprite', sprite: '/cards.png', x: 238, y: 333, width: 238, height: 333, ...SHEET,
    });
  });

  it('accepts coordinates of zero', () => {
    expect(parseImageInfo(ORIGIN)).toMatchObject({ type: 'sprite', x: 0, y: 0 });
  });

  it('refuses a sprite with no sprite size or sheet size, naming what is missing (#864)', () => {
    expect(() => parseImageInfo({ sprite: '/cards.png', x: 0, y: 0 })).toThrow(
      "Sprite image '/cards.png' at x 0, y 0 is missing width, height, sheetWidth, sheetHeight. "
      + 'Give each sprite its own width and height and the whole sheet image\'s sheetWidth and sheetHeight, in pixels.',
    );
  });

  it('refuses a sprite missing only the sheet size (#864)', () => {
    expect(() => parseImageInfo({ sprite: '/cards.png', x: 0, y: 0, width: 238, height: 333 }))
      .toThrow('is missing sheetWidth, sheetHeight.');
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

  it('leaves the element size to the caller CSS and does not tile the sheet (#733)', () => {
    const style = getSpriteStyle(SPRITE, 60, 84);
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
    expect(style.backgroundRepeat).toBe('no-repeat');
  });

  it('with no size, fits one sprite cell to whatever box the element has (#1019)', () => {
    // Resolve the percentages the way CSS does for a box, and compare with the pixel style for that box.
    const resolve = (style: ReturnType<typeof getSpriteStyle>, boxW: number, boxH: number) => {
      const [sw, sh] = String(style.backgroundSize).split(' ').map((v) => parseFloat(v) / 100);
      const [px, py] = String(style.backgroundPosition).split(' ').map((v) => parseFloat(v) / 100);
      return { size: [sw * boxW, sh * boxH], position: [(boxW - sw * boxW) * px, (boxH - sh * boxH) * py] };
    };
    for (const [boxW, boxH] of [[60, 84], [72, 100.8], [96, 134.4]]) {
      const fitted = resolve(getSpriteStyle(SPRITE), boxW, boxH);
      const pixels = getSpriteStyle(SPRITE, boxW, boxH);
      expect(fitted.size.map((v) => v.toFixed(3))).toEqual(
        String(pixels.backgroundSize).split(' ').map((v) => parseFloat(v).toFixed(3)));
      expect(fitted.position.map((v) => (v + 0).toFixed(3))).toEqual(
        String(pixels.backgroundPosition).split(' ').map((v) => (parseFloat(v) + 0).toFixed(3)));
    }
  });

  it('with no size, puts a sprite on a one-cell-wide sheet at the left edge', () => {
    const column = { sprite: '/col.png', x: 0, y: 140, width: 100, height: 140, sheetWidth: 100, sheetHeight: 700 };
    expect(getSpriteStyle(column)).toMatchObject({ backgroundSize: '100% 500%', backgroundPosition: '0% 25%' });
  });

  it('accepts an already parsed sprite', () => {
    const info = parseImageInfo(SPRITE)!;
    expect(getSpriteStyle(info, 238, 333)).toEqual(getSpriteStyle(SPRITE, 238, 333));
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
    const style = getSpriteStyle(ORIGIN, 60, 84);
    expect(style.backgroundPosition).toBe('0px 0px');
  });

  it('scales the whole sheet to match the cell size', () => {
    const style = getSpriteStyle(SPRITE, 238, 333);
    expect(style.backgroundSize).toBe(`${13 * 238}px ${5 * 333}px`);
  });

  it('scales by the sprite\'s own size and the given sheet size, not a 238x333 card on a 13x5 sheet (#864)', () => {
    const sprite = { sprite: '/tiles.png', x: 100, y: 140, width: 100, height: 140, sheetWidth: 1000, sheetHeight: 700 };
    const style = getSpriteStyle(sprite, 100, 140);
    expect(style.backgroundPosition).toBe('-100px -140px');
    expect(style.backgroundSize).toBe('1000px 700px');
    expect(getSpriteStyle(sprite, 50, 70)).toMatchObject({
      backgroundPosition: '-50px -70px', backgroundSize: '500px 350px',
    });
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
