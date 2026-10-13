'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Plus,
  Search,
  Filter,
  Lock,
  Unlock,
  Edit2,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Bookmark,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { ChartAccount, JournalEntry, JournalEntryCategory, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, INPUT, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { JournalEntryModal } from '@/components/lancamentos/JournalEntryModal';

const CATEGORY_CONFIG: Record<JournalEntryCategory, { label: string; badge: string }> = {
  CLOSING: {
    label: 'Fechamento Geral',
    badge: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  },
  PAYROLL: {
    label: 'Folha de Pagamento',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  },
  DEPRECIATION: {
    label: 'Depreciação',
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  },
  TAX: {
    label: 'Provisão Tributária',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
  ADJUSTMENT: {
    label: 'Ajuste Patrimonial',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  PROVISION: {
    label: 'Provisão Geral',
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
  OTHER: {
    label: 'Outros',
    badge: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  },
};

export default function LancamentosPage() {
  const { currentClient } = useClient();
  const { user } = useAuth();
  const clientId = currentClient?.id;
  const period = usePeriod('month');
  const { range } = period;

  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estados de modal e filtros
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Carrega plano de contas, travas e lançamentos manuais
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listPeriodLocks(clientId),
      repo.listJournalEntries(clientId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Missing or insufficient permissions') || msg.includes('permission')) {
          setError(
            'Permissão insuficiente no Firestore: as regras de segurança para a coleção "journal_entries" precisam ser publicadas no Firebase Console (na aba Firestore Database > Regras). Siga as instruções para atualizar as regras do seu projeto.'
          );
        } else {
          setError(msg);
        }
        return [];
      }),
    ])
      .then(([accs, periodLocks, journalList]) => {
        if (!active) return;
        setAccounts(accs);
        setLocks(periodLocks);
        setEntries(journalList);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        console.error('Erro ao carregar dados:', e);
        setError(e instanceof Error ? e.message : 'Falha ao carregar dados.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  // Mapa de contas por ID para exibição rápida
  const accountMap = useMemo(() => {
    return new Map(accounts.map((a) => [a.id, a] as const));
  }, [accounts]);

  // Checagem se o mês atual está travado
  const currentMonth = range.start.slice(0, 7);
  const isMonthLocked = (m: string) => locks.some((l) => l.month === m);
  const monthLocked = isMonthLocked(currentMonth);

  // Filtra os lançamentos do período selecionado
  const periodEntries = useMemo(() => {
    return entries.filter((e) => e.date >= range.start && e.date <= range.end);
  }, [entries, range]);

  // Filtra por busca e categoria
  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodEntries.filter((e) => {
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) {
        return false;
      }
      if (!term) return true;
      const matchMemo = e.memo.toLowerCase().includes(term);
      const matchDoc = e.documentRef ? e.documentRef.toLowerCase().includes(term) : false;
      const matchLines = e.lines.some((l) => {
        const acc = accountMap.get(l.accountId);
        return (
          (acc && (acc.code.toLowerCase().includes(term) || acc.name.toLowerCase().includes(term))) ||
          (l.memo && l.memo.toLowerCase().includes(term))
        );
      });
      return matchMemo || matchDoc || matchLines;
    });
  }, [periodEntries, search, categoryFilter, accountMap]);

  // Estatísticas do período
  const stats = useMemo(() => {
    let totalDebit = 0;
    for (const e of periodEntries) {
      for (const l of e.lines) {
        if (l.type === 'DEBIT') {
          totalDebit += Number(l.amount) || 0;
        }
      }
    }
    return {
      count: periodEntries.length,
      totalVolume: totalDebit,
    };
  }, [periodEntries]);

  // Criação / Edição de lançamento
  const handleSaveEntry = async (
    entryData: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => {
    if (!clientId) return;
    const repo = getRepository();

    const now = new Date().toISOString();
    const entryToSave: JournalEntry = {
      ...entryData,
      id: existingId || `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      clientId,
      entryNumber: existingId
        ? (entries.find((e) => e.id === existingId)?.entryNumber ?? 1)
        : entries.length + 1,
      createdAt: existingId ? (entries.find((e) => e.id === existingId)?.createdAt ?? now) : now,
      updatedAt: now,
      createdByUid: user?.uid || 'local',
    };

    await repo.saveJournalEntry(entryToSave);
    setReloadCount((c) => c + 1);
  };

  // Exclusão de lançamento
  const handleDelete = async (entryId: string) => {
    if (!clientId) return;
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    const m = entry.date.slice(0, 7);
    if (isMonthLocked(m)) {
      alert(`A competência ${m} está bloqueada para alterações.`);
      return;
    }

    if (!confirm(`Deseja realmente excluir o lançamento #${entry.entryNumber} ("${entry.memo}")?`)) {
      return;
    }

    setDeletingId(entryId);
    try {
      const repo = getRepository();
      await repo.deleteJournalEntry(entryId);
      setReloadCount((c) => c + 1);
    } catch (err) {
      console.error('Erro ao excluir lançamento:', err);
      alert(err instanceof Error ? err.message : 'Falha ao excluir lançamento.');
    } finally {
      setDeletingId(null);
    }
  };

  // Duplicar lançamento
  const handleDuplicate = (entry: JournalEntry) => {
    setEditingEntry({
      ...entry,
      id: '',
      entryNumber: entries.length + 1,
      date: range.end,
      memo: `${entry.memo} (Cópia)`,
    });
    setIsModalOpen(true);
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Lançamentos Manuais de Fechamento"
        description="Diário avulso por partidas dobradas para provisões de folha, depreciação, impostos e ajustes patrimoniais sem movimentação bancária."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingEntry(null);
                setIsModalOpen(true);
              }}
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${SURFACE} p-5 rounded-2xl flex items-center gap-4`}>
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[12px] font-medium text-stone-500 uppercase tracking-wider">
              Lançamentos no Período
            </p>
            <p className="text-[24px] font-semibold text-stone-900 dark:text-stone-50 mt-0.5">
              {stats.count}
            </p>
          </div>
        </div>

        <div className={`${SURFACE} p-5 rounded-2xl flex items-center gap-4`}>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[12px] font-medium text-stone-500 uppercase tracking-wider">
              Volume Movimentado (Σ D = Σ C)
            </p>
            <p className="text-[24px] font-semibold font-mono text-stone-900 dark:text-stone-50 mt-0.5">
              {formatCurrency(stats.totalVolume)}
            </p>
          </div>
        </div>

        <div className={`${SURFACE} p-5 rounded-2xl flex items-center gap-4`}>
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <Bookmark className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[12px] font-medium text-stone-500 uppercase tracking-wider">
              Impacto nos Demonstrativos
            </p>
            <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-1">
              Refletido automaticamente no <strong>Balanço</strong>, <strong>Balancete</strong>, <strong>DRE</strong> e <strong>Razão</strong>.
            </p>
          </div>
        </div>
      </div>

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
              onClick={() => {
                setEditingEntry(null);
                setIsModalOpen(true);
              }}
              className={BUTTON.primary}
            >
              <Plus className="w-4 h-4" />
              Novo Lançamento
            </button>
          )}
        </div>
      ) : (
        <div className={`${SURFACE} rounded-2xl overflow-hidden border border-black/[0.08] dark:border-white/[0.1]`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.08] bg-stone-100/60 dark:bg-stone-800/60 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center"></th>
                  <th className="py-3 px-4 w-28">Data</th>
                  <th className="py-3 px-4 w-44">Categoria</th>
                  <th className="py-3 px-4">Histórico Contábil</th>
                  <th className="py-3 px-4 w-36">Documento</th>
                  <th className="py-3 px-4 w-36 text-right">Valor Total</th>
                  <th className="py-3 px-4 w-36 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {filteredEntries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  const catCfg = CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.OTHER;
                  const entryTotal = entry.totalAmount || entry.lines
                    .filter((l) => l.type === 'DEBIT')
                    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

                  return (
                    <React.Fragment key={entry.id}>
                      <tr className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                            aria-label={isExpanded ? 'Recolher partidas' : 'Expandir partidas'}
                            className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-black/[0.05] transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        <td className="py-3 px-4 font-mono text-stone-700 dark:text-stone-300">
                          {formatDateBR(entry.date)}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${catCfg.badge}`}
                          >
                            {catCfg.label}
                          </span>
                        </td>

                        <td className="py-3 px-4 font-medium text-stone-900 dark:text-stone-100">
                          {entry.memo}
                          <span className="text-[11px] text-stone-400 font-normal ml-2">
                            ({entry.lines.length} partidas)
                          </span>
                        </td>

                        <td className="py-3 px-4 font-mono text-stone-500 text-[12px]">
                          {entry.documentRef || '—'}
                        </td>

                        <td className="py-3 px-4 font-mono text-right font-semibold text-stone-900 dark:text-stone-100">
                          {formatCurrency(entryTotal)}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingEntry(entry);
                                setIsModalOpen(true);
                              }}
                              disabled={monthLocked}
                              title={monthLocked ? 'Mês bloqueado' : 'Editar lançamento'}
                              className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDuplicate(entry)}
                              disabled={monthLocked}
                              title={monthLocked ? 'Mês bloqueado' : 'Duplicar lançamento'}
                              className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDelete(entry.id)}
                              disabled={monthLocked || deletingId === entry.id}
                              title={monthLocked ? 'Mês bloqueado' : 'Excluir lançamento'}
                              className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                            >
                              {deletingId === entry.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Partidas Expandidas */}
                      {isExpanded && (
                        <tr className="bg-stone-50/70 dark:bg-stone-950/40">
                          <td colSpan={7} className="p-4 pl-14">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                                <span>Detalhamento das Partidas Dobradas:</span>
                                {entry.attachmentUrl && (
                                  <a
                                    href={entry.attachmentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                  >
                                    <ExternalLink className="w-3 h-3" /> Ver Documento Anexo
                                  </a>
                                )}
                              </div>

                              <div className="border border-black/[0.06] dark:border-white/[0.08] rounded-xl overflow-hidden bg-white dark:bg-stone-900">
                                <table className="w-full text-left text-[12px]">
                                  <thead>
                                    <tr className="border-b border-black/[0.04] bg-stone-100/50 dark:bg-stone-800/50 text-[11px] font-medium text-stone-500 uppercase">
                                      <th className="py-2 px-3 w-16 text-center">Tipo</th>
                                      <th className="py-2 px-3 w-36">Código</th>
                                      <th className="py-2 px-3">Conta Contábil</th>
                                      <th className="py-2 px-3">Memo / Histórico Complementar</th>
                                      <th className="py-2 px-3 w-36 text-right">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.04]">
                                    {entry.lines.map((l) => {
                                      const acc = accountMap.get(l.accountId);
                                      return (
                                        <tr key={l.id}>
                                          <td className="py-2 px-3 text-center">
                                            <span
                                              className={`inline-block w-6 py-0.5 rounded text-center font-mono font-bold text-[10px] ${
                                                l.type === 'DEBIT'
                                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                              }`}
                                            >
                                              {l.type === 'DEBIT' ? 'D' : 'C'}
                                            </span>
                                          </td>
                                          <td className="py-2 px-3 font-mono text-stone-500">
                                            {acc?.code || '—'}
                                          </td>
                                          <td className="py-2 px-3 font-medium text-stone-800 dark:text-stone-200">
                                            {acc?.name || 'Conta não localizada'}
                                          </td>
                                          <td className="py-2 px-3 text-stone-500">
                                            {l.memo || entry.memo}
                                          </td>
                                          <td
                                            className={`py-2 px-3 font-mono text-right font-medium ${
                                              l.type === 'DEBIT'
                                                ? 'text-blue-600 dark:text-blue-400'
                                                : 'text-amber-600 dark:text-amber-400'
                                            }`}
                                          >
                                            {formatCurrency(l.amount)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Lançamento */}
      <JournalEntryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveEntry}
        initialEntry={editingEntry}
        accounts={accounts}
        clientId={clientId || ''}
        defaultDate={range.end}
        isMonthLocked={isMonthLocked}
      />
    </main>
  );
}
