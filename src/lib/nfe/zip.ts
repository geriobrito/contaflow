import type { InvoiceFile } from '@/lib/nfe/import';

/**
 * Leitura de arquivos .zip no próprio navegador (ou Node 22+), sem dependências externas e
 * sem enviar nada para fora: lê o diretório central do formato PKZIP e descomprime cada XML
 * com `DecompressionStream('deflate-raw')`.
 */

/** Limite de tamanho de um arquivo .zip aceito (50 MB). */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
/** Limite de tamanho de cada XML descomprimido (5 MB). */
export const MAX_XML_BYTES = 5 * 1024 * 1024;
/** Limite total descomprimido de um mesmo .zip (100 MB, proteção contra zip bomb). */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** Quantidade máxima de entradas lidas num mesmo .zip. */
const MAX_ZIP_ENTRIES = 1500;

const EOCD_SIGNATURE = 0x06054b50;
const CEN_SIGNATURE = 0x02014b50;
const LOC_SIGNATURE = 0x04034b50;

export interface ZipExtractionResult {
  files: InvoiceFile[];
  rejected: { file: string; reason: string }[];
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const win1252 = new TextDecoder('windows-1252');

function decodeBytes(bytes: Uint8Array): string {
  try {
    const text = utf8Strict.decode(bytes);
    return text;
  } catch {
    return win1252.decode(bytes);
  }
}

/** Localiza o registro End of Central Directory (EOCD) de trás para frente nos últimos 65 KB. */
function findEocdOffset(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 65_557);
  for (let i = view.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/** Descomprime um bloco `deflate-raw` impondo um teto estrito de bytes lidos. */
async function inflateRawBounded(compressed: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error('XML_TOO_LARGE');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Extrai os arquivos `.xml` de dentro de um `.zip`. Entradas de pastas e metadados do sistema
 * (`__MACOSX/`, `.DS_Store`) são ignoradas.
 */
export async function extractXmlFromZip(buffer: ArrayBuffer, zipFileName: string): Promise<ZipExtractionResult> {
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return { files: [], rejected: [{ file: zipFileName, reason: 'Arquivo .zip grande demais (limite de 50 MB).' }] };
  }
  if (buffer.byteLength < 22) {
    return { files: [], rejected: [{ file: zipFileName, reason: 'Arquivo .zip inválido ou corrompido.' }] };
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEocdOffset(view);
  if (eocdOffset < 0) {
    return { files: [], rejected: [{ file: zipFileName, reason: 'Arquivo .zip inválido ou corrompido.' }] };
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  if (totalEntries > MAX_ZIP_ENTRIES) {
    return {
      files: [],
      rejected: [{ file: zipFileName, reason: `Arquivo .zip com arquivos demais (${totalEntries}; limite de ${MAX_ZIP_ENTRIES}).` }],
    };
  }
  if (centralDirOffset + centralDirSize > buffer.byteLength) {
    return { files: [], rejected: [{ file: zipFileName, reason: 'Arquivo .zip incompleto ou truncado.' }] };
  }

  const files: InvoiceFile[] = [];
  const rejected: { file: string; reason: string }[] = [];
  let totalUncompressed = 0;
  let ptr = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > buffer.byteLength || view.getUint32(ptr, true) !== CEN_SIGNATURE) {
      return { files: [], rejected: [{ file: zipFileName, reason: 'Diretório do arquivo .zip corrompido.' }] };
    }

    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const nameStart = ptr + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buffer.byteLength) {
      return { files: [], rejected: [{ file: zipFileName, reason: 'Cabeçalho de arquivo no .zip corrompido.' }] };
    }

    const entryName = decodeBytes(bytes.subarray(nameStart, nameEnd));
    ptr = nameEnd + extraLen + commentLen;

    // Ignora diretórios e arquivos ocultos de sistema (macOS / Windows).
    if (
      entryName.endsWith('/') ||
      entryName.endsWith('\\') ||
      entryName.startsWith('__MACOSX/') ||
      /(^|[/\\])\.(DS_Store|_.+)/i.test(entryName)
    ) {
      continue;
    }

    const shortName = entryName.split(/[/\\]/).pop() || entryName;
    const label = `${zipFileName}/${shortName}`;

    if (!/\.xml$/i.test(shortName)) {
      continue;
    }

    // Bit 0 de flags: entrada criptografada com senha.
    if ((flags & 0x1) !== 0) {
      rejected.push({ file: label, reason: 'Arquivo dentro do .zip está protegido por senha.' });
      continue;
    }

    if (uncompressedSize > MAX_XML_BYTES) {
      rejected.push({ file: label, reason: 'Arquivo grande demais para ser um XML de NF-e.' });
      continue;
    }

    if (localHeaderOffset + 30 > buffer.byteLength || view.getUint32(localHeaderOffset, true) !== LOC_SIGNATURE) {
      rejected.push({ file: label, reason: 'Entrada corrompida dentro do .zip.' });
      continue;
    }

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.byteLength) {
      rejected.push({ file: label, reason: 'Dados truncados dentro do .zip.' });
      continue;
    }

    const compressedSlice = bytes.subarray(dataStart, dataEnd);
    try {
      let rawXml: Uint8Array;
      if (method === 0) {
        rawXml = compressedSlice;
      } else if (method === 8) {
        const remainingAllowance = Math.min(MAX_XML_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES - totalUncompressed);
        if (remainingAllowance <= 0) {
          rejected.push({ file: label, reason: 'Limite de leitura do .zip atingido.' });
          continue;
        }
        rawXml = await inflateRawBounded(compressedSlice, remainingAllowance);
      } else {
        rejected.push({ file: label, reason: `Método de compressão (${method}) não suportado.` });
        continue;
      }

      totalUncompressed += rawXml.byteLength;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        rejected.push({ file: label, reason: 'Limite de leitura do .zip atingido.' });
        continue;
      }

      files.push({ name: label, text: decodeBytes(rawXml) });
    } catch (err) {
      const reason =
        err instanceof Error && err.message === 'XML_TOO_LARGE'
          ? 'Arquivo grande demais para ser um XML de NF-e.'
          : 'Não foi possível descomprimir o XML do .zip.';
      rejected.push({ file: label, reason });
    }
  }

  if (files.length === 0 && rejected.length === 0) {
    rejected.push({ file: zipFileName, reason: 'Nenhum arquivo .xml encontrado dentro do .zip.' });
  }

  return { files, rejected };
}
