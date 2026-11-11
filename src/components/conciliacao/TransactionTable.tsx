import { TABLE_HEAD, Th } from '@/components/ui/Table';
import React from 'react';
import { ArrowLeftRight, ChevronDown, Lock, MessageCircleQuestion, Pencil, ReceiptText, Split } from 'lucide-react';
import type { BankTransaction } from '@/types/firestore';
import { StatusBadge } from '@/components/conciliacao/StatusBadge';
import { isMonthLocked } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

interface TransactionTableProps {
  /** Linhas da página atual. */
  rows: readonly BankTransaction[];
  lockedMonths: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  /** Linha com o foco do teclado (índice em `rows`; -1 = nenhuma). */
  focusedIndex: number;
  /** Lançamentos rateados com o detalhe aberto. */
  expanded: ReadonlySet<string>;
  onOpen: (transaction: BankTransaction) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAllPage: () => void;
  onToggleExpanded: (id: string) => void;
  /** Paginação: total de linhas (todas as páginas) e navegação. */
  total: number;
  pageSize: number;
  currentPage: number;
  pageCount: number;
  onGoToPage: (page: number) => void;
  /** Mapa opcional `accountKey -> apelido` para identificar o banco/cartão quando há múltiplas contas. */
  bankNamesByKey?: ReadonlyMap<string, string>;
  /** Nota fiscal casada (`match`, conta sugerida) ou já vinculada (`linked`) a cada lançamento. */
  invoiceHints?: ReadonlyMap<string, 'match' | 'linked'>;
  /** Abre a pré-visualização lado a lado (Split View) da nota fiscal associada ao lançamento. */
  onOpenInvoice?: (transaction: BankTransaction) => void;
}

/** Tabela de lançamentos da conciliação: seleção, status, detalhe do rateio e paginação. */
export function TransactionTable({
  rows,
  lockedMonths,
  selectedIds,
  focusedIndex,
  expanded,
  onOpen,
  onToggleSelect,
  onToggleSelectAllPage,
  onToggleExpanded,
  total,
  pageSize,
  currentPage,
  pageCount,
  onGoToPage,
  bankNamesByKey,
  invoiceHints,
  onOpenInvoice,
}: TransactionTableProps) {
  const allSelected = rows.length > 0 && rows.every((t) => selectedIds.has(t.id));
  const someSelected = rows.some((t) => selectedIds.has(t.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className={TABLE_HEAD}>
            <Th scope="col" className="pl-5 pr-2 py-2.5 w-10">
              <input
                type="checkbox"
                aria-label="Selecionar todos da página"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={onToggleSelectAllPage}
                className="rounded border-stone-300 dark:border-stone-600 text-accent-ink focus:ring-accent cursor-pointer"
              />
            </Th>
            <Th scope="col" className="w-24">Data</Th>
            <Th scope="col">Descrição</Th>
            <Th scope="col">Conta</Th>
            <Th scope="col" className="w-28">Status</Th>
            <Th scope="col" align="right" edge="end" className="w-36">Valor</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, idx) => {
            const splitCount = t.isSplit ? (t.splits?.length ?? 0) : 0;
            const isExpanded = expanded.has(t.id);
            const isSelected = selectedIds.has(t.id);
            const isFocused = focusedIndex === idx;
            const splitBadge = splitCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpanded(t.id);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                aria-expanded={isExpanded}
                aria-controls={`split-${t.id}`}
                title={t.splits?.map((sp) => `${sp.accountCode ?? ''} ${sp.accountName ?? ''}: ${formatCurrency(sp.amount)}`).join('\n')}
                className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-violet-50 text-violet-700 border-violet-200/60 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/50 hover:bg-violet-100 active:scale-[0.97] transition-all duration-150"
              >
                <Split className="w-3 h-3" strokeWidth={2} />
                Rateado em {splitCount} contas
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            );
            return (
              <React.Fragment key={t.id}>
                <tr
                  id={`row-tx-${t.id}`}
                  onClick={() => onOpen(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(t);
                    }
                  }}
                  tabIndex={0}
                  className={`group border-b border-black/4 dark:border-white/5 last:border-0 cursor-pointer transition-colors duration-100 hover:bg-black/2 dark:hover:bg-white/3 focus:outline-none ${
                    isFocused ? 'ring-1 ring-inset ring-accent/60 bg-accent/5 dark:bg-accent/[0.14]' : ''
                  } ${isSelected ? 'bg-accent/5 dark:bg-accent/[0.14]' : ''}`}
                >
                  <td className="pl-5 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(t.id)}
                      aria-label={`Selecionar lançamento ${t.memo}`}
                      className="rounded border-stone-300 dark:border-stone-600 text-accent-ink focus:ring-accent cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-3 font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400 whitespace-nowrap">{formatDateBR(t.date)}</td>
                  <td className="px-3 py-3 max-w-0 w-full">
                    <p title={t.memo} className="text-[14px] tracking-tight text-stone-900 dark:text-stone-100 whitespace-normal wrap-break-word">
                      {t.memo}
                    </p>
                    {bankNamesByKey && t.accountKey && bankNamesByKey.has(t.accountKey) && (
                      <span className="mt-0.5 inline-block text-[11px] text-stone-500 dark:text-stone-500">
                        {bankNamesByKey.get(t.accountKey)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 max-w-[240px] xl:max-w-[380px]">
                    {splitBadge ? (
                      splitBadge
                    ) : t.accountName ? (
                      <p className="text-[13px] text-stone-600 dark:text-stone-400 truncate">
                        <span className="font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400 mr-1.5">{t.accountCode}</span>
                        {t.accountName}
                      </p>
                    ) : (
                      <span className="text-[13px] text-stone-300 dark:text-stone-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusBadge status={t.status} />
                      {invoiceHints?.get(t.id) === 'match' && (
                        onOpenInvoice ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenInvoice(t);
                            }}
                            title="Ver detalhes da nota fiscal correspondente (V)"
                            className="p-0.5 rounded hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 transition-colors"
                          >
                            <ReceiptText role="img" aria-label="Nota fiscal encontrada: conta sugerida" className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                          </button>
                        ) : (
                          <ReceiptText role="img" aria-label="Nota fiscal encontrada: conta sugerida" className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                        )
                      )}
                      {invoiceHints?.get(t.id) === 'linked' && (
                        onOpenInvoice ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenInvoice(t);
                            }}
                            title="Ver detalhes da nota fiscal vinculada (V)"
                            className="p-0.5 rounded hover:bg-stone-200/80 dark:hover:bg-stone-800 transition-colors"
                          >
                            <ReceiptText role="img" aria-label="Nota fiscal vinculada" className="w-3.5 h-3.5 text-stone-400" />
                          </button>
                        ) : (
                          <ReceiptText role="img" aria-label="Nota fiscal vinculada" className="w-3.5 h-3.5 text-stone-400" />
                        )
                      )}
                      {t.transferPairId && <ArrowLeftRight aria-label="Transferência entre contas próprias" className="w-3.5 h-3.5 text-sky-600 dark:text-sky-300" />}
                      {t.clientQuery?.status === 'OPEN' && (
                        <MessageCircleQuestion aria-label="Aguardando resposta do cliente" className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />
                      )}
                      {isMonthLocked(t.date, lockedMonths) && <Lock aria-label="Competência fechada" className="w-3 h-3 text-stone-400" />}
                      {t.status !== 'PENDING' && (
                        <Pencil
                          aria-hidden
                          className="w-3.5 h-3.5 text-stone-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                        />
                      )}
                    </span>
                  </td>
                  <td
                    className={`pl-3 pr-5 py-3 text-right font-mono tabular-nums text-[13px] whitespace-nowrap ${
                      t.amount < 0 ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {formatCurrency(t.amount)}
                  </td>
                </tr>
                {splitCount > 0 && isExpanded && (
                  <tr id={`split-${t.id}`} className="border-b border-black/4 dark:border-white/5 bg-stone-900/1.5 dark:bg-white/2">
                    <td colSpan={2} />
                    <td colSpan={4} className="px-3 pb-3 pt-1 pr-5">
                      <ul className="rounded-2xl border border-line bg-white/70 dark:bg-stone-900/40 divide-y divide-black/4 dark:divide-white/5 animate-fade-in">
                        {t.splits?.map((sp) => (
                          <li key={sp.id} className="flex items-baseline gap-3 px-4 py-2 text-[13px]">
                            <span className="w-24 shrink-0 font-mono tabular-nums text-[11px] text-stone-500 dark:text-stone-400">{sp.accountCode}</span>
                            <span className="flex-1 min-w-0 truncate text-stone-700 dark:text-stone-300">
                              {sp.accountName}
                              {sp.memo && <span className="ml-2 text-stone-400">· {sp.memo}</span>}
                            </span>
                            <span className="font-mono tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">{formatCurrency(sp.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {total > pageSize && (
        <nav
          aria-label="Paginação"
          className="flex items-center justify-between gap-3 px-5 py-3 border-t border-black/4 dark:border-white/6 text-[12px] text-stone-500"
        >
          <span className="font-mono tabular-nums">
            {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, total)} de {total}
          </span>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => onGoToPage(currentPage - 1)}
              disabled={currentPage === 0}
              className="h-8 px-3 rounded-full hover:bg-black/5 disabled:opacity-30 active:scale-[0.97] transition-all duration-150"
            >
              Anterior
            </button>
            <span className="font-mono tabular-nums px-1">
              {currentPage + 1}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => onGoToPage(currentPage + 1)}
              disabled={currentPage >= pageCount - 1}
              className="h-8 px-3 rounded-full hover:bg-black/5 disabled:opacity-30 active:scale-[0.97] transition-all duration-150"
            >
              Próxima
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}
