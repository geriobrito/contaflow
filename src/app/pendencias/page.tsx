'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Link2,
  Mail,
  MessageCircle,
  MessageCircleQuestion,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { BankTransaction, ChartAccount, ClientRequest, OrgSettings, RuleMatchType } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useReconciliation } from '@/hooks/useReconciliation';
import { closeClientRequest, createClientRequest, renewClientRequest, requestLink } from '@/lib/services/accounting-service';
import {
  answeredCount,
  hasUnreadAnswers,
  latestAnswers,
  latestResponseAt,
  notifyRequestsUpdated,
  unreadTransactionIds,
} from '@/lib/client-requests';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { ClassifySheet } from '@/components/conciliacao/ClassifySheet';
import { BUTTON, EmptyState, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
const RENEW_SOON_MS = 7 * 86_400_000;

function ShareLink({ request, email }: { request: ClientRequest; email?: string }) {
  const [copied, setCopied] = useState(false);
  const url = requestLink(window.location.origin, request.id);
  const text = `Olá! Precisamos de algumas informações sobre lançamentos da ${request.clientName}. Responda por este link (válido até ${new Date(request.expiresAtMs).toLocaleDateString('pt-BR')}): ${url}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label="Link para o cliente"
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-[240px] h-9 px-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] font-mono text-[12px] text-stone-600 dark:text-stone-300"
      />
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className={`${BUTTON.secondary} h-9`}
      >
        {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied ? 'Copiado' : 'Copiar'}
      </button>
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className={`${BUTTON.secondary} h-9`}>
        <MessageCircle className="w-4 h-4" /> WhatsApp
      </a>
      <a
        href={`mailto:${email ?? ''}?subject=${encodeURIComponent(`Informações sobre lançamentos · ${request.clientName}`)}&body=${encodeURIComponent(text)}`}
        className={`${BUTTON.secondary} h-9`}
      >
        <Mail className="w-4 h-4" /> E-mail
      </a>
    </div>
  );
}

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
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  /** Instante da última carga (validade dos links), fora do render. */
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
        .catch(() => undefined);
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
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // O hook de conciliação cobre o intervalo das perguntas: classificar e concluir daqui.
  const range = useMemo(() => {
    if (!queries.length) return null;
    const dates = queries.map((q) => q.date).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [queries]);
  const recon = useReconciliation({ clientId: loadedFor === clientId ? clientId : null, accounts, range });
  const { rules, lockedMonths, classifyTransaction, resolveClientQuery, loadAudit, isSaving } = recon;

  const answers = useMemo(() => latestAnswers(requests), [requests]);
  const openRequests = requests.filter((r) => r.status === 'OPEN' && r.expiresAtMs > nowMs);
  const inactiveRequests = requests.filter((r) => r.status === 'CLOSED' || r.expiresAtMs <= nowMs);
  const inOpenLink = new Set(openRequests.flatMap((r) => r.items.map((i) => i.transactionId)));
  const notSent = queries.filter((q) => !inOpenLink.has(q.id));

  const generate = async () => {
    if (!currentClient) return;
    setBusy(true);
    try {
      const req = await createClientRequest(currentClient, queries, org?.officeName);
      setRequests((prev) => [req, ...prev]);
      setNowMs(Date.now());
      notifyRequestsUpdated();
      setToast('Link criado · envie ao cliente');
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const close = async (req: ClientRequest) => {
    try {
      const closed = await closeClientRequest(req);
      setRequests((prev) => prev.map((r) => (r.id === req.id ? closed : r)));
      notifyRequestsUpdated();
      setToast('Link encerrado');
    } catch (e) {
      setError(describe(e));
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
      setError(describe(e));
    } finally {
      setRenewingId(null);
    }
  };

  const resolve = async (id: string, message = 'Pendência concluída') => {
    await resolveClientQuery(id);
    setQueries((prev) => prev.filter((q) => q.id !== id));
    setNewlyAnsweredIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setToast(message);
  };

  const loaded = recon.transactions;
  const memoPool = useMemo(() => recon.transactions.map((t) => t.memo), [recon.transactions]);
  const selectedLoaded = selected ? (loaded.find((t) => t.id === selected.id) ?? null) : null;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Pendências do cliente"
        description="Lançamentos que precisam de explicação do cliente. Gere um link e envie: o cliente justifica cada lançamento por escrito, sem login, e você classifica a partir da resposta."
        actions={
          <button type="button" disabled={busy || !notSent.length} onClick={() => void generate()} className={BUTTON.accent}>
            <Link2 className="w-4 h-4" /> Gerar link com {queries.length} pergunta(s)
          </button>
        }
      />
      {(error || recon.error) && <p role="alert" className="text-[13px] text-rose-600">{error ?? recon.error}</p>}

      {openRequests.length > 0 && (
        <section className={`${SURFACE} rounded-[22px] p-5 space-y-4`}>
          <h2 className="text-[15px] font-semibold tracking-tight">Links abertos</h2>
          {openRequests.map((r) => {
            const done = answeredCount(r);
            const nearExpiry = r.expiresAtMs - nowMs <= RENEW_SOON_MS;
            return (
              <div key={r.id} className="space-y-2 pb-3 last:pb-0 border-b last:border-b-0 border-black/[0.04] dark:border-white/[0.05]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-stone-500">
                  <span>
                    Criado em {formatDateTime(r.createdAt)} · {r.items.length} pergunta(s) · {done} respondida(s)
                    {r.respondedAt && ` · última resposta ${formatDateTime(r.respondedAt)}`} · válido até{' '}
                    <span className={nearExpiry ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
                      {new Date(r.expiresAtMs).toLocaleDateString('pt-BR')}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-3">
                    {nearExpiry && (
                      <button
                        type="button"
                        disabled={renewingId === r.id}
                        onClick={() => void renew(r)}
                        className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {renewingId === r.id ? 'Renovando…' : 'Renovar +30 dias'}
                      </button>
                    )}
                    <button type="button" onClick={() => void close(r)} className="text-rose-600 hover:underline">
                      Encerrar link
                    </button>
                  </span>
                </div>
                <ShareLink request={r} email={currentClient?.email} />
              </div>
            );
          })}
        </section>
      )}

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {loadedFor !== clientId ? (
          <TableSkeleton rows={5} label="Carregando pendências…" />
        ) : queries.length === 0 ? (
          <EmptyState
            title="Nenhuma pendência em aberto"
            description="Na Conciliação, abra um lançamento e use “Perguntar ao cliente” para incluí-lo aqui."
          />
        ) : (
          <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {queries.map((q) => {
              const answer = answers.get(q.id);
              const isNewAnswer = newlyAnsweredIds.has(q.id);
              const locked = isMonthLocked(q.date, lockedMonths);
              return (
                <li key={q.id} className="px-5 py-4 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-mono tabular-nums text-[12px] text-stone-400">{formatDateBR(q.date)}</span>
                    <span className="flex-1 min-w-0 text-[14px] font-medium tracking-tight truncate" title={q.memo}>
                      {q.memo}
                    </span>
                    <span className="font-mono tabular-nums text-[14px]">{formatCurrency(q.amount)}</span>
                  </div>
                  <p className="flex items-start gap-2 text-[13px] text-stone-600 dark:text-stone-300">
                    <MessageCircleQuestion className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" /> {q.clientQuery?.question}
                  </p>
                  {answer ? (
                    <div
                      className={`ml-6 rounded-2xl px-4 py-3 space-y-2 border ${
                        isNewAnswer
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700/60'
                          : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          Resposta do cliente{answer.answeredAt && ` · ${formatDateTime(answer.answeredAt)}`}
                        </p>
                        {isNewAnswer && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold tracking-tight">
                            <Sparkles className="w-2.5 h-2.5" />
                            Nova resposta
                          </span>
                        )}
                      </div>
                      <p className="text-[14px] text-stone-800 dark:text-stone-100 whitespace-pre-wrap break-words">{answer.text}</p>
                    </div>
                  ) : (
                    <p className="ml-6 text-[12px] text-stone-400">
                      {inOpenLink.has(q.id) ? 'Enviado ao cliente · aguardando resposta' : 'Ainda não enviado em link ativo · gere ou reative um link'}
                    </p>
                  )}
                  <div className="ml-6 flex flex-wrap gap-2">
                    {locked ? (
                      <span className="text-[12px] text-stone-500">Competência de {formatMonth(monthOf(q.date))} fechada</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isSaving || !loaded.some((t) => t.id === q.id)}
                          onClick={() => setSelected(q)}
                          className={`${BUTTON.primary} h-8`}
                        >
                          Classificar e concluir
                        </button>
                        <button type="button" disabled={isSaving} onClick={() => void resolve(q.id)} className={`${BUTTON.ghost} h-8`}>
                          Concluir sem classificar
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {inactiveRequests.length > 0 && (
        <details
          open={openRequests.length === 0 && queries.length > 0}
          className={`${SURFACE} group rounded-[22px] overflow-hidden`}
        >
          <summary className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer select-none text-[13px] font-medium text-stone-600 dark:text-stone-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
            <span>
              Links vencidos ou encerrados ({inactiveRequests.length}) · Reative para manter o mesmo endereço já enviado no WhatsApp
            </span>
            <ChevronDown className="w-4 h-4 text-stone-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-black/[0.04] dark:divide-white/[0.05] border-t border-black/[0.04] dark:border-white/[0.05]">
            {inactiveRequests.map((r) => {
              const done = answeredCount(r);
              const isExpiredOnly = r.status === 'OPEN' && r.expiresAtMs <= nowMs;
              return (
                <div key={r.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-[12px]">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium ${
                          isExpiredOnly
                            ? 'bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
                        }`}
                      >
                        {isExpiredOnly ? 'Vencido' : 'Encerrado'}
                      </span>
                      <span className="text-stone-700 dark:text-stone-300 font-medium">
                        Criado em {formatDateTime(r.createdAt)}
                      </span>
                      <span className="text-stone-400">
                        · {r.items.length} pergunta(s) · {done} respondida(s)
                      </span>
                    </div>
                    <p className="text-stone-400">
                      {isExpiredOnly
                        ? `Expirou em ${new Date(r.expiresAtMs).toLocaleDateString('pt-BR')}`
                        : 'Encerrado manualmente pelo escritório'}
                      {r.respondedAt && ` · última resposta em ${formatDateTime(r.respondedAt)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={renewingId === r.id}
                    onClick={() => void renew(r)}
                    className={`${BUTTON.secondary} h-8 shrink-0`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {renewingId === r.id ? 'Reativando…' : 'Reativar por +30 dias (mesmo link)'}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {selectedLoaded && (
        <ClassifySheet
          key={selectedLoaded.id}
          transaction={selectedLoaded}
          accounts={accounts}
          isSaving={isSaving}
          onClose={() => setSelected(null)}
          onConfirm={async (accountId: string, learnRule: boolean, customPattern: string, matchType: RuleMatchType) => {
            try {
              await classifyTransaction(selectedLoaded.id, accountId, {
                learnRule,
                customPattern: customPattern.trim() || undefined,
                matchType,
              });
              await resolve(selectedLoaded.id, 'Classificado e pendência concluída');
              setSelected(null);
            } catch {
              /* erro exposto pelo hook */
            }
          }}
          onSplit={async (drafts) => {
            try {
              await recon.splitTransaction(selectedLoaded.id, drafts);
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
          rules={rules}
          memoPool={memoPool}
          lockedMonthLabel={isMonthLocked(selectedLoaded.date, lockedMonths) ? formatMonth(monthOf(selectedLoaded.date)) : null}
          loadAudit={() => loadAudit(selectedLoaded.id)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
