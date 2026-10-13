/**
 * Card data from a spreadsheet: `parseCsv` turns the text of a CSV file into
 * typed rows. Import the file with `?raw` so it is bundled with the rules:
 *
 *   import cardsCsv from './data/cards.csv?raw';
 *   const cards = parseCsv(cardsCsv, { name: 'string', cost: 'number' }, { source: 'data/cards.csv' });
 *
 * Row numbers in errors are spreadsheet rows: the header is row 1.
 */

/** How a column's text is read. A `list` cell is split on `;`, each item trimmed; an empty cell is `[]`. */
export type CsvColumnType = 'string' | 'number' | 'boolean' | 'list';

/** The value a column of type `T` holds. */
export type CsvValue<T extends CsvColumnType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'list'
      ? string[]
      : string;

/** One row, typed from the declared columns. */
export type CsvRow<C extends Record<string, CsvColumnType>> = { -readonly [K in keyof C]: CsvValue<C[K]> };

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const BOOLEANS: Record<string, boolean> = { true: true, false: false, yes: true, no: false, '1': true, '0': false };

interface CsvRecord {
  fields: string[];
  /** One unquoted field of only whitespace: a blank line. */
  blank: boolean;
}

/**
 * Parses `text` (RFC 4180: quoted fields, `""` for a quote, commas and newlines
 * inside quotes, CRLF or LF, an optional byte-order mark) into one object per
 * row, with exactly the declared `columns`. Every header must be declared and
 * every declared column present, in any order. Numbers are decimal (`3`,
 * `-2.5`, `1e3`); booleans are `true`/`false`, `yes`/`no` or `1`/`0`, in any
 * case; numbers and booleans may have spaces around them, strings are kept as
 * written. Blank lines at the end are ignored.
 *
 * Throws on the first problem, naming `source`, the row and the column; it
 * never returns part of a file.
 */
export function parseCsv<const C extends Record<string, CsvColumnType>>(
  text: string,
  columns: C,
  options: { source: string },
): CsvRow<C>[] {
  const { source } = options;
  const records = readRecords(text.startsWith('﻿') ? text.slice(1) : text, source);
  while (records.length > 1 && records[records.length - 1].blank) records.pop();
  if (records[0].blank) {
    throw new Error(`${source} has no header row. Its first line must name the columns: ${Object.keys(columns).join(', ')}.`);
  }

  const header = records[0].fields;
  const declared = Object.keys(columns);
  header.forEach((name, index) => {
    if (!(name in columns)) {
      throw new Error(
        `${source} row 1: column "${name}" is not declared. Declared columns: ${declared.join(', ')}. ` +
          'Fix the header, or add the column to the columns passed to parseCsv.',
      );
    }
    if (header.indexOf(name) !== index) throw new Error(`${source} row 1: column "${name}" appears twice. Remove one of them.`);
  });
  for (const name of declared) {
    if (!header.includes(name)) {
      throw new Error(`${source} row 1: column "${name}" is missing from the header. Add it, or remove it from the columns passed to parseCsv.`);
    }
  }

  return records.slice(1).map(({ fields }, index) => {
    const row = index + 2;
    if (fields.length > header.length) {
      throw new Error(
        `${source} row ${row}, column ${header.length + 1}: the row has ${fields.length} fields but the header has ${header.length}. ` +
          'Remove the extra comma, or put quotes around a value that contains a comma.',
      );
    }
    const values: Record<string, unknown> = {};
    header.forEach((name, column) => {
      const at = `${source} row ${row}, column "${name}"`;
      if (column >= fields.length) {
        throw new Error(`${at}: the row ends before this column (${fields.length} of ${header.length} fields). Add the missing values.`);
      }
      values[name] = readValue(fields[column], columns[name], at);
    });
    return values as CsvRow<C>;
  });
}

function readValue(cell: string, type: CsvColumnType, at: string): unknown {
  const trimmed = cell.trim();
  switch (type) {
    case 'string':
      return cell;
    case 'number':
      if (!NUMBER.test(trimmed)) throw new Error(`${at}: "${cell}" is not a number. Write a number such as 3 or -2.5.`);
      return Number(trimmed);
    case 'boolean': {
      const value = BOOLEANS[trimmed.toLowerCase()];
      if (value === undefined) throw new Error(`${at}: "${cell}" is not a boolean. Write true/false, yes/no or 1/0.`);
      return value;
    }
    case 'list': {
      if (trimmed === '') return [];
      const items = cell.split(';').map((item) => item.trim());
      if (items.includes('')) throw new Error(`${at}: "${cell}" has an empty item. List items are separated by ";"; remove the extra ";".`);
      return items;
    }
  }
}

/**
 * One field and what ends it: quoted (group 1 holds its inside) or unquoted
 * (group 2), then a comma, a line end or the end of the text (group 3). No
 * match means a malformed quote.
 */
const FIELD = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\r|\n|$)/y;
/** A closed quoted field. */
const QUOTED = /"(?:[^"]|"")*"(?!")/y;

/** Splits CSV text into records, refusing a malformed quote at the row and column it is in. */
function readRecords(text: string, source: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  for (let i = 0; ; ) {
    FIELD.lastIndex = i;
    const match = FIELD.exec(text);
    if (match === null) throw quoteError(text, i, source, records, fields);
    const [, inQuotes, plain, end] = match;
    i = FIELD.lastIndex;
    fields.push(inQuotes === undefined ? plain : inQuotes.replaceAll('""', '"'));
    if (end === ',') continue;
    records.push({ fields, blank: fields.length === 1 && plain?.trim() === '' });
    if (end === '') return records;
    fields = [];
  }
}

/** The error for the malformed field at `start`, naming its row and column. */
function quoteError(text: string, start: number, source: string, records: CsvRecord[], fields: string[]): Error {
  const name = records[0]?.fields[fields.length];
  const at = `${source} row ${records.length + 1}, column ${name === undefined ? fields.length + 1 : `"${name}"`}`;
  if (text[start] !== '"') {
    return new Error(`${at}: a quote inside an unquoted field. Put quotes around the whole field and write each quote in it as "".`);
  }
  QUOTED.lastIndex = start;
  if (QUOTED.test(text)) return new Error(`${at}: text after the closing quote. Put the whole value inside the quotes.`);
  return new Error(`${at}: the quote that opens this field is never closed. Add the closing quote.`);
}
