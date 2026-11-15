'use client';

import { useState } from 'react';
import { BellRing, Check, ChevronDown, Copy, Mail, MessageCircle, RotateCcw } from 'lucide-react';
import type { ClientCompany, ClientRequest } from '@/types/firestore';
import {
  answeredCount,
  buildReminderMessage,
  buildShareMessage,
  clientWhatsAppPhone,
  requestLink,
  whatsAppLink,
} from '@/lib/client-requests';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { BUTTON, SURFACE } from '@/components/ui/primitives';

const RENEW_SOON_MS = 7 * 86_400_000;

interface ShareLinkProps {
  request: ClientRequest;
  client?: Pick<ClientCompany, 'email' | 'phone' | 'registration'> | null;
  onNotify?: (message: string) => void;
}

function ShareLink({ request, client, onNotify }: ShareLinkProps) {
  const [copiedKind, setCopiedKind] = useState<'url' | 'message' | 'reminder' | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = requestLink(origin, request.id);
  const shareText = buildShareMessage(request, url);
  const reminderText = buildReminderMessage(request, url);
  const done = answeredCount(request);
  const missing = Math.max(0, request.items.length - done);
  const phone = clientWhatsAppPhone(client);
  const rawPhone = client?.phone || client?.registration?.phone2;

  const copyText = (text: string, kind: 'url' | 'message' | 'reminder', toastMessage?: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedKind(kind);
      if (toastMessage) onNotify?.(toastMessage);
      setTimeout(() => setCopiedKind((prev) => (prev === kind ? null : prev)), 2000);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label="Link para o cliente"
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-[240px] h-9 px-3 rounded-xl bg-black/4 dark:bg-white/6 font-mono text-[12px] text-stone-600 dark:text-stone-300"
      />
      <button
        type="button"
        onClick={() => copyText(url, 'url')}
        className={`${BUTTON.secondary} h-9`}
      >
        {copiedKind === 'url' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-300" /> : <Copy className="w-4 h-4" />}{' '}
        {copiedKind === 'url' ? 'Link copiado' : 'Copiar link'}
      </button>
      <button
        type="button"
        onClick={() => copyText(shareText, 'message', 'Mensagem completa copiada')}
        className={`${BUTTON.secondary} h-9`}
      >
        {copiedKind === 'message' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-300" /> : <Copy className="w-4 h-4" />}{' '}
        {copiedKind === 'message' ? 'Mensagem copiada' : 'Copiar mensagem'}
      </button>
      <a
        href={whatsAppLink(shareText, phone)}
        target="_blank"
        rel="noopener noreferrer"
        title={
          phone
            ? `Enviar no WhatsApp da empresa (${rawPhone})`
            : 'Empresa sem telefone cadastrado · abrir WhatsApp para escolher o destinatário'
        }
        className={`${BUTTON.secondary} h-9`}
      >
        <MessageCircle className="w-4 h-4" /> WhatsApp{phone ? ' direto' : ''}
      </a>
      {missing > 0 && (
        <a
          href={whatsAppLink(reminderText, phone)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => copyText(reminderText, 'reminder', `Mensagem de cobrança copiada (${missing} pendente(s))`)}
          title={`Cobrar resposta de ${missing} pergunta(s) que ainda faltam`}
          className={`${BUTTON.secondary} h-9 border-amber-300/80 dark:border-amber-600/40 text-amber-800 dark:text-amber-300`}
        >
          <BellRing className="w-3.5 h-3.5" /> Cobrar de novo ({missing} {missing === 1 ? 'pendente' : 'pendentes'})
        </a>
      )}
      <a
        href={`mailto:${client?.email ?? ''}?subject=${encodeURIComponent(`Informações sobre lançamentos · ${request.clientName}`)}&body=${encodeURIComponent(missing > 0 ? reminderText : shareText)}`}
        className={`${BUTTON.secondary} h-9`}
      >
        <Mail className="w-4 h-4" /> E-mail
      </a>
    </div>
  );
}

export interface ClientRequestLinksProps {
  openRequests: readonly ClientRequest[];
  inactiveRequests: readonly ClientRequest[];
  hasOpenQueries: boolean;
  client?: Pick<ClientCompany, 'email' | 'phone' | 'registration'> | null;
  nowMs: number;
  renewingId: string | null;
  onRenew: (request: ClientRequest) => void;
  onRequestClose: (request: ClientRequest) => void;
  onNotify?: (message: string) => void;
}

export function ClientRequestLinks({
  openRequests,
  inactiveRequests,
  hasOpenQueries,
  client,
  nowMs,
  renewingId,
  onRenew,
  onRequestClose,
  onNotify,
}: ClientRequestLinksProps) {
  return (
    <>
      {openRequests.length > 0 && (
        <section aria-label="Links abertos" className={`${SURFACE} rounded-[22px] p-5 space-y-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">Links abertos</h2>
            {!clientWhatsAppPhone(client) && (
              <p className="text-[12px] text-stone-500 dark:text-stone-400">
                Cadastre o telefone da empresa em Clientes para abrir o WhatsApp direto no contato.
              </p>
            )}
          </div>
          {openRequests.map((r) => {
            const done = answeredCount(r);
            const nearExpiry = r.expiresAtMs - nowMs <= RENEW_SOON_MS;
            return (
              <div key={r.id} className="space-y-2 pb-3 last:pb-0 border-b last:border-b-0 border-black/4 dark:border-white/5">
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
                        onClick={() => onRenew(r)}
                        className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {renewingId === r.id ? 'Renovando…' : 'Renovar +30 dias'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRequestClose(r)}
                      className="text-rose-600 dark:text-rose-300 hover:underline"
                    >
                      Encerrar link
                    </button>
                  </span>
                </div>
                <ShareLink request={r} client={client} onNotify={onNotify} />
              </div>
            );
          })}
        </section>
      )}

      {inactiveRequests.length > 0 && (
        <details
          open={openRequests.length === 0 && hasOpenQueries}
          className={`${SURFACE} group rounded-[22px] overflow-hidden`}
        >
          <summary className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer select-none text-[13px] font-medium text-stone-600 dark:text-stone-300 hover:bg-black/2 dark:hover:bg-white/3">
            <span>
              Links vencidos ou encerrados ({inactiveRequests.length}) · Reative para manter o mesmo endereço já enviado no WhatsApp
            </span>
            <ChevronDown className="w-4 h-4 text-stone-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-black/4 dark:divide-white/5 border-t border-black/4 dark:border-white/5">
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
                            ? 'bg-amber-50 text-amber-800 border border-amber-200/70 dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-300'
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
                    onClick={() => onRenew(r)}
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
    </>
  );
}
