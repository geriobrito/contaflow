'use client';

import { Check } from 'lucide-react';
import type { ClientIssue, IssueSeverity } from '@/lib/client-health';

const CHIP: Record<IssueSeverity, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200/70 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50 dark:hover:bg-rose-950/50',
  medium: 'bg-amber-50 text-amber-800 border-amber-200/70 hover:bg-amber-100 dark:bg-amber-950/25 dark:text-amber-300 dark:border-amber-900/50 dark:hover:bg-amber-950/45',
  low: 'bg-black/3 text-stone-600 border-black/6 hover:bg-black/6 dark:bg-white/5 dark:text-stone-300 dark:border-white/8 dark:hover:bg-white/8',
};

const CHIP_BASE = 'inline-flex items-center h-6 px-2.5 rounded-full border text-[11.5px] font-medium whitespace-nowrap transition-colors active:scale-[0.97]';

interface ClientIssueChipsProps {
  issues: readonly ClientIssue[];
  /** Abre o cadastro na aba que resolve a pendência. */
  onIssue: (issue: ClientIssue) => void;
  /** Quantas etiquetas mostrar antes de resumir o resto em "+N". */
  max?: number;
}

/** Pendências do cadastro de uma empresa, como etiquetas clicáveis; sem nenhuma, "Cadastro completo". */
export function ClientIssueChips({ issues, onIssue, max = 3 }: ClientIssueChipsProps) {
  if (issues.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
        <Check className="w-3.5 h-3.5" strokeWidth={2.25} /> Cadastro completo
      </span>
    );
  }
  const shown = issues.slice(0, max);
  const rest = issues.slice(max);
  return (
    <ul aria-label="Pendências do cadastro" className="flex flex-wrap gap-1.5">
      {shown.map((issue) => (
        <li key={issue.id}>
          <button type="button" title={issue.detail} onClick={() => onIssue(issue)} className={`${CHIP_BASE} ${CHIP[issue.severity]}`}>
            {issue.label}
          </button>
        </li>
      ))}
      {rest.length > 0 && (
        <li>
          <button
            type="button"
            title={rest.map((i) => i.label).join(' · ')}
            aria-label={`Mais ${rest.length} pendência(s): ${rest.map((i) => i.label).join(', ')}`}
            onClick={() => onIssue(rest[0])}
            className={`${CHIP_BASE} ${CHIP.low} font-mono tabular-nums`}
          >
            +{rest.length}
          </button>
        </li>
      )}
    </ul>
  );
}
