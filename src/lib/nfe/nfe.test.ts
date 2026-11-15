import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { BankTransaction, InvoiceSummary } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { parseNFeXml } from '@/lib/nfe/parser';
import { paymentStateOf, planInvoiceImport } from '@/lib/nfe/import';
import { cfopAccountCode, matchInvoices, nameOverlap, partyEvidence } from '@/lib/nfe/match';
import { filterInvoices, invoiceDueInfo, invoicePeriodSummary, invoiceStateCounts, nextInvoiceSort, sortInvoices } from '@/lib/nfe/list';
import { extractXmlFromZip } from '@/lib/nfe/zip';
import { compareBillingWithRevenue, findNumberingGaps, formatGapRange } from '@/lib/nfe/checks';

const CLIENT = { id: 'c', cnpj: '11.222.333/0001-81' };
const CLIENT_DOC = '11222333000181';
const SUPPLIER_DOC = '11444777000161';
const key = (n: number, doc = SUPPLIER_DOC) => `35250${3}${doc}55001${String(n).padStart(9, '0')}1${'12345678'}0`.slice(0, 44);

interface XmlOptions {
  n?: number;
  issuer?: [string, string];
  dest?: [string, string] | null;
  tpNF?: '0' | '1';
  total?: string;
  items?: [string, string][];
  dups?: [string, string, string][];
  cStat?: string | null;
  prefix?: string;
  /** Grupos extras dentro de `<total>` (ex.: IBSCBSTot, vNFTot). */
  extraTotal?: string;
}

/** NF-e processada mínima, com os grupos que o leitor usa. */
function nfeXml({
  n = 1,
  issuer = [SUPPLIER_DOC, 'ACME DISTRIBUIDORA DE ALIMENTOS LTDA'],
  dest = [CLIENT_DOC, 'PADARIA TESTE LTDA'],
  tpNF = '1',
  total = '1500.00',
  items = [['5102', '1500.00']],
  dups = [],
  cStat = '100',
  prefix = '',
  extraTotal = '',
}: XmlOptions = {}): string {
  const p = prefix ? `${prefix}:` : '';
  const k = key(n, issuer[0]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<${p}nfeProc xmlns${prefix ? `:${prefix}` : ''}="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<${p}NFe><${p}infNFe Id="NFe${k}" versao="4.00">
<${p}ide><${p}cUF>35</${p}cUF><${p}mod>55</${p}mod><${p}serie>1</${p}serie><${p}nNF>${n}</${p}nNF><${p}dhEmi>2025-03-05T10:20:00-03:00</${p}dhEmi><${p}tpNF>${tpNF}</${p}tpNF></${p}ide>
<${p}emit><${p}CNPJ>${issuer[0]}</${p}CNPJ><${p}xNome>${issuer[1]}</${p}xNome></${p}emit>
${dest ? `<${p}dest><${p}CNPJ>${dest[0]}</${p}CNPJ><${p}xNome>${dest[1]}</${p}xNome></${p}dest>` : ''}
${items.map(([cfop, v], i) => `<${p}det nItem="${i + 1}"><${p}prod><${p}cProd>${i}</${p}cProd><${p}CFOP>${cfop}</${p}CFOP><${p}vProd>${v}</${p}vProd></${p}prod></${p}det>`).join('')}
<${p}total><${p}ICMSTot><${p}vProd>${total}</${p}vProd><${p}vNF>${total}</${p}vNF></${p}ICMSTot>${extraTotal}</${p}total>
${dups.length ? `<${p}cobr>${dups.map(([nDup, dVenc, vDup]) => `<${p}dup><${p}nDup>${nDup}</${p}nDup><${p}dVenc>${dVenc}</${p}dVenc><${p}vDup>${vDup}</${p}vDup></${p}dup>`).join('')}</${p}cobr>` : ''}
<${p}pag><${p}detPag><${p}vPag>${total}</${p}vPag></${p}detPag></${p}pag>
</${p}infNFe></${p}NFe>
${cStat ? `<${p}protNFe versao="4.00"><${p}infProt><${p}chNFe>${k}</${p}chNFe><${p}cStat>${cStat}</${p}cStat></${p}infProt></${p}protNFe>` : ''}
</${p}nfeProc>`;
}

const cancelXml = (k: string) => `<procEventoNFe><evento><infEvento Id="ID110111${k}01"><chNFe>${k}</chNFe><tpEvento>110111</tpEvento></infEvento></evento>
<retEvento><infEvento><cStat>135</cStat></infEvento></retEvento></procEventoNFe>`;

describe('leitura do XML', () => {
  it('extrai partes, valor, data, CFOP e parcelas', () => {
    const r = parseNFeXml(nfeXml({ items: [['1102', '1000.00'], ['1556', '500.00']], dups: [['001', '2025-04-05', '750.00'], ['002', '2025-05-05', '750.00']] }));
    expect(r.kind).toBe('invoice');
    if (r.kind !== 'invoice') return;
    expect(r.invoice).toMatchObject({
      number: '1',
      series: '1',
      model: '55',
      issueDate: '2025-03-05',
      operation: 'OUT',
      issuer: { doc: SUPPLIER_DOC, name: 'ACME DISTRIBUIDORA DE ALIMENTOS LTDA' },
      recipient: { doc: CLIENT_DOC },
      total: 1500,
      situation: 'AUTHORIZED',
    });
    expect(r.invoice.cfops).toEqual([
      { cfop: '1102', amount: 1000 },
      { cfop: '1556', amount: 500 },
    ]);
    expect(r.invoice.installments).toEqual([
      { number: '001', dueDate: '2025-04-05', amount: 750 },
      { number: '002', dueDate: '2025-05-05', amount: 750 },
    ]);
  });

  it('aceita prefixo de namespace e decodifica entidades', () => {
    const r = parseNFeXml(nfeXml({ prefix: 'nfe', issuer: [SUPPLIER_DOC, 'PÃES &amp; CIA'] }));
    expect(r.kind === 'invoice' && r.invoice.issuer.name).toBe('PÃES & CIA');
  });

  it('cancelamento, resumo DF-e e arquivos que não são NF-e', () => {
    const k = key(9);
    expect(parseNFeXml(cancelXml(k))).toEqual({ kind: 'cancellation', key: k });
    const res = parseNFeXml(`<resNFe><chNFe>${k}</chNFe><CNPJ>${SUPPLIER_DOC}</CNPJ><xNome>ACME</xNome><dhEmi>2025-03-01T08:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>99.90</vNF><cSitNFe>1</cSitNFe></resNFe>`);
    expect(res.kind === 'invoice' && res.invoice).toMatchObject({ number: '9', total: 99.9, summaryOnly: true, situation: 'AUTHORIZED' });
    expect(parseNFeXml('<html></html>').kind).toBe('unknown');
    expect(parseNFeXml(`<evento><infEvento><chNFe>${k}</chNFe><tpEvento>110110</tpEvento></infEvento></evento>`).kind).toBe('unknown');
  });

  it('IBS e CBS do IBSCBSTot e o total com eles (vNFTot)', () => {
    const extraTotal = `<IBSCBSTot><vBCIBSCBS>1500.00</vBCIBSCBS><gIBS><gIBSUF><vDif>0</vDif><vIBSUF>1.50</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>1.50</vIBS></gIBS><gCBS><vDif>0</vDif><vCBS>13.50</vCBS></gCBS></IBSCBSTot><vNFTot>1515.00</vNFTot>`;
    const r = parseNFeXml(nfeXml({ extraTotal }));
    expect(r.kind === 'invoice' && r.invoice).toMatchObject({ total: 1500, altTotal: 1515, ibs: 1.5, cbs: 13.5 });
    // Sem vIBS, soma UF e município.
    const parts = parseNFeXml(nfeXml({ extraTotal: '<IBSCBSTot><gIBS><gIBSUF><vIBSUF>0.75</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.75</vIBSMun></gIBSMun></gIBS></IBSCBSTot>' }));
    expect(parts.kind === 'invoice' && parts.invoice.ibs).toBe(1.5);
    // Nota antiga, sem o grupo.
    const old = parseNFeXml(nfeXml());
    expect(old.kind === 'invoice' && [old.invoice.ibs, old.invoice.cbs, old.invoice.altTotal]).toEqual([0, 0, undefined]);
  });
});

/* ───────────────────────── NFS-e do padrão nacional ───────────────────────── */

const PROVIDER_DOC = '22333444000155';
/** Chave de 50 dígitos: município, ambiente, tipo de inscrição, CNPJ, número, AAMM, código e DV. */
const nfseKey = (num: number, doc = PROVIDER_DOC) => `3550308${'1'}${'2'}${doc}${String(num).padStart(13, '0')}2701${'123456789'}${'0'}`;

interface NfseOptions {
  num?: number;
  provider?: [string, string];
  taker?: [string, string] | null;
  service?: string;
  net?: string;
  cStat?: string;
  ibsCbs?: string;
  /** Grupo `trib` da DPS (tribMun/tribFed). */
  trib?: string;
  totalRet?: string;
}

function nfseXml({
  num = 10,
  provider = [PROVIDER_DOC, 'ESCRITORIO DE ASSESSORIA LTDA'],
  taker = [CLIENT_DOC, 'PADARIA TESTE LTDA'],
  service = '1000.00',
  net = '1000.00',
  cStat = '100',
  ibsCbs = '',
  trib = '',
  totalRet = '',
}: NfseOptions = {}): string {
  const k = nfseKey(num, provider[0]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${k}">
<xLocEmi>São Paulo</xLocEmi><nNFSe>${num}</nNFSe><cStat>${cStat}</cStat><dhProc>2027-01-12T09:00:00-03:00</dhProc>
<emit><CNPJ>${provider[0]}</CNPJ><xNome>${provider[1]}</xNome></emit>
<valores><vBC>${service}</vBC><vISSQN>20.00</vISSQN>${totalRet ? `<vTotalRet>${totalRet}</vTotalRet>` : ''}<vLiq>${net}</vLiq></valores>
${ibsCbs}
<DPS versao="1.01"><infDPS Id="DPS1"><dhEmi>2027-01-10T15:30:00-03:00</dhEmi><serie>900</serie><nDPS>1</nDPS>
<prest><CNPJ>${provider[0]}</CNPJ><regTrib><opSimpNac>1</opSimpNac></regTrib></prest>
${taker ? `<toma><CNPJ>${taker[0]}</CNPJ><xNome>${taker[1]}</xNome></toma>` : ''}
<serv><cServ><cTribNac>170201</cTribNac><xDescServ>Assessoria</xDescServ></cServ></serv>
<valores><vServPrest><vServ>${service}</vServ></vServPrest>${trib}</valores>
</infDPS></DPS></infNFSe></NFSe>`;
}

const nfseCancelXml = (k: string, code = 'e101101') =>
  `<evento xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento Id="EVT1"><pedRegEvento><infPedReg Id="PRE1"><chNFSe>${k}</chNFSe><${code}><xDesc>Cancelamento de NFS-e</xDesc></${code}></infPedReg></pedRegEvento></infEvento></evento>`;

describe('leitura do XML da NFS-e', () => {
  it('extrai prestador, tomador, líquido, valor do serviço, código e data da DPS', () => {
    const r = parseNFeXml(nfseXml({ service: '1000.00', net: '938.50' }));
    expect(r.kind).toBe('invoice');
    if (r.kind !== 'invoice') return;
    expect(r.invoice).toMatchObject({
      key: nfseKey(10),
      number: '10',
      series: '',
      model: 'NFSE',
      issueDate: '2027-01-10',
      operation: 'OUT',
      issuer: { doc: PROVIDER_DOC, name: 'ESCRITORIO DE ASSESSORIA LTDA' },
      recipient: { doc: CLIENT_DOC, name: 'PADARIA TESTE LTDA' },
      total: 938.5,
      altTotal: 1000,
      serviceCode: '170201',
      situation: 'AUTHORIZED',
      cfops: [],
      installments: [],
    });
    expect(r.invoice.key).toHaveLength(50);
  });

  it('retenções da nota (caso da aula: serviço de 750,00, líquido de 703,88)', () => {
    const fed = (pisCofins: string, irrf = '11.25', csll = '7.50') =>
      `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><tribFed><piscofins><CST>01</CST><vPis>4.87</vPis><vCofins>22.50</vCofins>${pisCofins}</piscofins><vRetIRRF>${irrf}</vRetIRRF><vRetCSLL>${csll}</vRetCSLL></tribFed></trib>`;
    const full = parseNFeXml(nfseXml({ service: '750.00', net: '703.88', trib: fed('<tpRetPisCofins>1</tpRetPisCofins>'), totalRet: '46.12' }));
    expect(full.kind === 'invoice' && full.invoice).toMatchObject({ total: 703.88, altTotal: 750, retentions: { irrf: 11.25, pis: 4.87, cofins: 22.5, csll: 7.5 } });
    // Sem a marcação de retenção, PIS/COFINS contam como retidos quando fecham o vTotalRet.
    const unmarked = parseNFeXml(nfseXml({ service: '750.00', net: '703.88', trib: fed(''), totalRet: '46.12' }));
    expect(unmarked.kind === 'invoice' && unmarked.invoice.retentions).toEqual({ irrf: 11.25, pis: 4.87, cofins: 22.5, csll: 7.5 });
    // Só o IRRF retido (PIS/COFINS destacados, mas não retidos).
    const irrfOnly = parseNFeXml(nfseXml({ service: '750.00', net: '738.75', trib: fed('<tpRetPisCofins>2</tpRetPisCofins>', '11.25', '0.00'), totalRet: '11.25' }));
    expect(irrfOnly.kind === 'invoice' && irrfOnly.invoice.retentions).toEqual({ irrf: 11.25 });
    // ISS retido pelo tomador (vISSQN da nota) e diferença sem discriminação.
    const iss = parseNFeXml(nfseXml({ service: '1000.00', net: '970.00', trib: '<trib><tribMun><tpRetISSQN>2</tpRetISSQN></tribMun></trib>' }));
    expect(iss.kind === 'invoice' && iss.invoice.retentions).toEqual({ iss: 20, other: 10 });
    // Sem retenção, nada.
    expect(parseNFeXml(nfseXml({ trib: fed('<tpRetPisCofins>2</tpRetPisCofins>', '0', '0') })).kind === 'invoice').toBe(true);
    const none = parseNFeXml(nfseXml());
    expect(none.kind === 'invoice' && none.invoice.retentions).toBeUndefined();
  });

  it('sem retenção não há valor alternativo; IBS/CBS dos totais da nota', () => {
    const ibsCbs = '<IBSCBS><totCIBS><vTotNF>1010.00</vTotNF><gIBS><vIBSTot>1.00</vIBSTot></gIBS><gCBS><vCBS>9.00</vCBS></gCBS></totCIBS></IBSCBS>';
    const r = parseNFeXml(nfseXml({ ibsCbs }));
    expect(r.kind === 'invoice' && r.invoice).toMatchObject({ total: 1000, ibs: 1, cbs: 9 });
    expect(r.kind === 'invoice' && r.invoice.altTotal).toBeUndefined();
  });

  it('cancelamento e cancelamento por substituição; outros eventos, DPS e ABRASF são recusados', () => {
    const k = nfseKey(10);
    expect(parseNFeXml(nfseCancelXml(k))).toEqual({ kind: 'cancellation', key: k });
    expect(parseNFeXml(nfseCancelXml(k, 'e105102'))).toEqual({ kind: 'cancellation', key: k });
    expect(parseNFeXml(nfseCancelXml(k, 'e202201'))).toMatchObject({ kind: 'unknown', reason: expect.stringMatching(/não é cancelamento/) });
    expect(parseNFeXml(nfseCancelXml('123'))).toMatchObject({ kind: 'unknown' });
    expect(parseNFeXml('<DPS><infDPS Id="DPS1"><dhEmi>2027-01-10</dhEmi></infDPS></DPS>')).toMatchObject({ kind: 'unknown', reason: expect.stringMatching(/DPS/) });
    expect(parseNFeXml('<CompNfse><Nfse><InfNfse><Numero>1</Numero></InfNfse></Nfse></CompNfse>')).toMatchObject({ kind: 'unknown', reason: expect.stringMatching(/ABRASF/) });
  });

  it('situação desconhecida entra com aviso', () => {
    const r = parseNFeXml(nfseXml({ cStat: '' }));
    expect(r.kind === 'invoice' && r.invoice.situation).toBe('UNKNOWN');
  });
});

describe('importação da NFS-e', () => {
  const NOW = '2027-01-15T12:00:00.000Z';

  it('serviço tomado é compra; prestado é venda; grava IBS/CBS e código só quando há', () => {
    const ibsCbs = '<IBSCBS><totCIBS><gIBS><vIBSTot>1.00</vIBSTot></gIBS><gCBS><vCBS>9.00</vCBS></gCBS></totCIBS></IBSCBS>';
    const plan = planInvoiceImport(
      [
        { name: 'tomada.xml', text: nfseXml({ num: 1, ibsCbs }) },
        { name: 'prestada.xml', text: nfseXml({ num: 2, provider: [CLIENT_DOC, 'PADARIA TESTE LTDA'], taker: [SUPPLIER_DOC, 'CLIENTE ALFA'] }) },
        { name: 'outra.xml', text: nfseXml({ num: 3, taker: ['99888777000166', 'OUTRA'] }) },
        { name: 'cancel.xml', text: nfseCancelXml(nfseKey(1)) },
        { name: 'sem-situacao.xml', text: nfseXml({ num: 4, cStat: '' }) },
      ],
      CLIENT,
      NOW
    );
    expect(plan.invoices.map((i) => [i.number, i.direction, i.counterpartyDoc, i.status])).toEqual([
      ['1', 'PURCHASE', PROVIDER_DOC, 'CANCELLED'],
      ['2', 'SALE', SUPPLIER_DOC, 'AUTHORIZED'],
      ['4', 'PURCHASE', PROVIDER_DOC, 'AUTHORIZED'],
    ]);
    expect(plan.invoices[0]).toMatchObject({ model: 'NFSE', ibs: 1, cbs: 9, serviceCode: '170201' });
    expect('ibs' in plan.invoices[1]).toBe(false);
    expect('altTotal' in plan.invoices[1]).toBe(false);
    expect(plan.rejected.map((r) => r.file)).toEqual(['outra.xml']);
    expect(plan.warnings).toEqual([{ file: 'sem-situacao.xml', message: expect.stringMatching(/NFS-e 4/) }]);
  });
});

describe('plano de importação', () => {
  const NOW = '2025-03-10T12:00:00.000Z';

  it('compra quando a empresa é destinatária; venda quando é emitente', () => {
    const plan = planInvoiceImport(
      [
        { name: 'compra.xml', text: nfeXml({ n: 1 }) },
        { name: 'venda.xml', text: nfeXml({ n: 2, issuer: [CLIENT_DOC, 'PADARIA TESTE LTDA'], dest: [SUPPLIER_DOC, 'CLIENTE ALFA'] }) },
        { name: 'repetida.xml', text: nfeXml({ n: 1 }) },
      ],
      CLIENT,
      NOW
    );
    expect(plan.invoices.map((i) => [i.number, i.direction, i.counterpartyDoc])).toEqual([
      ['1', 'PURCHASE', SUPPLIER_DOC],
      ['2', 'SALE', SUPPLIER_DOC],
    ]);
    expect(plan.invoices[0].id).toBe(`c_${plan.invoices[0].key}`);
    expect(plan.rejected).toEqual([]);
  });

  it('nota de entrada própria (tpNF 0) é compra, com o fornecedor no destinatário', () => {
    const plan = planInvoiceImport([{ name: 'a.xml', text: nfeXml({ tpNF: '0', issuer: [CLIENT_DOC, 'PADARIA'], dest: ['12345678909', 'PRODUTOR RURAL'] }) }], CLIENT, NOW);
    expect(plan.invoices[0]).toMatchObject({ direction: 'PURCHASE', counterpartyDoc: '12345678909', counterpartyName: 'PRODUTOR RURAL' });
  });

  it('filial da mesma empresa é aceita; outra empresa, denegada ou ilegível é recusada', () => {
    const plan = planInvoiceImport(
      [
        { name: 'filial.xml', text: nfeXml({ n: 3, dest: ['11222333000262', 'PADARIA FILIAL'] }) },
        { name: 'outra.xml', text: nfeXml({ n: 4, dest: ['11444777000242', 'OUTRA'] }) },
        { name: 'denegada.xml', text: nfeXml({ n: 5, cStat: '110' }) },
        { name: 'lixo.xml', text: 'nada' },
      ],
      CLIENT,
      NOW
    );
    expect(plan.invoices.map((i) => i.number)).toEqual(['3']);
    expect(plan.rejected.map((r) => r.file)).toEqual(['outra.xml', 'denegada.xml', 'lixo.xml']);
    expect(plan.rejected[0].reason).toMatch(/outra empresa/);
  });

  it('sem protocolo entra com aviso; cancelamento no mesmo lote cancela a nota', () => {
    const plan = planInvoiceImport(
      [
        { name: 'sem-prot.xml', text: nfeXml({ n: 6, cStat: null }) },
        { name: 'nota.xml', text: nfeXml({ n: 7 }) },
        { name: 'cancel.xml', text: cancelXml(key(7)) },
      ],
      CLIENT,
      NOW
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.invoices.find((i) => i.number === '7')?.status).toBe('CANCELLED');
    expect(plan.cancellations).toEqual([key(7)]);
  });
});

/* ───────────────────────── Casamento ───────────────────────── */

const chart = buildITG1000Chart('c', '2025-01-01T00:00:00.000Z');
const acc = (code: string) => chart.find((a) => a.code === code)!.id;

const invoice = (over: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  id: `c_${over.key ?? 'k1'}`,
  clientId: 'c',
  key: 'k1',
  number: '1',
  series: '1',
  model: '55',
  issueDate: '2025-03-05',
  direction: 'PURCHASE',
  counterpartyDoc: SUPPLIER_DOC,
  counterpartyName: 'ACME DISTRIBUIDORA DE ALIMENTOS LTDA',
  total: 1500,
  cfops: [{ cfop: '1102', amount: 1500 }],
  installments: [],
  status: 'AUTHORIZED',
  importedAt: '',
  ...over,
});

let n = 0;
const tx = (date: string, amount: number, memo: string, extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: `t${++n}`,
  clientId: 'c',
  fitid: `f${n}`,
  date,
  amount,
  type: amount < 0 ? 'DEBIT' : 'CREDIT',
  memo,
  status: 'PENDING',
  createdAt: '',
  ...extra,
});

describe('parceiro na descrição do extrato', () => {
  it('pelo CNPJ ou pelo nome, mesmo cortado', () => {
    const inv = invoice();
    expect(partyEvidence(inv, 'PIX ENVIADO 11.444.777/0001-61').party).toBe('document');
    expect(partyEvidence(inv, 'Pix enviado - ACME DISTRIB').party).toBe('name');
    expect(partyEvidence(inv, 'Pagamento de boleto efetuado').party).toBe('none');
    expect(nameOverlap('CLARO S.A.', 'Pagamento de boleto efetuado - Claro')).toBe(1);
  });
});

describe('casamento de lançamentos com notas', () => {
  it('total igual e parceiro na descrição; sugere a conta pelo CFOP', () => {
    const t = tx('2025-03-20', -1500, 'Pix enviado - ACME DISTRIBUIDORA');
    const m = matchInvoices([t], [invoice()], chart).get(t.id);
    expect(m).toMatchObject({ amount: 1500, party: 'name', suggestedAccountId: acc('3.2.1.01'), suggestionSource: 'cfop' });
  });

  it('casa cada parcela com o seu pagamento', () => {
    const inv = invoice({ installments: [{ number: '1', dueDate: '2025-04-05', amount: 750 }, { number: '2', dueDate: '2025-05-05', amount: 750 }] });
    const a = tx('2025-04-05', -750, 'Pagamento de boleto - ACME');
    const b = tx('2025-05-06', -750, 'Pagamento de boleto - ACME');
    const m = matchInvoices([a, b], [inv], chart);
    expect(m.get(a.id)?.installment?.number).toBe('1');
    expect(m.get(b.id)?.installment?.number).toBe('2');
  });

  it('respeita valor, prazo, lado e situação da nota', () => {
    const inv = invoice();
    expect(matchInvoices([tx('2025-03-20', -1499.99, 'ACME')], [inv], chart).size).toBe(0);
    expect(matchInvoices([tx('2025-08-20', -1500, 'ACME')], [inv], chart).size).toBe(0); // fora do prazo
    expect(matchInvoices([tx('2025-03-20', 1500, 'ACME')], [inv], chart).size).toBe(0); // recebimento x nota de compra
    expect(matchInvoices([tx('2025-03-20', -1500, 'ACME')], [{ ...inv, status: 'CANCELLED' }], chart).size).toBe(0);
    expect(matchInvoices([tx('2025-03-20', -1500, 'ACME', { status: 'RECONCILED' })], [inv], chart).size).toBe(0);
  });

  it('sem sinal do parceiro, só quando a nota é a única possível', () => {
    const boleto = tx('2025-03-20', -1500, 'Pagamento de boleto efetuado');
    expect(matchInvoices([boleto], [invoice()], chart).get(boleto.id)?.party).toBe('none');
    const twoInvoices = [invoice(), invoice({ id: 'c_k2', key: 'k2', counterpartyName: 'OUTRA EMPRESA', counterpartyDoc: '' })];
    expect(matchInvoices([boleto], twoInvoices, chart).size).toBe(0);
  });

  it('a mesma nota não casa com dois pagamentos; parcela já vinculada fica de fora', () => {
    const a = tx('2025-03-10', -1500, 'Pix - ACME');
    const b = tx('2025-03-25', -1500, 'Pix - ACME');
    expect(matchInvoices([a, b], [invoice()], chart).size).toBe(1);
    const linked = invoice({ links: [{ transactionId: 'outro', amount: 1500, accountId: acc('3.2.1.01'), linkedAt: 'T' }] });
    expect(matchInvoices([a], [linked], chart).size).toBe(0);
    // O vínculo do próprio lançamento (desfeito e refeito) não o impede de casar de novo.
    const own = invoice({ links: [{ transactionId: a.id, amount: 1500, accountId: acc('3.2.1.01'), linkedAt: 'T' }] });
    expect(matchInvoices([a], [own], chart).size).toBe(1);
  });

  it('conta usada antes com o mesmo fornecedor vence o CFOP', () => {
    const paid = invoice({ id: 'c_old', key: 'old', links: [{ transactionId: 'x', amount: 1500, accountId: acc('3.3.2.10'), linkedAt: '2025-02-01' }] });
    const t = tx('2025-03-20', -1500, 'Pix - ACME');
    expect(matchInvoices([t], [paid, invoice()], chart).get(t.id)).toMatchObject({ suggestedAccountId: acc('3.3.2.10'), suggestionSource: 'history' });
  });

  it('recebimento casa com nota de venda; conta pelo CFOP de venda', () => {
    const sale = invoice({ direction: 'SALE', counterpartyName: 'MERCADO BOM PRECO', cfops: [{ cfop: '5101', amount: 1500 }] });
    const t = tx('2025-03-08', 1500, 'Pix recebido - MERCADO BOM PRECO');
    expect(matchInvoices([t], [sale], chart).get(t.id)?.suggestedAccountId).toBe(acc('3.1.1.03'));
  });

  it('NFS-e: casa pelo líquido ou pelo valor do serviço, uma vez só; conta pelo tipo de nota', () => {
    const service = invoice({
      model: 'NFSE',
      series: '',
      direction: 'SALE',
      counterpartyName: 'CLIENTE ALFA',
      total: 938.5,
      altTotal: 1000,
      cfops: [],
      serviceCode: '170201',
    });
    const net = tx('2025-03-15', 938.5, 'Pix recebido - CLIENTE ALFA');
    const gross = tx('2025-03-16', 1000, 'Pix recebido - CLIENTE ALFA');
    expect(matchInvoices([net], [service], chart).get(net.id)).toMatchObject({ amount: 938.5, suggestedAccountId: acc('3.1.1.01') });
    expect(matchInvoices([gross], [service], chart).get(gross.id)).toMatchObject({ amount: 1000 });
    // Total e valor alternativo são a mesma vaga.
    expect(matchInvoices([net, gross], [service], chart).size).toBe(1);
    // Já paga pelo valor do serviço: não casa de novo pelo líquido.
    const paid = { ...service, links: [{ transactionId: 'x', amount: 1000, accountId: acc('3.1.1.01'), linkedAt: 'T' }] };
    expect(matchInvoices([net], [paid], chart).size).toBe(0);
    expect(paymentStateOf(paid)).toBe('SETTLED');
    // Serviço tomado: despesa geral.
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [], model: 'NFSE' })).toBe('3.3.2.17');
  });
});

describe('CFOP e situação de pagamento', () => {
  it('conta pelo CFOP principal', () => {
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '2551', amount: 1 }] })).toBe('1.2.3.03');
    expect(cfopAccountCode({ direction: 'SALE', cfops: [{ cfop: '6102', amount: 1 }] })).toBe('3.1.1.02');
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '1949', amount: 1 }] })).toBeNull();
    // Nota do fornecedor: o CFOP é o da saída dele.
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '5102', amount: 1 }] })).toBe('3.2.1.01');
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '6101', amount: 1 }] })).toBe('3.2.1.01');
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '5551', amount: 1 }] })).toBe('1.2.3.03');
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '5656', amount: 1 }] })).toBe('3.3.2.13');
    // Nota de entrada da própria empresa: o CFOP diz a finalidade.
    expect(cfopAccountCode({ direction: 'PURCHASE', cfops: [{ cfop: '1556', amount: 1 }] })).toBe('3.3.2.10');
  });

  it('em aberto, parcial, quitada e cancelada', () => {
    const base = { status: 'AUTHORIZED' as const, total: 100 };
    expect(paymentStateOf(base)).toBe('OPEN');
    expect(paymentStateOf({ ...base, links: [{ transactionId: 'a', amount: 40, accountId: 'x', linkedAt: '' }] })).toBe('PARTIAL');
    expect(paymentStateOf({ ...base, links: [{ transactionId: 'a', amount: 100, accountId: 'x', linkedAt: '' }] })).toBe('SETTLED');
    expect(paymentStateOf({ ...base, status: 'CANCELLED' })).toBe('CANCELLED');
  });
});

/* ───────────────────────── Fila, vencimentos e ordenação ───────────────────────── */

describe('fila de trabalho, vencimentos e ordenação', () => {
  it('identifica próximo vencimento, parcela vencida e competência para conciliação', () => {
    const inv = invoice({
      issueDate: '2025-03-05',
      total: 1500,
      installments: [
        { number: '1', dueDate: '2025-04-05', amount: 500 },
        { number: '2', dueDate: '2025-05-05', amount: 500 },
        { number: '3', dueDate: '2025-06-05', amount: 500 },
      ],
    });
    // Em 10/04/2025, a 1ª parcela (05/04) está vencida.
    const dueOpen = invoiceDueInfo(inv, '2025-04-10');
    expect(dueOpen).toMatchObject({
      state: 'OPEN',
      nextDueDate: '2025-04-05',
      isOverdue: true,
      openAmount: 1500,
      conciliationMonth: '2025-04',
    });
    expect(dueOpen.installments.map((i) => i.status)).toEqual(['OVERDUE', 'UPCOMING', 'UPCOMING']);

    // Quitada a 1ª parcela, o próximo vencimento passa a ser 05/05 (a vencer).
    const partial = { ...inv, links: [{ transactionId: 'tx1', amount: 500, accountId: acc('3.2.1.01'), linkedAt: 'T' }] };
    const duePartial = invoiceDueInfo(partial, '2025-04-10');
    expect(duePartial).toMatchObject({
      state: 'PARTIAL',
      nextDueDate: '2025-05-05',
      isOverdue: false,
      openAmount: 1000,
      conciliationMonth: '2025-05',
    });
    expect(duePartial.installments.map((i) => i.status)).toEqual(['SETTLED', 'UPCOMING', 'UPCOMING']);
  });

  it('resume o período, conta por situação, filtra e ordena', () => {
    const list: InvoiceSummary[] = [
      invoice({ id: 'c_1', key: 'k1', number: '10', issueDate: '2025-03-10', direction: 'PURCHASE', counterpartyName: 'Beta', total: 200, installments: [{ dueDate: '2025-03-15', amount: 200 }] }),
      invoice({ id: 'c_2', key: 'k2', number: '11', issueDate: '2025-03-12', direction: 'SALE', counterpartyName: 'Alfa', total: 800, links: [{ transactionId: 't1', amount: 800, accountId: acc('3.1.1.02'), linkedAt: 'T' }] }),
      invoice({ id: 'c_3', key: 'k3', number: '12', issueDate: '2025-03-14', direction: 'SALE', counterpartyName: 'Gama', total: 300, status: 'CANCELLED' }),
    ];

    expect(invoiceStateCounts(list)).toEqual({ ALL: 3, OPEN: 1, PARTIAL: 0, SETTLED: 1, CANCELLED: 1 });
    expect(invoicePeriodSummary(list, '2025-03-20')).toEqual({
      totalCount: 3,
      authorizedCount: 2,
      cancelledCount: 1,
      purchasesTotal: 200,
      purchasesCount: 1,
      salesTotal: 800,
      salesCount: 1,
      openCount: 1,
      partialCount: 0,
      openAmount: 200,
      overdueCount: 1,
    });

    expect(filterInvoices(list, 'OPEN', '').map((i) => i.number)).toEqual(['10']);
    expect(filterInvoices(list, 'ALL', 'alfa').map((i) => i.number)).toEqual(['11']);

    const s1 = nextInvoiceSort(null, 'partner');
    expect(s1).toEqual({ key: 'partner', dir: 'asc' });
    expect(sortInvoices(list, s1).map((i) => i.counterpartyName)).toEqual(['Alfa', 'Beta', 'Gama']);
    const s2 = nextInvoiceSort(s1, 'partner');
    expect(s2).toEqual({ key: 'partner', dir: 'desc' });
    expect(nextInvoiceSort(s2, 'partner')).toBeNull();
  });
});

/* ───────────────────────── Leitura de .zip no navegador ───────────────────────── */

/** Monta um arquivo .zip mínimo em memória para testes (métodos 0 = stored e 8 = deflate). */
function buildTestZip(entries: { name: string; content: string; method?: 0 | 8; flags?: number }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const rawData = enc.encode(e.content);
    const method = e.method ?? 8;
    const compData = method === 8 ? new Uint8Array(deflateRawSync(rawData)) : rawData;
    const flags = e.flags ?? 0;

    const local = new Uint8Array(30 + nameBytes.length + compData.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, compData.length, true);
    lv.setUint32(22, rawData.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compData, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, compData.length, true);
    cv.setUint32(24, rawData.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out.buffer;
}

describe('extração de .zip no navegador', () => {
  it('descomprime XMLs (stored e deflate), ignora pastas e metadados de sistema', async () => {
    const zip = buildTestZip([
      { name: 'notas/', content: '', method: 0 },
      { name: '__MACOSX/._nota1.xml', content: 'lixo', method: 0 },
      { name: 'notas/nota1.xml', content: nfeXml({ n: 1 }), method: 8 },
      { name: 'notas/nota2.xml', content: nfeXml({ n: 2 }), method: 0 },
      { name: 'notas/leia-me.txt', content: 'ignorar', method: 0 },
    ]);
    const res = await extractXmlFromZip(zip, 'lote-marco.zip');
    expect(res.rejected).toEqual([]);
    expect(res.files.map((f) => f.name)).toEqual(['lote-marco.zip/nota1.xml', 'lote-marco.zip/nota2.xml']);
    const plan = planInvoiceImport(res.files, CLIENT, '2025-03-10T00:00:00Z');
    expect(plan.invoices.map((i) => i.number)).toEqual(['1', '2']);
  });

  it('recusa .zip sem XML, corrompido ou protegido por senha', async () => {
    const emptyZip = buildTestZip([{ name: 'relatorio.pdf', content: '%PDF', method: 0 }]);
    expect((await extractXmlFromZip(emptyZip, 'vazio.zip')).rejected).toEqual([
      { file: 'vazio.zip', reason: expect.stringMatching(/Nenhum arquivo \.xml/) },
    ]);

    const encryptedZip = buildTestZip([{ name: 'secreto.xml', content: '<xml/>', method: 0, flags: 1 }]);
    expect((await extractXmlFromZip(encryptedZip, 'senha.zip')).rejected).toEqual([
      { file: 'senha.zip/secreto.xml', reason: expect.stringMatching(/senha/) },
    ]);

    const corrupted = new TextEncoder().encode('nao-e-um-zip').buffer;
    expect((await extractXmlFromZip(corrupted, 'ruim.zip')).rejected[0]?.file).toBe('ruim.zip');
  });
});

/* ───────────────────────── Conferências do contador ───────────────────────── */

describe('conferências do contador (furos de numeração e faturamento × receita)', () => {
  it('detecta furos nas notas emitidas por série; canceladas e entrada própria na mesma série não geram falso furo', () => {
    const saleKey = (n: number) => key(n, CLIENT_DOC);
    const list: InvoiceSummary[] = [
      invoice({ id: 's101', key: saleKey(101), number: '101', series: '1', direction: 'SALE' }),
      // 102 falta!
      invoice({ id: 's103', key: saleKey(103), number: '103', series: '1', direction: 'SALE', status: 'CANCELLED' }),
      // 104 é nota de entrada própria (tpNF=0: PURCHASE, mas emitida pelo CNPJ do cliente): conta na sequência!
      invoice({ id: 's104', key: saleKey(104), number: '104', series: '1', direction: 'PURCHASE' }),
      // 105 e 106 faltam!
      invoice({ id: 's107', key: saleKey(107), number: '107', series: '1', direction: 'SALE' }),
      // Compra de fornecedor (outro CNPJ na chave) com número 500 não entra na sequência do cliente.
      invoice({ id: 'p500', key: key(500, SUPPLIER_DOC), number: '500', series: '1', direction: 'PURCHASE' }),
    ];

    const gaps = findNumberingGaps(list, CLIENT.cnpj);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      label: 'NF-e série 1',
      minNumber: 101,
      maxNumber: 107,
      missingCount: 3,
      ranges: [
        { from: 102, to: 102 },
        { from: 105, to: 106 },
      ],
    });
    expect(gaps[0].ranges.map(formatGapRange)).toEqual(['102', '105 a 106']);
  });

  it('compara faturamento pelas notas de venda (bruto na NFS-e) com a receita lançada na DRE', () => {
    const revMerch = chart.find((a) => a.code === '3.1.1.02')!;
    const revServ = chart.find((a) => a.code === '3.1.1.01')!;
    const sales: InvoiceSummary[] = [
      invoice({ id: 'v1', key: 'kv1', number: '1', direction: 'SALE', total: 2000, cfops: [{ cfop: '5102', amount: 2000 }], links: [{ transactionId: 't-v1', amount: 2000, accountId: revMerch.id, linkedAt: 'T' }] }),
      // NFS-e com retenção: líquido 938,50, mas faturamento bruto (base do Simples) = 1.000,00.
      invoice({ id: 'v2', key: 'kv2', number: '2', model: 'NFSE', series: '', direction: 'SALE', total: 938.5, altTotal: 1000, cfops: [] }),
      // Venda de ativo imobilizado (CFOP 5551): fica fora do faturamento operacional.
      invoice({ id: 'v3', key: 'kv3', number: '3', direction: 'SALE', total: 5000, cfops: [{ cfop: '5551', amount: 5000 }] }),
    ];
    const txs: BankTransaction[] = [
      tx('2025-03-10', 2000, 'VENDA MERCADORIA', { status: 'RECONCILED', accountId: revMerch.id, accountCode: revMerch.code, accountName: revMerch.name }),
      tx('2025-03-20', 938.5, 'PIX CLIENTE SERVICO', { status: 'PENDING' }),
    ];

    const comp = compareBillingWithRevenue({
      invoices: sales,
      transactions: txs,
      accounts: chart,
      range: { start: '2025-03-01', end: '2025-03-31' },
    });
    expect(comp).toMatchObject({
      salesCount: 2,
      invoicedGross: 3000,
      invoicedNet: 2938.5,
      launchedGross: 2000,
      difference: 1000,
      matches: false,
      openSalesCount: 1,
      openSalesTotal: 1000,
      pendingCreditsCount: 1,
      pendingCreditsTotal: 938.5,
      fixedAssetSalesCount: 1,
      fixedAssetSalesTotal: 5000,
    });

    // Conciliando o recebimento da NFS-e pelo bruto (ou lançando os 1000 na receita de serviços), fecha a conferência.
    const txsReconciled: BankTransaction[] = [
      txs[0],
      tx('2025-03-20', 1000, 'SERVICO BRUTO', { status: 'RECONCILED', accountId: revServ.id, accountCode: revServ.code, accountName: revServ.name }),
    ];
    const matched = compareBillingWithRevenue({
      invoices: sales,
      transactions: txsReconciled,
      accounts: chart,
      range: { start: '2025-03-01', end: '2025-03-31' },
    });
    expect(matched.matches).toBe(true);
    expect(matched.difference).toBe(0);
  });
});
