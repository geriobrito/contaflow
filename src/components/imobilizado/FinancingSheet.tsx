'use client';

import React, { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import type { ChartAccount, FinancingContract, FinancingKind, InterestMode } from '@/types/firestore';
import type { FinancingContext } from '@/lib/services/financing-service';
import { missingTemplateAccounts } from '@/lib/chart/itg1000';
import {
  contractMonths,
  FINANCING_DEFAULTS,
  FINANCING_KIND_LABEL,
  financedCents,
  initialShortTermLimit,
  initialSplit,
  installmentSchedule,
  priceRate,
  routineRows,
} from '@/lib/financing';
import { fromCents, toCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, SegmentedControl, Sheet, INPUT_MONEY } from '@/components/ui/primitives';

const moneyText = (v: number | undefined) => (v ? String(v).replace('.', ',') : '');
const newId = () => `fc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

/** Contas analíticas do plano mais as do modelo que faltam (entram no plano ao salvar). */
function options(clientId: string, accounts: readonly ChartAccount[], test: (a: ChartAccount) => boolean): ChartAccount[] {
  const own = accounts.filter((a) => a.nature === 'ANALYTIC' && test(a));
  const model = missingTemplateAccounts(clientId, accounts).filter((a) => a.nature === 'ANALYTIC' && test(a));
  return [...own, ...model].sort(byCode);
}

const COUNTERPART_HINT: Record<FinancingKind, string> = {
  LOAN: 'Classifique o depósito do empréstimo no extrato nesta mesma conta: ela zera.',
  FINANCING: 'O fornecedor do bem, se a compra foi lançada; senão, a conta do bem (ex.: 1.2.3.04 Veículos).',
  INSTALLMENT_PLAN: 'O imposto a recolher que foi parcelado, já atualizado com multa e juros até a adesão.',
};
const PRINCIPAL_LABEL: Record<FinancingKind, string> = {
  LOAN: 'Valor do crédito',
  FINANCING: 'Valor do bem financiado',
  INSTALLMENT_PLAN: 'Débito consolidado (com multa e juros até a adesão)',
};

type AccountKey = 'counterpart' | 'shortTerm' | 'longTerm' | 'chargesShort' | 'chargesLong' | 'upfrontExpense' | 'interestExpense';

/** Cadastro ou edição de um empréstimo, financiamento ou parcelamento. */
export function FinancingSheet({
  clientId,
  contract,
  ctx,
  busy,
  error,
  onClose,
  onSave,
}: {
  clientId: string;
  contract: FinancingContract | null;
  ctx: FinancingContext;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (contract: FinancingContract, alreadyRecognized: boolean) => Promise<boolean>;
}) {
  const frozen = contract !== null && contractMonths(contract, ctx.implantationMonth).some((m) => ctx.lockedMonths.has(m));
  const [kind, setKind] = useState<FinancingKind>(contract?.kind ?? 'FINANCING');
  const [description, setDescription] = useState(contract?.description ?? '');
  const [lender, setLender] = useState(contract?.lender ?? '');
  const [documentRef, setDocumentRef] = useState(contract?.documentRef ?? '');
  const [date, setDate] = useState(contract?.date ?? '');
  const [principal, setPrincipal] = useState(moneyText(contract?.principal));
  const [upfront, setUpfront] = useState(moneyText(contract?.upfrontCharges));
  const [installments, setInstallments] = useState(contract ? String(contract.installments) : '');
  const [installmentAmount, setInstallmentAmount] = useState(moneyText(contract?.installmentAmount));
  const [firstDueDate, setFirstDueDate] = useState(contract?.firstDueDate ?? '');
  const [mode, setMode] = useState<InterestMode>(contract?.interestMode ?? 'PREFIXED');
  const [rate, setRate] = useState(contract?.monthlyRate !== undefined ? String(contract.monthlyRate).replace('.', ',') : '');
  const initialCodes = (k: FinancingKind): Record<AccountKey, string> => ({ ...FINANCING_DEFAULTS[k], upfrontExpense: FINANCING_DEFAULTS[k].upfront, interestExpense: FINANCING_DEFAULTS[k].interest });
  const [codes, setCodes] = useState<Record<AccountKey, string>>(() =>
    contract
      ? {
          counterpart: contract.counterpartAccountCode,
          shortTerm: contract.shortTermAccountCode,
          longTerm: contract.longTermAccountCode,
          chargesShort: contract.chargesShortAccountCode ?? FINANCING_DEFAULTS[contract.kind].chargesShort,
          chargesLong: contract.chargesLongAccountCode ?? FINANCING_DEFAULTS[contract.kind].chargesLong,
          upfrontExpense: contract.upfrontExpenseAccountCode ?? FINANCING_DEFAULTS[contract.kind].upfront,
          interestExpense: contract.interestExpenseAccountCode,
        }
      : initialCodes('FINANCING')
  );
  const [alreadyRecognized, setAlreadyRecognized] = useState(false);
  const [priorThrough, setPriorThrough] = useState(contract?.priorThrough ?? '');
  const [priorTouched, setPriorTouched] = useState(Boolean(contract?.priorThrough));
  const [localError, setLocalError] = useState<string | null>(null);

  const pickKind = (k: FinancingKind) => {
    setKind(k);
    setCodes(initialCodes(k));
    setMode(k === 'INSTALLMENT_PLAN' ? 'FLOATING' : 'PREFIXED');
    if (k === 'INSTALLMENT_PLAN') setUpfront('');
  };

  const all = useMemo(() => options(clientId, ctx.accounts, () => true), [clientId, ctx.accounts]);
  const lists: Record<AccountKey, ChartAccount[]> = useMemo(
    () => ({
      counterpart: all.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY'),
      shortTerm: all.filter((a) => a.code.startsWith('2.1.')),
      longTerm: all.filter((a) => a.code.startsWith('2.2.')),
      chargesShort: all.filter((a) => a.code.startsWith('2.1.')),
      chargesLong: all.filter((a) => a.code.startsWith('2.2.')),
      upfrontExpense: all.filter((a) => a.type === 'EXPENSE'),
      interestExpense: all.filter((a) => a.type === 'EXPENSE'),
    }),
    [all]
  );
  const idOf = (code: string) => all.find((a) => a.code === code)?.id ?? '';

  const money = (t: string) => parseMoneyInput(t);
  const rateValue = rate.trim() ? Number(rate.replace(',', '.')) : undefined;
  const draft = (): FinancingContract => {
    const now = new Date().toISOString();
    const prefixed = mode === 'PREFIXED';
    const c: FinancingContract = {
      id: contract?.id ?? newId(),
      kind,
      description: description.trim(),
      ...(lender.trim() ? { lender: lender.trim() } : {}),
      ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
      date,
      principal: money(principal) ?? 0,
      ...(money(upfront) ? { upfrontCharges: money(upfront)! } : {}),
      installments: Number(installments) || 0,
      installmentAmount: money(installmentAmount) ?? 0,
      firstDueDate,
      interestMode: mode,
      ...(prefixed && rateValue !== undefined && Number.isFinite(rateValue) ? { monthlyRate: rateValue } : {}),
      counterpartAccountId: idOf(codes.counterpart),
      counterpartAccountCode: codes.counterpart,
      shortTermAccountId: idOf(codes.shortTerm),
      shortTermAccountCode: codes.shortTerm,
      longTermAccountId: idOf(codes.longTerm),
      longTermAccountCode: codes.longTerm,
      ...(prefixed
        ? {
            chargesShortAccountId: idOf(codes.chargesShort),
            chargesShortAccountCode: codes.chargesShort,
            chargesLongAccountId: idOf(codes.chargesLong),
            chargesLongAccountCode: codes.chargesLong,
          }
        : {}),
      ...(money(upfront) ? { upfrontExpenseAccountId: idOf(codes.upfrontExpense), upfrontExpenseAccountCode: codes.upfrontExpense } : {}),
      interestExpenseAccountId: idOf(codes.interestExpense),
      interestExpenseAccountCode: codes.interestExpense,
      ...(contract?.initialEntryId ? { initialEntryId: contract.initialEntryId } : {}),
      ...(priorThrough ? { priorThrough } : {}),
      createdAt: contract?.createdAt ?? now,
      updatedAt: now,
    };
    return c;
  };

  const current = draft();
  const rows = installmentSchedule(current);
  const valid = rows.length > 0 && Boolean(date);
  const financed = fromCents(financedCents(current));
  const totalPaid = fromCents(rows.reduce((s, r) => s + r.payment, 0));
  const split = valid ? initialSplit(current) : null;
  const computedRate = valid && mode === 'PREFIXED' ? priceRate(financed, current.installmentAmount, current.installments) : 0;
  // Juros ou reclassificações em meses fechados ou antes da implantação: pede até quando já foram lançados.
  const outside = valid && !frozen ? routineRows({ ...current, priorThrough: undefined }, null).filter((r) => ctx.lockedMonths.has(r.month) || (ctx.implantationMonth !== null && r.month < ctx.implantationMonth)) : [];
  const suggestedPrior = outside.length ? outside[outside.length - 1].month : '';
  if (!priorTouched && priorThrough !== suggestedPrior) setPriorThrough(suggestedPrior);
  const beforeImplantation = Boolean(!contract && date && ctx.implantation && date < ctx.implantation);
  if (beforeImplantation && !alreadyRecognized) setAlreadyRecognized(true);

  const save = async () => {
    setLocalError(null);
    if ([principal, upfront, installmentAmount].some((t) => t.trim() && money(t) === null)) return setLocalError('Há valor inválido. Use o formato 1.234,56.');
    if (await onSave(draft(), alreadyRecognized)) onClose();
  };

  const select = (key: AccountKey, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <select disabled={frozen} value={codes[key]} onChange={(e) => setCodes({ ...codes, [key]: e.target.value })} className={`${INPUT} ${codes[key] ? '' : 'text-stone-400'}`}>
        <option value="">Selecione</option>
        {lists[key].map((a) => (
          <option key={a.id} value={a.code}>
            {a.code} · {a.name}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Sheet
      side="right"
      title={contract ? FINANCING_KIND_LABEL[contract.kind] : 'Novo contrato'}
      subtitle={contract ? contract.description : 'Empréstimo, financiamento ou parcelamento de impostos'}
      onClose={onClose}
      footer={
        <>
          {(localError || error) && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">
              {localError || error}
            </p>
          )}
          <button type="button" disabled={busy || !description.trim() || !valid} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : contract ? 'Salvar' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {frozen && (
          <div role="status" className="flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-3.5 py-3 text-[12px] text-amber-900 dark:text-amber-200">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <p>Já há lançamento deste contrato em competência fechada: só a descrição, o credor e o número mudam. Para corrigir valores, reabra as competências.</p>
          </div>
        )}

        <Field label="Tipo">
          <select disabled={frozen || Boolean(contract)} value={kind} onChange={(e) => pickKind(e.target.value as FinancingKind)} className={INPUT}>
            {(Object.keys(FINANCING_KIND_LABEL) as FinancingKind[]).map((k) => (
              <option key={k} value={k}>
                {FINANCING_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Descrição">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} placeholder={kind === 'INSTALLMENT_PLAN' ? 'ex.: Parcelamento do Simples Nacional' : 'ex.: Financiamento do veículo'} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'INSTALLMENT_PLAN' ? 'Órgão' : 'Banco ou financiadora'}>
            <input value={lender} onChange={(e) => setLender(e.target.value)} className={INPUT} placeholder="opcional" />
          </Field>
          <Field label={kind === 'INSTALLMENT_PLAN' ? 'Nº do parcelamento' : 'Contrato nº'}>
            <input value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} className={INPUT} placeholder="opcional" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'INSTALLMENT_PLAN' ? 'Data da adesão' : 'Data do contrato'}>
            <input disabled={frozen} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT_MONEY} />
          </Field>
          <Field label={PRINCIPAL_LABEL[kind]}>
            <input disabled={frozen} value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
        </div>
        {kind !== 'INSTALLMENT_PLAN' && (
          <Field label="Encargos da contratação financiados (IOF, cadastro, registro)" hint="Vão para despesa financeira na data do contrato. Deixe em branco se foram pagos à vista.">
            <input disabled={frozen} value={upfront} onChange={(e) => setUpfront(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Parcelas">
            <input disabled={frozen} value={installments} onChange={(e) => setInstallments(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={INPUT_MONEY} />
          </Field>
          <Field label={mode === 'FLOATING' ? 'Parcela-base' : 'Valor da parcela'}>
            <input disabled={frozen} value={installmentAmount} onChange={(e) => setInstallmentAmount(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
          <Field label="1º vencimento">
            <input disabled={frozen} type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className={INPUT_MONEY} />
          </Field>
        </div>

        <Field label="Juros">
          <SegmentedControl
            ariaLabel="Juros"
            value={mode}
            disabled={frozen}
            onChange={setMode}
            options={[
              { value: 'PREFIXED', label: 'Prefixados (tabela Price)' },
              { value: 'FLOATING', label: 'Pós-fixados (Selic)' },
            ]}
          />
        </Field>
        {mode === 'PREFIXED' ? (
          <Field label="Taxa de juros ao mês (%)" hint={valid ? `Pela parcela, a taxa é de ${computedRate.toFixed(2).replace('.', ',')}% ao mês. Deixe em branco para usá-la.` : 'Opcional: sem ela, é calculada pela parcela.'}>
            <input disabled={frozen} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="ex.: 1,10" className={INPUT_MONEY} />
          </Field>
        ) : (
          <p className="text-[12px] text-stone-500 px-0.5">
            Pós-fixado: os juros só se conhecem a cada parcela. No pagamento, classifique na conta de curto prazo: a Conciliação separa a parcela-base e lança o resto em juros.
          </p>
        )}

        {valid && split && (
          <div className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] text-stone-600 dark:text-stone-300 space-y-1">
            <p>
              Valor financiado <span className="font-mono tabular-nums font-medium">{formatCurrency(financed)}</span> · total das parcelas{' '}
              <span className="font-mono tabular-nums font-medium">{formatCurrency(totalPaid)}</span>
              {mode === 'PREFIXED' && (
                <>
                  {' '}
                  · juros <span className="font-mono tabular-nums font-medium">{formatCurrency(totalPaid - financed)}</span>
                </>
              )}
            </p>
            <p>
              {split.shortCount} parcela(s) no curto prazo (até {formatDateBR(initialShortTermLimit(current))}) e {split.longCount} no longo. Último vencimento em{' '}
              {formatDateBR(rows[rows.length - 1].dueDate)}.
            </p>
            {mode === 'PREFIXED' && <p>Juros da 1ª parcela: {formatCurrency(fromCents(rows[0].interest))} (saldo × taxa), apropriados no mês do vencimento.</p>}
          </div>
        )}

        {select('counterpart', 'Contrapartida do lançamento inicial', COUNTERPART_HINT[kind])}
        {select('shortTerm', 'Obrigação de curto prazo', 'Classifique o pagamento das parcelas no extrato nesta conta.')}
        {select('longTerm', 'Obrigação de longo prazo')}
        {mode === 'PREFIXED' && (
          <>
            {select('chargesShort', '(−) Encargos a transcorrer de curto prazo')}
            {select('chargesLong', '(−) Encargos a transcorrer de longo prazo')}
          </>
        )}
        {toCents(money(upfront) ?? 0) > 0 && select('upfrontExpense', 'Despesa dos encargos da contratação')}
        {select('interestExpense', 'Despesa de juros')}

        {!contract && (
          <label className="flex items-start gap-2.5 rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] text-stone-600 dark:text-stone-300">
            <input type="checkbox" disabled={beforeImplantation} checked={alreadyRecognized} onChange={(e) => setAlreadyRecognized(e.target.checked)} className="mt-0.5 accent-[#B5552F]" />
            <span>
              <span className="font-medium">Lançamento inicial já contabilizado</span>
              {beforeImplantation ? ': o contrato é anterior à implantação, então o saldo está nos saldos de abertura.' : '. Sem marcar, o sistema lança na data do contrato.'}
            </span>
          </label>
        )}

        {(priorThrough || outside.length > 0) && (
          <Field label="Juros e reclassificações já lançados até" hint="Os de antes da implantação ou de competências fechadas, lançados fora desta rotina. A rotina começa no mês seguinte.">
            <input
              disabled={frozen}
              type="month"
              value={priorThrough}
              onChange={(e) => {
                setPriorTouched(true);
                setPriorThrough(e.target.value);
              }}
              className={INPUT_MONEY}
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}
