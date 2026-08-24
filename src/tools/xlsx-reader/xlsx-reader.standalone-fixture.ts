import { crc32Of } from './xlsx-reader.zip';

interface StoredEntry {
  name: Uint8Array
  content: Uint8Array
  crc32: number
  offset: number
}

const encoder = new TextEncoder();

function concatenate(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function header(length: number, write: (view: DataView) => void): Uint8Array {
  const output = new Uint8Array(length);
  write(new DataView(output.buffer));
  return output;
}

export function createStandaloneXlsxFixture(): Blob {
  const sourceEntries = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Audit" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>audit</t></is></c></row></sheetData></worksheet>'],
  ] as const;
  const localParts: Uint8Array[] = [];
  const entries: StoredEntry[] = [];
  let offset = 0;

  for (const [nameSource, contentSource] of sourceEntries) {
    const name = encoder.encode(nameSource);
    const content = encoder.encode(contentSource);
    const crc32 = crc32Of([content]);
    const local = header(30, (view) => {
      view.setUint32(0, 0x04034B50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint32(14, crc32, true);
      view.setUint32(18, content.byteLength, true);
      view.setUint32(22, content.byteLength, true);
      view.setUint16(26, name.byteLength, true);
    });
    localParts.push(local, name, content);
    entries.push({ name, content, crc32, offset });
    offset += local.byteLength + name.byteLength + content.byteLength;
  }

  const centralParts = entries.flatMap((entry) => {
    const central = header(46, (view) => {
      view.setUint32(0, 0x02014B50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint32(16, entry.crc32, true);
      view.setUint32(20, entry.content.byteLength, true);
      view.setUint32(24, entry.content.byteLength, true);
      view.setUint16(28, entry.name.byteLength, true);
      view.setUint32(42, entry.offset, true);
    });
    return [central, entry.name];
  });
  const central = concatenate(centralParts);
  const end = header(22, (view) => {
    view.setUint32(0, 0x06054B50, true);
    view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true);
    view.setUint32(12, central.byteLength, true);
    view.setUint32(16, offset, true);
  });
  return new Blob([concatenate([...localParts, central, end])], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
