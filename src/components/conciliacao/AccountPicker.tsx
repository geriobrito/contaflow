'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { normalizePattern } from '@/lib/reconciliation';

interface AccountPickerProps {
  accounts: readonly ChartAccount[];
  value: string;
  onChange: (accountId: string) => void;
  autoFocus?: boolean;
}

/** Busca e escolha de conta analítica do plano (usada na classificação única e em lote). */
export function AccountPicker({ accounts, value, onChange, autoFocus = false }: AccountPickerProps) {
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo(() => {
    const term = normalizePattern(search);
    return accounts.filter((a) => a.nature === 'ANALYTIC').filter((a) => !term || `${a.code} ${a.name}`.toLowerCase().includes(term));
  }, [accounts, search]);

  // Traz a conta atual para o centro da lista; rola só a lista (não o sheet nem a página).
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-selected="true"]')?.closest('li');
    if (list && item) list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
    // Só na montagem: trocar a seleção não deve mover a lista sob o cursor.
  }, []);

  return (
    <div className="rounded-2xl bg-white dark:bg-stone-800/60 border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
      <div className="relative border-b border-black/[0.04] dark:border-white/[0.06]">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          autoFocus={autoFocus}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código ou nome"
          className="w-full pl-10 pr-3 py-3 bg-transparent text-[14px] tracking-tight placeholder:text-stone-400 outline-none"
        />
      </div>
      <ul ref={listRef} role="listbox" className="relative max-h-56 overflow-y-auto overscroll-contain">
        {options.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-stone-400">Nenhuma conta encontrada</li>}
        {options.map((a) => {
          const selected = a.id === value;
          return (
            <li key={a.id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(a.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                  selected ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                }`}
              >
                <span className="w-[96px] shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{a.code}</span>
                <span className={`flex-1 min-w-0 truncate text-[14px] tracking-tight ${selected ? 'text-[#0071E3] font-medium' : 'text-stone-800 dark:text-stone-200'}`}>
                  {a.name}
                </span>
                {selected && <Check className="w-4 h-4 text-[#0071E3] shrink-0" strokeWidth={2.5} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
