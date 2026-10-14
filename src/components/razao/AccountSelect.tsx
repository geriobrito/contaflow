'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';

/** Seletor de conta do plano com busca por código ou nome (sintéticas e analíticas). */
export function AccountSelect({ accounts, value, onChange }: { accounts: readonly ChartAccount[]; value: string | null; onChange: (accountId: string) => void }) {
  const [accountSearch, setAccountSearch] = useState('');
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const activeAccount = accounts.find((a) => a.id === value) ?? null;
  const filteredAccountsForPicker = useMemo(() => {
    if (!accountSearch.trim()) return accounts;
    const term = accountSearch.toLowerCase();
    return accounts.filter((a) => a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term));
  }, [accounts, accountSearch]);

  return (
    <div className="relative min-w-[280px] sm:min-w-[360px]">
      <button
        type="button"
        onClick={() => setIsAccountDropdownOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2 bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-xl text-[13px] font-medium text-stone-800 dark:text-stone-200 shadow-sm hover:border-black/20 dark:hover:border-white/20 transition-all text-left"
      >
        <div className="flex items-center gap-2 truncate">
          {activeAccount ? (
            <>
              <span className="font-mono text-[12px] text-stone-400 font-semibold">{activeAccount.code}</span>
              <span className="truncate">{activeAccount.name}</span>
            </>
          ) : (
            <span className="text-stone-400">Selecione uma conta contábil...</span>
          )}
        </div>
        <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
      </button>

      {isAccountDropdownOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-full sm:w-[420px] max-h-[380px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-xl z-30 flex flex-col overflow-hidden animate-fade-in">
          <div className="p-2 border-b border-black/[0.05] dark:border-white/[0.06]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filtrar por código ou nome..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-stone-50 dark:bg-stone-800 border-none rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-400 placeholder:text-stone-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-black/[0.03] dark:divide-white/[0.03] p-1">
            {filteredAccountsForPicker.length === 0 ? (
              <p className="p-4 text-center text-[12px] text-stone-400">Nenhuma conta encontrada.</p>
            ) : (
              filteredAccountsForPicker.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onChange(a.id);
                    setIsAccountDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-[12px] rounded-lg flex items-center justify-between gap-2 transition-colors ${
                    a.id === value
                      ? 'bg-stone-100 dark:bg-stone-800 font-semibold text-stone-900 dark:text-stone-100'
                      : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-stone-700 dark:text-stone-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono text-[11px] text-stone-400 font-medium shrink-0">{a.code}</span>
                    <span className="truncate">{a.name}</span>
                  </div>
                  <span className="text-[10px] uppercase text-stone-400 font-mono shrink-0">
                    {a.nature === 'SYNTHETIC' ? 'Sintética' : 'Analítica'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
