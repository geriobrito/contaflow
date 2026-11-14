import { deleteDoc, doc, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import type { AuditEntry, ClientCompany, OrgSettings } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { initialLockState } from '@/lib/lock-guard';
import { periodAuditId } from '@/lib/periods';
import { COL, REOPENS_PER_BATCH, type FirestoreContext, type Group } from './shared';

/** Coleções apagadas em cascata com a empresa (a auditoria fica; contador e lock_state saem depois da empresa). */
const CASCADE = [
  COL.transactions,
  COL.journalEntries,
  COL.snapshots,
  COL.resultSummaries,
  COL.rules,
  COL.accounts,
  COL.batches,
  COL.bankAccounts,
  COL.openings,
  COL.notes,
  COL.invoices,
  COL.requests,
  COL.fixedAssets,
  COL.checklists,
  COL.prepaid,
  COL.financing,
  COL.investments,
  COL.stock,
  COL.payroll,
  COL.fees,
  COL.obligations,
] as const;

/** Escritório e empresas (com a exclusão em cascata). */
export function clientMethods(ctx: FirestoreContext) {
  const { db, getOrgId, scoped, stamp, run, deleteByClient, lockFrom, auditWrite } = ctx;
  return {
    async getOrgSettings() {
      const snap = await getDoc(doc(db, COL.orgs, getOrgId()));
      return snap.exists() ? { ...(snap.data() as OrgSettings), orgId: snap.id } : null;
    },
    async saveOrgSettings(settings) {
      await setDoc(doc(db, COL.orgs, getOrgId()), stamp(settings));
    },

    async listClients() {
      const snap = await getDocs(scoped(COL.clients));
      return snap.docs.map((d) => ({ ...(d.data() as ClientCompany), id: d.id }));
    },
    async saveClient(client) {
      const clientRef = doc(db, COL.clients, client.id);
      if (!(await getDoc(clientRef)).exists()) {
        const b = writeBatch(db);
        b.set(clientRef, stamp(client));
        b.set(doc(db, COL.lockState, client.id), stamp(initialLockState(client.id)));
        await b.commit();
        return;
      }
      // Substitui o documento: campos apagados no formulário (ex.: CPF do representante) somem de fato.
      await setDoc(clientRef, stamp(client));
    },
    async updateClientDaybook(clientId, daybook) {
      // Só este campo: o resto do cadastro fica como está (saveClient substituiria tudo).
      await updateDoc(doc(db, COL.clients, clientId), { daybook: { ...daybook } });
    },
    async deleteClient(clientId, actor) {
      if (!clientId || clientId === 'global') throw new Error('Cliente inválido para exclusão.');
      // Recusa antes de apagar qualquer coisa: as regras só barrariam o operador no meio da cascata.
      const profile = await getDoc(doc(db, COL.users, actor.uid));
      if (profile.data()?.role === 'operator') throw new Error('Somente o administrador do escritório pode excluir empresas.');

      // A cascata são vários lotes independentes. A marca vem antes do primeiro: se algo
      // falhar no meio, a empresa fica visivelmente "em exclusão" e esta função, chamada de
      // novo, apaga o que restou (cada etapa só consulta o que ainda existe).
      const clientRef = doc(db, COL.clients, clientId);
      if (!(await getDoc(clientRef)).exists()) throw new Error('Empresa não encontrada.');
      await updateDoc(clientRef, { deletingAt: new Date().toISOString() });

      // A trilha de auditoria é preservada (imutável por regra). Os fechamentos saem primeiro
      // (lançamentos de competência fechada não podem ser excluídos), cada um com o registro
      // de reabertura que as regras exigem — agrupados por competência pelo limite de consultas.
      const now = new Date().toISOString();
      const locks = await getDocs(scoped(COL.locks, where('clientId', '==', clientId)));
      await run(
        locks.docs.map((d): Group => {
          const lock = lockFrom(d);
          const audit: AuditEntry = {
            id: periodAuditId(lock, 'reopen'),
            clientId,
            action: 'PERIOD_REOPEN',
            actorUid: actor.uid,
            ...(actor.email ? { actorEmail: actor.email } : {}),
            at: now,
            month: lock.month,
            note: 'Competência liberada pela exclusão da empresa',
          };
          return { month: lock.month, writes: [(b) => b.delete(d.ref), auditWrite(audit)] };
        }),
        // Cada reabertura consulta o fechamento e o registro dela: 2 documentos por competência.
        REOPENS_PER_BATCH
      );
      for (const name of CASCADE) await deleteByClient(name, clientId);
      await deleteDoc(clientRef);
      // A sequência dos lançamentos manuais e o controle de fechamentos só podem ser apagados
      // depois da empresa (regra): enquanto a empresa existe, nenhum contador volta atrás.
      await deleteByClient(COL.journalCounters, clientId);
      await deleteByClient(COL.lockState, clientId);
    },
  } satisfies Partial<DataRepository>;
}
