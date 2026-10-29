import type { ClientRequest, ClientRequestAnswer } from '@/types/firestore';

/** Tamanho máximo de uma resposta do cliente (o mesmo do campo de texto do link e de firestore.rules). */
export const MAX_ANSWER_LENGTH = 2000;

/** Evento disparado na janela quando respostas são marcadas como lidas ou links mudam de estado. */
export const REQUESTS_UPDATED_EVENT = 'contaflow:requests-updated';

export function notifyRequestsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
  }
}

/** Link público de resposta. O token vai no fragmento (#), que o navegador não envia ao servidor. */
export const requestLink = (origin: string, token: string): string => `${origin}/responder#t=${token}`;

/** Token do link aberto no navegador. Links antigos traziam o token na consulta (`?t=`). */
export function tokenFromLocation(location: { hash: string; search: string }): string {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('t');
  return fromHash ?? new URLSearchParams(location.search).get('t') ?? '';
}

/**
 * Resposta do cliente à pergunta `index`, ou null se não houver. `answers` é gravado pelo
 * link público, sem login: só texto é aceito, e cortado no tamanho máximo. Links antigos
 * guardavam a resposta dentro do próprio item.
 */
export function answerAt(request: Pick<ClientRequest, 'items' | 'answers'>, index: number): ClientRequestAnswer | null {
  const raw: unknown = Array.isArray(request.answers) ? request.answers[index] : undefined;
  if (raw && typeof raw === 'object') {
    const { text, answeredAt } = raw as { text?: unknown; answeredAt?: unknown };
    if (typeof text === 'string' && text.trim()) {
      return { text: text.trim().slice(0, MAX_ANSWER_LENGTH), ...(typeof answeredAt === 'string' ? { answeredAt } : {}) };
    }
  }
  const legacy = request.items[index];
  if (typeof legacy?.answer === 'string' && legacy.answer.trim()) {
    return { text: legacy.answer.trim(), ...(legacy.answeredAt ? { answeredAt: legacy.answeredAt } : {}) };
  }
  return null;
}

/** Quantas perguntas do link já têm resposta. */
export const answeredCount = (request: Pick<ClientRequest, 'items' | 'answers'>): number =>
  request.items.filter((_, i) => answerAt(request, i)).length;

/** Data ISO da resposta mais recente dentro de um link, se houver. */
export function latestResponseAt(
  request: Pick<ClientRequest, 'items' | 'answers' | 'respondedAt'>
): string | undefined {
  let latest = request.respondedAt;
  request.items.forEach((_, i) => {
    const ans = answerAt(request, i);
    if (ans?.answeredAt && (!latest || ans.answeredAt > latest)) {
      latest = ans.answeredAt;
    }
  });
  return latest;
}

/** Indica se o link possui respostas do cliente ainda não vistas pelo escritório. */
export function hasUnreadAnswers(
  request: Pick<ClientRequest, 'items' | 'answers' | 'respondedAt' | 'seenAt'>
): boolean {
  if (answeredCount(request) === 0) return false;
  if (!request.seenAt) return true;
  const latest = latestResponseAt(request);
  return Boolean(latest && latest > request.seenAt);
}

/** IDs dos lançamentos com resposta nova ainda não vista pelo escritório. */
export function unreadTransactionIds(requests: readonly ClientRequest[]): Set<string> {
  const out = new Set<string>();
  for (const r of requests) {
    if (!hasUnreadAnswers(r)) continue;
    r.items.forEach((item, i) => {
      const ans = answerAt(r, i);
      if (!ans) return;
      if (!r.seenAt || !ans.answeredAt || ans.answeredAt > r.seenAt) {
        out.add(item.transactionId);
      }
    });
    // Caso `respondedAt > seenAt` mas itens antigos não tinham `answeredAt` individual
    if (out.size === 0 && r.respondedAt && r.seenAt && r.respondedAt > r.seenAt) {
      r.items.forEach((item, i) => {
        if (answerAt(r, i)) out.add(item.transactionId);
      });
    }
  }
  return out;
}

/** Mapa `clientId -> quantidade de respostas não lidas` em toda a carteira do escritório. */
export function unreadSummaryByClient(requests: readonly ClientRequest[]): Map<string, number> {
  const byClientTx = new Map<string, Set<string>>();
  for (const r of requests) {
    if (!hasUnreadAnswers(r)) continue;
    let set = byClientTx.get(r.clientId);
    if (!set) {
      set = new Set<string>();
      byClientTx.set(r.clientId, set);
    }
    let addedForReq = 0;
    r.items.forEach((item, i) => {
      const ans = answerAt(r, i);
      if (!ans) return;
      if (!r.seenAt || !ans.answeredAt || ans.answeredAt > r.seenAt) {
        set!.add(item.transactionId);
        addedForReq++;
      }
    });
    if (addedForReq === 0) {
      r.items.forEach((item, i) => {
        if (answerAt(r, i)) set!.add(item.transactionId);
      });
    }
  }

  const counts = new Map<string, number>();
  for (const [clientId, set] of byClientTx) {
    if (set.size > 0) counts.set(clientId, set.size);
  }
  return counts;
}

/** Resposta mais recente do cliente para cada lançamento (entre todos os links, abertos ou não). */
export function latestAnswers(requests: readonly ClientRequest[]): Map<string, ClientRequestAnswer> {
  const out = new Map<string, ClientRequestAnswer>();
  for (const r of [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    r.items.forEach((item, i) => {
      const answer = answerAt(r, i);
      if (answer) out.set(item.transactionId, answer);
    });
  }
  return out;
}
