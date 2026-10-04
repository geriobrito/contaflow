/**
 * Codificação de caracteres de arquivos OFX e reparo de texto "quebrado" (mojibake).
 *
 * Bancos como Nubank e PagBank gravam o OFX em UTF-8; bancos antigos usam Windows-1252
 * (Latin-1). Ler um arquivo UTF-8 como Latin-1 transforma "ê" em "Ãª" e "•" em "â€¢".
 */

/* =========================================================================
   Leitura do arquivo
   ========================================================================= */

export type OFXEncoding = 'utf-8' | 'windows-1252';

/**
 * Decodifica os bytes de um OFX. Tenta UTF-8 em modo estrito: um arquivo Latin-1 com
 * acentos praticamente nunca é UTF-8 válido, então a falha identifica o Latin-1 com
 * segurança, e um arquivo UTF-8 nunca é lido como Latin-1. Arquivos só com ASCII
 * servem para os dois. O BOM, se houver, é removido.
 */
export function decodeOFXBytes(bytes: Uint8Array): { text: string; encoding: OFXEncoding } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: 'utf-8' };
  } catch {
    // Windows-1252 é o Latin-1 dos bancos brasileiros (inclui €, •, – e aspas curvas).
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/* =========================================================================
   Reparo de mojibake
   ========================================================================= */

/** Caracteres de Windows-1252 nos bytes 0x80–0x9F (o resto de 0x80–0xFF coincide com Latin-1). */
const CP1252_HIGH: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Byte que o caractere teria numa leitura em Windows-1252, ou null. */
function cp1252Byte(ch: string): number | null {
  const code = ch.charCodeAt(0);
  if (code <= 0xff) return code;
  return CP1252_HIGH[ch] ?? null;
}

const CONT = `[\\u0080-\\u00BF${Object.keys(CP1252_HIGH).join('')}]`;
/** Início de uma sequência UTF-8 lida como Latin-1: byte líder + os bytes de continuação. */
const SEQUENCE = new RegExp(`[\\u00C2-\\u00DF]${CONT}|[\\u00E0-\\u00EF]${CONT}{2}|[\\u00F0-\\u00F4]${CONT}{3}`, 'g');

const LOWERED = new RegExp(`[ãâ]${CONT}`, 'g');

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** Decodifica os caracteres como bytes Windows-1252 → UTF-8; null se não formarem UTF-8 válido. */
function redecode(chars: string): string | null {
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) {
    const b = cp1252Byte(chars[i]);
    if (b === null) return null;
    bytes[i] = b;
  }
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

function repairOnce(text: string, lowercased: boolean): string {
  let out = text.replace(SEQUENCE, (seq) => redecode(seq) ?? seq);
  if (lowercased) {
    // Texto em minúsculas: "Ã" (C3) e "Â" (C2) viraram "ã" e "â" — líder em maiúscula + 1 continuação.
    out = out.replace(LOWERED, (seq) => redecode(seq[0].toUpperCase() + seq.slice(1)) ?? seq);
  }
  return out;
}

/**
 * Desfaz o mojibake de UTF-8 lido como Latin-1/Windows-1252 ("transferÃªncia" →
 * "transferência", "â€¢â€¢â€¢" → "•••"). Só substitui sequências que formam UTF-8 válido
 * ao serem relidas, então texto correto como "AÇÃO" ou "São" nunca é alterado.
 *
 * `lowercased`: o texto passou por `toLowerCase` (padrões de regras), o que transformou
 * "Ã" em "ã" e "Â" em "â"; esses líderes são tentados também em maiúscula.
 */
export function repairMojibake(text: string, options: { lowercased?: boolean } = {}): string {
  if (!text || !/[Â-ô]/.test(text)) return text;
  let current = text;
  // Duas passadas cobrem texto convertido duas vezes.
  for (let pass = 0; pass < 2; pass++) {
    const next = repairOnce(current, Boolean(options.lowercased));
    if (next === current) break;
    current = next;
  }
  return current;
}

/** O texto contém mojibake reparável? */
export const hasMojibake = (text: string, options: { lowercased?: boolean } = {}): boolean =>
  repairMojibake(text, options) !== text;
