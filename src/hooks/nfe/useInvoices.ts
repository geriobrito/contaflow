'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankTransaction, ChartAccount, ClientCompany, InvoiceSummary, JournalEntry } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { planInvoiceImport, type InvoiceFile } from '@/lib/nfe/import';
import { extractXmlFromZip, MAX_XML_BYTES } from '@/lib/nfe/zip';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

export interface InvoiceImportOutcome {
  /** Notas novas gravadas neste lote. */
  imported: number;
  /** Notas do lote que já estavam importadas antes. */
  alreadyImported: number;
  purchases: number;
  sales: number;
  /** Notas já importadas que os eventos marcaram como canceladas. */
  cancelled: number;
  /** Eventos de cancelamento de notas que ainda não foram importadas. */
  cancellationsWithoutInvoice: number;
  rejected: { file: string; reason: string }[];
  warnings: { file: string; message: string }[];
  /** Emissão mais recente entre as notas do lote (para levar a lista até ela). */
  latestIssueDate: string | null;
}

/** Lê os arquivos (.xml e .zip) no navegador; o conteúdo nunca sai daqui. */
async function readFiles(files: readonly File[]): Promise<{ read: InvoiceFile[]; rejected: InvoiceImportOutcome['rejected'] }> {
  const read: InvoiceFile[] = [];
  const rejected: InvoiceImportOutcome['rejected'] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const extracted = await extractXmlFromZip(await file.arrayBuffer(), file.name);
      read.push(...extracted.files);
      rejected.push(...extracted.rejected);
      continue;
    }
    if (!/\.xml$/i.test(file.name)) {
      rejected.push({ file: file.name, reason: 'Não é um arquivo .xml ou .zip.' });
      continue;
    }
    if (file.size > MAX_XML_BYTES) {
      rejected.push({ file: file.name, reason: 'Arquivo grande demais para ser um XML de NF-e.' });
      continue;
    }
    read.push({ name: file.name, text: await file.text() });
  }
  return { read, rejected };
}

interface PeriodData {
  key: string;
  invoices: InvoiceSummary[];
  transactions: BankTransaction[];
  journalEntries: JournalEntry[];
}

/**
 * Notas fiscais importadas de uma empresa no período (pela data de emissão), os dados contábeis
 * do período para conferência (lançamentos e plano de contas), a importação de XML/.zip e a exclusão.
 */
export function useInvoices(client: ClientCompany | null, range: DateRange | null) {
  const clientId = client?.id;
  const start = range?.start;
  const end = range?.end;
  const key = clientId && start && end ? `${clientId}|${start}|${end}` : null;
  const [data, setData] = useState<PeriodData | null>(null);
  const [accountsState, setAccountsState] = useState<{ clientId: string; accounts: ChartAccount[] } | null>(null);
  const [extraTransactions, setExtraTransactions] = useState<Map<string, BankTransaction>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .listAccounts(clientId)
      .then((accounts) => {
        if (active) setAccountsState({ clientId, accounts });
      })
      .catch((e: unknown) => reportError(e, { area: 'nfe', op: 'carregar plano de contas', level: 'warning' }));
    return () => {
      active = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (!key || !clientId || !start || !end) return;
    let active = true;
    const repo = getRepository();
    const periodRange = { start, end };
    Promise.all([
      repo.listInvoices(clientId, periodRange),
      repo.listTransactions(clientId, periodRange).catch((e: unknown) => {
        reportError(e, { area: 'nfe', op: 'carregar lançamentos', level: 'warning' });
        return [] as BankTransaction[];
      }),
      repo.listJournalEntries(clientId, periodRange).catch((e: unknown) => {
        reportError(e, { area: 'nfe', op: 'carregar diário', level: 'warning' });
        return [] as JournalEntry[];
      }),
    ])
      .then(([invoices, transactions, journalEntries]) => {
        if (!active) return;
        setData({ key, invoices, transactions, journalEntries });
        setError(null);
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'nfe', op: 'carregar' });
        if (active) setError(`Não foi possível carregar as notas (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [key, clientId, start, end, reloadCount]);

  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  const importFiles = async (files: readonly File[]): Promise<InvoiceImportOutcome | null> => {
    if (!client) return null;
    setBusy(true);
    setError(null);
    try {
      const { read, rejected } = await readFiles(files);
      const plan = planInvoiceImport(read, client, new Date().toISOString());
      const repo = getRepository();
      const existingKeys = plan.invoices.length
        ? await repo.findExistingInvoiceKeys(
            client.id,
            plan.invoices.map((i) => i.key)
          )
        : new Set<string>();
      if (plan.invoices.length) await repo.saveInvoices(plan.invoices);
      // Cancelamentos de notas que não vieram neste lote: valem para as já gravadas.
      const inBatch = new Set(plan.invoices.map((i) => i.key));
      const pending = plan.cancellations.filter((k) => !inBatch.has(k));
      const cancelledStored = pending.length ? await repo.cancelInvoices(client.id, pending) : 0;
      const newInvoices = plan.invoices.filter((i) => !existingKeys.has(i.key));
      reload();
      return {
        imported: newInvoices.length,
        alreadyImported: plan.invoices.length - newInvoices.length,
        purchases: newInvoices.filter((i) => i.direction === 'PURCHASE').length,
        sales: newInvoices.filter((i) => i.direction === 'SALE').length,
        cancelled: cancelledStored + plan.invoices.filter((i) => i.status === 'CANCELLED').length,
        cancellationsWithoutInvoice: pending.length - cancelledStored,
        rejected: [...rejected, ...plan.rejected],
        warnings: plan.warnings,
        latestIssueDate: plan.invoices.reduce<string | null>((max, i) => (!max || i.issueDate > max ? i.issueDate : max), null),
      };
    } catch (e) {
      reportError(e, { area: 'nfe', op: 'importar' });
      setError(`Não foi possível gravar as notas (${describeError(e)}).`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (invoice: InvoiceSummary): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await getRepository().deleteInvoice(invoice.id);
      reload();
      return true;
    } catch (e) {
      reportError(e, { area: 'nfe', op: 'excluir' });
      setError(`Não foi possível excluir a nota ${invoice.number} (${describeError(e)}).`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const current = data && data.key === key ? data : null;
  const accounts = useMemo(
    () => (accountsState && accountsState.clientId === clientId ? accountsState.accounts : []),
    [accountsState, clientId]
  );

  const transactionsById = useMemo(() => {
    const map = new Map<string, BankTransaction>(extraTransactions);
    for (const tx of current?.transactions ?? []) map.set(tx.id, tx);
    return map;
  }, [current?.transactions, extraTransactions]);

  /** Busca sob demanda lançamentos vinculados em outros meses (quando a nota foi paga fora do período). */
  const ensureLinkedTransactions = useCallback(
    async (invoice: InvoiceSummary) => {
      const missingIds = (invoice.links ?? []).map((l) => l.transactionId).filter((id) => !transactionsById.has(id));
      if (!missingIds.length) return;
      const repo = getRepository();
      const loaded = await Promise.all(
        missingIds.map((id) =>
          repo.getTransaction(id).catch((e: unknown) => {
            reportError(e, { area: 'nfe', op: 'carregar lançamento vinculado', level: 'warning' });
            return null;
          })
        )
      );
      setExtraTransactions((prev) => {
        const next = new Map(prev);
        for (const tx of loaded) if (tx) next.set(tx.id, tx);
        return next;
      });
    },
    [transactionsById]
  );

  return {
    invoices: current?.invoices ?? null,
    transactions: current?.transactions ?? [],
    journalEntries: current?.journalEntries ?? [],
    accounts,
    transactionsById,
    ensureLinkedTransactions,
    isLoading: Boolean(key) && !current && !error,
    error,
    busy,
    importFiles,
    remove,
  };
}
