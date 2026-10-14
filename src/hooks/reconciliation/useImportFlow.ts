'use client';

import { useCallback, useState } from 'react';
import type { ParsedOFXItem } from '@/components/conciliacao/OFXDropzone';
import type { DuplicateImportInfo } from '@/components/ui/DuplicateImportModal';
import type { DateRange } from '@/lib/data/repository';
import type { OFXParseResult } from '@/lib/ofx/types';
import type { ImportResult, MemoUpdate, PreImportCheck, UseReconciliationReturn } from '@/hooks/useReconciliation';

/** Extrato aguardando decisão do usuário (sobreposição parcial) ou bloqueado (duplicado). */
export interface PendingDuplicate {
  info: DuplicateImportInfo;
  result: OFXParseResult;
  fileName: string;
  memoUpdates: MemoUpdate[];
}

interface ImportFlowParams extends Pick<UseReconciliationReturn, 'checkImport' | 'importTransactions' | 'updateMemos'> {
  clientId: string | null;
  /** Nome exibido no aviso de extrato duplicado. */
  clientName: string;
  /** Período visível: depois de importar, a tela vai até o extrato se ele estiver fora dele. */
  range: DateRange | null;
  jumpTo: (date: string) => void;
  /** Chamado quando a lista de extratos mudou (recarrega painel de extratos e contas bancárias). */
  onStatementsChanged: () => void;
  notify: (message: string) => void;
}

/**
 * Fluxo de importação de extratos na tela de conciliação: checa duplicidade antes de gravar,
 * guarda o extrato que precisa de confirmação e o resumo da última importação.
 */
export function useImportFlow({
  clientId,
  clientName,
  range,
  jumpTo,
  checkImport,
  importTransactions,
  updateMemos,
  onStatementsChanged,
  notify,
}: ImportFlowParams) {
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [duplicate, setDuplicate] = useState<PendingDuplicate | null>(null);

  // O resumo da última importação é do cliente em que ela foi feita.
  const [lastClientId, setLastClientId] = useState(clientId);
  if (lastClientId !== clientId) {
    setLastClientId(clientId);
    setLastImport(null);
  }

  const duplicateOf = (result: OFXParseResult, fileName: string, check: PreImportCheck): PendingDuplicate => ({
    result,
    fileName,
    info: {
      kind: check.isFullDuplicate ? 'full' : 'partial',
      fileName,
      clientName,
      startDate: result.startDate,
      endDate: result.endDate,
      totalInFile: check.totalInFile,
      alreadyImportedCount: check.alreadyImportedCount,
      newCount: check.newTransactions.length,
      memoUpdateCount: check.memoUpdates.length,
    },
    memoUpdates: check.memoUpdates,
  });

  const importFile = (result: OFXParseResult, fileName: string) =>
    importTransactions(result.transactions, {
      fileName,
      account: result.account,
      startDate: result.startDate,
      endDate: result.endDate,
      ledgerBalance: result.ledgerBalance,
    });

  const isOutsideRange = (date: string | null): date is string => Boolean(date && range && (date < range.start || date > range.end));

  const runImport = async (result: OFXParseResult, fileName: string) => {
    const imported = await importFile(result, fileName);
    setLastImport(imported);
    onStatementsChanged();
    // Leva o período até o extrato recém-importado, se ele estiver fora da janela atual.
    if (isOutsideRange(imported.latestDate)) jumpTo(imported.latestDate);
  };

  /** Checa duplicidade antes de gravar: bloqueia o extrato repetido e confirma a sobreposição parcial. */
  const handleOFXParsed = async (result: OFXParseResult, fileName: string) => {
    try {
      const check = await checkImport(result.transactions);
      if (check.isFullDuplicate || check.isPartialOverlap) {
        setDuplicate(duplicateOf(result, fileName, check));
        return;
      }
      await runImport(result, fileName);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  /** Importação consolidada de múltiplos arquivos OFX */
  const handleOFXParsedBatch = async (items: ParsedOFXItem[]) => {
    if (items.length === 0) return;
    if (items.length === 1) {
      await handleOFXParsed(items[0].result, items[0].fileName);
      return;
    }

    let totalAdded = 0;
    let totalAutoClassified = 0;
    let totalDuplicates = 0;
    let lastDate: string | null = null;
    const duplicatesToConfirm: { item: ParsedOFXItem; check: PreImportCheck }[] = [];

    for (const item of items) {
      try {
        const check = await checkImport(item.result.transactions);
        if (check.isFullDuplicate || check.isPartialOverlap) {
          duplicatesToConfirm.push({ item, check });
        } else {
          const imported = await importFile(item.result, item.fileName);
          totalAdded += imported.added;
          totalAutoClassified += imported.autoClassified;
          totalDuplicates += imported.duplicates;
          if (imported.latestDate) lastDate = imported.latestDate;
        }
      } catch (e) {
        console.error(`Erro ao importar ${item.fileName}:`, e);
      }
    }

    onStatementsChanged();

    const importedFilesCount = items.length - duplicatesToConfirm.length;
    if (totalAdded > 0 || totalDuplicates > 0 || importedFilesCount > 0) {
      notify(
        `${importedFilesCount} extrato(s) importado(s) · ${totalAdded} novos lançamentos · ${totalAutoClassified} auto-classificados · ${totalDuplicates} duplicados ignorados`
      );
      if (isOutsideRange(lastDate)) jumpTo(lastDate);
    }

    if (duplicatesToConfirm.length > 0) {
      const first = duplicatesToConfirm[0];
      setDuplicate(duplicateOf(first.item.result, first.item.fileName, first.check));
    }
  };

  const closeDuplicate = useCallback(() => setDuplicate(null), []);

  const confirmUpdateMemos = async () => {
    if (!duplicate) return;
    try {
      const { updated, skipped } = await updateMemos(duplicate.memoUpdates, duplicate.fileName);
      notify(
        skipped > 0
          ? `${updated} descrição(ões) atualizada(s) · ${skipped} em competência fechada mantida(s)`
          : `${updated} descrição(ões) atualizada(s)`
      );
      setDuplicate(null);
    } catch {
      /* erro exposto pelo hook */
    }
  };

  const confirmImportNew = async () => {
    if (!duplicate) return;
    try {
      // A importação grava só os lançamentos inexistentes (a deduplicação é refeita no momento da gravação).
      await runImport(duplicate.result, duplicate.fileName);
    } catch {
      /* erro exposto pelo hook */
    } finally {
      setDuplicate(null);
    }
  };

  return {
    lastImport,
    dismissLastImport: () => setLastImport(null),
    duplicate,
    closeDuplicate,
    handleOFXParsed,
    handleOFXParsedBatch,
    confirmUpdateMemos,
    confirmImportNew,
  };
}
