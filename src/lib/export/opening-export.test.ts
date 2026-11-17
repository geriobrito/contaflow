import { describe, expect, it } from 'vitest';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { buildOpeningSheet } from '@/lib/opening-view';
import { openingPlug, summarizeOpening } from '@/lib/opening';
import { generateOpeningExcel, generateOpeningPdf, openingReportRows } from '@/lib/export/opening-export';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;

const amounts = new Map<string, number>([
  [acc('1.1.2.01').id, 2000],
  [acc('1.2.3.04').id, 60000],
  [acc('1.2.3.07').id, 14000],
  [acc('2.1.2.01').id, 1500],
  [acc('2.3.1.01').id, 10000],
]);
const entries = [...amounts].map(([accountId, amount]) => ({ accountId, amount }));
const plug = openingPlug(summarizeOpening(entries, chart, []));
const sheet = buildOpeningSheet({ accounts: chart, banks: [], amounts, plug });

describe('relatório do balanço de abertura', () => {
  const rows = openingReportRows(sheet);

  it('só o que tem saldo, com seções, grupos, contas e o total de cada coluna', () => {
    const accountsIn = (list: typeof rows.assets) => list.filter((r) => r.kind === 'account').map((r) => [r.code, r.value]);
    expect(accountsIn(rows.assets)).toEqual([
      ['1.1.2.01', 2000],
      ['1.2.3.04', 60000],
      // Retificadora reduz a coluna.
      ['1.2.3.07', -14000],
    ]);
    expect(rows.assets.at(-1)).toEqual({ kind: 'total', label: 'TOTAL DO ATIVO', value: 48000 });
    expect(rows.assets.filter((r) => r.kind === 'section').map((r) => r.value)).toEqual([2000, 46000]);
    // Contrapartida automática entra no PL e fecha o balanço.
    expect(accountsIn(rows.claims)).toContainEqual(['2.3.3.04', 36500]);
    expect(rows.claims.at(-1)?.value).toBe(48000);
  });

  it('gera PDF e Excel com a composição dos saldos', async () => {
    const ctx = {
      client: { name: 'Aurora Alimentos Ltda', cnpj: '11.222.333/0001-81', tradeName: 'Padaria Aurora' },
      date: '2026-03-01',
      mode: 'OPENING_BALANCE' as const,
      rows,
      composition: [{ code: '1.1.2.01', name: 'Clientes', amount: 2000, detail: 'Mercado X: 1.200,00\nPadaria Y: 800,00' }],
      issuedAt: new Date(2026, 2, 5),
      signatories: { legalRepresentative: { name: 'Ana', cpf: '529.982.247-25' }, accountant: { name: 'Rogério', crc: 'PE-000000/O' } },
    };
    const pdf = generateOpeningPdf(ctx);
    expect(pdf.fileName).toBe('Balanco_de_Abertura_Padaria_Aurora_2026-03-01.pdf');
    expect(pdf.blob.size).toBeGreaterThan(1000);
    const xlsx = await generateOpeningExcel(ctx);
    expect(xlsx.fileName).toBe('Balanco_de_Abertura_Padaria_Aurora_2026-03-01.xlsx');
    expect(xlsx.blob.size).toBeGreaterThan(1000);
  });
});
