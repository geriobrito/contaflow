import type { ChartAccount, JournalEntry, JournalEntryLine } from '@/types/firestore';
import { isISODate, MONTH_NAMES } from '@/lib/periods';
import { fromCents, toCents } from '@/lib/money';

/**
 * Máximo de partidas por lançamento manual. As regras do Firestore não têm laços: somam
 * as partidas uma a uma (`linesNet` em firestore.rules), e este é o teto de lá.
 */
export const MAX_JOURNAL_LINES = 20;

/** Totais de débito e crédito das partidas, somados em centavos. */
export function journalTotals(lines: readonly Pick<JournalEntryLine, 'type' | 'amount'>[]): {
  debit: number;
  credit: number;
  difference: number;
} {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const value = toCents(Number(l.amount) || 0);
    if (l.type === 'DEBIT') debit += value;
    else credit += value;
  }
  return { debit: debit / 100, credit: credit / 100, difference: Math.abs(debit - credit) / 100 };
}

/**
 * Primeiro problema que impede gravar o lançamento, ou null se ele respeita as partidas
 * dobradas. As regras (`validJournal` em firestore.rules) conferem data, quantidade de
 * partidas e débito = crédito; conta e valor positivo por partida são conferidos só aqui.
 */
export function journalEntryProblem(entry: Pick<JournalEntry, 'date' | 'lines'>): string | null {
  if (!isISODate(entry.date)) return 'Informe uma data válida para o lançamento.';
  const { lines } = entry;
  if (lines.length < 2) return 'Adicione pelo menos 2 partidas (débito e crédito).';
  if (lines.length > MAX_JOURNAL_LINES) {
    return `Um lançamento aceita no máximo ${MAX_JOURNAL_LINES} partidas. Divida-o em dois lançamentos.`;
  }
  for (const [i, l] of lines.entries()) {
    if (!l.accountId) return `A linha #${i + 1} está sem conta contábil selecionada.`;
    if (l.type !== 'DEBIT' && l.type !== 'CREDIT') return `A linha #${i + 1} não é débito nem crédito.`;
    if (!Number.isFinite(l.amount) || l.amount <= 0) return `A linha #${i + 1} possui valor zerado ou inválido.`;
  }
  const { debit, difference } = journalTotals(lines);
  if (debit <= 0) return 'O lançamento precisa de ao menos um débito e um crédito.';
  if (difference > 0) {
    return `O lançamento está desbalanceado em R$ ${difference.toFixed(2).replace('.', ',')}. Débitos e créditos devem ser iguais.`;
  }
  return null;
}

/** Recusa lançamentos que não fecham; os repositórios chamam antes de gravar. */
export function assertValidJournalEntry(entry: Pick<JournalEntry, 'date' | 'lines'>): void {
  const problem = journalEntryProblem(entry);
  if (problem) throw new Error(problem);
}

/* =========================================================================
   Comprovante (link)
   ========================================================================= */

const MAX_ATTACHMENT_URL = 2000;
const FILE_EXTENSIONS = /\.(pdf|jpe?g|png|gif|docx?|xlsx?|csv|txt|zip|rar|xml|ofx)$/i;

/**
 * Link do comprovante de um lançamento: `null` se vazio, o endereço normalizado (com
 * `https://` quando faltar) e o site, ou o motivo de não servir. Só http/https: um caminho
 * do computador ou um nome de arquivo não abre em outro aparelho, e outros esquemas
 * (`javascript:`, `data:`) não são links de documento.
 */
export function parseAttachmentUrl(raw: string): { url: string; host: string } | { problem: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > MAX_ATTACHMENT_URL) return { problem: 'Link longo demais.' };
  if (/^[a-z]:[\\/]/i.test(text) || /^(\\\\|\/|~|file:)/i.test(text)) {
    return { problem: 'Isto é um caminho do computador. Envie o documento para a nuvem (Drive, OneDrive…) e cole o link de compartilhamento.' };
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (!hasScheme && !text.includes('/') && FILE_EXTENSIONS.test(text)) {
    return { problem: 'Isto parece o nome de um arquivo. Cole o link de compartilhamento do documento (https://…).' };
  }
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return { problem: 'Link inválido. Cole o endereço completo do documento (https://…).' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { problem: 'Use um link que comece com https://.' };
  if (!parsed.hostname.includes('.')) return { problem: 'Link inválido. Cole o endereço completo do documento (https://…).' };
  return { url: parsed.href, host: parsed.hostname.replace(/^www\./, '') };
}

/* =========================================================================
   Recorrência mensal ("repetir do mês anterior")
   ========================================================================= */

/** Categorias que costumam se repetir todo mês: vêm marcadas ao repetir. */
const RECURRING_CATEGORIES: ReadonlySet<JournalEntry['category']> = new Set(['PAYROLL', 'DEPRECIATION', 'TAX', 'PROVISION']);

/** Competência (YYYY-MM) anterior. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Mesmo dia na competência `targetMonth`; dia que não existe nela (31 em fevereiro) vira o último. */
export function sameDayIn(date: string, targetMonth: string): string {
  const [y, m] = targetMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${targetMonth}-${String(Math.min(Number(date.slice(8, 10)) || last, last)).padStart(2, '0')}`;
}

/**
 * Troca no texto as menções à competência `from` pelas de `to`, nos formatos usados nos
 * históricos e documentos: `2025-04`, `04/2025`, `04-2025`, `abril/2025`, `abril de 2025`.
 */
export function shiftCompetence(text: string, from: string, to: string): string {
  const [fy, fm] = from.split('-');
  const [ty, tm] = to.split('-');
  const name = (mm: string) => MONTH_NAMES[Number(mm) - 1] ?? '';
  const keepCase = (original: string, replacement: string) =>
    original === original.toUpperCase()
      ? replacement.toUpperCase()
      : original[0] === original[0].toUpperCase()
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement;
  return text
    .replaceAll(`${fy}-${fm}`, `${ty}-${tm}`)
    .replace(new RegExp(`(?<![0-9])${fm}([/-])${fy}(?![0-9])`, 'g'), `${tm}$1${ty}`)
    .replace(new RegExp(`(?<![A-Za-zÀ-ÿ])(${name(fm)})(\\s+de\\s+|\\s*/\\s*)${fy}(?![0-9])`, 'gi'), (_, word: string, sep: string) => `${keepCase(word, name(tm))}${sep}${ty}`);
}

export interface RepeatCandidate {
  entry: JournalEntry;
  /** Vem marcado: é de categoria recorrente ou já foi, ele próprio, repetido de um mês anterior. */
  suggested: boolean;
  /** Motivo de não poder ser repetido (conta que saiu do plano), ou null. */
  problem: string | null;
}

/**
 * Lançamentos manuais da competência anterior a `targetMonth` que ainda não foram repetidos
 * nela, do mais antigo para o mais recente.
 */
export function repeatCandidates(
  entries: readonly JournalEntry[],
  targetMonth: string,
  accounts: readonly { id: string; nature: string }[]
): RepeatCandidate[] {
  const source = previousMonth(targetMonth);
  const done = new Set(entries.filter((e) => e.date.startsWith(targetMonth) && e.repeatedFromId).map((e) => e.repeatedFromId));
  const analytic = new Set(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => a.id));
  return entries
    // Encerramento do exercício não se repete: é gerado pela rotina própria, uma vez por ano.
    .filter((e) => e.date.startsWith(source) && !done.has(e.id) && !e.yearClosing)
    .sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber)
    .map((entry) => {
      const missing = entry.lines.find((l) => !analytic.has(l.accountId));
      return {
        entry,
        suggested: !missing && (Boolean(entry.repeatedFromId) || RECURRING_CATEGORIES.has(entry.category)),
        problem: missing ? `${['A conta', missing.accountCode, missing.accountName].filter(Boolean).join(' ')} não aceita mais lançamentos.` : null,
      };
    });
}

/* =========================================================================
   Modelos de lançamento (provisões mensais por competência)
   ========================================================================= */

export type JournalTemplateId = 'PAYROLL' | 'PRO_LABORE' | 'DAS' | 'DEPRECIATION' | 'CREDIT_SALES';

export interface JournalTemplateField {
  key: string;
  label: string;
  hint?: string;
  /** Pode ficar em branco (zero): a partida correspondente sai do lançamento. */
  optional?: boolean;
}

type TemplateValues = Readonly<Record<string, number>>;

interface JournalTemplateLine {
  /** Conta do modelo de plano de contas (CFC). */
  code: string;
  type: 'DEBIT' | 'CREDIT';
  memo: string;
  /** Valor em centavos a partir dos campos (também em centavos). */
  cents: (v: TemplateValues) => number;
}

export interface JournalTemplate {
  id: JournalTemplateId;
  label: string;
  description: string;
  category: JournalEntry['category'];
  fields: readonly JournalTemplateField[];
  lines: readonly JournalTemplateLine[];
  /** Histórico e documento citam a competência (MM/AAAA, AAAA-MM): "Repetir do mês anterior" os atualiza. */
  memo: (competence: string) => string;
  documentRef: (month: string) => string;
}

const v = (values: TemplateValues, key: string) => values[key] ?? 0;

/**
 * Provisões mensais por competência, nas contas do modelo de plano de contas. O extrato mostra
 * só o caixa: estes lançamentos põem no mês a despesa ou a receita que ele ainda não pagou ou
 * recebeu. Quando o pagamento sai no banco, ele é classificado na conta "a pagar" (ou "a receber").
 */
export const JOURNAL_TEMPLATES: readonly JournalTemplate[] = [
  {
    id: 'PAYROLL',
    label: 'Folha de pagamento',
    description: 'Salários do mês com os descontos dos empregados e os encargos (FGTS e, se houver, INSS patronal).',
    category: 'PAYROLL',
    fields: [
      { key: 'gross', label: 'Salários brutos' },
      { key: 'inss', label: 'INSS descontado dos empregados', optional: true },
      { key: 'irrf', label: 'IRRF descontado dos empregados', optional: true },
      { key: 'fgts', label: 'FGTS do mês', hint: '8% da remuneração', optional: true },
      { key: 'cpp', label: 'INSS patronal', hint: 'Em branco no Simples Nacional, exceto no Anexo IV', optional: true },
    ],
    lines: [
      { code: '3.3.2.01', type: 'DEBIT', memo: 'Salários do mês', cents: (x) => v(x, 'gross') },
      { code: '2.1.1.01', type: 'CREDIT', memo: 'Salários líquidos a pagar', cents: (x) => v(x, 'gross') - v(x, 'inss') - v(x, 'irrf') },
      { code: '2.1.1.03', type: 'CREDIT', memo: 'INSS descontado dos empregados', cents: (x) => v(x, 'inss') },
      { code: '2.1.5.04', type: 'CREDIT', memo: 'IRRF sobre salários', cents: (x) => v(x, 'irrf') },
      { code: '3.3.2.03', type: 'DEBIT', memo: 'FGTS do mês', cents: (x) => v(x, 'fgts') },
      { code: '2.1.1.04', type: 'CREDIT', memo: 'FGTS a recolher', cents: (x) => v(x, 'fgts') },
      { code: '3.3.2.03', type: 'DEBIT', memo: 'INSS patronal do mês', cents: (x) => v(x, 'cpp') },
      { code: '2.1.1.03', type: 'CREDIT', memo: 'INSS patronal a recolher', cents: (x) => v(x, 'cpp') },
    ],
    memo: (c) => `Provisão da folha de pagamento - competência ${c}`,
    documentRef: (m) => `FOLHA-${m}`,
  },
  {
    id: 'PRO_LABORE',
    label: 'Pró-labore',
    description: 'Remuneração dos sócios com o INSS (11%) e o IRRF retidos.',
    category: 'PAYROLL',
    fields: [
      { key: 'gross', label: 'Pró-labore bruto' },
      { key: 'inss', label: 'INSS retido do sócio', hint: '11% do pró-labore, até o teto', optional: true },
      { key: 'irrf', label: 'IRRF retido', optional: true },
      { key: 'cpp', label: 'INSS patronal (20%)', hint: 'Em branco no Simples Nacional, exceto no Anexo IV', optional: true },
    ],
    lines: [
      { code: '3.3.2.02', type: 'DEBIT', memo: 'Pró-labore do mês', cents: (x) => v(x, 'gross') },
      { code: '2.1.1.02', type: 'CREDIT', memo: 'Pró-labore líquido a pagar', cents: (x) => v(x, 'gross') - v(x, 'inss') - v(x, 'irrf') },
      { code: '2.1.1.03', type: 'CREDIT', memo: 'INSS retido do sócio', cents: (x) => v(x, 'inss') },
      { code: '2.1.5.04', type: 'CREDIT', memo: 'IRRF sobre pró-labore', cents: (x) => v(x, 'irrf') },
      { code: '3.3.2.03', type: 'DEBIT', memo: 'INSS patronal sobre pró-labore', cents: (x) => v(x, 'cpp') },
      { code: '2.1.1.03', type: 'CREDIT', memo: 'INSS patronal a recolher', cents: (x) => v(x, 'cpp') },
    ],
    memo: (c) => `Provisão do pró-labore - competência ${c}`,
    documentRef: (m) => `PROLABORE-${m}`,
  },
  {
    id: 'DAS',
    label: 'DAS do Simples Nacional',
    description: 'Simples Nacional apurado sobre o faturamento do mês, pago no mês seguinte.',
    category: 'TAX',
    fields: [{ key: 'amount', label: 'Valor do DAS (PGDAS-D)' }],
    lines: [
      { code: '3.1.2.01', type: 'DEBIT', memo: 'Simples Nacional sobre o faturamento', cents: (x) => v(x, 'amount') },
      { code: '2.1.5.01', type: 'CREDIT', memo: 'Simples Nacional a recolher', cents: (x) => v(x, 'amount') },
    ],
    memo: (c) => `Provisão do Simples Nacional (DAS) - competência ${c}`,
    documentRef: (m) => `DAS-${m}`,
  },
  {
    id: 'DEPRECIATION',
    label: 'Depreciação',
    description: 'Depreciação mensal do imobilizado.',
    category: 'DEPRECIATION',
    fields: [{ key: 'amount', label: 'Depreciação do mês' }],
    lines: [
      { code: '3.3.2.15', type: 'DEBIT', memo: 'Depreciação do mês', cents: (x) => v(x, 'amount') },
      { code: '1.2.3.07', type: 'CREDIT', memo: '(-) Depreciação acumulada', cents: (x) => v(x, 'amount') },
    ],
    memo: (c) => `Depreciação do imobilizado - competência ${c}`,
    documentRef: (m) => `DEPREC-${m}`,
  },
  {
    id: 'CREDIT_SALES',
    label: 'Faturamento a prazo',
    description: 'Notas emitidas no mês e ainda não recebidas. O recebimento no extrato vai para 1.1.2.01 Clientes.',
    category: 'PROVISION',
    fields: [
      { key: 'services', label: 'Serviços faturados a prazo', optional: true },
      { key: 'goods', label: 'Mercadorias vendidas a prazo', optional: true },
    ],
    lines: [
      { code: '1.1.2.01', type: 'DEBIT', memo: 'Clientes a receber', cents: (x) => v(x, 'services') + v(x, 'goods') },
      { code: '3.1.1.01', type: 'CREDIT', memo: 'Receita de serviços faturados a prazo', cents: (x) => v(x, 'services') },
      { code: '3.1.1.02', type: 'CREDIT', memo: 'Receita de vendas a prazo', cents: (x) => v(x, 'goods') },
    ],
    memo: (c) => `Faturamento a prazo - competência ${c}`,
    documentRef: (m) => `FAT-${m}`,
  },
];

export type TemplateDraft = Pick<JournalEntry, 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef'>;

/**
 * Lançamento de um modelo com os valores informados (em reais), nas contas do plano do cliente.
 * Partidas zeradas saem; conta que falta no plano ou valor que não fecha viram `problem`.
 */
export function templateDraft(
  template: JournalTemplate,
  values: Readonly<Record<string, number>>,
  accounts: readonly ChartAccount[],
  date: string
): { draft: TemplateDraft | null; problem: string | null } {
  const cents: Record<string, number> = Object.fromEntries(Object.entries(values).map(([k, n]) => [k, toCents(n || 0)]));
  const missing = template.fields.find((f) => !f.optional && !cents[f.key]);
  if (missing) return { draft: null, problem: `Informe ${missing.label.toLowerCase()}.` };

  const byCode = new Map(accounts.filter((a) => a.nature === 'ANALYTIC').map((a) => [a.code, a] as const));
  const lines: JournalEntryLine[] = [];
  for (const [i, l] of template.lines.entries()) {
    const amount = l.cents(cents);
    if (amount === 0) continue;
    if (amount < 0) return { draft: null, problem: `“${l.memo}” ficaria negativo: os descontos passam do valor bruto.` };
    const acc = byCode.get(l.code);
    if (!acc) return { draft: null, problem: `A conta ${l.code} não está no plano como analítica. Complete o plano com o modelo em Plano de Contas.` };
    lines.push({ id: `t${i + 1}`, accountId: acc.id, accountCode: acc.code, accountName: acc.name, type: l.type, amount: fromCents(amount), memo: l.memo });
  }
  const month = date.slice(0, 7);
  const draft: TemplateDraft = {
    date,
    memo: template.memo(`${month.slice(5, 7)}/${month.slice(0, 4)}`),
    category: template.category,
    lines,
    totalAmount: journalTotals(lines).debit,
    documentRef: template.documentRef(month),
  };
  const problem = journalEntryProblem(draft);
  return problem ? { draft: null, problem } : { draft, problem: null };
}

/**
 * Cópia de `entry` para a competência `targetMonth`: mesmas partidas e valores, mesmo dia do
 * mês, histórico e documento com a competência atualizada. O comprovante não é copiado (é do
 * mês de origem). Número, autor e datas de gravação ficam com quem grava.
 */
export function repeatDraft(
  entry: JournalEntry,
  targetMonth: string
): Pick<JournalEntry, 'clientId' | 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'repeatedFromId'> {
  const source = entry.date.slice(0, 7);
  const shift = (text: string) => shiftCompetence(text, source, targetMonth);
  return {
    clientId: entry.clientId,
    date: sameDayIn(entry.date, targetMonth),
    memo: shift(entry.memo),
    category: entry.category,
    lines: entry.lines.map((l) => ({ ...l, ...(l.memo ? { memo: shift(l.memo) } : {}) })),
    totalAmount: entry.totalAmount,
    ...(entry.documentRef ? { documentRef: shift(entry.documentRef) } : {}),
    repeatedFromId: entry.id,
  };
}
