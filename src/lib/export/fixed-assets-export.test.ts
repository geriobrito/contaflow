import { describe, expect, it } from 'vitest';
import type { FixedAsset } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { fixedAssetReportRows, generateFixedAssetsExcel, generateFixedAssetsPdf } from '@/lib/export/fixed-assets-export';

const chart = buildITG1000Chart('c');
const acc = (code: string) => chart.find((a) => a.code === code)!;
const asset = (id: string, code: string, over: Partial<FixedAsset> = {}): FixedAsset => ({
  id,
  description: `Bem ${id}`,
  accountId: acc(code).id,
  accountCode: code,
  accountName: acc(code).name,
  use: 'EXPENSE',
  acquisitionDate: '2026-03-01',
  inUseDate: '2026-03-01',
  invoiceValue: 12000,
  annualRate: 20,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('relatório analítico do imobilizado', () => {
  const assets = [
    asset('a', '1.2.3.04', { invoiceValue: 72280 }),
    asset('b', '1.2.3.06', { documentRef: '123' }),
    asset('c', '1.2.3.06', { disposal: { date: '2026-03-20', reason: 'SALE', journalEntryId: 'j' } }),
    asset('d', '1.2.3.05', { acquisitionDate: '2026-05-01', inUseDate: '2026-05-01' }),
  ];

  it('bens no balanço por conta, com subtotal e total; baixados e futuros ficam de fora', () => {
    const rows = fixedAssetReportRows(assets, '2026-04', null, chart);
    expect(rows.map((r) => [r.kind, r.label, r.cost, r.quota, r.accumulated])).toEqual([
      ['asset', 'Bem a', 72280, 1204.67, 2409.34],
      ['subtotal', '1.2.3.04 Veículos', 72280, 1204.67, 2409.34],
      ['asset', 'Bem b', 12000, 200, 400],
      ['subtotal', '1.2.3.06 Equipamentos de Informática', 12000, 200, 400],
      ['total', 'Total', 84280, 1404.67, 2809.34],
    ]);
    expect(rows[4].net).toBe(81470.66);
  });

  it('gera PDF e Excel', async () => {
    const ctx = { client: { name: 'ALPHA LTDA', cnpj: '11222333000181' }, rows: fixedAssetReportRows(assets, '2026-04', null, chart), month: '2026-04' };
    expect(generateFixedAssetsPdf(ctx).fileName).toBe('Imobilizado_ALPHA_LTDA_2026-04-30.pdf');
    const xlsx = await generateFixedAssetsExcel(ctx);
    expect(xlsx.fileName).toBe('Imobilizado_ALPHA_LTDA_2026-04-30.xlsx');
    expect(xlsx.blob.size).toBeGreaterThan(0);
  });
});
