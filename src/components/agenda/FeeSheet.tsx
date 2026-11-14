'use client';

import { useMemo, useState } from 'react';
import type { ClientCompany, FeeRegister } from '@/types/firestore';
import { addPayment, applyAdjustment, clearPayments, feeCharges, newFeeRegister, pendingAdjustment, rateFor } from '@/lib/fees';
import { parseMoney } from '@/lib/csv/parser';
import { round2 } from '@/lib/money';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { describeError } from '@/lib/utils/errors';
import { BUTTON, Field, INPUT, INPUT_COMPACT, INPUT_MONEY, IOSSwitch, OVERLINE, Sheet } from '@/components/ui/primitives';

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const STATUS_LABEL = { paid: 'Pago', partial: 'Parcial', overdue: 'Atrasado', open: 'A vencer' } as const;
const STATUS_CLASS = {
  paid: 'text-emerald-700 dark:text-emerald-400',
  partial: 'text-amber-700 dark:text-amber-400',
  overdue: 'text-rose-600 dark:text-rose-400',
  open: 'text-stone-500',
} as const;

/** Contrato de honorários da empresa: dados, reajuste e recebimentos dos últimos meses. */
export function FeeSheet({
  client,
  register,
  today,
  onSave,
  onClose,
}: {
  client: ClientCompany;
  register: FeeRegister | null;
  today: string;
  onSave: (next: FeeRegister) => Promise<void>;
  onClose: () => void;
}) {
  const month = today.slice(0, 7);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Contrato (novo ou edição dos dados fixos).
  const [amount, setAmount] = useState(register ? String(rateFor(register, month) ?? register.rates[register.rates.length - 1].amount).replace('.', ',') : '');
  const [fromMonth, setFromMonth] = useState(register?.rates[0]?.fromMonth ?? month);
  const [dueDay, setDueDay] = useState(String(register?.dueDay ?? 10));
  const [dueNextMonth, setDueNextMonth] = useState(Boolean(register?.dueNextMonth));
  const [adjustmentMonth, setAdjustmentMonth] = useState(String(register?.adjustmentMonth ?? ''));
  const [adjustmentIndex, setAdjustmentIndex] = useState(register?.adjustmentIndex ?? '');
  const [thirteenth, setThirteenth] = useState(Boolean(register?.thirteenth));
  const [endMonth, setEndMonth] = useState(register?.endMonth ?? '');

  // Reajuste.
  const pending = register ? pendingAdjustment(register, today) : null;
  const [percent, setPercent] = useState('');
  const [adjustFrom, setAdjustFrom] = useState(pending?.month ?? month);

  const charges = useMemo(() => (register ? feeCharges(register, month, today).slice(0, 14) : []), [register, month, today]);

  const run = async (next: FeeRegister) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      return true;
    } catch (e) {
      setError(`Não foi possível gravar (${describeError(e)}).`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveContract = async () => {
    const day = Number(dueDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError('Dia do vencimento entre 1 e 31.');
    const now = new Date().toISOString();
    let next: FeeRegister;
    if (!register) {
      const value = parseMoney(amount);
      if (value === null || value <= 0) return setError('Informe o valor do honorário.');
      next = newFeeRegister(client.id, value, fromMonth, day, now);
    } else {
      next = { ...register };
    }
    next = {
      ...next,
      dueDay: day,
      dueNextMonth: dueNextMonth || undefined,
      adjustmentMonth: adjustmentMonth ? Number(adjustmentMonth) : undefined,
      adjustmentIndex: adjustmentIndex.trim() || undefined,
      thirteenth: thirteenth || undefined,
      endMonth: endMonth || undefined,
    };
    if (await run(next)) {
      if (!register) onClose();
    }
  };

  const adjust = async () => {
    if (!register) return;
    const p = parseMoney(percent);
    if (p === null || p <= -100) return setError('Informe o percentual do reajuste (ex.: 4,83).');
    try {
      const note = [adjustmentIndex.trim(), `${percent.trim()}%`].filter(Boolean).join(' ');
      if (await run(applyAdjustment(register, p, adjustFrom, `Reajuste ${note}`))) setPercent('');
    } catch (e) {
      setError(describeError(e));
    }
  };

  const receive = (m: string, remaining: number) => register && void run(addPayment(register, { month: m, amount: remaining, paidAt: today }));
  const undo = (m: string) => register && void run(clearPayments(register, m));

  return (
    <Sheet title={register ? 'Honorários' : 'Cadastrar honorário'} subtitle={client.tradeName || client.name} onClose={onClose} size="lg">
      <div className="space-y-6">
        {error && (
          <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}

        <section className="space-y-3">
          <p className={OVERLINE}>Contrato</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {!register && (
              <>
                <Field label="Valor mensal (R$)">
                  <input className={INPUT_MONEY} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
                </Field>
                <Field label="Desde a competência">
                  <input className={INPUT} type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Dia do vencimento">
              <input className={INPUT} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </Field>
            <Field label="Mês do reajuste">
              <select className={INPUT} value={adjustmentMonth} onChange={(e) => setAdjustmentMonth(e.target.value)}>
                <option value="">Sem reajuste</option>
                {MONTH_NAMES.map((n, i) => (
                  <option key={n} value={i + 1}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Índice">
              <input className={INPUT} value={adjustmentIndex} onChange={(e) => setAdjustmentIndex(e.target.value.slice(0, 20))} placeholder="IPCA, INPC, IGP-M…" />
            </Field>
            {register && (
              <Field label="Encerrado a partir de" hint="Vazio: contrato ativo">
                <input className={INPUT} type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-3 text-[13px]">
              <IOSSwitch checked={dueNextMonth} onChange={setDueNextMonth} />
              Vence no mês seguinte à competência
            </label>
            <label className="flex items-center gap-3 text-[13px]">
              <IOSSwitch checked={thirteenth} onChange={setThirteenth} />
              Cobra 13º honorário (dezembro)
            </label>
            <button type="button" className={`${BUTTON.primary} ml-auto`} disabled={busy} onClick={() => void saveContract()}>
              {register ? 'Salvar contrato' : 'Cadastrar'}
            </button>
          </div>
        </section>

        {register && (
          <>
            <section className="space-y-3">
              <p className={OVERLINE}>Valores e reajuste</p>
              <ul className="text-[13px] space-y-1">
                {[...register.rates].reverse().map((r) => (
                  <li key={r.fromMonth} className="flex gap-3">
                    <span className="w-24 font-mono tabular-nums text-stone-500">desde {r.fromMonth.slice(5)}/{r.fromMonth.slice(0, 4)}</span>
                    <span className="font-mono tabular-nums">{formatCurrency(r.amount)}</span>
                    {r.note && <span className="text-stone-500">{r.note}</span>}
                  </li>
                ))}
              </ul>
              {pending && <p className="text-[12.5px] text-amber-700 dark:text-amber-400">O reajuste de {MONTH_NAMES[Number(pending.month.slice(5)) - 1]} ainda não foi aplicado.</p>}
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Percentual (%)">
                  <input className={`${INPUT_COMPACT} w-28 font-mono`} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="4,83" />
                </Field>
                <Field label="A partir de">
                  <input className={INPUT_COMPACT} type="month" value={adjustFrom} onChange={(e) => setAdjustFrom(e.target.value)} />
                </Field>
                <button type="button" className={BUTTON.secondary} disabled={busy || !percent} onClick={() => void adjust()}>
                  Aplicar reajuste
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <p className={OVERLINE}>Recebimentos (até {month.slice(5)}/{month.slice(0, 4)})</p>
              <ul className="divide-y divide-line">
                {charges.map((c) => (
                  <li key={c.month} className="flex items-center gap-3 py-2 text-[13px]">
                    <span className="w-20 font-medium">{c.label}</span>
                    <span className="w-24 font-mono tabular-nums text-right">{formatCurrency(c.amount)}</span>
                    <span className="w-28 font-mono tabular-nums text-[12px] text-stone-500">vence {formatDateBR(c.due)}</span>
                    <span className={`w-20 text-[12.5px] font-medium ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    <span className="flex-1 text-[12px] text-stone-500 truncate">
                      {c.payments.map((p) => `${formatCurrency(p.amount)} em ${formatDateBR(p.paidAt)}`).join(' · ')}
                    </span>
                    {c.status !== 'paid' && (
                      <button type="button" className={BUTTON.ghost} disabled={busy} onClick={() => receive(c.month, round2(c.amount - c.paid))}>
                        Recebido hoje
                      </button>
                    )}
                    {c.payments.length > 0 && (
                      <button type="button" className={BUTTON.ghost} disabled={busy} onClick={() => undo(c.month)} title="Apagar os recebimentos desta competência">
                        Desfazer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}
