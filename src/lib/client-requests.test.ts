import { describe, expect, it } from 'vitest';
import {
  answerAt,
  answeredCount,
  buildReminderMessage,
  buildShareMessage,
  clientWhatsAppPhone,
  formatWaitingDays,
  groupPendingQueries,
  hasUnreadAnswers,
  latestAnswers,
  MAX_ANSWER_LENGTH,
  normalizeWhatsAppPhone,
  pendingQueryCounts,
  queryStage,
  requestLink,
  restoreAnswerDrafts,
  sentAtByTransaction,
  serializeAnswerDraft,
  tokenFromLocation,
  unreadSummaryByClient,
  unreadTransactionIds,
  waitingDays,
  whatsAppLink,
} from '@/lib/client-requests';
import type { BankTransaction, ClientRequest } from '@/types/firestore';

const request = (overrides: Partial<ClientRequest> = {}): ClientRequest => ({
  id: 't'.repeat(32),
  clientId: 'c1',
  clientName: 'Empresa',
  items: [
    { transactionId: 'a', date: '2025-03-01', memo: 'PIX', amount: -10, question: 'O que é?' },
    { transactionId: 'b', date: '2025-03-02', memo: 'TED', amount: -20, question: 'E este?' },
  ],
  status: 'OPEN',
  createdAt: '2025-03-05',
  createdByUid: 'u',
  expiresAtMs: 0,
  ...overrides,
});

describe('respostas do cliente', () => {
  it('lê a resposta pela posição da pergunta; texto vazio não conta', () => {
    const r = request({ answers: [{ text: '  Fornecedor de embalagens ', answeredAt: 'T1' }, { text: '   ' }] });
    expect(answerAt(r, 0)).toEqual({ text: 'Fornecedor de embalagens', answeredAt: 'T1' });
    expect(answerAt(r, 1)).toBeNull();
    expect(answerAt(r, 5)).toBeNull();
    expect(answeredCount(r)).toBe(1);
  });

  it('saneia o que vem do link público: só texto, cortado no tamanho máximo', () => {
    const hostile = [{ text: 42 }, 'solto', null, { text: 'x'.repeat(MAX_ANSWER_LENGTH + 500), answeredAt: { a: 1 } }];
    const r = request({ items: [...request().items, ...request().items], answers: hostile as never });
    expect(answerAt(r, 0)).toBeNull();
    expect(answerAt(r, 1)).toBeNull();
    expect(answerAt(r, 2)).toBeNull();
    expect(answerAt(r, 3)).toEqual({ text: 'x'.repeat(MAX_ANSWER_LENGTH) });
    expect(answerAt(request({ answers: 'não é lista' as never }), 0)).toBeNull();
  });

  it('links antigos: resposta guardada dentro do item continua visível', () => {
    const legacy = request();
    legacy.items[0] = { ...legacy.items[0], answer: 'Aluguel', answeredAt: 'T0' };
    expect(answerAt(legacy, 0)).toEqual({ text: 'Aluguel', answeredAt: 'T0' });
    // A resposta no campo novo prevalece sobre a antiga.
    expect(answerAt({ ...legacy, answers: [{ text: 'Aluguel de março' }] }, 0)).toEqual({ text: 'Aluguel de março' });
  });

  it('entre vários links, vale a resposta do link mais recente', () => {
    const old = request({ createdAt: '2025-03-01', answers: [{ text: 'antiga' }, { text: 'só no antigo' }] });
    const recent = request({ id: 'n'.repeat(32), createdAt: '2025-03-10', answers: [{ text: 'nova' }, { text: '' }] });
    const map = latestAnswers([recent, old]);
    expect(map.get('a')?.text).toBe('nova');
    expect(map.get('b')?.text).toBe('só no antigo');
  });

  it('o token do link vai no fragmento; links antigos (?t=) continuam abrindo', () => {
    const token = 'a'.repeat(32);
    expect(requestLink('https://app.exemplo', token)).toBe(`https://app.exemplo/responder#t=${token}`);
    expect(tokenFromLocation({ hash: `#t=${token}`, search: '' })).toBe(token);
    expect(tokenFromLocation({ hash: '', search: `?t=${token}` })).toBe(token);
    expect(tokenFromLocation({ hash: '#t=novo', search: '?t=antigo' })).toBe('novo');
    expect(tokenFromLocation({ hash: '', search: '' })).toBe('');
  });

  it('detecta respostas não lidas e volta a alertar quando o cliente complementa depois de seenAt', () => {
    const empty = request();
    expect(hasUnreadAnswers(empty)).toBe(false);

    const firstReply = request({
      respondedAt: '2025-03-10T10:00:00.000Z',
      answers: [{ text: 'Fornecedor X', answeredAt: '2025-03-10T10:00:00.000Z' }, { text: '' }],
    });
    expect(hasUnreadAnswers(firstReply)).toBe(true);
    expect([...unreadTransactionIds([firstReply])]).toEqual(['a']);

    const seen = { ...firstReply, seenAt: '2025-03-10T10:05:00.000Z' };
    expect(hasUnreadAnswers(seen)).toBe(false);
    expect([...unreadTransactionIds([seen])]).toEqual([]);

    const secondReply = {
      ...seen,
      respondedAt: '2025-03-10T12:00:00.000Z',
      answers: [
        { text: 'Fornecedor X', answeredAt: '2025-03-10T10:00:00.000Z' },
        { text: 'Reembolso viagem', answeredAt: '2025-03-10T12:00:00.000Z' },
      ],
    };
    expect(hasUnreadAnswers(secondReply)).toBe(true);
    expect([...unreadTransactionIds([secondReply])]).toEqual(['b']);

    const otherClient = request({
      id: 'z'.repeat(32),
      clientId: 'c2',
      respondedAt: '2025-03-11T09:00:00.000Z',
      answers: [
        { text: 'Item 1', answeredAt: '2025-03-11T09:00:00.000Z' },
        { text: 'Item 2', answeredAt: '2025-03-11T09:00:00.000Z' },
      ],
    });
    const summary = unreadSummaryByClient([secondReply, otherClient]);
    expect(summary.get('c1')).toBe(1);
    expect(summary.get('c2')).toBe(2);
  });

  it('separa a fila nas três situações na ordem correta e calcula dias de espera', () => {
    const tx = (id: string, date: string): BankTransaction => ({
      id,
      clientId: 'c1',
      fitid: id,
      date,
      amount: -100,
      type: 'DEBIT',
      memo: `Lançamento ${id}`,
      status: 'PENDING',
      clientQuery: { question: `O que é ${id}?`, status: 'OPEN', askedAt: `${date}T10:00:00.000Z`, askedByUid: 'u1' },
      createdAt: `${date}T10:00:00.000Z`,
    });

    const queries = [tx('nao-enviada', '2025-03-18'), tx('aguardando-recente', '2025-03-15'), tx('respondida', '2025-03-10'), tx('aguardando-antiga', '2025-03-05')];
    const openLinks = [
      request({
        id: 'l1'.padEnd(32, '0'),
        createdAt: '2025-03-06T12:00:00.000Z',
        items: [{ transactionId: 'aguardando-antiga', date: '2025-03-05', memo: 'A', amount: -100, question: 'Q1' }],
      }),
      request({
        id: 'l2'.padEnd(32, '0'),
        createdAt: '2025-03-16T12:00:00.000Z',
        items: [
          { transactionId: 'aguardando-recente', date: '2025-03-15', memo: 'B', amount: -100, question: 'Q2' },
          { transactionId: 'respondida', date: '2025-03-10', memo: 'C', amount: -100, question: 'Q3' },
        ],
        answers: [{ text: '' }, { text: 'Compra de material', answeredAt: '2025-03-17T08:00:00.000Z' }],
      }),
    ];

    const answers = latestAnswers(openLinks);
    const inOpenLink = new Set(openLinks.flatMap((r) => r.items.map((i) => i.transactionId)));
    const sentAtMap = sentAtByTransaction(openLinks);

    expect(queryStage('respondida', answers, inOpenLink)).toBe('ANSWERED');
    expect(queryStage('aguardando-antiga', answers, inOpenLink)).toBe('WAITING');
    expect(queryStage('nao-enviada', answers, inOpenLink)).toBe('NOT_SENT');

    expect(pendingQueryCounts(queries, answers, inOpenLink)).toEqual({
      all: 4,
      answered: 1,
      waiting: 2,
      notSent: 1,
    });

    const groups = groupPendingQueries({ queries, answers, inOpenLink, sentAtMap });
    expect(groups.map((g) => g.stage)).toEqual(['ANSWERED', 'WAITING', 'NOT_SENT']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['respondida']);
    // Aguardando: a enviada há mais tempo vem primeiro
    expect(groups[1].items.map((i) => i.id)).toEqual(['aguardando-antiga', 'aguardando-recente']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['nao-enviada']);

    const filtered = groupPendingQueries({ queries, answers, inOpenLink, sentAtMap, filter: 'WAITING' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].stage).toBe('WAITING');

    const nowMs = Date.parse('2025-03-18T12:00:00.000Z');
    const daysOld = waitingDays(sentAtMap.get('aguardando-antiga')!, nowMs);
    expect(daysOld).toBe(12);
    expect(formatWaitingDays(daysOld)).toBe('há 12 dias');
    expect(formatWaitingDays(1)).toBe('há 1 dia');
    expect(formatWaitingDays(0)).toBe('enviado hoje');
  });

  it('normaliza telefone do WhatsApp e monta mensagens de envio e de cobrança', () => {
    expect(normalizeWhatsAppPhone('(81) 99988-7766')).toBe('5581999887766');
    expect(normalizeWhatsAppPhone('81 3322-1100')).toBe('558133221100');
    expect(normalizeWhatsAppPhone('+55 (11) 98888-7777')).toBe('5511988887777');
    expect(normalizeWhatsAppPhone('123')).toBeNull();
    expect(clientWhatsAppPhone({ phone: '', registration: { phone2: '(81) 98877-6655' } })).toBe('5581988776655');

    expect(whatsAppLink('Olá', '(81) 99988-7766')).toBe('https://wa.me/5581999887766?text=Ol%C3%A1');
    expect(whatsAppLink('Olá', undefined)).toBe('https://wa.me/?text=Ol%C3%A1');

    const r = request({
      clientName: 'Padaria Aurora',
      expiresAtMs: Date.UTC(2025, 3, 15, 12, 0, 0),
      answers: [{ text: 'Respondida' }, { text: '' }],
    });
    const share = buildShareMessage(r, 'https://app.exemplo/responder#t=abc');
    expect(share).toContain('Padaria Aurora');
    expect(share).toContain('https://app.exemplo/responder#t=abc');

    const reminderPartial = buildReminderMessage(r, 'https://app.exemplo/responder#t=abc');
    expect(reminderPartial).toContain('Ainda falta(m) 1 de 2 pergunta(s)');
    expect(reminderPartial).toContain('https://app.exemplo/responder#t=abc');

    const reminderNone = buildReminderMessage(request({ clientName: 'Padaria Aurora', expiresAtMs: Date.UTC(2025, 3, 15, 12, 0, 0) }), 'https://app.exemplo/responder#t=abc');
    expect(reminderNone).toContain('Ainda aguardamos a resposta de 2 pergunta(s)');
  });
});

describe('rascunho das respostas no aparelho do cliente', () => {
  it('devolve o que foi digitado e não enviado', () => {
    const saved = serializeAnswerDraft(['compra de embalagens', ''], undefined);
    expect(restoreAnswerDrafts(['', ''], saved)).toEqual(['compra de embalagens', '']);
  });

  it('sobre o mesmo envio, o rascunho vale inclusive para apagar ou corrigir uma resposta', () => {
    const saved = serializeAnswerDraft(['corrigida', ''], '2026-11-10T12:00:00.000Z');
    expect(restoreAnswerDrafts(['antiga', 'outra'], saved, '2026-11-10T12:00:00.000Z')).toEqual(['corrigida', '']);
  });

  it('com envio posterior ao rascunho, o gravado prevalece e o rascunho só preenche o que falta', () => {
    const saved = serializeAnswerDraft(['velha', 'pendente'], undefined);
    expect(restoreAnswerDrafts(['enviada de outro aparelho', ''], saved, '2026-11-12T09:00:00.000Z')).toEqual(['enviada de outro aparelho', 'pendente']);
  });

  it('ignora rascunho ilegível, de outro formato ou de outra quantidade de perguntas', () => {
    expect(restoreAnswerDrafts(['a'], null)).toEqual(['a']);
    expect(restoreAnswerDrafts(['a'], '{nao é json')).toEqual(['a']);
    expect(restoreAnswerDrafts(['a'], JSON.stringify({ base: null, texts: ['x', 'y'] }))).toEqual(['a']);
    expect(restoreAnswerDrafts(['a'], JSON.stringify({ base: null, texts: [1] }))).toEqual(['a']);
  });

  it('corta o rascunho no tamanho máximo da resposta', () => {
    const saved = serializeAnswerDraft(['x'.repeat(MAX_ANSWER_LENGTH + 50)]);
    expect(restoreAnswerDrafts([''], saved)[0]).toHaveLength(MAX_ANSWER_LENGTH);
  });
});
