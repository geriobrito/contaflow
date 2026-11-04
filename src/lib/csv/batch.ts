import type { BankAccount, BankAccountKind, ChartAccount, CSVColumnMapping, CSVDelimiter } from '@/types/firestore';
import type { OFXAccountInfo, OFXParseResult } from '@/lib/ofx/types';
import { parseCSVToOFXResult, previewCSV } from '@/lib/csv/parser';
import { headersMatchSignature, isMappingCompatible, normalizeHeaderSignature } from '@/lib/csv/presets';
import { bankAccountId, newManualAccountKey } from '@/lib/bank-accounts';

/**
 * Importação de CSV em fila: a simulação do arquivo atual, o formato memorizado na conta, a
 * conta ou cartão criado na hora e a aplicação do mesmo formato aos próximos arquivos.
 */

export interface CSVQueueFile {
  fileName: string;
  content: string;
}

export interface ParsedCSVBatchItem {
  result: OFXParseResult;
  fileName: string;
}

export interface CSVFormat {
  mapping: CSVColumnMapping;
  delimiter: CSVDelimiter;
}

export interface CSVSimulation {
  count: number;
  hasErrors: boolean;
  warnings: string[];
  res: OFXParseResult | null;
}

/** Resultado do arquivo com o formato escolhido; erro de leitura vira aviso, sem lançamentos. */
export function simulateCSVImport(content: string, format: CSVFormat, clientId: string, accountKey: string): CSVSimulation {
  try {
    const res = parseCSVToOFXResult({ content, mapping: format.mapping, clientId, accountKey, delimiter: format.delimiter });
    return { count: res.transactions.length, hasErrors: res.hasErrors, warnings: res.warnings, res };
  } catch (err) {
    return { count: 0, hasErrors: true, warnings: [err instanceof Error ? err.message : 'Falha ao interpretar mapeamento.'], res: null };
  }
}

/** Opções dos seletores de coluna: "[Col 1] Data". */
export const csvColumnOptions = (headers: readonly string[]) =>
  headers.map((h, i) => ({ index: i, label: `[Col ${i + 1}] ${h || `Coluna ${i + 1}`}` }));

/** A conta com o formato memorizado para as próximas importações (e a assinatura do cabeçalho). */
export function withCSVPreset(bank: BankAccount, format: CSVFormat, headers: readonly string[], now: string): BankAccount {
  return {
    ...bank,
    csvPreset: {
      delimiter: format.delimiter,
      mapping: format.mapping,
      ...(headers.length > 0 ? { headerSignature: normalizeHeaderSignature(headers) } : {}),
    },
    updatedAt: now,
  };
}

/** Conta ou cartão criado na tela de importação, sem extrato OFX anterior. */
export function quickBankAccount(params: {
  clientId: string;
  nickname: string;
  kind: BankAccountKind;
  ledger?: Pick<ChartAccount, 'id' | 'code' | 'name'>;
  existingKeys: ReadonlySet<string>;
  now: string;
}): BankAccount {
  const { clientId, nickname, kind, ledger, existingKeys, now } = params;
  const accountKey = newManualAccountKey(nickname, kind, existingKeys);
  return {
    id: bankAccountId(clientId, accountKey),
    clientId,
    accountKey,
    kind,
    nickname,
    ...(ledger ? { ledgerAccountId: ledger.id, ledgerAccountCode: ledger.code, ledgerAccountName: ledger.name } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Aplica o formato do arquivo atual aos próximos da fila, a partir de `from`, enquanto o layout
 * for o mesmo (colunas compatíveis e, com cabeçalho, a mesma assinatura ou o mesmo número de
 * colunas) e o arquivo render lançamentos. `stopAt` é o primeiro arquivo diferente (ou null).
 */
export function applyFormatToQueue(params: {
  queue: readonly CSVQueueFile[];
  from: number;
  format: CSVFormat;
  /** Cabeçalho do arquivo em que o formato foi confirmado. */
  headers: readonly string[];
  clientId: string;
  accountKey: string;
  accountInfo: OFXAccountInfo;
}): { items: ParsedCSVBatchItem[]; stopAt: number | null } {
  const { queue, from, format, headers, clientId, accountKey, accountInfo } = params;
  const signature = normalizeHeaderSignature(headers);
  const items: ParsedCSVBatchItem[] = [];
  for (let i = from; i < queue.length; i++) {
    const file = queue[i];
    const next = previewCSV(file.content, format.delimiter).headers;
    const sameLayout = !format.mapping.hasHeader || headersMatchSignature(next, signature) || next.length === headers.length;
    if (!isMappingCompatible(format.mapping, next.length) || !sameLayout) return { items, stopAt: i };
    const parsed = parseCSVToOFXResult({
      content: file.content,
      mapping: format.mapping,
      clientId,
      accountKey,
      bankAccountInfo: accountInfo,
      delimiter: format.delimiter,
    });
    if (parsed.transactions.length === 0) return { items, stopAt: i };
    items.push({ fileName: file.fileName, result: { ...parsed, account: accountInfo } });
  }
  return { items, stopAt: null };
}
