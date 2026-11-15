'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Link2 } from 'lucide-react';
import type { BankTransaction, ChartAccount, ClientRequest, OrgSettings, RuleMatchType } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useReconciliation } from '@/hooks/useReconciliation';
import { useInvoiceMatches } from '@/hooks/reconciliation/useInvoiceMatches';
import { useInvoiceInspector } from '@/hooks/reconciliation/useInvoiceInspector';
import { useAccountSuggestions } from '@/hooks/reconciliation/useAccountSuggestions';
import { closeClientRequest, createClientRequest, renewClientRequest } from '@/lib/services/accounting-service';
import {
  answeredCount,
  groupPendingQueries,
  hasUnreadAnswers,
  latestAnswers,
  latestResponseAt,
  MAX_REQUEST_ITEMS,
  notifyRequestsUpdated,
  type PendingQueryFilter,
  pendingQueryCounts,
  sentAtByTransaction,
  unreadTransactionIds,
} from '@/lib/client-requests';
import { mainSplitAccountId } from '@/lib/reconciliation-list';
import { rememberRecentAccounts } from '@/lib/recent-accounts';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { reportError } from '@/lib/monitoring';
import { ClassifySheet } from '@/components/conciliacao/ClassifySheet';
import { InvoiceDetailDrawer } from '@/components/conciliacao/InvoiceDetailDrawer';
import { ClientRequestLinks } from '@/components/pendencias/ClientRequestLinks';
import { PendingQueriesList } from '@/components/pendencias/PendingQueriesList';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BUTTON, PAGE, PageHeader } from '@/components/ui/primitives';
import { Toast, useToast } from '@/components/ui/Toast';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

export default function PendenciasPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id ?? null;
  const [queries, setQueries] = useState<BankTransaction[]>([]);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [newlyAnsweredIds, setNewlyAnsweredIds] = useState<Set<string>>(() => new Set());
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [closingRequest, setClosingRequest] = useState<ClientRequest | null>(null);
  const [filter, setFilter] = useState<PendingQueryFilter>('ALL');
  const [toast, setToast] = useToast(3600);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  /** Instante da última carga (validade dos links e dias de espera), fora do render. */
  const [nowMs, setNowMs] = useState(0);

  const load = useCallback(async (id: string) => {
    const repo = getRepository();
    const [q, r, a, o] = await Promise.all([
      repo.listOpenQueries(id),
      repo.listClientRequests(id),
      repo.listAccounts(id),
      repo.getOrgSettings(),
    ]);

    const unreadTx = unreadTransactionIds(r);
    setNewlyAnsweredIds(unreadTx);

    const unreadReqs = r.filter(hasUnreadAnswers);
    let normalizedRequests = r;
    if (unreadReqs.length > 0) {
      const nowIso = new Date().toISOString();
      const markPayload = unreadReqs.map((req) => {
        const latest = latestResponseAt(req);
        const seenAt = latest && latest > nowIso ? latest : nowIso;
        return { id: req.id, seenAt };
      });
      const seenMap = new Map(markPayload.map((m) => [m.id, m.seenAt] as const));
      normalizedRequests = r.map((req) => (seenMap.has(req.id) ? { ...req, seenAt: seenMap.get(req.id) } : req));
      void repo
        .markClientRequestsSeen(markPayload)
        .then(() => notifyRequestsUpdated())
        .catch((e: unknown) => reportError(e, { area: 'pendencias', op: 'marcar respostas como lidas', level: 'warning' }));
    }

    setQueries(q);
    setRequests(normalizedRequests);
    setAccounts(a);
    setOrg(o);
    setNowMs(Date.now());
    setLoadedFor(id);
    setError(null);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.resolve()
      .then(() => (active ? load(clientId) : undefined))
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'pendencias', op: 'carregar pendências' });
        setError(`Não foi possível carregar as pendências (${describe(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, load]);

  // Usa os lançamentos já trazidos por `listOpenQueries` sem ler meses inteiros de extrato no Firestore.
  const recon = useReconciliation({
    clientId: loadedFor === clientId ? clientId : null,
    accounts,
    range: null,
    prefetchedTransactions: queries,
  });
  const { rules, lockedMonths, classifyTransaction, resolveClientQuery, askClient, loadAudit, isSaving, isLoading: isLoadingRecon } = recon;

  // Janela de datas das pendências apenas para buscar resumos de notas fiscais correspondentes.
  const invoiceRange = useMemo(() => {
    if (!queries.length) return null;
    const dates = queries.map((q) => q.date).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [queries]);
  const invoices = useInvoiceMatches({
    clientId: loadedFor === clientId ? clientId : null,
    range: invoiceRange,
    transactions: recon.transactions,
    accounts,
  });
  const inspector = useInvoiceInspector(invoices);

  const loaded = recon.transactions;
  const loadedTxIds = useMemo(() => new Set(loaded.map((t) => t.id)), [loaded]);
  const memoPool = useMemo(() => loaded.map((t) => t.memo), [loaded]);
  const selectedLoaded = selected ? (loaded.find((t) => t.id === selected.id) ?? null) : null;

  const suggestions = useAccountSuggestions({
    clientId,
    accounts,
    transactions: loaded,
    selected: selectedLoaded,
    invoiceAccountId: selectedLoaded ? inspector.matchFor(selectedLoaded)?.suggestedAccountId : null,
    rules,
    group: null,
    bulk: null,
  });

  const answers = useMemo(() => latestAnswers(requests), [requests]);
  const openRequests = useMemo(() => requests.filter((r) => r.status === 'OPEN' && r.expiresAtMs > nowMs), [requests, nowMs]);
  const inactiveRequests = useMemo(() => requests.filter((r) => r.status === 'CLOSED' || r.expiresAtMs <= nowMs), [requests, nowMs]);
  const inOpenLink = useMemo(() => new Set(openRequests.flatMap((r) => r.items.map((i) => i.transactionId))), [openRequests]);
  const sentAtMap = useMemo(() => sentAtByTransaction(openRequests), [openRequests]);
  const counts = useMemo(() => pendingQueryCounts(queries, answers, inOpenLink), [queries, answers, inOpenLink]);
  const groups = useMemo(
    () =>
      groupPendingQueries({
        queries,
        answers,
        inOpenLink,
        sentAtMap,
        newlyAnsweredIds,
        filter,
      }),
    [queries, answers, inOpenLink, sentAtMap, newlyAnsweredIds, filter]
  );

  const notSent = useMemo(() => queries.filter((q) => !inOpenLink.has(q.id)), [queries, inOpenLink]);
  // O link leva até MAX_REQUEST_ITEMS perguntas: as ainda não enviadas entram primeiro.
  const toSend = useMemo(() => [...notSent, ...queries.filter((q) => inOpenLink.has(q.id))], [notSent, queries, inOpenLink]);
  const sendCount = Math.min(toSend.length, MAX_REQUEST_ITEMS);

  const generate = async () => {
    if (!currentClient) return;
    setBusy(true);
    setError(null);
    try {
      const req = await createClientRequest(currentClient, toSend, org?.officeName);
      setRequests((prev) => [req, ...prev]);
      setNowMs(Date.now());
      notifyRequestsUpdated();
      setToast(
        req.items.length < toSend.length
          ? `${req.items.length} de ${toSend.length} perguntas enviadas · gere outro link para as restantes`
          : 'Link criado · envie ao cliente'
      );
    } catch (e) {
      reportError(e, { area: 'pendencias', op: 'gerar link' });
      setError(`Não foi possível gerar o link (${describe(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  const confirmCloseRequest = async () => {
    if (!closingRequest) return;
    setError(null);
    try {
      const closed = await closeClientRequest(closingRequest);
      setRequests((prev) => prev.map((r) => (r.id === closingRequest.id ? closed : r)));
      setClosingRequest(null);
      notifyRequestsUpdated();
      setToast('Link encerrado');
    } catch (e) {
      reportError(e, { area: 'pendencias', op: 'encerrar link' });
      setError(`Não foi possível encerrar o link (${describe(e)}).`);
      throw e;
    }
  };

  const renew = async (req: ClientRequest) => {
    setRenewingId(req.id);
    setError(null);
    try {
      const wasInactive = req.status === 'CLOSED' || req.expiresAtMs <= nowMs;
      const renewed = await renewClientRequest(req);
      setRequests((prev) => prev.map((r) => (r.id === req.id ? renewed : r)));
      notifyRequestsUpdated();
      setToast(
        wasInactive
          ? 'Link reativado por +30 dias · o mesmo endereço enviado no WhatsApp voltou a funcionar'
          : `Validade prorrogada até ${new Date(renewed.expiresAtMs).toLocaleDateString('pt-BR')}`
      );
    } catch (e) {
      reportError(e, { area: 'pendencias', op: 'renovar link' });
      setError(`Não foi possível renovar o link (${describe(e)}).`);
    } finally {
      setRenewingId(null);
    }
  };

  const resolve = async (id: string, message = 'Pendência concluída') => {
    try {
      await resolveClientQuery(id);
      setQueries((prev) => prev.filter((q) => q.id !== id));
      setNewlyAnsweredIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setToast(message);
    } catch (e) {
      reportError(e, { area: 'pendencias', op: 'concluir pendência' });
      setError(`Não foi possível concluir a pendência (${describe(e)}).`);
    }
  };

  const handleEditQuestion = async (txId: string, question: string) => {
    const trimmed = question.trim();
    try {
      await askClient(txId, trimmed);
      if (!trimmed) {
        setQueries((prev) => prev.filter((q) => q.id !== txId));
        setSelected(null);
        setToast('Pergunta removida');
      } else {
        setQueries((prev) =>
          prev.map((q) =>
            q.id === txId && q.clientQuery ? { ...q, clientQuery: { ...q.clientQuery, question: trimmed } } : q
          )
        );
        setToast('Pergunta atualizada');
      }
    } catch (e) {
      reportError(e, { area: 'pendencias', op: 'editar pergunta' });
    }
  };

  const activeError = error ?? recon.error;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Pendências do cliente"
        description="Lançamentos que precisam de explicação do cliente. Gere um link e envie: o cliente justifica cada lançamento por escrito, sem login, e você classifica a partir da resposta."
        actions={
          <button type="button" disabled={busy || !notSent.length} onClick={() => void generate()} className={BUTTON.accent}>
            <Link2 className="w-4 h-4" /> Gerar link com {sendCount} pergunta(s)
          </button>
        }
      />

      {queries.length > MAX_REQUEST_ITEMS && notSent.length > 0 && (
        <p className="text-[13px] text-amber-700 dark:text-amber-400">
          Cada link leva até {MAX_REQUEST_ITEMS} perguntas. {notSent.length} de {queries.length} ainda não estão em nenhum link aberto: gere outro
          link para as restantes.
        </p>
      )}

      {activeError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-rose-200/70 bg-rose-50/90 dark:bg-rose-950/30 dark:border-rose-500/30 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{activeError}</span>
        </div>
      )}

      <ClientRequestLinks
        openRequests={openRequests}
        inactiveRequests={inactiveRequests}
        hasOpenQueries={queries.length > 0}
        client={currentClient}
        nowMs={nowMs}
        renewingId={renewingId}
        onRenew={(r) => void renew(r)}
        onRequestClose={(r) => setClosingRequest(r)}
        onNotify={setToast}
      />

      <PendingQueriesList
        loading={loadedFor !== clientId}
        totalQueries={queries.length}
        counts={counts}
        filter={filter}
        onFilterChange={setFilter}
        groups={groups}
        answers={answers}
        newlyAnsweredIds={newlyAnsweredIds}
        sentAtMap={sentAtMap}
        lockedMonths={lockedMonths}
        nowMs={nowMs}
        isSaving={isSaving}
        isLoadingRecon={isLoadingRecon}
        loadedTxIds={loadedTxIds}
        invoiceHints={invoices.matches.size > 0 || invoices.linked.size > 0 ? inspector.hints : undefined}
        onSelectClassify={(q) => setSelected(q)}
        onResolveWithoutClassifying={(id) => void resolve(id)}
        onEditQuestion={handleEditQuestion}
        onOpenInvoice={inspector.openFor}
      />

      {closingRequest && (
        <ConfirmDialog
          title="Encerrar link de pendências?"
          description={(() => {
            const done = answeredCount(closingRequest);
            const missing = Math.max(0, closingRequest.items.length - done);
            return missing > 0
              ? `Ainda falta(m) ${missing} de ${closingRequest.items.length} pergunta(s) sem resposta neste link. Ao encerrar, o cliente não conseguirá mais enviar respostas por este endereço (você poderá reativá-lo depois se precisar).`
              : 'O cliente não conseguirá mais acessar ou complementar respostas por este endereço. Você poderá reativar o link depois se precisar.';
          })()}
          confirmLabel="Encerrar link"
          destructive
          onCancel={() => setClosingRequest(null)}
          onConfirm={() => confirmCloseRequest()}
        />
      )}

      {selectedLoaded && (
        <ClassifySheet
          key={selectedLoaded.id}
          transaction={selectedLoaded}
          accounts={accounts}
          isSaving={isSaving}
          onClose={() => setSelected(null)}
          onConfirm={async (accountId: string, learnRule: boolean, customPattern: string, matchType: RuleMatchType, invoiceId?: string) => {
            try {
              await classifyTransaction(selectedLoaded.id, accountId, {
                learnRule,
                customPattern: customPattern.trim() || undefined,
                matchType,
              });
              rememberRecentAccounts(clientId, [accountId]);
              if (invoiceId) await invoices.link(selectedLoaded.id, invoiceId, accountId);
              await resolve(selectedLoaded.id, 'Classificado e pendência concluída');
              setSelected(null);
            } catch {
              /* erro exposto pelo hook */
            }
          }}
          onSplit={async (drafts, invoiceId?: string) => {
            try {
              await recon.splitTransaction(selectedLoaded.id, drafts);
              const mainAccountId = mainSplitAccountId(drafts);
              rememberRecentAccounts(clientId, drafts.map((d) => d.accountId));
              if (invoiceId && mainAccountId) await invoices.link(selectedLoaded.id, invoiceId, mainAccountId);
              await resolve(selectedLoaded.id, 'Rateado e pendência concluída');
              setSelected(null);
            } catch {
              /* erro exposto pelo hook */
            }
          }}
          onUnreconcile={async () => {
            try {
              await recon.unreconcileTransaction(selectedLoaded.id);
              setSelected(null);
            } catch {
              /* erro exposto pelo hook */
            }
          }}
          onAskClient={async (qText) => {
            await handleEditQuestion(selectedLoaded.id, qText);
          }}
          rules={rules}
          memoPool={memoPool}
          invoiceMatch={inspector.matchFor(selectedLoaded)}
          linkedInvoice={invoices.linked.get(selectedLoaded.id)}
          suggestions={suggestions.forSelected}
          regime={currentClient?.regime}
          lockedMonthLabel={isMonthLocked(selectedLoaded.date, lockedMonths) ? formatMonth(monthOf(selectedLoaded.date)) : null}
          loadAudit={() => loadAudit(selectedLoaded.id)}
          onViewInvoice={(inv) => inspector.show({ invoice: inv, match: inspector.matchFor(selectedLoaded), transaction: selectedLoaded })}
        />
      )}

      {inspector.inspecting && (
        <InvoiceDetailDrawer
          invoice={inspector.inspecting.invoice}
          match={inspector.inspecting.match}
          transaction={inspector.inspecting.transaction}
          accounts={accounts}
          onClose={inspector.close}
          onClassifyWithSuggestion={(tx, accId, invId) => {
            inspector.close();
            void (async () => {
              try {
                await classifyTransaction(tx.id, accId);
                rememberRecentAccounts(clientId, [accId]);
                await invoices.link(tx.id, invId, accId);
                await resolve(tx.id, 'Classificado pela nota fiscal e pendência concluída');
              } catch {
                /* erro exposto pelo hook */
              }
            })();
          }}
          onOpenSplit={(tx) => {
            inspector.close();
            setSelected(tx);
          }}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}
