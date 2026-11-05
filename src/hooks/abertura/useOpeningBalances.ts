'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankAccount, ChartAccount, LockState, OpeningBalances, OpeningMode, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { isOpeningFrozen } from '@/lib/lock-guard';
import { DEFAULT_OPENING_MEMO, OPENING_ACCOUNT_CODE, accountKind, isContraAccount } from '@/lib/ledger';
import { defaultOpeningDate, missingOpeningAccounts, openingModeOf, openingPlug, openingSaveProblem, parseMoneyInput, parseSignedMoneyInput, summarizeOpening } from '@/lib/opening';
import { formatCurrency } from '@/lib/utils/formatters';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';
import { round2 } from '@/lib/money';
import type { ImportResult } from '@/lib/opening-import';

const MONEY = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor → texto do campo, como se digita ("1.234,50", "-250,00"). */
export const formatMoneyInput = (n: number) => MONEY.format(n).replace(/−/g, '-');

/** Valor salvo → texto do campo; vazio quando zero. */
export const toMoneyInput = (n: number | undefined) => (n ? formatMoneyInput(n) : '');

interface Loaded {
  id: string;
  accounts: ChartAccount[];
  banks: BankAccount[];
  saved: OpeningBalances | null;
  lockState: LockState | null;
  locks: PeriodLock[];
  firstStatement: string | null;
}

/**
 * Tela de balanço de abertura: carga, rascunho (data, tipo, histórico, valores digitados por conta
 * e por banco), conferência e gravação. Saldos, bancos alterados, contas criadas e auditoria entram
 * numa única gravação.
 */
export function useOpeningBalances(clientId: string | undefined) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [date, setDate] = useState('');
  const [mode, setMode] = useState<OpeningMode>('OPENING_BALANCE');
  const [memo, setMemo] = useState(DEFAULT_OPENING_MEMO);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bankValues, setBankValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [plugId, setPlugId] = useState('');
  /** Algo foi editado nesta visita (o rascunho pode ter diferença a salvar sem edição: banco importado com saldo). */
  const [touched, setTouched] = useState(false);

  const hydrate = useCallback((data: Loaded) => {
    const { saved, banks } = data;
    setLoaded(data);
    setDate(saved?.date ?? defaultOpeningDate(banks, data.firstStatement));
    // Documento anterior ao tipo de implantação: implantação com balanço anterior, como era.
    setMode(saved ? openingModeOf(saved) : 'OPENING_BALANCE');
    setMemo(saved?.memo ?? DEFAULT_OPENING_MEMO);
    setValues(Object.fromEntries((saved?.entries ?? []).map((e) => [e.accountId, toMoneyInput(e.amount)])));
    setBankValues(Object.fromEntries(banks.map((b) => [b.id, toMoneyInput(b.openingBalance)])));
    setError(null);
    setSavedAt(null);
    setTouched(false);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([
      repo.listAccounts(clientId),
      repo.listBankAccounts(clientId),
      repo.getOpeningBalances(clientId),
      repo.listImportBatches(clientId),
      repo.getLockState(clientId),
      repo.listPeriodLocks(clientId),
    ])
      .then(([accounts, banks, saved, batches, lockState, locks]) => {
        if (!active) return;
        const firstStatement = batches.map((b) => b.startDate).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
        hydrate({ id: clientId, accounts, banks, saved, lockState, locks, firstStatement });
      })
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'abertura', op: 'carregar' });
        setError(`Não foi possível carregar os saldos de abertura (${describeError(e)}).`);
      });
    return () => {
      active = false;
    };
  }, [clientId, hydrate]);

  const ready = loaded?.id === clientId ? loaded : null;
  const accounts = useMemo(() => ready?.accounts ?? [], [ready]);
  const banks = useMemo(() => ready?.banks ?? [], [ready]);
  const frozen = ready ? isOpeningFrozen(ready.saved, ready.lockState) : false;
  const lockedMonths = useMemo(() => (ready?.locks ?? []).map((l) => l.month).sort(), [ready]);

  /** Valores digitados nas contas: os válidos e positivos entram; os inválidos ficam marcados. */
  const parsed = useMemo(() => {
    const entries: { accountId: string; amount: number }[] = [];
    const invalid = new Set<string>();
    for (const [accountId, text] of Object.entries(values)) {
      const n = parseMoneyInput(text);
      if (n === null) invalid.add(accountId);
      else if (n > 0) entries.push({ accountId, amount: n });
    }
    return { entries, invalid, amounts: new Map(entries.map((e) => [e.accountId, e.amount] as const)) };
  }, [values]);

  /** Bancos como ficam ao salvar: saldo digitado e a data da abertura. Campo vazio num banco sem saldo não mexe nele. */
  const bankDrafts = useMemo(() => {
    const invalid = new Set<string>();
    const next = banks.map((b): BankAccount => {
      const text = bankValues[b.id] ?? '';
      if (!text.trim() && b.openingBalance === undefined) return b;
      const n = parseSignedMoneyInput(text);
      if (n === null) {
        invalid.add(b.id);
        return b;
      }
      return { ...b, openingBalance: n, openingDate: date };
    });
    const changed = next.filter((b, i) => b.openingBalance !== banks[i].openingBalance || b.openingDate !== banks[i].openingDate);
    return { next, changed, invalid };
  }, [banks, bankValues, date]);

  const summary = useMemo(() => summarizeOpening(parsed.entries, accounts, bankDrafts.next), [parsed.entries, accounts, bankDrafts.next]);
  const plug = mode === 'OPENING_BALANCE' ? openingPlug(summary) : null;

  const dirty = useMemo(() => {
    const saved = ready?.saved;
    if (bankDrafts.changed.length > 0) return true;
    if (!saved) return parsed.entries.length > 0 || bankDrafts.next.some((b) => b.openingBalance !== undefined);
    if (saved.date !== date || openingModeOf(saved) !== mode || (saved.memo ?? DEFAULT_OPENING_MEMO) !== memo) return true;
    const a = new Map(saved.entries.map((e) => [e.accountId, e.amount] as const));
    return a.size !== parsed.entries.length || parsed.entries.some((e) => a.get(e.accountId) !== e.amount);
  }, [ready, parsed.entries, bankDrafts, date, mode, memo]);

  const setValue = useCallback((accountId: string, text: string) => {
    setTouched(true);
    setValues((v) => ({ ...v, [accountId]: text }));
  }, []);
  const setBankValue = useCallback((bankId: string, text: string) => {
    setTouched(true);
    setBankValues((v) => ({ ...v, [bankId]: text }));
  }, []);
  const editDate = useCallback((next: string) => {
    setTouched(true);
    setDate(next);
  }, []);
  const editMode = useCallback((next: OpeningMode) => {
    setTouched(true);
    setMode(next);
  }, []);
  const editMemo = useCallback((next: string) => {
    setTouched(true);
    setMemo(next);
  }, []);

  /** Conta adicionada à lista ("+ adicionar conta"): fica à vista, mesmo vazia, até recarregar. */
  const pinAccount = useCallback((accountId: string) => setValues((v) => (accountId in v ? v : { ...v, [accountId]: '' })), []);

  /** Ao sair do campo: valor válido volta formatado ("1500" → "1.500,00"); inválido fica como está, marcado. */
  const normalizeValue = useCallback(
    (accountId: string) =>
      setValues((v) => {
        const n = parseMoneyInput(v[accountId] ?? '');
        if (n === null || n <= 0) return v;
        const text = formatMoneyInput(n);
        return text === v[accountId] ? v : { ...v, [accountId]: text };
      }),
    []
  );
  const normalizeBankValue = useCallback(
    (bankId: string) =>
      setBankValues((v) => {
        const raw = v[bankId] ?? '';
        const n = parseSignedMoneyInput(raw);
        // Vazio é "não informado"; zero digitado é saldo informado, e vira "0,00".
        if (!raw.trim() || n === null) return v;
        const text = formatMoneyInput(n);
        return text === raw ? v : { ...v, [bankId]: text };
      }),
    []
  );

  /** Balancete colado: preenche (substitui) as contas e os bancos dele; o resto fica como está. */
  const applyImport = useCallback((result: ImportResult) => {
    setTouched(true);
    setValues((v) => {
      const next = { ...v };
      for (const [id, n] of result.values) next[id] = toMoneyInput(n);
      return next;
    });
    setBankValues((v) => {
      const next = { ...v };
      for (const [id, n] of result.bankValues) next[id] = formatMoneyInput(n);
      return next;
    });
  }, []);

  /** Contas de PL que podem receber a diferença na implantação com balanço anterior. */
  const equityAccounts = useMemo(
    () => accounts.filter((a) => a.nature === 'ANALYTIC' && accountKind(a) === 'EQUITY' && a.code !== OPENING_ACCOUNT_CODE),
    [accounts]
  );
  const suggestedPlug = (summary.difference >= 0 ? equityAccounts.find((a) => a.code === '2.3.3.01') : equityAccounts.find((a) => a.code === '2.3.3.02')) ?? equityAccounts[0];
  const plugAccount = equityAccounts.find((a) => a.id === plugId) ?? suggestedPlug;

  /** Implantação com balanço anterior: lança a diferença na conta de PL escolhida, para a abertura fechar. */
  const plugInto = () => {
    if (!plugAccount || summary.balanced) return;
    const current = parseMoneyInput(values[plugAccount.id] ?? '') ?? 0;
    // Retificadora de PL (ex.: prejuízos acumulados) reduz o PL: o sinal do ajuste se inverte.
    const next = round2(current + (isContraAccount(plugAccount) ? -1 : 1) * summary.difference);
    if (next < 0) {
      setError(`Não dá para ajustar ${plugAccount.code} ${plugAccount.name}: o valor ficaria negativo. Escolha outra conta de patrimônio líquido.`);
      return;
    }
    setError(null);
    setValue(plugAccount.id, toMoneyInput(next));
  };

  const save = async () => {
    if (!clientId || !ready || frozen) return;
    const problem = openingSaveProblem({ mode, date, summary, invalidAccounts: parsed.invalid.size, invalidBanks: bankDrafts.invalid.size });
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      const actor = getActor();
      const now = new Date().toISOString();
      const byId = new Map(accounts.map((a) => [a.id, a] as const));
      // Balanço de abertura: a 2.3.3.04 (e os grupos dela) entram no plano se faltarem.
      const created = mode === 'OPENING_BALANCE' ? missingOpeningAccounts(clientId, accounts, now) : [];
      const balances: OpeningBalances = {
        id: clientId,
        clientId,
        date,
        mode,
        memo: memo.trim() || DEFAULT_OPENING_MEMO,
        entries: parsed.entries.map((e) => ({ ...e, accountCode: byId.get(e.accountId)?.code, accountName: byId.get(e.accountId)?.name })),
        updatedAt: now,
        updatedByUid: actor.uid,
      };
      const changedBanks = bankDrafts.changed.map((b) => ({ ...b, updatedAt: now }));
      const tail = plug
        ? ` · ${OPENING_ACCOUNT_CODE} ${plug.nature === 'C' ? 'credora' : 'devedora'} ${formatCurrency(plug.amount)}`
        : summary.balanced
          ? ''
          : ` · a detalhar ${formatCurrency(summary.difference)}`;
      await getRepository().saveOpeningBalances(
        balances,
        {
          id: newAuditId(),
          clientId,
          action: 'OPENING_SAVE',
          actorUid: actor.uid,
          ...(actor.email ? { actorEmail: actor.email } : {}),
          at: now,
          note: `${mode === 'OPENING_BALANCE' ? 'Balanço de abertura' : 'Implantação de saldos'} em ${date} · ${parsed.entries.length} conta(s), ${changedBanks.length} banco(s) · ativo ${formatCurrency(summary.assets + summary.banks)} · passivo + PL ${formatCurrency(summary.liabilities + summary.equity)}${tail}`,
        },
        { bankAccounts: changedBanks, accounts: created }
      );
      const seq = ready.lockState?.seq;
      const stampedOpening = seq !== undefined ? { ...balances, lockSeq: seq } : balances;
      const stampedCreated = seq !== undefined ? created.map((a) => (a.clientId === 'global' ? a : { ...a, lockSeq: seq })) : created;
      const savedBanks = new Map(changedBanks.map((b) => [b.id, seq !== undefined ? { ...b, lockSeq: seq } : b] as const));
      setLoaded({
        ...ready,
        saved: stampedOpening,
        accounts: [...accounts, ...stampedCreated],
        banks: banks.map((b) => savedBanks.get(b.id) ?? b),
      });
      setSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      setTouched(false);
    } catch (e) {
      reportError(e, { area: 'abertura', op: 'salvar' });
      setSavedAt(null);
      setError(`Não foi possível salvar; nada foi gravado (${describeError(e)}).`);
    } finally {
      setSaving(false);
    }
  };

  return {
    ready,
    accounts,
    banks,
    frozen,
    lockedMonths,
    date,
    setDate: editDate,
    mode,
    setMode: editMode,
    memo,
    setMemo: editMemo,
    values,
    setValue,
    pinAccount,
    normalizeValue,
    bankValues,
    setBankValue,
    normalizeBankValue,
    applyImport,
    parsed,
    bankDrafts,
    summary,
    plug,
    dirty,
    /** Implantação com balanço anterior que não fecha: o Salvar fica bloqueado. */
    divergent: mode === 'CONTINUITY' && !summary.balanced,
    /** Alterações feitas nesta visita e ainda não salvas: as que o aviso ao sair protege. */
    unsaved: dirty && touched,
    saving,
    error,
    savedAt,
    equityAccounts,
    plugAccount,
    setPlugId,
    plugInto,
    save,
  };
}
