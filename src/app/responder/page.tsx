'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, FileText, Paperclip, Sparkles, X } from 'lucide-react';
import type { ClientRequest, ClientRequestFileRef, ClientRequestItem } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { prepareUpload, type PreparedFile } from '@/lib/client-files';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

const randomId = () => {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

interface Draft {
  answer: string;
  files: ClientRequestFileRef[];
  pending: (PreparedFile & { key: string })[];
}

/**
 * Página pública (sem login) em que o cliente responde às perguntas do escritório e
 * anexa comprovantes. O token do link é a credencial; nada além destas perguntas é exposto.
 */
function Responder() {
  const token = useSearchParams().get('t') ?? '';
  const [request, setRequest] = useState<ClientRequest | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'closed' | 'sent'>('loading');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => (token.length >= 32 ? getRepository().getPublicClientRequest(token) : null))
      .then((req) => {
        if (!active) return;
        if (!req) return setState('invalid');
        setRequest(req);
        setDrafts(Object.fromEntries(req.items.map((i) => [i.transactionId, { answer: i.answer ?? '', files: i.files ?? [], pending: [] }])));
        setState(req.status !== 'OPEN' || Date.now() >= req.expiresAtMs ? 'closed' : 'ready');
      })
      .catch(() => active && setState('invalid'));
    return () => {
      active = false;
    };
  }, [token]);

  const update = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const attach = async (id: string, list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    try {
      const prepared = await Promise.all([...list].map(prepareUpload));
      setDrafts((d) => ({ ...d, [id]: { ...d[id], pending: [...d[id].pending, ...prepared.map((p) => ({ ...p, key: randomId() }))] } }));
    } catch (e) {
      setError(describe(e));
    }
  };

  const send = async () => {
    if (!request) return;
    setSending(true);
    setError(null);
    try {
      const repo = getRepository();
      const now = new Date().toISOString();
      const items: ClientRequestItem[] = [];
      for (const item of request.items) {
        const draft = drafts[item.transactionId];
        const uploaded: ClientRequestFileRef[] = [];
        for (const f of draft.pending) {
          const id = `${request.id.slice(0, 8)}_${randomId()}`;
          await repo.uploadPublicClientRequestFile({
            id,
            orgId: request.orgId ?? '',
            clientId: request.clientId,
            requestId: request.id,
            transactionId: item.transactionId,
            name: f.name,
            type: f.type,
            bytes: f.bytes,
            data: f.data,
            uploadedAt: now,
          });
          uploaded.push({ id, name: f.name, type: f.type, size: f.bytes });
        }
        const answer = draft.answer.trim();
        const changed = answer !== (item.answer ?? '') || uploaded.length > 0;
        const files = [...draft.files, ...uploaded];
        items.push({
          transactionId: item.transactionId,
          date: item.date,
          memo: item.memo,
          amount: item.amount,
          question: item.question,
          ...(answer ? { answer } : {}),
          ...(changed && (answer || files.length) ? { answeredAt: now } : item.answeredAt ? { answeredAt: item.answeredAt } : {}),
          ...(files.length ? { files } : {}),
        });
      }
      await repo.answerPublicClientRequest(request.id, items, now);
      setRequest({ ...request, items, respondedAt: now });
      setDrafts(Object.fromEntries(items.map((i) => [i.transactionId, { answer: i.answer ?? '', files: i.files ?? [], pending: [] }])));
      setState('sent');
    } catch (e) {
      setError(`Não foi possível enviar (${describe(e)}). Tente de novo.`);
    } finally {
      setSending(false);
    }
  };

  const answered = request ? request.items.filter((i) => drafts[i.transactionId]?.answer.trim() || drafts[i.transactionId]?.files.length || drafts[i.transactionId]?.pending.length).length : 0;

  return (
    <main className="min-h-screen bg-[#F5F5F7] dark:bg-stone-950 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="flex items-center gap-2 text-stone-500">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#D97757] to-[#C15F3C] flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </span>
          <span className="text-[13px] font-medium">{request?.officeName || 'ContaFlow'}</span>
        </header>

        {state === 'loading' && <p className="text-center text-[14px] text-stone-400 py-20">Carregando…</p>}
        {state === 'invalid' && (
          <div className="rounded-3xl bg-white dark:bg-stone-900 p-8 text-center">
            <h1 className="text-[20px] font-semibold tracking-tight">Link inválido</h1>
            <p className="mt-2 text-[14px] text-stone-500">Confira se o endereço foi copiado inteiro ou peça um novo link ao escritório.</p>
          </div>
        )}
        {request && state !== 'invalid' && state !== 'loading' && (
          <>
            <div className="space-y-2">
              <h1 className="text-[28px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">Informações sobre lançamentos</h1>
              <p className="text-[15px] text-stone-600 dark:text-stone-300">
                {request.officeName ? `O escritório ${request.officeName}` : 'Seu escritório de contabilidade'} precisa entender{' '}
                {request.items.length === 1 ? 'um lançamento' : `${request.items.length} lançamentos`} da empresa <b>{request.clientName}</b>.
                Responda com poucas palavras e, se tiver, anexe a nota fiscal ou o comprovante.
              </p>
              {state === 'closed' && (
                <p className="rounded-2xl bg-amber-50 border border-amber-200/60 px-4 py-3 text-[13px] text-amber-800">
                  Este link não aceita mais respostas. Se precisar complementar algo, fale com o escritório.
                </p>
              )}
              {state === 'sent' && (
                <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200/60 px-4 py-3 text-[13px] text-emerald-800">
                  <CheckCircle2 className="w-4 h-4" /> Respostas enviadas. Obrigado! Você pode complementar enquanto o link estiver aberto.
                </p>
              )}
            </div>

            <ol className="space-y-4">
              {request.items.map((item, idx) => {
                const d = drafts[item.transactionId];
                const readOnly = state === 'closed';
                return (
                  <li key={item.transactionId} className="rounded-3xl bg-white/90 dark:bg-stone-900/80 border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.04)] p-5 space-y-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[12px] font-medium text-stone-400">
                        {idx + 1} de {request.items.length} · <span className="font-mono tabular-nums">{formatDateBR(item.date)}</span>
                      </span>
                      <span className={`font-mono tabular-nums text-[17px] font-semibold ${item.amount < 0 ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600'}`}>
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                    <p className="font-mono text-[12px] text-stone-500 break-words">{item.memo}</p>
                    <p className="text-[15px] font-medium tracking-tight text-stone-900 dark:text-stone-100">{item.question}</p>
                    <textarea
                      value={d?.answer ?? ''}
                      disabled={readOnly}
                      onChange={(e) => update(item.transactionId, { answer: e.target.value })}
                      rows={3}
                      maxLength={2000}
                      placeholder="Ex.: pagamento do fornecedor de embalagens, nota 1234"
                      aria-label={`Resposta ${idx + 1}`}
                      className="w-full px-3.5 py-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[15px] outline-none focus:border-[#0071E3]/60 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)] disabled:opacity-60"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {[...(d?.files ?? []).map((f) => ({ key: f.id, name: f.name, sent: true })), ...(d?.pending ?? []).map((f) => ({ key: f.key, name: f.name, sent: false }))].map((f) => (
                        <span key={f.key} className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-[12px] text-stone-700 dark:text-stone-200">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          {!f.sent && (
                            <button type="button" aria-label={`Remover ${f.name}`} onClick={() => update(item.transactionId, { pending: d.pending.filter((p) => p.key !== f.key) })}>
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                      {!readOnly && (
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium text-[#0071E3] hover:bg-blue-50 cursor-pointer">
                          <Paperclip className="w-3.5 h-3.5" /> Anexar comprovante
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            multiple
                            className="sr-only"
                            aria-label={`Anexar comprovante ${idx + 1}`}
                            onChange={(e) => {
                              void attach(item.transactionId, e.target.files);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}
            {state !== 'closed' && (
              <div className="sticky bottom-4">
                <button
                  type="button"
                  disabled={sending || answered === 0}
                  onClick={() => void send()}
                  className="w-full h-12 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[15px] font-medium shadow-[0_8px_24px_rgba(0,113,227,0.3)] disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {sending ? 'Enviando…' : `Enviar respostas (${answered} de ${request.items.length})`}
                </button>
              </div>
            )}
            <p className="text-center text-[12px] text-stone-400">
              Link válido até {new Date(request.expiresAtMs).toLocaleDateString('pt-BR')}. Somente estas perguntas ficam visíveis por ele.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function ResponderPage() {
  return (
    <Suspense fallback={null}>
      <Responder />
    </Suspense>
  );
}
