import { describe, expect, it } from 'vitest';
import type { FixedAsset, InvoiceSummary } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { NBS_GROUPS, NCM_CHAPTERS } from '@/lib/nfe/nomenclature-table';
import { nbsLabel, ncmChapterLabel, productAccountSuggestion, serviceAccountSuggestion, soldHeadings } from '@/lib/nfe/nomenclature';
import { matchInvoices, suggestAccount } from '@/lib/nfe/match';
import { parseNFeXml } from '@/lib/nfe/parser';
import { unregisteredAssetInvoices } from '@/lib/fixed-assets';

const chart = buildITG1000Chart('c');
const code = (id: string | undefined) => chart.find((a) => a.id === id)?.code;

let n = 0;
const inv = (over: Partial<InvoiceSummary>): InvoiceSummary => ({
  id: `i${++n}`,
  clientId: 'c',
  key: String(n).padStart(44, '0'),
  number: String(n),
  series: '1',
  model: '55',
  issueDate: '2027-03-10',
  direction: 'PURCHASE',
  counterpartyDoc: '11444777000161',
  counterpartyName: 'FORNECEDOR',
  total: 5000,
  cfops: [{ cfop: '5102', amount: 5000 }],
  installments: [],
  status: 'AUTHORIZED',
  importedAt: '',
  ...over,
});

describe('tabelas de nomenclatura', () => {
  it('capítulos da NCM e grupos da NBS da base oficial', () => {
    expect(Object.keys(NCM_CHAPTERS).length).toBeGreaterThan(90);
    expect(Object.keys(NBS_GROUPS).length).toBeGreaterThan(100);
    expect(ncmChapterLabel('84713012')).toMatch(/^84 · .*máquinas/);
    expect(nbsLabel('115021000')).toMatch(/aplicativos e programas/);
    expect(nbsLabel('113011000')).toMatch(/^Serviços jurídicos$/);
  });
});

describe('conta pelo NCM da compra', () => {
  const sale = (ncm: string) => inv({ direction: 'SALE', ncms: [{ ncm, amount: 100 }] });

  it('a empresa vende a mesma posição: revenda', () => {
    const sold = soldHeadings([sale('84713019'), inv({ direction: 'SALE', status: 'CANCELLED', ncms: [{ ncm: '87032310', amount: 1 }] })]);
    expect([...sold]).toEqual(['8471']);
    expect(productAccountSuggestion(inv({ ncms: [{ ncm: '84713012', amount: 5000 }] }), sold)).toMatchObject({ code: '3.2.1.01', basis: 'ncm' });
  });

  it('não vende: informática, veículo, móveis e máquinas no imobilizado; abaixo de R$ 1.200, consumo', () => {
    const none = new Set<string>();
    const s = (ncm: string, amount = 5000) => productAccountSuggestion(inv({ ncms: [{ ncm, amount }] }), none);
    expect(s('84713012')).toMatchObject({ code: '1.2.3.06', reason: 'NCM 8471: equipamentos de informática e telecomunicação que a empresa não vende' });
    expect(s('87032310')?.code).toBe('1.2.3.04');
    expect(s('94033000')?.code).toBe('1.2.3.05');
    expect(s('84509090')?.code).toBe('1.2.3.03');
    expect(s('85444900', 300)).toMatchObject({ code: '3.3.2.10', reason: expect.stringMatching(/abaixo de R\$ 1\.200/) });
    expect(s('27101259')?.code).toBe('3.3.2.13');
    expect(s('48025610')?.code).toBe('3.3.2.10');
    // Alimento: sem regra, fica a do CFOP.
    expect(s('19052000')).toBeNull();
  });

  it('venda ou nota sem NCM: nada', () => {
    expect(productAccountSuggestion(inv({ direction: 'SALE', ncms: [{ ncm: '84713012', amount: 1 }] }), new Set())).toBeNull();
    expect(productAccountSuggestion(inv({}), new Set())).toBeNull();
  });
});

describe('conta pelo serviço da NFS-e de compra', () => {
  const nfse = (over: Partial<InvoiceSummary>) => inv({ model: 'NFSE', cfops: [], ...over });

  it('pelo NBS, do subgrupo para o grupo', () => {
    expect(serviceAccountSuggestion(nfse({ nbs: '115021000' }))).toMatchObject({ code: '3.3.2.12', basis: 'nbs' });
    expect(serviceAccountSuggestion(nfse({ nbs: '113021000' }))?.code).toBe('3.3.2.11');
    expect(serviceAccountSuggestion(nfse({ nbs: '114061000' }))?.code).toBe('3.3.1.02');
    expect(serviceAccountSuggestion(nfse({ nbs: '117011000' }))?.code).toBe('3.3.2.08');
    expect(serviceAccountSuggestion(nfse({ nbs: '120011000' }))?.code).toBe('3.3.2.14');
  });

  it('sem NBS, pelo item da LC 116 no código de tributação nacional', () => {
    expect(serviceAccountSuggestion(nfse({ serviceCode: '171901' }))).toMatchObject({ code: '3.3.2.11', reason: 'item 17.19 da LC 116: consultoria, advocacia, auditoria e contabilidade' });
    expect(serviceAccountSuggestion(nfse({ serviceCode: '010501' }))?.code).toBe('3.3.2.12');
    expect(serviceAccountSuggestion(nfse({ serviceCode: '990101' }))).toBeNull();
  });
});

describe('na conciliação e no radar do imobilizado', () => {
  const history = new Map<string, string>();

  it('NCM refina só a nota do fornecedor de mercadoria; histórico do parceiro e CFOP próprio vêm antes', () => {
    const notebook = inv({ ncms: [{ ncm: '84713012', amount: 5000 }] });
    expect(suggestAccount(notebook, chart, history)).toMatchObject({ source: 'ncm', reason: expect.stringMatching(/^NCM 8471/) });
    expect(code(suggestAccount(notebook, chart, history)?.accountId)).toBe('1.2.3.06');
    // Entrada própria com CFOP de revenda (1102): a finalidade já está dita.
    expect(suggestAccount({ ...notebook, cfops: [{ cfop: '1102', amount: 5000 }] }, chart, history)?.source).toBe('cfop');
    // CFOP do fornecedor de energia: o CFOP vale.
    expect(suggestAccount({ ...notebook, cfops: [{ cfop: '5253', amount: 5000 }] }, chart, history)?.source).toBe('cfop');
    // NFS-e de TI.
    const ti = inv({ model: 'NFSE', cfops: [], nbs: '115021000' });
    expect(code(suggestAccount(ti, chart, history)?.accountId)).toBe('3.3.2.12');
  });

  it('o casamento leva o motivo da sugestão e considera o que a empresa vende', () => {
    const purchase = inv({ total: 5000, ncms: [{ ncm: '84713012', amount: 5000 }], issueDate: '2027-03-01' });
    const tx = { id: 't1', clientId: 'c', fitid: 'f', date: '2027-03-05', amount: -5000, type: 'DEBIT', memo: 'PAGAMENTO FORNECEDOR', status: 'PENDING', createdAt: '' } as const;
    const alone = matchInvoices([tx], [purchase], chart).get('t1');
    expect(alone).toMatchObject({ suggestionSource: 'ncm', suggestionReason: expect.stringMatching(/não vende/) });
    const reseller = matchInvoices([tx], [purchase, inv({ direction: 'SALE', ncms: [{ ncm: '84713019', amount: 9000 }] })], chart).get('t1');
    expect(code(reseller?.suggestedAccountId)).toBe('3.2.1.01');
  });

  it('nota de fornecedor com veículo acima de R$ 1.200 entra no radar de bens sem cadastro', () => {
    const car = inv({ total: 80000, ncms: [{ ncm: '87032310', amount: 80000 }] });
    const food = inv({ total: 900, ncms: [{ ncm: '19052000', amount: 900 }] });
    const radar = unregisteredAssetInvoices([car, food], [] as FixedAsset[]);
    expect(radar.map((r) => [r.invoice.id, r.suggestedAccountCode])).toEqual([[car.id, '1.2.3.04']]);
  });
});

describe('leitura do XML', () => {
  it('NF-e: valor por NCM, do maior para o menor, sem NCM zerado', () => {
    const key = '35270311444777000161550010000000071000000071';
    const det = (i: number, ncm: string, v: string) => `<det nItem="${i}"><prod><NCM>${ncm}</NCM><CFOP>5102</CFOP><vProd>${v}</vProd></prod></det>`;
    const xml = `<nfeProc><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><serie>1</serie><nNF>7</nNF><dhEmi>2027-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>11444777000161</CNPJ><xNome>F</xNome></emit><dest><CNPJ>11222333000181</CNPJ><xNome>C</xNome></dest>${det(1, '84713012', '3000.00')}${det(2, '85444900', '200.00')}${det(3, '84713012', '1500.00')}${det(4, '00000000', '50.00')}<total><ICMSTot><vNF>4750.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const r = parseNFeXml(xml);
    expect(r.kind === 'invoice' && r.invoice.ncms).toEqual([
      { ncm: '84713012', amount: 4500 },
      { ncm: '85444900', amount: 200 },
    ]);
  });

  it('NFS-e: o NBS do serviço', () => {
    const k = '35503080211444777000161000000000001270100000000016';
    const xml = `<NFSe><infNFSe Id="NFS${k}"><nNFSe>1</nNFSe><cStat>100</cStat><emit><CNPJ>11444777000161</CNPJ><xNome>TI LTDA</xNome></emit><valores><vLiq>1000.00</vLiq></valores>
<DPS><infDPS Id="DPS1"><dhEmi>2027-01-10T15:30:00-03:00</dhEmi><toma><CNPJ>11222333000181</CNPJ><xNome>C</xNome></toma>
<serv><cServ><cTribNac>010501</cTribNac><xDescServ>Licença</xDescServ><cNBS>115021000</cNBS></cServ></serv><valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
    const r = parseNFeXml(xml);
    expect(r.kind === 'invoice' && r.invoice).toMatchObject({ nbs: '115021000', serviceCode: '010501' });
  });
});
