import { AlertTriangle, X } from 'lucide-react';
import type { ImportResult } from '@/hooks/useReconciliation';
import { BalanceCheckBadge } from '@/components/conciliacao/StatementPanel';
import { formatDateBR } from '@/lib/utils/formatters';

/**
 * A importação pede atenção: saldo que não confere, lacuna de datas entre extratos ou
 * lançamentos fora do período do arquivo. Sem isso, o resultado vai só para o aviso do rodapé.
 */
export const importNeedsAttention = (r: ImportResult): boolean =>
  r.balanceCheck?.status === 'MISMATCH' || r.gaps.length > 0 || r.outOfRange > 0;

/** Erro da última operação e, quando pede atenção, o resumo da última importação. */
export function ImportSummary({ lastImport, error, onDismiss }: { lastImport: ImportResult | null; error: string | null; onDismiss: () => void }) {
  const attention = lastImport && importNeedsAttention(lastImport) ? lastImport : null;
  if (!attention && !error) return null;
  return (
    <div className="space-y-2 animate-fade-in">
      {error && <p className="px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200/60 dark:border-rose-500/25 text-[13px] text-rose-700 dark:text-rose-300">{error}</p>}
      {attention && (
        <div role="status" className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-[13px] text-stone-600 dark:text-stone-300">
          <span>
            <span className="font-medium text-stone-800 dark:text-stone-100">Confira a última importação</span>
            {' · '}
            <span className="font-mono tabular-nums">{attention.added}</span> importado(s)
            <span className="block mt-1 space-x-3">
              <BalanceCheckBadge check={attention.balanceCheck} />
              {attention.gaps.map((g) => (
                <span key={g.from} className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="w-3 h-3" />
                  Falta extrato de {formatDateBR(g.from)} a {formatDateBR(g.to)}
                </span>
              ))}
              {attention.outOfRange > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-3 h-3" />
                  {attention.outOfRange} lançamento(s) fora do período declarado no arquivo
                </span>
              )}
            </span>
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dispensar"
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 active:scale-[0.94] transition-all duration-150"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
