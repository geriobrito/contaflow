'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { newSplitId, summarizeSplits, type SplitDraft } from '@/lib/splits';

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
        inputMode="numeric"
        aria-label={label}
        value={cents === 0 ? '' : formatCents(cents)}
        placeholder="0,00"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
          onChange(digits ? Number(digits) : 0);
        }}
        className="w-full h-10 pl-9 pr-3 rounded-xl bg-white dark:bg-stone-800/70 border border-black/[0.08] dark:border-white/[0.10] text-right font-mono tabular-nums text-[14px] text-stone-900 dark:text-stone-100 placeholder:text-stone-300 outline-none transition-all duration-150 focus:border-[#0071E3]/60 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]"
      />
    </div>
  );
}

/* =========================================================================
   Seletor de conta analítica com busca (popover)
   ========================================================================= */

function AccountPicker({
  accounts,
  value,
  onChange,
  label,
}: {
  accounts: readonly ChartAccount[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = accounts.find((a) => a.id === value);

  const options = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((a) => !term || `${a.code} ${a.name}`.toLowerCase().includes(term)).slice(0, 80);
  }, [accounts, search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setSearch('');
          setOpen((v) => !v);
        }}
        className={`w-full h-10 px-3 flex items-center gap-2 rounded-xl border text-left transition-all duration-150 active:scale-[0.99] ${
          open
            ? 'border-[#0071E3]/60 shadow-[0_0_0_4px_rgba(0,113,227,0.12)] bg-white dark:bg-stone-800'
            : 'border-black/[0.08] dark:border-white/[0.10] bg-white dark:bg-stone-800/70 hover:border-black/[0.14]'
        }`}
      >
        {selected ? (
          <span className="flex-1 min-w-0 truncate text-[13px] text-stone-900 dark:text-stone-100">
            <span className="font-mono tabular-nums text-[11px] text-stone-400 mr-1.5">{selected.code}</span>
            {selected.name}
          </span>
        ) : (
          <span className="flex-1 text-[13px] text-stone-400">Selecionar conta…</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1.5 rounded-2xl bg-white/95 dark:bg-stone-900/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.10] shadow-[0_12px_32px_rgba(0,0,0,0.14)] overflow-hidden animate-pop-in">
          <div className="relative border-b border-black/[0.05] dark:border-white/[0.06]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Código ou nome"
              className="w-full h-9 pl-8 pr-3 bg-transparent text-[13px] placeholder:text-stone-400 outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto overscroll-contain">
            {options.length === 0 && <li className="px-3 py-4 text-center text-[12px] text-stone-400">Nenhuma conta</li>}
            {options.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={a.id === value}
                  onClick={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                >
                  <span className="w-[86px] shrink-0 font-mono tabular-nums text-[11px] text-stone-400">{a.code}</span>
                  <span className="flex-1 min-w-0 truncate text-[13px] text-stone-800 dark:text-stone-200">{a.name}</span>
                  {a.id === value && <Check className="w-3.5 h-3.5 text-[#0071E3] shrink-0" strokeWidth={2.5} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Editor de rateio
   ========================================================================= */

interface SplitEditorProps {
  transactionAmount: number;
  accounts: readonly ChartAccount[];
  drafts: SplitDraft[];
  onChange: (drafts: SplitDraft[]) => void;
}

export function SplitEditor({ transactionAmount, accounts, drafts, onChange }: SplitEditorProps) {
  const analytic = useMemo(() => accounts.filter((a) => a.nature === 'ANALYTIC'), [accounts]);
  const summary = summarizeSplits(transactionAmount, drafts);
  const balanced = summary.isBalanced;
  const over = summary.remainingCents < 0;

  const update = (id: string, patch: Partial<SplitDraft>) =>
    onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => onChange(drafts.filter((d) => d.id !== id));
  const add = () => onChange([...drafts, emptySplitDraft(Math.max(0, summary.remainingCents))]);

  return (
    <div className="space-y-4">
      {/* Indicadores em tempo real */}
      <div className="grid grid-cols-3 rounded-2xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08] divide-x divide-black/[0.05] dark:divide-white/[0.06] bg-white/80 dark:bg-stone-800/50">
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

      {/* Linhas */}
      <ol className="space-y-2.5">
        {drafts.map((d, i) => (
          <li
            key={d.id}
            className="rounded-2xl bg-white/70 dark:bg-stone-800/40 border border-black/[0.05] dark:border-white/[0.06] p-3 space-y-2 animate-fade-in"
          >
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center font-mono tabular-nums text-[11px] text-stone-400">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <AccountPicker
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
                className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-white dark:bg-stone-800/70 border border-black/[0.08] dark:border-white/[0.10] text-[13px] placeholder:text-stone-400 outline-none transition-all duration-150 focus:border-[#0071E3]/60 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]"
              />
              <div className="w-36 shrink-0">
                <MoneyInput cents={d.cents} onChange={(cents) => update(d.id, { cents })} label={`Valor da linha ${i + 1}`} />
              </div>
            </div>
            {!balanced && summary.remainingCents > 0 && (
              <div className="pl-7">
                <button
                  type="button"
                  onClick={() => update(d.id, { cents: d.cents + summary.remainingCents })}
                  className="text-[11px] font-medium text-[#0071E3] hover:underline"
                >
                  Alocar saldo restante nesta linha
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={add}
        className="w-full h-10 rounded-2xl border border-dashed border-black/[0.12] dark:border-white/[0.14] text-[13px] font-medium text-stone-600 dark:text-stone-300 flex items-center justify-center gap-1.5 hover:bg-white/70 dark:hover:bg-white/[0.04] active:scale-[0.99] transition-all duration-150"
      >
        <Plus className="w-4 h-4" strokeWidth={2} />
        Adicionar linha de despesa
      </button>
    </div>
  );
}
