'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import { useReadTally } from '@/hooks/painel/useReadTally';
import { FREE_DAILY_READS } from '@/lib/data/read-meter';
import { planBackup } from '@/lib/portfolio-backup';
import { reportError } from '@/lib/monitoring';
import { formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, Sheet } from '@/components/ui/primitives';

const NUMBER = new Intl.NumberFormat('pt-BR');

export interface PortfolioBackupOutcome {
  ok: boolean;
  message: string;
  failed: { name: string; reason: string }[];
  done: number;
}

interface PortfolioBackupSheetProps {
  /** Empresas da carteira (sem as em exclusão). */
  clients: readonly ClientCompany[];
  /** No Firestore há cota diária de leituras; no modo local, não. */
  repoMode: 'firestore' | 'local';
  onRun: (clients: readonly ClientCompany[], onProgress: (done: number, total: number, current: ClientCompany) => void) => Promise<PortfolioBackupOutcome>;
  onClose: () => void;
}

const lastBackupText = (c: ClientCompany) => (c.lastBackupAt ? `último em ${formatDateBR(c.lastBackupAt.slice(0, 10))}` : 'nunca teve backup');

/**
 * Backup da carteira: escolhe as empresas, confere se cabem na cota de leituras do dia (no
 * Firestore) e gera um .zip com o backup de cada uma. O que não couber fica para o dia seguinte.
 */
export function PortfolioBackupSheet({ clients, repoMode, onRun, onClose }: PortfolioBackupSheetProps) {
  // Primeiro as que mais precisam: nunca feitas, depois as de backup mais antigo.
  const ordered = useMemo(() => [...clients].sort((a, b) => (a.lastBackupAt ?? '').localeCompare(b.lastBackupAt ?? '') || (a.tradeName || a.name).localeCompare(b.tradeName || b.name, 'pt-BR')), [clients]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(clients.map((c) => c.id)));
  const [estimates, setEstimates] = useState<Map<string, number> | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [outcome, setOutcome] = useState<PortfolioBackupOutcome | null>(null);
  const { reads } = useReadTally();
  const quota = repoMode === 'firestore';

  useEffect(() => {
    if (!quota) return;
    let active = true;
    import('@/lib/services/portfolio-backup-service')
      .then(({ estimatePortfolioReads }) => estimatePortfolioReads(clients))
      .then((m) => active && setEstimates(m))
      .catch((e: unknown) => {
        reportError(e, { area: 'clientes', op: 'estimar backup da carteira', level: 'warning' });
        if (active) setEstimateError('Não foi possível estimar as leituras; o backup ainda pode ser feito.');
      });
    return () => {
      active = false;
    };
  }, [clients, quota]);

  const remaining = quota ? Math.max(0, FREE_DAILY_READS - reads) : null;
  const chosen = ordered.filter((c) => selected.has(c.id));
  const plan = useMemo(
    () => planBackup(chosen.map((c) => ({ clientId: c.id, reads: estimates?.get(c.id) ?? 0 })), estimates ? remaining : null),
    [chosen, estimates, remaining]
  );
  const toRun = chosen.filter((c) => plan.now.includes(c.id));
  const later = chosen.filter((c) => plan.later.includes(c.id));
  const running = progress !== null && !outcome;
  const waitingEstimate = quota && !estimates && !estimateError;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    setOutcome(null);
    setProgress({ done: 0, total: toRun.length, name: '' });
    const result = await onRun(toRun, (done, total, current) => setProgress({ done, total, name: current?.tradeName || current?.name || '' }));
    setOutcome(result);
  };

  return (
    <Sheet
      title="Backup da carteira"
      subtitle="Um arquivo .zip com o backup de cada empresa, o mesmo que a restauração lê, e um manifesto do que foi incluído."
      onClose={running ? () => undefined : onClose}
      size="lg"
      footer={
        outcome ? (
          <button type="button" onClick={onClose} className={`${BUTTON.secondary} w-full h-12 rounded-2xl text-[15px]`}>
            Fechar
          </button>
        ) : (
          <button
            type="button"
            disabled={!toRun.length || running || waitingEstimate}
            onClick={() => void run()}
            className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}
          >
            <Archive className="w-4 h-4" />
            {running
              ? `Empresa ${Math.min(progress!.done + 1, progress!.total)} de ${progress!.total}${progress!.name ? `: ${progress!.name}` : ''}…`
              : waitingEstimate
                ? 'Estimando as leituras…'
                : `Gerar backup de ${toRun.length} empresa(s)`}
          </button>
        )
      }
    >
      <div className="space-y-4 pb-2">
        {outcome ? (
          <div role="status" className="space-y-2 text-[13px]">
            <p className={`flex items-start gap-2 ${outcome.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-800 dark:text-amber-300'}`}>
              {outcome.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{outcome.message}</span>
            </p>
            {outcome.failed.length > 0 && (
              <ul className="space-y-1 pl-6 text-rose-700 dark:text-rose-300">
                {outcome.failed.map((f) => (
                  <li key={f.name}>
                    {f.name}: {f.reason}
                  </li>
                ))}
              </ul>
            )}
            {later.length > 0 && outcome.done > 0 && (
              <p className="pl-6 text-stone-600 dark:text-stone-300">Ficaram para amanhã, quando a cota reinicia: {later.map((c) => c.tradeName || c.name).join(', ')}.</p>
            )}
          </div>
        ) : (
          <>
            <ul aria-label="Empresas do backup" className="rounded-2xl border border-line divide-y divide-black/4 dark:divide-white/5 max-h-[320px] overflow-y-auto">
              {ordered.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-3 px-4 py-2.5 text-[13px] cursor-pointer">
                    <input type="checkbox" checked={selected.has(c.id)} disabled={running} onChange={() => toggle(c.id)} />
                    <span className="min-w-0 flex-1 truncate text-stone-900 dark:text-stone-100">{c.tradeName || c.name}</span>
                    <span className={`shrink-0 text-[12px] ${c.lastBackupAt ? 'text-stone-500 dark:text-stone-400' : 'text-amber-700 dark:text-amber-400'}`}>{lastBackupText(c)}</span>
                    {estimates && <span className="shrink-0 w-28 text-right font-mono tabular-nums text-[12px] text-stone-500">~{NUMBER.format(estimates.get(c.id) ?? 0)} leit.</span>}
                  </label>
                </li>
              ))}
            </ul>

            {quota && estimates && (
              <p className={`text-[12.5px] ${later.length ? 'text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-stone-300'}`}>
                Leituras estimadas: ~{NUMBER.format(plan.reads)} de {NUMBER.format(remaining ?? 0)} que restam hoje (cota gratuita de {NUMBER.format(FREE_DAILY_READS)} por dia).
                {later.length > 0 && ` Não cabem hoje: ${later.map((c) => c.tradeName || c.name).join(', ')}. Ficam de fora deste arquivo; faça amanhã.`}
              </p>
            )}
            {estimateError && <p className="text-[12.5px] text-amber-800 dark:text-amber-300">{estimateError}</p>}

            <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed text-stone-600 dark:text-stone-300">
              <ShieldAlert className="w-4 h-4 mt-px shrink-0 text-stone-500" />
              <span>
                O arquivo tem todos os dados das empresas (extratos, lançamentos, CPF e CNPJ de sócios), sem senha. Guarde-o em local seguro, por exemplo numa pasta
                sincronizada do Google Drive, e não envie por e-mail.
              </span>
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
