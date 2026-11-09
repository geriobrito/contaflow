import type { BankTransaction, ChartAccount, InvoiceInstallment, InvoiceSummary } from '@/types/firestore';
import { textKey } from '@/lib/payee';
import { companyTokens, nameOverlap } from '@/lib/company-name';
import { addDays } from '@/lib/statement';
import { round2, toCents } from '@/lib/money';
import { NFSE_MODEL } from '@/lib/nfe/parser';

/**
 * Casamento de lançamentos do extrato com notas fiscais importadas, e a conta sugerida.
 *
 * Um pagamento (saída) casa com nota de compra; um recebimento (entrada), com nota de venda. O
 * valor tem de ser igual, centavo a centavo, ao total da nota ou a uma parcela da cobrança, e a
 * data cair no prazo: de alguns dias antes da emissão até o vencimento mais uma folga. O parceiro
 * conta a favor quando o CNPJ/CPF aparece na descrição do extrato, ou quando o nome confere.
 * Sem nenhum sinal do parceiro ("Pagamento de boleto"), só vale se for a única nota possível.
 *
 * Cada nota (ou parcela) casa com um lançamento só: os pares de maior pontuação ficam primeiro.
 */

/** Dias antes da emissão em que um pagamento ainda pode ser da nota (adiantamento). */
const DAYS_BEFORE_ISSUE = 7;
/** Folga depois do vencimento da parcela. */
const DAYS_AFTER_DUE = 45;
/** Sem parcelas: prazo depois da emissão. */
const DAYS_AFTER_ISSUE = 90;

export type PartyEvidence = 'document' | 'name' | 'none';
export type SuggestionSource = 'history' | 'cfop';

export interface InvoiceMatch {
  invoice: InvoiceSummary;
  /** Valor casado: o total ou a parcela. */
  amount: number;
  installment?: InvoiceInstallment;
  party: PartyEvidence;
  score: number;
  suggestedAccountId?: string;
  suggestionSource?: SuggestionSource;
}

/* =========================================================================
   Parceiro
   ========================================================================= */

// Comparação de nomes compartilhada com o cadastro de clientes (src/lib/company-name.ts).
export { nameOverlap };

/** Evidência de que o lançamento é do parceiro da nota. */
export function partyEvidence(invoice: Pick<InvoiceSummary, 'counterpartyDoc' | 'counterpartyName'>, memo: string): { party: PartyEvidence; strength: number } {
  const doc = invoice.counterpartyDoc;
  if (doc.length >= 11 && memo.toUpperCase().replace(/[^0-9A-Z]/g, '').includes(doc)) return { party: 'document', strength: 1 };
  const overlap = nameOverlap(invoice.counterpartyName, memo);
  // Uma palavra marcante já basta em nomes curtos ("Claro S.A."); nos longos, metade delas.
  const names = companyTokens(invoice.counterpartyName).length;
  if (overlap > 0 && (overlap >= 0.5 || names <= 2)) return { party: 'name', strength: 0.6 + 0.3 * overlap };
  return { party: 'none', strength: 0 };
}

/* =========================================================================
   Conta sugerida
   ========================================================================= */

/**
 * Conta do modelo do CFC pelo CFOP (3 últimos dígitos).
 *
 * Na compra, o CFOP da nota é o do emitente. Nota do fornecedor (5/6/7: a saída dele) diz o que
 * ele vendeu, não para que a empresa comprou: mercadoria ou insumo vai para o custo, e o contador
 * troca quando for uso e consumo. Nota de entrada da própria empresa (1/2/3) já diz a finalidade.
 */
const SUPPLIER_CFOP: readonly [readonly string[], string][] = [
  [['101', '102', '103', '104', '105', '106', '109', '110', '111', '116', '117', '118', '119', '120', '122', '123', '401', '402', '403', '405'], '3.2.1.01'],
  [['551'], '1.2.3.03'], // bem do ativo do fornecedor: imobilizado da empresa
  [['252', '253', '254', '255', '256', '257', '258'], '3.3.2.06'], // energia elétrica
  [['301', '302', '303', '304', '305', '306', '307'], '3.3.2.08'], // comunicação
  [['351', '352', '353', '354', '355', '356', '357', '359', '360', '932'], '3.3.1.03'], // transporte
  [['655', '656', '667'], '3.3.2.13'], // combustível
  [['933'], '3.3.2.17'], // serviço (ISS) na nota conjugada
];

const PURCHASE_CFOP: readonly [readonly string[], string][] = [
  [['101', '111', '116', '122', '401'], '3.2.1.02'], // insumos para industrialização
  [['102', '113', '117', '118', '121', '403'], '3.2.1.01'], // mercadorias para revenda
  [['126', '128', '407', '556'], '3.3.2.10'], // uso e consumo
  [['406', '551', '552', '553', '554', '555'], '1.2.3.03'], // ativo imobilizado
  [['252', '253', '254', '255', '256', '257'], '3.3.2.06'], // energia elétrica
  [['302', '303', '304', '305', '306'], '3.3.2.08'], // comunicação
  [['352', '353', '354', '355', '356', '932'], '3.3.1.03'], // transporte
  [['653'], '3.3.2.13'], // combustível para consumo
  [['933'], '3.3.2.17'], // serviço (ISS) na nota conjugada
];

const SALE_CFOP: readonly [readonly string[], string][] = [
  [['101', '103', '105', '109', '111', '116', '401', '501'], '3.1.1.03'], // produção própria
  [['102', '104', '106', '108', '110', '113', '115', '117', '118', '119', '120', '123', '403', '405', '502', '656'], '3.1.1.02'], // revenda
  [['124', '125', '933'], '3.1.1.01'], // industrialização para terceiros e serviços
  // Venda de ativo imobilizado: a receita entra na baixa do bem (Bens e Contratos), contra o
  // crédito a receber; o recebimento baixa esse crédito.
  [['551'], '1.1.2.11'],
];

/** NFS-e (sem CFOP): receita de serviços na venda; despesa geral na compra, como o CFOP 933. */
const NFSE_ACCOUNT = { SALE: '3.1.1.01', PURCHASE: '3.3.2.17' } as const;

/** Código do modelo sugerido pelo CFOP de maior valor da nota (ou pelo tipo, na NFS-e), ou null. */
export function cfopAccountCode(invoice: Pick<InvoiceSummary, 'direction' | 'cfops'> & { model?: string }): string | null {
  if (invoice.model === NFSE_MODEL) return NFSE_ACCOUNT[invoice.direction];
  const main = invoice.cfops[0]?.cfop;
  if (!main || main.length !== 4) return null;
  const tail = main.slice(1);
  const issuerSide = '567'.includes(main[0]);
  const table = invoice.direction === 'SALE' ? SALE_CFOP : issuerSide ? SUPPLIER_CFOP : PURCHASE_CFOP;
  return table.find(([tails]) => tails.includes(tail))?.[1] ?? null;
}

/**
 * Conta usada da última vez com o mesmo parceiro e lado (pelas notas já casadas), por documento;
 * sem documento, pelo nome.
 */
export function partnerHistory(invoices: readonly InvoiceSummary[]): Map<string, string> {
  const latest = new Map<string, { accountId: string; at: string }>();
  for (const inv of invoices) {
    const key = partnerKey(inv);
    if (!key) continue;
    for (const l of inv.links ?? []) {
      const prev = latest.get(key);
      if (!prev || l.linkedAt > prev.at) latest.set(key, { accountId: l.accountId, at: l.linkedAt });
    }
  }
  return new Map([...latest].map(([k, v]) => [k, v.accountId]));
}

const partnerKey = (inv: Pick<InvoiceSummary, 'direction' | 'counterpartyDoc' | 'counterpartyName'>) =>
  inv.counterpartyDoc ? `${inv.direction}|${inv.counterpartyDoc}` : inv.counterpartyName ? `${inv.direction}|n:${textKey(inv.counterpartyName)}` : '';

/** Conta sugerida para o lançamento casado: a do histórico do parceiro ou a do CFOP (só contas analíticas do plano). */
export function suggestAccount(
  invoice: InvoiceSummary,
  accounts: readonly ChartAccount[],
  history: ReadonlyMap<string, string>
): { accountId: string; source: SuggestionSource } | null {
  const usable = (a: ChartAccount | undefined) => a && a.nature === 'ANALYTIC';
  const fromHistory = history.get(partnerKey(invoice));
  if (fromHistory && usable(accounts.find((a) => a.id === fromHistory))) return { accountId: fromHistory, source: 'history' };
  const code = cfopAccountCode(invoice);
  const byCfop = code ? accounts.find((a) => a.code === code) : undefined;
  return byCfop && usable(byCfop) ? { accountId: byCfop.id, source: 'cfop' } : null;
}

/* =========================================================================
   Casamento
   ========================================================================= */

interface Slot {
  invoice: InvoiceSummary;
  cents: number;
  installment?: InvoiceInstallment;
  from: string;
  to: string;
  /** Data mais provável do pagamento: o vencimento ou a emissão. */
  target: string;
}

/** Valores da nota ainda em aberto: parcelas (ou o total) sem lançamento casado, fora o próprio. */
function openSlots(invoice: InvoiceSummary, ignoreTransactionId?: string): Slot[] {
  const used = (invoice.links ?? []).filter((l) => l.transactionId !== ignoreTransactionId).map((l) => toCents(l.amount));
  const take = (cents: number) => {
    const i = used.indexOf(cents);
    if (i < 0) return true;
    used.splice(i, 1);
    return false;
  };
  const from = addDays(invoice.issueDate, -DAYS_BEFORE_ISSUE);
  if (invoice.installments.length) {
    return invoice.installments
      .filter((p) => take(toCents(p.amount)))
      .map((p) => ({ invoice, cents: toCents(p.amount), installment: p, from, to: addDays(p.dueDate, DAYS_AFTER_DUE), target: p.dueDate }));
  }
  // Sem parcelas: o total ou o valor alternativo (serviço sem retenção, total com IBS/CBS).
  // Um pagamento de qualquer dos dois quita a nota.
  const amounts = [toCents(invoice.total), ...(invoice.altTotal ? [toCents(invoice.altTotal)] : [])];
  if (amounts.some((c) => used.includes(c))) return [];
  const to = addDays(invoice.issueDate, DAYS_AFTER_ISSUE);
  return amounts.map((cents) => ({ invoice, cents, from, to, target: invoice.issueDate }));
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Notas casadas com os lançamentos ainda não conciliados (pendentes ou aguardando aprovação).
 * Lançamentos já conciliados não recebem sugestão; a nota vinculada a eles sai em `linkedInvoices`.
 */
export function matchInvoices(
  transactions: readonly BankTransaction[],
  invoices: readonly InvoiceSummary[],
  accounts: readonly ChartAccount[]
): Map<string, InvoiceMatch> {
  const active = invoices.filter((i) => i.status === 'AUTHORIZED');
  const history = partnerHistory(invoices);
  const candidates: { tx: BankTransaction; slot: Slot; party: PartyEvidence; score: number; slotKey: string }[] = [];

  for (const tx of transactions) {
    if (tx.status === 'RECONCILED' || !tx.amount) continue;
    const direction = tx.amount < 0 ? 'PURCHASE' : 'SALE';
    const cents = Math.abs(toCents(tx.amount));
    const found: typeof candidates = [];
    for (const inv of active) {
      if (inv.direction !== direction) continue;
      for (const slot of openSlots(inv, tx.id)) {
        if (slot.cents !== cents || tx.date < slot.from || tx.date > slot.to) continue;
        const { party, strength } = partyEvidence(inv, tx.memo);
        const closeness = 1 - Math.min(dayDiff(tx.date, slot.target), 60) / 60;
        found.push({
          tx,
          slot,
          party,
          score: (party === 'none' ? 0.3 : strength) * 0.7 + closeness * 0.3,
          // O total e o valor alternativo são a mesma vaga: só um lançamento casa com eles.
          slotKey: slot.installment ? `${inv.id}|${slot.installment.number ?? slot.installment.dueDate}|${slot.cents}` : `${inv.id}|total`,
        });
      }
    }
    // Sem sinal do parceiro, só a nota única daquele valor e prazo.
    const withParty = found.filter((c) => c.party !== 'none');
    candidates.push(...(withParty.length ? withParty : found.length === 1 ? found : []));
  }

  candidates.sort((a, b) => b.score - a.score || a.tx.id.localeCompare(b.tx.id));
  const out = new Map<string, InvoiceMatch>();
  const usedSlots = new Set<string>();
  for (const c of candidates) {
    if (out.has(c.tx.id) || usedSlots.has(c.slotKey)) continue;
    usedSlots.add(c.slotKey);
    const suggestion = suggestAccount(c.slot.invoice, accounts, history);
    out.set(c.tx.id, {
      invoice: c.slot.invoice,
      amount: c.slot.cents / 100,
      ...(c.slot.installment ? { installment: c.slot.installment } : {}),
      party: c.party,
      score: round2(c.score),
      ...(suggestion ? { suggestedAccountId: suggestion.accountId, suggestionSource: suggestion.source } : {}),
    });
  }
  return out;
}

/** Nota vinculada a cada lançamento já confirmado (pelos vínculos gravados nas notas). */
export function linkedInvoices(invoices: readonly InvoiceSummary[]): Map<string, InvoiceSummary> {
  const out = new Map<string, InvoiceSummary>();
  for (const inv of invoices) for (const l of inv.links ?? []) out.set(l.transactionId, inv);
  return out;
}
