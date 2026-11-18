import type { ClientCompany } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { buildClientBackup } from '@/lib/export/client-backup';
import { parseClientBackup } from '@/lib/export/restore/parse';
import { createZip, type ZipEntry } from '@/lib/archive/zip';
import { MANIFEST_FILE, estimateBackupReads, portfolioBackupFileName, uniqueBackupFileName, type PortfolioManifest } from '@/lib/portfolio-backup';

/** Leituras estimadas do backup de cada empresa (uma contagem barata por empresa). */
export async function estimatePortfolioReads(clients: readonly ClientCompany[], repo: DataRepository = getRepository()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const c of clients) {
    const transactions = await repo.countTransactions(c.id, '9999-12-31');
    out.set(c.id, estimateBackupReads(transactions));
  }
  return out;
}

export interface PortfolioBackupResult {
  blob: Blob;
  fileName: string;
  manifest: PortfolioManifest;
  /** Empresas que entraram no arquivo. */
  done: string[];
}

const encoder = new TextEncoder();

/**
 * Monta o .zip com o backup de cada empresa, uma por vez. Cada JSON é conferido pelo leitor da
 * restauração antes de entrar: um backup que não se restaura não é entregue. A falha de uma
 * empresa não interrompe as demais; ela fica no manifesto, com o motivo.
 */
export async function buildPortfolioBackup(
  clients: readonly ClientCompany[],
  {
    repo = getRepository(),
    exportedAt = new Date().toISOString(),
    onProgress,
  }: { repo?: DataRepository; exportedAt?: string; onProgress?: (done: number, total: number, current: ClientCompany) => void } = {}
): Promise<PortfolioBackupResult> {
  const manifest: PortfolioManifest = { format: 'contaflow-portfolio-backup', version: 1, exportedAt, files: [], failed: [] };
  const entries: ZipEntry[] = [];
  const taken = new Set<string>([MANIFEST_FILE]);
  const done: string[] = [];

  for (const [i, client] of clients.entries()) {
    onProgress?.(i, clients.length, client);
    try {
      const backup = await buildClientBackup(client, repo, exportedAt);
      const json = JSON.stringify(backup, null, 2);
      const check = parseClientBackup(json);
      if (check.transactions.length !== backup.transactions.length || check.client.id !== client.id) {
        throw new Error('o arquivo gerado não confere com os dados lidos');
      }
      const file = uniqueBackupFileName(client, exportedAt, taken);
      entries.push({ name: file, data: encoder.encode(json) });
      manifest.files.push({
        file,
        clientId: client.id,
        name: client.tradeName || client.name,
        cnpj: client.cnpj,
        transactions: backup.transactions.length,
        journalEntries: backup.journalEntries.length,
        invoices: backup.invoices.length,
        auditTruncated: backup.auditTruncated,
      });
      done.push(client.id);
    } catch (e) {
      manifest.failed.push({ clientId: client.id, name: client.tradeName || client.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  onProgress?.(clients.length, clients.length, clients[clients.length - 1]);

  entries.unshift({ name: MANIFEST_FILE, data: encoder.encode(JSON.stringify(manifest, null, 2)) });
  const blob = await createZip(entries, { date: new Date(exportedAt) });
  return { blob, fileName: portfolioBackupFileName(exportedAt), manifest, done };
}
