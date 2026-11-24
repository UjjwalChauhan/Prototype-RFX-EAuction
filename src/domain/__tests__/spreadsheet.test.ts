/**
 * The two file formats, and the ways real files differ from tidy ones.
 *
 * Every case here is something an actual questionnaire sheet does: a question
 * with a comma in it, a European export separated by semicolons, a workbook
 * whose parts are deflated rather than stored, a row with a gap in the middle
 * where someone deleted a column's worth of cells.
 */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildXlsx, columnName, parseCsv, readSpreadsheet, readXlsx, toCsv,
} from '../spreadsheet';

describe('CSV', () => {
  it('keeps a comma that is inside a quoted question', () => {
    const rows = parseCsv('ID,Question\nQ.1,"Describe your process, end to end"');
    expect(rows[1]).toEqual(['Q.1', 'Describe your process, end to end']);
  });

  it('keeps a line break that is inside a quoted cell', () => {
    const rows = parseCsv('ID,Question\nQ.1,"One line\nAnd another"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('One line\nAnd another');
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('A\n"He said ""yes"""')[1][0]).toBe('He said "yes"');
  });

  it('drops the byte order mark Excel puts on the front', () => {
    expect(parseCsv('﻿Section,ID')[0][0]).toBe('Section');
  });

  it('drops the phantom row a trailing newline leaves behind', () => {
    expect(parseCsv('A,B\n1,2\n')).toHaveLength(2);
  });

  it('round trips the cells that need quoting', () => {
    const rows = [['Question', 'Choices'], ['Why, exactly?', 'Yes = 10 | No = 0']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('reads a semicolon-separated export, because that is what Excel writes in Europe', async () => {
    const sheets = await readSpreadsheet('q.csv', new TextEncoder().encode('ID;Question\nQ.1;Ask'));
    expect(sheets[0].rows[1]).toEqual(['Q.1', 'Ask']);
  });

  it('refuses a format it cannot read, by name', async () => {
    await expect(readSpreadsheet('q.pdf', new Uint8Array())).rejects.toThrow(/neither .xlsx nor .csv/);
  });

  it('says what to do about the old .xls format rather than just failing', async () => {
    await expect(readSpreadsheet('q.xls', new Uint8Array())).rejects.toThrow(/save as .xlsx/);
  });
});

describe('column names', () => {
  it('counts past Z the way a spreadsheet does', () => {
    expect([0, 25, 26, 27, 51, 52].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('XLSX', () => {
  const sheets = [
    {
      name: 'Questions',
      rows: [['ID', 'Question', 'Weight'], ['Q.1', 'Describe "the" process & why', '15']],
      widths: [10, 40, 8],
      freezeHeader: true,
      validations: [{
        column: 1, fromRow: 1, toRow: 9,
        list: { sheet: 'Lists', column: 0, fromRow: 1, toRow: 3 },
      }],
    },
    { name: 'Lists', rows: [['Type'], ['Short text'], ['Long text'], ['Number']] },
  ];

  it('reads back exactly what it wrote, entities and all', async () => {
    const back = await readXlsx(buildXlsx(sheets));
    expect(back.map((s) => s.name)).toEqual(['Questions', 'Lists']);
    expect(back[0].rows[1]).toEqual(['Q.1', 'Describe "the" process & why', '15']);
  });

  it('writes the same bytes twice, so a download is not a new file each time', () => {
    expect(buildXlsx(sheets)).toEqual(buildXlsx(sheets));
  });

  it('carries the dropdown into the file as a list validation', () => {
    const xml = new TextDecoder().decode(buildXlsx(sheets));
    expect(xml).toContain('<dataValidation type="list"');
    expect(xml).toContain("'Lists'!$A$2:$A$4");
  });

  it('is read through readSpreadsheet by extension', async () => {
    const back = await readSpreadsheet('filled-in.XLSX', buildXlsx(sheets));
    expect(back[0].rows[0]).toEqual(['ID', 'Question', 'Weight']);
  });

  it('rejects something that is not a zip at all', async () => {
    await expect(readXlsx(new TextEncoder().encode('just text'))).rejects.toThrow(/not a workbook/);
  });

  /**
   * Excel deflates its parts; we store ours. Reading a stored file therefore
   * proves nothing about reading a real one, so this builds a deflated
   * workbook the long way round and reads that.
   */
  it('reads a workbook whose parts are deflated, which is every real one', async () => {
    const parts: [string, string][] = [
      ['[Content_Types].xml', '<Types/>'],
      ['xl/workbook.xml', '<workbook><sheets><sheet name="Sheet One" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/sharedStrings.xml', '<sst><si><t>Shared cell</t></si><si><r><t>Two </t></r><r><t>runs</t></r></si></sst>'],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
        + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
        + '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="inlineStr"><is><t>inline &amp; fine</t></is></c></row>'
        + '</sheetData></worksheet>'],
    ];

    const back = await readXlsx(deflatedZip(parts));
    expect(back[0].name).toBe('Sheet One');
    // The gap at B1 is preserved, so column positions still line up with the
    // header even when a cell in the middle was never written.
    expect(back[0].rows[0]).toEqual(['Shared cell', '', 'Two runs']);
    expect(back[0].rows[1]).toEqual(['42', 'inline & fine']);
  });
});

// ---------------------------------------------------------------------------

/** A zip with every entry deflated — what every spreadsheet tool produces. */
function deflatedZip(parts: [string, string][]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  for (const [path, xml] of parts) {
    const name = encoder.encode(path);
    const raw = encoder.encode(xml);
    const packed = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const header = new Uint8Array(46 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(10, 8, true);
    hv.setUint32(16, crc, true);
    hv.setUint32(20, packed.length, true);
    hv.setUint32(24, raw.length, true);
    hv.setUint16(28, name.length, true);
    hv.setUint32(42, offset, true);
    header.set(name, 46);

    chunks.push(local, packed);
    central.push(header);
    offset += local.length + packed.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) { out.set(chunk, at); at += chunk.length; }
  return out;
}
