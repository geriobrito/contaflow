'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientCompany, ExplanatoryNoteBlock, OrgSettings } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { loadLedgerWindow } from '@/lib/services/ledger-loader';
import { getActor } from '@/lib/data/scope';
import { buildBalanceSheet, buildPostings } from '@/lib/ledger';
import { buildDLPA, closingEntriesOf, yearEndOf, yearStartOf } from '@/lib/year-closing';
import { defaultNotes, mergeNotes, type NoteBlock, type NoteFigures } from '@/lib/notes';
import { describeError } from '@/lib/utils/errors';

/* Cópia local: rascunho do navegador, usado se o servidor não responder (e o das versões antigas). */
const cacheKey = (clientId: string, year: string) => `contaflow_notes_${clientId}_${year}`;

function readCache(clientId: string, year: string): Partial<ExplanatoryNoteBlock>[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey(clientId, year)) ?? 'null') as unknown;
    return Array.isArray(saved) ? (saved as Partial<ExplanatoryNoteBlock>[]) : null;
  } catch {
    return null;
  }
}

function writeCache(clientId: string, year: string, notes: readonly NoteBlock[]) {
  try {
    localStorage.setItem(cacheKey(clientId, year), JSON.stringify(notes));
  } catch {
    /* armazenamento indisponível: fica só o que foi para o servidor */
  }
}

/** Atraso entre a última edição e a gravação no servidor. */
const SAVE_DELAY_MS = 800;

export type NotesSaveState = 'idle' | 'saving' | 'saved' | 'local';

/** Saldos do exercício em 31/12 para a nota de patrimônio líquido. */
async function loadFigures(clientId: string, year: string): Promise<NoteFigures | null> {
  const repo = getRepository();
  const [accounts, banks, openings, journalEntries] = await Promise.all([
    repo.listAccounts(clientId),
    repo.listBankAccounts(clientId),
    repo.getOpeningBalances(clientId),
    repo.listJournalEntries(clientId),
  ]);
  if (accounts.length === 0) return null;
  const end = yearEndOf(year);
  const window = await loadLedgerWindow({ clientId, accounts, banks, from: yearStartOf(year), until: end });
  const postings = buildPostings(window.transactions, banks, accounts, end, openings, journalEntries, window.carry);
  const sheet = buildBalanceSheet(postings, accounts, end);
  const lineOf = (code: string) => {
    const acc = accounts.find((a) => a.code === code);
    return acc ? (sheet.equity.find((l) => l.accountId === acc.id)?.value ?? 0) : 0;
  };
  const dlpa = buildDLPA(postings, accounts, journalEntries, end);
  return {
    capital: lineOf('2.3.1.01'),
    capitalToPay: Math.abs(lineOf('2.3.1.02')),
    netResult: dlpa.netResult,
    distributions: Math.abs(dlpa.distributions),
    retained: dlpa.closing,
    closed: closingEntriesOf(journalEntries, year).length > 0,
  };
}

/**
 * Notas explicativas de uma empresa e exercício: o texto gravado no servidor (por cliente e
 * exercício, visto de qualquer aparelho do escritório), os saldos que preenchem o texto-padrão
 * e a gravação automática das edições. Sem servidor, o rascunho fica no navegador e é avisado.
 */
export function useExplanatoryNotes(client: ClientCompany | null, year: string) {
  const clientId = client?.id;
  const key = `${clientId}|${year}`;
  const [loaded, setLoaded] = useState<{ key: string; list: NoteBlock[]; figures: NoteFigures | null } | null>(null);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [saveState, setSaveState] = useState<NotesSaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!client || !clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.getExplanatoryNotes(clientId, year).then(
        (doc) => ({ doc, failed: false }),
        () => ({ doc: null, failed: true })
      ),
      loadFigures(clientId, year).catch(() => null),
      repo.getOrgSettings().catch(() => null),
    ]).then(([{ doc, failed }, figures, o]) => {
      if (!active) return;
      // O servidor manda; sem nada lá (ou fora do ar), vale o rascunho do navegador.
      const saved = doc?.notes ?? readCache(clientId, year);
      setLoaded({ key: `${clientId}|${year}`, list: mergeNotes(defaultNotes(client, year, figures), saved), figures });
      setOrg(o);
      setSaveState(failed ? 'local' : 'idle');
      setError(failed ? 'Não foi possível ler as notas gravadas no servidor; mostrando o rascunho deste navegador.' : null);
    });
    return () => {
      active = false;
    };
  }, [client, clientId, year]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const list = loaded?.key === key ? loaded.list : null;
  const figures = loaded?.key === key ? loaded.figures : null;
  const defaults = useMemo(() => (client ? defaultNotes(client, year, figures) : []), [client, year, figures]);

  const persist = useCallback(
    (next: NoteBlock[]) => {
      if (!clientId) return;
      writeCache(clientId, year, next);
      if (timer.current) clearTimeout(timer.current);
      setSaveState('saving');
      timer.current = setTimeout(() => {
        getRepository()
          .saveExplanatoryNotes({
            id: `${clientId}_${year}`,
            clientId,
            year,
            notes: next.map(({ id, title, text, enabled }) => ({ id, title, text, enabled })),
            updatedAt: new Date().toISOString(),
            updatedByUid: getActor().uid,
          })
          .then(() => {
            setSaveState('saved');
            setError(null);
          })
          .catch((e: unknown) => {
            setSaveState('local');
            setError(`Não foi possível gravar no servidor (${describeError(e)}); o texto está guardado neste navegador.`);
          });
      }, SAVE_DELAY_MS);
    },
    [clientId, year]
  );

  const update = (id: NoteBlock['id'], patch: Partial<NoteBlock>) => {
    if (!list) return;
    const next = list.map((n) => (n.id === id ? { ...n, ...patch } : n));
    setLoaded({ key, list: next, figures });
    persist(next);
  };

  /** Texto-padrão da nota, já com os saldos do exercício. */
  const restore = (id: NoteBlock['id']) => {
    const d = defaults.find((n) => n.id === id);
    if (d) update(id, { title: d.title, text: d.text });
  };

  /** No modo local (sem Firebase) "servidor" é o próprio navegador. */
  const remote = getRepository().mode === 'firestore';
  return { list, figures, org, saveState, remote, error, update, restore };
}
