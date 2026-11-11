import React from 'react';
import type { ReconciliationStatus } from '@/types/firestore';

const STATUS_BADGE: Record<ReconciliationStatus, { label: string; dot: string; className: string }> = {
  PENDING: { label: 'Pendente', dot: 'bg-amber-500', className: 'bg-amber-50 text-amber-800 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25' },
  AUTO_CLASSIFIED: { label: 'Auto', dot: 'bg-accent', className: 'bg-accent/[0.07] text-accent-ink border-accent/25 dark:bg-accent/[0.14]' },
  RECONCILED: { label: 'Conciliado', dot: 'bg-emerald-500', className: 'bg-emerald-50 text-emerald-800 border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25' },
};

export function StatusBadge({ status }: { status: ReconciliationStatus }) {
  const { label, dot, className } = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${className}`}>
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
