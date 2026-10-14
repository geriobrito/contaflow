'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChartAccount, JournalEntry, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { repeatDraft } from '@/lib/journal';
import { describeError } from '@/lib/utils/errors';

/** Dados do formulário de lançamento: o resto (id, número, datas de gravação) é de quem grava. */
export type JournalEntryInput = Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>;

const newJournalId = () => `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

/**
 * Lançamentos manuais de uma empresa, com o plano de contas e os fechamentos, e as gravações:
 * criar, editar, excluir e repetir do mês anterior. Toda gravação recarrega a lista.
 */
export function useJournalEntries(clientId: string | undefined, authorUid: string | undefined) {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Carrega plano de contas, travas e lançamentos manuais
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listPeriodLocks(clientId),
      repo.listJournalEntries(clientId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Missing or insufficient permissions') || msg.includes('permission')) {
          setError(
            'Permissão insuficiente no Firestore: as regras de segurança das coleções "journal_entries" e "journal_counters" precisam ser publicadas (npx firebase-tools deploy --only firestore:rules, ou Firebase Console > Firestore Database > Regras).'
          );
        } else {
          setError(msg);
        }
        return [];
      }),
    ])
      .then(([accs, periodLocks, journalList]) => {
        if (!active) return;
        setAccounts(accs);
        setLocks(periodLocks);
        setEntries(journalList);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        console.error('Erro ao carregar dados:', e);
        setError(e instanceof Error ? e.message : 'Falha ao carregar dados.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, reloadCount]);

  const reload = () => setReloadCount((c) => c + 1);

  const isMonthLocked = useCallback((month: string) => locks.some((l) => l.month === month), [locks]);

  /** Cria (sem `existingId`) ou altera um lançamento. */
  const saveEntry = async (entryData: JournalEntryInput, existingId?: string) => {
    if (!clientId) return;
    const repo = getRepository();
    const now = new Date().toISOString();
    if (existingId) {
      const existing = entries.find((e) => e.id === existingId);
      if (!existing) throw new Error('Lançamento não encontrado. Recarregue a página e tente novamente.');
      // Número, criação e autor são preservados na edição.
      await repo.updateJournalEntry({
        ...entryData,
        id: existing.id,
        clientId,
        entryNumber: existing.entryNumber,
        createdAt: existing.createdAt,
        createdByUid: existing.createdByUid,
        // A origem da repetição também: sem ela o lançamento seria oferecido de novo.
        ...(existing.repeatedFromId ? { repeatedFromId: existing.repeatedFromId } : {}),
        updatedAt: now,
      });
    } else {
      // O número vem da sequência do cliente, atribuído pelo repositório ao gravar.
      await repo.createJournalEntry({
        ...entryData,
        id: newJournalId(),
        clientId,
        createdAt: now,
        updatedAt: now,
        createdByUid: authorUid || 'local',
      });
    }
    reload();
  };

  /** Exclui; se falhar, o erro sobe ao chamador e o lançamento continua na lista. */
  const deleteEntry = async (entry: JournalEntry) => {
    await getRepository().deleteJournalEntry(entry.id);
    reload();
  };

  /** Grava as cópias uma a uma (cada uma recebe o seu número); se alguma falhar, diz quantas entraram. */
  const repeatEntries = async (chosen: readonly JournalEntry[], targetMonth: string) => {
    if (!clientId) return;
    const repo = getRepository();
    const now = new Date().toISOString();
    let created = 0;
    try {
      for (const entry of chosen) {
        await repo.createJournalEntry({
          ...repeatDraft(entry, targetMonth),
          id: newJournalId(),
          clientId,
          createdAt: now,
          updatedAt: now,
          createdByUid: authorUid || 'local',
        });
        created++;
      }
    } catch (e) {
      console.error('Erro ao repetir lançamentos:', e);
      throw new Error(`${created} de ${chosen.length} lançamento(s) gravado(s); o seguinte falhou (${describeError(e)}).`);
    } finally {
      if (created) reload();
    }
  };

  return { accounts, entries, loading, error, isMonthLocked, saveEntry, deleteEntry, repeatEntries };
}
