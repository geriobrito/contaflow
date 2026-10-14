import type { ClientRequest, ClientRequestAnswer } from '@/types/firestore';

/** Tamanho máximo de uma resposta do cliente (o mesmo do campo de texto do link e de firestore.rules). */
export const MAX_ANSWER_LENGTH = 2000;

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
