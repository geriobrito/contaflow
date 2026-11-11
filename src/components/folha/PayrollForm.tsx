'use client';

import React, { useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  FileUp,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ChartAccount, PayrollSummary } from '@/types/firestore';
import {
  buildPayrollJournalDraft,
  calculateNetPayroll,
  DEFAULT_PAYROLL_MAPPING,
  parsePayrollText,
  payrollProblem,
  type PayrollInput,
} from '@/lib/payroll';
import { fromCents, toCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Field, INPUT, SURFACE } from '@/components/ui/primitives';

interface PayrollFormProps {
  month: string;
  accounts: readonly ChartAccount[];
  existingSummary: PayrollSummary | null;
  previousSummary: PayrollSummary | null;
  locked: boolean;
  saving: boolean;
  onSave: (input: PayrollInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onNotify: (msg: string) => void;
}

type FieldKey =
  | 'grossSalaries'
  | 'grossProLabore'
  | 'inssEmployees'
  | 'inssProLabore'
  | 'irrfEmployees'
  | 'irrfProLabore'
  | 'otherDeductions'
  | 'fgts'
  | 'inssEmployer'
  | 'vacationProvision'
  | 'thirteenthProvision';

type DraftFields = Record<FieldKey, string> & { notes: string };

const formatField = (v: number | undefined): string =>
  v !== undefined && v > 0 ? v.toFixed(2).replace('.', ',') : '';

function summaryToFields(s: PayrollSummary | null): DraftFields {
  return {
    grossSalaries: formatField(s?.grossSalaries),
    grossProLabore: formatField(s?.grossProLabore),
    inssEmployees: formatField(s?.inssEmployees),
    inssProLabore: formatField(s?.inssProLabore),
    irrfEmployees: formatField(s?.irrfEmployees),
    irrfProLabore: formatField(s?.irrfProLabore),
    otherDeductions: formatField(s?.otherDeductions),
    fgts: formatField(s?.fgts),
    inssEmployer: formatField(s?.inssEmployer),
    vacationProvision: formatField(s?.vacationProvision),
    thirteenthProvision: formatField(s?.thirteenthProvision),
    notes: s?.notes ?? '',
  };
}

const numOf = (raw: string): number => {
  if (!raw.trim()) return 0;
  const parsed = parseMoneyInput(raw);
  return parsed !== null && parsed > 0 ? parsed : 0;
};

export function PayrollForm({
  month,
  accounts,
  existingSummary,
  previousSummary,
  locked,
  saving,
  onSave,
  onDelete,
  onNotify,
}: PayrollFormProps) {
  const [fields, setFields] = useState<DraftFields>(() => summaryToFields(existingSummary));
  const [showImport, setShowImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setField = (key: keyof DraftFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const currentInput: PayrollInput = useMemo(
    () => ({
      month,
      grossSalaries: numOf(fields.grossSalaries),
      grossProLabore: numOf(fields.grossProLabore),
      inssEmployees: numOf(fields.inssEmployees),
      inssProLabore: numOf(fields.inssProLabore),
      irrfEmployees: numOf(fields.irrfEmployees),
      irrfProLabore: numOf(fields.irrfProLabore),
      otherDeductions: numOf(fields.otherDeductions),
      fgts: numOf(fields.fgts),
      inssEmployer: numOf(fields.inssEmployer),
      vacationProvision: numOf(fields.vacationProvision),
      thirteenthProvision: numOf(fields.thirteenthProvision),
      notes: fields.notes,
    }),
    [fields, month]
  );

  const calc = useMemo(() => calculateNetPayroll(currentInput), [currentInput]);
  const validationError = useMemo(() => payrollProblem(currentInput), [currentInput]);

  const previewDraft = useMemo(() => {
    if (validationError) return null;
    try {
      return buildPayrollJournalDraft(currentInput, accounts, DEFAULT_PAYROLL_MAPPING);
    } catch {
      return null;
    }
  }, [currentInput, accounts, validationError]);

  const handleRepeatPrevious = () => {
    if (!previousSummary) return;
    setFields({
      ...summaryToFields(previousSummary),
      notes: `Repetido da competência ${formatMonth(previousSummary.month)}`,
    });
    onNotify(`Valores copiados de ${formatMonth(previousSummary.month)}. Revise e clique em Contabilizar.`);
  };

  const applyParsedText = (raw: string) => {
    const parsed = parsePayrollText(raw);
    const keys = Object.keys(parsed) as FieldKey[];
    if (keys.length === 0) {
      onNotify('Nenhum campo reconhecido no texto informado. Verifique os nomes das rubricas e valores.');
      return;
    }
    setFields((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        const val = parsed[k];
        if (val !== undefined) next[k] = formatField(val);
      }
      return next;
    });
    setShowImport(false);
    setPasteText('');
    onNotify(`${keys.length} campo(s) importado(s) do resumo da folha.`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    applyParsedText(text);
    e.target.value = '';
  };

  const suggestFgts8 = () => {
    if (calc.grossSalaries <= 0) return;
    const val = fromCents(Math.round(toCents(calc.grossSalaries) * 0.08));
    setField('fgts', formatField(val));
  };

  const suggestVacation = () => {
    if (calc.grossSalaries <= 0) return;
    // 1/12 + 1/3 de férias = 1/9 (11,1111%) sobre salários brutos
    const val = fromCents(Math.round(toCents(calc.grossSalaries) / 9));
    setField('vacationProvision', formatField(val));
  };

  const suggestThirteenth = () => {
    if (calc.grossSalaries <= 0) return;
    // 1/12 (8,3333%) sobre salários brutos
    const val = fromCents(Math.round(toCents(calc.grossSalaries) / 12));
    setField('thirteenthProvision', formatField(val));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) {
      onNotify(validationError);
      return;
    }
    await onSave(currentInput);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className={`${SURFACE} rounded-[22px] p-5 md:p-6 space-y-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200/70 pb-4">
          <div>
            <h2 className="text-[15px] font-semibold text-stone-900">
              Resumo da Folha de Pagamento — {formatMonth(month)}
            </h2>
            <p className="text-[12.5px] text-stone-500 mt-0.5">
              Preencha os totais do resumo mensal do DP/eSocial. O sistema calcula os líquidos e gera a provisão por partidas dobradas no último dia do mês.
            </p>
          </div>
          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
              {previousSummary && (
                <button
                  type="button"
                  onClick={handleRepeatPrevious}
                  className={BUTTON.secondary}
                  title={`Copiar os valores lançados em ${formatMonth(previousSummary.month)}`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  Repetir de {formatMonth(previousSummary.month)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImport((v) => !v)}
                className={BUTTON.secondary}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Importar CSV / Colar resumo
              </button>
            </div>
          )}
        </div>

        {showImport && !locked && (
          <div className="rounded-2xl border border-amber-200/80 dark:border-amber-500/25 bg-amber-50/50 dark:bg-amber-500/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-stone-800">
                  Importação rápida do resumo da folha (CSV ou texto colado)
                </p>
                <p className="text-[12px] text-stone-500">
                  Cole linhas no formato <code className="font-mono text-[11px]">Salários Brutos: 8.500,00</code>, <code className="font-mono text-[11px]">FGTS; 680,00</code> ou importe um arquivo CSV.
                </p>
              </div>
              <label className={`${BUTTON.secondary} cursor-pointer`}>
                <FileUp className="w-3.5 h-3.5" />
                Escolher arquivo .CSV
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Exemplo:\nSalários Brutos: 10.000,00\nPró-Labore Bruto: 5.000,00\nINSS Empregados: 900,00\nINSS Pró-Labore: 550,00\nFGTS: 800,00'}
              className={`${INPUT} w-full font-mono text-[12px] py-2`}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className={BUTTON.ghost}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => applyParsedText(pasteText)}
                disabled={!pasteText.trim()}
                className={BUTTON.accent}
              >
                Preencher campos
              </button>
            </div>
          </div>
        )}

        {/* 1. Proventos Brutos */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              1. Proventos Brutos (Despesas de Pessoal)
            </h3>
            <span className="text-[12px] font-mono tabular-nums text-stone-600">
              Total bruto: <strong>{formatCurrency(calc.totalGross)}</strong>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Salários e Ordenados Brutos — CLT (R$)" hint="Conta 3.3.2.01 · Salários e Ordenados">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.grossSalaries}
                onChange={(e) => setField('grossSalaries', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
            <Field label="Pró-Labore Bruto dos Sócios (R$)" hint="Conta 3.3.2.02 · Pró-Labore">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.grossProLabore}
                onChange={(e) => setField('grossProLabore', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
          </div>
        </div>

        {/* 2. Retenções e Descontos */}
        <div className="space-y-3 pt-2 border-t border-stone-200/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              2. Retenções sobre a Folha (Descontados dos Empregados e Sócios)
            </h3>
            <span className="text-[12px] font-mono tabular-nums text-stone-600">
              Salário líquido: <strong>{formatCurrency(calc.netSalaries)}</strong> · Pró-labore líquido: <strong>{formatCurrency(calc.netProLabore)}</strong>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <Field label="INSS Empregados (R$)" hint="C: 2.1.1.03 INSS a Recolher">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.inssEmployees}
                onChange={(e) => setField('inssEmployees', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
            <Field label="INSS Pró-Labore (R$)" hint="C: 2.1.1.03 INSS a Recolher">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.inssProLabore}
                onChange={(e) => setField('inssProLabore', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
            <Field label="IRRF s/ Salários (R$)" hint="C: 2.1.5.04 IRRF a Recolher">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.irrfEmployees}
                onChange={(e) => setField('irrfEmployees', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
            <Field label="IRRF s/ Pró-Labore (R$)" hint="C: 2.1.5.04 IRRF a Recolher">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.irrfProLabore}
                onChange={(e) => setField('irrfProLabore', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
            <Field label="Outros Descontos (R$)" hint="VT, faltas, convênios (reduz 3.3.2.01)">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.otherDeductions}
                onChange={(e) => setField('otherDeductions', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
          </div>
        </div>

        {/* 3. Encargos Sociais Patronais */}
        <div className="space-y-3 pt-2 border-t border-stone-200/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              3. Encargos Sociais Patronais (FGTS e INSS Empresa)
            </h3>
            <span className="text-[12px] font-mono tabular-nums text-stone-600">
              Total de encargos: <strong>{formatCurrency(calc.totalEmployerCharges)}</strong>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Field label="FGTS da Competência — 8% (R$)" hint="D: 3.3.2.03 Encargos Sociais / C: 2.1.1.04 FGTS a Recolher">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={locked}
                    value={fields.fgts}
                    onChange={(e) => setField('fgts', e.target.value)}
                    placeholder="0,00"
                    className={`${INPUT} font-mono tabular-nums flex-1`}
                  />
                  {!locked && calc.grossSalaries > 0 && (
                    <button
                      type="button"
                      onClick={suggestFgts8}
                      className={BUTTON.secondary}
                      title="Calcular 8% sobre os salários brutos"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      8%
                    </button>
                  )}
                </div>
              </Field>
            </div>
            <Field label="INSS Patronal — CPP / RAT / Terceiros (R$)" hint="D: 3.3.2.03 Encargos Sociais / C: 2.1.1.03 INSS a Recolher">
              <input
                type="text"
                inputMode="decimal"
                disabled={locked}
                value={fields.inssEmployer}
                onChange={(e) => setField('inssEmployer', e.target.value)}
                placeholder="0,00"
                className={`${INPUT} font-mono tabular-nums`}
              />
            </Field>
          </div>
        </div>

        {/* 4. Provisões Mensais (Férias e 13º) e Observações */}
        <div className="space-y-3 pt-2 border-t border-stone-200/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500">
              4. Provisões Mensais de Férias e 13º Salário (Regime de Competência)
            </h3>
            <span className="text-[12px] font-mono tabular-nums text-stone-600">
              Total de provisões: <strong>{formatCurrency(calc.totalProvisions)}</strong>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Provisão Mensal de Férias + 1/3 (R$)" hint="D: 3.3.2.04 / C: 2.1.1.05 Férias a Pagar">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={locked}
                  value={fields.vacationProvision}
                  onChange={(e) => setField('vacationProvision', e.target.value)}
                  placeholder="0,00"
                  className={`${INPUT} font-mono tabular-nums flex-1`}
                />
                {!locked && calc.grossSalaries > 0 && (
                  <button
                    type="button"
                    onClick={suggestVacation}
                    className={BUTTON.secondary}
                    title="Sugerir 1/9 (11,11%) sobre os salários brutos"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    1/9
                  </button>
                )}
              </div>
            </Field>
            <Field label="Provisão Mensal de 13º Salário (R$)" hint="D: 3.3.2.04 / C: 2.1.1.06 13º Salário a Pagar">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={locked}
                  value={fields.thirteenthProvision}
                  onChange={(e) => setField('thirteenthProvision', e.target.value)}
                  placeholder="0,00"
                  className={`${INPUT} font-mono tabular-nums flex-1`}
                />
                {!locked && calc.grossSalaries > 0 && (
                  <button
                    type="button"
                    onClick={suggestThirteenth}
                    className={BUTTON.secondary}
                    title="Sugerir 1/12 (8,33%) sobre os salários brutos"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    1/12
                  </button>
                )}
              </div>
            </Field>
            <Field label="Observações / Origem do Resumo" hint="Opcional (ex.: Folha eSocial / Sistema DP)">
              <input
                type="text"
                disabled={locked}
                value={fields.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Ex.: Resumo da folha mensal eSocial"
                className={INPUT}
              />
            </Field>
          </div>
        </div>

        {/* Prévia das Partidas Dobradas */}
        {previewDraft && (
          <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
                <span className="text-[13px] font-semibold text-stone-800">
                  Espelho do Lançamento de Provisão ({formatDateBR(previewDraft.date)})
                </span>
              </div>
              <span className="text-[12px] font-mono tabular-nums text-stone-600">
                Partidas dobradas equilibradas: <strong>{formatCurrency(previewDraft.totalAmount)}</strong>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-[11px] uppercase tracking-[0.08em] text-stone-400">
                    <th className="py-1.5 pr-3">Natureza</th>
                    <th className="py-1.5 pr-3">Conta Contábil</th>
                    <th className="py-1.5 pr-3">Histórico</th>
                    <th className="py-1.5 text-right">Valor (R$)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200/50">
                  {previewDraft.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                            line.type === 'DEBIT'
                              ? 'bg-amber-100/80 dark:bg-amber-500/10 text-amber-900 dark:text-amber-300'
                              : 'bg-sky-100/80 dark:bg-sky-500/10 text-sky-900 dark:text-sky-300'
                          }`}
                        >
                          {line.type === 'DEBIT' ? 'D · Débito' : 'C · Crédito'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 font-medium text-stone-800">
                        <span className="font-mono text-[11.5px] text-stone-500 mr-1.5">{line.accountCode}</span>
                        {line.accountName}
                      </td>
                      <td className="py-1.5 pr-3 text-stone-500">{line.memo}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums font-medium text-stone-800">
                        {formatCurrency(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rodapé de Ações */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-200/70">
          <div className="text-[12.5px] text-stone-500">
            {locked ? (
              <span className="text-amber-700 dark:text-amber-300 font-medium">
                Competência fechada: reabra o mês para alterar ou excluir a provisão da folha.
              </span>
            ) : validationError ? (
              <span className="text-stone-500">{validationError}</span>
            ) : existingSummary ? (
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                Folha contabilizada no Livro Diário em {formatDateBR(existingSummary.date)}.
              </span>
            ) : (
              <span>Pronto para gerar a provisão contábil no Livro Diário.</span>
            )}
          </div>

          {!locked && (
            <div className="flex items-center gap-2.5">
              {existingSummary && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                  className={`${BUTTON.secondary} text-rose-700 dark:text-rose-300 hover:text-rose-800`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir folha do mês
                </button>
              )}
              {existingSummary && confirmDelete && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 px-3 py-1.5">
                  <span className="text-[12px] text-rose-800 dark:text-rose-300 font-medium">Excluir provisão de {formatMonth(month)}?</span>
                  <button
                    type="button"
                    onClick={async () => {
                      setConfirmDelete(false);
                      await onDelete();
                    }}
                    disabled={saving}
                    className="text-[12px] font-semibold text-rose-700 dark:text-rose-300 hover:underline"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-[12px] text-stone-500 hover:underline"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              <button
                type="submit"
                disabled={saving || Boolean(validationError)}
                className={BUTTON.accent}
              >
                <CheckCircle2 className="w-4 h-4" />
                {saving
                  ? 'Contabilizando…'
                  : existingSummary
                    ? 'Atualizar provisão da folha'
                    : 'Contabilizar provisão da folha'}
              </button>
            </div>
          )}
        </div>
      </section>
    </form>
  );
}
