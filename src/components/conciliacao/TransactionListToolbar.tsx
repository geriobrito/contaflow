'use client';

import type { RefObject } from 'react';
import { CheckCheck, Landmark } from 'lucide-react';
import type { StatusFilter } from '@/lib/reconciliation-list';
import { SEGMENT_PILL, SearchField, SegmentedControl, segmentClass } from '@/components/ui/primitives';
import { useSlidingIndicator } from '@/components/ui/useSlidingIndicator';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'AUTO_CLASSIFIED', label: 'Auto' },
  { value: 'RECONCILED', label: 'Conciliados' },
];

export type ListView = 'list' | 'payee';

/** Barra da lista de lançamentos: visão, situação, conta, busca, atalhos e aprovação em lote. */
export function TransactionListToolbar({
  view,
  onViewChange,
  filter,
  onFilterChange,
  bankFilter,
  onBankFilterChange,
  bankOptions,
  counts,
  totalCount,
  searchQuery,
  onSearchChange,
  searchInputRef,
  onShowHelp,
  approvableCount,
  isSaving,
  onApproveAll,
}: {
  view: ListView;
  onViewChange: (v: ListView) => void;
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  bankFilter: string;
  onBankFilterChange: (b: string) => void;
  bankOptions: readonly { value: string; label: string; count: number }[];
  /** Lançamentos em cada situação (na conta filtrada): a fila de trabalho à vista nas abas. */
  counts: Record<StatusFilter, number>;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onShowHelp: () => void;
  approvableCount: number;
  isSaving: boolean;
  onApproveAll: () => void;
}) {
  const { containerRef: filterTabsRef, indicatorRef: filterPillRef } = useSlidingIndicator<HTMLDivElement>(filter);
  return (
    <div className="flex flex-wrap items-center gap-3 justify-between px-5 py-4 border-b border-black/4 dark:border-white/6">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Visão dos lançamentos"
          value={view}
          onChange={onViewChange}
          options={[
            { value: 'list', label: 'Lista' },
            { value: 'payee', label: 'Por favorecido' },
          ]}
        />
        <div ref={filterTabsRef} role="tablist" className={`${view === 'list' ? 'inline-flex' : 'hidden'} relative p-0.5 rounded-xl bg-black/4 dark:bg-white/6 self-start`}>
          <span ref={filterPillRef} aria-hidden className={SEGMENT_PILL} />
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              data-active={filter === f.value}
              onClick={() => onFilterChange(f.value)}
              className={`${segmentClass(filter === f.value)} inline-flex items-center gap-1.5`}
            >
              {f.label}
              <span className={`font-mono tabular-nums text-[11px] font-normal ${filter === f.value ? 'text-stone-500 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500'}`}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        {(bankOptions.length > 1 || bankFilter !== 'ALL') && (
          <div className="relative inline-flex items-center">
            <Landmark className="w-3.5 h-3.5 text-stone-400 absolute left-3 pointer-events-none" />
            <select
              aria-label="Filtrar por conta bancária ou cartão"
              value={bankFilter}
              onChange={(e) => onBankFilterChange(e.target.value)}
              className="h-9 pl-8 pr-7 rounded-xl bg-black/4 dark:bg-white/6 text-[13px] font-medium text-stone-700 dark:text-stone-200 border border-transparent focus:border-accent/40 outline-none cursor-pointer transition-colors"
            >
              <option value="ALL">Todas as contas ({totalCount})</option>
              {bankOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.count})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {view === 'list' && (
          <div className="flex items-center gap-1.5">
            <SearchField
              inputRef={searchInputRef}
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Buscar histórico, valor ou conta"
              className="w-72"
            />
            <button
              type="button"
              onClick={onShowHelp}
              title="Atalhos de teclado (?). A tecla / leva à busca."
              aria-label="Atalhos de teclado"
              className="inline-flex shrink-0 items-center justify-center w-10 h-10 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 bg-black/3 dark:bg-white/5 hover:bg-black/6 dark:hover:bg-white/9 transition-colors"
            >
              <kbd className="font-mono text-[12px] font-semibold">?</kbd>
            </button>
          </div>
        )}

        {approvableCount > 0 && (
          <button
            type="button"
            disabled={isSaving}
            onClick={onApproveAll}
            title="Aprovar todos os auto-classificados"
            aria-label={`Aprovar todos os auto-classificados (${approvableCount})`}
            className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[13px] font-medium tracking-tight whitespace-nowrap disabled:opacity-30 active:scale-[0.98] transition-all duration-150"
          >
            <CheckCheck className="w-4 h-4" strokeWidth={2} />
            Aprovar todos
            <span className="font-mono tabular-nums text-[12px] px-1.5 rounded-full bg-white/20 dark:bg-black/10">{approvableCount}</span>
          </button>
        )}
      </div>
    </div>
  );
}
