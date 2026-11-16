import type { ChartAccount, JournalEntry } from '@/types/firestore';
import { fromCents, toCents } from '@/lib/money';
import { yearClosingLockedMessage } from '@/lib/year-closing';

/**
 * Leitura do Diário na tela de lançamentos manuais: de onde vem cada lançamento, o estorno e o
 * efeito no resultado. Fica fora de journal.ts porque depende do encerramento do exercício, que
 * por sua vez depende de journal.ts.
 */

/* =========================================================================
   Origem do lançamento (manual ou gerado por uma rotina)
   ========================================================================= */

export interface JournalOrigin {
  /** Marca na lista (ex.: "Gerado pelo Imobilizado"). */
  label: string;
  /** Tela que gera o lançamento, e o endereço dela já na competência do lançamento. */
  screen: string;
  href: string;
  /** Por que não se altera aqui, e onde alterar. */
  howToChange: string;
}

/**
 * De onde vem o lançamento: null para o manual (alterado nesta tela), ou a rotina que o gerou
 * (depreciação, apólice, contrato, rendimento, CMV, folha, encerramento do exercício). O gerado
 * só muda na tela de origem: aqui ele aparece para conferência, com o caminho até lá.
 */
export function journalOrigin(entry: JournalEntry): JournalOrigin | null {
  const n = `O lançamento #${entry.entryNumber}`;
  const mes = `?mes=${entry.date.slice(0, 7)}`;
  if (entry.yearClosing) {
    return { label: `Encerramento de ${entry.yearClosing}`, screen: 'Balanço', href: '/balanco', howToChange: yearClosingLockedMessage(entry) };
  }
  if (entry.depreciationMonth || entry.fixedAssetId) {
    return {
      label: entry.fixedAssetId ? 'Baixa de bem · Imobilizado' : 'Gerado pelo Imobilizado',
      screen: 'Imobilizado',
      href: `/imobilizado${mes}`,
      howToChange: `${n} é gerado pelo cadastro do imobilizado: altere o bem na tela Imobilizado, e o lançamento ${entry.fixedAssetId ? 'da baixa acompanha' : 'é atualizado ao lançar a depreciação do mês'}.`,
    };
  }
  if (entry.financingMonth || entry.financingId) {
    return {
      label: entry.financingId ? 'Contrato · Financiamentos' : 'Juros · Financiamentos',
      screen: 'Empréstimos e financiamentos',
      href: `/financiamentos${mes}`,
      howToChange: `${n} é gerado pelos contratos de empréstimo e financiamento: altere o contrato em Bens e Contratos › Empréstimos e financiamentos.`,
    };
  }
  if (entry.stockMonth) {
    return {
      label: 'CMV · Estoque',
      screen: 'Estoque e CMV',
      href: `/estoque${mes}`,
      howToChange: `${n} é o CMV gerado pelo estoque final informado: corrija o estoque em Bens e Contratos › Estoque e CMV e lance o CMV do mês de novo.`,
    };
  }
  if (entry.investmentMonth) {
    return {
      label: 'Rendimento · Aplicações financeiras',
      screen: 'Aplicações financeiras',
      href: `/aplicacoes${mes}`,
      howToChange: `${n} é o rendimento gerado pelos saldos das aplicações: corrija o saldo em Bens e Contratos › Aplicações financeiras e lance o rendimento do mês de novo.`,
    };
  }
  if (entry.prepaidMonth || entry.prepaidId) {
    return {
      label: entry.prepaidId ? 'Apólice · Despesas antecipadas' : 'Apropriação · Despesas antecipadas',
      screen: 'Seguros e despesas antecipadas',
      href: `/despesas-antecipadas${mes}`,
      howToChange: `${n} é gerado pelas despesas antecipadas: altere a apólice em Bens e Contratos › Seguros e despesas antecipadas.`,
    };
  }
  if (entry.payrollMonth) {
    return {
      label: 'Provisão · Folha de pagamento',
      screen: 'Folha de Pagamento',
      href: `/folha${mes}`,
      howToChange: `${n} é a provisão da folha de pagamento: altere o resumo na tela Folha de Pagamento.`,
    };
  }
  return null;
}

/* =========================================================================
   Estorno
   ========================================================================= */

const dateBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Estorno de `entry` na data `date`: as mesmas contas e valores com débito e crédito trocados,
 * e o histórico citando o lançamento estornado. É a correção de um lançamento de competência
 * fechada, que não pode mais ser alterado nem excluído: o erro fica no Diário e o estorno o
 * anula na competência aberta. O comprovante não é copiado.
 */
export function reversalDraft(
  entry: JournalEntry,
  date: string
): Pick<JournalEntry, 'clientId' | 'date' | 'memo' | 'category' | 'lines' | 'totalAmount' | 'documentRef' | 'reversalOfId'> {
  return {
    clientId: entry.clientId,
    date,
    memo: `Estorno do lançamento #${entry.entryNumber} de ${dateBR(entry.date)}: ${entry.memo}`,
    category: entry.category,
    lines: entry.lines.map((l, i) => ({ ...l, id: `e${i + 1}`, type: l.type === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const) })),
    totalAmount: entry.totalAmount,
    ...(entry.documentRef ? { documentRef: entry.documentRef } : {}),
    reversalOfId: entry.id,
  };
}

/** Para cada lançamento estornado, o estorno dele (o mais antigo, se houver mais de um). */
export function reversalsByOriginal(entries: readonly JournalEntry[]): Map<string, JournalEntry> {
  const out = new Map<string, JournalEntry>();
  for (const e of [...entries].sort((a, b) => a.entryNumber - b.entryNumber)) {
    if (e.reversalOfId && !out.has(e.reversalOfId)) out.set(e.reversalOfId, e);
  }
  return out;
}

/**
 * Motivo de não poder estornar, ou null. Só o lançamento manual é estornado aqui: o gerado por
 * uma rotina é corrigido na tela de origem, que o regrava.
 */
export function reversalProblem(entry: JournalEntry, reversedBy: ReadonlyMap<string, JournalEntry>): string | null {
  const origin = journalOrigin(entry);
  if (origin) return origin.howToChange;
  const done = reversedBy.get(entry.id);
  if (done) return `O lançamento #${entry.entryNumber} já foi estornado pelo #${done.entryNumber}, de ${dateBR(done.date)}.`;
  return null;
}

/* =========================================================================
   Efeito no resultado
   ========================================================================= */

const RESULT_TYPES: ReadonlySet<string> = new Set(['REVENUE', 'COST', 'EXPENSE']);

/**
 * Quanto os lançamentos mudam o resultado do período (em reais): créditos menos débitos nas
 * contas de resultado. Positivo aumenta o lucro; negativo reduz. O encerramento do exercício
 * fica de fora (zera as contas de resultado sem ser receita nem despesa).
 */
export function resultEffect(entries: readonly JournalEntry[], accounts: readonly Pick<ChartAccount, 'id' | 'type'>[]): number {
  const result = new Set(accounts.filter((a) => RESULT_TYPES.has(a.type)).map((a) => a.id));
  let cents = 0;
  for (const e of entries) {
    if (e.yearClosing) continue;
    for (const l of e.lines) {
      if (!result.has(l.accountId)) continue;
      const value = toCents(Number(l.amount) || 0);
      cents += l.type === 'CREDIT' ? value : -value;
    }
  }
  return fromCents(cents);
}
