'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowRight } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { BACKUP_STATE_LABEL, DEFAULT_BACKUP_REMINDER_DAYS, backupStatus, type BackupState } from '@/lib/portfolio-backup';
import { reportError } from '@/lib/monitoring';

interface BackupReminderProps {
  clients: readonly ClientCompany[];
  today: string;
  /** Última mudança nos dados de cada empresa (quando o Painel já a conhece). */
  lastActivity?: ReadonlyMap<string, string>;
}

const ORDER: Record<BackupState, number> = { never: 0, stale: 1, changed: 2, ok: 3 };

/**
 * Lembrete de backup no Painel: empresas sem backup, com backup mais antigo que o prazo do
 * escritório (padrão 30 dias) ou que mudaram depois do último backup. Some quando todas estão em dia.
 */
export function BackupReminder({ clients, today, lastActivity }: BackupReminderProps) {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    getRepository()
      .getOrgSettings()
      .then((s) => active && setDays(s?.backupReminderDays ?? DEFAULT_BACKUP_REMINDER_DAYS))
      .catch((e: unknown) => {
        reportError(e, { area: 'painel', op: 'prazo do lembrete de backup', level: 'warning' });
        if (active) setDays(DEFAULT_BACKUP_REMINDER_DAYS);
      });
    return () => {
      active = false;
    };
  }, []);

  const pending = useMemo(() => {
    if (days === null) return [];
    return clients
      .filter((c) => !c.deletingAt)
      .map((c) => ({ client: c, status: backupStatus(c, { today, reminderDays: days, lastActivityAt: lastActivity?.get(c.id) }) }))
      .filter((x) => x.status.state !== 'ok')
      .sort((a, b) => ORDER[a.status.state] - ORDER[b.status.state] || (a.client.tradeName || a.client.name).localeCompare(b.client.tradeName || b.client.name, 'pt-BR'));
  }, [clients, today, days, lastActivity]);

  if (!pending.length) return null;
  const count = (state: BackupState) => pending.filter((p) => p.status.state === state).length;
  const one = (state: BackupState, singular: string, plural: string) => {
    const n = count(state);
    return n ? `${n} ${n === 1 ? singular : plural}` : null;
  };
  const parts = [
    one('never', 'nunca teve backup', 'nunca tiveram backup'),
    one('stale', `com backup de mais de ${days} dias`, `com backup de mais de ${days} dias`),
    one('changed', 'mudou depois do último backup', 'mudaram depois do último backup'),
  ].filter(Boolean);

  return (
    <section aria-label="Lembrete de backup" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
      <Archive className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 basis-[280px] space-y-0.5">
        <p className="font-medium">Backup: {parts.join(' · ')}.</p>
        <p className="text-[12px] text-amber-800/90 dark:text-amber-300/90">
          {pending
            .slice(0, 6)
            .map((p) => {
              const name = p.client.tradeName || p.client.name;
              // Quem nunca teve backup já está dito no título; as demais levam o motivo e os dias.
              return p.status.state === 'never' ? name : `${name} (${BACKUP_STATE_LABEL[p.status.state]}, ${p.status.days} dia(s))`;
            })
            .join(' · ')}
          {pending.length > 6 && ` e mais ${pending.length - 6}`}
        </p>
      </div>
      <Link href="/clientes?backup=1" className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline whitespace-nowrap">
        Fazer o backup da carteira <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </section>
  );
}
