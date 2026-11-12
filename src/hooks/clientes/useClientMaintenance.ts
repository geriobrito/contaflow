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
export function useClientMaintenance(removeClient: (clientId: string) => Promise<void>) {
  const [backingUpId, setBackingUpId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

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
      const partial = backup.auditTruncated ? ' · auditoria parcial (só os registros mais recentes)' : '';
      return {
        ok: true,
        message: `Backup de ${label} baixado · ${backup.transactions.length} lançamento(s)${partial}`,
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

  return { backingUpId, deletingId, restoring, exportBackup, restoreBackup, deleteClient };
}
