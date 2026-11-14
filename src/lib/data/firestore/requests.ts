import { doc, setDoc, updateDoc, where } from 'firebase/firestore';
import type { ClientRequest } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { getDoc, getDocs } from '@/lib/data/counted-reads';
import { clean, COL, single, type FirestoreContext } from './shared';

const byCreatedDesc = (a: ClientRequest, b: ClientRequest) => b.createdAt.localeCompare(a.createdAt);

/** Pendências com o cliente: links do escritório e o acesso público pelo token. */
export function requestMethods(ctx: FirestoreContext) {
  const { db, scoped, stamp, run } = ctx;
  return {
    async listClientRequests(clientId) {
      const snap = await getDocs(scoped(COL.requests, where('clientId', '==', clientId)));
      return snap.docs.map((d) => ({ ...(d.data() as ClientRequest), id: d.id })).sort(byCreatedDesc);
    },
    async saveClientRequest(request) {
      await setDoc(doc(db, COL.requests, request.id), stamp(request));
    },
    async closeClientRequest(requestId) {
      await updateDoc(doc(db, COL.requests, requestId), { status: 'CLOSED' });
    },
    async renewClientRequest(requestId, expiresAtMs) {
      await updateDoc(doc(db, COL.requests, requestId), { status: 'OPEN', expiresAtMs: Math.trunc(expiresAtMs) });
    },
    async markClientRequestsSeen(items) {
      if (!items.length) return;
      await run(items.map(({ id, seenAt }) => single((b) => b.update(doc(db, COL.requests, id), { seenAt }))));
    },
    async listOpenOrgClientRequests() {
      const snap = await getDocs(scoped(COL.requests, where('status', '==', 'OPEN')));
      return snap.docs.map((d) => ({ ...(d.data() as ClientRequest), id: d.id })).sort(byCreatedDesc);
    },

    /* Acesso público pelo link: sem orgId de sessão; as regras validam pelo token. */
    async getPublicClientRequest(token) {
      const snap = await getDoc(doc(db, COL.requests, token));
      return snap.exists() ? { ...(snap.data() as ClientRequest), id: snap.id } : null;
    },
    async answerPublicClientRequest(token, answers, respondedAt) {
      await updateDoc(doc(db, COL.requests, token), { answers: answers.map((a) => clean(a)), respondedAt });
    },
  } satisfies Partial<DataRepository>;
}
