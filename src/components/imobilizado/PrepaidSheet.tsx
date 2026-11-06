'use client';

import React, { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import type { ChartAccount, FixedAssetUse, PrepaidExpense, PrepaidKind } from '@/types/firestore';
import type { PrepaidContext } from '@/lib/services/prepaid-service';
import { missingTemplateAccounts } from '@/lib/chart/itg1000';
import { USE_LABEL } from '@/lib/fixed-assets';
import {
  lockedPrepaidMonths,
  PREPAID_DEFAULTS,
  PREPAID_KIND_LABEL,
  prepaidEndDate,
  prepaidSchedule,
  suggestPriorAppropriation,
} from '@/lib/prepaid-expenses';
import { fromCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, Sheet } from '@/components/ui/primitives';

const moneyText = (v: number | undefined) => (v ? String(v).replace('.', ',') : '');
const newId = () => `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

/** Contas analíticas do plano mais as do modelo que faltam (entram no plano ao salvar). */
function options(clientId: string, accounts: readonly ChartAccount[], test: (a: ChartAccount) => boolean): ChartAccount[] {
  const own = accounts.filter((a) => a.nature === 'ANALYTIC' && test(a));
  const model = missingTemplateAccounts(clientId, accounts).filter((a) => a.nature === 'ANALYTIC' && test(a));
  return [...own, ...model].sort(byCode);
}

/** Cadastro ou edição de um seguro ou outra despesa antecipada. */
export function PrepaidSheet({
  clientId,
  item,
  ctx,
  busy,
  error,
  onClose,
  onSave,
}: {
  clientId: string;
  item: PrepaidExpense | null;
  ctx: PrepaidContext;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (item: PrepaidExpense, alreadyRecognized: boolean) => Promise<boolean>;
}) {
  const frozen = item !== null && lockedPrepaidMonths(item, ctx.lockedMonths, ctx.implantationMonth).length > 0;
  const [kind, setKind] = useState<PrepaidKind>(item?.kind ?? 'INSURANCE');
  const [description, setDescription] = useState(item?.description ?? '');
  const [documentRef, setDocumentRef] = useState(item?.documentRef ?? '');
  const [assetId, setAssetId] = useState(item?.insuredAssetId ?? '');
  const [use, setUse] = useState<FixedAssetUse | ''>(item?.use ?? '');
  const [amount, setAmount] = useState(moneyText(item?.amount));
  const [startDate, setStartDate] = useState(item?.startDate ?? '');
  const [months, setMonths] = useState(String(item?.months ?? 12));
  const [assetCode, setAssetCode] = useState(item?.assetAccountCode ?? PREPAID_DEFAULTS.INSURANCE.asset);
  const [payableCode, setPayableCode] = useState(item?.payableAccountCode ?? PREPAID_DEFAULTS.INSURANCE.payable);
  const [expenseCode, setExpenseCode] = useState(item?.expenseAccountCode ?? '');
  const [expenseTouched, setExpenseTouched] = useState(Boolean(item));
  const [alreadyRecognized, setAlreadyRecognized] = useState(false);
  const [priorThrough, setPriorThrough] = useState(item?.priorAppropriation?.through ?? '');
  const [priorAmount, setPriorAmount] = useState(moneyText(item?.priorAppropriation?.amount));
  const [priorTouched, setPriorTouched] = useState(Boolean(item?.priorAppropriation));
  const [localError, setLocalError] = useState<string | null>(null);

  const assetOptions = useMemo(() => options(clientId, ctx.accounts, (a) => a.code.startsWith('1.1.4.') || a.code.startsWith('1.2.1.')), [clientId, ctx.accounts]);
  const payableOptions = useMemo(() => options(clientId, ctx.accounts, (a) => a.code.startsWith('2.1.') || a.code.startsWith('2.2.')), [clientId, ctx.accounts]);
  const expenseOptions = useMemo(() => options(clientId, ctx.accounts, (a) => a.type === 'EXPENSE' || a.type === 'COST'), [clientId, ctx.accounts]);
  const all = useMemo(() => [...assetOptions, ...payableOptions, ...expenseOptions], [assetOptions, payableOptions, expenseOptions]);
  const accountOf = (code: string) => all.find((a) => a.code === code);

  const defaultExpense = (k: PrepaidKind, u: FixedAssetUse | '') => (u ? PREPAID_DEFAULTS[k].expense[u] : null) ?? '';
  const pickKind = (k: PrepaidKind) => {
    setKind(k);
    setAssetCode(PREPAID_DEFAULTS[k].asset);
    setPayableCode(PREPAID_DEFAULTS[k].payable);
    if (!expenseTouched) setExpenseCode(defaultExpense(k, use));
  };
  const pickUse = (u: FixedAssetUse) => {
    setUse(u);
    if (!expenseTouched) setExpenseCode(defaultExpense(kind, u));
  };
  const pickAsset = (id: string) => {
    setAssetId(id);
    const asset = ctx.fixedAssets.find((a) => a.id === id);
    if (asset && !item) {
      pickUse(asset.use);
      if (!description.trim()) setDescription(`Seguro - ${asset.description}`);
    }
  };

  const parsedAmount = parseMoneyInput(amount);
  const monthsValue = Number(months);
  const draft = (): PrepaidExpense => {
    const now = new Date().toISOString();
    const a = accountOf(assetCode);
    const p = accountOf(payableCode);
    const e = accountOf(expenseCode);
    const base: PrepaidExpense = {
      id: item?.id ?? newId(),
      kind,
      description: description.trim(),
      ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
      ...(assetId ? { insuredAssetId: assetId } : {}),
      use: (use || 'EXPENSE') as FixedAssetUse,
      amount: parsedAmount ?? 0,
      startDate,
      months: Number.isInteger(monthsValue) ? monthsValue : 0,
      assetAccountId: a?.id ?? '',
      assetAccountCode: assetCode,
      payableAccountId: p?.id ?? '',
      payableAccountCode: payableCode,
      expenseAccountId: e?.id ?? '',
      expenseAccountCode: expenseCode,
      ...(item?.recognitionEntryId ? { recognitionEntryId: item.recognitionEntryId } : {}),
      createdAt: item?.createdAt ?? now,
      updatedAt: now,
    };
    if (priorThrough) base.priorAppropriation = { through: priorThrough, amount: parseMoneyInput(priorAmount) ?? 0 };
    return base;
  };

  const current = draft();
  const valid = Boolean(startDate) && (parsedAmount ?? 0) > 0 && current.months > 0;
  const quota = valid ? fromCents(prepaidSchedule({ ...current, priorAppropriation: undefined }, null)[0]?.cents ?? 0) : 0;
  const suggestion = valid && !frozen ? suggestPriorAppropriation(current, ctx.lockedMonths, ctx.implantationMonth) : null;
  if (suggestion && !priorTouched && (priorThrough !== suggestion.through || parseMoneyInput(priorAmount) !== suggestion.amount)) {
    setPriorThrough(suggestion.through);
    setPriorAmount(moneyText(suggestion.amount));
  }
  if (!suggestion && !priorTouched && priorThrough) {
    setPriorThrough('');
    setPriorAmount('');
  }
  const beforeImplantation = Boolean(!item && startDate && ctx.implantation && startDate < ctx.implantation);
  if (beforeImplantation && !alreadyRecognized) setAlreadyRecognized(true);

  const save = async () => {
    setLocalError(null);
    if (!use) return setLocalError('Escolha onde a apropriação cai no resultado: atividade-fim (custo) ou administrativo/comercial (despesa).');
    if (parsedAmount === null) return setLocalError('Valor inválido. Use o formato 1.234,56.');
    if (!expenseCode) return setLocalError('Escolha a conta de resultado da apropriação.');
    if (await onSave(draft(), alreadyRecognized)) onClose();
  };

  const select = (value: string, onChange: (v: string) => void, list: ChartAccount[], disabled: boolean) => (
    <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${value ? '' : 'text-stone-400'}`}>
      <option value="">Selecione</option>
      {list.map((a) => (
        <option key={a.id} value={a.code}>
          {a.code} · {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <Sheet
      side="right"
      title={item ? PREPAID_KIND_LABEL[item.kind] : 'Novo seguro ou despesa antecipada'}
      subtitle={item ? item.description : 'O valor vai para o ativo e é apropriado mês a mês pela vigência'}
      onClose={onClose}
      footer={
        <>
          {(localError || error) && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">
              {localError || error}
            </p>
          )}
          <button type="button" disabled={busy || !description.trim() || !valid} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : item ? 'Salvar' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {frozen && (
          <div role="status" className="flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-3.5 py-3 text-[12px] text-amber-900 dark:text-amber-200">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <p>Já há lançamento desta despesa em competência fechada: só a descrição e o número mudam. Para corrigir valores, reabra as competências.</p>
          </div>
        )}

        <Field label="Tipo">
          <select disabled={frozen || Boolean(item)} value={kind} onChange={(e) => pickKind(e.target.value as PrepaidKind)} className={INPUT}>
            {(Object.keys(PREPAID_KIND_LABEL) as PrepaidKind[]).map((k) => (
              <option key={k} value={k}>
                {PREPAID_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>

        {kind === 'INSURANCE' && ctx.fixedAssets.length > 0 && (
          <Field label="Bem segurado" hint="Se o bem é usado na atividade-fim, a apropriação vai para custo, como a depreciação dele.">
            <select disabled={frozen} value={assetId} onChange={(e) => pickAsset(e.target.value)} className={`${INPUT} ${assetId ? '' : 'text-stone-400'}`}>
              <option value="">Nenhum (ou não cadastrado)</option>
              {ctx.fixedAssets
                .filter((a) => !a.disposal)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.description}
                  </option>
                ))}
            </select>
          </Field>
        )}

        <Field label="Descrição">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} placeholder={kind === 'INSURANCE' ? 'ex.: Seguro do veículo Fiat Strada' : 'ex.: Assinatura anual do sistema'} />
        </Field>
        <Field label={kind === 'INSURANCE' ? 'Apólice nº' : 'Contrato nº'}>
          <input value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} className={INPUT} placeholder="opcional" />
        </Field>

        <Field label="Uso">
          <select disabled={frozen} value={use} onChange={(e) => pickUse(e.target.value as FixedAssetUse)} className={`${INPUT} ${use ? '' : 'text-stone-400'}`}>
            <option value="">Selecione</option>
            {(Object.keys(USE_LABEL) as FixedAssetUse[]).map((u) => (
              <option key={u} value={u}>
                {USE_LABEL[u]}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'INSURANCE' ? 'Prêmio líquido total' : 'Valor total'} error={amount.trim() && parsedAmount === null ? 'Valor inválido.' : null}>
            <input disabled={frozen} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className={`${INPUT} font-mono tabular-nums`} />
          </Field>
          <Field label="Vigência (meses)">
            <input disabled={frozen} value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={`${INPUT} font-mono tabular-nums`} />
          </Field>
        </div>
        <Field label={kind === 'INSURANCE' ? 'Data da apólice (início da vigência)' : 'Data do contrato (início da vigência)'}>
          <input disabled={frozen} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
        </Field>
        {valid && (
          <p className="-mt-2 px-0.5 text-[12px] text-stone-500">
            Vigência de {formatDateBR(startDate)} a {formatDateBR(prepaidEndDate(current))} · apropriação de{' '}
            <span className="font-mono tabular-nums font-medium text-stone-800 dark:text-stone-200">{formatCurrency(quota)}</span> por mês, no último dia, pela vigência (não pelas parcelas).
          </p>
        )}

        <Field label="Despesa antecipada (ativo)">{select(assetCode, setAssetCode, assetOptions, frozen)}</Field>
        <Field label="Obrigação (a pagar)" hint="Os pagamentos das parcelas vêm pelo extrato: classifique-os nesta conta.">
          {select(payableCode, setPayableCode, payableOptions, frozen)}
        </Field>
        <Field label="Conta de resultado (apropriação mensal)">
          {select(
            expenseCode,
            (v) => {
              setExpenseTouched(true);
              setExpenseCode(v);
            },
            expenseOptions,
            frozen
          )}
        </Field>

        {!item && (
          <label className="flex items-start gap-2.5 rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-3 text-[12px] text-stone-600 dark:text-stone-300">
            <input type="checkbox" disabled={beforeImplantation} checked={alreadyRecognized} onChange={(e) => setAlreadyRecognized(e.target.checked)} className="mt-0.5 accent-[#B5552F]" />
            <span>
              <span className="font-medium">Lançamento inicial já contabilizado</span>
              {beforeImplantation
                ? ': a apólice é anterior à implantação, então o saldo está nos saldos de abertura.'
                : ' (D despesa antecipada / C a pagar). Sem marcar, o sistema lança na data da apólice.'}
            </span>
          </label>
        )}

        {(priorThrough || suggestion) && (
          <div className="space-y-3 rounded-2xl border border-black/6 dark:border-white/8 px-3.5 py-3">
            <p className="text-[12px] text-stone-600 dark:text-stone-300">
              <span className="font-medium">Apropriação já contabilizada</span> fora desta rotina (antes da implantação ou em competências fechadas). As cotas geradas começam no mês seguinte.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Até a competência">
                <input
                  disabled={frozen}
                  type="month"
                  value={priorThrough}
                  onChange={(e) => {
                    setPriorTouched(true);
                    setPriorThrough(e.target.value);
                  }}
                  className={`${INPUT} font-mono tabular-nums`}
                />
              </Field>
              <Field label="Valor apropriado">
                <input
                  disabled={frozen}
                  value={priorAmount}
                  onChange={(e) => {
                    setPriorTouched(true);
                    setPriorAmount(e.target.value);
                  }}
                  placeholder="0,00"
                  className={`${INPUT} font-mono tabular-nums`}
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
