'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { useClient } from '@/contexts/ClientContext';
import { useLedgerData } from '@/hooks/useLedgerData';
import { useVirtualTable } from '@/hooks/useVirtualTable';
import { PeriodPicker, usePeriod } from '@/components/ui/PeriodPicker';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';
import { buildDaybook, DAYBOOK_TEXT_MAX, normalizeDaybookInfo, type DaybookBookInfo, type DaybookOrigin } from '@/lib/daybook';
import { updateClientDaybook } from '@/lib/services/data-service';
import { formatMonth, monthOf, monthsBetween } from '@/lib/periods';
import { describeError } from '@/lib/utils/errors';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { openingStatus } from '@/lib/opening';
import { StatementChecks } from '@/components/ui/StatementChecks';
import { openingCheck } from '@/lib/statement-checks';
import { useSignatureReminder } from '@/hooks/useSignatureReminder';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { reportError } from '@/lib/monitoring';

/** Lançamentos por página na tela (o PDF traz o período inteiro). */
const PAGE_SIZE = 50;

const ORIGIN_LABEL: Record<DaybookOrigin, string> = { OPENING: 'Abertura', BANK: 'Extrato', MANUAL: 'Manual' };

/*
 * Dados dos termos (número do livro, sede, registro): ficam no cadastro da empresa
 * (`ClientCompany.daybook`). Versões antigas guardavam no navegador; ao abrir o Diário, o que
 * houver aqui passa para o cadastro uma vez e a chave local é apagada.
 */
const legacyBookKey = (clientId: string) => `contaflow_daybook_${clientId}`;
const EMPTY_BOOK: DaybookBookInfo = { number: '1', city: '', registry: '' };
/** Espera depois da última tecla antes de gravar no cadastro. */
const SAVE_DELAY_MS = 700;

function readLegacyBook(clientId: string): Partial<DaybookBookInfo> | null {
  try {
    const raw = localStorage.getItem(legacyBookKey(clientId));
    return raw ? (JSON.parse(raw) as Partial<DaybookBookInfo>) : null;
  } catch {
    return null;
  }
}

function dropLegacyBook(clientId: string): void {
  try {
    localStorage.removeItem(legacyBookKey(clientId));
  } catch {
    /* armazenamento indisponível */
  }
}

/**
 * Livro Diário: todos os lançamentos do período em ordem cronológica (extrato, manuais e
 * saldos de abertura), com as partidas a débito e a crédito, e o PDF com os termos de
 * abertura e de encerramento. Os dados vêm de `useLedgerData`, o mesmo do Livro Razão.
 */
export default function DiarioPage() {
  const { currentClient, replaceClient } = useClient();
  const clientId = currentClient?.id;
  const period = usePeriod('month');
  const { range, jumpTo } = period;
  // O número de ordem é contado desde 1º de janeiro: o exercício inteiro é lido um lançamento por vez.
  const { data: static_, accounts, banks, transactions, from, loading, error, setError } = useLedgerData(clientId, range, jumpTo);
  const [book, setBook] = useState<DaybookBookInfo>(EMPTY_BOOK);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const bookFor = useRef<string | null>(null);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dados dos termos do cadastro da empresa, uma vez por empresa aberta (lidos fora do render).
  useEffect(() => {
    if (!currentClient || bookFor.current === currentClient.id) return;
    const client = currentClient;
    bookFor.current = client.id;
    const legacy = readLegacyBook(client.id);
    const source = client.daybook ?? legacy ?? {};
    const initial = normalizeDaybookInfo({ ...source, city: source.city || client.city || '' });
    void Promise.resolve().then(() => setBook(initial));
    if (!legacy) return;
    if (client.daybook) {
      dropLegacyBook(client.id); // o cadastro já tem os dados: o do navegador é sobra antiga
      return;
    }
    updateClientDaybook(client.id, initial)
      .then(() => {
        dropLegacyBook(client.id);
        replaceClient({ ...client, daybook: initial });
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'diario', op: 'migrar termos do navegador' });
        setError(`Não foi possível levar os dados dos termos para o cadastro da empresa (${describeError(e)}).`);
      });
  }, [currentClient, replaceClient, setError]);

  const daybook = useMemo(() => {
    if (!transactions || !static_) return null;
    return buildDaybook({
      transactions,
      bankAccounts: banks,
      accounts,
      range,
      openings: static_.openings,
      journalEntries: static_.journalEntries,
      numberFrom: from,
    });
  }, [transactions, static_, banks, accounts, range, from]);

  // Enquanto houver algo a classificar ou competência aberta, o conteúdo ainda pode mudar.
  const provisional = useMemo(() => {
    if (!daybook || !static_) return null;
    const locked = new Set(static_.locks.map((l) => l.month));
    const withEntries = new Set(daybook.entries.map((e) => monthOf(e.date)));
    const open = monthsBetween(range.start, range.end).filter((m) => withEntries.has(m) && !locked.has(m));
    const reasons = [
      daybook.unclassified > 0 && `há ${daybook.unclassified} lançamento(s) a classificar`,
      open.length > 0 && `competência(s) em aberto: ${open.map((m) => formatMonth(m)).join(', ')}`,
    ].filter(Boolean);
    return reasons.length ? reasons.join('; ') : null;
  }, [daybook, static_, range]);

  const opening = useMemo(
    () => (static_ && accounts.length > 0 ? openingStatus(static_.openings, accounts, banks) : null),
    [static_, accounts, banks]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!daybook || !term) return daybook?.entries ?? [];
    return daybook.entries.filter(
      (e) =>
        e.memo.toLowerCase().includes(term) ||
        e.document.toLowerCase().includes(term) ||
        String(e.number) === term ||
        e.lines.some((l) => l.code.toLowerCase().includes(term) || l.name.toLowerCase().includes(term) || (l.memo ?? '').toLowerCase().includes(term))
    );
  }, [daybook, search]);
  const {
    containerRef,
    onScroll,
    visibleItems: rows,
    startIndex,
    endIndex,
    offsetTop,
    offsetBottom,
    isVirtualized,
  } = useVirtualTable(visible, {
    rowHeight: 84,
    defaultViewportHeight: 640,
    minItemsForVirtualization: PAGE_SIZE,
  });

  /** Atualiza na tela e grava no cadastro da empresa logo após a última tecla. */
  const updateBook = (patch: Partial<DaybookBookInfo>) => {
    const next = { ...book, ...patch };
    setBook(next);
    if (!currentClient) return;
    const client = currentClient;
    if (pendingSave.current) clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => {
      pendingSave.current = null;
      const daybook = normalizeDaybookInfo(next);
      updateClientDaybook(client.id, daybook)
        .then(() => replaceClient({ ...client, daybook }))
        .catch((e: unknown) => {
          reportError(e, { area: 'diario', op: 'gravar termos' });
          setError(`Não foi possível gravar os dados dos termos (${describeError(e)}).`);
        });
    }, SAVE_DELAY_MS);
  };

  const signature = useSignatureReminder(static_?.org);

  const exportPdf = async () => {
    if (!daybook || !currentClient) return;
    setExporting(true);
    setError(null);
    try {
      const [{ generateDaybookPdf }, { downloadBlob }] = await Promise.all([import('@/lib/export/daybook-pdf'), import('@/lib/export/dre-rows')]);
      const { blob, fileName } = generateDaybookPdf({
        client: currentClient,
        daybook,
        book,
        provisional,
        signatories: {
          legalRepresentative: { name: currentClient.legalRepresentativeName, cpf: currentClient.legalRepresentativeCpf },
          accountant: { name: static_?.org?.accountantName, crc: static_?.org?.accountantCrc },
        },
      });
      downloadBlob(blob, fileName);
      signature.remind();
    } catch (e) {
      reportError(e, { area: 'diario', op: 'gerar PDF' });
      setError(`Não foi possível gerar o PDF (${describeError(e)}).`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Livro Diário"
        description="Todos os lançamentos em ordem cronológica — extrato, lançamentos manuais e saldos de abertura — com as partidas a débito e a crédito. Para o livro do exercício, selecione o período “Ano” e gere o PDF, que sai com os termos de abertura e de encerramento."
        actions={
          <button type="button" disabled={!daybook || exporting} onClick={() => void exportPdf()} className={BUTTON.secondary} title="Gerar o Livro Diário do período em PDF, com termos de abertura e de encerramento">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-rose-600 dark:text-rose-300" strokeWidth={1.75} />}
            <span>{exporting ? 'Gerando…' : 'Gerar PDF'}</span>
          </button>
        }
      />

      <PeriodPicker period={period} />

      {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">{error}</p>}


      {/* Dados que só os termos usam */}
      <section className={`${SURFACE} rounded-[22px] p-5 space-y-3`} aria-label="Dados dos termos de abertura e encerramento">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Termos de abertura e de encerramento</h2>
          <p className="text-[12px] text-stone-500">
            Saem no PDF com a razão social, o CNPJ, o período, o total de páginas e as assinaturas do representante legal e do contador
            (cadastrados em Clientes e em Escritório). Os dados abaixo ficam gravados no cadastro da empresa.
          </p>
        </div>
        <div className="grid grid-cols-[8rem_1fr_1fr] gap-3">
          <Field label="Livro nº">
            <input value={book.number} onChange={(e) => updateBook({ number: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={`${INPUT} font-mono tabular-nums`} />
          </Field>
          <Field label="Sede (município/UF)" hint="Opcional">
            <input value={book.city ?? ''} maxLength={DAYBOOK_TEXT_MAX} onChange={(e) => updateBook({ city: e.target.value })} placeholder="ex.: Recife/PE" className={INPUT} />
          </Field>
          <Field label="NIRE ou nº de registro" hint="Opcional">
            <input value={book.registry ?? ''} maxLength={DAYBOOK_TEXT_MAX} onChange={(e) => updateBook({ registry: e.target.value })} className={`${INPUT} font-mono`} />
          </Field>
        </div>
      </section>

      <StatementChecks
        checks={[
          openingCheck(opening),
          Boolean(provisional) && {
            id: 'provisional',
            level: 'warn',
            title: `Diário provisório: ${provisional}`,
            items: ['O PDF sai com esse aviso nos termos.'],
            href: '/',
            linkLabel: 'Abrir na Conciliação',
          },
        ]}
      />

      {loading ? (
        // Falha de carga: fica só o erro acima, sem Diário parcial nem "carregando" eterno.
        error ? null : (
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <TableSkeleton rows={8} label="Carregando lançamentos…" />
          </section>
        )
      ) : !daybook || daybook.entries.length === 0 ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Sem lançamentos no período" description="Importe extratos ou registre lançamentos manuais para compor o Diário." />
        </section>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-px rounded-[22px] overflow-hidden bg-black/5 dark:bg-white/6 border border-line">
            <div className="bg-surface p-4">
              <span className="text-[11px] uppercase tracking-[0.08em] text-stone-400 font-medium">Lançamentos</span>
              <p className="mt-1 font-mono tabular-nums text-[17px] font-semibold">{daybook.entries.length}</p>
            </div>
            <div className="bg-surface p-4">
              <span className="text-[11px] uppercase tracking-[0.08em] text-stone-400 font-medium">Total a débito</span>
              <p className="mt-1 font-mono tabular-nums text-[17px] font-semibold">{formatCurrency(daybook.totals.debits)}</p>
            </div>
            <div className="bg-surface p-4">
              <span className="text-[11px] uppercase tracking-[0.08em] text-stone-400 font-medium">Total a crédito</span>
              <p className={`mt-1 font-mono tabular-nums text-[17px] font-semibold ${daybook.balanced ? '' : 'text-rose-600 dark:text-rose-300'}`}>{formatCurrency(daybook.totals.credits)}</p>
            </div>
          </div>
          {!daybook.balanced && (
            <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
              Débitos e créditos do período não fecham: há lançamento rateado cuja soma difere do valor do extrato. Confira os rateios na Conciliação.
            </p>
          )}

          <SearchField value={search} onChange={setSearch} placeholder="Buscar por histórico, documento, número ou conta" />

          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            {visible.length === 0 ? (
              <EmptyState title="Nenhum lançamento encontrado" description={`Nada corresponde a “${search}”.`} />
            ) : (
              <div
                ref={containerRef}
                onScroll={onScroll}
                className={`overflow-x-auto print:overflow-visible ${
                  isVirtualized ? 'max-h-[640px] overflow-y-auto print:max-h-none' : ''
                }`}
              >
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-surface-2 text-stone-500 uppercase tracking-[0.08em] text-[10px] font-semibold border-b border-line">
                      <th className="pl-5 pr-3 py-2.5 w-16 text-right">Nº</th>
                      <th className="px-3 py-2.5 w-24">Data</th>
                      <th className="px-3 py-2.5">Conta</th>
                      <th className="px-3 py-2.5">Histórico</th>
                      <th className="px-3 py-2.5 text-right w-32">Débito</th>
                      <th className="pl-3 pr-5 py-2.5 text-right w-32">Crédito</th>
                    </tr>
                  </thead>
                  {offsetTop > 0 && (
                    <tbody aria-hidden="true" className="print:hidden">
                      <tr>
                        <td colSpan={6} style={{ height: offsetTop, padding: 0, border: 0 }} />
                      </tr>
                    </tbody>
                  )}
                  {rows.map((e) => (
                    <tbody key={e.id} className="border-b border-line last:border-0">
                      <tr className="bg-stone-50/60 dark:bg-stone-800/30">
                        <td className="pl-5 pr-3 pt-2.5 pb-1 text-right font-mono tabular-nums font-semibold text-stone-700 dark:text-stone-300">{e.number}</td>
                        <td className="px-3 pt-2.5 pb-1 font-mono tabular-nums text-stone-600 dark:text-stone-400 whitespace-nowrap">{formatDateBR(e.date)}</td>
                        <td className="px-3 pt-2.5 pb-1 font-medium text-stone-900 dark:text-stone-100" colSpan={4}>
                          {e.memo}
                          <span className="ml-2 font-normal text-[11px] text-stone-400">
                            {ORIGIN_LABEL[e.origin]}
                            {e.document && <span className="font-mono"> · {e.document}</span>}
                          </span>
                          {e.unclassified && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-[10px] font-medium text-amber-800 dark:text-amber-300">a classificar</span>}
                        </td>
                      </tr>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td colSpan={2} />
                          <td className={`px-3 py-1 text-stone-700 dark:text-stone-300 ${l.credit ? 'pl-8' : ''}`}>
                            {l.code && <span className="font-mono text-[11px] text-stone-400 mr-1.5">{l.code}</span>}
                            {l.name}
                          </td>
                          <td className="px-3 py-1 text-stone-500 max-w-xs truncate" title={l.memo}>{l.memo ?? ''}</td>
                          <td className="px-3 py-1 text-right font-mono tabular-nums whitespace-nowrap">{l.debit ? formatCurrency(l.debit) : ''}</td>
                          <td className="pl-3 pr-5 py-1 text-right font-mono tabular-nums whitespace-nowrap">{l.credit ? formatCurrency(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                  {offsetBottom > 0 && (
                    <tbody aria-hidden="true" className="print:hidden">
                      <tr>
                        <td colSpan={6} style={{ height: offsetBottom, padding: 0, border: 0 }} />
                      </tr>
                    </tbody>
                  )}
                </table>
              </div>
            )}
            {isVirtualized && (
              <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-line text-[12px] text-stone-500 print:hidden">
                <span>
                  Exibindo {startIndex + 1}–{endIndex} de {visible.length} lançamento(s)
                </span>
                <span className="text-[11px] text-stone-400 font-mono">Rolagem virtualizada ativa</span>
              </div>
            )}
          </section>
        </>
      )}
      {signature.toast}
    </main>
  );
}
