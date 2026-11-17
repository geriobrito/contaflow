import { describe, expect, it } from 'vitest';
import type { InvoiceSummary } from '@/types/firestore';
import { CCLASSTRIB_ROWS, CCLASSTRIB_SOURCE, IBS_CBS_CST } from '@/lib/nfe/cclasstrib-table';
import { blockedCreditCents, describeCClassTrib, findCClassTrib, isKnownCClassTrib, taxItemIssues } from '@/lib/nfe/cclasstrib';
import { ibsCbsCredit } from '@/lib/nfe/credits';
import { parseNFeXml } from '@/lib/nfe/parser';

describe('tabela oficial de cClassTrib', () => {
  it('foi gerada do repositório da Receita e é coerente', () => {
    expect(CCLASSTRIB_SOURCE.repository).toBe('ReceitaFederal/calculadora-rtc-regime-regular');
    expect(CCLASSTRIB_SOURCE.dbVersion).toMatch(/^V\d{4}$/);
    expect(CCLASSTRIB_ROWS.length).toBeGreaterThan(100);
    for (const [code, cst, description, , , , , from, until] of CCLASSTRIB_ROWS) {
      expect(code).toMatch(/^\d{6}$/);
      // O CST é o começo do cClassTrib e está na tabela de CST do IBS/CBS.
      expect(code.slice(0, 3)).toBe(cst);
      expect(IBS_CBS_CST[cst]).toBeTruthy();
      expect(description.trim()).not.toBe('');
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (until) expect(until >= from).toBe(true);
    }
  });

  it('consulta pela vigência', () => {
    expect(findCClassTrib('000001', '2027-03-01')).toMatchObject({ cst: '000', creditCbs: true, creditIbs: true, presumedCredit: false });
    expect(findCClassTrib('200001', '2027-03-01')).toMatchObject({ creditCbs: false, creditIbs: false });
    // 220001 valeu só em 01/01/2026.
    expect(findCClassTrib('220001', '2026-01-01')).not.toBeNull();
    expect(findCClassTrib('220001', '2027-03-01')).toBeNull();
    expect(findCClassTrib('999999', '2027-03-01')).toBeNull();
    expect(isKnownCClassTrib('220001')).toBe(true);
    expect(isKnownCClassTrib('999999')).toBe(false);
    expect(describeCClassTrib('000001')).toBe('000001 · Situações tributadas integralmente pelo IBS e CBS.');
  });
});

const KEY = '35270311222333000181550010000000011000000011';

/** NF-e com o grupo IBSCBS em cada item. */
function nfeWithItems(items: { cst: string; cClassTrib: string; ibs: string; cbs: string }[]): string {
  const dets = items
    .map(
      (it, i) =>
        `<det nItem="${i + 1}"><prod><CFOP>1102</CFOP><vProd>500.00</vProd></prod><imposto><IBSCBS><CST>${it.cst}</CST><cClassTrib>${it.cClassTrib}</cClassTrib><gIBSCBS><vBC>500.00</vBC><gIBSUF><pIBSUF>0.10</pIBSUF><vIBSUF>${it.ibs}</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${it.ibs}</vIBS><gCBS><pCBS>0.90</pCBS><vCBS>${it.cbs}</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>`
    )
    .join('');
  return `<nfeProc><NFe><infNFe Id="NFe${KEY}"><ide><mod>55</mod><serie>1</serie><nNF>1</nNF><dhEmi>2027-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR</xNome></emit><dest><CNPJ>44555666000181</CNPJ><xNome>CLIENTE</xNome></dest>${dets}
<total><ICMSTot><vNF>1500.00</vNF></ICMSTot><IBSCBSTot><gIBS><vIBS>30.00</vIBS></gIBS><gCBS><vCBS>270.00</vCBS></gCBS></IBSCBSTot></total></infNFe></NFe>
<protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}

describe('IBS/CBS por classificação no XML', () => {
  it('NF-e: soma os itens por cClassTrib e CST', () => {
    const r = parseNFeXml(
      nfeWithItems([
        { cst: '000', cClassTrib: '000001', ibs: '10.00', cbs: '90.00' },
        { cst: '200', cClassTrib: '200001', ibs: '5.00', cbs: '45.00' },
        { cst: '000', cClassTrib: '000001', ibs: '15.00', cbs: '135.00' },
      ])
    );
    expect(r.kind === 'invoice' && r.invoice).toMatchObject({ ibs: 30, cbs: 270 });
    expect(r.kind === 'invoice' && r.invoice.taxItems).toEqual([
      { cClassTrib: '000001', cst: '000', base: 1000, ibs: 25, cbs: 225 },
      { cClassTrib: '200001', cst: '200', base: 500, ibs: 5, cbs: 45 },
    ]);
  });

  it('NF-e sem o grupo nos itens: sem classificação', () => {
    const xml = nfeWithItems([]).replace('</dest>', '</dest><det nItem="1"><prod><CFOP>1102</CFOP><vProd>1500.00</vProd></prod></det>');
    const r = parseNFeXml(xml);
    expect(r.kind === 'invoice' && r.invoice.taxItems).toBeUndefined();
  });

  it('NFS-e: a classificação vem da DPS e o valor dos totais da nota', () => {
    const k = '35503080211222333000181000000000001027010000000001'.slice(0, 50);
    const xml = `<NFSe><infNFSe Id="NFS${k}"><nNFSe>1</nNFSe><cStat>100</cStat><emit><CNPJ>11222333000181</CNPJ><xNome>PRESTADOR</xNome></emit>
<valores><vLiq>1000.00</vLiq></valores><IBSCBS><totCIBS><gIBS><vIBSTot>1.00</vIBSTot></gIBS><gCBS><vCBS>9.00</vCBS></gCBS></totCIBS></IBSCBS>
<DPS><infDPS Id="DPS1"><dhEmi>2027-01-10T15:30:00-03:00</dhEmi><toma><CNPJ>44555666000181</CNPJ><xNome>TOMADOR</xNome></toma>
<valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores>
<IBSCBS><finNFSe>0</finNFSe><valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
</infDPS></DPS></infNFSe></NFSe>`;
    const r = parseNFeXml(xml);
    expect(r.kind === 'invoice' && r.invoice.taxItems).toEqual([{ cClassTrib: '000001', cst: '000', ibs: 1, cbs: 9 }]);
  });
});

const purchase = (items: InvoiceSummary['ibsCbsItems']): Pick<InvoiceSummary, 'direction' | 'issueDate' | 'total' | 'ibs' | 'cbs' | 'ibsCbsItems'> => ({
  direction: 'PURCHASE',
  issueDate: '2027-03-05',
  total: 1500,
  ibs: 30,
  cbs: 270,
  ibsCbsItems: items,
});

describe('crédito pela classificação tributária', () => {
  it('o destaque das classificações sem crédito fica fora do crédito', () => {
    const inv = purchase([
      { cClassTrib: '000001', cst: '000', ibs: 25, cbs: 225 },
      { cClassTrib: '200001', cst: '200', ibs: 5, cbs: 45 },
    ]);
    expect(blockedCreditCents(inv.ibsCbsItems!, inv.issueDate)).toEqual({ ibs: 500, cbs: 4500 });
    const credit = ibsCbsCredit(inv, -1500, 'LUCRO_REAL');
    expect(credit).toMatchObject({ status: 'CREDIT', ibs: 25, cbs: 225, blockedIbs: 5, blockedCbs: 45 });
    expect(credit?.notes).toEqual([expect.stringMatching(/^200001 · .*não dá crédito ao adquirente\.$/)]);
    // Parcela: proporcional, só sobre o que dá crédito.
    expect(ibsCbsCredit(inv, -750, 'LUCRO_REAL')).toMatchObject({ ibs: 12.5, cbs: 112.5 });
  });

  it('nota só com classificação sem crédito: nenhum crédito', () => {
    const inv = { ...purchase([{ cClassTrib: '200001', cst: '200', ibs: 30, cbs: 270 }]) };
    expect(ibsCbsCredit(inv, -1500, 'LUCRO_PRESUMIDO')).toMatchObject({ status: 'NO_CREDIT', ibs: 0, cbs: 0, blockedIbs: 30, blockedCbs: 270 });
  });

  it('sem classificação nos itens, como antes: crédito do destaque inteiro', () => {
    expect(ibsCbsCredit(purchase(undefined), -1500, 'LUCRO_REAL')).toMatchObject({ status: 'CREDIT', ibs: 30, cbs: 270, notes: [] });
  });

  it('classificação desconhecida ou fora de vigência não bloqueia, mas avisa', () => {
    const credit = ibsCbsCredit(purchase([{ cClassTrib: '999999', ibs: 30, cbs: 270 }]), -1500, 'LUCRO_REAL');
    expect(credit).toMatchObject({ status: 'CREDIT', ibs: 30, cbs: 270 });
    expect(credit?.notes[0]).toMatch(/999999 não está na tabela oficial/);
  });
});

describe('conferência das classificações', () => {
  const inv = (items: InvoiceSummary['ibsCbsItems'], direction: InvoiceSummary['direction'] = 'PURCHASE') => ({ issueDate: '2027-03-05', direction, ibsCbsItems: items });

  it('aponta código inexistente, fora de vigência, CST que não confere e crédito presumido', () => {
    const issues = taxItemIssues(
      inv([
        { cClassTrib: '999999', ibs: 1, cbs: 1 },
        { cClassTrib: '220001', cst: '220', ibs: 1, cbs: 1 },
        { cClassTrib: '000001', cst: '200', ibs: 1, cbs: 1 },
        { cClassTrib: '200022', cst: '200', ibs: 0, cbs: 0 },
      ])
    );
    expect(issues.map((i) => i.kind)).toEqual(['unknown', 'out-of-term', 'cst-mismatch', 'presumed-credit']);
    expect(issues[2].message).toBe('CST 200 não confere com o cClassTrib 000001 (CST 000).');
  });

  it('na venda, só a coerência da classificação (crédito é do comprador)', () => {
    expect(taxItemIssues(inv([{ cClassTrib: '200001', cst: '200', ibs: 5, cbs: 45 }], 'SALE'))).toEqual([]);
    expect(taxItemIssues(inv(undefined))).toEqual([]);
  });
});
