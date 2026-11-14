import type { ClientRequest } from '@/types/firestore';
import type { DataRepository } from '@/lib/data/repository';
import { LOCAL_KEYS, type LocalContext } from './store';

const byCreatedDesc = (a: ClientRequest, b: ClientRequest) => b.createdAt.localeCompare(a.createdAt);

/** Pendências com o cliente: links do escritório e o acesso público pelo token. */
export function requestMethods(ctx: LocalContext) {
  const { ready, read, write, stamp } = ctx;
  /** Altera um link existente (erro se não existir). */
  const updateRequest = (id: string, change: (r: ClientRequest) => ClientRequest, missing = 'Link não encontrado.') => {
    const all = read<ClientRequest>(LOCAL_KEYS.requests);
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(missing);
    all[i] = change(all[i]);
    write(LOCAL_KEYS.requests, all);
  };
  return {
    async listClientRequests(clientId) {
      await ready();
      return read<ClientRequest>(LOCAL_KEYS.requests)
        .filter((r) => r.clientId === clientId)
        .sort(byCreatedDesc);
    },
    async saveClientRequest(request) {
      const all = read<ClientRequest>(LOCAL_KEYS.requests).filter((r) => r.id !== request.id);
      write(LOCAL_KEYS.requests, [...all, stamp(request)]);
    },
    async closeClientRequest(requestId) {
      updateRequest(requestId, (r) => ({ ...r, status: 'CLOSED' }));
    },
    async renewClientRequest(requestId, expiresAtMs) {
      updateRequest(requestId, (r) => ({ ...r, status: 'OPEN', expiresAtMs }));
    },
    async markClientRequestsSeen(items) {
      if (!items.length) return;
      const seenMap = new Map(items.map((x) => [x.id, x.seenAt] as const));
      write(
        LOCAL_KEYS.requests,
        read<ClientRequest>(LOCAL_KEYS.requests).map((r) => (seenMap.has(r.id) ? { ...r, seenAt: seenMap.get(r.id)! } : r))
      );
    },
    async listOpenOrgClientRequests() {
      await ready();
      return read<ClientRequest>(LOCAL_KEYS.requests)
        .filter((r) => r.status === 'OPEN')
        .sort(byCreatedDesc);
    },

    async getPublicClientRequest(token) {
      await ready();
      return read<ClientRequest>(LOCAL_KEYS.requests).find((r) => r.id === token) ?? null;
    },
    async answerPublicClientRequest(token, answers, respondedAt) {
      updateRequest(
        token,
        (req) => {
          if (req.status !== 'OPEN' || Date.now() >= req.expiresAtMs) throw new Error('Este link não aceita mais respostas.');
          if (answers.length !== req.items.length) throw new Error('É preciso uma resposta por pergunta.');
          // Só as respostas mudam; as perguntas ficam como o escritório gravou.
          return { ...req, answers: [...answers], respondedAt };
        },
        'Link inválido.'
      );
    },
  } satisfies Partial<DataRepository>;
}
