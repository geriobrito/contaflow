import type { BankAccount, BankAccountKind, CSVColumnMapping, CSVDelimiter } from '@/types/firestore';
import type { OFXAccountInfo } from '@/lib/ofx/types';
import { type CSVPreview, previewCSV } from '@/lib/csv/parser';
import { accountKeyOf } from '@/lib/statement';

export interface CSVBankPreset {
  id: string;
  label: string;
  kind: BankAccountKind;
  delimiter: CSVDelimiter;
  mapping: CSVColumnMapping;
  /** Cabeçalhos normalizados esperados quando o banco exporta formato padronizado. */
  headerSignature?: readonly string[];
}

export function normalizeHeaderCell(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeHeaderSignature(headers: readonly string[]): string[] {
  return headers.map(normalizeHeaderCell);
}

/** Presets embutidos para os formatos de CSV mais frequentes em bancos e cartões brasileiros. */
export const BUILTIN_CSV_PRESETS: readonly CSVBankPreset[] = [
  {
    id: 'nubank-card',
    label: 'Nubank — Fatura de Cartão (3 colunas)',
    kind: 'CARD',
    delimiter: ',',
    headerSignature: ['date', 'title', 'amount'],
    mapping: {
      dateCol: 0,
      memoCol: 1,
      valueMode: 'single',
      amountCol: 2,
      invertSigns: true,
      hasHeader: true,
    },
  },
  {
    id: 'nubank-card-cat',
    label: 'Nubank — Fatura de Cartão com Categoria',
    kind: 'CARD',
    delimiter: ',',
    headerSignature: ['date', 'category', 'title', 'amount'],
    mapping: {
      dateCol: 0,
      memoCol: 2,
      valueMode: 'single',
      amountCol: 3,
      invertSigns: true,
      hasHeader: true,
    },
  },
  {
    id: 'nubank-conta',
    label: 'Nubank — Extrato Conta PJ / PF',
    kind: 'BANK',
    delimiter: ',',
    headerSignature: ['data', 'valor', 'identificador', 'descricao'],
    mapping: {
      dateCol: 0,
      amountCol: 1,
      docCol: 2,
      memoCol: 3,
      valueMode: 'single',
      invertSigns: false,
      hasHeader: true,
    },
  },
  {
    id: 'inter-extrato',
    label: 'Banco Inter — Extrato Conta',
    kind: 'BANK',
    delimiter: ';',
    headerSignature: ['data lancamento', 'historico', 'descricao', 'valor', 'saldo'],
    mapping: {
      dateCol: 0,
      memoCol: 2,
      valueMode: 'single',
      amountCol: 3,
      invertSigns: false,
      hasHeader: true,
    },
  },
  {
    id: 'inter-cartao',
    label: 'Banco Inter — Fatura de Cartão',
    kind: 'CARD',
    delimiter: ';',
    headerSignature: ['data', 'lancamento', 'categoria', 'tipo', 'valor'],
    mapping: {
      dateCol: 0,
      memoCol: 1,
      valueMode: 'single',
      amountCol: 4,
      invertSigns: true,
      hasHeader: true,
    },
  },
  {
    id: 'itau-extrato',
    label: 'Itaú — Extrato CSV (Data; Lançamento; Valor)',
    kind: 'BANK',
    delimiter: ';',
    headerSignature: ['data', 'lancamento', 'valor'],
    mapping: {
      dateCol: 0,
      memoCol: 1,
      valueMode: 'single',
      amountCol: 2,
      invertSigns: false,
      hasHeader: true,
    },
  },
  {
    id: 'c6-cartao',
    label: 'C6 Bank — Fatura de Cartão',
    kind: 'CARD',
    delimiter: ';',
    headerSignature: [
      'data de compra',
      'nome no cartao',
      'final do cartao',
      'categoria',
      'descricao',
      'parcela',
      'valor (em us$)',
      'cotacao (em r$)',
      'valor (em r$)',
    ],
    mapping: {
      dateCol: 0,
      memoCol: 4,
      valueMode: 'single',
      amountCol: 8,
      invertSigns: true,
      hasHeader: true,
    },
  },
  {
    id: 'bradesco-extrato',
    label: 'Bradesco — Extrato (Crédito / Débito separados)',
    kind: 'BANK',
    delimiter: ';',
    headerSignature: ['data', 'historico', 'docto.', 'credito (r$)', 'debito (r$)', 'saldo (r$)'],
    mapping: {
      dateCol: 0,
      memoCol: 1,
      docCol: 2,
      valueMode: 'split',
      creditCol: 3,
      debitCol: 4,
      invertSigns: false,
      hasHeader: true,
    },
  },
];

/** Verifica se todos os índices de coluna configurados existem no CSV atual. */
export function isMappingCompatible(mapping: CSVColumnMapping, columnCount: number): boolean {
  if (columnCount <= 0) return false;
  const inBounds = (col: number | undefined) => col !== undefined && col >= 0 && col < columnCount;
  if (!inBounds(mapping.dateCol) || !inBounds(mapping.memoCol)) return false;
  if (mapping.docCol !== undefined && !inBounds(mapping.docCol)) return false;
  if (mapping.valueMode === 'single') {
    return inBounds(mapping.amountCol);
  }
  return inBounds(mapping.debitCol) && inBounds(mapping.creditCol);
}

/** Ajusta índices de um preset para não extrapolar o número de colunas do arquivo aberto. */
export function clampMappingToColumns(mapping: CSVColumnMapping, columnCount: number): CSVColumnMapping {
  if (columnCount <= 0) return mapping;
  const clamp = (idx: number | undefined, fallback: number) =>
    idx !== undefined && idx >= 0 && idx < columnCount ? idx : Math.min(fallback, columnCount - 1);

  return {
    ...mapping,
    dateCol: clamp(mapping.dateCol, 0),
    memoCol: clamp(mapping.memoCol, 1),
    amountCol: mapping.valueMode === 'single' ? clamp(mapping.amountCol, 2) : undefined,
    debitCol: mapping.valueMode === 'split' ? clamp(mapping.debitCol, 2) : undefined,
    creditCol: mapping.valueMode === 'split' ? clamp(mapping.creditCol, 3) : undefined,
    docCol: mapping.docCol !== undefined && mapping.docCol < columnCount ? mapping.docCol : undefined,
  };
}

/** Confere se o cabeçalho do CSV bate com a assinatura esperada. */
export function headersMatchSignature(headers: readonly string[], signature?: readonly string[]): boolean {
  if (!signature || signature.length === 0 || headers.length !== signature.length) return false;
  const normHeaders = normalizeHeaderSignature(headers);
  const normSig = normalizeHeaderSignature(signature);
  return normHeaders.every((h, idx) => h === normSig[idx]);
}

export interface ResolvedCSVConfig {
  delimiter: CSVDelimiter;
  mapping: CSVColumnMapping;
  source: 'saved' | 'preset' | 'auto';
  presetId?: string;
  presetLabel?: string;
  preview: CSVPreview;
}

/**
 * Determina a configuração inicial para um arquivo CSV:
 * 1. Usa o `csvPreset` memorizado na conta bancária/cartão, se compatível com as colunas do arquivo;
 * 2. Senão, verifica se o cabeçalho coincide com algum preset embutido de banco/cartão brasileiro;
 * 3. Caso contrário, usa a detecção automática por palavras-chave e amostra.
 */
export function resolveInitialCSVConfig(content: string, bankAccount?: BankAccount | null): ResolvedCSVConfig {
  if (bankAccount?.csvPreset) {
    const savedPreview = previewCSV(content, bankAccount.csvPreset.delimiter);
    if (isMappingCompatible(bankAccount.csvPreset.mapping, savedPreview.headers.length)) {
      return {
        delimiter: bankAccount.csvPreset.delimiter,
        mapping: bankAccount.csvPreset.mapping,
        source: 'saved',
        preview: savedPreview,
      };
    }
  }

  const autoPreview = previewCSV(content);
  for (const preset of BUILTIN_CSV_PRESETS) {
    const candidatePreview = preset.delimiter === autoPreview.delimiter ? autoPreview : previewCSV(content, preset.delimiter);
    if (
      headersMatchSignature(candidatePreview.headers, preset.headerSignature) &&
      isMappingCompatible(preset.mapping, candidatePreview.headers.length)
    ) {
      return {
        delimiter: preset.delimiter,
        mapping: preset.mapping,
        source: 'preset',
        presetId: preset.id,
        presetLabel: preset.label,
        preview: candidatePreview,
      };
    }
  }

  return {
    delimiter: autoPreview.delimiter,
    mapping: autoPreview.guessedMapping,
    source: 'auto',
    preview: autoPreview,
  };
}

/**
 * Monta `OFXAccountInfo` garantindo que `accountKeyOf(...)` produza exatamente
 * o `accountKey` da conta selecionada (seja conta vinda de OFX ou conta manual/cartão).
 */
export function toOFXAccountInfo(bankAccount: BankAccount | undefined, fallbackAccountKey: string): OFXAccountInfo {
  if (!bankAccount) {
    return { accountId: fallbackAccountKey, org: 'Extrato CSV' };
  }
  const org = bankAccount.nickname || bankAccount.bankName || 'Extrato CSV';
  if (bankAccount.accountNumber) {
    const candidate: OFXAccountInfo = {
      bankId: bankAccount.bankId,
      branchId: bankAccount.branchId,
      accountId: bankAccount.accountNumber,
      org,
    };
    if (accountKeyOf(candidate) === bankAccount.accountKey) {
      return candidate;
    }
  }
  return {
    accountId: bankAccount.accountKey,
    org,
  };
}

