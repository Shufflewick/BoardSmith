import { describe, it, expect } from 'vitest';
import { resolvePresentation } from './presentation.js';
import type { PresentationOverlay } from './presentation.js';

describe('resolvePresentation', () => {
  describe('null/undefined overlay', () => {
    it('returns null when overlay is undefined', () => {
      const element = { name: 'MyCard', className: 'Card' };
      expect(resolvePresentation(element, undefined)).toBeNull();
    });

    it('returns null when overlay is empty and nothing matches', () => {
      const element = { name: 'MyCard', className: 'Card' };
      const overlay: PresentationOverlay = {};
      expect(resolvePresentation(element, overlay)).toBeNull();
    });
  });

  describe('byName precedence (highest)', () => {
    it('returns byName entry when element.name matches', () => {
      const overlay: PresentationOverlay = {
        byName: { MyCard: { image: '/img/mycard.png', label: 'My Card' } },
        byClass: { Card: { image: '/img/card.png', label: 'Generic Card' } },
      };
      const element = { name: 'MyCard', className: 'Card' };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      expect(result!.image).toBe('/img/mycard.png');
      expect(result!.label).toBe('My Card');
    });

    it('does NOT fall through to byClass fields when byName matches (no merging)', () => {
      const overlay: PresentationOverlay = {
        byName: { MyCard: { label: 'Name Match Only' } },
        byClass: { Card: { image: '/img/card.png', stats: { power: 5 } } },
      };
      const element = { name: 'MyCard', className: 'Card' };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      expect(result!.label).toBe('Name Match Only');
      // byClass fields must NOT be merged in
      expect(result!.image).toBeUndefined();
      expect(result!.stats).toBeUndefined();
    });
  });

  describe('byClass precedence (middle)', () => {
    it('returns byClass entry when className matches and no byName match', () => {
      const overlay: PresentationOverlay = {
        byName: { SomeOtherCard: { image: '/img/other.png' } },
        byClass: { Card: { image: '/img/card.png', label: 'Generic Card' } },
      };
      const element = { name: 'MyCard', className: 'Card' };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      expect(result!.image).toBe('/img/card.png');
      expect(result!.label).toBe('Generic Card');
    });

    it('returns byClass entry when element has no name', () => {
      const overlay: PresentationOverlay = {
        byClass: { Piece: { label: '' } },
      };
      const element = { className: 'Piece' };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      expect(result!.label).toBe('');
    });
  });

  describe('byAttribute precedence (lowest)', () => {
    it('returns byAttribute entry when attribute key/value matches', () => {
      const overlay: PresentationOverlay = {
        byAttribute: {
          suit: {
            hearts: { image: '/img/hearts.png', label: 'Hearts' },
          },
        },
      };
      const element = { className: 'Card', attributes: { suit: 'hearts' } };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      expect(result!.image).toBe('/img/hearts.png');
      expect(result!.label).toBe('Hearts');
    });

    it('returns first matching byAttribute entry (first-wins)', () => {
      const overlay: PresentationOverlay = {
        byAttribute: {
          suit: { hearts: { label: 'Hearts' } },
          rank: { king: { label: 'King' } },
        },
      };
      const element = { className: 'Card', attributes: { suit: 'hearts', rank: 'king' } };
      const result = resolvePresentation(element, overlay);
      // First attribute key wins — 'suit' comes before 'rank' in the object
      expect(result).not.toBeNull();
      expect(result!.label).toBe('Hearts');
    });

    it('returns null when attribute key is present but value does not match', () => {
      const overlay: PresentationOverlay = {
        byAttribute: {
          suit: { hearts: { label: 'Hearts' } },
        },
      };
      const element = { className: 'Card', attributes: { suit: 'spades' } };
      expect(resolvePresentation(element, overlay)).toBeNull();
    });
  });

  describe('PRESENT-02: __hidden guard', () => {
    it('strips image and stats when element.__hidden is true', () => {
      const overlay: PresentationOverlay = {
        byClass: {
          Card: {
            image: '/img/face.png',
            label: 'Card',
            stats: { power: 10, defense: 5 },
          },
        },
      };
      const element = { className: 'Card', __hidden: true };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      // label is allowed through
      expect(result!.label).toBe('Card');
      // image and stats MUST be stripped
      expect(result!.image).toBeUndefined();
      expect(result!.stats).toBeUndefined();
    });

    it('returns null when __hidden and no overlay match exists', () => {
      const overlay: PresentationOverlay = {
        byClass: { Piece: { label: 'A piece' } },
      };
      const element = { className: 'Card', __hidden: true };
      expect(resolvePresentation(element, overlay)).toBeNull();
    });

    it('allows render through for __hidden elements (author responsibility)', () => {
      const mockComponent = {} as import('vue').Component;
      const overlay: PresentationOverlay = {
        byClass: {
          Card: {
            image: '/img/face.png',
            render: mockComponent,
          },
        },
      };
      const element = { className: 'Card', __hidden: true };
      const result = resolvePresentation(element, overlay);
      expect(result).not.toBeNull();
      // image stripped, render allowed
      expect(result!.image).toBeUndefined();
      expect(result!.render).toBe(mockComponent);
    });
  });

  describe('null result when nothing matches', () => {
    it('returns null when byName, byClass, and byAttribute all miss', () => {
      const overlay: PresentationOverlay = {
        byName: { SomeCard: { label: 'Some' } },
        byClass: { Piece: { label: 'Piece' } },
        byAttribute: { color: { red: { label: 'Red' } } },
      };
      const element = { name: 'OtherCard', className: 'Token', attributes: { color: 'blue' } };
      expect(resolvePresentation(element, overlay)).toBeNull();
    });
  });
});
