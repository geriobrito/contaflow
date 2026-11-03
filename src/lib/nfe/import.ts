import type { ClientCompany, InvoiceDirection, InvoiceSummary } from '@/types/firestore';
import { parseNFeXml, type InvoiceParty, type ParsedInvoice } from '@/lib/nfe/parser';
import { cleanCNPJ, formatCNPJ } from '@/lib/utils/formatters';

/** Arquivo lido no navegador: só o nome e o texto, o arquivo não é guardado. */
export interface InvoiceFile {
  name: string;
  text: string;
}

export interface InvoiceImportPlan {
  invoices: InvoiceSummary[];
  /** Chaves de notas canceladas pelos eventos importados. */
  cancellations: string[];
  rejected: { file: string; reason: string }[];
  /** Avisos sobre notas aceitas (ex.: XML sem protocolo de autorização). */
  warnings: { file: string; message: string }[];
}

export const invoiceId = (clientId: string, key: string) => `${clientId}_${key}`;

/** Raiz do CNPJ (8 primeiros caracteres): a matriz e as filiais são a mesma empresa. */
const rootOf = (doc: string) => (doc.length === 14 ? doc.slice(0, 8) : doc);
const sameCompany = (a: string, b: string) => Boolean(a) && Boolean(b) && rootOf(a) === rootOf(b);

const describeDoc = (doc: string) => (doc.length === 14 ? formatCNPJ(doc) : doc || 'sem documento');

/**
 * Lado da empresa na nota. Emitente: venda (tpNF 1) ou nota de entrada própria, em que o
 * destinatário é o fornecedor (tpNF 0). Destinatária: compra. Nenhum dos dois: nota de outra empresa.
 */
function sideOf(invoice: ParsedInvoice, clientDoc: string): { direction: InvoiceDirection; counterparty: InvoiceParty | null } | null {
  if (sameCompany(invoice.issuer.doc, clientDoc)) {
    return { direction: invoice.operation === 'IN' ? 'PURCHASE' : 'SALE', counterparty: invoice.recipient };
  }
  // No resumo da distribuição DF-e a destinatária é quem baixou: a própria empresa.
  if (invoice.summaryOnly || sameCompany(invoice.recipient?.doc ?? '', clientDoc)) {
    return { direction: invoice.operation === 'IN' ? 'SALE' : 'PURCHASE', counterparty: invoice.issuer };
  }
  return null;
}

/**
 * Lê os XML e monta os resumos a gravar para a empresa. Notas repetidas no lote entram uma vez;
 * notas de outra empresa, denegadas ou ilegíveis são recusadas com o motivo.
 */
export function planInvoiceImport(files: readonly InvoiceFile[], client: Pick<ClientCompany, 'id' | 'cnpj'>, importedAt: string): InvoiceImportPlan {
  const clientDoc = cleanCNPJ(client.cnpj);
  const plan: InvoiceImportPlan = { invoices: [], cancellations: [], rejected: [], warnings: [] };
  const seen = new Set<string>();

  for (const file of files) {
    const parsed = parseNFeXml(file.text);
    if (parsed.kind === 'unknown') {
      plan.rejected.push({ file: file.name, reason: parsed.reason });
      continue;
    }
    if (parsed.kind === 'cancellation') {
      if (!plan.cancellations.includes(parsed.key)) plan.cancellations.push(parsed.key);
      continue;
    }
    const inv = parsed.invoice;
    if (inv.situation === 'DENIED') {
      plan.rejected.push({ file: file.name, reason: `Nota ${inv.number} não autorizada pela SEFAZ.` });
      continue;
    }
    const side = sideOf(inv, clientDoc);
    if (!side) {
      plan.rejected.push({
        file: file.name,
        reason: `Nota ${inv.number} é de outra empresa: emitente ${describeDoc(inv.issuer.doc)}, destinatário ${describeDoc(inv.recipient?.doc ?? '')}.`,
      });
      continue;
    }
    if (!inv.issueDate || !(inv.total > 0)) {
      plan.rejected.push({ file: file.name, reason: `Nota ${inv.number} sem data de emissão ou valor total.` });
      continue;
    }
    if (seen.has(inv.key)) continue;
    seen.add(inv.key);
    if (inv.situation === 'UNKNOWN') {
      plan.warnings.push({ file: file.name, message: `Nota ${inv.number}: XML sem protocolo de autorização. Confira se ela foi autorizada.` });
    }
    plan.invoices.push({
      id: invoiceId(client.id, inv.key),
      clientId: client.id,
      key: inv.key,
      number: inv.number,
      series: inv.series,
      model: inv.model,
      issueDate: inv.issueDate,
      direction: side.direction,
      counterpartyDoc: side.counterparty?.doc ?? '',
      counterpartyName: side.counterparty?.name ?? '',
      total: inv.total,
      cfops: inv.cfops,
      installments: inv.installments,
      status: inv.situation === 'CANCELLED' ? 'CANCELLED' : 'AUTHORIZED',
      importedAt,
    });
  }

  // Cancelamento no mesmo lote da nota: a nota já entra cancelada.
  const cancelled = new Set(plan.cancellations);
  plan.invoices = plan.invoices.map((i) => (cancelled.has(i.key) ? { ...i, status: 'CANCELLED' } : i));
  return plan;
}

/* =========================================================================
   Situação de pagamento
   ========================================================================= */

export type InvoicePaymentState = 'OPEN' | 'PARTIAL' | 'SETTLED' | 'CANCELLED';

/** Quanto da nota já foi casado com o extrato. */
export function paymentStateOf(invoice: Pick<InvoiceSummary, 'status' | 'total' | 'links'>): InvoicePaymentState {
  if (invoice.status === 'CANCELLED') return 'CANCELLED';
  const paid = Math.round((invoice.links ?? []).reduce((s, l) => s + l.amount, 0) * 100);
  if (paid <= 0) return 'OPEN';
  return paid >= Math.round(invoice.total * 100) ? 'SETTLED' : 'PARTIAL';
}
