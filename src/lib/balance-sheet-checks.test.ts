import { describe, expect, it } from 'vitest';
import { invertedBalances, missingShareCapital } from '@/lib/balance-sheet-checks';
import type { BalanceSheetLine } from '@/lib/ledger';

const line = (code: string, name: string, value: number, synthetic = false): BalanceSheetLine => ({ accountId: code || name, code, name, level: code.split('.').length, synthetic, value });

describe('invertedBalances', () => {
  it('aponta ativo credor e passivo exigível devedor, sem retificadoras, sintéticas nem PL', () => {
    const inverted = invertedBalances({
      assets: [
        line('1.1', 'ATIVO CIRCULANTE', -50, true),
        line('1.1.1.05', 'Nubank', -50),
        line('1.1.1.02', 'Banco do Brasil', 300),
        line('1.1.2.02', '(-) Perdas Estimadas com Créditos de Liquidação Duvidosa', -20),
        line('1.2.3.07', 'Depreciação Acumulada', -900),
        line('1.2.4.03', 'Amortização Acumulada', -100),
      ],
      liabilities: [
        line('2.1.5.01', 'Simples Nacional a Recolher', 120),
        line('2.2.2.02', 'Empréstimos de Sócios', -500),
        line('', 'Lançamentos a classificar', -10),
      ],
    });
    expect(inverted.map((i) => [i.line.code, i.side])).toEqual([
      ['1.1.1.05', 'ASSET'],
      ['2.2.2.02', 'LIABILITY'],
    ]);
  });

  it('nada a apontar com saldos na natureza', () => {
    expect(invertedBalances({ assets: [line('1.1.1.02', 'Banco', 10)], liabilities: [line('2.1.1.01', 'Fornecedores', 5)] })).toEqual([]);
  });
});

describe('missingShareCapital', () => {
  const assets = [line('1.1.1.02', 'Banco', 1000)];
  it('avisa quando há saldos e o capital social está zerado ou ausente', () => {
    expect(missingShareCapital({ assets, liabilities: [], equity: [line('', 'Resultado do exercício', 1000)] })).toBe(true);
    expect(missingShareCapital({ assets, liabilities: [], equity: [line('2.3.1', 'Capital Social', 0, true)] })).toBe(true);
  });
  it('não avisa com capital registrado nem em balanço vazio', () => {
    expect(missingShareCapital({ assets, liabilities: [], equity: [line('2.3.1', 'Capital Social', 1000, true)] })).toBe(false);
    expect(missingShareCapital({ assets: [], liabilities: [], equity: [] })).toBe(false);
  });
});
