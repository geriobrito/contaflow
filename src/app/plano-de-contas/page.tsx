'use client';

import { useCallback, useMemo, useState } from 'react';
import { Plus, Wand2 } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useChartOfAccounts, type ChartActionResult } from '@/hooks/plano-de-contas/useChartOfAccounts';
import { buildTree, filterTree } from '@/lib/chart/tree';
import { AccountTreeRow } from '@/components/plano-de-contas/AccountTreeRow';
import { EditAccountSheet } from '@/components/plano-de-contas/EditAccountSheet';
import { NewAccountSheet } from '@/components/plano-de-contas/NewAccountSheet';
import { TemplateCompletionSheet } from '@/components/plano-de-contas/TemplateCompletionSheet';
import { BUTTON, EmptyState, PAGE, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';
import { StatementSkeleton } from '@/components/ui/Skeleton';

export default function PlanoDeContasPage() {
  const { isAdmin } = useAuth();
  const { currentClient, refreshClients } = useClient();
  const clientId = currentClient?.id;
  const chart = useChartOfAccounts(currentClient, refreshClients);
  const { accounts, loadFailure, isLoading, isEmpty, missing, ignored, applying } = chart;

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{ account: ChartAccount; hasChildren: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(accounts), [accounts]);
  const term = search.trim().toLowerCase();
  const visible = useMemo(() => filterTree(tree, term), [tree, term]);
  const analyticCount = accounts.filter((a) => a.nature === 'ANALYTIC').length;

  const expanded = useCallback((code: string) => Boolean(term) || !collapsed[code], [collapsed, term]);
  const toggle = (code: string) => setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));

  /** Mostra o aviso da gravação e, se deu certo, fecha a escolha de contas do modelo. */
  const showResult = (result: ChartActionResult, closeCompletion = false) => {
    setNotice(result.message);
    if (result.ok && closeCompletion) setCompleteOpen(false);
  };

  const applyFullTemplate = () => void chart.applyTemplate().then((r) => showResult(r));

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Plano de contas"
        description={
          <>
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{accounts.length}</span> contas ·{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{analyticCount}</span> analíticas disponíveis
            para classificação.
          </>
        }
        actions={
          <>
            {isEmpty && (
              <button type="button" onClick={applyFullTemplate} disabled={applying} className={BUTTON.secondary}>
                <Wand2 className="w-4 h-4" strokeWidth={1.75} />
                {applying ? 'Aplicando…' : 'Modelo de plano de contas (CFC)'}
              </button>
            )}
            {!isEmpty && (missing.length > 0 || ignored.size > 0) && (
              <button
                type="button"
                onClick={() => setCompleteOpen(true)}
                disabled={applying}
                className={BUTTON.secondary}
                title="Escolha as contas do modelo que não estão no plano; as existentes não mudam"
              >
                <Wand2 className="w-4 h-4" strokeWidth={1.75} />
                {missing.length > 0 ? `Completar com o modelo (${missing.length})` : `Contas do modelo ignoradas (${ignored.size})`}
              </button>
            )}
            <button type="button" onClick={() => setSheetOpen(true)} disabled={isEmpty || !clientId || Boolean(loadFailure)} className={BUTTON.primary}>
              <Plus className="w-4 h-4" strokeWidth={2} />
              Nova conta
            </button>
          </>
        }
      />

      {notice && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-white/70 dark:bg-stone-900/60 border border-black/6 text-[13px] text-stone-600 dark:text-stone-300 animate-fade-in">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-accent-ink font-medium">
            OK
          </button>
        </div>
      )}

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por código ou nome da conta" />

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {loadFailure ? (
          <p role="alert" className="px-5 py-10 text-center text-[13px] text-rose-600">
            Não foi possível carregar o plano de contas ({loadFailure}). Recarregue a página para tentar de novo.
          </p>
        ) : isLoading ? (
          <StatementSkeleton rows={10} label="Carregando plano de contas…" />
        ) : isEmpty ? (
          <EmptyState
            title="Plano de contas vazio"
            description="Aplique o modelo de plano de contas do CFC (NBC TG 1002, Anexo 11), já amarrado à DRE."
            action={
              <button type="button" onClick={applyFullTemplate} disabled={applying} className={BUTTON.accent}>
                <Wand2 className="w-4 h-4" />
                {applying ? 'Aplicando…' : 'Modelo de plano de contas (CFC)'}
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState title="Nenhuma conta encontrada" description={`Nada corresponde a “${search}”.`} />
        ) : (
          <>
            <div
              aria-hidden
              className="flex items-center gap-2 pr-3 pl-[44px] py-2.5 border-b border-black/5 dark:border-white/6 text-[11px] uppercase tracking-wider text-stone-400"
            >
              <span className="w-32 shrink-0">Código</span>
              <span className="flex-1">Conta</span>
              <span className="w-28 shrink-0">Natureza</span>
              <span className="w-56 xl:w-64 shrink-0">Grupo na DRE</span>
              <span className="w-16 shrink-0" />
            </div>
            <div role="tree" aria-label="Plano de contas" className="[&>*:last-child]:border-b-0">
              {visible.map((n) => (
                <AccountTreeRow
                  key={n.account.id}
                  node={n}
                  expanded={expanded}
                  onToggle={toggle}
                  onEdit={(account, hasChildren) => setEditingTarget({ account, hasChildren })}
                  onDelete={(a) => void chart.deleteAccount(a).then((r) => showResult(r))}
                  isAdmin={isAdmin}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {completeOpen && (
        <TemplateCompletionSheet
          missing={missing}
          ignoredCount={ignored.size}
          busy={applying}
          onAdd={(codes) => chart.applyTemplate(codes).then((r) => showResult(r, true))}
          onIgnore={(codes) => chart.setIgnoredCodes([...ignored, ...codes]).then((r) => showResult(r, true))}
          onRestoreIgnored={() => chart.setIgnoredCodes([]).then((r) => showResult(r, true))}
          onClose={() => setCompleteOpen(false)}
        />
      )}

      {sheetOpen && clientId && (
        <NewAccountSheet
          accounts={accounts}
          clientId={clientId}
          onClose={() => setSheetOpen(false)}
          onCreated={() => {
            setSheetOpen(false);
            void chart.reload();
          }}
        />
      )}

      {editingTarget && clientId && (
        <EditAccountSheet
          account={editingTarget.account}
          accounts={accounts}
          hasChildren={editingTarget.hasChildren}
          lockState={chart.lockState}
          lockedMonths={chart.lockedMonths}
          onClose={() => setEditingTarget(null)}
          onSaved={(updated) => {
            setEditingTarget(null);
            setNotice(`Conta ${updated.code} (${updated.name}) atualizada.`);
            void chart.reload();
          }}
        />
      )}
    </main>
  );
}
