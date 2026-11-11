'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardPaste, Lock, Plus } from 'lucide-react';
import type { BankAccount, ChartAccount, OpeningMode } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useOpeningBalances } from '@/hooks/abertura/useOpeningBalances';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { accountMatches } from '@/lib/account-search';
import { normalizeText } from '@/lib/utils/search';
import { frozenMessage } from '@/lib/lock-guard';
import { openingAccounts } from '@/lib/opening';
import { buildOpeningSheet } from '@/lib/opening-view';
import { round2 } from '@/lib/money';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SearchField, SegmentedControl, SURFACE, INPUT_MONEY } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { OpeningColumn } from '@/components/abertura/OpeningColumn';
import { OpeningFooter } from '@/components/abertura/OpeningFooter';
import { PasteTrialBalanceSheet } from '@/components/abertura/PasteTrialBalanceSheet';
import type { ImportResult } from '@/lib/opening-import';

/** "A empresa já tinha contabilidade?": Não = balanço de abertura; Sim = implantação com balanço anterior. */
const MODE_OPTIONS: readonly { value: OpeningMode; label: string }[] = [
  { value: 'OPENING_BALANCE', label: 'Não' },
  { value: 'CONTINUITY', label: 'Sim' },
];

const MODE_HINT: Record<OpeningMode, string> = {
  OPENING_BALANCE: 'Informe os saldos conhecidos. A diferença vai sozinha para a conta transitória Balanço de Abertura, no PL, que o encerramento do exercício zera contra Lucros ou Prejuízos Acumulados.',
  CONTINUITY: 'Traga os saldos do balanço anterior, já fechado: o ativo precisa ser igual a passivo + PL.',
};

/** Contas mais comuns numa abertura de MEI ou Simples, sugeridas na primeira vez (códigos do modelo do CFC). */
const COMMON_CODES = ['1.1.1.01', '1.1.2.01', '1.1.3.01', '2.1.2.01', '2.1.5.01', '2.3.1.01'];

/** Campos de valor da tela, na ordem em que aparecem (Ativo e depois Passivo e PL). */
const FIELD_SELECTOR = 'input[data-opening-field]';

/** Enter vai para o próximo campo de valor; Shift+Enter, para o anterior. */
function moveOnEnter(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement;
  if (!target.matches(FIELD_SELECTOR)) return;
  e.preventDefault();
  const fields = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>(FIELD_SELECTOR));
  const next = fields[fields.indexOf(target as HTMLInputElement) + (e.shiftKey ? -1 : 1)];
  if (next) {
    next.focus();
    next.select();
  } else {
    // Último campo: sai dele para o valor ser formatado.
    target.blur();
  }
}

export default function AberturaPage() {
  const { currentClient } = useClient();
  const o = useOpeningBalances(currentClient?.id);
  const { ready, accounts, banks, frozen, parsed, bankDrafts, plug } = o;
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /** Conta recém-adicionada: o campo dela recebe o foco quando aparecer. */
  const focusId = useRef<string | null>(null);
  const leave = useUnsavedChangesGuard(o.unsaved && !frozen);

  const term = search.trim();
  const searching = Boolean(term);
  const { values } = o;

  const sheet = useMemo(() => {
    const bankText = normalizeText(term);
    return buildOpeningSheet({
      accounts,
      banks: bankDrafts.next,
      amounts: parsed.amounts,
      plug,
      // Busca acha qualquer conta, preenchida ou não; sem busca, só as com saldo, as em edição e as adicionadas.
      // Travada, a tela só consulta: mostra as contas com saldo.
      showAccount: (a: ChartAccount, amount: number) => {
        if (searching && !accountMatches(a, term)) return false;
        if (frozen) return amount > 0;
        return searching || showAll || amount > 0 || parsed.invalid.has(a.id) || a.id in values;
      },
      showBank: (b: BankAccount) => !searching || normalizeText(`${b.ledgerAccountCode ?? ''} ${b.nickname} ${b.ledgerAccountName ?? ''}`).includes(bankText),
    });
  }, [accounts, bankDrafts.next, parsed.amounts, parsed.invalid, plug, term, searching, frozen, showAll, values]);

  const editable = useMemo(() => openingAccounts(accounts, banks), [accounts, banks]);
  const hasAccounts = editable.length > 0;

  // Primeira abertura do cliente: atalhos para as contas mais comuns que ainda não estão na lista.
  const common = useMemo(() => {
    if (!ready || ready.saved || frozen) return [];
    return COMMON_CODES.map((code) => editable.find((a) => a.code === code)).filter((a): a is ChartAccount => Boolean(a) && !(a!.id in values));
  }, [ready, frozen, editable, values]);

  /** Põe a conta na lista (abrindo a seção, se recolhida) e leva o foco ao campo dela. */
  const applyImport = (result: ImportResult) => {
    o.applyImport(result);
    setPasting(false);
    // Contas preenchidas podem estar em seções recolhidas: abre todas para conferir.
    setCollapsed(new Set());
    const banksFilled = result.bankValues.size;
    setImported(
      `Balancete aplicado: ${result.values.size} conta(s)${banksFilled ? ` e ${banksFilled} banco(s)` : ''} preenchido(s). Confira os valores e salve.`
    );
  };

  const addAccount = (accountId: string) => {
    const section = [...sheet.assets, ...sheet.claims].find((s) => s.addable.some((a) => a.id === accountId));
    if (section) setCollapsed((prev) => (prev.has(section.key) ? new Set([...prev].filter((k) => k !== section.key)) : prev));
    o.pinAccount(accountId);
    focusId.current = accountId;
  };

  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const field = document.getElementById(`op-${id}`);
    if (!(field instanceof HTMLInputElement)) return;
    focusId.current = null;
    field.focus();
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [sheet, collapsed]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const column = {
    frozen,
    date: o.date,
    values: o.values,
    invalid: parsed.invalid,
    onValue: o.setValue,
    onValueBlur: o.normalizeValue,
    bankValues: o.bankValues,
    bankInvalid: bankDrafts.invalid,
    onBankValue: o.setBankValue,
    onBankValueBlur: o.normalizeBankValue,
    collapsed,
    onToggle: toggle,
    searching,
    onAdd: addAccount,
  };

  const firstLockedMonth = o.lockedMonths[0];

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Balanço de abertura"
        description="Saldo de cada conta no dia em que a contabilidade começa no sistema. Com ele, o balanço patrimonial sai completo, não só com os bancos."
      />

      {ready && frozen && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <span className="flex items-start gap-2.5 min-w-0">
            <Lock className="w-4 h-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <span>{frozenMessage('opening_balances', { lockState: ready.lockState, lockedMonths: o.lockedMonths, firstTime: !ready.saved })}</span>
          </span>
          {firstLockedMonth && (
            <Link href={`/?mes=${firstLockedMonth}`} className="shrink-0 font-medium text-accent-ink hover:underline">
              Ir para Conciliação →
            </Link>
          )}
        </div>
      )}

      {!ready ? (
        <>
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <TableSkeleton rows={8} label="Carregando saldos de abertura…" />
          </section>
          {o.error && (
            <p role="alert" className="rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-500/25 text-[13px] text-rose-700 dark:text-rose-300">
              {o.error}
            </p>
          )}
        </>
      ) : !hasAccounts ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Plano de contas vazio" description="Aplique o modelo de plano de contas (CFC) em Plano de Contas para informar os saldos de abertura." />
        </section>
      ) : (
        <>
          {/* Data, tipo de implantação e histórico */}
          <section className={`${SURFACE} rounded-[22px] px-5 py-4 space-y-3`}>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <div className="w-48">
                <Field label="Data do balanço de abertura" hint="Posição no início do dia.">
                  <input disabled={frozen} type="date" value={o.date} onChange={(e) => o.setDate(e.target.value)} className={`${INPUT_MONEY} h-10`} />
                </Field>
              </div>
              <div className="flex-1 min-w-[280px] space-y-1.5">
                <span className="block text-[12px] font-medium text-stone-500 px-0.5">A empresa já tinha contabilidade?</span>
                <SegmentedControl ariaLabel="A empresa já tinha contabilidade?" value={o.mode} onChange={o.setMode} options={MODE_OPTIONS} disabled={frozen} />
                <span className="block text-[12px] text-stone-500 dark:text-stone-400 px-0.5">{MODE_HINT[o.mode]}</span>
              </div>
            </div>
            {o.mode === 'OPENING_BALANCE' && (
              <details className="group">
                <summary className="cursor-pointer select-none text-[12px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">Mais opções</summary>
                <div className="pt-3 max-w-xl">
                  <Field label="Histórico no Diário">
                    <input disabled={frozen} value={o.memo} onChange={(e) => o.setMemo(e.target.value)} maxLength={200} className={`${INPUT} h-10`} />
                  </Field>
                </div>
              </details>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <SearchField value={search} onChange={setSearch} placeholder="Buscar conta ou banco por código ou nome" className="flex-1 min-w-[260px]" />
            {!frozen && (
              <label className="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Mostrar todas as contas
              </label>
            )}
            {!frozen && (
              <button type="button" onClick={() => setPasting(true)} className={BUTTON.secondary}>
                <ClipboardPaste className="w-4 h-4" strokeWidth={1.75} />
                Colar balancete
              </button>
            )}
          </div>

          {imported && (
            <p role="status" className="flex items-center gap-2 -mt-4 text-[13px] text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {imported}
            </p>
          )}

          {common.length > 0 && !searching && !showAll && (
            <div className="flex flex-wrap items-center gap-2 -mt-4">
              <span className="text-[12px] text-stone-500">Contas mais comuns:</span>
              {common.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => addAccount(a.id)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-line-strong bg-white/70 dark:bg-stone-800/60 text-[12px] text-stone-700 dark:text-stone-200 hover:bg-white dark:hover:bg-stone-800 transition-colors"
                >
                  <Plus aria-hidden className="w-3 h-3 text-stone-400" />
                  {a.name}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-2 items-start" onKeyDown={moveOnEnter}>
            <OpeningColumn title="Ativo" total={sheet.totals.assets} sections={sheet.assets} {...column} />
            <OpeningColumn title="Passivo e patrimônio líquido" total={round2(sheet.totals.liabilities + sheet.totals.equity)} sections={sheet.claims} {...column} />
          </div>

          <OpeningFooter
            totals={sheet.totals}
            mode={o.mode}
            plug={plug}
            frozen={frozen}
            saving={o.saving}
            dirty={o.dirty}
            unsaved={o.unsaved}
            divergent={o.divergent}
            savedAt={o.savedAt}
            error={o.error}
            onSave={() => void o.save()}
            equityAccounts={o.equityAccounts}
            plugAccount={o.plugAccount}
            onPlugAccount={o.setPlugId}
            onPlugInto={o.plugInto}
          />
        </>
      )}

      {pasting && ready && <PasteTrialBalanceSheet accounts={accounts} banks={banks} onApply={applyImport} onClose={() => setPasting(false)} />}

      {leave.pending && (
        <ConfirmDialog
          title="Sair sem salvar?"
          description="Os saldos de abertura alterados nesta tela ainda não foram salvos e vão ser descartados."
          confirmLabel="Sair sem salvar"
          cancelLabel="Continuar editando"
          destructive
          onConfirm={leave.confirm}
          onCancel={leave.cancel}
        />
      )}
    </main>
  );
}
