/**
 * Reading and writing the two file formats a buyer already has a questionnaire
 * in: CSV and Excel.
 *
 * This is deliberately hand-rolled rather than pulled from a package. The job
 * is narrow — a grid of strings in, a grid of strings out — and the whole of
 * it is about forty lines of zip plumbing plus two small XML readers. A
 * general spreadsheet library would bring formulas, styles, dates, pivot
 * caches and a megabyte of parser for a file we also author ourselves.
 *
 * Two things it does on purpose:
 *
 * 1. **Everything is a string.** A weight of `10` and a weight typed as `10 `
 *    are the same input as far as the importer is concerned, and the importer
 *    is where meaning is assigned. A reader that guessed types would have to
 *    guess again for every column.
 * 2. **The workbook we write carries its own dropdowns.** A template that just
 *    names the twenty-six response types in a help sheet is a template people
 *    mistype into. Excel's list validation makes the column unmistakable, and
 *    it costs one more XML element.
 */

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Parse CSV into a grid, honouring quotes, embedded separators and embedded
 * newlines. A quoted field is the only place a comma or a line break can hide,
 * which is exactly why a split on `,` is not good enough for a file someone
 * exported from Excel with a question in it.
 */
export function parseCsv(text: string, separator = ','): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === separator) { row.push(cell); cell = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }

  row.push(cell);
  rows.push(row);

  // A file ending in a newline leaves one phantom row behind it.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/** Serialise a grid to CSV, quoting only the cells that need it. */
export function toCsv(rows: string[][], separator = ','): string {
  const needsQuote = (cell: string) =>
    cell.includes(separator) || cell.includes('"') || cell.includes('\n') || cell.includes('\r');
  return rows
    .map((row) =>
      row.map((cell) => (needsQuote(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(separator))
    .join('\r\n');
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

export interface Sheet {
  name: string;
  rows: string[][];
}

/**
 * A dropdown on one column of a sheet, fed from a column of another sheet.
 *
 * Expressed as a reference rather than an inline list because an inline list
 * in Excel is capped at 255 characters — twenty-six response type labels do
 * not fit, and the failure is silent: the dropdown simply does not appear.
 */
export interface SheetValidation {
  /** Zero-based column the dropdown applies to. */
  column: number;
  /** Zero-based first and last data rows it covers. */
  fromRow: number;
  toRow: number;
  list: { sheet: string; column: number; fromRow: number; toRow: number };
}

export interface SheetSpec extends Sheet {
  /** Character widths, by column. */
  widths?: number[];
  validations?: SheetValidation[];
  /** Keep the first row in view while scrolling. */
  freezeHeader?: boolean;
}

/** `0 → A`, `26 → AA`. */
export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not legal in XML 1.0 at all, and a questionnaire
    // pasted out of a PDF routinely carries a few. Dropping them beats writing
    // a workbook Excel refuses to open.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    const named: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    };
    return named[entity] ?? whole;
  });
}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

interface ZipEntry { name: string; data: Uint8Array }

/**
 * A zip with every entry stored uncompressed.
 *
 * Deflate would make the file smaller and would also make this function
 * asynchronous, because the only deflate available without a dependency is the
 * streaming one. A questionnaire template is a few kilobytes; the trade is not
 * close.
 */
function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0x21, true); // 1980-01-01, so the file is byte-identical every time
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const header = new Uint8Array(46 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 20, true);
    hv.setUint16(8, 0x0800, true);
    hv.setUint16(10, 0, true);
    hv.setUint16(12, 0, true);
    hv.setUint16(14, 0x21, true);
    hv.setUint32(16, crc, true);
    hv.setUint32(20, entry.data.length, true);
    hv.setUint32(24, entry.data.length, true);
    hv.setUint16(28, name.length, true);
    hv.setUint32(42, offset, true);
    header.set(name, 46);

    chunks.push(local, entry.data);
    central.push(header);
    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) { out.set(chunk, at); at += chunk.length; }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a zip into named byte ranges.
 *
 * Driven from the central directory rather than by walking local headers,
 * because a local header is allowed to say the sizes are in a trailing data
 * descriptor instead — which is what a streamed writer produces, and what a
 * forward walk cannot survive.
 */
async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xFFFF; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a workbook — no zip directory in it.');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    const localNameLength = view.getUint16(localAt + 26, true);
    const localExtraLength = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);

    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    // Anything else (bzip2, LZMA) is not something Excel writes; skipping it
    // leaves the part missing, which surfaces as a clear "no sheet" error
    // rather than as garbage cells.

    at += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

// ---------------------------------------------------------------------------
// XLSX — writing
// ---------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** `10` is a number to Excel; `10 days` is text. Only the first gets `<v>`. */
function isNumeric(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value)) && !/^\s|\s$/.test(value);
}

function cellXml(ref: string, value: string, header: boolean): string {
  if (value === '') return header ? `<c r="${ref}" s="1"/>` : '';
  const style = header ? ' s="1"' : '';
  if (!header && isNumeric(value)) return `<c r="${ref}"${style}><v>${value.trim()}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(spec: SheetSpec): string {
  const rows = spec.rows.map((cells, r) => {
    const body = cells
      .map((cell, c) => cellXml(`${columnName(c)}${r + 1}`, cell, r === 0))
      .join('');
    return `<row r="${r + 1}"${r === 0 ? ' ht="28" customHeight="1"' : ''}>${body}</row>`;
  }).join('');

  const cols = spec.widths
    ? `<cols>${spec.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const views = spec.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';

  const validations = (spec.validations ?? []).map((v) => {
    const target = `${columnName(v.column)}${v.fromRow + 1}:${columnName(v.column)}${v.toRow + 1}`;
    const list = `'${v.list.sheet}'!$${columnName(v.list.column)}$${v.list.fromRow + 1}:$${columnName(v.list.column)}$${v.list.toRow + 1}`;
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${target}"><formula1>${escapeXml(list)}</formula1></dataValidation>`;
  }).join('');

  return `${XML_HEAD}<worksheet xmlns="${MAIN_NS}">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${
    validations ? `<dataValidations count="${spec.validations?.length ?? 0}">${validations}</dataValidations>` : ''
  }</worksheet>`;
}

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">`
  + '<fonts count="2">'
  + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="3">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF4338CA"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/** Build an `.xlsx` from a list of sheets. */
export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const part = (name: string, xml: string): ZipEntry => ({ name, data: encoder.encode(xml) });

  const overrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + `${overrides}</Types>`;

  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>`
    + sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>';

  const workbookRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rIdStyles" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;

  return buildZip([
    part('[Content_Types].xml', contentTypes),
    part('_rels/.rels', rootRels),
    part('xl/workbook.xml', workbook),
    part('xl/_rels/workbook.xml.rels', workbookRels),
    part('xl/styles.xml', STYLES_XML),
    ...sheets.map((spec, i) => part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(spec))),
  ]);
}

// ---------------------------------------------------------------------------
// XLSX — reading
// ---------------------------------------------------------------------------

function sharedStringsFrom(xml: string): string[] {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    // One `<si>` can hold several runs; the string is all of them joined.
    [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((t) => unescapeXml(t[1]))
      .join(''));
}

/** `B12` → 1. A cell without a reference falls back to the running position. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1];
  if (!letters) return -1;
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function rowsFrom(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    let next = 0;

    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const at = ref ? columnIndex(ref) : next;
      const type = /t="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? 'n';

      let value = '';
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        value = shared[index] ?? '';
      } else if (type === 'inlineStr') {
        value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
          .map((t) => unescapeXml(t[1])).join('');
      } else {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }

      while (cells.length < at) cells.push('');
      cells[at] = value;
      next = at + 1;
    }

    rows.push(cells);
  }

  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/**
 * Read an `.xlsx` into sheets, in the order the workbook declares them.
 *
 * The order comes from `workbook.xml` and the file name from the relationship,
 * not from `sheet1.xml`/`sheet2.xml` — those are part names and a workbook
 * that has had a sheet deleted and another added no longer numbers them in
 * tab order.
 */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const files = await readZip(bytes);
  const decoder = new TextDecoder();
  const text = (name: string): string | null => {
    const data = files.get(name);
    return data ? decoder.decode(data) : null;
  };

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('That file is not an Excel workbook.');

  const rels = new Map<string, string>();
  for (const match of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(match[1])?.[1];
    const target = /Target="([^"]+)"/.exec(match[1])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const shared = sharedStringsFrom(text('xl/sharedStrings.xml') ?? '');
  const sheets: Sheet[] = [];

  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(match[1])?.[1] ?? `Sheet ${sheets.length + 1}`);
    const id = /r:id="([^"]+)"/.exec(match[1])?.[1] ?? '';
    const target = rels.get(id);
    const xml = target ? text(`xl/${target}`) : null;
    if (xml !== null) sheets.push({ name, rows: rowsFrom(xml, shared) });
  }

  if (sheets.length === 0) throw new Error('That workbook has no readable sheets in it.');
  return sheets;
}

/**
 * Read whichever of the two formats the file is, by extension.
 *
 * Sniffing the bytes would be more robust and less honest: a `.csv` that is
 * secretly a zip is a file someone renamed, and telling them so is more use
 * than silently coping.
 */
export async function readSpreadsheet(
  fileName: string, bytes: Uint8Array,
): Promise<Sheet[]> {
  if (/\.xlsx$/i.test(fileName)) return readXlsx(bytes);
  if (/\.csv$/i.test(fileName) || /\.txt$/i.test(fileName)) {
    const text = new TextDecoder().decode(bytes);
    // Excel on a European locale exports CSV with semicolons. Guessing from
    // the header line beats refusing a file that looks fine to its author.
    const firstLine = text.split('\n', 1)[0] ?? '';
    const separator = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
    return [{ name: 'Questions', rows: parseCsv(text, separator) }];
  }
  if (/\.xls$/i.test(fileName)) {
    throw new Error('That is the old .xls format. Open it in Excel and save as .xlsx, or export it as CSV.');
  }
  throw new Error(`${fileName} is neither .xlsx nor .csv.`);
}
