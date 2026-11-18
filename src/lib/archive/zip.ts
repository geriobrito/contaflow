/**
 * Arquivo .zip montado e lido no navegador, sem dependências: o formato PKZIP com compressão
 * `deflate-raw` nativa (`CompressionStream`/`DecompressionStream`). Usado pelo backup da carteira
 * (um JSON por empresa num só arquivo) e pela restauração a partir dele.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LOC_SIGNATURE = 0x04034b50;
const CEN_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** Nomes em UTF-8 (bit 11 do campo de flags). */
const UTF8_FLAG = 0x0800;
const STORED = 0;
const DEFLATE = 8;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function pipe(data: Uint8Array, transform: GenericTransformStream, maxBytes = Infinity): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const reader = new Blob([copy]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('arquivo dentro do .zip grande demais');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Data e hora no formato do MS-DOS usado pelo .zip (horário local). */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const encoder = new TextEncoder();

/** Monta o .zip; com `compress` (padrão), cada arquivo vai comprimido, salvo quando não diminui. */
export async function createZip(entries: readonly ZipEntry[], { compress = true, date = new Date() }: { compress?: boolean; date?: Date } = {}): Promise<Blob> {
  const { time, date: day } = dosDateTime(date);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    let method = STORED;
    let body = entry.data;
    if (compress) {
      const deflated = await pipe(entry.data, new CompressionStream('deflate-raw'));
      if (deflated.byteLength < entry.data.byteLength) {
        method = DEFLATE;
        body = deflated;
      }
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOC_SIGNATURE, true);
    local.setUint16(4, 20, true); // versão necessária
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.byteLength, true);
    local.setUint32(22, entry.data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, CEN_SIGNATURE, true);
    cen.setUint16(4, 20, true); // feito por
    cen.setUint16(6, 20, true); // versão necessária
    cen.setUint16(8, UTF8_FLAG, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, day, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.byteLength, true);
    cen.setUint32(24, entry.data.byteLength, true);
    cen.setUint16(28, name.byteLength, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);

    offset += 30 + name.byteLength + body.byteLength;
  }

  const centralSize = central.reduce((s, p) => s + p.byteLength, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_SIGNATURE, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)].map((p) => p.slice()), { type: 'application/zip' });
}

export interface ReadZipLimits {
  maxEntries?: number;
  /** Tamanho máximo de cada arquivo descomprimido. */
  maxEntryBytes?: number;
  /** Tamanho máximo somado dos arquivos descomprimidos (proteção contra zip bomb). */
  maxTotalBytes?: number;
}

/** Lê os arquivos do .zip (pastas e metadados do macOS ficam de fora). Falha com o motivo. */
export async function readZip(buffer: ArrayBuffer, { maxEntries = 2000, maxEntryBytes = 200 * 1024 * 1024, maxTotalBytes = 500 * 1024 * 1024 }: ReadZipLimits = {}): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('arquivo .zip inválido ou corrompido');
  const count = view.getUint16(eocd + 10, true);
  if (count > maxEntries) throw new Error(`arquivo .zip com arquivos demais (${count})`);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== CEN_SIGNATURE) throw new Error('arquivo .zip inválido ou corrompido');
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) continue;
    if (size > maxEntryBytes) throw new Error(`${name} é grande demais`);
    total += size;
    if (total > maxTotalBytes) throw new Error('conteúdo do .zip grande demais');
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOC_SIGNATURE) throw new Error('arquivo .zip inválido ou corrompido');
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const body = bytes.subarray(start, start + compressedSize);
    let data: Uint8Array;
    if (method === STORED) data = body.slice();
    else if (method === DEFLATE) data = await pipe(body, new DecompressionStream('deflate-raw'), maxEntryBytes);
    else throw new Error(`${name}: compressão não suportada`);
    if (crc32(data) !== crc) throw new Error(`${name} está corrompido (CRC não confere)`);
    out.push({ name, data });
  }
  return out;
}
