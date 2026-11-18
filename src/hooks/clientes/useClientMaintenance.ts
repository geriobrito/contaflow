'use client';

import { useState } from 'react';
import type { ClientCompany } from '@/types/firestore';
import type { Actor } from '@/lib/audit';
import type { NormalizedClientBackup, RestoreMode } from '@/lib/export/client-restore';
import { reportError } from '@/lib/monitoring';

/** Resultado de uma operação: se deu certo, o aviso e se a auditoria atingiu o teto. */
export interface MaintenanceResult {
  ok: boolean;
  message: string;
  auditTruncated?: boolean;
}

/** Resultado detalhado da restauração de um backup JSON. */
export interface RestoreMaintenanceResult {
  ok: boolean;
  client?: ClientCompany;
  message: string;
  warnings?: string[];
  stage?: string;
  partialClientId?: string;
}

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro');
const labelOf = (client: ClientCompany) => client.tradeName || client.name;

/**
 * Backup (JSON com todos os dados da empresa), restauração e exclusão de empresas na tela de Clientes.
 * Guarda qual empresa está em cada operação, para o cartão dela mostrar o andamento.
 */
export function useClientMaintenance(
  removeClient: (clientId: string) => Promise<void>,
  /** Backup baixado: as empresas e a data, para o cadastro em memória acompanhar. */
  onBackedUp?: (clientIds: readonly string[], at: string) => void
) {
  const [backingUpId, setBackingUpId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  /** Registra a data do backup baixado; devolve se gravou em todas (o arquivo já foi entregue de qualquer modo). */
  const markBackups = async (clientIds: readonly string[], at: string): Promise<boolean> => {
    const { markClientBackup } = await import('@/lib/services/data-service');
    const results = await Promise.allSettled(clientIds.map((id) => markClientBackup(id, at)));
    const ok = clientIds.filter((_, i) => results[i].status === 'fulfilled');
    if (ok.length) onBackedUp?.(ok, at);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) reportError(failed.reason, { area: 'clientes', op: 'registrar backup', level: 'warning' });
    return ok.length === clientIds.length;
  };

  /**
   * Backup da carteira: um .zip com o backup de cada empresa, gerado uma por vez. A data do
   * backup só é registrada nas empresas que entraram no arquivo.
   */
  const exportPortfolioBackup = async (
    clients: readonly ClientCompany[],
    onProgress?: (done: number, total: number, current: ClientCompany) => void
  ): Promise<MaintenanceResult & { failed: { name: string; reason: string }[]; done: number }> => {
    try {
      const [{ buildPortfolioBackup }, { downloadBlob }] = await Promise.all([
        import('@/lib/services/portfolio-backup-service'),
        import('@/lib/export/dre-rows'),
      ]);
      const result = await buildPortfolioBackup(clients, { onProgress });
      const failed = result.manifest.failed.map((f) => ({ name: f.name, reason: f.reason }));
      if (!result.done.length) {
        return { ok: false, message: 'Nenhuma empresa entrou no backup.', failed, done: 0 };
      }
      downloadBlob(result.blob, result.fileName);
      const marked = await markBackups(result.done, result.manifest.exportedAt);
      const partial = result.manifest.files.some((f) => f.auditTruncated) ? ' · auditoria parcial em alguma empresa' : '';
      return {
        ok: failed.length === 0,
        message: `Backup de ${result.done.length} empresa(s) baixado${failed.length ? ` · ${failed.length} falhou(aram)` : ''}${partial}${marked ? '' : ' · não foi possível registrar a data do backup em todas'}`,
        failed,
        done: result.done.length,
      };
    } catch (e) {
      reportError(e, { area: 'clientes', op: 'backup da carteira' });
      return { ok: false, message: `Não foi possível gerar o backup da carteira (${describe(e)}).`, failed: [], done: 0 };
    }
  };

  /** Lê todos os dados da empresa e baixa o arquivo. As bibliotecas só são carregadas aqui. */
  const exportBackup = async (client: ClientCompany): Promise<MaintenanceResult> => {
    const label = labelOf(client);
    setBackingUpId(client.id);
    try {
      const [{ buildClientBackup, backupBlob, backupFileName }, { downloadBlob }] = await Promise.all([
        import('@/lib/export/client-backup'),
        import('@/lib/export/dre-rows'),
      ]);
      const backup = await buildClientBackup(client);
      downloadBlob(backupBlob(backup), backupFileName(client, backup.exportedAt));
      const marked = await markBackups([client.id], backup.exportedAt);
      const partial = backup.auditTruncated ? ' · auditoria parcial (só os registros mais recentes)' : '';
      const unmarked = marked ? '' : ' · não foi possível registrar a data do backup';
      return {
        ok: true,
        message: `Backup de ${label} baixado · ${backup.transactions.length} lançamento(s)${partial}${unmarked}`,
        auditTruncated: backup.auditTruncated,
      };
    } catch (e) {
      reportError(e, { area: 'clientes', op: 'backup' });
      return { ok: false, message: `Não foi possível gerar o backup de ${label} (${describe(e)}).` };
    } finally {
      setBackingUpId(null);
    }
  };

  const restoreBackup = async (
    backup: NormalizedClientBackup,
    options: { mode: RestoreMode; targetName?: string; actor: Actor; onProgress?: (stage: string) => void }
  ): Promise<RestoreMaintenanceResult> => {
    setRestoring(true);
    try {
      const { ClientRestoreError, restoreClientBackup } = await import('@/lib/export/client-restore');
      try {
        const result = await restoreClientBackup(backup, options);
        return {
          ok: true,
          client: result.client,
          warnings: result.warnings,
          message: `${labelOf(result.client)} restaurado com sucesso`,
        };
      } catch (e) {
        reportError(e, { area: 'clientes', op: 'restaurar backup' });
        if (e instanceof ClientRestoreError) {
          return {
            ok: false,
            message: e.message,
            stage: e.stage,
            partialClientId: e.partialClientId,
          };
        }
        return { ok: false, message: `Não foi possível concluir a restauração (${describe(e)}).` };
      }
    } finally {
      setRestoring(false);
    }
  };

  const deleteClient = async (client: ClientCompany): Promise<MaintenanceResult> => {
    setDeletingId(client.id);
    try {
      await removeClient(client.id);
      return { ok: true, message: `${labelOf(client)} excluído com seus lançamentos, regras e contas` };
    } catch (e) {
      reportError(e, { area: 'clientes', op: 'excluir' });
      return { ok: false, message: `Não foi possível concluir a exclusão (${describe(e)}). Retome pelo cartão da empresa.` };
    } finally {
      setDeletingId(null);
    }
  };

  return { backingUpId, deletingId, restoring, exportBackup, exportPortfolioBackup, restoreBackup, deleteClient };
}
