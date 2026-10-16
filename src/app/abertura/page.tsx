'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Scale, Wallet } from 'lucide-react';
import type { BankAccount, ChartAccount, OpeningBalances, OpeningMode } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { DEFAULT_OPENING_MEMO, OPENING_ACCOUNT_CODE, accountKind, isContraAccount, openingSign, type AccountKind } from '@/lib/ledger';
import {
  OPENING_MODE_LABEL,
  defaultOpeningDate,
  describePlug,
  missingOpeningAccounts,
  openingAccounts,
  openingModeOf,
  openingPlug,
  parseMoneyInput,
  parseSignedMoneyInput,
  summarizeOpening,
} from '@/lib/opening';
import { isISODate } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';
import { round2 } from '@/lib/money';
import { TableSkeleton } from '@/components/ui/Skeleton';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
const toInput = (n: number | undefined) => (n ? n.toFixed(2).replace('.', ',') : '');

const SECTIONS: { kind: AccountKind; title: string; hint: string }[] = [
  { kind: 'ASSET', title: 'Ativo', hint: 'Clientes a receber, estoque, imobilizado… Retificadoras ((-) Depreciação Acumulada) entram a crédito e reduzem o ativo.' },
  { kind: 'LIABILITY', title: 'Passivo', hint: 'Fornecedores, impostos e DAS em aberto, obrigações trabalhistas, empréstimos.' },
  { kind: 'EQUITY', title: 'Patrimônio líquido', hint: 'Capital subscrito, reservas e lucros ou prejuízos acumulados. (-) Capital a Integralizar entra a débito.' },
];

const MODE_HINT: Record<OpeningMode, string> = {
  OPENING_BALANCE:
    'A empresa começa a escrituração sem balanço anterior. Informe os saldos conhecidos; a diferença entre débitos e créditos vai, como contrapartida, para a conta 2.3.3.04 Balanço de Abertura.',
  CONTINUITY: 'A empresa já tinha contabilidade e traz um balanço fechado (ativo = passivo + PL). Débitos e créditos precisam fechar pelos saldos informados.',
};

interface Loaded {
  id: string;
  accounts: ChartAccount[];
  banks: BankAccount[];
  saved: OpeningBalances | null;
  firstStatement: string | null;
}

export default function AberturaPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [date, setDate] = useState('');
  const [mode, setMode] = useState<OpeningMode>('OPENING_BALANCE');
  const [memo, setMemo] = useState(DEFAULT_OPENING_MEMO);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bankValues, setBankValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [plugId, setPlugId] = useState('');

  const hydrate = useCallback((data: Loaded) => {
    const { saved, banks } = data;
    setLoaded(data);
    setDate(saved?.date ?? defaultOpeningDate(banks, data.firstStatement));
    // Documento anterior ao tipo de implantação: implantação com balanço anterior, como era.
    setMode(saved ? openingModeOf(saved) : 'OPENING_BALANCE');
    setMemo(saved?.memo ?? DEFAULT_OPENING_MEMO);
    setValues(Object.fromEntries((saved?.entries ?? []).map((e) => [e.accountId, toInput(e.amount)])));
    setBankValues(Object.fromEntries(banks.map((b) => [b.id, toInput(b.openingBalance)])));
    setError(null);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listAccounts(clientId), repo.listBankAccounts(clientId), repo.getOpeningBalances(clientId), repo.listImportBatches(clientId)])
      .then(([accounts, banks, saved, batches]) => {
        if (!active) return;
        const firstStatement = batches.map((b) => b.startDate).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
        hydrate({ id: clientId, accounts, banks, saved, firstStatement });
      })
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId, hydrate]);

  const ready = loaded?.id === clientId ? loaded : null;
  const accounts = useMemo(() => ready?.accounts ?? [], [ready]);
  const banks = useMemo(() => ready?.banks ?? [], [ready]);
  const rows = useMemo(() => openingAccounts(accounts, banks), [accounts, banks]);

  const parsed = useMemo(() => {
    const entries: { accountId: string; amount: number }[] = [];
    const invalid = new Set<string>();
    for (const [accountId, text] of Object.entries(values)) {
      const n = parseMoneyInput(text);
      if (n === null) invalid.add(accountId);
      else if (n > 0) entries.push({ accountId, amount: n });
    }
    return { entries, invalid };
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

  const term = search.trim().toLowerCase();
  const visible = (kind: AccountKind) =>
    rows.filter(
      (a) =>
        accountKind(a) === kind &&
        (!term || `${a.code} ${a.name}`.toLowerCase().includes(term)) &&
        (!onlyFilled || (parseMoneyInput(values[a.id] ?? '') ?? 1) > 0)
    );

  const equityRows = rows.filter((a) => accountKind(a) === 'EQUITY');
  const suggestedPlug = (summary.difference >= 0 ? equityRows.find((a) => a.code === '2.3.3.01') : equityRows.find((a) => a.code === '2.3.3.02')) ?? equityRows[0];
  const plugAccount = equityRows.find((a) => a.id === plugId) ?? suggestedPlug;

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
    setValues((v) => ({ ...v, [plugAccount.id]: toInput(next) }));
  };

  const save = async () => {
    if (!clientId || !ready) return;
    if (!isISODate(date)) return setError('Informe a data do balanço de abertura.');
    if (parsed.invalid.size) return setError('Há valores inválidos nas contas (use números positivos, como 1.234,56).');
    if (bankDrafts.invalid.size) return setError('Há saldos de banco inválidos (use números como 1.234,56 ou -250,00 para saldo devedor).');
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
      const savedBanks = new Map(changedBanks.map((b) => [b.id, b] as const));
      setLoaded({ ...ready, saved: balances, accounts: [...accounts, ...created], banks: banks.map((b) => savedBanks.get(b.id) ?? b) });
      setSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      setSavedAt(null);
      setError(`Não foi possível salvar; nada foi gravado (${describe(e)}).`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Balanço de abertura"
        description="Implantação dos saldos no início da escrituração: bancos, clientes, fornecedores, impostos, imobilizado e capital. Com eles o balanço patrimonial sai completo, não só com os bancos."
        actions={
          <button type="button" disabled={!ready || saving || !dirty} onClick={() => void save()} className={BUTTON.accent}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        }
      />
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 text-[13px] text-rose-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {savedAt && !dirty && !error && (
        <p role="status" className="flex items-center gap-2 text-[13px] text-emerald-700">
          <CheckCircle2 className="w-4 h-4" /> Abertura salva às {savedAt}: saldos, bancos e auditoria gravados juntos.
        </p>
      )}

      {!ready ? (
        <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
          <TableSkeleton rows={8} label="Carregando saldos de abertura…" />
        </section>
      ) : rows.length === 0 ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Plano de contas vazio" description="Aplique o modelo de plano de contas (CFC) em Plano de Contas para informar os saldos de abertura." />
        </section>
      ) : (
        <>
          {/* Tipo de implantação */}
          <fieldset className={`${SURFACE} rounded-[22px] p-5 space-y-3`}>
            <legend className="sr-only">Tipo de implantação</legend>
            <p className="text-[14px] font-semibold tracking-tight">Tipo de implantação</p>
            <div className="grid gap-3 grid-cols-2">
              {(['OPENING_BALANCE', 'CONTINUITY'] as const).map((m) => (
                <label
                  key={m}
                  className={`flex gap-3 rounded-2xl border px-4 py-3 cursor-pointer transition-colors ${
                    mode === m ? 'border-accent bg-accent/[0.04]' : 'border-black/[0.08] dark:border-white/[0.1] hover:bg-black/[0.02]'
                  }`}
                >
                  <input type="radio" name="opening-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-stone-900 dark:text-stone-100">{OPENING_MODE_LABEL[m]}</span>
                    <span className="block text-[12px] text-stone-500">{MODE_HINT[m]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Data, resumo e fechamento */}
          <section className={`${SURFACE} rounded-[22px] p-5 grid gap-5 grid-cols-[240px_1fr] items-start`}>
            <div className="space-y-4">
              <Field label="Data do balanço de abertura" hint="Posição no início do dia. Os lançamentos do extrato e os manuais contam a partir dela, inclusive.">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
              </Field>
              {mode === 'OPENING_BALANCE' && (
                <Field label="Histórico no Diário">
                  <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} className={INPUT} />
                </Field>
              )}
            </div>
            <div className="space-y-3">
              <dl className="grid grid-cols-4 gap-3 text-[13px]">
                {[
                  ['Ativo (contas)', summary.assets],
                  ['Bancos', summary.banks],
                  ['Passivo', summary.liabilities],
                  ['Patrimônio líquido', summary.equity],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-2.5">
                    <dt className="text-[11px] text-stone-500">{label}</dt>
                    <dd className="font-mono tabular-nums text-[15px] font-medium">{formatCurrency(v as number)}</dd>
                  </div>
                ))}
              </dl>
              {mode === 'OPENING_BALANCE' ? (
                <p className="flex items-start gap-2 text-[13px] text-emerald-700">
                  <Scale className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {plug ? (
                      <>
                        <b className="font-medium">{describePlug(plug)}</b>. Débitos = créditos: a abertura fecha.
                      </>
                    ) : (
                      'Débitos = créditos sem contrapartida: ativo = passivo + patrimônio líquido.'
                    )}
                  </span>
                </p>
              ) : summary.balanced ? (
                <p className="flex items-center gap-2 text-[13px] text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" /> A abertura fecha: ativo = passivo + patrimônio líquido.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-[13px] text-amber-700">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Falta detalhar <b className="font-mono tabular-nums">{formatCurrency(Math.abs(summary.difference))}</b>{' '}
                      {summary.difference > 0 ? '(ativo maior que passivo + PL)' : '(passivo + PL maior que o ativo)'}. O balanço anterior precisa fechar; enquanto
                      isso, o balanço mostra a diferença em “Saldos de abertura (a detalhar)”.
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Conta de patrimônio líquido para a diferença"
                      value={plugAccount?.id ?? ''}
                      onChange={(e) => setPlugId(e.target.value)}
                      className={`${INPUT} h-9 w-auto max-w-full text-[13px]`}
                    >
                      {equityRows.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={plugInto} className={`${BUTTON.secondary} h-9`}>
                      Lançar a diferença nesta conta
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Bancos: saldo inicial editável, gravado na data da abertura */}
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <div className="px-5 py-3.5 border-b border-black/[0.04] dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-stone-400" />
                <h2 className="text-[14px] font-semibold tracking-tight">Bancos</h2>
              </div>
              <p className="text-[12px] text-stone-500">
                Saldo de cada conta no início do dia {isISODate(date) ? formatDateBR(date) : 'da abertura'}. Ao salvar, a data do saldo inicial de cada banco passa a ser a
                da abertura. Saldo devedor (cheque especial): use o sinal de menos.
              </p>
            </div>
            {banks.length === 0 ? (
              <p className="px-5 py-5 text-[12px] text-stone-500">Nenhuma conta bancária cadastrada. Importe um extrato OFX para cadastrá-la.</p>
            ) : (
              <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                {banks.map((b) => {
                  const bad = bankDrafts.invalid.has(b.id);
                  const moves = b.openingDate && isISODate(date) && b.openingDate !== date && b.openingBalance !== undefined;
                  return (
                    <li key={b.id} className="flex items-center gap-3 px-5 py-2">
                      <label htmlFor={`bank-${b.id}`} className="flex-1 min-w-0 text-[13px] text-stone-800 dark:text-stone-200">
                        <span className="block truncate">{b.nickname}</span>
                        <span className="block text-[11px] text-stone-400">
                          {b.ledgerAccountCode ? `${b.ledgerAccountCode} ${b.ledgerAccountName ?? ''}` : 'sem conta contábil vinculada'}
                          {moves && <span className="text-amber-700"> · saldo hoje em {formatDateBR(b.openingDate)}, passa a {formatDateBR(date)} ao salvar</span>}
                        </span>
                      </label>
                      <div className="w-40 shrink-0">
                        <input
                          id={`bank-${b.id}`}
                          value={bankValues[b.id] ?? ''}
                          onChange={(e) => setBankValues((v) => ({ ...v, [b.id]: e.target.value }))}
                          placeholder={b.openingBalance === undefined ? 'não informado' : '0,00'}
                          aria-invalid={bad}
                          className={`${INPUT} h-9 text-right font-mono tabular-nums text-[13px] ${bad ? 'border-rose-300' : ''}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="flex items-center gap-3">
            <SearchField value={search} onChange={setSearch} placeholder="Buscar conta por código ou nome" className="flex-1" />
            <label className="flex items-center gap-2 text-[13px] text-stone-600">
              <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> Só as preenchidas
            </label>
          </div>

          {SECTIONS.map(({ kind, title, hint }) => {
            const list = visible(kind);
            return (
              <section key={kind} className={`${SURFACE} rounded-[22px] overflow-hidden`}>
                <div className="px-5 py-3.5 border-b border-black/[0.04] dark:border-white/[0.06]">
                  <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
                  <p className="text-[12px] text-stone-500">{hint}</p>
                </div>
                {list.length === 0 ? (
                  <p className="px-5 py-5 text-[13px] text-stone-400">Nenhuma conta {term || onlyFilled ? 'neste filtro' : 'neste grupo'}.</p>
                ) : (
                  <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                    {list.map((a) => {
                      const bad = parsed.invalid.has(a.id);
                      const contra = isContraAccount(a);
                      return (
                        <li key={a.id} className="flex items-center gap-3 px-5 py-2">
                          <span className="w-28 shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{a.code}</span>
                          <label htmlFor={`op-${a.id}`} className="flex-1 min-w-0 truncate text-[13px] text-stone-800 dark:text-stone-200" title={a.name}>
                            {a.name}
                            {contra && (
                              <span className="ml-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] px-2 py-0.5 text-[11px] text-stone-500">
                                retificadora · a {openingSign(a) > 0 ? 'débito' : 'crédito'}
                              </span>
                            )}
                          </label>
                          <div className="w-40 shrink-0">
                            <input
                              id={`op-${a.id}`}
                              value={values[a.id] ?? ''}
                              onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
                              placeholder="0,00"
                              aria-invalid={bad}
                              className={`${INPUT} h-9 text-right font-mono tabular-nums text-[13px] ${bad ? 'border-rose-300' : ''}`}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
