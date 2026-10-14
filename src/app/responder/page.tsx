'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import type { ClientRequest, ClientRequestAnswer } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { answerAt, MAX_ANSWER_LENGTH, tokenFromLocation } from '@/lib/client-requests';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');

/** Texto de cada resposta, na ordem das perguntas. */
const draftsOf = (req: ClientRequest): string[] => req.items.map((_, i) => answerAt(req, i)?.text ?? '');

/**
 * Página pública (sem login) em que o cliente justifica os lançamentos perguntados pelo
 * escritório, em texto. O token do link é a credencial; nada além destas perguntas é
 * exposto, e só as respostas são gravadas. O token vem no fragmento do endereço (`#t=`),
 * que não é enviado ao servidor nem aparece nos registros de acesso.
 */
export default function ResponderPage() {
  const [request, setRequest] = useState<ClientRequest | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'closed' | 'sent'>('loading');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        const token = tokenFromLocation(window.location);
        // Link antigo (`?t=`): passa o token para o fragmento, fora do endereço enviado ao servidor.
        if (token && window.location.search) window.history.replaceState(null, '', `${window.location.pathname}#t=${token}`);
        return token.length >= 32 ? getRepository().getPublicClientRequest(token) : null;
      })
      .then((req) => {
        if (!active) return;
        if (!req) return setState('invalid');
        setRequest(req);
        setDrafts(draftsOf(req));
        setState(req.status !== 'OPEN' || Date.now() >= req.expiresAtMs ? 'closed' : 'ready');
      })
      .catch(() => active && setState('invalid'));
    // Trocar só o fragmento não recarrega a página: outro link aberto na mesma aba recomeça do zero.
    const onHashChange = () => window.location.reload();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const send = async () => {
    if (!request) return;
    setSending(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      // Uma resposta por pergunta, na mesma ordem; a data só muda quando o texto muda.
      const answers: ClientRequestAnswer[] = request.items.map((_, i) => {
        const text = (drafts[i] ?? '').trim().slice(0, MAX_ANSWER_LENGTH);
        const previous = answerAt(request, i);
        if (!text) return { text: '' };
        const answeredAt = previous?.text === text ? previous.answeredAt : now;
        return { text, ...(answeredAt ? { answeredAt } : {}) };
      });
      await getRepository().answerPublicClientRequest(request.id, answers, now);
      const updated = { ...request, answers, respondedAt: now };
      setRequest(updated);
      setDrafts(draftsOf(updated));
      setState('sent');
    } catch (e) {
      setError(`Não foi possível enviar (${describe(e)}). Tente de novo.`);
    } finally {
      setSending(false);
    }
  };

  const answered = drafts.filter((d) => d.trim()).length;

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
                Explique em poucas palavras do que se trata cada um e envie.
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
              {request.items.map((item, idx) => (
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
                    value={drafts[idx] ?? ''}
                    disabled={state === 'closed'}
                    onChange={(e) => setDrafts((d) => d.map((text, i) => (i === idx ? e.target.value : text)))}
                    rows={3}
                    maxLength={MAX_ANSWER_LENGTH}
                    placeholder="Ex.: pagamento do fornecedor de embalagens, nota 1234"
                    aria-label={`Resposta ${idx + 1}`}
                    className="w-full px-3.5 py-3 rounded-xl bg-white dark:bg-stone-800 border border-black/[0.08] text-[15px] outline-none focus:border-[#0071E3]/60 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)] disabled:opacity-60"
                  />
                </li>
              ))}
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
