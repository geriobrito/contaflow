import { describe, expect, it } from 'vitest';
import { assertValidJournalEntry, JOURNAL_TEMPLATES, journalEntryProblem, journalTotals, MAX_JOURNAL_LINES, parseAttachmentUrl, previousMonth, repeatCandidates, repeatDraft, sameDayIn, shiftCompetence, templateDraft } from '@/lib/journal';
import { journalOrigin, resultEffect, reversalDraft, reversalProblem, reversalsByOriginal } from '@/lib/journal-origin';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import type { JournalEntry, JournalEntryLine } from '@/types/firestore';

const line = (type: 'DEBIT' | 'CREDIT', amount: number, accountId = 'acc'): JournalEntryLine => ({
  id: `${type}-${amount}-${Math.random()}`,
  accountId,
  type,
  amount,
});

const entry = (lines: JournalEntryLine[], date = '2025-03-31') => ({ date, lines });

describe('lançamentos manuais: partidas dobradas', () => {
  it('soma em centavos (sem erro de ponto flutuante)', () => {
    expect(journalTotals([line('DEBIT', 0.1), line('DEBIT', 0.2), line('CREDIT', 0.3)])).toEqual({ debit: 0.3, credit: 0.3, difference: 0 });
  });

  it('aceita lançamento equilibrado, simples ou composto', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 100), line('CREDIT', 100)]))).toBeNull();
    expect(journalEntryProblem(entry([line('DEBIT', 0.1), line('DEBIT', 0.2), line('CREDIT', 0.3)]))).toBeNull();
  });

  it('recusa débito diferente de crédito', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 100), line('CREDIT', 99.99)]))).toMatch(/desbalanceado em R\$ 0,01/);
    expect(journalEntryProblem(entry([line('DEBIT', 100), line('DEBIT', 100)]))).toMatch(/desbalanceado/);
    expect(() => assertValidJournalEntry(entry([line('DEBIT', 100), line('CREDIT', 50)]))).toThrow(/desbalanceado/);
  });

  it('recusa partida sem conta, com valor não positivo ou tipo desconhecido', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 100, ''), line('CREDIT', 100)]))).toMatch(/linha #1 está sem conta/);
    expect(journalEntryProblem(entry([line('DEBIT', 0), line('CREDIT', 0)]))).toMatch(/valor zerado/);
    expect(journalEntryProblem(entry([line('DEBIT', -5), line('CREDIT', -5)]))).toMatch(/valor zerado/);
    expect(journalEntryProblem(entry([line('DEBIT', Number.NaN), line('CREDIT', 1)]))).toMatch(/valor zerado/);
    expect(journalEntryProblem(entry([{ ...line('DEBIT', 5), type: 'X' as never }, line('CREDIT', 5)]))).toMatch(/não é débito nem crédito/);
  });

  it('exige de 2 partidas até o teto das regras, e data válida', () => {
    expect(journalEntryProblem(entry([line('DEBIT', 1)]))).toMatch(/pelo menos 2/);
    const many = Array.from({ length: MAX_JOURNAL_LINES / 2 }, () => [line('DEBIT', 1), line('CREDIT', 1)]).flat();
    expect(journalEntryProblem(entry(many))).toBeNull();
    expect(journalEntryProblem(entry([...many, line('DEBIT', 1), line('CREDIT', 1)]))).toMatch(new RegExp(`no máximo ${MAX_JOURNAL_LINES}`));
    expect(journalEntryProblem(entry([line('DEBIT', 1), line('CREDIT', 1)], '2025-3-1'))).toMatch(/data válida/);
  });
});

describe('comprovante do lançamento (link)', () => {
  it('aceita links http/https e completa o https:// quando falta', () => {
    expect(parseAttachmentUrl('  https://drive.google.com/file/d/abc/view  ')).toEqual({ url: 'https://drive.google.com/file/d/abc/view', host: 'drive.google.com' });
    expect(parseAttachmentUrl('www.dropbox.com/s/xyz/folha.pdf')).toEqual({ url: 'https://www.dropbox.com/s/xyz/folha.pdf', host: 'dropbox.com' });
    expect(parseAttachmentUrl('')).toBeNull();
    expect(parseAttachmentUrl('   ')).toBeNull();
  });

  it('recusa caminho do computador, nome de arquivo e esquemas que não são de documento', () => {
    for (const bad of [String.raw`C:\Users\Contador\folha.pdf`, String.raw`\\servidor\pasta\folha.pdf`, '/home/contador/folha.pdf', 'file:///C:/folha.pdf']) {
      expect(parseAttachmentUrl(bad)).toMatchObject({ problem: expect.stringMatching(/caminho do computador/) });
    }
    expect(parseAttachmentUrl('folha-maio.pdf')).toMatchObject({ problem: expect.stringMatching(/nome de um arquivo/) });
    expect(parseAttachmentUrl('javascript:alert(1)')).toMatchObject({ problem: expect.stringMatching(/https/) });
    expect(parseAttachmentUrl('data:text/html,<b>x</b>')).toMatchObject({ problem: expect.stringMatching(/https/) });
    expect(parseAttachmentUrl('comprovante')).toMatchObject({ problem: expect.stringMatching(/inválido/) });
    expect(parseAttachmentUrl(`https://exemplo.com/${'a'.repeat(2000)}`)).toMatchObject({ problem: expect.stringMatching(/longo/) });
  });
});

describe('repetir lançamentos do mês anterior', () => {
  const accounts = [
    { id: 'despesa', nature: 'ANALYTIC' },
    { id: 'passivo', nature: 'ANALYTIC' },
    { id: 'grupo', nature: 'SYNTHETIC' },
  ];
  const manual = (id: string, date: string, extra: Partial<JournalEntry> = {}): JournalEntry => ({
    id,
    clientId: 'c1',
    entryNumber: Number(id.replace(/\D/g, '')) || 1,
    date,
    memo: `Provisão de Folha de Pagamento - Competência ${date.slice(0, 7)}`,
    category: 'PAYROLL',
    lines: [
      { id: 'l1', accountId: 'despesa', accountCode: '4.1', accountName: 'Salários', type: 'DEBIT', amount: 1500.5, memo: 'Salários de abril/2025' },
      { id: 'l2', accountId: 'passivo', accountCode: '2.1', accountName: 'Salários a pagar', type: 'CREDIT', amount: 1500.5 },
    ],
    totalAmount: 1500.5,
    documentRef: `FOLHA-${date.slice(0, 7)}`,
    attachmentUrl: 'https://drive.google.com/folha-abril',
    createdAt: 'T',
    updatedAt: 'T',
    createdByUid: 'u',
    ...extra,
  });

  it('competência anterior e mesmo dia do mês, limitado ao último dia', () => {
    expect(previousMonth('2025-05')).toBe('2025-04');
    expect(previousMonth('2025-01')).toBe('2024-12');
    expect(sameDayIn('2025-01-31', '2025-02')).toBe('2025-02-28');
    expect(sameDayIn('2024-01-31', '2024-02')).toBe('2024-02-29');
    expect(sameDayIn('2025-04-30', '2025-05')).toBe('2025-05-30');
    expect(sameDayIn('2025-04-05', '2025-05')).toBe('2025-05-05');
  });

  it('atualiza a competência citada no histórico e no documento, em todos os formatos', () => {
    const shift = (text: string) => shiftCompetence(text, '2025-04', '2025-05');
    expect(shift('Provisão - Competência 2025-04')).toBe('Provisão - Competência 2025-05');
    expect(shift('DAS 04/2025 e FOLHA-04-2025')).toBe('DAS 05/2025 e FOLHA-05-2025');
    expect(shift('Salários de abril/2025, Abril de 2025 e ABRIL / 2025')).toBe('Salários de maio/2025, Maio de 2025 e MAIO / 2025');
    // Outras datas e números parecidos ficam como estão.
    expect(shift('NF 104/20251 de 03/2025, vencimento 2025-06')).toBe('NF 104/20251 de 03/2025, vencimento 2025-06');
    expect(shiftCompetence('Depreciação dezembro/2024 (12/2024)', '2024-12', '2025-01')).toBe('Depreciação janeiro/2025 (01/2025)');
  });

  it('oferece os lançamentos do mês anterior ainda não repetidos, marcando os recorrentes', () => {
    const entries = [
      manual('j1', '2025-04-30'),
      manual('j2', '2025-04-15', { category: 'ADJUSTMENT' }),
      manual('j3', '2025-04-10', { category: 'OTHER', repeatedFromId: 'j0' }),
      manual('j4', '2025-04-20', { lines: [{ id: 'l1', accountId: 'grupo', accountCode: '4', accountName: 'Despesas', type: 'DEBIT', amount: 10 }, { id: 'l2', accountId: 'passivo', type: 'CREDIT', amount: 10 }] }),
      manual('j5', '2025-03-31'),
      manual('j6', '2025-05-02'),
    ];
    const list = repeatCandidates(entries, '2025-05', accounts);
    expect(list.map((c) => [c.entry.id, c.suggested, c.problem])).toEqual([
      ['j3', true, null],
      ['j2', false, null],
      ['j4', false, 'A conta 4 Despesas não aceita mais lançamentos.'],
      ['j1', true, null],
    ]);
    // Depois de repetido, o lançamento não é oferecido de novo — mesmo que a cópia tenha sido editada.
    const repeated = manual('j7', '2025-05-30', { repeatedFromId: 'j1', totalAmount: 1600 });
    expect(repeatCandidates([...entries, repeated], '2025-05', accounts).map((c) => c.entry.id)).toEqual(['j3', 'j2', 'j4']);
    expect(repeatCandidates(entries, '2025-07', accounts)).toEqual([]);
  });

  it('a cópia mantém partidas e valores, troca a competência e não leva o comprovante', () => {
    const draft = repeatDraft(manual('j1', '2025-04-30'), '2025-05');
    expect(draft).toEqual({
      clientId: 'c1',
      date: '2025-05-30',
      memo: 'Provisão de Folha de Pagamento - Competência 2025-05',
      category: 'PAYROLL',
      lines: [
        { id: 'l1', accountId: 'despesa', accountCode: '4.1', accountName: 'Salários', type: 'DEBIT', amount: 1500.5, memo: 'Salários de maio/2025' },
        { id: 'l2', accountId: 'passivo', accountCode: '2.1', accountName: 'Salários a pagar', type: 'CREDIT', amount: 1500.5 },
      ],
      totalAmount: 1500.5,
      documentRef: 'FOLHA-2025-05',
      repeatedFromId: 'j1',
    });
    expect(journalEntryProblem(draft)).toBeNull();
  });
});

describe('modelos de provisão mensal', () => {
  const chart = buildITG1000Chart('c', 'x');
  const tpl = (id: string) => JOURNAL_TEMPLATES.find((t) => t.id === id)!;
  const codes = (lines: readonly JournalEntryLine[]) => lines.map((l) => [l.accountCode, l.type, l.amount]);

  it('todas as contas dos modelos estão no modelo de plano de contas como analíticas', () => {
    const analytic = new Set(chart.filter((a) => a.nature === 'ANALYTIC').map((a) => a.code));
    for (const t of JOURNAL_TEMPLATES) for (const l of t.lines) expect(analytic.has(l.code), `${t.id} ${l.code}`).toBe(true);
  });

  it('folha: bruto, descontos dos empregados e encargos; partidas zeradas saem', () => {
    const { draft, problem } = templateDraft(tpl('PAYROLL'), { gross: 5000, inss: 450, irrf: 120.35, fgts: 400 }, chart, '2026-03-31');
    expect(problem).toBeNull();
    expect(codes(draft!.lines)).toEqual([
      ['3.3.2.01', 'DEBIT', 5000],
      ['2.1.1.01', 'CREDIT', 4429.65],
      ['2.1.1.03', 'CREDIT', 450],
      ['2.1.5.04', 'CREDIT', 120.35],
      ['3.3.2.03', 'DEBIT', 400],
      ['2.1.1.04', 'CREDIT', 400],
    ]);
    expect(draft).toMatchObject({ category: 'PAYROLL', totalAmount: 5400, memo: 'Provisão da folha de pagamento - competência 03/2026', documentRef: 'FOLHA-2026-03' });
    expect(journalEntryProblem(draft!)).toBeNull();
  });

  it('pró-labore, DAS, depreciação e faturamento a prazo', () => {
    expect(codes(templateDraft(tpl('PRO_LABORE'), { gross: 3000, inss: 330 }, chart, '2026-03-31').draft!.lines)).toEqual([
      ['3.3.2.02', 'DEBIT', 3000],
      ['2.1.1.02', 'CREDIT', 2670],
      ['2.1.1.03', 'CREDIT', 330],
    ]);
    expect(codes(templateDraft(tpl('DAS'), { amount: 812.4 }, chart, '2026-03-31').draft!.lines)).toEqual([
      ['3.1.2.01', 'DEBIT', 812.4],
      ['2.1.5.01', 'CREDIT', 812.4],
    ]);
    expect(codes(templateDraft(tpl('DEPRECIATION'), { amount: 150 }, chart, '2026-03-31').draft!.lines)).toEqual([
      ['3.3.2.15', 'DEBIT', 150],
      ['1.2.3.07', 'CREDIT', 150],
    ]);
    expect(codes(templateDraft(tpl('CREDIT_SALES'), { services: 2000, goods: 500 }, chart, '2026-03-31').draft!.lines)).toEqual([
      ['1.1.2.01', 'DEBIT', 2500],
      ['3.1.1.01', 'CREDIT', 2000],
      ['3.1.1.02', 'CREDIT', 500],
    ]);
  });

  it('recusa campo obrigatório vazio, descontos maiores que o bruto e conta fora do plano', () => {
    expect(templateDraft(tpl('DAS'), {}, chart, '2026-03-31').problem).toMatch(/valor do das/i);
    expect(templateDraft(tpl('PRO_LABORE'), { gross: 100, inss: 150 }, chart, '2026-03-31').problem).toMatch(/negativo/);
    expect(templateDraft(tpl('CREDIT_SALES'), {}, chart, '2026-03-31').problem).not.toBeNull();
    const semDepreciacao = chart.filter((a) => a.code !== '1.2.3.07');
    expect(templateDraft(tpl('DEPRECIATION'), { amount: 10 }, semDepreciacao, '2026-03-31').problem).toMatch(/1\.2\.3\.07/);
  });

  it('o lançamento do modelo se repete no mês seguinte com a competência atualizada', () => {
    const { draft } = templateDraft(tpl('DAS'), { amount: 812.4 }, chart, '2026-03-31');
    const entry: JournalEntry = { ...draft!, id: 'j1', clientId: 'c', entryNumber: 1, createdAt: 'T', updatedAt: 'T', createdByUid: 'u' };
    const copy = repeatDraft(entry, '2026-04');
    expect(copy).toMatchObject({ date: '2026-04-30', memo: 'Provisão do Simples Nacional (DAS) - competência 04/2026', documentRef: 'DAS-2026-04' });
    expect(repeatCandidates([entry], '2026-04', chart)[0].suggested).toBe(true);
  });
});

describe('origem, estorno e efeito no resultado', () => {
  const full = (over: Partial<JournalEntry>): JournalEntry => ({
    id: 'j1',
    clientId: 'c1',
    entryNumber: 7,
    date: '2026-03-31',
    memo: 'Provisão do DAS - competência 03/2026',
    category: 'TAX',
    lines: [
      { id: 'a', accountId: 'das', accountCode: '3.1.2.01', type: 'DEBIT', amount: 812.4 },
      { id: 'b', accountId: 'pagar', accountCode: '2.1.5.01', type: 'CREDIT', amount: 812.4 },
    ],
    totalAmount: 812.4,
    documentRef: 'DAS-2026-03',
    attachmentUrl: 'https://drive.example.com/das',
    createdAt: '',
    updatedAt: '',
    createdByUid: 'u1',
    ...over,
  });

  it('o manual não tem origem; o gerado aponta a tela dele, na competência do lançamento', () => {
    expect(journalOrigin(full({}))).toBeNull();
    expect(journalOrigin(full({ depreciationMonth: '2026-03' }))).toMatchObject({ label: 'Gerado pelo Imobilizado', href: '/imobilizado?mes=2026-03' });
    expect(journalOrigin(full({ fixedAssetId: 'b1' }))?.label).toBe('Baixa de bem · Imobilizado');
    expect(journalOrigin(full({ stockMonth: '2026-03' }))?.href).toBe('/estoque?mes=2026-03');
    expect(journalOrigin(full({ payrollMonth: '2026-03' }))?.href).toBe('/folha?mes=2026-03');
    expect(journalOrigin(full({ yearClosing: '2025' }))?.howToChange).toMatch(/encerramento do exercício de 2025/);
  });

  it('o estorno troca débito e crédito, cita o lançamento e não leva o comprovante', () => {
    const draft = reversalDraft(full({}), '2026-05-31');
    expect(draft).toMatchObject({ date: '2026-05-31', reversalOfId: 'j1', totalAmount: 812.4, category: 'TAX', documentRef: 'DAS-2026-03' });
    expect(draft.memo).toBe('Estorno do lançamento #7 de 31/03/2026: Provisão do DAS - competência 03/2026');
    expect(draft.lines.map((l) => [l.accountId, l.type, l.amount])).toEqual([
      ['das', 'CREDIT', 812.4],
      ['pagar', 'DEBIT', 812.4],
    ]);
    expect(journalEntryProblem(draft)).toBeNull();
    expect('attachmentUrl' in draft).toBe(false);
  });

  it('não estorna duas vezes nem o que é gerado por uma rotina', () => {
    const original = full({});
    const estorno = full({ id: 'j2', entryNumber: 9, date: '2026-05-31', reversalOfId: 'j1' });
    const reversedBy = reversalsByOriginal([original, estorno]);
    expect(reversedBy.get('j1')?.id).toBe('j2');
    expect(reversalProblem(original, reversedBy)).toMatch(/já foi estornado pelo #9, de 31\/05\/2026/);
    expect(reversalProblem(estorno, reversedBy)).toBeNull();
    expect(reversalProblem(full({ id: 'j3', investmentMonth: '2026-03' }), reversedBy)).toMatch(/Aplicações financeiras/);
  });

  it('efeito no resultado: créditos menos débitos nas contas de resultado, e o estorno anula', () => {
    const accounts = [
      { id: 'das', type: 'EXPENSE' as const },
      { id: 'pagar', type: 'LIABILITY' as const },
      { id: 'receita', type: 'REVENUE' as const },
    ];
    const original = full({});
    expect(resultEffect([original], accounts)).toBe(-812.4);
    expect(resultEffect([original, { ...original, ...reversalDraft(original, '2026-05-31'), id: 'j2' }], accounts)).toBe(0);
    const venda = full({
      id: 'j4',
      lines: [
        { id: 'a', accountId: 'pagar', type: 'DEBIT', amount: 100 },
        { id: 'b', accountId: 'receita', type: 'CREDIT', amount: 100 },
      ],
    });
    expect(resultEffect([venda], accounts)).toBe(100);
    expect(resultEffect([{ ...venda, yearClosing: '2026' }], accounts)).toBe(0);
  });
});
