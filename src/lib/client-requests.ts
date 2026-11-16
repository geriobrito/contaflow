import type { BankTransaction, ClientCompany, ClientRequest, ClientRequestAnswer } from '@/types/firestore';

/** Tamanho máximo de uma resposta do cliente (o mesmo do campo de texto do link e de firestore.rules). */
export const MAX_ANSWER_LENGTH = 2000;

/**
 * Perguntas por link. As regras conferem as respostas uma a uma, sem laços, e só até 24
 * (validAnswers em firestore.rules); acima disso o link é recusado na criação.
 */
export const MAX_REQUEST_ITEMS = 24;

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

/* =========================================================================
   Fila de trabalho por situação e dias de espera
   ========================================================================= */

/** Situação de cada pendência na fila do escritório. */
export type PendingQueryStage = 'ANSWERED' | 'WAITING' | 'NOT_SENT';

export type PendingQueryFilter = 'ALL' | PendingQueryStage;

export interface PendingQueryCounts {
  all: number;
  answered: number;
  waiting: number;
  notSent: number;
}

export interface PendingQueryGroup {
  stage: PendingQueryStage;
  title: string;
  subtitle: string;
  items: BankTransaction[];
}

/** Situação da pendência: respondida, aguardando em link aberto ou ainda não enviada. */
export function queryStage(
  transactionId: string,
  answers: ReadonlyMap<string, ClientRequestAnswer>,
  inOpenLink: ReadonlySet<string>
): PendingQueryStage {
  if (answers.has(transactionId)) return 'ANSWERED';
  if (inOpenLink.has(transactionId)) return 'WAITING';
  return 'NOT_SENT';
}

/** Contagem em cada situação da fila de pendências. */
export function pendingQueryCounts(
  queries: readonly BankTransaction[],
  answers: ReadonlyMap<string, ClientRequestAnswer>,
  inOpenLink: ReadonlySet<string>
): PendingQueryCounts {
  let answered = 0;
  let waiting = 0;
  let notSent = 0;
  for (const q of queries) {
    const stage = queryStage(q.id, answers, inOpenLink);
    if (stage === 'ANSWERED') answered += 1;
    else if (stage === 'WAITING') waiting += 1;
    else notSent += 1;
  }
  return { all: queries.length, answered, waiting, notSent };
}

/**
 * Data de envio (`createdAt` do link aberto mais antigo que inclui o lançamento) para cada
 * pendência que está aguardando resposta do cliente.
 */
export function sentAtByTransaction(openRequests: readonly Pick<ClientRequest, 'createdAt' | 'items'>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const req of openRequests) {
    for (const item of req.items) {
      const prev = map.get(item.transactionId);
      if (!prev || req.createdAt < prev) {
        map.set(item.transactionId, req.createdAt);
      }
    }
  }
  return map;
}

/** Dias corridos de espera desde `sentAtIso` até `nowMs` (0 quando enviado hoje ou data inválida). */
export function waitingDays(sentAtIso: string, nowMs: number): number {
  const sentMs = Date.parse(sentAtIso);
  if (!Number.isFinite(sentMs) || nowMs <= sentMs) return 0;
  return Math.floor((nowMs - sentMs) / 86_400_000);
}

/** Rótulo amigável para os dias de espera de uma pergunta enviada. */
export function formatWaitingDays(days: number): string {
  if (days <= 0) return 'enviado hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

/**
 * Agrupa as pendências na ordem de trabalho:
 * 1. Respondidas (prontas para classificar) — novas respostas primeiro;
 * 2. Aguardando o cliente — as enviadas há mais tempo primeiro;
 * 3. Ainda não enviadas — por data do lançamento (mais recentes primeiro).
 */
export function groupPendingQueries(params: {
  queries: readonly BankTransaction[];
  answers: ReadonlyMap<string, ClientRequestAnswer>;
  inOpenLink: ReadonlySet<string>;
  sentAtMap: ReadonlyMap<string, string>;
  newlyAnsweredIds?: ReadonlySet<string>;
  filter?: PendingQueryFilter;
}): PendingQueryGroup[] {
  const { queries, answers, inOpenLink, sentAtMap, newlyAnsweredIds, filter = 'ALL' } = params;
  const answered: BankTransaction[] = [];
  const waiting: BankTransaction[] = [];
  const notSent: BankTransaction[] = [];

  for (const q of queries) {
    const stage = queryStage(q.id, answers, inOpenLink);
    if (stage === 'ANSWERED') answered.push(q);
    else if (stage === 'WAITING') waiting.push(q);
    else notSent.push(q);
  }

  answered.sort((a, b) => {
    const aNew = newlyAnsweredIds?.has(a.id) ? 0 : 1;
    const bNew = newlyAnsweredIds?.has(b.id) ? 0 : 1;
    if (aNew !== bNew) return aNew - bNew;
    const aTime = answers.get(a.id)?.answeredAt ?? '';
    const bTime = answers.get(b.id)?.answeredAt ?? '';
    return bTime.localeCompare(aTime) || b.date.localeCompare(a.date);
  });

  waiting.sort((a, b) => {
    const aSent = sentAtMap.get(a.id) ?? a.clientQuery?.askedAt ?? '';
    const bSent = sentAtMap.get(b.id) ?? b.clientQuery?.askedAt ?? '';
    return aSent.localeCompare(bSent) || b.date.localeCompare(a.date);
  });

  notSent.sort((a, b) => b.date.localeCompare(a.date));

  const allGroups: PendingQueryGroup[] = [
    {
      stage: 'ANSWERED',
      title: 'Respondidas · prontas para classificar',
      subtitle: 'O cliente já justificou estes lançamentos; confira a resposta e classifique.',
      items: answered,
    },
    {
      stage: 'WAITING',
      title: 'Aguardando o cliente',
      subtitle: 'Enviadas em link aberto · ordenadas da mais antiga para a mais recente.',
      items: waiting,
    },
    {
      stage: 'NOT_SENT',
      title: 'Ainda não enviadas',
      subtitle: 'Fora de qualquer link aberto · gere um novo link ou reative um anterior.',
      items: notSent,
    },
  ];

  return allGroups.filter((g) => g.items.length > 0 && (filter === 'ALL' || g.stage === filter));
}

/* =========================================================================
   Cobrança e envio por WhatsApp / E-mail
   ========================================================================= */

/**
 * Normaliza um telefone brasileiro para o formato do WhatsApp (`55` + DDD + número, só dígitos).
 * Devolve `null` se não houver dígitos suficientes.
 */
export function normalizeWhatsAppPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return null;
}

/** Telefone do cliente para WhatsApp: usa `phone` principal ou `registration.phone2` como reserva. */
export function clientWhatsAppPhone(client?: Pick<ClientCompany, 'phone' | 'registration'> | null): string | null {
  return normalizeWhatsAppPhone(client?.phone) ?? normalizeWhatsAppPhone(client?.registration?.phone2);
}

/** Endereço `https://wa.me/...` com destinatário (quando a empresa tem telefone) e texto preenchido. */
export function whatsAppLink(text: string, phone?: string | null): string {
  const normalized = normalizeWhatsAppPhone(phone);
  return normalized
    ? `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Mensagem padrão para enviar o link de pendências ao cliente. */
export function buildShareMessage(
  request: Pick<ClientRequest, 'clientName' | 'expiresAtMs' | 'items'>,
  url: string
): string {
  const validUntil = new Date(request.expiresAtMs).toLocaleDateString('pt-BR');
  return `Olá! Precisamos de algumas informações sobre lançamentos da ${request.clientName}. Responda por este link (válido até ${validUntil}): ${url}`;
}

/** Mensagem de cobrança indicando quantas perguntas ainda faltam responder no link aberto. */
export function buildReminderMessage(
  request: Pick<ClientRequest, 'clientName' | 'expiresAtMs' | 'items' | 'answers'>,
  url: string
): string {
  const total = request.items.length;
  const done = answeredCount(request);
  const missing = Math.max(0, total - done);
  const validUntil = new Date(request.expiresAtMs).toLocaleDateString('pt-BR');
  if (missing === 0) return buildShareMessage(request, url);
  if (done > 0) {
    return `Olá! Obrigado pelas respostas já enviadas. Ainda falta(m) ${missing} de ${total} pergunta(s) sobre lançamentos da ${request.clientName}. Você pode completar pelo mesmo link (válido até ${validUntil}): ${url}`;
  }
  return `Olá! Ainda aguardamos a resposta de ${missing} pergunta(s) sobre lançamentos da ${request.clientName} para fecharmos a contabilidade. Responda por este link (válido até ${validUntil}): ${url}`;
}

/* =========================================================================
   Rascunho das respostas no aparelho do cliente (link público)
   ========================================================================= */

/** Chave do rascunho de um link no armazenamento do navegador do cliente. */
export const answerDraftKey = (requestId: string): string => `contaflow:responder-rascunho:${requestId}`;

/** Rascunho guardado: os textos digitados e o envio (`respondedAt`) sobre o qual foram digitados. */
export const serializeAnswerDraft = (texts: readonly string[], respondedAt?: string): string =>
  JSON.stringify({ base: respondedAt ?? null, texts });

/**
 * Textos a mostrar ao reabrir o link: o que o cliente digitou e não enviou volta para a tela.
 * Se houve um envio depois do rascunho (outro aparelho), o que já está gravado prevalece e o
 * rascunho só preenche as perguntas ainda sem resposta. Rascunho ilegível ou de outro formato
 * é ignorado.
 */
export function restoreAnswerDrafts(server: readonly string[], savedJson: string | null, respondedAt?: string): string[] {
  if (!savedJson) return [...server];
  let saved: unknown;
  try {
    saved = JSON.parse(savedJson);
  } catch {
    return [...server];
  }
  const { base, texts } = (saved ?? {}) as { base?: unknown; texts?: unknown };
  if (!Array.isArray(texts) || texts.length !== server.length || texts.some((t) => typeof t !== 'string')) return [...server];
  const drafts = (texts as string[]).map((t) => t.slice(0, MAX_ANSWER_LENGTH));
  if (base === (respondedAt ?? null)) return drafts;
  return server.map((text, i) => text || drafts[i]);
}
