'use client';

import { Database } from 'lucide-react';
import { useReadTally } from '@/hooks/painel/useReadTally';
import { FREE_DAILY_READS, quotaLevel } from '@/lib/data/read-meter';

const LEVEL_STYLE = {
  ok: { bar: 'bg-emerald-500', text: 'text-stone-500', note: null },
  warn: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', note: 'Uso alto hoje: evite reimportar extratos ou abrir muitas empresas seguidas.' },
  danger: {
    bar: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
    note: 'Perto do limite: ao estourar, o sistema para de carregar até a cota reiniciar.',
  },
} as const;

const NUMBER = new Intl.NumberFormat('pt-BR');

/**
 * Medidor das leituras do Firestore no dia, frente à cota gratuita. A conta é só deste navegador:
 * a cota real também inclui outros aparelhos e os links de pendências abertos pelos clientes.
 */
export function ReadQuotaMeter() {
  const { reads } = useReadTally();
  const level = quotaLevel(reads);
  const style = LEVEL_STYLE[level];
  const percent = Math.min(100, (reads / FREE_DAILY_READS) * 100);

  return (
    <section
      aria-label="Leituras do banco de dados hoje"
      className="flex items-center gap-4 rounded-2xl px-4 py-2.5 border border-black/6 dark:border-white/8 bg-white/60 dark:bg-stone-900/50 text-[12px]"
    >
      <Database className="w-4 h-4 shrink-0 text-stone-400" strokeWidth={1.75} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className={style.text}>
            <span className="font-medium text-stone-700 dark:text-stone-200">Leituras hoje</span>
            {' · '}
            <span className="font-mono tabular-nums">{NUMBER.format(reads)}</span> de{' '}
            <span className="font-mono tabular-nums">{NUMBER.format(FREE_DAILY_READS)}</span> ({percent.toFixed(percent < 10 ? 1 : 0)}%)
          </p>
          <p className="shrink-0 text-[11px] text-stone-400" title="A cota do Firestore reinicia à meia-noite no horário do Pacífico (EUA).">
            Aproximado, só deste navegador · reinicia por volta das 4h–5h (Brasília)
          </p>
        </div>
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={FREE_DAILY_READS}
          aria-valuenow={reads}
          aria-label="Leituras do dia frente à cota gratuita"
          className="h-1.5 rounded-full bg-black/5 dark:bg-white/8 overflow-hidden"
        >
          <div className={`h-full rounded-full ${style.bar} transition-[width] duration-300`} style={{ width: `${percent}%` }} />
        </div>
        {style.note && <p className={style.text}>{style.note}</p>}
      </div>
    </section>
  );
}
