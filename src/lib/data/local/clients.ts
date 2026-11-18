import type { AuditEntry, ClientCompany, LockState, OrgSettings, PeriodLock } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { isAdminSession } from '@/lib/data/scope';
import { initialLockState } from '@/lib/lock-guard';
import { periodAuditId } from '@/lib/periods';
import { LOCAL_KEYS, type LocalContext } from './store';

/** Listas apagadas em cascata com a empresa (a auditoria fica). */
const CASCADE = [
  LOCAL_KEYS.accounts,
  LOCAL_KEYS.rules,
  LOCAL_KEYS.transactions,
  LOCAL_KEYS.batches,
  LOCAL_KEYS.locks,
  LOCAL_KEYS.lockState,
  LOCAL_KEYS.bankAccounts,
  LOCAL_KEYS.openings,
  LOCAL_KEYS.requests,
  LOCAL_KEYS.journalEntries,
  LOCAL_KEYS.journalCounters,
  LOCAL_KEYS.snapshots,
  LOCAL_KEYS.resultSummaries,
  LOCAL_KEYS.notes,
  LOCAL_KEYS.invoices,
  LOCAL_KEYS.fixedAssets,
  LOCAL_KEYS.checklists,
  LOCAL_KEYS.prepaid,
  LOCAL_KEYS.financing,
  LOCAL_KEYS.investments,
  LOCAL_KEYS.stock,
  LOCAL_KEYS.payroll,
  LOCAL_KEYS.fees,
  LOCAL_KEYS.obligations,
] as const;

/** Escritório e empresas (com a exclusão em cascata). */
export function clientMethods(ctx: LocalContext) {
  const { ready, read, write, remove, replace, stamp, appendAudit } = ctx;
  return {
    async getOrgSettings() {
      await ready();
      return read<OrgSettings>(LOCAL_KEYS.org)[0] ?? null;
    },
    async saveOrgSettings(settings) {
      write(LOCAL_KEYS.org, [stamp(settings)]);
    },

    async listClients() {
      await ready();
      return read<ClientCompany>(LOCAL_KEYS.clients);
    },
    async saveClient(client) {
      const isNew = !read<ClientCompany>(LOCAL_KEYS.clients).some((c) => c.id === client.id);
      replace(LOCAL_KEYS.clients, stamp(client));
      if (isNew && !read<LockState>(LOCAL_KEYS.lockState).some((s) => s.clientId === client.id)) {
        replace(LOCAL_KEYS.lockState, stamp(initialLockState(client.id)));
      }
    },
    async updateClientDaybook(clientId, daybook) {
      const client = read<ClientCompany>(LOCAL_KEYS.clients).find((c) => c.id === clientId);
      if (!client) throw new Error('Empresa não encontrada.');
      replace(LOCAL_KEYS.clients, { ...client, daybook: { ...daybook } });
    },
    async markClientBackup(clientId, at) {
      const client = read<ClientCompany>(LOCAL_KEYS.clients).find((c) => c.id === clientId);
      if (!client) throw new Error('Empresa não encontrada.');
      replace(LOCAL_KEYS.clients, { ...client, lastBackupAt: at });
    },
    async deleteClient(clientId, actor) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      if (!isAdminSession()) throw new Error('Somente o administrador do escritório pode excluir empresas.');
      // A trilha de auditoria é preservada, como no Firestore, e registra os fechamentos removidos.
      const now = new Date().toISOString();
      const reopened = read<PeriodLock>(LOCAL_KEYS.locks)
        .filter((l) => l.clientId === clientId)
        .map(
          (lock): AuditEntry => ({
            id: periodAuditId(lock, 'reopen'),
            clientId,
            action: 'PERIOD_REOPEN',
            actorUid: actor.uid,
            ...(actor.email ? { actorEmail: actor.email } : {}),
            at: now,
            month: lock.month,
            note: 'Competência liberada pela exclusão da empresa',
          })
        );
      if (reopened.length) appendAudit(...reopened);
      for (const key of CASCADE) {
        write(
          key,
          read<{ clientId: string }>(key).filter((x) => x.clientId !== clientId)
        );
      }
      remove<ClientCompany>(LOCAL_KEYS.clients, clientId);
    },
  } satisfies Partial<DataRepository>;
}
