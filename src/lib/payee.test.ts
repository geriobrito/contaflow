import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { assessRuleTerm, extractPayee, groupByPayee, payeeKey, suggestRuleTerm } from '@/lib/payee';

const tx = (id: string, memo: string, amount: number, date = '2025-03-10'): BankTransaction => ({
  id, clientId: 'c', fitid: id, date, amount, type: amount < 0 ? 'DEBIT' : 'CREDIT', memo, status: 'PENDING', createdAt: '',
});

describe('extractPayee (descrições reais dos extratos)', () => {
  const cases: [string, string | null][] = [
    // InfinitePay
    ['Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado', 'WMS SUPERMERCADOS DO BRASIL LTDA'],
    ['Pix WMS SUPERMERCADOS DO BRASIL LTDA. - Enviado', 'WMS SUPERMERCADOS DO BRASIL LTDA'],
    ['Pix ROGERIO SILVA P BRITO - Enviado', 'ROGERIO SILVA P BRITO'],
    ['Vendas - Depósito InfinitePay', 'Vendas'],
    // Nubank
    ['Transferência recebida pelo Pix - VALQUIRIA LIMA SOUTO - •••.975.291-•• - COOP SICREDI OURO VERDE MT Agência: 810 Conta: 16754-4', 'VALQUIRIA LIMA SOUTO'],
    ['Transferência Recebida - Ana Paula Solano da Silva - •••.293.411-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 53272586-5', 'Ana Paula Solano da Silva'],
    ['Transferência enviada pelo Pix - CANTINHO AGUA & GAS - 27.290.531/0001-12 - CCLA UNIÃO E NEGÓCIOS - SICOOB INTEGRAÇÃO Agência: 4425 Conta: 58046-5', 'CANTINHO AGUA & GAS'],
    ['Transferência recebida pelo Pix - 51832711 MARILZA APARECIDA DE OLIVEIRA - 51.832.711/0001-63 - PAGSEGURO INTERNET IP S.A. (0290) Agência: 1 Conta: 59659533-0', 'MARILZA APARECIDA DE OLIVEIRA'],
    ['Transferência enviada pelo Pix - MARIANA LEITE SANTOS 05772742108 - 46.584.200/0001-30 - CLOUDWALK IP LTDA (0542) Agência: 1 Conta: 3597601-2', 'MARIANA LEITE SANTOS'],
    ['Estorno - Transferência enviada pelo Pix - Bella Modas - 31.207.209/0001-54 - ITAÚ UNIBANCO S.A. (0341) Agência: 4416 Conta: 44085-9', 'Bella Modas'],
    ['Pagamento de boleto efetuado - DAS-SIMPLES NACIONAL', 'DAS-SIMPLES NACIONAL'],
    ['Pagamento de boleto efetuado - Claro', 'Claro'],
    ['Compra no débito - Vivi Modas Feminina', 'Vivi Modas Feminina'],
    ['Pagamento de fatura', null],
    // PagBank
    ['Pix recebido - Natalino De Jesus Ferreira Dos Santos', 'Natalino De Jesus Ferreira Dos Santos'],
    ['Pix enviado - Rogério Silva Pereira Brito', 'Rogério Silva Pereira Brito'],
    ['QR Code Pix enviado - Shpp Brasil Instituicao De Pag', 'Shpp Brasil Instituicao De Pag'],
    ['Vendas - Disponivel DEBITO VISA', 'Vendas'],
    ['Rendimento da conta - Rendimento líquido sobre dinheiro em conta', 'Rendimento da conta'],
    ['Mensalidade Seguro Conta - Para: PAGSEGURO INTERNET INSTITUICAO DE PAGAMENTO', 'Mensalidade Seguro Conta'],
    // Outros bancos: descrição livre fica como está
    ['UBER *TRIP SAO PAULO BR', 'UBER *TRIP SAO PAULO BR'],
  ];
  it.each(cases)('%s', (memo, expected) => {
    expect(extractPayee(memo)).toBe(expected);
  });

  it('termo sugerido: favorecido em minúsculas; sem favorecido, a descrição inteira', () => {
    expect(suggestRuleTerm('Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado')).toBe('wms supermercados do brasil ltda');
    expect(suggestRuleTerm('Pagamento de fatura')).toBe('pagamento de fatura');
    expect(suggestRuleTerm('Vendas - Depósito InfinitePay')).toBe('vendas');
  });

  it('variações do mesmo favorecido têm a mesma chave', () => {
    expect(payeeKey('Pix WMS SUPERMERCADOS DO BRASIL LTDA. - Enviado')).toBe(payeeKey('Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado'));
    expect(payeeKey('Pix enviado - Rogério Silva')).toBe(payeeKey('Pix ROGERIO SILVA - Enviado'));
  });
});

describe('groupByPayee', () => {
  const txs = [
    tx('1', 'Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado', -406.37, '2025-09-30'),
    tx('2', 'Pix WMS SUPERMERCADOS DO BRASIL LTDA. - Enviado', -517.95, '2025-09-23'),
    tx('3', 'Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado', -331.29, '2025-09-17'),
    tx('4', 'Pix ROGERIO SILVA - Recebido', 1000),
    tx('5', 'Pix ROGERIO SILVA - Enviado', -150),
    tx('6', 'Vendas - Depósito InfinitePay', 58.11),
    tx('7', 'Vendas - Depósito InfinitePay', 236.72),
  ];

  it('agrupa por favorecido e sentido, do maior grupo para o menor', () => {
    const groups = groupByPayee(txs);
    expect(groups.map((g) => [g.label, g.direction, g.transactions.length, g.total])).toEqual([
      ['WMS SUPERMERCADOS DO BRASIL LTDA', 'OUT', 3, -1255.61],
      ['Vendas', 'IN', 2, 294.83],
      ['ROGERIO SILVA', 'IN', 1, 1000],
      ['ROGERIO SILVA', 'OUT', 1, -150],
    ]);
    expect(groups[0].term).toBe('wms supermercados do brasil ltda');
    expect(groups[0].transactions.map((t) => t.id)).toEqual(['1', '2', '3']);
  });
});

describe('assessRuleTerm', () => {
  const memos = [
    'Pix WMS SUPERMERCADOS DO BRASIL LTDA - Enviado',
    'Pix WMS SUPERMERCADOS DO BRASIL LTDA. - Enviado',
    'Pix ROGERIO SILVA - Enviado',
    'Pix PARAISO COMERCIO DE EMBALAGENS - Enviado',
    'Pix SENDAS DISTRIBUIDORA S/A - Enviado',
    'Pix DAWY PEREIRA DOS REIS - Recebido',
    'Pix ANDREIA ALVES - Recebido',
    'Vendas - Depósito InfinitePay',
    'Vendas - Depósito InfinitePay',
    'Pix MAGDA PATRICIA - Recebido',
  ];

  it('termo do favorecido é específico', () => {
    expect(assessRuleTerm({ pattern: 'wms supermercados do brasil ltda', matchType: 'CONTAINS' }, memos)).toMatchObject({ level: 'ok', matchCount: 2, payeeCount: 1 });
    expect(assessRuleTerm({ pattern: 'vendas' }, memos)).toMatchObject({ level: 'ok', matchCount: 2 });
  });

  it('termos genéricos: só palavras da operação', () => {
    for (const p of ['enviado', 'recebido', 'pix', 'pix enviado', 'transferência recebida', 'pagamento de boleto']) {
      const a = assessRuleTerm({ pattern: p }, memos);
      expect(a.level, p).toBe('generic');
      expect(a.reasons[0]).toMatch(/descrevem a operação/);
    }
    expect(assessRuleTerm({ pattern: 'ab' }, memos).level).toBe('generic');
    expect(assessRuleTerm({ pattern: '' }, memos).level).toBe('generic');
  });

  it('termo que casa com muitos favorecidos diferentes é amplo, e conta quantos', () => {
    const a = assessRuleTerm({ pattern: 'comercio' , matchType: 'CONTAINS'}, [...memos, 'COMERCIO A X', 'COMERCIO B Y', 'COMERCIO C Z']);
    expect(a.level).toBe('broad');
    expect(a.payeeCount).toBeGreaterThanOrEqual(3);
    const enviado = assessRuleTerm({ pattern: 'enviado' }, memos);
    expect(enviado.reasons.join(' ')).toMatch(/5 lançamento\(s\) de 4 favorecidos diferentes/);
  });

  it('regex não é julgado por palavras (só pela abrangência)', () => {
    expect(assessRuleTerm({ pattern: 'wms|sendas', matchType: 'REGEX' }, memos).level).toBe('ok');
  });
});
