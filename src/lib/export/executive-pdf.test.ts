import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildExecutiveSummary } from '@/lib/executive-metrics';
import { executiveInsights } from '@/lib/executive-insights';
import { compactMoney, generateExecutivePdf, niceScale } from '@/lib/export/executive-pdf';

const chart = buildITG1000Chart('c');
const idByCode = (code: string) => chart.find((a) => a.code === code)!.id;
let seq = 0;
const tx = (date: string, amount: number, code: string): BankTransaction => ({
  id: `tx_${++seq}`,
  clientId: 'c',
  fitid: `f_${seq}`,
  date,
  amount,
  type: amount >= 0 ? 'CREDIT' : 'DEBIT',
  memo: 'Lançamento teste',
  accountId: idByCode(code),
  status: 'RECONCILED',
  createdAt: '',
});

describe('relatório executivo em PDF', () => {
  it('escala do eixo: passo redondo, cerca de quatro divisões e sempre com o zero', () => {
    expect(niceScale(0, 16500)).toEqual({ bottom: 0, top: 20000, step: 5000, ticks: [0, 5000, 10000, 15000, 20000] });
    expect(niceScale(-11016, 38170)).toMatchObject({ bottom: -20000, top: 40000, step: 20000 });
    expect(niceScale(0, 0).ticks[0]).toBe(0);
    // Só valores positivos: o piso é zero, não o menor valor.
    expect(niceScale(900, 1200).bottom).toBe(0);
  });

  it('valores curtos para eixos e rótulos', () => {
    expect([compactMoney(950), compactMoney(12500), compactMoney(-1_250_000)].map((t) => t.replace(/ /g, ' '))).toEqual(['R$ 950', 'R$ 12,5 mil', '-R$ 1,3 mi']);
  });

  it('gera o PDF com os gráficos e as tabelas, inclusive com mês de prejuízo e sem movimento', async () => {
    const summary = buildExecutiveSummary({
      transactions: [tx('2025-01-10', 12000, '3.1.1.01'), tx('2025-01-20', -4000, '3.2.1.01'), tx('2025-02-10', 3000, '3.1.1.01'), tx('2025-02-20', -5000, '3.3.2.01')],
      accounts: chart,
      referenceDate: '2025-06-15',
    });
    const { blob, fileName } = generateExecutivePdf({ client: { name: 'Aurora Alimentos Ltda', tradeName: 'Padaria Aurora', cnpj: '11222333000181' }, summary, insights: executiveInsights(summary) });
    expect(fileName).toBe('Relatorio_Executivo_Padaria_Aurora_jul-24_a_jun-25.pdf');
    expect(blob.type).toBe('application/pdf');
    const text = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    // Duas páginas: indicadores e gráficos; tabelas.
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);

    const empty = buildExecutiveSummary({ transactions: [], accounts: chart, referenceDate: '2025-06-15' });
    expect(generateExecutivePdf({ client: { name: 'Vazia Ltda', cnpj: '' }, summary: empty, insights: [] }).blob.size).toBeGreaterThan(1000);
  });
});
