'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, FileText, Layers, ReceiptText, Split, Tag, X } from 'lucide-react';
import type { BankTransaction, ChartAccount, InvoiceSummary } from '@/types/firestore';
import type { InvoiceMatch } from '@/lib/nfe/match';
import { invoiceKindLabel, paymentStateOf, type InvoicePaymentState } from '@/lib/nfe/import';
import { NFSE_MODEL } from '@/lib/nfe/parser';
import { retentionParts } from '@/lib/nfe/retentions';
import { formatCNPJ, formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON } from '@/components/ui/primitives';
import { ModalPortal } from '@/components/ui/ModalPortal';

const STATE_BADGE: Record<InvoicePaymentState, { label: (i: InvoiceSummary) => string; className: string }> = {
  OPEN: {
    label: () => 'Sem lançamento',
    className: 'bg-stone-100 text-stone-600 border-stone-200/80 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
  },
  PARTIAL: {
    label: () => 'Quitada parcialmente',
    className: 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50',
  },
  SETTLED: {
    label: (i) => (i.direction === 'PURCHASE' ? 'Paga' : 'Recebida'),
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50',
  },
  CANCELLED: {
    label: () => 'Cancelada',
    className: 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50',
  },
};

function formatDocument(doc: string): string {
  if (!doc) return 'Não informado';
  if (doc.length === 14) return formatCNPJ(doc);
  if (doc.length === 11) return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`;
  return doc;
}

export interface InvoiceDetailDrawerProps {
  invoice: InvoiceSummary | null;
  /** Dados do casamento com o lançamento bancário, quando aplicável. */
  match?: InvoiceMatch | null;
  /** Lançamento bancário associado na linha em foco. */
  transaction?: BankTransaction | null;
  accounts: readonly ChartAccount[];
  onClose: () => void;
  /** Aplica diretamente a conta contábil sugerida pela nota ao lançamento. */
  onClassifyWithSuggestion?: (transaction: BankTransaction, accountId: string, invoiceId: string) => void;
  /** Abre o modal de classificação do lançamento diretamente na aba de rateio. */
  onOpenSplit?: (transaction: BankTransaction) => void;
}

/**
 * Pré-visualização Lado a Lado (Split View) da Nota Fiscal (NF-e / NFC-e / NFS-e).
 * Exibe os dados estruturados do DANFE/XML sem sair da tela de conciliação.
 */
export function InvoiceDetailDrawer({
  invoice,
  match,
  transaction,
  accounts,
  onClose,
  onClassifyWithSuggestion,
  onOpenSplit,
}: InvoiceDetailDrawerProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [invoice, onClose]);

  if (!invoice) return null;

  const payState = paymentStateOf(invoice);
  const stateBadge = STATE_BADGE[payState];
  const isNfse = invoice.model === NFSE_MODEL;
  const retentions = invoice.retentions ? retentionParts(invoice.retentions) : [];
  const totalRetainedCents = retentions.reduce((acc, r) => acc + r.cents, 0);
  const suggestedAccount = match?.suggestedAccountId
    ? accounts.find((a) => a.id === match.suggestedAccountId)
    : undefined;

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(invoice.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback silencioso caso clipboard não esteja disponível */
    }
  };

  const drawer = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <aside
        className="relative w-full max-w-xl bg-[#FAF8F5] dark:bg-stone-900 border-l border-line-strong shadow-overlay h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <header className="px-6 py-5 bg-surface border-b border-line flex items-start justify-between gap-4 shrink-0">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide ${
                  invoice.direction === 'PURCHASE'
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
                    : 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                }`}
              >
                {invoice.direction === 'PURCHASE' ? 'Entrada / Compra' : 'Saída / Venda'}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                <ReceiptText className="w-3 h-3 text-emerald-600 dark:text-emerald-300" />
                {invoiceKindLabel(invoice)} nº {invoice.number}
                {invoice.series && invoice.series !== '0' ? ` (Série ${invoice.series})` : ''}
              </span>
              <span className={`inline-flex px-2.5 py-0.5 rounded-full border text-[11px] font-medium ${stateBadge.className}`}>
                {stateBadge.label(invoice)}
              </span>
            </div>
            <h2 id="invoice-drawer-title" className="text-[18px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 truncate">
              {invoice.counterpartyName || (invoice.direction === 'SALE' ? 'Consumidor não identificado' : 'Parceiro comercial')}
            </h2>
            <p className="text-[12px] text-stone-500">
              Emitida em <span className="font-mono tabular-nums font-medium text-stone-700 dark:text-stone-300">{formatDateBR(invoice.issueDate)}</span>
              {invoice.counterpartyDoc && (
                <>
                  {' · '}
                  <span className="font-mono tabular-nums">{formatDocument(invoice.counterpartyDoc)}</span>
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar pré-visualização da nota"
            className="p-2 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/6 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Corpo rolável */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Resumo Financeiro da Nota */}
          <section
            aria-label="Valores da nota fiscal"
            className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line p-4 grid grid-cols-2 sm:grid-cols-3 gap-4"
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 font-medium">
                {isNfse && invoice.altTotal ? 'Valor Líquido (NF)' : 'Valor Total da Nota'}
              </p>
              <p className="mt-1 text-[20px] font-semibold font-mono tabular-nums text-stone-900 dark:text-stone-100">
                {formatCurrency(invoice.total)}
              </p>
            </div>

            {invoice.altTotal !== undefined && invoice.altTotal !== invoice.total && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 font-medium">
                  {isNfse ? 'Valor Bruto do Serviço' : 'Total c/ IBS e CBS'}
                </p>
                <p className="mt-1 text-[17px] font-semibold font-mono tabular-nums text-stone-700 dark:text-stone-300">
                  {formatCurrency(invoice.altTotal)}
                </p>
              </div>
            )}

            {totalRetainedCents > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400 font-medium">
                  Tributos Retidos
                </p>
                <p className="mt-1 text-[17px] font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-300">
                  {formatCurrency(totalRetainedCents / 100)}
                </p>
              </div>
            )}
          </section>

          {/* Correspondência com o Lançamento Bancário */}
          {transaction && (
            <section
              aria-label="Correspondência com o extrato"
              className="rounded-2xl border border-emerald-200/80 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-2 text-[12px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                  Lançamento bancário em conferência
                </span>
                <span className="font-mono tabular-nums font-semibold text-emerald-800 dark:text-emerald-300">
                  {formatCurrency(transaction.amount)} em {formatDateBR(transaction.date)}
                </span>
              </div>
              <p className="text-stone-600 dark:text-stone-300 truncate" title={transaction.memo}>
                Histórico: <span className="font-medium text-stone-800 dark:text-stone-100">{transaction.memo}</span>
              </p>
              {suggestedAccount && (
                <p className="text-stone-600 dark:text-stone-300 pt-1 border-t border-emerald-200/50 dark:border-emerald-800/40">
                  Sugestão contábil:{' '}
                  <span className="font-mono tabular-nums font-semibold text-stone-900 dark:text-stone-100">
                    {suggestedAccount.code}
                  </span>{' '}
                  <span className="font-medium text-stone-800 dark:text-stone-200">{suggestedAccount.name}</span>
                </p>
              )}
            </section>
          )}

          {/* Chave de Acesso */}
          <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 font-medium">
                Chave de Acesso ({invoice.key.length} dígitos)
              </span>
              <button
                type="button"
                onClick={() => void handleCopyKey()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-ink hover:underline"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-300" />
                    <span className="text-emerald-600 dark:text-emerald-300">Chave copiada</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copiar chave</span>
                  </>
                )}
              </button>
            </div>
            <p className="font-mono text-[12px] tracking-wider text-stone-700 dark:text-stone-300 break-all select-all bg-stone-50 dark:bg-stone-900/70 px-3 py-2 rounded-xl border border-black/4 dark:border-white/5">
              {invoice.key}
            </p>
          </section>

          {/* CFOPs e Código de Serviço */}
          {(invoice.cfops.length > 0 || invoice.serviceCode) && (
            <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line p-4 space-y-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-stone-400" />
                Classificação Fiscal (CFOP / Serviço)
              </h3>
              {invoice.serviceCode && (
                <div className="flex items-center justify-between text-[13px] py-1 border-b border-black/4 dark:border-white/5 last:border-0">
                  <span className="text-stone-600 dark:text-stone-300">Código de Tributação Nacional (cTribNac)</span>
                  <span className="font-mono tabular-nums font-medium text-stone-900 dark:text-stone-100">{invoice.serviceCode}</span>
                </div>
              )}
              {invoice.cfops.length > 0 && (
                <div className="divide-y divide-black/4 dark:divide-white/5">
                  {invoice.cfops.map((c) => (
                    <div key={c.cfop} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 text-[13px]">
                      <span className="font-mono font-medium text-stone-800 dark:text-stone-200">CFOP {c.cfop}</span>
                      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{formatCurrency(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Retenções de Tributos (NFS-e) */}
          {retentions.length > 0 && (
            <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line p-4 space-y-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500 flex items-center gap-1.5">
                <Split className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />
                Retenções na Fonte Destacadas
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {retentions.map((r) => (
                  <div
                    key={r.label}
                    className="rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-black/4 dark:border-white/6 px-3 py-2"
                  >
                    <span className="text-[11px] text-stone-500 dark:text-stone-400 block">{r.label}</span>
                    <span className="font-mono tabular-nums text-[13px] font-semibold text-stone-800 dark:text-stone-200">
                      {formatCurrency(r.cents / 100)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Reforma Tributária: IBS e CBS */}
          {Boolean(invoice.ibs || invoice.cbs) && (
            <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line p-4 space-y-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                Destaque Reforma Tributária (LC 214/2025)
              </h3>
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div className="rounded-xl bg-stone-50 dark:bg-stone-900/60 px-3 py-2">
                  <span className="text-[11px] text-stone-500 dark:text-stone-400 block">IBS destacado</span>
                  <span className="font-mono tabular-nums font-semibold text-stone-800 dark:text-stone-200">
                    {formatCurrency(invoice.ibs ?? 0)}
                  </span>
                </div>
                <div className="rounded-xl bg-stone-50 dark:bg-stone-900/60 px-3 py-2">
                  <span className="text-[11px] text-stone-500 dark:text-stone-400 block">CBS destacada</span>
                  <span className="font-mono tabular-nums font-semibold text-stone-800 dark:text-stone-200">
                    {formatCurrency(invoice.cbs ?? 0)}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Duplicatas / Parcelas */}
          {invoice.installments.length > 0 && (
            <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line p-4 space-y-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-500 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-stone-400" />
                Parcelas / Duplicatas ({invoice.installments.length})
              </h3>
              <div className="divide-y divide-black/4 dark:divide-white/5 text-[13px]">
                {invoice.installments.map((inst, i) => {
                  const isMatchedInstallment =
                    match?.installment &&
                    match.installment.dueDate === inst.dueDate &&
                    Math.abs(match.installment.amount - inst.amount) < 0.01;
                  return (
                    <div
                      key={`${inst.number ?? i}-${inst.dueDate}`}
                      className={`flex items-center justify-between py-2 first:pt-0 last:pb-0 ${
                        isMatchedInstallment ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-stone-700 dark:text-stone-300'
                      }`}
                    >
                      <span>
                        Parcela {inst.number || i + 1} · Venc. <span className="font-mono tabular-nums">{formatDateBR(inst.dueDate)}</span>
                        {isMatchedInstallment && (
                          <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                            Casada com este lançamento
                          </span>
                        )}
                      </span>
                      <span className="font-mono tabular-nums">{formatCurrency(inst.amount)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Rodapé com Ações Rápidas */}
        <footer className="px-6 py-4 bg-surface border-t border-line flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {transaction && suggestedAccount && onClassifyWithSuggestion && transaction.status !== 'RECONCILED' && (
              <button
                type="button"
                onClick={() => onClassifyWithSuggestion(transaction, suggestedAccount.id, invoice.id)}
                className={`${BUTTON.primary} h-9 px-4 text-[13px]`}
              >
                Classificar em {suggestedAccount.code}
              </button>
            )}
            {transaction && onOpenSplit && (
              <button
                type="button"
                onClick={() => onOpenSplit(transaction)}
                className={`${BUTTON.secondary} h-9 px-4 text-[13px]`}
              >
                <Split className="w-3.5 h-3.5" />
                <span>Abrir no rateio</span>
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className={`${BUTTON.secondary} h-9 px-4 text-[13px]`}>
            Fechar
          </button>
        </footer>
      </aside>
    </div>
  );

  return <ModalPortal>{drawer}</ModalPortal>;
}
