import { describe, expect, it } from 'vitest';
import { parseCsv } from '../index.js';
import cardsText from './csv.fixture.csv?raw';

const source = 'data/cards.csv';
const cards = { name: 'string', cost: 'number', tags: 'list' } as const;

describe('parseCsv (#556)', () => {
  it('reads a ?raw import into typed rows', () => {
    const rows = parseCsv(cardsText, cards, { source });
    expect(rows).toEqual([
      { name: 'Goblin', cost: 2, tags: ['monster', 'green'] },
      { name: 'Troll, Big', cost: 5, tags: ['monster'] },
    ]);
    const first: { name: string; cost: number; tags: string[] } = rows[0];
    expect(first.name).toBe('Goblin');
  });

  it('reads quoted fields with doubled quotes, commas and newlines', () => {
    const text = 'name,text\n"Ogre","Says ""hi"", then\nleaves"\n';
    expect(parseCsv(text, { name: 'string', text: 'string' }, { source })).toEqual([
      { name: 'Ogre', text: 'Says "hi", then\nleaves' },
    ]);
  });

  it('reads CRLF line ends, a byte-order mark, and blank trailing lines', () => {
    const text = '﻿name,cost\r\nA,1\r\nB,2\r\n\r\n\n';
    expect(parseCsv(text, { name: 'string', cost: 'number' }, { source })).toEqual([
      { name: 'A', cost: 1 },
      { name: 'B', cost: 2 },
    ]);
  });

  it('reads an empty quoted field, and a trailing empty field', () => {
    expect(parseCsv('a,b\n"",\n', { a: 'string', b: 'string' }, { source })).toEqual([{ a: '', b: '' }]);
  });

  it('reads a file with no trailing newline, and one with only a header', () => {
    expect(parseCsv('name\nA', { name: 'string' }, { source })).toEqual([{ name: 'A' }]);
    expect(parseCsv('name\n', { name: 'string' }, { source })).toEqual([]);
  });

  it('reads numbers, booleans and lists', () => {
    const text = 'n,b,l\n-2.5,TRUE,a; b\n1e3,no,\n0,1,x\n';
    expect(parseCsv(text, { n: 'number', b: 'boolean', l: 'list' }, { source })).toEqual([
      { n: -2.5, b: true, l: ['a', 'b'] },
      { n: 1000, b: false, l: [] },
      { n: 0, b: true, l: ['x'] },
    ]);
  });

  it('reads the header in any column order', () => {
    expect(parseCsv('cost,name\n3,A\n', { name: 'string', cost: 'number' }, { source })).toEqual([{ name: 'A', cost: 3 }]);
  });
});

describe('parseCsv refuses bad data, naming the file, row and column (#556)', () => {
  const refuse = (text: string, columns: Record<string, 'string' | 'number' | 'boolean' | 'list'>) =>
    () => parseCsv(text, columns, { source });

  it('an empty file', () => {
    expect(refuse('', { name: 'string' })).toThrow(/data\/cards\.csv has no header row/);
  });

  it('a missing declared column', () => {
    expect(refuse('name\nA\n', { name: 'string', cost: 'number' })).toThrow(
      /data\/cards\.csv row 1: column "cost" is missing from the header/,
    );
  });

  it('an unknown extra column', () => {
    expect(refuse('name,cots\nA,1\n', { name: 'string' })).toThrow(/data\/cards\.csv row 1: column "cots" is not declared/);
  });

  it('a column named twice', () => {
    expect(refuse('name,name\nA,B\n', { name: 'string' })).toThrow(/data\/cards\.csv row 1: column "name" appears twice/);
  });

  it('a bad number', () => {
    expect(refuse('name,cost\nA,1\nB,three\n', { name: 'string', cost: 'number' })).toThrow(
      /data\/cards\.csv row 3, column "cost": "three" is not a number/,
    );
    expect(refuse('name,cost\nA,\n', { name: 'string', cost: 'number' })).toThrow(/row 2, column "cost": "" is not a number/);
  });

  it('a bad boolean', () => {
    expect(refuse('name,rare\nA,maybe\n', { name: 'string', rare: 'boolean' })).toThrow(
      /data\/cards\.csv row 2, column "rare": "maybe" is not a boolean.*true\/false, yes\/no or 1\/0/,
    );
  });

  it('an empty item in a list', () => {
    expect(refuse('name,tags\nA,x;;y\n', { name: 'string', tags: 'list' })).toThrow(
      /data\/cards\.csv row 2, column "tags": "x;;y" has an empty item/,
    );
  });

  it('an unterminated quote, at the row and column it opens', () => {
    expect(refuse('name,text\nA,ok\nB,"never\nclosed\n', { name: 'string', text: 'string' })).toThrow(
      /data\/cards\.csv row 3, column "text": the quote that opens this field is never closed/,
    );
    expect(refuse('name\n"ab""\n', { name: 'string' })).toThrow(/row 2, column "name": the quote that opens this field is never closed/);
  });

  it('a stray quote in an unquoted field, or text after a closing quote', () => {
    expect(refuse('name\nab"c\n', { name: 'string' })).toThrow(/data\/cards\.csv row 2, column "name": a quote inside/);
    expect(refuse('name\n"ab"c\n', { name: 'string' })).toThrow(/data\/cards\.csv row 2, column "name": text after the closing quote/);
  });

  it('a row with too few or too many fields', () => {
    expect(refuse('name,cost\nA,1\nB\n', { name: 'string', cost: 'number' })).toThrow(
      /data\/cards\.csv row 3, column "cost": the row ends before this column/,
    );
    expect(refuse('name,cost\nA,1,x\n', { name: 'string', cost: 'number' })).toThrow(
      /data\/cards\.csv row 2, column 3: the row has 3 fields but the header has 2/,
    );
  });

  it('a blank line between rows', () => {
    expect(refuse('name,cost\nA,1\n\nB,2\n', { name: 'string', cost: 'number' })).toThrow(/data\/cards\.csv row 3, column "cost"/);
  });
});
