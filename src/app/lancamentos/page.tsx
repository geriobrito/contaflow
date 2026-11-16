'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Calculator, ExternalLink, Filter, Lock, Plus, Repeat, Unlock } from 'lucide-react';
import type { JournalEntry } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { useJournalEntries } from '@/hooks/lancamentos/useJournalEntries';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { previousMonth, repeatCandidates } from '@/lib/journal';
import { journalOrigin, resultEffect, reversalDraft, reversalProblem, reversalsByOriginal } from '@/lib/journal-origin';
import { formatMonth } from '@/lib/periods';
import { todayISO } from '@/lib/business-days';
import { BUTTON, PAGE, PageHeader, SearchField, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CATEGORY_CONFIG } from '@/components/lancamentos/categories';
import { JournalEntriesTable } from '@/components/lancamentos/JournalEntriesTable';
import { JournalEntryModal } from '@/components/lancamentos/JournalEntryModal';
import { JournalSummaryCards } from '@/components/lancamentos/JournalSummaryCards';
import { RepeatEntriesSheet } from '@/components/lancamentos/RepeatEntriesSheet';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { reportError } from '@/lib/monitoring';

type OriginFilter = 'ALL' | 'MANUAL' | 'GENERATED';

/** Aviso de ação recusada, com o caminho até a tela onde ela é feita. */
interface Notice {
  message: string;
  href?: string;
  screen?: string;
}

/**
 * Lançamentos manuais de fechamento. A tela só compõe: os dados e as gravações vêm de
 * `useJournalEntries`, e a tabela, o resumo, o formulário e a repetição mensal ficam em
 * src/components/lancamentos/. As ações seguem cada lançamento: o de competência fechada só
 * aceita estorno, e o gerado por uma rotina é alterado na tela de origem.
 */
export default function LancamentosPage() {
  const { currentClient } = useClient();
  const { user, isAdmin } = useAuth();
  const clientId = currentClient?.id;
  const period = usePeriod('month');
  const { range } = period;
  const { accounts, entries, loading, error, lockedMonths, isMonthLocked, saveEntry, deleteEntry, repeatEntries } = useJournalEntries(clientId, user?.uid);

  // Estados de modal e filtros
  const [isModalOpen, setIsModalOpen] = useState(false);
  /** Muda a cada abertura: o formulário sempre começa do lançamento escolhido, nunca do anterior. */
  const [modalKey, setModalKey] = useState(0);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  /** Título do formulário quando o lançamento novo nasce de outro (estorno). */
  const [modalHeading, setModalHeading] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Lançamento aguardando confirmação de exclusão. */
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const entriesById = useMemo(() => new Map(entries.map((e) => [e.id, e] as const)), [entries]);
  const reversedBy = useMemo(() => reversalsByOriginal(entries), [entries]);

  const currentMonth = range.start.slice(0, 7);
  /** Só na visão mensal o período é uma competência; no trimestre e no ano a trava é de cada lançamento. */
  const monthLocked = period.mode === 'month' && isMonthLocked(currentMonth);

  const periodEntries = useMemo(() => entries.filter((e) => e.date >= range.start && e.date <= range.end), [entries, range]);

  // Estatísticas do período
  const stats = useMemo(() => {
    let totalVolume = 0;
    let generated = 0;
    for (const e of periodEntries) {
      if (journalOrigin(e)) generated++;
      for (const l of e.lines) if (l.type === 'DEBIT') totalVolume += Number(l.amount) || 0;
    }
    return { count: periodEntries.length, manual: periodEntries.length - generated, generated, totalVolume, resultEffect: resultEffect(periodEntries, accounts) };
  }, [periodEntries, accounts]);

  // Filtra por origem, categoria e busca
  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodEntries.filter((e) => {
      if (originFilter !== 'ALL' && Boolean(journalOrigin(e)) !== (originFilter === 'GENERATED')) return false;
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (!term) return true;
      const matchMemo = e.memo.toLowerCase().includes(term);
      const matchDoc = e.documentRef ? e.documentRef.toLowerCase().includes(term) : false;
      const matchNumber = `#${e.entryNumber}` === term || String(e.entryNumber) === term;
      const matchLines = e.lines.some((l) => {
        const acc = accountMap.get(l.accountId);
        return (acc && (acc.code.toLowerCase().includes(term) || acc.name.toLowerCase().includes(term))) || (l.memo && l.memo.toLowerCase().includes(term));
      });
      return matchMemo || matchDoc || matchNumber || matchLines;
    });
  }, [periodEntries, search, categoryFilter, originFilter, accountMap]);

  const filtering = Boolean(search) || categoryFilter !== 'ALL' || originFilter !== 'ALL';

  /** Primeira data em competência aberta entre o fim do período e hoje (senão, o fim do período). */
  const openDate = (...candidates: string[]) => candidates.find((d) => !isMonthLocked(d.slice(0, 7))) ?? candidates[0];

  /** Recusa a ação no lançamento gerado por uma rotina, apontando a tela que o altera. */
  const refusedByOrigin = (entry: JournalEntry): boolean => {
    const origin = journalOrigin(entry);
    if (!origin) return false;
    setNotice({ message: origin.howToChange, href: origin.href, screen: origin.screen });
    return true;
  };

  // Exclusão de lançamento: pede confirmação no diálogo; competência fechada nem chega a perguntar.
  const requestDelete = (entry: JournalEntry) => {
    if (refusedByOrigin(entry)) return;
    const m = entry.date.slice(0, 7);
    if (isMonthLocked(m)) {
      setNotice({ message: `A competência ${formatMonth(m)} está fechada: o lançamento #${entry.entryNumber} não pode ser excluído. Para anulá-lo, use o estorno.` });
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
      reportError(err, { area: 'lancamentos', op: 'excluir' });
      throw err;
    } finally {
      setDeletingId(null);
    }
  };

  /** Abre o formulário para um lançamento novo (`null`), uma edição, uma cópia ou um estorno. */
  const openModal = (entry: JournalEntry | null, heading?: string) => {
    if (entry?.id && refusedByOrigin(entry)) return;
    setNotice(null);
    setEditingEntry(entry);
    setModalHeading(heading);
    setModalKey((k) => k + 1);
    setIsModalOpen(true);
  };

  /** Campos que só o lançamento gravado tem: a cópia e o estorno nascem como lançamento manual comum. */
  const asNew = (entry: JournalEntry): JournalEntry => ({
    ...entry,
    yearClosing: undefined,
    closingAuditId: undefined,
    depreciationMonth: undefined,
    fixedAssetId: undefined,
    prepaidMonth: undefined,
    prepaidId: undefined,
    financingMonth: undefined,
    financingId: undefined,
    investmentMonth: undefined,
    stockMonth: undefined,
    payrollMonth: undefined,
    repeatedFromId: undefined,
    reversalOfId: undefined,
    attachmentUrl: undefined,
    // Sem id: é gravado como lançamento novo e recebe o próximo número da sequência.
    id: '',
  });

  const handleDuplicate = (entry: JournalEntry) => {
    openModal({ ...asNew(entry), attachmentUrl: entry.attachmentUrl, date: openDate(range.end, todayISO()), memo: `${entry.memo} (Cópia)` });
  };

  /** Estorno: o lançamento inverso, em competência aberta, para conferir a data e confirmar. */
  const handleReverse = (entry: JournalEntry) => {
    const problem = reversalProblem(entry, reversedBy);
    if (problem) {
      const origin = journalOrigin(entry);
      setNotice({ message: problem, href: origin?.href, screen: origin?.screen });
      return;
    }
    // Nunca antes do lançamento estornado: o fim do período em vista, hoje, ou a própria data dele.
    const date = openDate(...[range.end, todayISO()].filter((d) => d >= entry.date), entry.date);
    openModal({ ...asNew(entry), ...reversalDraft(entry, date) }, `Estorno do lançamento #${entry.entryNumber}`);
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
        description="Diário avulso por partidas dobradas para provisões, impostos e ajustes sem movimentação bancária. Lançamento de competência fechada não se altera: corrige-se pelo estorno em competência aberta."
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
            <button type="button" onClick={() => openModal(null)} disabled={loading} className={BUTTON.primary} title="Criar novo lançamento contábil manual">
              <Plus className="w-4 h-4" />
              Novo Lançamento
            </button>
          </div>
        }
      />

      {error && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-[13px] space-y-1">
          <div className="font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0" />
            <span>Atenção: Configuração de Regras no Firebase</span>
          </div>
          <p className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">{error}</p>
        </div>
      )}

      {notice && (
        <p role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-[13px] text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1 min-w-[240px]">{notice.message}</span>
          {notice.href && (
            <Link href={notice.href} className="inline-flex items-center gap-1 font-medium hover:underline">
              Abrir {notice.screen}
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
          <button type="button" onClick={() => setNotice(null)} className="font-medium hover:underline">
            Dispensar
          </button>
        </p>
      )}

      {/* Seletor de Período */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PeriodPicker period={period} lockedMonths={lockedMonths} />
        {period.mode !== 'month' ? null : monthLocked ? (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-[13px]">
            <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />
            <span>Competência {currentMonth} bloqueada · correções por estorno</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200 text-[13px]">
            <Unlock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
            <span>Competência {currentMonth} aberta</span>
          </div>
        )}
      </div>

      {/* Cards de Resumo */}
      <JournalSummaryCards stats={stats} />

      {/* Barra de Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<OriginFilter>
          ariaLabel="Filtrar por origem do lançamento"
          value={originFilter}
          onChange={setOriginFilter}
          options={[
            { value: 'ALL', label: `Todos (${stats.count})` },
            { value: 'MANUAL', label: `Manuais (${stats.manual})`, title: 'Lançados nesta tela' },
            { value: 'GENERATED', label: `Das rotinas (${stats.generated})`, title: 'Gerados por Bens e Contratos, Folha e encerramento do exercício' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Buscar por histórico, documento, conta ou nº…" className="flex-1 min-w-[220px]" />

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-stone-400 shrink-0" />
          <select
            aria-label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 px-3 rounded-xl bg-white/80 dark:bg-stone-800 border border-line-strong text-[13px] text-stone-700 dark:text-stone-300 outline-none"
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
        <section className={`${SURFACE} rounded-2xl overflow-hidden`}>
          <TableSkeleton rows={6} label="Carregando lançamentos contábeis…" />
        </section>
      ) : filteredEntries.length === 0 ? (
        <div className={`${SURFACE} p-10 rounded-2xl text-center space-y-4`}>
          <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-400 mx-auto flex items-center justify-center">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-stone-800 dark:text-stone-200">Nenhum lançamento manual no período</h3>
            <p className="text-[13px] text-stone-500 max-w-md mx-auto mt-1">
              {filtering
                ? 'Nenhum lançamento atende aos filtros pesquisados.'
                : 'Utilize o botão acima para adicionar lançamentos de provisão de folha, depreciação acumulada, DAS ou ajustes.'}
            </p>
          </div>
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCategoryFilter('ALL');
                setOriginFilter('ALL');
              }}
              className={BUTTON.secondary}
            >
              Limpar filtros
            </button>
          ) : (
            !monthLocked && (
              <button type="button" onClick={() => openModal(null)} className={BUTTON.primary}>
                <Plus className="w-4 h-4" />
                Novo Lançamento
              </button>
            )
          )}
        </div>
      ) : (
        <JournalEntriesTable
          entries={filteredEntries}
          accountMap={accountMap}
          isMonthLocked={isMonthLocked}
          reversedBy={reversedBy}
          entriesById={entriesById}
          deletingId={deletingId}
          onEdit={openModal}
          onDuplicate={handleDuplicate}
          onReverse={handleReverse}
          onDelete={isAdmin ? requestDelete : undefined}
        />
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
          defaultDate={openDate(range.end, todayISO())}
          isMonthLocked={isMonthLocked}
          heading={modalHeading}
        />
      )}
    </main>
  );
}
