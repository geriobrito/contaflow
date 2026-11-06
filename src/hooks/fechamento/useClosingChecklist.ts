'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookRegistration, ChartAccount, ClientCompany, ClosingChecklist, JournalEntry, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { getActor } from '@/lib/data/scope';
import { buildPostings, buildTrialBalance, type TrialBalance } from '@/lib/ledger';
import { closingEntriesOf, withoutClosingOf, yearEndOf, yearStartOf } from '@/lib/year-closing';
import { monthsWithData } from '@/lib/balance-sheet-view';
import { monthsBetween } from '@/lib/periods';
import { closingChecks, disposalRenames, hasStockBalance, manualItems, provisionRenames } from '@/lib/closing-checklist';
import { activityCheck, periodLockCheck, type StatementCheck } from '@/lib/statement-checks';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

interface Loaded {
  key: string;
  accounts: ChartAccount[];
  journalEntries: JournalEntry[];
  locks: PeriodLock[];
  beforeClosing: TrialBalance;
  final: TrialBalance;
  /** Competências do ano com lançamentos. */
  months: string[];
  checklist: ClosingChecklist | null;
}

/**
 * Fechamento do exercício de uma empresa: o balancete do ano (antes e depois do encerramento),
 * as conferências automáticas, os itens marcados à mão e a comprovação da escrituração.
 */
export function useClosingChecklist(client: ClientCompany | null, year: string) {
  const clientId = client?.id;
  const key = `${clientId}|${year}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    (async () => {
      const [accounts, banks, openings, journalEntries, locks, checklist] = await Promise.all([
        repo.listAccounts(clientId),
        repo.listBankAccounts(clientId),
        repo.getOpeningBalances(clientId),
        repo.listJournalEntries(clientId),
        repo.listPeriodLocks(clientId),
        repo.getClosingChecklist(clientId, year),
      ]);
      const start = yearStartOf(year);
      const end = yearEndOf(year);
      const window = await loadLedgerWindow({ clientId, accounts, banks, locks, from: start, until: end });
      const range = { start, end };
      const postings = (entries: readonly JournalEntry[]) => buildPostings(window.transactions, banks, accounts, end, openings, entries, window.carry);
      const withData = monthsWithData(window.transactions, journalEntries);
      return {
        key: `${clientId}|${year}`,
        accounts,
        journalEntries,
        locks,
        beforeClosing: buildTrialBalance(postings(withoutClosingOf(journalEntries, year)), accounts, range),
        final: buildTrialBalance(postings(journalEntries), accounts, range),
        months: monthsBetween(start, end).filter((m) => withData.has(m)),
        checklist,
      };
    })()
      .then((value) => {
        if (!active) return;
        setLoaded(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'fechamento', op: 'carregar' });
        setError(`Não foi possível carregar o exercício (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, year, reloadCount]);

  const current = loaded?.key === key ? loaded : null;
  const yearClosed = current ? closingEntriesOf(current.journalEntries, year).length > 0 : false;

  const checks = useMemo((): StatementCheck[] => {
    if (!current || !client) return [];
    const locked = new Set(current.locks.map((l) => l.month));
    return [
      periodLockCheck({ closed: current.months.filter((m) => locked.has(m)).length, total: current.months.length }, 'o exercício'),
      yearClosed
        ? { id: 'year-closed', level: 'ok', title: `Exercício de ${year} encerrado: resultado levado ao patrimônio líquido` }
        : {
            id: 'year-closed',
            level: 'warn',
            title: `Exercício de ${year} ainda não encerrado`,
            items: ['Feche dezembro e encerre o exercício: as contas de resultado são zeradas contra a ARE e o resultado vai para Lucros ou Prejuízos Acumulados.'],
            href: '/balanco',
            linkLabel: 'Ir ao encerramento',
          },
      activityCheck(client) ?? { id: 'activity', level: 'ok', title: 'Declaração de conformidade com a norma e atividade principal no fim das demonstrações' },
      ...closingChecks({ client, accounts: current.accounts, beforeClosing: current.beforeClosing, final: current.final, yearClosed }),
    ].filter((c): c is StatementCheck => Boolean(c));
  }, [current, client, year, yearClosed]);

  const items = useMemo(() => (current ? manualItems(hasStockBalance(current.final, current.accounts)) : []), [current]);
  const renames = useMemo(
    () => ({ provision: current ? provisionRenames(current.accounts) : [], disposal: current ? disposalRenames(current.accounts) : [] }),
    [current]
  );

  const persist = useCallback(
    async (change: (prev: ClosingChecklist) => ClosingChecklist) => {
      if (!clientId || !current) return;
      const prev: ClosingChecklist = current.checklist ?? { id: `${clientId}_${year}`, clientId, year, items: {}, updatedAt: '' };
      const next = { ...change(prev), updatedAt: new Date().toISOString(), updatedByUid: getActor().uid };
      setSaving(true);
      setLoaded({ ...current, checklist: next });
      try {
        await getRepository().saveClosingChecklist(next);
        setError(null);
      } catch (e) {
        reportError(e, { area: 'fechamento', op: 'gravar checklist' });
        setLoaded({ ...current, checklist: current.checklist });
        setError(`Não foi possível gravar (${describeError(e)}).`);
      } finally {
        setSaving(false);
      }
    },
    [clientId, current, year]
  );

  const toggle = (itemId: string, done: boolean) =>
    persist((prev) => ({ ...prev, items: { ...prev.items, [itemId]: { done, at: new Date().toISOString(), byUid: getActor().uid } } }));
  const saveBooks = (books: BookRegistration | null) =>
    persist((prev) => {
      const next = { ...prev };
      if (books) next.books = books;
      else delete next.books;
      return next;
    });

  /**
   * Corrige o nome das contas da conferência: "provisão" em férias e 13º, ou "ganho"/"perda" na
   * venda de bens. O nome muda mesmo com competência fechada.
   */
  const applyRenames = async (kind: keyof typeof renames) => {
    setSaving(true);
    try {
      const repo = getRepository();
      const now = new Date().toISOString();
      for (const r of renames[kind]) await repo.saveAccount({ ...r.account, name: r.name, updatedAt: now });
      setReloadCount((c) => c + 1);
      setError(null);
    } catch (e) {
      reportError(e, { area: 'fechamento', op: 'renomear contas' });
      setError(`Não foi possível renomear (${describeError(e)}).`);
    } finally {
      setSaving(false);
    }
  };

  return {
    ready: Boolean(current),
    error,
    saving,
    checks,
    items,
    checklist: current?.checklist ?? null,
    renames,
    yearClosed,
    toggle,
    saveBooks,
    applyRenames,
  };
}
