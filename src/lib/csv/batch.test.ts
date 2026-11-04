import { describe, expect, it } from 'vitest';
import type { BankAccount, CSVColumnMapping } from '@/types/firestore';
import { applyFormatToQueue, csvColumnOptions, quickBankAccount, simulateCSVImport, withCSVPreset, type CSVFormat } from '@/lib/csv/batch';
import { previewCSV } from '@/lib/csv/parser';

const NUBANK = 'Data,Valor,Identificador,Descrição\n10/03/2025,-120.50,abc-1,Pix enviado\n11/03/2025,300.00,abc-2,Pix recebido';
const NUBANK_APRIL = 'Data,Valor,Identificador,Descrição\n10/04/2025,-80.00,abc-3,Tarifa';
const OTHER_LAYOUT = 'Quando;Quanto\n01/05/2025;10,00';

const format = (): CSVFormat => {
  const p = previewCSV(NUBANK);
  return { mapping: p.guessedMapping, delimiter: p.delimiter };
};
const info = { accountId: 'nubank', org: 'Extrato CSV' };

describe('simulação do arquivo', () => {
  it('conta os lançamentos com o formato escolhido', () => {
    const sim = simulateCSVImport(NUBANK, format(), 'c', 'nubank');
    expect(sim.count).toBe(2);
    expect(sim.res?.transactions.map((t) => t.amount)).toEqual([-120.5, 300]);
  });

  it('mapeamento fora das colunas não quebra a tela: zero lançamentos', () => {
    const mapping = { ...format().mapping, amountCol: 9 } as CSVColumnMapping;
    const sim = simulateCSVImport(NUBANK, { ...format(), mapping }, 'c', 'nubank');
    expect(sim.count).toBe(0);
  });

  it('opções das colunas', () => {
    expect(csvColumnOptions(['Data', ''])).toEqual([
      { index: 0, label: '[Col 1] Data' },
      { index: 1, label: '[Col 2] Coluna 2' },
    ]);
  });
});

describe('contas', () => {
  const now = '2025-03-01T00:00:00.000Z';

  it('memoriza o formato e a assinatura do cabeçalho', () => {
    const bank = { id: 'c_x', clientId: 'c', accountKey: 'x', nickname: 'X', createdAt: '', updatedAt: '' } as BankAccount;
    const saved = withCSVPreset(bank, format(), ['Data', 'Valor'], now);
    expect(saved.updatedAt).toBe(now);
    expect(saved.csvPreset?.headerSignature).toHaveLength(2);
    expect(withCSVPreset(bank, format(), [], now).csvPreset).not.toHaveProperty('headerSignature');
  });

  it('cria conta ou cartão com chave única e o vínculo contábil', () => {
    const card = quickBankAccount({
      clientId: 'c',
      nickname: 'Cartão Nubank',
      kind: 'CARD',
      ledger: { id: 'l1', code: '2.1.1.05', name: 'Cartões a pagar' },
      existingKeys: new Set(),
      now,
    });
    expect(card).toMatchObject({ clientId: 'c', kind: 'CARD', nickname: 'Cartão Nubank', ledgerAccountId: 'l1', ledgerAccountCode: '2.1.1.05', createdAt: now });
    expect(card.id).toBe(`c_${card.accountKey}`);
    const again = quickBankAccount({ clientId: 'c', nickname: 'Cartão Nubank', kind: 'CARD', existingKeys: new Set([card.accountKey]), now });
    expect(again.accountKey).not.toBe(card.accountKey);
    expect(again).not.toHaveProperty('ledgerAccountId');
  });
});

describe('fila de arquivos', () => {
  const queue = [
    { fileName: 'mar.csv', content: NUBANK },
    { fileName: 'abr.csv', content: NUBANK_APRIL },
    { fileName: 'outro.csv', content: OTHER_LAYOUT },
    { fileName: 'mai.csv', content: NUBANK_APRIL },
  ];
  const headers = previewCSV(NUBANK).headers;

  it('aplica o formato aos próximos de mesmo layout e para no primeiro diferente', () => {
    const r = applyFormatToQueue({ queue, from: 1, format: format(), headers, clientId: 'c', accountKey: 'nubank', accountInfo: info });
    expect(r.items.map((i) => i.fileName)).toEqual(['abr.csv']);
    expect(r.items[0].result.account).toEqual(info);
    expect(r.stopAt).toBe(2);
  });

  it('fila inteira compatível: sem parada', () => {
    const r = applyFormatToQueue({ queue: queue.slice(0, 2), from: 1, format: format(), headers, clientId: 'c', accountKey: 'nubank', accountInfo: info });
    expect(r).toMatchObject({ stopAt: null });
    expect(r.items).toHaveLength(1);
  });

  it('arquivo de mesmo layout sem lançamentos também para a fila', () => {
    const empty = [{ fileName: 'vazio.csv', content: 'Data,Valor,Identificador,Descrição\n' }];
    const r = applyFormatToQueue({ queue: empty, from: 0, format: format(), headers, clientId: 'c', accountKey: 'nubank', accountInfo: info });
    expect(r).toEqual({ items: [], stopAt: 0 });
  });
});
