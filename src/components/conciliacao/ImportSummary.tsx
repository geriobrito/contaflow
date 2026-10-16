import { AlertTriangle, X } from 'lucide-react';
import type { ImportResult } from '@/hooks/useReconciliation';
import { BalanceCheckBadge } from '@/components/conciliacao/StatementPanel';
import { formatDateBR } from '@/lib/utils/formatters';

/** Erro da última operação e resumo da última importação (conferência de saldo, lacunas, datas fora do período). */
export function ImportSummary({ lastImport, error, onDismiss }: { lastImport: ImportResult | null; error: string | null; onDismiss: () => void }) {
  if (!lastImport && !error) return null;
  return (
    <div className="space-y-2 animate-fade-in">
      {error && <p className="px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200/60 text-[13px] text-rose-700">{error}</p>}
      {lastImport && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-white/70 border border-black/[0.06] text-[13px] text-stone-600">
          <span>
            <span className="font-mono tabular-nums font-medium text-stone-900">{lastImport.added}</span> importados ·{' '}
            <span className="font-mono tabular-nums font-medium text-accent-ink">{lastImport.autoClassified}</span> auto-classificados
            {lastImport.duplicates > 0 && (
              <>
                {' · '}
                <span className="font-mono tabular-nums">{lastImport.duplicates}</span> duplicado(s) ignorado(s)
              </>
            )}
            <span className="block mt-1 space-x-3">
              <BalanceCheckBadge check={lastImport.balanceCheck} />
              {lastImport.gaps.map((g) => (
                <span key={g.from} className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
                  <AlertTriangle className="w-3 h-3" />
                  Falta extrato de {formatDateBR(g.from)} a {formatDateBR(g.to)}
                </span>
              ))}
              {lastImport.outOfRange > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                  <AlertTriangle className="w-3 h-3" />
                  {lastImport.outOfRange} lançamento(s) fora do período declarado no arquivo
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
