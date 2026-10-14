import { describe, expect, it } from 'vitest';
import { answerAt, answeredCount, latestAnswers, MAX_ANSWER_LENGTH, requestLink, tokenFromLocation } from '@/lib/client-requests';
import type { ClientRequest } from '@/types/firestore';

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
});
