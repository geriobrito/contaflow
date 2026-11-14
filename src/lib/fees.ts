import type { FeePayment, FeeRegister } from '@/types/firestore';
import { dayOfMonth, shiftMonth } from '@/lib/business-days';
import { round2 } from '@/lib/money';

/**
 * Honorários do escritório por empresa: valor no tempo (reajustes), vencimento, 13º honorário e
 * recebimentos. Uma cobrança por competência (YYYY-MM); o 13º é a competência `YYYY-13`, que
 * vence junto com a de dezembro.
 */

export type FeeStatus = 'paid' | 'partial' | 'overdue' | 'open';

export interface FeeCharge {
  /** Competência (YYYY-MM) ou `YYYY-13` (13º honorário). */
  month: string;
  label: string;
  amount: number;
  due: string;
  paid: number;
  payments: FeePayment[];
  status: FeeStatus;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const isThirteenth = (month: string) => month.endsWith('-13');
export const feeMonthLabel = (month: string) => (isThirteenth(month) ? `13º/${month.slice(0, 4)}` : `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`);

/** Primeira competência cobrada. */
export const feeStart = (r: Pick<FeeRegister, 'rates'>): string | null =>
  r.rates.length ? r.rates.reduce((min, x) => (x.fromMonth < min ? x.fromMonth : min), r.rates[0].fromMonth) : null;

/** Valor vigente na competência (o 13º vale o de dezembro), ou null antes do início ou depois do fim. */
export function rateFor(r: Pick<FeeRegister, 'rates' | 'endMonth'>, month: string): number | null {
  const base = isThirteenth(month) ? `${month.slice(0, 4)}-12` : month;
  if (r.endMonth && base >= r.endMonth) return null;
  const valid = r.rates.filter((x) => x.fromMonth <= base).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  return valid.length ? valid[valid.length - 1].amount : null;
}

/** Vencimento da cobrança da competência. */
export function feeDue(r: Pick<FeeRegister, 'dueDay' | 'dueNextMonth'>, month: string): string {
  const base = isThirteenth(month) ? `${month.slice(0, 4)}-12` : month;
  return dayOfMonth(r.dueNextMonth ? shiftMonth(base, 1) : base, r.dueDay);
}

/** Cobranças do início do contrato até `untilMonth` (inclusive), mais recentes primeiro. */
export function feeCharges(r: FeeRegister, untilMonth: string, today: string): FeeCharge[] {
  const start = feeStart(r);
  if (!start) return [];
  const months: string[] = [];
  for (let m = start; m <= untilMonth; m = shiftMonth(m, 1)) {
    months.push(m);
    if (r.thirteenth && m.endsWith('-12')) months.push(`${m.slice(0, 4)}-13`);
  }
  const byMonth = new Map<string, FeePayment[]>();
  for (const p of r.payments) byMonth.set(p.month, [...(byMonth.get(p.month) ?? []), p]);
  const charges: FeeCharge[] = [];
  for (const month of months) {
    const amount = rateFor(r, month);
    if (amount === null) continue;
    const payments = byMonth.get(month) ?? [];
    const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
    const due = feeDue(r, month);
    const status: FeeStatus = paid >= amount - 0.005 ? 'paid' : paid > 0.005 ? 'partial' : due < today ? 'overdue' : 'open';
    charges.push({ month, label: feeMonthLabel(month), amount, due, paid, payments, status });
  }
  return charges.reverse();
}

/** Em aberto vencido (inclusive parcial): quantidade e valor que falta. */
export function feeArrears(charges: readonly FeeCharge[], today: string): { count: number; amount: number } {
  const late = charges.filter((c) => c.status !== 'paid' && c.due < today);
  return { count: late.length, amount: round2(late.reduce((s, c) => s + (c.amount - c.paid), 0)) };
}

/**
 * Reajuste do ano ainda não aplicado: já chegou o mês do reajuste, o contrato tem pelo menos
 * 12 meses nessa data e nenhum valor novo começou entre o mês do reajuste e hoje.
 */
export function pendingAdjustment(r: FeeRegister, today: string): { month: string } | null {
  if (!r.adjustmentMonth) return null;
  const start = feeStart(r);
  const year = Number(today.slice(0, 4));
  const month = `${year}-${String(r.adjustmentMonth).padStart(2, '0')}`;
  if (!start || today.slice(0, 7) < month || start > shiftMonth(month, -12)) return null;
  if (r.endMonth && r.endMonth <= today.slice(0, 7)) return null;
  const adjusted = r.rates.some((x) => x.fromMonth >= shiftMonth(month, -1));
  return adjusted ? null : { month };
}

/** Novo valor a partir de `fromMonth`, reajustado em `percent` sobre o vigente antes dele. */
export function applyAdjustment(r: FeeRegister, percent: number, fromMonth: string, note?: string): FeeRegister {
  const current = rateFor({ ...r, endMonth: undefined }, shiftMonth(fromMonth, -1)) ?? rateFor({ ...r, endMonth: undefined }, fromMonth);
  if (current === null) throw new Error('Sem valor vigente para reajustar.');
  const amount = round2(current * (1 + percent / 100));
  const rates = [...r.rates.filter((x) => x.fromMonth !== fromMonth), { fromMonth, amount, ...(note ? { note } : {}) }].sort((a, b) =>
    a.fromMonth.localeCompare(b.fromMonth)
  );
  return { ...r, rates };
}

/** Registra (ou soma) um recebimento da competência. */
export function addPayment(r: FeeRegister, payment: FeePayment): FeeRegister {
  if (!(payment.amount > 0)) throw new Error('Informe o valor recebido.');
  return { ...r, payments: [...r.payments, payment].sort((a, b) => a.month.localeCompare(b.month) || a.paidAt.localeCompare(b.paidAt)) };
}

/** Apaga os recebimentos da competência (desfaz a baixa). */
export const clearPayments = (r: FeeRegister, month: string): FeeRegister => ({ ...r, payments: r.payments.filter((p) => p.month !== month) });

export function newFeeRegister(clientId: string, amount: number, fromMonth: string, dueDay: number, now: string): FeeRegister {
  return { id: clientId, clientId, dueDay, rates: [{ fromMonth, amount: round2(amount) }], payments: [], updatedAt: now };
}

/** Resumo da carteira no mês: honorários contratados, recebidos e em atraso. */
export function feePortfolio(registers: readonly FeeRegister[], month: string, today: string) {
  let monthly = 0;
  let received = 0;
  let arrears = 0;
  let lateClients = 0;
  for (const r of registers) {
    const rate = rateFor(r, month);
    if (rate !== null) monthly += rate;
    const charges = feeCharges(r, month, today);
    received += r.payments.filter((p) => p.paidAt.slice(0, 7) === today.slice(0, 7)).reduce((s, p) => s + p.amount, 0);
    const late = feeArrears(charges, today);
    arrears += late.amount;
    if (late.count > 0) lateClients++;
  }
  return { monthly: round2(monthly), received: round2(received), arrears: round2(arrears), lateClients };
}
