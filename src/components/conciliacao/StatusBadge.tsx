import React from 'react';
import type { ReconciliationStatus } from '@/types/firestore';

const STATUS_BADGE: Record<ReconciliationStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'bg-amber-50 text-amber-700 border-amber-200/60' },
  AUTO_CLASSIFIED: { label: 'Auto', className: 'bg-accent/[0.07] text-accent-ink border-accent/25' },
  RECONCILED: { label: 'Conciliado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
};

export function StatusBadge({ status }: { status: ReconciliationStatus }) {
  const { label, className } = STATUS_BADGE[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}
