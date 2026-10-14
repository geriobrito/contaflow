'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, Calculator, Filter, Loader2, Lock, Plus, Repeat, Search, Unlock } from 'lucide-react';
import type { JournalEntry } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { useJournalEntries } from '@/hooks/lancamentos/useJournalEntries';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { previousMonth, repeatCandidates } from '@/lib/journal';
import { formatMonth } from '@/lib/periods';
import { BUTTON, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CATEGORY_CONFIG } from '@/components/lancamentos/categories';
import { JournalEntriesTable } from '@/components/lancamentos/JournalEntriesTable';
import { JournalEntryModal } from '@/components/lancamentos/JournalEntryModal';
import { JournalSummaryCards } from '@/components/lancamentos/JournalSummaryCards';
import { RepeatEntriesSheet } from '@/components/lancamentos/RepeatEntriesSheet';

/**
 * Lançamentos manuais de fechamento. A tela só compõe: os dados e as gravações vêm de
 * `useJournalEntries`, e a tabela, o resumo, o formulário e a repetição mensal ficam em
 * src/components/lancamentos/.
 */
export default function LancamentosPage() {
  const { currentClient } = useClient();
  const { user } = useAuth();
  const clientId = currentClient?.id;
  const period = usePeriod('month');
  const { range } = period;
  const { accounts, entries, loading, error, isMonthLocked, saveEntry, deleteEntry, repeatEntries } = useJournalEntries(clientId, user?.uid);

  // Estados de modal e filtros
  const [isModalOpen, setIsModalOpen] = useState(false);
  /** Muda a cada abertura: o formulário sempre começa do lançamento escolhido, nunca do anterior. */
  const [modalKey, setModalKey] = useState(0);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Lançamento aguardando confirmação de exclusão. */
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);
  /** Aviso de ação recusada (ex.: competência fechada). */
  const [notice, setNotice] = useState<string | null>(null);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);

  const currentMonth = range.start.slice(0, 7);
  const monthLocked = isMonthLocked(currentMonth);

  const periodEntries = useMemo(() => entries.filter((e) => e.date >= range.start && e.date <= range.end), [entries, range]);

  // Filtra por busca e categoria
  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodEntries.filter((e) => {
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (!term) return true;
      const matchMemo = e.memo.toLowerCase().includes(term);
      const matchDoc = e.documentRef ? e.documentRef.toLowerCase().includes(term) : false;
      const matchLines = e.lines.some((l) => {
        const acc = accountMap.get(l.accountId);
        return (acc && (acc.code.toLowerCase().includes(term) || acc.name.toLowerCase().includes(term))) || (l.memo && l.memo.toLowerCase().includes(term));
      });
      return matchMemo || matchDoc || matchLines;
    });
  }, [periodEntries, search, categoryFilter, accountMap]);

  // Estatísticas do período
  const stats = useMemo(() => {
    let totalVolume = 0;
    for (const e of periodEntries) for (const l of e.lines) if (l.type === 'DEBIT') totalVolume += Number(l.amount) || 0;
    return { count: periodEntries.length, totalVolume };
  }, [periodEntries]);

  // Exclusão de lançamento: pede confirmação no diálogo; competência fechada nem chega a perguntar.
  const requestDelete = (entry: JournalEntry) => {
    const m = entry.date.slice(0, 7);
    if (isMonthLocked(m)) {
      setNotice(`A competência ${m} está bloqueada para alterações. Reabra-a para excluir o lançamento #${entry.entryNumber}.`);
      return;
    }
    setNotice(null);
    setDeleteTarget(entry);
  };

  /** Chamado pelo diálogo; se falhar, o erro aparece nele e o lançamento continua na lista. */
  const confirmDelete = async (entry: JournalEntry) => {
    setDeletingId(entry.id);
    try {
      await deleteEntry(entry);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Erro ao excluir lançamento:', err);
      throw err;
    } finally {
      setDeletingId(null);
    }
  };

  /** Abre o formulário para um lançamento novo (`null`), uma edição ou uma cópia. */
  const openModal = (entry: JournalEntry | null) => {
    setEditingEntry(entry);
    setModalKey((k) => k + 1);
    setIsModalOpen(true);
  };

  const handleDuplicate = (entry: JournalEntry) => {
    openModal({
      ...entry,
      // Sem id: é gravado como lançamento novo e recebe o próximo número da sequência.
      id: '',
      date: range.end,
      memo: `${entry.memo} (Cópia)`,
    });
  };

  // Lançamentos da competência anterior ainda não repetidos nesta (só na visão mensal).
  const repeatable = useMemo(
    () => (period.mode === 'month' ? repeatCandidates(entries, currentMonth, accounts) : []),
    [period.mode, entries, currentMonth, accounts]
  );

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Lançamentos Manuais de Fechamento"
        description="Diário avulso por partidas dobradas para provisões de folha, depreciação, impostos e ajustes patrimoniais sem movimentação bancária."
        actions={
          <div className="flex items-center gap-2">
            {period.mode === 'month' && (
              <button
                type="button"
                onClick={() => setRepeatOpen(true)}
                disabled={loading || monthLocked || repeatable.length === 0}
                className={BUTTON.secondary}
                title={
                  monthLocked
                    ? 'Competência bloqueada'
                    : repeatable.length
                      ? `Copiar lançamentos de ${formatMonth(previousMonth(currentMonth))} para ${formatMonth(currentMonth)}`
                      : `Nenhum lançamento de ${formatMonth(previousMonth(currentMonth))} a repetir`
                }
              >
                <Repeat className="w-4 h-4" />
                Repetir do mês anterior{repeatable.length > 0 && ` (${repeatable.length})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => openModal(null)}
              disabled={loading || monthLocked}
              className={BUTTON.primary}
              title={monthLocked ? 'Competência bloqueada' : 'Criar novo lançamento contábil manual'}
            >
              <Plus className="w-4 h-4" />
              Novo Lançamento
            </button>
          </div>
        }
      />

      {error && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-[13px] space-y-1">
          <div className="font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Atenção: Configuração de Regras no Firebase</span>
          </div>
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">
            {error}
          </p>
        </div>
      )}

      {notice && (
        <p role="alert" className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-[13px] text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-medium hover:underline">
            Dispensar
          </button>
        </p>
      )}

      {/* Seletor de Período */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PeriodPicker period={period} />
        {monthLocked ? (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-[13px]">
            <Lock className="w-3.5 h-3.5 text-amber-600" />
            <span>Competência {currentMonth} bloqueada</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200 text-[13px]">
            <Unlock className="w-3.5 h-3.5 text-emerald-600" />
            <span>Competência {currentMonth} aberta</span>
          </div>
        )}
      </div>

      {/* Cards de Resumo */}
      <JournalSummaryCards stats={stats} />

      {/* Barra de Filtros */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Buscar por histórico, documento ou conta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${INPUT} !pl-10 !h-10 text-[13px]`}
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-stone-400 shrink-0" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 px-3 rounded-xl bg-white/80 dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] text-[13px] text-stone-700 dark:text-stone-300 outline-none"
          >
            <option value="ALL">Todas as categorias</option>
            {Object.entries(CATEGORY_CONFIG).map(([k, cfg]) => (
              <option key={k} value={k}>
                {cfg.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista de Lançamentos */}
      {loading ? (
        <div className={`${SURFACE} p-12 rounded-2xl flex flex-col items-center justify-center gap-3 text-stone-400`}>
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-[14px]">Carregando lançamentos contábeis…</span>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className={`${SURFACE} p-10 rounded-2xl text-center space-y-4`}>
          <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-400 mx-auto flex items-center justify-center">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-stone-800 dark:text-stone-200">
              Nenhum lançamento manual no período
            </h3>
            <p className="text-[13px] text-stone-500 max-w-md mx-auto mt-1">
              {search || categoryFilter !== 'ALL'
                ? 'Nenhum lançamento atende aos filtros pesquisados.'
                : 'Utilize o botão acima para adicionar lançamentos de provisão de folha, depreciação acumulada, DAS ou ajustes.'}
            </p>
          </div>
          {!monthLocked && (
            <button
              type="button"
              onClick={() => openModal(null)}
              className={BUTTON.primary}
            >
              <Plus className="w-4 h-4" />
              Novo Lançamento
            </button>
          )}
        </div>
      ) : (
        <JournalEntriesTable entries={filteredEntries} accountMap={accountMap} monthLocked={monthLocked} deletingId={deletingId} onEdit={openModal} onDuplicate={handleDuplicate} onDelete={requestDelete} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Excluir o lançamento #${deleteTarget.entryNumber}?`}
          description={
            <>
              “{deleteTarget.memo}”, de {formatDateBR(deleteTarget.date)}, no valor de {formatCurrency(deleteTarget.totalAmount)}, sai do
              Diário, do Razão, do Balanço e da DRE. O número não é reaproveitado.
            </>
          }
          confirmLabel="Excluir lançamento"
          destructive
          onConfirm={() => confirmDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {repeatOpen && (
        <RepeatEntriesSheet targetMonth={currentMonth} candidates={repeatable} onConfirm={(chosen) => repeatEntries(chosen, currentMonth)} onClose={() => setRepeatOpen(false)} />
      )}

      {/* Modal de Lançamento: remontado a cada abertura (key), para o formulário não guardar o lançamento anterior */}
      {isModalOpen && (
        <JournalEntryModal
          key={modalKey}
          isOpen
          onClose={() => setIsModalOpen(false)}
          onSave={saveEntry}
          initialEntry={editingEntry}
          accounts={accounts}
          clientId={clientId || ''}
          defaultDate={range.end}
          isMonthLocked={isMonthLocked}
        />
      )}
    </main>
  );
}
