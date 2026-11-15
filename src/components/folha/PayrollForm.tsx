'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, ClipboardPaste, Copy, FileUp, Lock, RotateCcw, Trash2, UserRound, Users, type LucideIcon } from 'lucide-react';
import type { ChartAccount, PayrollAccountMapping, PayrollSummary } from '@/types/firestore';
import { buildPayrollJournalDraft, calculateNetPayroll, parsePayrollText, payrollProblem, type PayrollInput, type PayrollJournalDraft } from '@/lib/payroll';
import { missingTemplateAccounts } from '@/lib/chart/itg1000';
import { fromCents, toCents } from '@/lib/money';
import { parseMoneyInput } from '@/lib/opening';
import { formatMonth } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { TABLE_HEAD, Th } from '@/components/ui/Table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BUTTON, INPUT, INPUT_MONEY, OVERLINE, SURFACE } from '@/components/ui/primitives';

interface PayrollFormProps {
  clientId: string;
  month: string;
  accounts: readonly ChartAccount[];
  /** Contas da folha em uso nesta empresa (as do modelo, salvo ajuste no cadastro). */
  mapping: PayrollAccountMapping;
  existingSummary: PayrollSummary | null;
  previousSummary: PayrollSummary | null;
  locked: boolean;
  saving: boolean;
  /** O lançamento no Diário não bate mais com o resumo gravado: gravar de novo o refaz. */
  needsRepost: boolean;
  onSave: (input: PayrollInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onNotify: (msg: string) => void;
  /** Há valores digitados e ainda não contabilizados. */
  onDirtyChange: (dirty: boolean) => void;
}

const FIELD_KEYS = [
  'grossSalaries',
  'grossProLabore',
  'inssEmployees',
  'inssProLabore',
  'irrfEmployees',
  'irrfProLabore',
  'otherDeductions',
  'fgts',
  'inssEmployer',
  'vacationProvision',
  'thirteenthProvision',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type DraftFields = Record<FieldKey, string> & { notes: string };

/** Prévia do lançamento: as partidas e as contas que ainda entram no plano, ou o motivo de não montar. */
type Preview = { ok: true; draft: PayrollJournalDraft; newAccounts: Set<string> } | { ok: false; error: string };

/** "1.234,50"; vazio quando não há valor. */
const formatField = (v: number | undefined): string =>
  v !== undefined && v > 0 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

const summaryToFields = (s: PayrollSummary | null): DraftFields => ({
  ...(Object.fromEntries(FIELD_KEYS.map((k) => [k, formatField(s?.[k])])) as Record<FieldKey, string>),
  notes: s?.notes ?? '',
});

const numOf = (raw: string): number => {
  if (!raw.trim()) return 0;
  const parsed = parseMoneyInput(raw);
  return parsed !== null && parsed > 0 ? parsed : 0;
};

/** Parte de `base` (em centavos exatos): 8% do FGTS, 1/12 do 13º etc. */
const share = (base: number, numerator: number, denominator: number): number => fromCents(Math.round((toCents(base) * numerator) / denominator));

/* =========================================================================
   Campo de valor e grupo de campos
   ========================================================================= */

interface Suggestion {
  label: string;
  title: string;
  onClick: () => void;
}

function MoneyField({
  label,
  hint,
  value,
  onChange,
  disabled,
  suggestion,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  suggestion?: Suggestion | null;
}) {
  const invalid = value.trim() !== '' && parseMoneyInput(value) === null;
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="text-[12px] font-medium text-stone-700 dark:text-stone-300">{label}</span>
        {hint && <span className="truncate font-mono text-[10.5px] text-stone-400 dark:text-stone-500">{hint}</span>}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          // Ao sair do campo, o valor fica no formato do extrato (1.234,56).
          onBlur={() => {
            const parsed = parseMoneyInput(value);
            if (parsed !== null) onChange(formatField(parsed));
          }}
          placeholder="0,00"
          className={`${INPUT_MONEY} h-10 text-right aria-invalid:border-rose-400 dark:aria-invalid:border-rose-500/70`}
        />
        {suggestion && !disabled && (
          <button type="button" onClick={suggestion.onClick} title={suggestion.title} className={`${BUTTON.secondary} h-10 px-3 font-mono`}>
            {suggestion.label}
          </button>
        )}
      </span>
      {invalid && <span className="block px-0.5 text-[11.5px] text-rose-600 dark:text-rose-400">Use o formato 1.234,56.</span>}
    </label>
  );
}

function Group({
  icon: Icon,
  title,
  subtitle,
  totalLabel,
  total,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  totalLabel: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface-2/60 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <span className="w-8 h-8 shrink-0 rounded-[10px] flex items-center justify-center bg-accent/10 text-accent-ink">
          <Icon className="w-4 h-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">{title}</h3>
          <p className="truncate text-[11.5px] text-stone-500 dark:text-stone-400">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1 px-4 pb-4 space-y-3">{children}</div>
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-t border-line bg-surface">
        <span className="text-[12px] text-stone-500 dark:text-stone-400">{totalLabel}</span>
        <span className="font-mono tabular-nums text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}

/* =========================================================================
   Formulário
   ========================================================================= */

export function PayrollForm({
  clientId,
  month,
  accounts,
  mapping,
  existingSummary,
  previousSummary,
  locked,
  saving,
  needsRepost,
  onSave,
  onDelete,
  onNotify,
  onDirtyChange,
}: PayrollFormProps) {
  const [fields, setFields] = useState<DraftFields>(() => summaryToFields(existingSummary));
  const [showImport, setShowImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setField = (key: keyof DraftFields, value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  const currentInput: PayrollInput = useMemo(
    () => ({
      month,
      ...(Object.fromEntries(FIELD_KEYS.map((k) => [k, numOf(fields[k])])) as Record<FieldKey, number>),
      notes: fields.notes,
    }),
    [fields, month]
  );

  const calc = useMemo(() => calculateNetPayroll(currentInput), [currentInput]);
  const validationError = useMemo(() => payrollProblem(currentInput), [currentInput]);
  const hasValues = FIELD_KEYS.some((k) => fields[k].trim() !== '');

  // Diferente do que está gravado (ou, em competência nova, qualquer valor digitado).
  const dirty = useMemo(
    () =>
      FIELD_KEYS.some((k) => toCents(numOf(fields[k])) !== toCents(existingSummary?.[k] ?? 0)) ||
      fields.notes.trim() !== (existingSummary?.notes ?? '').trim(),
    [fields, existingSummary]
  );
  useEffect(() => {
    onDirtyChange(dirty && !locked);
    return () => onDirtyChange(false);
  }, [dirty, locked, onDirtyChange]);

  // Prévia com as contas do modelo que ainda faltam no plano: elas são criadas ao contabilizar.
  const preview = useMemo((): Preview | null => {
    if (validationError) return null;
    const existing = new Set(accounts.map((a) => a.id));
    try {
      const draft = buildPayrollJournalDraft(currentInput, [...accounts, ...missingTemplateAccounts(clientId, accounts)], mapping);
      return { ok: true, draft, newAccounts: new Set(draft.lines.filter((l) => !existing.has(l.accountId)).map((l) => l.accountId)) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Não foi possível montar o lançamento.' };
    }
  }, [currentInput, accounts, clientId, mapping, validationError]);

  const repeatPrevious = () => {
    if (!previousSummary) return;
    setFields({ ...summaryToFields(previousSummary), notes: `Repetido da competência ${formatMonth(previousSummary.month)}` });
    onNotify(`Valores copiados de ${formatMonth(previousSummary.month)}. Confira e contabilize.`);
  };

  const applyParsedText = (raw: string) => {
    const parsed = parsePayrollText(raw);
    const keys = FIELD_KEYS.filter((k) => parsed[k] !== undefined);
    if (keys.length === 0) {
      setImportError('Nenhuma rubrica reconhecida. Confira os nomes (ex.: "Salários Brutos", "INSS Empregados", "FGTS") e os valores.');
      return;
    }
    setFields((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, formatField(parsed[k])])) }));
    setShowImport(false);
    setPasteText('');
    setImportError(null);
    onNotify(`${keys.length} campo(s) preenchido(s) pelo resumo da folha.`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    applyParsedText(await file.text());
    e.target.value = '';
  };

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (validationError || locked) return;
    await onSave(currentInput);
  };

  const suggest = (key: FieldKey, base: number, numerator: number, denominator: number, label: string, title: string): Suggestion | null =>
    base > 0 ? { label, title, onClick: () => setField(key, formatField(share(base, numerator, denominator))) } : null;

  const money = (key: FieldKey, label: string, hint?: string, suggestion?: Suggestion | null) => (
    <MoneyField label={label} hint={hint} value={fields[key]} onChange={(v) => setField(key, v)} disabled={locked} suggestion={suggestion} />
  );

  const canSave = !locked && !saving && !validationError && (dirty || needsRepost || !existingSummary);
  // Competência ainda em branco, com folha anterior para copiar: o convite a repetir vai em destaque.
  const inviteRepeat = !locked && !existingSummary && !hasValues && previousSummary !== null;
  const monthLabel = formatMonth(month);

  return (
    <form onSubmit={handleSubmit}>
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {/* Cabeçalho: o que é e os atalhos de preenchimento */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 py-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">Resumo da folha de {monthLabel}</h2>
            <p className="mt-0.5 text-[12.5px] text-stone-500 dark:text-stone-400">
              Totais do resumo do DP ou do eSocial. A provisão entra no Diário no último dia do mês, por partidas dobradas.
            </p>
          </div>
          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
              {previousSummary && !inviteRepeat && (
                <button type="button" onClick={repeatPrevious} className={BUTTON.secondary} title={`Copiar os valores lançados em ${formatMonth(previousSummary.month)}`}>
                  <Copy className="w-3.5 h-3.5" />
                  Repetir {formatMonth(previousSummary.month)}
                </button>
              )}
              <button type="button" onClick={() => setShowImport((v) => !v)} aria-expanded={showImport} className={BUTTON.secondary}>
                <ClipboardPaste className="w-3.5 h-3.5" />
                Colar ou importar resumo
              </button>
            </div>
          )}
        </div>

        <div className="px-5 md:px-6 py-5 space-y-5">
          {locked && (
            <p role="status" className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-stone-900/4 dark:bg-white/6 border border-line text-[13px] text-stone-600 dark:text-stone-300">
              <Lock className="w-4 h-4 shrink-0 text-stone-400" />
              Competência fechada: reabra {monthLabel} na Conciliação para alterar ou excluir a folha.
            </p>
          )}

          {inviteRepeat && previousSummary && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50/70 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-500/25">
              <p className="text-[13px] text-amber-900 dark:text-amber-200">
                <strong className="font-semibold">A folha de {monthLabel} ainda não foi lançada.</strong> Se nada mudou desde {formatMonth(previousSummary.month)}, repita os valores e só confira.
              </p>
              <button type="button" onClick={repeatPrevious} className={BUTTON.primary}>
                <Copy className="w-3.5 h-3.5" />
                Repetir {formatMonth(previousSummary.month)}
              </button>
            </div>
          )}

          {showImport && !locked && (
            <div className="rounded-2xl border border-line bg-surface-2 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-medium text-stone-800 dark:text-stone-100">Colar o resumo da folha ou importar um CSV</p>
                  <p className="text-[12px] text-stone-500 dark:text-stone-400">
                    Uma rubrica por linha, como <code className="font-mono text-[11px]">Salários Brutos: 8.500,00</code> ou <code className="font-mono text-[11px]">FGTS; 680,00</code>.
                  </p>
                </div>
                <label className={`${BUTTON.secondary} cursor-pointer`}>
                  <FileUp className="w-3.5 h-3.5" />
                  Escolher arquivo
                  <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
              <textarea
                rows={5}
                autoFocus
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  setImportError(null);
                }}
                placeholder={'Salários Brutos: 10.000,00\nPró-Labore Bruto: 5.000,00\nINSS Empregados: 900,00\nINSS Pró-Labore: 550,00\nFGTS: 800,00'}
                className={`${INPUT} h-auto w-full font-mono text-[12px] py-2.5`}
              />
              {importError && (
                <p role="alert" className="text-[12.5px] text-rose-600 dark:text-rose-400">
                  {importError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setShowImport(false)} className={BUTTON.ghost}>
                  Cancelar
                </button>
                <button type="button" onClick={() => applyParsedText(pasteText)} disabled={!pasteText.trim()} className={BUTTON.accent}>
                  Preencher campos
                </button>
              </div>
            </div>
          )}

          {/* Os três blocos do resumo da folha: quem recebe e o que a empresa paga por cima */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Group icon={Users} title="Empregados" subtitle="Salários (CLT) e o que é descontado deles" totalLabel="Líquido a pagar" total={calc.netSalaries}>
              {money('grossSalaries', 'Salários brutos', mapping.salaryExpenseCode)}
              {money('inssEmployees', 'INSS descontado', mapping.inssPayableCode)}
              {money('irrfEmployees', 'IRRF descontado', mapping.irrfPayableCode)}
              {money('otherDeductions', 'Outros descontos', 'VT, faltas, convênios')}
            </Group>

            <Group icon={UserRound} title="Sócios" subtitle="Pró-labore e o que é descontado dele" totalLabel="Líquido a pagar" total={calc.netProLabore}>
              {money('grossProLabore', 'Pró-labore bruto', mapping.proLaboreExpenseCode)}
              {money(
                'inssProLabore',
                'INSS descontado',
                mapping.inssPayableCode,
                suggest('inssProLabore', calc.grossProLabore, 11, 100, '11%', '11% do pró-labore bruto. Confira o teto do INSS, que vale por sócio.')
              )}
              {money('irrfProLabore', 'IRRF descontado', mapping.irrfPayableCode)}
            </Group>

            <Group icon={Building2} title="Empresa" subtitle="Encargos e provisões por cima da folha" totalLabel="Encargos e provisões" total={fromCents(toCents(calc.totalEmployerCharges) + toCents(calc.totalProvisions))}>
              {money('fgts', 'FGTS', mapping.fgtsPayableCode, suggest('fgts', calc.grossSalaries, 8, 100, '8%', '8% dos salários brutos'))}
              {money('inssEmployer', 'INSS patronal', 'no Simples, só Anexo IV')}
              {money(
                'vacationProvision',
                'Provisão de férias + 1/3',
                mapping.vacationPayableCode,
                suggest('vacationProvision', calc.grossSalaries, 1, 9, '1/9', '1/12 mais um terço: 1/9 (11,11%) dos salários brutos')
              )}
              {money(
                'thirteenthProvision',
                'Provisão de 13º salário',
                mapping.thirteenthPayableCode,
                suggest('thirteenthProvision', calc.grossSalaries, 1, 12, '1/12', '1/12 (8,33%) dos salários brutos')
              )}
            </Group>
          </div>

          {/* Totais da competência, antes de contabilizar */}
          <dl className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl border border-line divide-x divide-y lg:divide-y-0 divide-line overflow-hidden">
            {[
              ['Proventos brutos', calc.totalGross, 'salários e pró-labore'],
              ['Líquido a pagar', calc.totalNetPayable, `retenções de ${formatCurrency(calc.totalRetentions)}`],
              ['Guias a recolher', calc.totalTaxesPayable, 'INSS, FGTS e IRRF'],
              ['Custo total da folha', calc.totalExpense, 'despesa da competência'],
            ].map(([label, value, caption], i) => (
              <div key={label as string} className={`px-4 py-3 ${i === 3 ? 'bg-accent/[0.06] dark:bg-accent/[0.12]' : ''}`}>
                <dt className={OVERLINE}>{label}</dt>
                <dd className="mt-1 font-mono tabular-nums text-[17px] font-semibold text-stone-900 dark:text-stone-50">{formatCurrency(value as number)}</dd>
                <dd className="mt-0.5 text-[11.5px] text-stone-500 dark:text-stone-400">{caption}</dd>
              </div>
            ))}
          </dl>

          <label className="block space-y-1.5">
            <span className="block px-0.5 text-[12px] font-medium text-stone-700 dark:text-stone-300">Observações (opcional)</span>
            <input
              type="text"
              disabled={locked}
              maxLength={200}
              value={fields.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="De onde veio o resumo: folha do eSocial, sistema do DP…"
              className={`${INPUT} h-10`}
            />
          </label>

          {/* Lançamento que vai para o Diário */}
          {preview && !preview.ok && (
            <p role="alert" className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/50 text-[13px] text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
              {preview.error}
            </p>
          )}
          {preview?.ok && (
            <div className="rounded-2xl border border-line overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-surface-2 border-b border-line">
                <p className="text-[13px] font-semibold tracking-tight text-stone-800 dark:text-stone-100">
                  Lançamento no Diário <span className="font-normal text-stone-500 dark:text-stone-400">em {formatDateBR(preview.draft.date)}</span>
                </p>
                <p className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  débito = crédito · <span className="font-mono tabular-nums font-medium">{formatCurrency(preview.draft.totalAmount)}</span>
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className={`${TABLE_HEAD} text-left`}>
                      <Th className="pl-4 pr-3 py-2 w-10">D/C</Th>
                      <Th className="px-3 py-2">Conta</Th>
                      <Th className="px-3 py-2">Histórico</Th>
                      <Th align="right" className="pl-3 pr-4 py-2">
                        Valor
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.draft.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="pl-4 pr-3 py-1.5">
                          <span
                            className={`inline-flex w-5 h-5 items-center justify-center rounded-md text-[10.5px] font-semibold ${
                              line.type === 'DEBIT' ? 'bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300' : 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300'
                            }`}
                            title={line.type === 'DEBIT' ? 'Débito' : 'Crédito'}
                          >
                            {line.type === 'DEBIT' ? 'D' : 'C'}
                          </span>
                        </td>
                        <td className={`px-3 py-1.5 font-medium text-stone-800 dark:text-stone-100 ${line.type === 'CREDIT' ? 'pl-7' : ''}`}>
                          <span className="font-mono text-[11.5px] text-stone-500 mr-1.5">{line.accountCode}</span>
                          {line.accountName}
                          {preview.newAccounts.has(line.accountId) && (
                            <span className="ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-accent/10 text-accent-ink" title="A conta é do modelo do CFC e ainda não está no plano desta empresa: entra no plano ao contabilizar.">
                              será criada no plano
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-stone-500 dark:text-stone-400">{line.memo}</td>
                        <td className="pl-3 pr-4 py-1.5 text-right font-mono tabular-nums font-medium text-stone-800 dark:text-stone-100">{formatCurrency(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Situação e ações */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 py-3.5 border-t border-line bg-surface-2/70">
          <p className="min-w-0 text-[12.5px] text-stone-500 dark:text-stone-400">
            {locked ? (
              'Folha em competência fechada.'
            ) : validationError && hasValues ? (
              <span className="inline-flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {validationError}
              </span>
            ) : validationError ? (
              'Informe os valores do resumo da folha para contabilizar.'
            ) : needsRepost && !dirty ? (
              <span className="text-amber-700 dark:text-amber-400">O lançamento no Diário não confere mais com este resumo: lance de novo.</span>
            ) : existingSummary && !dirty ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Contabilizada no Diário em {formatDateBR(existingSummary.date)}.
              </span>
            ) : existingSummary ? (
              'Há alterações ainda não contabilizadas.'
            ) : (
              'Pronta para contabilizar.'
            )}
          </p>

          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
              {existingSummary && (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className={`${BUTTON.ghost} text-rose-700 dark:text-rose-300 hover:text-rose-800 dark:hover:text-rose-200`}>
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir folha
                </button>
              )}
              {dirty && (
                <button type="button" onClick={() => setFields(summaryToFields(existingSummary))} disabled={saving} className={BUTTON.ghost}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  {existingSummary ? 'Desfazer alterações' : 'Limpar'}
                </button>
              )}
              <button type="submit" disabled={!canSave} className={BUTTON.accent}>
                <CheckCircle2 className="w-4 h-4" />
                {saving ? 'Contabilizando…' : !existingSummary ? 'Contabilizar folha' : dirty ? 'Atualizar folha' : needsRepost ? 'Lançar de novo' : 'Folha contabilizada'}
              </button>
            </div>
          )}
        </div>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title={`Excluir a folha de ${monthLabel}?`}
          description="O resumo e o lançamento de provisão saem do Diário. Os pagamentos já conciliados no extrato continuam classificados."
          confirmLabel="Excluir folha"
          destructive
          onConfirm={async () => {
            await onDelete();
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </form>
  );
}
