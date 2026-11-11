'use client';

import React, { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import type { CompanyPorte, FixedAsset, FixedAssetUse } from '@/types/firestore';
import type { FixedAssetContext } from '@/lib/services/fixed-asset-service';
import {
  assetAccounts,
  assetCostCents,
  intangibleTermProblem,
  intangibleTermWarning,
  isAssetFrozen,
  isIntangibleCode,
  monthlyQuotaCents,
  SUGGESTED_RATES,
  suggestPriorDepreciation,
  usefulLifeMonths,
  USE_LABEL,
} from '@/lib/fixed-assets';
import { fromCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, Sheet, INPUT_MONEY } from '@/components/ui/primitives';

const moneyText = (v: number | undefined) => (v ? String(v).replace('.', ',') : '');
const newAssetId = () => `fa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Cadastro ou edição de um bem: conta, uso, datas, composição do custo, taxa e, se preciso, a depreciação já lançada. */
export function FixedAssetSheet({
  asset,
  ctx,
  porte,
  busy,
  error,
  onClose,
  onSave,
}: {
  asset: FixedAsset | null;
  ctx: FixedAssetContext;
  /** Porte da empresa: no intangível da microentidade, o prazo máximo é de 5 anos. */
  porte?: CompanyPorte;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (asset: FixedAsset) => Promise<boolean>;
}) {
  const accounts = useMemo(() => assetAccounts(ctx.accounts), [ctx.accounts]);
  const frozen = asset !== null && isAssetFrozen(asset, ctx.lockedMonths, ctx.implantationMonth);

  const [description, setDescription] = useState(asset?.description ?? '');
  const [accountId, setAccountId] = useState(asset?.accountId ?? '');
  const [use, setUse] = useState<FixedAssetUse | ''>(asset?.use ?? '');
  const [acquisitionDate, setAcquisitionDate] = useState(asset?.acquisitionDate ?? '');
  const [inUseDate, setInUseDate] = useState(asset?.inUseDate ?? '');
  const [documentRef, setDocumentRef] = useState(asset?.documentRef ?? '');
  const [invoiceValue, setInvoiceValue] = useState(moneyText(asset?.invoiceValue));
  const [additionalCosts, setAdditionalCosts] = useState(moneyText(asset?.additionalCosts));
  const [taxes, setTaxes] = useState(moneyText(asset?.nonRecoverableTaxes));
  const [discounts, setDiscounts] = useState(moneyText(asset?.discounts));
  const [residual, setResidual] = useState(moneyText(asset?.residualValue));
  const [rate, setRate] = useState(asset ? String(asset.annualRate).replace('.', ',') : '');
  const [rateTouched, setRateTouched] = useState(Boolean(asset));
  const [priorOn, setPriorOn] = useState(Boolean(asset?.priorDepreciation));
  const [priorThrough, setPriorThrough] = useState(asset?.priorDepreciation?.through ?? '');
  const [priorAmount, setPriorAmount] = useState(moneyText(asset?.priorDepreciation?.amount));
  const [priorTouched, setPriorTouched] = useState(Boolean(asset?.priorDepreciation));
  const [localError, setLocalError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const money = (t: string) => parseMoneyInput(t);
  const values = {
    invoiceValue: money(invoiceValue),
    additionalCosts: money(additionalCosts),
    nonRecoverableTaxes: money(taxes),
    discounts: money(discounts),
    residualValue: money(residual),
  };
  const rateValue = rate.trim() ? Number(rate.replace(',', '.')) : NaN;
  const invalidMoney = Object.values(values).some((v) => v === null);

  /** O bem como ficaria gravado (sem validar). */
  const draft = (): FixedAsset => {
    const now = new Date().toISOString();
    const base: FixedAsset = {
      id: asset?.id ?? newAssetId(),
      description: description.trim(),
      accountId,
      accountCode: account?.code ?? asset?.accountCode ?? '',
      ...(account?.name ? { accountName: account.name } : {}),
      use: (use || 'EXPENSE') as FixedAssetUse,
      acquisitionDate,
      inUseDate: inUseDate || acquisitionDate,
      invoiceValue: values.invoiceValue ?? 0,
      ...(values.additionalCosts ? { additionalCosts: values.additionalCosts } : {}),
      ...(values.nonRecoverableTaxes ? { nonRecoverableTaxes: values.nonRecoverableTaxes } : {}),
      ...(values.discounts ? { discounts: values.discounts } : {}),
      ...(values.residualValue ? { residualValue: values.residualValue } : {}),
      annualRate: Number.isFinite(rateValue) ? rateValue : 0,
      ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
      ...(asset?.invoiceKey ? { invoiceKey: asset.invoiceKey } : {}),
      ...(asset?.disposal ? { disposal: asset.disposal } : {}),
      createdAt: asset?.createdAt ?? now,
      updatedAt: now,
    };
    if (priorOn && priorThrough) base.priorDepreciation = { through: priorThrough, amount: money(priorAmount) ?? 0 };
    return base;
  };

  const current = draft();
  const cost = fromCents(assetCostCents(current));
  const quota = fromCents(monthlyQuotaCents(current));
  const life = usefulLifeMonths(current.annualRate);
  const intangible = isIntangibleCode(current.accountCode);
  const rateChanged = !asset || asset.annualRate !== current.annualRate || asset.accountCode !== current.accountCode;
  const termProblem = rateChanged && Number.isFinite(rateValue) ? intangibleTermProblem(current, porte) : null;
  const termWarning = Number.isFinite(rateValue) ? intangibleTermWarning(current, porte) : null;
  // Cotas fora desta rotina (antes da implantação ou em mês fechado): sugere a depreciação já lançada.
  const suggestion =
    !frozen && current.inUseDate && cost > 0 && current.annualRate > 0
      ? suggestPriorDepreciation({ ...current, priorDepreciation: undefined }, ctx.lockedMonths, ctx.implantationMonth)
      : null;
  const showPrior = priorOn || Boolean(suggestion);
  if (suggestion && !priorTouched && (priorThrough !== suggestion.through || money(priorAmount) !== suggestion.amount || !priorOn)) {
    setPriorOn(true);
    setPriorThrough(suggestion.through);
    setPriorAmount(moneyText(suggestion.amount));
  }
  // A sugestão deixou de valer (datas mudaram) e o valor não foi digitado: some junto.
  if (!suggestion && !priorTouched && priorOn) {
    setPriorOn(false);
    setPriorThrough('');
    setPriorAmount('');
  }

  const pickAccount = (id: string) => {
    setAccountId(id);
    const code = accounts.find((a) => a.id === id)?.code;
    if (!rateTouched && code && SUGGESTED_RATES[code] !== undefined) setRate(String(SUGGESTED_RATES[code]));
  };

  const save = async () => {
    setLocalError(null);
    if (!use) return setLocalError('Escolha onde a depreciação cai no resultado: atividade-fim (custo) ou administrativo/comercial (despesa).');
    if (invalidMoney) return setLocalError('Há valor inválido. Use o formato 1.234,56.');
    if (!Number.isFinite(rateValue)) return setLocalError(`Informe a taxa anual de ${intangible ? 'amortização' : 'depreciação'} (em %).`);
    if (termProblem) return setLocalError(termProblem);
    if (await onSave(draft())) onClose();
  };

  return (
    <Sheet
      side="right"
      title={asset ? 'Bem do imobilizado' : 'Novo bem'}
      subtitle={asset ? asset.description : 'Imobilizado (1.2.3) ou intangível (1.2.4)'}
      onClose={onClose}
      footer={
        <>
          {(localError || error) && (
            <p role="alert" className="mb-2 text-center text-[12px] text-rose-600 dark:text-rose-300">
              {localError || error}
            </p>
          )}
          <button type="button" disabled={busy || !description.trim() || !accountId} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : asset ? 'Salvar' : 'Cadastrar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {frozen && (
          <div role="status" className="flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-3.5 py-3 text-[12px] text-amber-900 dark:text-amber-200">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <p>A depreciação deste bem já foi lançada em competência fechada: só a descrição e o número da nota mudam. Para corrigir valores, reabra as competências ou dê baixa e cadastre de novo.</p>
          </div>
        )}

        <Field label="Descrição">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} placeholder="ex.: Veículo Fiat Strada placa ABC1D23" />
        </Field>

        <Field label="Conta do bem" hint={accounts.length ? undefined : 'O plano não tem contas analíticas em 1.2.3 ou 1.2.4: complete o plano com o modelo.'}>
          <select disabled={frozen} value={accountId} onChange={(e) => pickAccount(e.target.value)} className={`${INPUT} ${accountId ? '' : 'text-stone-400'}`}>
            <option value="">Selecione</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>

        {intangible && (
          <p className="-mt-2 px-0.5 text-[12px] text-stone-500">
            Só entra no intangível o que foi comprado de terceiros (software, marca ou patente adquirida). Marca criada pela própria empresa e gastos com pesquisa e desenvolvimento são despesa.
          </p>
        )}

        <Field label="Uso do bem" hint="Atividade-fim: o bem produz o serviço ou o produto (ex.: computador do escritório contábil, máquina da fábrica). A depreciação vai para custo.">
          <select disabled={frozen} value={use} onChange={(e) => setUse(e.target.value as FixedAssetUse)} className={`${INPUT} ${use ? '' : 'text-stone-400'}`}>
            <option value="">Selecione</option>
            {(Object.keys(USE_LABEL) as FixedAssetUse[]).map((u) => (
              <option key={u} value={u}>
                {USE_LABEL[u]}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da nota fiscal">
            <input
              disabled={frozen}
              type="date"
              value={acquisitionDate}
              onChange={(e) => {
                if (!inUseDate || inUseDate === acquisitionDate) setInUseDate(e.target.value);
                setAcquisitionDate(e.target.value);
              }}
              className={INPUT_MONEY}
            />
          </Field>
          <Field label="Em uso desde">
            <input disabled={frozen} type="date" value={inUseDate} onChange={(e) => setInUseDate(e.target.value)} className={INPUT_MONEY} />
          </Field>
        </div>
        <p className="-mt-2 px-0.5 text-[12px] text-stone-500 dark:text-stone-400">A depreciação começa quando o bem fica disponível para uso, proporcional aos dias do primeiro mês.</p>

        <Field label="Nota fiscal nº">
          <input value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} className={INPUT} placeholder="opcional" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor da nota" error={values.invoiceValue === null ? 'Valor inválido.' : null}>
            <input disabled={frozen} value={invoiceValue} onChange={(e) => setInvoiceValue(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
          <Field label="Frete, montagem, instalação" error={values.additionalCosts === null ? 'Valor inválido.' : null}>
            <input disabled={frozen} value={additionalCosts} onChange={(e) => setAdditionalCosts(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
          <Field label="Tributos não recuperáveis" error={values.nonRecoverableTaxes === null ? 'Valor inválido.' : null}>
            <input disabled={frozen} value={taxes} onChange={(e) => setTaxes(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
          <Field label="(−) Descontos" error={values.discounts === null ? 'Valor inválido.' : null}>
            <input disabled={frozen} value={discounts} onChange={(e) => setDiscounts(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
          </Field>
        </div>
        <p className="-mt-2 px-0.5 text-[12px] text-stone-500">
          Custo do bem: <span className="font-mono tabular-nums font-medium text-stone-800 dark:text-stone-200">{formatCurrency(cost)}</span>
        </p>

        <Field
          label={intangible ? 'Taxa anual de amortização (%)' : 'Taxa anual de depreciação (%)'}
          error={termProblem}
          hint={
            termWarning ??
            (intangible && (porte ?? 'MICROENTIDADE') === 'MICROENTIDADE'
              ? 'Microentidade: prazo máximo de 5 anos (taxa mínima de 20% ao ano; NBC TG 1002, seção 18).'
              : account && SUGGESTED_RATES[account.code] !== undefined
                ? `Sugerida para ${account.name}: ${SUGGESTED_RATES[account.code]}% ao ano${intangible ? '' : ' (IN RFB 1700/2017, Anexo III)'}.`
                : 'Use a taxa da IN RFB 1700/2017 (Anexo III) ou a vida útil estimada.')
          }
        >
          <input
            disabled={frozen}
            value={rate}
            onChange={(e) => {
              setRateTouched(true);
              setRate(e.target.value);
            }}
            inputMode="decimal"
            placeholder="ex.: 20"
            className={INPUT_MONEY}
          />
        </Field>
        {quota > 0 && (
          <p className="-mt-2 px-0.5 text-[12px] text-stone-500">
            Cota mensal: <span className="font-mono tabular-nums font-medium text-stone-800 dark:text-stone-200">{formatCurrency(quota)}</span>
            {life ? ` · vida útil de ${life} meses` : ''}
          </p>
        )}

        <details className="rounded-2xl bg-black/3 dark:bg-white/4 px-3.5 py-2.5" open={Boolean(asset?.residualValue)}>
          <summary className="cursor-pointer text-[12px] font-medium text-stone-600 dark:text-stone-300">Avançado: valor residual</summary>
          <div className="mt-3">
            <Field label="Valor residual" hint="Quanto se espera obter pelo bem no fim da vida útil. Dispensável na microentidade (NBC TG 1002).">
              <input disabled={frozen} value={residual} onChange={(e) => setResidual(e.target.value)} placeholder="0,00" className={INPUT_MONEY} />
            </Field>
          </div>
        </details>

        {showPrior && (
          <div className="space-y-3 rounded-2xl border border-line px-3.5 py-3">
            <p className="text-[12px] text-stone-600 dark:text-stone-300">
              <span className="font-medium">Depreciação já contabilizada</span> fora desta rotina: a anterior à implantação (está nos saldos de abertura) ou a lançada à mão em competências fechadas. As cotas geradas começam no mês seguinte.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Até a competência">
                <input
                  disabled={frozen}
                  type="month"
                  value={priorThrough}
                  onChange={(e) => {
                    setPriorTouched(true);
                    setPriorOn(true);
                    setPriorThrough(e.target.value);
                  }}
                  className={INPUT_MONEY}
                />
              </Field>
              <Field label="Valor acumulado" error={priorOn && money(priorAmount) === null ? 'Valor inválido.' : null}>
                <input
                  disabled={frozen}
                  value={priorAmount}
                  onChange={(e) => {
                    setPriorTouched(true);
                    setPriorOn(true);
                    setPriorAmount(e.target.value);
                  }}
                  placeholder="0,00"
                  className={INPUT_MONEY}
                />
              </Field>
            </div>
            {suggestion && priorTouched && (
              <button
                type="button"
                onClick={() => {
                  setPriorTouched(false);
                }}
                className="text-[12px] text-accent-ink hover:underline"
              >
                Usar o cálculo pela taxa: {formatCurrency(suggestion.amount)} até {suggestion.through.slice(5)}/{suggestion.through.slice(0, 4)}
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
