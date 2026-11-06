'use client';

import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { AccountSelectField } from '@/components/ui/AccountCombobox';
import { grossNetDrafts, grossOriginsFor, newSplitId, retentionPresetsFor, summarizeSplits, toCents, type GrossOrigin, type RetentionOption, type RetentionPreset, type SplitDraft } from '@/lib/splits';

/** Bruto × líquido com outras linhas que as de nota (ex.: resgate de aplicação, com IR e IOF). */
export interface GrossNetMode {
  origins: readonly GrossOrigin[];
  presets: readonly RetentionPreset[];
  note: string;
}

const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatCents = (cents: number): string => BRL.format(cents / 100);

export const emptySplitDraft = (cents = 0): SplitDraft => ({ id: newSplitId(), accountId: '', memo: '', cents });

/* =========================================================================
   Campo monetário estilo calculadora: dígitos entram pela direita (centavos)
   ========================================================================= */

function MoneyInput({ cents, onChange, label }: { cents: number; onChange: (cents: number) => void; label: string }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-stone-400 pointer-events-none">R$</span>
      <input
        aria-label={label}
        value={cents === 0 ? '' : formatCents(cents)}
        placeholder="0,00"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
          onChange(digits ? Number(digits) : 0);
        }}
        className="w-full h-10 pl-9 pr-3 rounded-xl bg-white dark:bg-stone-800/70 border border-black/8 dark:border-white/10 text-right font-mono tabular-nums text-[14px] text-stone-900 dark:text-stone-100 placeholder:text-stone-300 outline-none transition-all duration-150 focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.12)]"
      />
    </div>
  );
}

/* =========================================================================
   Editor de rateio
   ========================================================================= */

/* =========================================================================
   Atalho bruto × líquido: conta principal pelo bruto e retenções redutoras
   ========================================================================= */

function GrossNetPanel({
  transactionAmount,
  accounts,
  defaultAccountId,
  onApply,
  mode,
}: {
  transactionAmount: number;
  accounts: readonly ChartAccount[];
  defaultAccountId?: string;
  onApply: (drafts: SplitDraft[]) => void;
  mode?: GrossNetMode;
}) {
  const presets = mode?.presets ?? retentionPresetsFor(transactionAmount);
  const origins = mode?.origins ?? grossOriginsFor(transactionAmount);
  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a] as const)), [accounts]);
  const [originKey, setOriginKey] = useState(origins[0].key);
  const origin = origins.find((o) => o.key === originKey) ?? origins[0];
  const [pickedId, setPickedId] = useState(defaultAccountId ?? '');
  const grossId = origin.code ? (byCode.get(origin.code)?.id ?? '') : pickedId;
  const [values, setValues] = useState<Record<string, number>>({});
  /** Conta escolhida para cada retenção com mais de uma opção (código). */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const net = Math.abs(toCents(transactionAmount));
  // Só as opções que existem no plano; a retenção sem nenhuma fica de fora.
  const available = presets.map((p) => ({ preset: p, options: p.options.filter((o) => byCode.has(o.code)) }));
  const codeOf = (key: string, options: readonly RetentionOption[]) => (options.some((o) => o.code === choice[key]) ? choice[key] : options[0]?.code);
  const withheld = available.reduce((s, { preset, options }) => s + (options.length ? (values[preset.key] ?? 0) : 0), 0);
  const receipt = transactionAmount >= 0;

  return (
    <div className="rounded-2xl bg-sky-50/70 dark:bg-sky-950/20 border border-sky-200/60 dark:border-sky-900/40 p-3 space-y-3">
      <p className="text-[12px] text-sky-900 dark:text-sky-200">
        {mode
          ? mode.note
          : receipt
          ? 'O banco recebeu o líquido. Informe as retenções e a taxa: o valor bruto entra na conta escolhida e cada retenção, na conta dela.'
          : 'O banco pagou o líquido. Informe o que foi retido do fornecedor: o valor bruto entra na conta escolhida e a retenção vai para o imposto a recolher.'}
      </p>
      <div className="space-y-1.5">
        <span className="block text-[11px] font-medium text-stone-500">Valor bruto</span>
        <div role="radiogroup" aria-label="Origem do valor bruto" className="flex flex-wrap gap-1.5">
          {origins.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={o.key === origin.key}
              onClick={() => setOriginKey(o.key)}
              className={`h-8 px-3 rounded-xl border text-[12px] font-medium ${
                o.key === origin.key ? 'bg-accent border-accent text-white' : 'bg-white dark:bg-stone-800/70 border-black/8 dark:border-white/10 text-stone-600 dark:text-stone-300'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="block text-[11px] text-stone-500">{origin.hint}</span>
        {origin.code ? (
          byCode.has(origin.code) ? (
            <span className="block text-[12px] text-stone-700 dark:text-stone-300">
              <span className="font-mono text-[11px] text-stone-400 mr-1.5">{origin.code}</span>
              {byCode.get(origin.code)!.name}
            </span>
          ) : (
            <span className="block text-[11px] text-amber-700">Conta {origin.code} fora do plano: complete o plano com o modelo.</span>
          )
        ) : (
          <AccountSelectField accounts={accounts} value={pickedId} onChange={setPickedId} label="Conta do valor bruto" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {available.map(({ preset: p, options }) => {
          const code = codeOf(p.key, options);
          return (
            <div key={p.key} className="space-y-1">
              <span className="block text-[11px] font-medium text-stone-600 dark:text-stone-300">{p.label}</span>
              {options.length > 0 ? (
                <>
                  <MoneyInput cents={values[p.key] ?? 0} onChange={(cents) => setValues((v) => ({ ...v, [p.key]: cents }))} label={p.label} />
                  {options.length > 1 ? (
                    <select
                      aria-label={`Conta do ${p.label}`}
                      value={code}
                      onChange={(e) => setChoice((c) => ({ ...c, [p.key]: e.target.value }))}
                      className="w-full h-8 px-2 rounded-lg bg-white dark:bg-stone-800/70 border border-black/8 dark:border-white/10 text-[11px] text-stone-600 dark:text-stone-300"
                    >
                      {options.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.code} · {o.hint}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="block text-[11px] text-stone-400">
                      {options[0].code} · {options[0].hint}
                    </span>
                  )}
                </>
              ) : (
                <span className="block text-[11px] text-amber-700">Conta {p.options[0].code} fora do plano: complete o plano com o modelo.</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-stone-600 dark:text-stone-300">
          Líquido R$ {formatCents(net)} + retenções R$ {formatCents(withheld)} = <b>bruto R$ {formatCents(net + withheld)}</b>
        </span>
        <button
          type="button"
          disabled={!grossId || withheld === 0}
          onClick={() =>
            onApply(
              grossNetDrafts({
                transactionAmount,
                grossAccountId: grossId,
                retentions: available
                  .filter(({ options }) => options.length > 0)
                  .map(({ preset, options }) => ({ accountId: byCode.get(codeOf(preset.key, options)!)!.id, memo: preset.label, cents: values[preset.key] ?? 0 })),
              })
            )
          }
          className="h-8 px-3 rounded-xl bg-accent text-white text-[12px] font-medium disabled:opacity-40"
        >
          Montar rateio
        </button>
      </div>
    </div>
  );
}

interface SplitEditorProps {
  transactionAmount: number;
  accounts: readonly ChartAccount[];
  drafts: SplitDraft[];
  onChange: (drafts: SplitDraft[]) => void;
  /** Conta já escolhida para o lançamento: sugestão de conta do valor bruto. */
  defaultAccountId?: string;
  /** Abre já no atalho bruto × líquido. */
  startWithGrossNet?: boolean;
  /** Linhas do bruto × líquido diferentes das de nota (resgate de aplicação). */
  grossNetMode?: GrossNetMode;
}

export function SplitEditor({ transactionAmount, accounts, drafts, onChange, defaultAccountId, startWithGrossNet = false, grossNetMode }: SplitEditorProps) {
  const analytic = useMemo(() => accounts.filter((a) => a.nature === 'ANALYTIC'), [accounts]);
  const summary = summarizeSplits(transactionAmount, drafts);
  const balanced = summary.isBalanced;
  const over = summary.remainingCents < 0;
  const [grossNet, setGrossNet] = useState(startWithGrossNet);

  const update = (id: string, patch: Partial<SplitDraft>) =>
    onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => onChange(drafts.filter((d) => d.id !== id));
  const add = () => onChange([...drafts, emptySplitDraft(Math.max(0, summary.remainingCents))]);

  return (
    <div className="space-y-4">
      {/* Indicadores em tempo real */}
      <div className="grid grid-cols-3 rounded-2xl overflow-hidden border border-black/6 dark:border-white/8 divide-x divide-black/5 dark:divide-white/6 bg-white/80 dark:bg-stone-800/50">
        <div className="px-3.5 py-3 min-w-0">
          <p className="text-[11px] text-stone-500">Valor total</p>
          <p className="mt-0.5 font-mono tabular-nums text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">
            R$ {formatCents(summary.totalCents)}
          </p>
        </div>
        <div className="px-3.5 py-3 min-w-0">
          <p className="text-[11px] text-stone-500">Total rateado</p>
          <p className="mt-0.5 font-mono tabular-nums text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">
            R$ {formatCents(summary.allocatedCents)}
          </p>
        </div>
        <div
          aria-live="polite"
          className={`px-3.5 py-3 min-w-0 transition-colors duration-200 ${
            balanced ? 'bg-emerald-50/80 dark:bg-emerald-950/30' : 'bg-rose-50/80 dark:bg-rose-950/30'
          }`}
        >
          <p className={`text-[11px] ${balanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
            {over ? 'Excedente' : 'Saldo a alocar'}
          </p>
          <p
            className={`mt-0.5 font-mono tabular-nums text-[15px] font-semibold truncate ${
              balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
            }`}
          >
            {over ? '-' : ''}R$ {formatCents(Math.abs(summary.remainingCents))}
          </p>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={grossNet}
        onClick={() => setGrossNet((v) => !v)}
        className="text-[12px] font-medium text-accent-ink hover:underline"
      >
        {grossNet ? 'Fechar bruto × líquido' : 'Bruto × líquido (retenções, ISS, taxa de cartão)'}
      </button>
      {grossNet && (
        <GrossNetPanel
          transactionAmount={transactionAmount}
          accounts={analytic}
          defaultAccountId={defaultAccountId}
          mode={grossNetMode}
          onApply={(next) => {
            onChange(next);
            setGrossNet(false);
          }}
        />
      )}

      {/* Linhas */}
      <ol className="space-y-2.5">
        {drafts.map((d, i) => (
          <li
            key={d.id}
            className="rounded-2xl bg-white/70 dark:bg-stone-800/40 border border-black/5 dark:border-white/6 p-3 space-y-2 animate-fade-in"
          >
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center font-mono tabular-nums text-[11px] text-stone-400">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <AccountSelectField
                  accounts={analytic}
                  value={d.accountId}
                  onChange={(accountId) => update(d.id, { accountId })}
                  label={`Conta da linha ${i + 1}`}
                />
              </div>
              <button
                type="button"
                onClick={() => remove(d.id)}
                disabled={drafts.length <= 1}
                aria-label={`Remover linha ${i + 1}`}
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:pointer-events-none active:scale-[0.92] transition-all duration-150"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2.25} />
              </button>
            </div>
            <div className="flex items-center gap-2 pl-7 pr-10">
              <input
                value={d.memo}
                onChange={(e) => update(d.id, { memo: e.target.value })}
                placeholder="Descrição (ex.: Assinatura Canva)"
                aria-label={`Descrição da linha ${i + 1}`}
                className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-white dark:bg-stone-800/70 border border-black/8 dark:border-white/10 text-[13px] placeholder:text-stone-400 outline-none transition-all duration-150 focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.12)]"
              />
              <button
                type="button"
                aria-pressed={Boolean(d.reduces)}
                onClick={() => update(d.id, { reduces: !d.reduces })}
                aria-label={`Linha ${i + 1}: ${d.reduces ? 'subtrai do lançamento (redutora)' : 'soma ao lançamento'}`}
                title={d.reduces ? 'Redutora: retenção ou tarifa subtraída do valor bruto' : 'Soma ao lançamento'}
                className={`w-9 h-10 shrink-0 rounded-xl border font-mono text-[15px] font-semibold transition-colors ${
                  d.reduces
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/50 text-rose-600'
                    : 'bg-white dark:bg-stone-800/70 border-black/8 dark:border-white/10 text-stone-500'
                }`}
              >
                {d.reduces ? '−' : '+'}
              </button>
              <div className="w-36 shrink-0">
                <MoneyInput cents={d.cents} onChange={(cents) => update(d.id, { cents })} label={`Valor da linha ${i + 1}`} />
              </div>
            </div>
            {!balanced && (d.reduces ? summary.remainingCents < 0 : summary.remainingCents > 0) && (
              <div className="pl-7">
                <button
                  type="button"
                  onClick={() => update(d.id, { cents: d.cents + Math.abs(summary.remainingCents) })}
                  className="text-[11px] font-medium text-accent-ink hover:underline"
                >
                  {d.reduces ? 'Absorver o excedente nesta linha' : 'Alocar saldo restante nesta linha'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={add}
        className="w-full h-10 rounded-2xl border border-dashed border-black/12 dark:border-white/[0.14] text-[13px] font-medium text-stone-600 dark:text-stone-300 flex items-center justify-center gap-1.5 hover:bg-white/70 dark:hover:bg-white/4 active:scale-[0.99] transition-all duration-150"
      >
        <Plus className="w-4 h-4" strokeWidth={2} />
        Adicionar linha de despesa
      </button>
    </div>
  );
}
