'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Link2, Mail, MessageCircle, MessageCircleQuestion, Paperclip } from 'lucide-react';
import type { BankTransaction, ChartAccount, ClientRequest, ClientRequestItem, OrgSettings, RuleMatchType } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useReconciliation } from '@/hooks/useReconciliation';
import { closeClientRequest, createClientRequest, requestLink } from '@/lib/services/accounting-service';
import { openBase64File } from '@/lib/client-files';
import { formatMonth, isMonthLocked, monthOf } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { ClassifySheet } from '@/components/conciliacao/ClassifySheet';
import { BUTTON, EmptyState, PAGE, PageHeader, SURFACE } from '@/components/ui/primitives';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

/** Resposta mais recente do cliente para cada lançamento (entre todos os links). */
function latestAnswers(requests: readonly ClientRequest[]): Map<string, ClientRequestItem & { requestId: string }> {
  const out = new Map<string, ClientRequestItem & { requestId: string }>();
  for (const r of [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    for (const item of r.items) {
      if (item.answer || item.files?.length) out.set(item.transactionId, { ...item, requestId: r.id });
    }
  }
  return out;
}

function ShareLink({ request, email }: { request: ClientRequest; email?: string }) {
  const [copied, setCopied] = useState(false);
  const url = requestLink(window.location.origin, request.id);
  const text = `Olá! Precisamos de algumas informações sobre lançamentos da ${request.clientName}. Responda por este link (válido até ${new Date(request.expiresAtMs).toLocaleDateString('pt-BR')}): ${url}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input readOnly value={url} aria-label="Link para o cliente" onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-[240px] h-9 px-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] font-mono text-[12px] text-stone-600" />
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
      <a href={`mailto:${email ?? ''}?subject=${encodeURIComponent(`Informações sobre lançamentos · ${request.clientName}`)}&body=${encodeURIComponent(text)}`} className={`${BUTTON.secondary} h-9`}>
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
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  /** Instante da última carga (validade dos links), fora do render. */
  const [nowMs, setNowMs] = useState(0);

  const load = useCallback(async (id: string) => {
    const repo = getRepository();
    const [q, r, a, o] = await Promise.all([repo.listOpenQueries(id), repo.listClientRequests(id), repo.listAccounts(id), repo.getOrgSettings()]);
    setQueries(q);
    setRequests(r);
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
    const t = setTimeout(() => setToast(null), 3200);
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
  const inOpenLink = new Set(openRequests.flatMap((r) => r.items.map((i) => i.transactionId)));
  const notSent = queries.filter((q) => !inOpenLink.has(q.id));

  const generate = async () => {
    if (!currentClient) return;
    setBusy(true);
    try {
      const req = await createClientRequest(currentClient, queries, org?.officeName);
      setRequests((prev) => [req, ...prev]);
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
    } catch (e) {
      setError(describe(e));
    }
  };

  const resolve = async (id: string, message = 'Pendência concluída') => {
    await resolveClientQuery(id);
    setQueries((prev) => prev.filter((q) => q.id !== id));
    setToast(message);
  };

  const openFile = async (fileId: string) => {
    try {
      const f = await getRepository().getClientRequestFile(fileId);
      if (!f) throw new Error('Arquivo não encontrado.');
      openBase64File(f.data, f.type);
    } catch (e) {
      setError(describe(e));
    }
  };

  const loaded = recon.transactions;
  const memoPool = useMemo(() => recon.transactions.map((t) => t.memo), [recon.transactions]);
  const selectedLoaded = selected ? (loaded.find((t) => t.id === selected.id) ?? null) : null;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Pendências do cliente"
        description="Lançamentos que precisam de explicação do cliente. Gere um link: o cliente responde e anexa comprovantes sem precisar de login."
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
            const done = r.items.filter((i) => i.answer || i.files?.length).length;
            return (
              <div key={r.id} className="space-y-2">
                <p className="text-[12px] text-stone-500">
                  Criado em {formatDateTime(r.createdAt)} · {r.items.length} pergunta(s) · {done} respondida(s)
                  {r.respondedAt && ` · última resposta ${formatDateTime(r.respondedAt)}`} · válido até {new Date(r.expiresAtMs).toLocaleDateString('pt-BR')}
                  <button type="button" onClick={() => void close(r)} className="ml-2 text-rose-600 hover:underline">Encerrar link</button>
                </p>
                <ShareLink request={r} email={currentClient?.email} />
              </div>
            );
          })}
        </section>
      )}

      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        {loadedFor !== clientId ? (
          <p className="px-5 py-10 text-center text-[13px] text-stone-400">Carregando…</p>
        ) : queries.length === 0 ? (
          <EmptyState
            title="Nenhuma pendência em aberto"
            description="Na Conciliação, abra um lançamento e use “Perguntar ao cliente” para incluí-lo aqui."
          />
        ) : (
          <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {queries.map((q) => {
              const answer = answers.get(q.id);
              const locked = isMonthLocked(q.date, lockedMonths);
              return (
                <li key={q.id} className="px-5 py-4 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-mono tabular-nums text-[12px] text-stone-400">{formatDateBR(q.date)}</span>
                    <span className="flex-1 min-w-0 text-[14px] font-medium tracking-tight truncate" title={q.memo}>{q.memo}</span>
                    <span className="font-mono tabular-nums text-[14px]">{formatCurrency(q.amount)}</span>
                  </div>
                  <p className="flex items-start gap-2 text-[13px] text-stone-600 dark:text-stone-300">
                    <MessageCircleQuestion className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" /> {q.clientQuery?.question}
                  </p>
                  {answer ? (
                    <div className="ml-6 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 px-4 py-3 space-y-2">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-700">
                        Resposta do cliente{answer.answeredAt && ` · ${formatDateTime(answer.answeredAt)}`}
                      </p>
                      {answer.answer && <p className="text-[14px] text-stone-800 dark:text-stone-100 whitespace-pre-wrap">{answer.answer}</p>}
                      {answer.files?.map((f) => (
                        <button key={f.id} type="button" onClick={() => void openFile(f.id)} className="mr-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-stone-800 border border-black/[0.06] text-[12px] hover:border-[#0071E3]/40">
                          {f.type === 'application/pdf' ? <FileText className="w-3.5 h-3.5" /> : <Paperclip className="w-3.5 h-3.5" />}
                          {f.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="ml-6 text-[12px] text-stone-400">
                      {inOpenLink.has(q.id) ? 'Enviado ao cliente · aguardando resposta' : 'Ainda não enviado · gere um link'}
                    </p>
                  )}
                  <div className="ml-6 flex flex-wrap gap-2">
                    {locked ? (
                      <span className="text-[12px] text-stone-500">Competência de {formatMonth(monthOf(q.date))} fechada</span>
                    ) : (
                      <>
                        <button type="button" disabled={isSaving || !loaded.some((t) => t.id === q.id)} onClick={() => setSelected(q)} className={`${BUTTON.primary} h-8`}>
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

      {requests.some((r) => r.status === 'CLOSED' || r.expiresAtMs <= nowMs) && (
        <p className="text-[12px] text-stone-400">
          {requests.filter((r) => r.status === 'CLOSED' || r.expiresAtMs <= nowMs).length} link(s) encerrado(s) ou vencido(s). As respostas deles continuam
          aparecendo acima.
        </p>
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
              await classifyTransaction(selectedLoaded.id, accountId, { learnRule, customPattern: customPattern.trim() || undefined, matchType });
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
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
