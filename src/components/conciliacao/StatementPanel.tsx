'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, FileText } from 'lucide-react';
import type { BalanceCheck, ImportBatch } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { findCoverageGaps } from '@/lib/statement';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';

/** Selo da conferência de saldo de um extrato. */
export function BalanceCheckBadge({ check }: { check?: BalanceCheck }) {
  if (!check || check.status === 'NO_LEDGER') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-stone-400">
        <CircleDashed className="w-3 h-3" /> Sem saldo no arquivo
      </span>
    );
  }
  if (check.status === 'BASELINE') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-stone-500" title="Primeiro extrato desta conta: vira referência para os próximos.">
        <CircleDashed className="w-3 h-3" /> Referência inicial
      </span>
    );
  }
  if (check.status === 'AFTER_PERIOD') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-stone-500"
        title="O saldo informado é de uma data depois do fim do extrato; os lançamentos entre as duas datas não estão neste arquivo. Ele serve de referência para o próximo extrato."
      >
        <CircleDashed className="w-3 h-3" /> Saldo após o período
      </span>
    );
  }
  if (check.status === 'OK') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> Saldo confere
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 dark:text-rose-300"
      title={`Esperado ${formatCurrency(check.expected ?? 0)} (saldo anterior + movimentação); banco informou ${formatCurrency(check.reported ?? 0)}.`}
    >
      <AlertTriangle className="w-3 h-3" /> Diferença de {formatCurrency(check.difference ?? 0)}
    </span>
  );
}

/**
 * Extratos importados do cliente: cobertura por conta, saldo final informado pelo
 * banco, conferência contra a movimentação e lacunas de datas entre extratos.
 */
export function useStatementBatches(clientId: string | null, refreshKey: number) {
  const [loaded, setLoaded] = useState<{ clientId: string; batches: ImportBatch[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .listImportBatches(clientId)
      .then((b) => active && (setLoaded({ clientId, batches: b }), setError(null)))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Falha ao carregar extratos.'));
    return () => {
      active = false;
    };
  }, [clientId, refreshKey]);

  const batches = loaded && loaded.clientId === clientId ? loaded.batches : null;
  const withAccount = useMemo(
    () =>
      (batches ?? [])
        .filter((b) => b.accountKey)
        .sort((a, b) => (b.endDate ?? b.importedAt).localeCompare(a.endDate ?? a.importedAt)),
    [batches]
  );
  const gaps = useMemo(() => findCoverageGaps(withAccount), [withAccount]);
  const mismatches = withAccount.filter((b) => b.balanceCheck?.status === 'MISMATCH').length;
  return { withAccount, gaps, mismatches, alerts: gaps.length + mismatches, error };
}

export type StatementSummary = ReturnType<typeof useStatementBatches>;

/** Atalho compacto ("2 extratos · sem alertas") que abre os detalhes. */
export function StatementChip({ summary, open, onToggle }: { summary: StatementSummary; open: boolean; onToggle: () => void }) {
  const { withAccount, gaps, mismatches, alerts, error } = summary;
  if (error) return <p role="alert" className="text-[12px] text-rose-600 dark:text-rose-300">Extratos: {error}</p>;
  if (withAccount.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] text-stone-500 hover:bg-black/4 dark:hover:bg-white/6 transition-colors"
    >
      <FileText className="w-3.5 h-3.5 text-stone-400" />
      <span className="font-medium text-stone-700 dark:text-stone-200">Extratos e saldos</span>
      <span>
        {withAccount.length} extrato(s) ·{' '}
        {alerts > 0 ? (
          <span className="text-rose-600 dark:text-rose-300">
            {mismatches > 0 && `${mismatches} diferença(s) de saldo`}
            {mismatches > 0 && gaps.length > 0 && ' · '}
            {gaps.length > 0 && `${gaps.length} lacuna(s) de datas`}
          </span>
        ) : (
          <span className="text-emerald-700 dark:text-emerald-300">sem alertas</span>
        )}
      </span>
      <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

/** Detalhes dos extratos: lacunas de datas e conferência de saldo de cada extrato. */
export function StatementDetails({ summary }: { summary: StatementSummary }) {
  const { withAccount, gaps } = summary;
  if (withAccount.length === 0) return null;
  return (
    <section aria-label="Extratos e saldos" className={`${SURFACE} rounded-[22px] overflow-hidden animate-fade-in`}>
        <div>
          {gaps.length > 0 && (
            <ul className="px-5 py-3 space-y-1 bg-rose-50/60 dark:bg-rose-950/20 border-b border-rose-200/40 dark:border-rose-500/25">
              {gaps.map((g) => (
                <li key={`${g.accountKey}-${g.from}`} className="text-[12px] text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Conta <span className="font-mono">{g.accountKey}</span>: sem extrato de{' '}
                  <span className="font-mono tabular-nums">{formatDateBR(g.from)}</span> a{' '}
                  <span className="font-mono tabular-nums">{formatDateBR(g.to)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-b border-line">
                  <th className="font-semibold pl-5 pr-3 py-2">Conta</th>
                  <th className="font-semibold px-3 py-2">Período</th>
                  <th className="font-semibold px-3 py-2 text-right">Saldo informado</th>
                  <th className="font-semibold px-3 py-2 text-right">Esperado</th>
                  <th className="font-semibold pl-3 pr-5 py-2">Conferência</th>
                </tr>
              </thead>
              <tbody>
                {withAccount.map((b) => (
                  <tr key={b.id} className="border-b border-black/4 last:border-0 text-[13px]">
                    <td className="pl-5 pr-3 py-2.5">
                      <span className="font-mono text-[12px] text-stone-700 dark:text-stone-300">{b.accountKey}</span>
                      {b.bankName && <span className="block text-[11px] text-stone-400">{b.bankName}</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-[12px] text-stone-500 whitespace-nowrap">
                      {b.startDate ? formatDateBR(b.startDate) : '?'} – {b.endDate ? formatDateBR(b.endDate) : '?'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      {b.ledgerBalance !== undefined ? formatCurrency(b.ledgerBalance) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-stone-500 whitespace-nowrap">
                      {b.balanceCheck?.expected !== undefined ? formatCurrency(b.balanceCheck.expected) : '—'}
                    </td>
                    <td className="pl-3 pr-5 py-2.5">
                      <BalanceCheckBadge check={b.balanceCheck} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </section>
  );
}
