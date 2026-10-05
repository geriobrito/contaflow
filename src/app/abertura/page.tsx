'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';
import type { BankAccount, ChartAccount, OpeningBalances } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { getActor } from '@/lib/data/scope';
import { newAuditId } from '@/lib/audit';
import { accountKind, type AccountKind } from '@/lib/ledger';
import { openingAccounts, parseMoneyInput, summarizeOpening } from '@/lib/opening';
import { isISODate } from '@/lib/periods';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
const toInput = (n: number) => (n ? n.toFixed(2).replace('.', ',') : '');

const SECTIONS: { kind: AccountKind; title: string; hint: string }[] = [
  { kind: 'ASSET', title: 'Ativo', hint: 'Clientes a receber, estoque, imobilizado… Retificadoras (depreciação) reduzem o ativo.' },
  { kind: 'LIABILITY', title: 'Passivo', hint: 'Fornecedores, obrigações trabalhistas e fiscais, empréstimos.' },
  { kind: 'EQUITY', title: 'Patrimônio líquido', hint: 'Capital social, reservas e lucros ou prejuízos acumulados.' },
];

export default function AberturaPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [loaded, setLoaded] = useState<{ id: string; accounts: ChartAccount[]; banks: BankAccount[]; saved: OpeningBalances | null } | null>(null);
  const [date, setDate] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [plugId, setPlugId] = useState('');

  const hydrate = useCallback((id: string, accounts: ChartAccount[], banks: BankAccount[], saved: OpeningBalances | null) => {
    const bankDates = banks.map((b) => b.openingDate).filter((d): d is string => Boolean(d)).sort();
    const fallback = bankDates[0] ?? `${new Date().getFullYear() - 1}-12-31`;
    setLoaded({ id, accounts, banks, saved });
    setDate(saved?.date ?? fallback);
    setValues(Object.fromEntries((saved?.entries ?? []).map((e) => [e.accountId, toInput(e.amount)])));
    setError(null);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listAccounts(clientId), repo.listBankAccounts(clientId), repo.getOpeningBalances(clientId)])
      .then(([accounts, banks, saved]) => active && hydrate(clientId, accounts, banks, saved))
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId, hydrate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

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
  const summary = useMemo(() => summarizeOpening(parsed.entries, accounts, banks), [parsed.entries, accounts, banks]);
  const dirty = useMemo(() => {
    const saved = ready?.saved;
    if (!saved) return parsed.entries.length > 0;
    if (saved.date !== date) return true;
    const a = new Map(saved.entries.map((e) => [e.accountId, e.amount] as const));
    return a.size !== parsed.entries.length || parsed.entries.some((e) => a.get(e.accountId) !== e.amount);
  }, [ready, parsed.entries, date]);

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

  /** Lança a diferença na conta de PL escolhida, para a abertura fechar. */
  const plug = () => {
    if (!plugAccount || summary.balanced) return;
    const current = parseMoneyInput(values[plugAccount.id] ?? '') ?? 0;
    // Retificadora de PL (ex.: prejuízos acumulados) reduz o PL: o sinal do ajuste se inverte.
    const next = Math.round((current + (plugAccount.isContra ? -1 : 1) * summary.difference) * 100) / 100;
    if (next < 0) {
      setError(`Não dá para ajustar ${plugAccount.code} ${plugAccount.name}: o valor ficaria negativo. Escolha outra conta de patrimônio líquido.`);
      return;
    }
    setError(null);
    setValues((v) => ({ ...v, [plugAccount.id]: toInput(next) }));
  };

  const save = async () => {
    if (!clientId || !ready) return;
    if (!isISODate(date)) return setError('Informe a data do saldo de abertura.');
    if (parsed.invalid.size) return setError('Há valores inválidos (use números positivos, como 1.234,56).');
    setSaving(true);
    setError(null);
    try {
      const actor = getActor();
      const now = new Date().toISOString();
      const byId = new Map(accounts.map((a) => [a.id, a] as const));
      const balances: OpeningBalances = {
        id: clientId,
        clientId,
        date,
        entries: parsed.entries.map((e) => ({ ...e, accountCode: byId.get(e.accountId)?.code, accountName: byId.get(e.accountId)?.name })),
        updatedAt: now,
        updatedByUid: actor.uid,
      };
      await getRepository().saveOpeningBalances(balances, {
        id: newAuditId(),
        clientId,
        action: 'OPENING_SAVE',
        actorUid: actor.uid,
        ...(actor.email ? { actorEmail: actor.email } : {}),
        at: now,
        note: `${parsed.entries.length} conta(s) em ${date} · ativo ${formatCurrency(summary.assets + summary.banks)} · passivo + PL ${formatCurrency(summary.liabilities + summary.equity)}${
          summary.balanced ? '' : ` · a detalhar ${formatCurrency(summary.difference)}`
        }`,
      });
      setLoaded({ ...ready, saved: balances });
      setToast('Saldos de abertura salvos');
    } catch (e) {
      setError(`Não foi possível salvar (${describe(e)}).`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Saldos de abertura"
        description="Posição das contas patrimoniais no início da escrituração (clientes, fornecedores, estoque, imobilizado, capital…). Com eles o balanço patrimonial sai completo, não só com os bancos."
        actions={
          <button type="button" disabled={!ready || saving || !dirty} onClick={() => void save()} className={BUTTON.accent}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        }
      />
      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

      {!ready ? (
        <p className="py-16 text-center text-[13px] text-stone-400">Carregando…</p>
      ) : rows.length === 0 ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState title="Plano de contas vazio" description="Aplique o modelo ITG 1000 em Plano de Contas para informar os saldos de abertura." />
        </section>
      ) : (
        <>
          {/* Resumo e equilíbrio */}
          <section className={`${SURFACE} rounded-[22px] p-5 grid gap-5 lg:grid-cols-[minmax(0,220px)_1fr] items-start`}>
            <Field label="Saldo em" hint="Normalmente o último dia do exercício anterior">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
            </Field>
            <div className="space-y-3">
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
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
              {summary.balanced ? (
                <p className="flex items-center gap-2 text-[13px] text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" /> A abertura fecha: ativo = passivo + patrimônio líquido.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-[13px] text-amber-700">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Falta detalhar <b className="font-mono tabular-nums">{formatCurrency(Math.abs(summary.difference))}</b>{' '}
                      {summary.difference > 0 ? '(ativo maior que passivo + PL)' : '(passivo + PL maior que o ativo)'}. Enquanto isso, o balanço mostra a diferença em
                      “Saldos de abertura (a detalhar)”.
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
                    <button type="button" onClick={plug} className={`${BUTTON.secondary} h-9`}>
                      Lançar a diferença nesta conta
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Bancos (somente leitura) */}
          <section className={`${SURFACE} rounded-[22px] p-5`}>
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-stone-400" />
              <h2 className="text-[14px] font-semibold tracking-tight">Bancos</h2>
              <a href="/contas" className="ml-auto text-[12px] text-[#0071E3] hover:underline">Editar em Contas e Extratos</a>
            </div>
            {banks.length === 0 ? (
              <p className="text-[12px] text-stone-500">Nenhuma conta bancária cadastrada. Importe um extrato OFX para cadastrá-la.</p>
            ) : (
              <ul className="divide-y divide-black/[0.04] text-[13px]">
                {banks.map((b) => (
                  <li key={b.id} className="flex items-baseline gap-3 py-1.5">
                    <span className="flex-1 min-w-0 truncate">{b.nickname}</span>
                    {b.openingBalance !== undefined ? (
                      <span className="font-mono tabular-nums">
                        {formatCurrency(b.openingBalance)} <span className="text-[11px] text-stone-400">em {formatDateBR(b.openingDate)}</span>
                      </span>
                    ) : (
                      <span className="text-[12px] text-amber-700">saldo inicial não informado</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
                      return (
                        <li key={a.id} className="flex items-center gap-3 px-5 py-2">
                          <span className="w-28 shrink-0 font-mono tabular-nums text-[12px] text-stone-400">{a.code}</span>
                          <label htmlFor={`op-${a.id}`} className="flex-1 min-w-0 truncate text-[13px] text-stone-800 dark:text-stone-200" title={a.name}>
                            {a.name}
                          </label>
                          <div className="w-40 shrink-0">
                            <input
                              id={`op-${a.id}`}
                              inputMode="decimal"
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

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
