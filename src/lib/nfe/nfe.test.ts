import { describe, expect, it } from 'vitest';
import type { BankTransaction, InvoiceSummary } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { parseNFeXml } from '@/lib/nfe/parser';
import { paymentStateOf, planInvoiceImport } from '@/lib/nfe/import';
import { cfopAccountCode, matchInvoices, nameOverlap, partyEvidence } from '@/lib/nfe/match';

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
<${p}total><${p}ICMSTot><${p}vProd>${total}</${p}vProd><${p}vNF>${total}</${p}vNF></${p}ICMSTot></${p}total>
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
