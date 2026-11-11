'use client';

import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import type { ChartAccount, OpeningMode } from '@/types/firestore';
import type { OpeningSheet } from '@/lib/opening-view';
import { continuityDivergence, describePlug, type OpeningPlug } from '@/lib/opening';
import { AccountingAmount } from '@/components/ui/Amount';
import { BUTTON, INPUT_SMALL } from '@/components/ui/primitives';

interface OpeningFooterProps {
  totals: OpeningSheet['totals'];
  mode: OpeningMode;
  plug: OpeningPlug | null;
  frozen: boolean;
  saving: boolean;
  dirty: boolean;
  /** Editado nesta visita e não salvo. */
  unsaved: boolean;
  /** Implantação com balanço anterior que não fecha: não salva. */
  divergent: boolean;
  savedAt: string | null;
  error: string | null;
  onSave: () => void;
  /** Implantação com balanço anterior que não fecha: conta de PL para a diferença. */
  equityAccounts: readonly ChartAccount[];
  plugAccount: ChartAccount | undefined;
  onPlugAccount: (id: string) => void;
  onPlugInto: () => void;
}

const Term = ({ label, value }: { label: string; value: number }) => (
  <span className="flex items-baseline gap-1.5 whitespace-nowrap">
    <span className="text-[12px] text-stone-500">{label}</span>
    <AccountingAmount value={value} className="text-[14px] font-semibold text-stone-900 dark:text-stone-50" />
  </span>
);

/** Barra fixa no rodapé: a equação da abertura, se fecha e o botão de salvar, sempre à vista. */
export function OpeningFooter(props: OpeningFooterProps) {
  const { totals, mode, frozen, saving, dirty, unsaved, divergent, savedAt, error, onSave } = props;
  const balanced = Math.abs(totals.difference) < 0.005;
  return (
    <div className="sticky bottom-4 z-20 space-y-2 print:hidden">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200/60 dark:border-rose-800/50 text-[13px] text-rose-700 dark:text-rose-300 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[20px] px-5 py-3 bg-white/90 dark:bg-stone-900/90 backdrop-blur-xl border border-line-strong shadow-raised">
        <div role="group" aria-label="Equação da abertura" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Term label="Ativo" value={totals.assets} />
          <span aria-hidden className={`text-[15px] font-semibold ${balanced ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
            {balanced ? '=' : '≠'}
          </span>
          <span className="sr-only">{balanced ? 'igual a' : 'diferente de'}</span>
          <Term label="Passivo" value={totals.liabilities} />
          <span className="text-[13px] text-stone-400">+</span>
          <Term label="PL" value={totals.equity} />
        </div>

        <div className="flex-1 min-w-[260px] space-y-1.5">
          <Status {...props} balanced={balanced} />
          {mode === 'CONTINUITY' && !balanced && !frozen && <PlugPicker {...props} />}
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {savedAt && !dirty && !error ? (
            <span role="status" className="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Abertura salva às {savedAt}
            </span>
          ) : (
            unsaved && !frozen && <span className="text-[12px] text-stone-500">Alterações não salvas</span>
          )}
          <button
            type="button"
            disabled={frozen || saving || !dirty || divergent}
            onClick={onSave}
            title={divergent ? 'O balanço anterior precisa fechar (ativo = passivo + PL) para salvar.' : undefined}
            className={BUTTON.accent}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Status({ mode, plug, totals, balanced }: OpeningFooterProps & { balanced: boolean }) {
  if (mode === 'OPENING_BALANCE' && plug) {
    return (
      <p className="flex items-start gap-2 text-[12px] text-stone-600 dark:text-stone-300">
        <Scale className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <span>
          <b className="font-medium">{describePlug(plug)}</b>. A abertura fecha.
        </span>
      </p>
    );
  }
  if (totals.assets === 0 && totals.liabilities === 0 && totals.equity === 0) {
    return <p className="text-[12px] text-stone-500">Informe os saldos: a conferência aparece aqui.</p>;
  }
  if (balanced) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-4 h-4 shrink-0" /> A abertura fecha: ativo = passivo + patrimônio líquido.
      </p>
    );
  }
  return (
    <p role="alert" className="flex items-start gap-2 text-[12px] text-rose-700 dark:text-rose-400">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        {continuityDivergence(totals.difference)} {totals.difference > 0 ? '(Ativo maior que Passivo + PL.)' : '(Passivo + PL maior que o Ativo.)'}
      </span>
    </p>
  );
}

const SELECT = `${INPUT_SMALL} max-w-[260px]`;

const SMALL_BUTTON =
  'inline-flex items-center h-8 px-3 rounded-full text-[12px] font-medium bg-white/80 dark:bg-stone-800 text-stone-800 dark:text-stone-100 border border-line-strong hover:bg-white transition-all duration-150 active:scale-[0.98]';

function PlugPicker({ equityAccounts, plugAccount, onPlugAccount, onPlugInto }: OpeningFooterProps) {
  if (!equityAccounts.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-6">
      <span className="text-[12px] text-stone-500">Lançar a diferença em</span>
      <select aria-label="Conta de patrimônio líquido para a diferença" value={plugAccount?.id ?? ''} onChange={(e) => onPlugAccount(e.target.value)} className={SELECT}>
        {equityAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onPlugInto} className={SMALL_BUTTON}>
        Lançar
      </button>
    </div>
  );
}
