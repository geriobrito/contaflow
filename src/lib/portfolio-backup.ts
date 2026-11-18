import type { ClientCompany } from '@/types/firestore';
import { backupFileName } from '@/lib/export/client-backup';

/**
 * Backup da carteira: um .zip com o JSON de backup de cada empresa (o mesmo da tela de Clientes,
 * que a restauração lê) e um manifesto; e o lembrete do Painel, pela data do último backup de
 * cada empresa e pela última mudança nos dados dela.
 */

/** Dias sem backup a partir dos quais o Painel lembra, quando o escritório não define outro. */
export const DEFAULT_BACKUP_REMINDER_DAYS = 30;

export type BackupState = 'never' | 'stale' | 'changed' | 'ok';

export interface BackupStatus {
  state: BackupState;
  /** Dias desde o último backup (null quando nunca houve). */
  days: number | null;
}

const dayMs = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * Situação do backup da empresa: nunca feito; antigo (passou do prazo); feito, mas a empresa mudou
 * depois dele (extrato importado, competência fechada, cadastro alterado); ou em dia.
 */
export function backupStatus(
  client: Pick<ClientCompany, 'lastBackupAt'>,
  { today, reminderDays = DEFAULT_BACKUP_REMINDER_DAYS, lastActivityAt }: { today: string; reminderDays?: number; lastActivityAt?: string }
): BackupStatus {
  const last = client.lastBackupAt;
  if (!last) return { state: 'never', days: null };
  const days = Math.max(0, Math.round((dayOf(today) - dayOf(last)) / dayMs));
  if (days >= reminderDays) return { state: 'stale', days };
  if (lastActivityAt && lastActivityAt > last) return { state: 'changed', days };
  return { state: 'ok', days };
}

export const BACKUP_STATE_LABEL: Record<BackupState, string> = {
  never: 'nunca teve backup',
  stale: 'backup antigo',
  changed: 'mudou depois do último backup',
  ok: 'backup em dia',
};

/** Leituras fixas por empresa no backup: plano de contas, regras, cadastros, fechamentos e afins. */
const BASE_READS = 400;

/**
 * Estimativa das leituras do Firestore para o backup de uma empresa: os lançamentos e, na mesma
 * ordem de grandeza, a trilha de auditoria (cada classificação gera um registro), além das
 * leituras fixas. É estimativa: notas e lançamentos manuais variam por empresa.
 */
export const estimateBackupReads = (transactions: number): number => BASE_READS + 2 * Math.max(0, transactions);

export interface BackupPlan {
  /** Empresas que cabem na cota de hoje, na ordem pedida. */
  now: string[];
  /** As que ficam para quando a cota reiniciar. */
  later: string[];
  /** Leituras estimadas das que cabem hoje. */
  reads: number;
}

/** Divide as empresas pela cota restante do dia (sem cota, todas cabem). */
export function planBackup(items: readonly { clientId: string; reads: number }[], remaining: number | null): BackupPlan {
  const plan: BackupPlan = { now: [], later: [], reads: 0 };
  for (const item of items) {
    if (remaining === null || plan.reads + item.reads <= remaining) {
      plan.now.push(item.clientId);
      plan.reads += item.reads;
    } else plan.later.push(item.clientId);
  }
  return plan;
}

export interface PortfolioManifestFile {
  file: string;
  clientId: string;
  name: string;
  cnpj: string;
  transactions: number;
  journalEntries: number;
  invoices: number;
  auditTruncated: boolean;
}

export interface PortfolioManifest {
  format: 'contaflow-portfolio-backup';
  version: 1;
  exportedAt: string;
  files: PortfolioManifestFile[];
  /** Empresas que falharam, com o motivo: não estão no arquivo. */
  failed: { clientId: string; name: string; reason: string }[];
}

export const MANIFEST_FILE = 'manifesto.json';

/** `Backup_Carteira_2026-11-17.zip`. */
export const portfolioBackupFileName = (exportedAt: string): string => `Backup_Carteira_${exportedAt.slice(0, 10)}.zip`;

/** Nome do JSON da empresa dentro do .zip; repetido (duas empresas com o mesmo nome) leva um número. */
export function uniqueBackupFileName(client: Pick<ClientCompany, 'name' | 'tradeName'>, exportedAt: string, taken: Set<string>): string {
  const base = backupFileName(client, exportedAt);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = base.replace(/\.json$/, `_${i}.json`);
  taken.add(name);
  return name;
}
