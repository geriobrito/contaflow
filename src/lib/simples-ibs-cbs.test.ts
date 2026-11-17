import { describe, expect, it } from 'vitest';
import type { InvoiceSummary } from '@/types/firestore';
import { simplesFigures, simulateSimplesIbsCbs } from '@/lib/simples-ibs-cbs';

let n = 0;
const inv = (over: Partial<InvoiceSummary>): InvoiceSummary => ({
  id: `i${++n}`,
  clientId: 'c',
  key: String(n).padStart(44, '0'),
  number: String(n),
  series: '1',
  model: '55',
  issueDate: '2027-03-10',
  direction: 'SALE',
  counterpartyDoc: '',
  counterpartyName: '',
  total: 0,
  cfops: [],
  installments: [],
  status: 'AUTHORIZED',
  importedAt: '',
  ...over,
});

const invoices: InvoiceSummary[] = [
  // Vendas: 60.000 a empresas (CNPJ) e 40.000 a pessoa física ou consumidor sem identificação.
  inv({ total: 50000, counterpartyDoc: '11222333000181', simplesTax: { base: 50000, ibs: 500, cbs: 1250 } }),
  inv({ total: 10000, counterpartyDoc: '11.444.777/0001-61' }),
  inv({ total: 30000, counterpartyDoc: '52998224725' }),
  inv({ total: 10000 }),
  // NFS-e de venda: receita é o serviço (vServ), não o líquido de retenções; e cancelada não conta.
  inv({ model: 'NFSE', total: 900, altTotal: 1000, counterpartyDoc: '52998224725' }),
  inv({ total: 5000, status: 'CANCELLED', counterpartyDoc: '11222333000181' }),
  // Compras: 2.600 de IBS/CBS, 600 deles em classificação sem crédito.
  inv({
    direction: 'PURCHASE',
    total: 20000,
    ibs: 200,
    cbs: 1800,
    ibsCbsItems: [{ cClassTrib: '000001', cst: '000', base: 20000, ibs: 200, cbs: 1800 }],
  }),
  inv({ direction: 'PURCHASE', total: 6000, ibs: 60, cbs: 540, ibsCbsItems: [{ cClassTrib: '200001', cst: '200', ibs: 60, cbs: 540 }] }),
  // Compra sem destaque: não entra.
  inv({ direction: 'PURCHASE', total: 3000 }),
];

describe('números do período pelas notas', () => {
  const f = simplesFigures(invoices);

  it('vendas por tipo de cliente', () => {
    expect(f.sales).toEqual({ count: 5, totalCents: 10_100_000, businessCount: 2, businessCents: 6_000_000, consumerCents: 4_100_000 });
  });

  it('crédito das compras pela classificação tributária', () => {
    expect(f.purchases).toEqual({ count: 2, taxCents: 260_000, blockedCents: 60_000, creditCents: 200_000 });
  });

  it('alíquotas observadas nas próprias notas', () => {
    // 1.750 de IBS/CBS do Simples sobre 50.000: 3,5%.
    expect(f.observedSimplesRate).toEqual({ rate: 3.5, invoices: 1, baseCents: 5_000_000 });
    // 2.000 sobre 20.000 nas compras de tributação integral: 10%.
    expect(f.observedFullRate).toEqual({ rate: 10, invoices: 1, baseCents: 2_000_000 });
  });

  it('sem notas, nada observado', () => {
    expect(simplesFigures([])).toMatchObject({ observedSimplesRate: null, observedFullRate: null, sales: { totalCents: 0 } });
  });
});

describe('dentro do DAS × por fora', () => {
  const f = simplesFigures(invoices);

  it('compara o imposto da empresa e o crédito dos clientes empresa', () => {
    const s = simulateSimplesIbsCbs(f, 3.5, 10);
    // Dentro: 3,5% de 101.000; clientes empresa aproveitam 3,5% de 60.000.
    expect(s.inside).toEqual({ taxCents: 353_500, buyersCreditCents: 210_000 });
    // Por fora: 10% de 101.000 menos 2.000 de crédito das compras; clientes aproveitam 10% de 60.000.
    expect(s.outside).toEqual({ debitCents: 1_010_000, purchaseCreditCents: 200_000, creditBalanceCents: 0, taxCents: 810_000, buyersCreditCents: 600_000 });
    expect(s.extraTaxCents).toBe(456_500);
    expect(s.extraBuyersCreditCents).toBe(390_000);
    expect(s.netIfPricedCents).toBe(-66_500);
    // 4.565 / (101.000 × 6,5%) ≈ 69,5% das vendas a empresas para empatar.
    expect(s.breakEven.kind).toBe('share');
    if (s.breakEven.kind === 'share') expect(s.breakEven.share).toBeCloseTo(0.6953, 3);
  });

  it('crédito das compras maior que o débito vira saldo credor; por fora sai mais barato', () => {
    const big = { ...f, purchases: { ...f.purchases, creditCents: 2_000_000 } };
    const s = simulateSimplesIbsCbs(big, 3.5, 10);
    expect(s.outside).toMatchObject({ taxCents: 0, purchaseCreditCents: 1_010_000, creditBalanceCents: 990_000 });
    expect(s.breakEven).toEqual({ kind: 'always' });
  });

  it('sem crédito de compras, só empata com todas as vendas a empresas', () => {
    const consumer = { ...f, sales: { ...f.sales, businessCents: 0 }, purchases: { ...f.purchases, creditCents: 0 } };
    const s = simulateSimplesIbsCbs(consumer, 9.5, 10);
    expect(s.breakEven).toEqual({ kind: 'share', share: 1 });
    expect(s.extraBuyersCreditCents).toBe(0);
    expect(s.netIfPricedCents).toBe(-s.extraTaxCents);
  });

  it('alíquota do Simples acima da cheia: por fora não custa mais', () => {
    expect(simulateSimplesIbsCbs(f, 10.5, 10).breakEven).toEqual({ kind: 'always' });
  });
});

describe('IBS/CBS do Simples no XML e relatório', () => {
  it('soma vRBSNitem, vIBSSN e vCBSSN dos itens da nota de venda', async () => {
    const { parseNFeXml } = await import('@/lib/nfe/parser');
    const key = '35270311222333000181550010000000091000000091';
    const det = (i: number, base: string, ibs: string, cbs: string) =>
      `<det nItem="${i}"><prod><CFOP>5102</CFOP><vProd>${base}</vProd></prod><imposto><gIBSCBSSN><vRBSNitem>${base}</vRBSNitem><pIBSSN>1.00</pIBSSN><vIBSSN>${ibs}</vIBSSN><pCBSSN>2.50</pCBSSN><vCBSSN>${cbs}</vCBSSN></gIBSCBSSN></imposto></det>`;
    const xml = `<nfeProc><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><serie>1</serie><nNF>9</nNF><dhEmi>2027-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>11222333000181</CNPJ><xNome>EMPRESA DO SIMPLES</xNome></emit><dest><CNPJ>44555666000181</CNPJ><xNome>CLIENTE</xNome></dest>${det(1, '1000.00', '10.00', '25.00')}${det(2, '500.00', '5.00', '12.50')}<total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const r = parseNFeXml(xml);
    expect(r.kind === 'invoice' && r.invoice.simplesTax).toEqual({ base: 1500, ibs: 15, cbs: 37.5 });
  });

  it('gera o PDF com a comparação e a conclusão', async () => {
    const { generateSimplesIbsCbsPdf, simplesIbsCbsRows } = await import('@/lib/export/simples-ibs-cbs-pdf');
    const { SIMPLES_SIMULATION_NOTES, simplesConclusion } = await import('@/lib/simples-ibs-cbs');
    const figures = simplesFigures(invoices);
    const simulation = simulateSimplesIbsCbs(figures, 3.5, 10);
    const ctx = {
      client: { name: 'Aurora Alimentos Ltda', cnpj: '11.222.333/0001-81', tradeName: 'Padaria Aurora' },
      periodLabel: 'Período: 01/01/2027 a 31/12/2027',
      figures,
      simulation,
      simplesRate: 3.5,
      fullRate: 10,
      simplesRateSource: 'observada em 1 nota(s) de venda',
      fullRateSource: 'informada pelo contador',
      conclusion: simplesConclusion(figures, simulation),
      notes: SIMPLES_SIMULATION_NOTES,
    };
    expect(simplesIbsCbsRows(ctx).find((r) => r.label === 'IBS + CBS pagos pela empresa')).toMatchObject({ outside: expect.stringContaining('8.100,00') });
    expect(ctx.conclusion).toMatch(/passam de 69,5% do total; no período elas foram 59,4%: dentro do DAS tende a sair mais barato\./);
    const file = generateSimplesIbsCbsPdf(ctx);
    expect(file.fileName).toBe('IBS_CBS_Simples_Padaria_Aurora.pdf');
    expect(file.blob.size).toBeGreaterThan(1000);
  });
});
