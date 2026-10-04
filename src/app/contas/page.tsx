'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Pencil, Plus, Trash2, Type, Wallet } from 'lucide-react';
import type { BankAccount, BankTransaction, ChartAccount, ClassificationRule, ImportBatch, PeriodLock } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { bankBalanceAt, bankLedgerCandidates, suggestOpening } from '@/lib/bank-accounts';
import {
  BANKS_PARENT_CODE,
  applyTextRepair,
  createBankSubaccounts,
  deleteImportBatch,
  ensureBankAccount,
  previewBatchDeletion,
  type BatchDeletionPreview,
} from '@/lib/services/accounting-service';
import { formatMonth } from '@/lib/periods';
import { planTextRepair } from '@/lib/text-repair';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { formatDateTime } from '@/components/conciliacao/AuditTimeline';
import { BalanceCheckBadge } from '@/components/conciliacao/StatementPanel';
import { BUTTON, EmptyState, Field, INPUT, PAGE, PageHeader, SURFACE, Sheet } from '@/components/ui/primitives';

const describe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'erro desconhecido');
const todayISO = () => new Date().toISOString().slice(0, 10);

interface Data {
  accounts: ChartAccount[];
  banks: BankAccount[];
  batches: ImportBatch[];
  transactions: BankTransaction[];
  locks: PeriodLock[];
  rules: ClassificationRule[];
}

/* =========================================================================
   Edição de conta bancária
   ========================================================================= */

function BankAccountSheet({
  bank,
  data,
  onClose,
  onSaved,
}: {
  bank: BankAccount;
  data: Data;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const candidates = useMemo(() => bankLedgerCandidates(data.accounts), [data.accounts]);
  const suggestion = useMemo(() => suggestOpening(data.batches, bank.accountKey), [data.batches, bank.accountKey]);
  const [nickname, setNickname] = useState(bank.nickname);
  const [ledgerId, setLedgerId] = useState(bank.ledgerAccountId ?? '');
  const [opening, setOpening] = useState(bank.openingBalance !== undefined ? String(bank.openingBalance).replace('.', ',') : '');
  const [openingDate, setOpeningDate] = useState(bank.openingDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedOpening = opening.trim() ? Number(opening.replace(/\./g, '').replace(',', '.')) : undefined;
  const openingError = opening.trim() && !Number.isFinite(parsedOpening) ? 'Valor inválido.' : !opening.trim() !== !openingDate ? 'Informe valor e data juntos.' : null;
  const sharedLedger = ledgerId && data.banks.some((b) => b.id !== bank.id && b.ledgerAccountId === ledgerId);
  const parent = data.accounts.find((a) => a.code === BANKS_PARENT_CODE);

  const save = async () => {
    if (openingError || !nickname.trim()) return;
    setBusy(true);
    setError(null);
    const ledger = data.accounts.find((a) => a.id === ledgerId);
    const next: BankAccount = {
      id: bank.id,
      clientId: bank.clientId,
      accountKey: bank.accountKey,
      ...(bank.bankId ? { bankId: bank.bankId } : {}),
      ...(bank.branchId ? { branchId: bank.branchId } : {}),
      ...(bank.accountNumber ? { accountNumber: bank.accountNumber } : {}),
      ...(bank.bankName ? { bankName: bank.bankName } : {}),
      nickname: nickname.trim(),
      ...(ledger ? { ledgerAccountId: ledger.id, ledgerAccountCode: ledger.code, ledgerAccountName: ledger.name } : {}),
      ...(parsedOpening !== undefined && openingDate ? { openingBalance: parsedOpening, openingDate } : {}),
      createdAt: bank.createdAt,
      updatedAt: new Date().toISOString(),
    };
    try {
      await getRepository().saveBankAccount(next);
      await onSaved('Conta bancária atualizada');
    } catch (e) {
      setError(`Não foi possível salvar (${describe(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  const createSubaccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const { created } = await createBankSubaccounts({
        clientId: bank.clientId,
        targets: [{ ...bank, nickname: nickname.trim() || bank.nickname }],
        allBankAccounts: data.banks,
        accounts: data.accounts,
      });
      await onSaved(`Criada(s) ${created.map((a) => `${a.code} ${a.name}`).join(', ')}`);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Conta bancária"
      subtitle={bank.accountKey}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{error}</p>}
          <button type="button" disabled={busy || Boolean(openingError) || !nickname.trim()} onClick={() => void save()} className={`${BUTTON.accent} w-full h-12 rounded-2xl text-[15px]`}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Nome da conta">
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={INPUT} placeholder="ex.: Itaú movimento" />
        </Field>

        <Field
          label="Conta contábil (ativo)"
          hint={sharedLedger ? 'Outra conta bancária usa a mesma conta contábil: os saldos serão somados no balanço.' : 'Contrapartida bancária de todos os lançamentos deste extrato no balancete e no balanço.'}
        >
          <select value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} className={`${INPUT} ${ledgerId ? '' : 'text-stone-400'}`}>
            <option value="">Sem vínculo</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        {parent && (
          <button type="button" disabled={busy} onClick={() => void createSubaccount()} className={`${BUTTON.secondary} w-full`}>
            <Plus className="w-4 h-4" />
            Criar subconta própria em {parent.code} {parent.name}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Saldo inicial" error={openingError}>
            <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0,00" className={`${INPUT} font-mono tabular-nums`} />
          </Field>
          <Field label="No fim do dia">
            <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
          </Field>
        </div>
        {suggestion && (
          <button
            type="button"
            onClick={() => {
              setOpening(String(suggestion.openingBalance).replace('.', ','));
              setOpeningDate(suggestion.openingDate);
            }}
            className="text-[12px] text-[#0071E3] hover:underline"
          >
            Usar o saldo do primeiro extrato: {formatCurrency(suggestion.openingBalance)} em {formatDateBR(suggestion.openingDate)}
          </button>
        )}
        <p className="text-[12px] text-stone-400">
          Lançamentos até a data do saldo inicial já estão contidos nele e não são somados de novo.
        </p>
      </div>
    </Sheet>
  );
}

/* =========================================================================
   Exclusão de extrato
   ========================================================================= */

function DeleteBatchSheet({
  batch,
  lockedMonths,
  onClose,
  onDeleted,
}: {
  batch: ImportBatch;
  lockedMonths: ReadonlySet<string>;
  onClose: () => void;
  onDeleted: (message: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<BatchDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    previewBatchDeletion(batch, lockedMonths)
      .then((p) => active && setPreview(p))
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [batch, lockedMonths]);

  const blocked = Boolean(preview?.lockedMonths.length);

  const confirm = async () => {
    if (!preview) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteImportBatch(batch, preview, lockedMonths, reason.trim() || undefined);
      await onDeleted(`Extrato ${batch.fileName} excluído · ${preview.transactions.length} lançamento(s) removido(s)`);
    } catch (e) {
      setError(`Não foi possível excluir (${describe(e)}).`);
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Excluir extrato importado"
      subtitle={batch.fileName}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mb-2 text-center text-[12px] text-rose-600">{error}</p>}
          <button
            type="button"
            disabled={!preview || blocked || busy}
            onClick={() => void confirm()}
            className={`w-full h-12 rounded-2xl text-[15px] font-medium text-white transition-all active:scale-[0.98] disabled:opacity-40 ${armed ? 'bg-rose-700' : 'bg-rose-600 hover:bg-rose-700'}`}
          >
            {busy ? 'Excluindo…' : armed ? 'Toque de novo para excluir definitivamente' : 'Excluir extrato e lançamentos'}
          </button>
        </>
      }
    >
      {!preview ? (
        <p className="py-8 text-center text-[13px] text-stone-400">{error ? '' : 'Verificando lançamentos…'}</p>
      ) : (
        <div className="space-y-4 pb-2 text-[13px] text-stone-600 dark:text-stone-300">
          <dl className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] px-4 py-3 space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Período</dt><dd>{batch.startDate ? `${formatDateBR(batch.startDate)} – ${formatDateBR(batch.endDate)}` : '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Lançamentos</dt><dd>{preview.transactions.length}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Já conciliados</dt><dd>{preview.reconciled}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-400">Importado em</dt><dd>{formatDateTime(batch.importedAt)}</dd></div>
          </dl>
          {blocked ? (
            <p role="alert" className="flex gap-2 rounded-2xl px-4 py-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 border border-rose-200/60">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Há lançamentos em competência fechada ({preview.lockedMonths.map((m) => formatMonth(m)).join(', ')}). Reabra a competência na
                Conciliação para excluir este extrato.
              </span>
            </p>
          ) : (
            <>
              <p>
                Os lançamentos deste arquivo serão removidos, inclusive as classificações já feitas. Reimportar o mesmo OFX depois os traz de
                volta como novos.
                {preview.partners > 0 && ` ${preview.partners} transferência(s) com perna em outro extrato voltarão para pendente.`}
              </p>
              <Field label="Motivo" hint="Opcional · fica registrado na auditoria">
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="ex.: importado no cliente errado" />
              </Field>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* =========================================================================
   Página
   ========================================================================= */

export default function ContasPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [data, setData] = useState<Data | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [deleting, setDeleting] = useState<ImportBatch | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    const repo = getRepository();
    const [accounts, banks, batches, transactions, locks, rules] = await Promise.all([
      repo.listAccounts(id),
      repo.listBankAccounts(id),
      repo.listImportBatches(id),
      repo.listTransactions(id),
      repo.listPeriodLocks(id),
      repo.listRules(id),
    ]);
    setData({ accounts, banks, batches, transactions, locks, rules });
    setLoadedFor(id);
    setError(null);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    Promise.resolve()
      .then(() => (active ? load(clientId) : undefined))
      .catch((e: unknown) => active && setError(describe(e)));
    return () => {
      active = false;
    };
  }, [clientId, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = async (message: string) => {
    setEditing(null);
    setDeleting(null);
    setToast(message);
    if (clientId) await load(clientId);
  };

  const lockedMonths = useMemo(() => new Set((data?.locks ?? []).map((l) => l.month)), [data]);
  const current = loadedFor === clientId ? data : null;

  /** Contas vistas em extratos antigos que ainda não têm cadastro. */
  const unregistered = useMemo(() => {
    if (!current) return [];
    const known = new Set(current.banks.map((b) => b.accountKey));
    const byKey = new Map<string, ImportBatch>();
    for (const b of current.batches) if (b.accountKey && !known.has(b.accountKey)) byKey.set(b.accountKey, b);
    return [...byKey.values()];
  }, [current]);

  const register = async (batch: ImportBatch) => {
    if (!clientId || !current || !batch.accountKey) return;
    setBusy(true);
    try {
      await ensureBankAccount({
        clientId,
        accountKey: batch.accountKey,
        account: { bankId: batch.bankId, accountId: batch.accountNumber, org: batch.bankName },
        accounts: current.accounts,
        batches: current.batches,
      });
      await refresh('Conta bancária cadastrada');
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const textPlan = useMemo(
    () => (current && clientId ? planTextRepair(current.transactions, current.rules, clientId, lockedMonths) : null),
    [current, clientId, lockedMonths]
  );

  const repairText = async () => {
    if (!clientId || !textPlan) return;
    setBusy(true);
    setError(null);
    try {
      const done = await applyTextRepair(clientId, textPlan);
      await refresh(
        `Acentuação corrigida · ${done.memos} histórico(s), ${done.rules} regra(s)${done.removedRules ? `, ${done.removedRules} regra(s) duplicada(s) removida(s)` : ''}`
      );
    } catch (e) {
      setError(`Não foi possível corrigir (${describe(e)}).`);
    } finally {
      setBusy(false);
    }
  };

  const today = todayISO();
  const unlinkedTx = current ? current.transactions.filter((t) => !t.accountKey).length : 0;

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Contas e extratos"
        description="Cada conta bancária do cliente ligada à sua conta contábil, com saldo inicial para o balanço, e o histórico dos extratos importados."
      />
      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

      {/* Contas bancárias */}
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/[0.04] dark:border-white/[0.06]">
          <Wallet className="w-4 h-4 text-stone-400" />
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">Contas bancárias</h2>
        </div>
        {!current ? (
          <p className="px-5 py-10 text-center text-[13px] text-stone-400">Carregando…</p>
        ) : current.banks.length === 0 && unregistered.length === 0 ? (
          <EmptyState title="Nenhuma conta bancária" description="As contas são cadastradas automaticamente ao importar um extrato OFX com banco e número de conta." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04]">
                  <th className="font-medium pl-5 pr-3 py-2.5">Conta</th>
                  <th className="font-medium px-3 py-2.5">Conta contábil</th>
                  <th className="font-medium px-3 py-2.5 text-right">Saldo inicial</th>
                  <th className="font-medium px-3 py-2.5 text-right">Saldo contábil</th>
                  <th className="font-medium px-3 py-2.5 text-right">Último saldo do banco</th>
                  <th className="pl-3 pr-5 py-2.5 w-20"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {current.banks.map((b) => {
                  const last = current.batches
                    .filter((x) => x.accountKey === b.accountKey && x.ledgerBalance !== undefined && x.ledgerDate)
                    .sort((x, y) => (y.ledgerDate ?? '').localeCompare(x.ledgerDate ?? ''))[0];
                  const bookAtLast = last?.ledgerDate ? bankBalanceAt(b, current.transactions, last.ledgerDate) : null;
                  const matches = last && bookAtLast !== null && Math.abs(bookAtLast - (last.ledgerBalance ?? 0)) < 0.005;
                  return (
                    <tr key={b.id} className="border-b border-black/[0.04] last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-3">
                        <p className="font-medium text-stone-900 dark:text-stone-100">{b.nickname}</p>
                        <p className="font-mono text-[11px] text-stone-400">{b.accountKey}</p>
                      </td>
                      <td className="px-3 py-3">
                        {b.ledgerAccountId ? (
                          <span className="inline-flex items-center gap-1.5 text-stone-700 dark:text-stone-300">
                            <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="font-mono text-[12px] text-stone-400">{b.ledgerAccountCode}</span> {b.ledgerAccountName}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Sem vínculo contábil</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {b.openingBalance !== undefined ? (
                          <>
                            {formatCurrency(b.openingBalance)}
                            <span className="block text-[11px] text-stone-400">{formatDateBR(b.openingDate)}</span>
                          </>
                        ) : (
                          <span className="text-amber-700 font-sans text-[12px]">não informado</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatCurrency(bankBalanceAt(b, current.transactions, today))}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {last ? (
                          <>
                            {formatCurrency(last.ledgerBalance ?? 0)}
                            <span className={`flex items-center justify-end gap-1 text-[11px] font-sans ${matches ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {matches ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                              {formatDateBR(last.ledgerDate)} ·{' '}
                              {matches ? 'confere' : `contábil ${formatCurrency(bookAtLast ?? 0)}`}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="pl-3 pr-5 py-3 text-right">
                        <button type="button" onClick={() => setEditing(b)} aria-label={`Editar ${b.nickname}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-black/[0.05] active:scale-[0.94] transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {unregistered.map((batch) => (
                  <tr key={batch.accountKey} className="border-b border-black/[0.04] last:border-0 text-[13px] bg-amber-50/40 dark:bg-amber-950/10">
                    <td className="pl-5 pr-3 py-3">
                      <p className="font-mono text-[12px] text-stone-700">{batch.accountKey}</p>
                      <p className="text-[11px] text-stone-400">Encontrada em extratos importados antes do cadastro</p>
                    </td>
                    <td colSpan={4} />
                    <td className="pl-3 pr-5 py-3 text-right">
                      <button type="button" disabled={busy} onClick={() => void register(batch)} className={`${BUTTON.secondary} h-8`}>
                        Cadastrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {current && unlinkedTx > 0 && (
          <p className="px-5 py-3 border-t border-black/[0.04] text-[12px] text-amber-700">
            {unlinkedTx} lançamento(s) vieram de extratos sem identificação de conta e aparecem no balanço como “Bancos sem vínculo contábil”.
          </p>
        )}
      </section>

      {/* Correção de acentuação de importações antigas */}
      {textPlan && textPlan.total > 0 && (
        <section className={`${SURFACE} rounded-[22px] p-5 space-y-3 border-amber-200/70`} aria-label="Correção de acentuação">
          <div className="flex flex-wrap items-start gap-3">
            <span className="w-9 h-9 shrink-0 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 flex items-center justify-center">
              <Type className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-[260px] space-y-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Acentuação quebrada em importações antigas</h2>
              <p className="text-[13px] text-stone-600 dark:text-stone-300">
                {textPlan.memos.length + textPlan.lockedMemos.length} histórico(s) e {textPlan.rules.length + textPlan.duplicateRuleIds.length} regra(s) vieram de arquivos
                UTF-8 lidos como Latin-1 (ex.: “transferÃªncia”, “â€¢â€¢â€¢”). Novas importações já saem corretas; esta correção ajusta o que já está salvo,
                mantém as classificações e atualiza o termo das regras para continuarem casando.
              </p>
              {(textPlan.memos[0] || textPlan.rules[0]) && (
                <p className="font-mono text-[11px] text-stone-500 break-words">
                  {(textPlan.memos[0] ?? textPlan.rules[0]!).before.slice(0, 70)} → {(textPlan.memos[0]?.after ?? textPlan.rules[0]!.after).slice(0, 70)}
                </p>
              )}
              {textPlan.lockedMemos.length > 0 && (
                <p className="text-[12px] text-amber-700">
                  {textPlan.lockedMemos.length} histórico(s) estão em competência fechada e só serão corrigidos depois de reabri-la.
                </p>
              )}
              {textPlan.duplicateRuleIds.length > 0 && (
                <p className="text-[12px] text-stone-500">
                  {textPlan.duplicateRuleIds.length} regra(s) ficarão idênticas a outra (mesmo termo, tipo e conta) e serão removidas, mantendo a mais recente.
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={busy || (!textPlan.memos.length && !textPlan.rules.length && !textPlan.duplicateRuleIds.length)}
              onClick={() => void repairText()}
              className={BUTTON.accent}
            >
              {busy ? 'Corrigindo…' : 'Corrigir acentuação'}
            </button>
          </div>
        </section>
      )}

      {/* Histórico de importações */}
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <div className="px-5 py-4 border-b border-black/[0.04] dark:border-white/[0.06]">
          <h2 className="text-[15px] font-semibold tracking-tight">Histórico de importações</h2>
          <p className="text-[12px] text-stone-500">Excluir um extrato remove os lançamentos dele. Competências fechadas precisam ser reabertas antes.</p>
        </div>
        {!current ? null : current.batches.length === 0 ? (
          <EmptyState title="Nenhum extrato importado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-black/[0.04]">
                  <th className="font-medium pl-5 pr-3 py-2.5">Importado em</th>
                  <th className="font-medium px-3 py-2.5">Arquivo</th>
                  <th className="font-medium px-3 py-2.5">Conta</th>
                  <th className="font-medium px-3 py-2.5">Período</th>
                  <th className="font-medium px-3 py-2.5 text-right">Lançamentos</th>
                  <th className="font-medium px-3 py-2.5">Saldo</th>
                  <th className="pl-3 pr-5 py-2.5 w-14"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {[...current.batches]
                  .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                  .map((b) => (
                    <tr key={b.id} className="border-b border-black/[0.04] last:border-0 text-[13px]">
                      <td className="pl-5 pr-3 py-2.5 font-mono tabular-nums text-[12px] text-stone-500 whitespace-nowrap">{formatDateTime(b.importedAt)}</td>
                      <td className="px-3 py-2.5 max-w-[240px] truncate" title={b.fileName}>{b.fileName}</td>
                      <td className="px-3 py-2.5 text-[12px] text-stone-500">
                        {current.banks.find((x) => x.accountKey === b.accountKey)?.nickname ?? b.accountKey ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-[12px] text-stone-500 whitespace-nowrap">
                        {b.startDate ? `${formatDateBR(b.startDate)} – ${formatDateBR(b.endDate)}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {b.importedCount}
                        {b.duplicateCount > 0 && <span className="text-stone-400"> · {b.duplicateCount} dup.</span>}
                      </td>
                      <td className="px-3 py-2.5"><BalanceCheckBadge check={b.balanceCheck} /></td>
                      <td className="pl-3 pr-5 py-2.5 text-right">
                        <button type="button" onClick={() => setDeleting(b)} aria-label={`Excluir extrato ${b.fileName}`} className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-50 active:scale-[0.94] transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && current && <BankAccountSheet key={editing.id} bank={editing} data={current} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deleting && <DeleteBatchSheet key={deleting.id} batch={deleting} lockedMonths={lockedMonths} onClose={() => setDeleting(null)} onDeleted={refresh} />}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
