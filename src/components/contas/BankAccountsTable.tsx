'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, Link2, Pencil, Plus, Wallet } from 'lucide-react';
import type { BankAccount, ImportBatch } from '@/types/firestore';
import type { ContasData } from '@/hooks/contas/useContasData';
import { bankBalanceAt, lastReportedStatement } from '@/lib/bank-accounts';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

interface BankAccountsTableProps {
  /** Dados da empresa, ou null enquanto carregam. */
  current: ContasData | null;
  /** Contas vistas em extratos antigos que ainda não têm cadastro. */
  unregistered: readonly ImportBatch[];
  /** Movimentação já consolidada de cada conta (competências fechadas). */
  carriedByBank: ReadonlyMap<string, number>;
  /** Lançamentos de extratos sem identificação de conta. */
  unlinkedTx: number;
  busy: boolean;
  onCreate?: () => void;
  onEdit: (bank: BankAccount) => void;
  onRegister: (batch: ImportBatch) => Promise<void>;
}

/** Contas bancárias e cartões da empresa: vínculo contábil, saldo inicial, saldo contábil e conferência com o último saldo do banco. */
export function BankAccountsTable({
  current,
  unregistered,
  carriedByBank,
  unlinkedTx,
  busy,
  onCreate,
  onEdit,
  onRegister,
}: BankAccountsTableProps) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-black/[0.04] dark:border-white/[0.06]">
        <Wallet className="w-4 h-4 text-stone-400" />
        <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Contas bancárias e cartões</h2>
        {onCreate && current && (
          <button type="button" onClick={onCreate} className={`${BUTTON.secondary} h-8`}>
            <Plus className="w-3.5 h-3.5" />
            Nova conta ou cartão
          </button>
        )}
      </div>
      {!current ? (
        <TableSkeleton rows={3} label="Carregando contas bancárias…" />
      ) : current.banks.length === 0 && unregistered.length === 0 ? (
        <EmptyState
          title="Nenhuma conta ou cartão cadastrado"
          description="As contas OFX são registradas automaticamente ao importar um extrato, ou você pode cadastrar uma conta/cartão manualmente para importar CSVs."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04]">
                <th className="font-medium pl-5 pr-3 py-2.5">Conta</th>
                <th className="font-medium px-3 py-2.5">Conta contábil</th>
                <th className="font-medium px-3 py-2.5 text-right">Saldo inicial</th>
                <th className="font-medium px-3 py-2.5 text-right">Saldo contábil</th>
                <th className="font-medium px-3 py-2.5 text-right">Último saldo do banco</th>
                <th className="pl-3 pr-5 py-2.5 w-20"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {current.banks.map((b) => {
                const last = lastReportedStatement(current.batches, b.accountKey);
                const balanceAt = (date: string) => bankBalanceAt(b, current.ledger.transactions, date, carriedByBank.get(b.accountKey));
                const bookAtLast = last?.ledgerDate ? balanceAt(last.ledgerDate) : null;
                const matches = last && bookAtLast !== null && Math.abs(bookAtLast - (last.ledgerBalance ?? 0)) < 0.005;
                // Saldo de data posterior ao fim do extrato: há lançamentos entre as datas fora do arquivo.
                const comparable = !(last?.endDate && last.ledgerDate && last.ledgerDate > last.endDate);
                return (
                  <tr key={b.id} className="border-b border-black/[0.04] last:border-0 text-[13px]">
                    <td className="pl-5 pr-3 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{b.nickname}</p>
                        {b.kind === 'CARD' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40">
                            <CreditCard className="w-2.5 h-2.5" />
                            Cartão
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-stone-400">
                        {b.accountKey}
                        {b.csvPreset ? ' · formato CSV memorizado' : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {b.ledgerAccountId ? (
                        <span className="inline-flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                          <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="font-mono text-[12px] text-stone-400">{b.ledgerAccountCode}</span> {b.ledgerAccountName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Sem vínculo contábil</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {b.openingBalance !== undefined ? (
                        <>
                          {formatCurrency(b.openingBalance)}
                          <span className="block text-[11px] text-stone-400">{formatDateBR(b.openingDate)}</span>
                        </>
                      ) : (
                        <span className="text-amber-700 font-sans text-[12px]">não informado</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatCurrency(balanceAt(today))}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {last ? (
                        <>
                          {formatCurrency(last.ledgerBalance ?? 0)}
                          {comparable ? (
                            <span className={`flex items-center justify-end gap-1 text-[11px] font-sans ${matches ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {matches ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                              {formatDateBR(last.ledgerDate)} ·{' '}
                              {matches ? 'confere' : `contábil ${formatCurrency(bookAtLast ?? 0)}`}
                            </span>
                          ) : (
                            <span
                              className="block text-[11px] font-sans text-stone-500"
                              title="O saldo é de uma data depois do fim do extrato; os lançamentos entre as duas datas não estão no arquivo."
                            >
                              {formatDateBR(last.ledgerDate)} · após o período do extrato
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="pl-3 pr-5 py-3 text-right">
                      <button type="button" onClick={() => onEdit(b)} aria-label={`Editar ${b.nickname}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/[0.05] active:scale-[0.94] transition-all">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {unregistered.map((batch) => (
                <tr key={batch.accountKey} className="border-b border-black/[0.04] last:border-0 text-[13px] bg-amber-50/40 dark:bg-amber-950/10">
                  <td className="pl-5 pr-3 py-3">
                    <p className="font-mono text-[12px] text-stone-700">{batch.accountKey}</p>
                    <p className="text-[11px] text-stone-400">Encontrada em extratos importados antes do cadastro</p>
                  </td>
                  <td colSpan={4} />
                  <td className="pl-3 pr-5 py-3 text-right">
                    <button type="button" disabled={busy} onClick={() => void onRegister(batch)} className={`${BUTTON.secondary} h-8`}>
                      Cadastrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current && unlinkedTx > 0 && (
        <p className="px-5 py-3 border-t border-black/[0.04] text-[12px] text-amber-700">
          {unlinkedTx} lançamento(s) vieram de extratos sem identificação de conta e aparecem no balanço como “Bancos sem vínculo contábil”.
        </p>
      )}
    </section>
  );
}
