'use client';

import { useState } from 'react';
import type { ClientCompany } from '@/types/firestore';
import { reportError } from '@/lib/monitoring';

/** Resultado de uma operação: se deu certo e o aviso a mostrar. */
export interface MaintenanceResult {
  ok: boolean;
  message: string;
}

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro');
const labelOf = (client: ClientCompany) => client.tradeName || client.name;

/**
 * Backup (JSON com todos os dados da empresa) e exclusão de empresas na tela de Clientes.
 * Guarda qual empresa está em cada operação, para o cartão dela mostrar o andamento.
 */
export function useClientMaintenance(removeClient: (clientId: string) => Promise<void>) {
  const [backingUpId, setBackingUpId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      return { ok: true, message: `Backup de ${label} baixado · ${backup.transactions.length} lançamento(s)${partial}` };
    } catch (e) {
      reportError(e, { area: 'clientes', op: 'backup' });
      return { ok: false, message: `Não foi possível gerar o backup de ${label} (${describe(e)}).` };
    } finally {
      setBackingUpId(null);
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

  return { backingUpId, deletingId, exportBackup, deleteClient };
}
