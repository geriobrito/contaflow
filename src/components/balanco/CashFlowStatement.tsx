import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cashFlowRows, type CashFlowRow, type CashFlowStatement as Statement } from '@/lib/cash-flow';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SURFACE } from '@/components/ui/primitives';
import { AccountingAmount } from '@/components/ui/Amount';

const ROW_STYLE: Record<CashFlowRow['kind'], { row: string; label: string }> = {
  section: { row: 'border-t border-line', label: 'px-5 pt-4 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-stone-600 dark:text-stone-300' },
  line: { row: '', label: 'pl-8 pr-5 py-1.5 text-stone-700 dark:text-stone-300' },
  detail: { row: 'text-[12px]', label: 'pl-12 pr-5 py-1 text-stone-500' },
  subtotal: { row: 'border-t border-black/4 dark:border-white/5 font-semibold', label: 'px-5 py-2.5' },
  total: { row: 'border-t border-line-strong bg-stone-50/70 dark:bg-stone-800/30 font-semibold', label: 'px-5 py-3' },
  balance: { row: 'border-t border-black/4 dark:border-white/5 bg-stone-50/70 dark:bg-stone-800/30 font-semibold', label: 'px-5 py-2.5' },
};

interface CashFlowStatementProps {
  statement: Statement;
  detail: boolean;
  onDetailChange: (detail: boolean) => void;
}

/** Quadro da Demonstração dos Fluxos de Caixa (método direto). */
export function CashFlowStatement({ statement, detail, onDetailChange }: CashFlowStatementProps) {
  const rows = cashFlowRows(statement, { detail });
  const cashNames = statement.cashAccounts.map((a) => `${a.code} ${a.name}`).join(', ');

  return (
    <section className={`${SURFACE} rounded-[22px] overflow-hidden`} aria-label="Demonstração dos fluxos de caixa">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 border-b border-black/4 dark:border-white/6">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight">Fluxos de caixa — método direto</h2>
          <p className="text-[12px] text-stone-500">
            De {formatDateBR(statement.start)} a {formatDateBR(statement.end)}. Entradas positivas; saídas entre parênteses.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-stone-500 print:hidden">
          <input type="checkbox" checked={detail} onChange={(e) => onDetailChange(e.target.checked)} /> Detalhar por conta
        </label>
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map((r, i) => {
            const style = ROW_STYLE[r.kind];
            return (
              <tr key={`${i}-${r.label}`} className={style.row}>
                <td className={style.label} colSpan={r.value === undefined ? 2 : 1}>
                  {r.kind === 'detail' && r.code && <span className="mr-2 font-mono tabular-nums text-[11px] text-stone-400">{r.code}</span>}
                  {r.label}
                </td>
                {r.value !== undefined && (
                  <td className={`px-5 text-right font-mono tabular-nums whitespace-nowrap ${r.kind === 'detail' ? 'py-1 text-stone-500' : 'py-1.5'}`}>
                    <AccountingAmount value={r.value} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-5 py-3 border-t border-black/4 dark:border-white/6 space-y-1.5 text-[12px] text-stone-500 print:hidden">
        <p className={`flex items-start gap-2 ${statement.difference === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {statement.difference === 0 ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          {statement.difference === 0
            ? 'O caixa no fim do período confere com o saldo das contas de caixa no balanço.'
            : `O caixa no fim do período difere em ${formatCurrency(statement.difference)} do saldo das contas de caixa no balanço (${formatCurrency(statement.ledgerClosingCash)}).`}
        </p>
        {statement.unclassified !== 0 && (
          <p className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {formatCurrency(Math.abs(statement.unclassified))} de movimento bancário ainda sem classificação ficam fora das atividades. Concilie-os para a DFC definitiva.
          </p>
        )}
        <p>
          Caixa e equivalentes: {cashNames || 'nenhuma conta'}. Depreciação, provisões, encerramento e transferências entre contas próprias não
          movimentam caixa e ficam de fora. A atividade de cada conta segue o modelo do CFC e pode ser trocada em{' '}
          <Link href="/plano-de-contas" className="underline underline-offset-2 hover:text-stone-800 dark:hover:text-stone-200">Plano de contas</Link>.
        </p>
      </div>
    </section>
  );
}
