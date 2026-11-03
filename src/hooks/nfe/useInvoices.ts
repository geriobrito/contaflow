'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClientCompany, InvoiceSummary } from '@/types/firestore';
import type { DateRange } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { planInvoiceImport, type InvoiceFile } from '@/lib/nfe/import';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

/** Tamanho máximo de um XML de NF-e aceito (os reais têm poucas dezenas de KB). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface InvoiceImportOutcome {
  imported: number;
  purchases: number;
  sales: number;
  /** Notas já importadas que os eventos marcaram como canceladas. */
  cancelled: number;
  /** Eventos de cancelamento de notas que ainda não foram importadas. */
  cancellationsWithoutInvoice: number;
  rejected: { file: string; reason: string }[];
  warnings: { file: string; message: string }[];
  /** Emissão mais recente entre as notas importadas (para levar a lista até ela). */
  latestIssueDate: string | null;
}

/** Lê os arquivos no navegador; o conteúdo nunca sai daqui. */
async function readFiles(files: readonly File[]): Promise<{ read: InvoiceFile[]; rejected: InvoiceImportOutcome['rejected'] }> {
  const read: InvoiceFile[] = [];
  const rejected: InvoiceImportOutcome['rejected'] = [];
  for (const file of files) {
    if (!/\.xml$/i.test(file.name)) {
      rejected.push({ file: file.name, reason: /\.zip$/i.test(file.name) ? 'Arquivo compactado: extraia os XML do .zip e importe-os.' : 'Não é um arquivo .xml.' });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ file: file.name, reason: 'Arquivo grande demais para ser um XML de NF-e.' });
      continue;
    }
    read.push({ name: file.name, text: await file.text() });
  }
  return { read, rejected };
}

/**
 * Notas fiscais importadas de uma empresa no período (pela data de emissão), a importação de
 * XML (lidos no navegador, gravando só o resumo) e a exclusão.
 */
export function useInvoices(client: ClientCompany | null, range: DateRange | null) {
  const clientId = client?.id;
  const key = clientId && range ? `${clientId}|${range.start}|${range.end}` : null;
  const [data, setData] = useState<{ key: string; invoices: InvoiceSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!key || !clientId || !range) return;
    let active = true;
    getRepository()
      .listInvoices(clientId, range)
      .then((invoices) => {
        if (!active) return;
        setData({ key, invoices });
        setError(null);
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'nfe', op: 'carregar' });
        if (active) setError(`Não foi possível carregar as notas (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
    // `range` muda junto com `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, clientId, reloadCount]);

  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  const importFiles = async (files: readonly File[]): Promise<InvoiceImportOutcome | null> => {
    if (!client) return null;
    setBusy(true);
    setError(null);
    try {
      const { read, rejected } = await readFiles(files);
      const plan = planInvoiceImport(read, client, new Date().toISOString());
      const repo = getRepository();
      if (plan.invoices.length) await repo.saveInvoices(plan.invoices);
      // Cancelamentos de notas que não vieram neste lote: valem para as já gravadas.
      const inBatch = new Set(plan.invoices.map((i) => i.key));
      const pending = plan.cancellations.filter((k) => !inBatch.has(k));
      const cancelledStored = pending.length ? await repo.cancelInvoices(client.id, pending) : 0;
      reload();
      return {
        imported: plan.invoices.length,
        purchases: plan.invoices.filter((i) => i.direction === 'PURCHASE').length,
        sales: plan.invoices.filter((i) => i.direction === 'SALE').length,
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
    try {
      await getRepository().deleteInvoice(invoice.id);
      reload();
      return true;
    } catch (e) {
      setError(`Não foi possível excluir a nota ${invoice.number} (${describeError(e)}).`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const current = data && data.key === key ? data.invoices : null;
  return { invoices: current, isLoading: Boolean(key) && !current && !error, error, busy, importFiles, remove };
}
