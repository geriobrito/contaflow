import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Unlock } from 'lucide-react';
import type { YearClosingState } from '@/lib/year-closing';
import { describeResult } from '@/lib/year-closing';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, SURFACE } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface YearClosingPanelProps {
  state: YearClosingState;
  busy: 'close' | 'reopen' | null;
  onClose: () => Promise<void>;
  onReopen: () => Promise<void>;
}

/** Encerramento do exercício (ARE): situação, impedimentos e as ações de encerrar e reabrir. */
export function YearClosingPanel({ state, busy, onClose, onReopen }: YearClosingPanelProps) {
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const { year } = state;
  const numbers = state.entries.map((e) => `#${e.entryNumber}`).join(', ');

  return (
    <section className={`${SURFACE} rounded-[22px] p-5 space-y-3 print:hidden`} aria-label="Encerramento do exercício">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight">Encerramento do exercício de {year}</h2>
          <p className="text-[12px] text-stone-500">
            Zera as contas de resultado em 31/12 contra a ARE e leva o {describeResult(state.netResult)} para o patrimônio líquido (2.3.3.01 Lucros
            Acumulados ou 2.3.3.02 Prejuízos Acumulados).
            {state.openingTransfer !== 0 && (
              <>
                {' '}
                Zera também o saldo {state.openingTransfer > 0 ? 'credor' : 'devedor'} de {formatCurrency(Math.abs(state.openingTransfer))} da 2.3.3.04 Balanço de
                Abertura contra {state.openingTransfer > 0 ? '2.3.3.01 Lucros Acumulados' : '2.3.3.02 Prejuízos Acumulados'}.
              </>
            )}
            {state.distributionTransfer !== 0 && (
              <>
                {' '}
                Baixa os {formatCurrency(Math.abs(state.distributionTransfer))} da 2.3.3.03 (-) Lucros Distribuídos contra 2.3.3.01 Lucros Acumulados.
              </>
            )}
            {state.deficitTransfer !== 0 && (
              <>
                {' '}
                O saldo devedor de {formatCurrency(state.deficitTransfer)} que sobra em Lucros Acumulados vai para 2.3.3.02 Prejuízos Acumulados.
              </>
            )}
          </p>
        </div>
        {state.closed ? (
          <button type="button" disabled={busy !== null} onClick={() => setConfirm('reopen')} className={BUTTON.secondary}>
            <Unlock className="w-4 h-4" />
            {busy === 'reopen' ? 'Reabrindo…' : 'Reabrir exercício'}
          </button>
        ) : (
          <button type="button" disabled={!state.canClose || busy !== null} onClick={() => setConfirm('close')} className={BUTTON.primary}>
            <Lock className="w-4 h-4" />
            {busy === 'close' ? 'Encerrando…' : 'Encerrar exercício'}
          </button>
        )}
      </div>

      {state.closed && !state.stale && (
        <p className="flex items-start gap-2 text-[13px] text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          Exercício encerrado nos lançamentos {numbers} do Diário, em 31/12/{year}.
        </p>
      )}
      {state.stale && (
        <p className="flex items-start gap-2 text-[13px] text-rose-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Encerramento desatualizado: {state.residual !== 0 ? `sobram ${formatCurrency(Math.abs(state.residual))} nas contas de resultado de ${year}` : 'a 2.3.3.04 Balanço de Abertura ainda tem saldo'} (lançamentos alterados depois do
          encerramento). Reabra o exercício e encerre de novo.
        </p>
      )}
      {!state.closed &&
        state.blockers.map((b) => (
          <p key={b} className="flex items-start gap-2 text-[13px] text-amber-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {b}
          </p>
        ))}
      {state.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 text-[13px] text-stone-500">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {w}
        </p>
      ))}

      {confirm === 'close' && (
        <ConfirmDialog
          title={`Encerrar o exercício de ${year}?`}
          description={
            <>
              Entram no Diário, em 31/12/{year}, os lançamentos que zeram as contas de resultado contra a ARE e levam o {describeResult(state.netResult)} para o
              patrimônio líquido. A DRE de {year} não muda. Cada lançamento fica registrado na auditoria.
            </>
          }
          confirmLabel="Encerrar exercício"
          onConfirm={async () => {
            await onClose();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reopen' && (
        <ConfirmDialog
          title={`Reabrir o exercício de ${year}?`}
          description={
            <>
              Os lançamentos de encerramento ({numbers}) saem do Diário e o resultado de {year} volta a aparecer como resultado do exercício no balanço. Os
              números não são reaproveitados, e a exclusão fica registrada na auditoria.
            </>
          }
          confirmLabel="Reabrir exercício"
          destructive
          onConfirm={async () => {
            await onReopen();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
