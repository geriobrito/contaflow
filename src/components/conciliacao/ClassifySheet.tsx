'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Lock, MessageCircleQuestion, ReceiptText, X } from 'lucide-react';
import type { AuditEntry, BankTransaction, ChartAccount, ClassificationRule, FinancingContract, InvoiceSummary, RuleMatchType, TaxRegime } from '@/types/firestore';
import type { InvoiceMatch } from '@/lib/nfe/match';
import { creditSplitDrafts, ibsCbsCredit } from '@/lib/nfe/credits';
import { describeInvoice, InvoiceMatchCard, LinkedInvoiceNote } from '@/components/conciliacao/InvoiceMatchCard';
import { normalizePattern } from '@/lib/reconciliation';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import { SegmentedControl } from '@/components/ui/primitives';
import { AccountPicker } from '@/components/ui/AccountCombobox';
import { directionOf, orderAccountsByDirection, type AccountSuggestion } from '@/lib/account-suggestions';
import { RuleLearnPanel } from '@/components/conciliacao/RuleLearnPanel';
import { assessRuleTerm, suggestMemoTerm, suggestRuleTerm } from '@/lib/payee';
import { emptySplitDraft, SplitEditor } from '@/components/conciliacao/SplitEditor';
import { StatusBadge } from '@/components/conciliacao/StatusBadge';
import { AuditTimeline } from '@/components/conciliacao/AuditTimeline';
import { invoiceRetentionSplit, newSplitId, splitsToDrafts, summarizeSplits, type InvoiceRetentionSplit, type SplitDraft } from '@/lib/splits';
import { paidNet, retentionParts, simplesRetentionWarning } from '@/lib/nfe/retentions';
import { INVESTMENT_DEFAULT_CODE, irIsExpense, redemptionPresets } from '@/lib/investments';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { floatingPaymentSplit } from '@/lib/financing';
import { ModalPortal } from '@/components/ui/ModalPortal';

/* =========================================================================
   Sheet de classificação: conta única, rateio e histórico (auditoria)
   ========================================================================= */

interface ClassifySheetProps {
  transaction: BankTransaction;
  accounts: ChartAccount[];
  isSaving: boolean;
  onClose: () => void;
  /** `invoiceId`: nota fiscal confirmada como documento do lançamento (casamento aceito). */
  onConfirm: (accountId: string, learnRule: boolean, customPattern: string, matchType: RuleMatchType, invoiceId?: string) => Promise<void>;
  /** `invoiceId`: nota fiscal confirmada como documento do lançamento rateado. */
  onSplit: (drafts: SplitDraft[], invoiceId?: string) => Promise<void>;
  onUnreconcile: () => Promise<void>;
  /** Regras do cliente, para pré-carregar o termo da regra que originou o lançamento. */
  rules: readonly ClassificationRule[];
  /** Competência fechada (ex.: "março de 2025"): o sheet fica somente leitura. */
  lockedMonthLabel?: string | null;
  /** Carrega a trilha de auditoria do lançamento. */
  loadAudit: () => Promise<AuditEntry[]>;
  /** Descrições dos lançamentos carregados, para avaliar se o termo da regra é genérico ou amplo. */
  memoPool?: readonly string[];
  /** Registra (texto) ou remove (vazio) a pergunta ao cliente. Sem a prop, a aba não aparece. */
  onAskClient?: (question: string) => Promise<void>;
  /** Nota fiscal casada com o lançamento (ainda não conciliado), com a conta sugerida. */
  invoiceMatch?: InvoiceMatch | null;
  /** Nota já vinculada ao lançamento conciliado. */
  linkedInvoice?: InvoiceSummary | null;
  /** Regime tributário da empresa: decide se o IBS/CBS da nota de compra vira crédito. */
  regime?: TaxRegime;
  /** Contas sugeridas no topo do seletor (nota, mesmo favorecido, recentes, mais usadas). */
  suggestions?: readonly AccountSuggestion[];
  /** Contratos com juros pós-fixados (parcelamento pela Selic): o pagamento acima da parcela-base vira parcela + juros. */
  floatingContracts?: readonly FinancingContract[];
  /** Contas das aplicações financeiras cadastradas: a entrada nelas é resgate (bruto × líquido com IR e IOF). */
  investmentAccountIds?: readonly string[];
  /** Aba inicial quando aberto por atalho (ex.: 'split' pela tecla S). */
  initialMode?: SheetMode;
  /** Abre a gaveta de detalhes completos da nota fiscal casada ou vinculada. */
  onViewInvoice?: (invoice: InvoiceSummary) => void;
}

export type SheetMode = 'single' | 'split' | 'ask' | 'history';

/** Pergunta sugerida: data, valor e histórico, para o cliente reconhecer o lançamento. */
const defaultQuestion = (t: BankTransaction) =>
  `O que é o lançamento de ${formatCurrency(Math.abs(t.amount))} em ${formatDateBR(t.date)} (“${t.memo}”)? Informe do que se trata (ex.: fornecedor, serviço, número da nota).`;


/** NFS-e casada com retenções: o líquido caiu no banco; propõe o bruto × líquido pela nota. */
function RetentionNotice({
  invoice,
  regime,
  split,
  hasAccount,
  onApply,
}: {
  invoice: InvoiceSummary;
  regime?: TaxRegime;
  split: InvoiceRetentionSplit;
  hasAccount: boolean;
  onApply: () => void;
}) {
  const parts = retentionParts(invoice.retentions);
  const totalCents = parts.reduce((s, p) => s + p.cents, 0);
  const simples = simplesRetentionWarning(invoice, regime);
  const receipt = invoice.direction === 'SALE';
  return (
    <div role="status" className="rounded-2xl border border-sky-200/70 bg-sky-50/80 dark:bg-sky-950/25 dark:border-sky-800/40 px-3.5 py-3 text-[12px] text-sky-900 dark:text-sky-200 space-y-2">
      <p>
        A nota tem {formatCurrency(totalCents / 100)} de retenções ({parts.map((p) => `${p.label} ${formatCurrency(p.cents / 100)}`).join('; ')}). O extrato traz o líquido:{' '}
        {receipt ? 'a receita entra pelo bruto e o retido fica a recuperar.' : 'a despesa entra pelo bruto e o retido fica a recolher.'}
      </p>
      {simples && <p className="text-amber-800 dark:text-amber-300">{simples}</p>}
      {split.missingCodes.length > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          Conta {split.missingCodes.join(', ')} fora do plano: inclua pelo Plano de Contas (completar com o modelo).
          {split.drafts ? ' Por ora, o valor vai para 1.1.2.05 Tributos a Recuperar.' : ''}
        </p>
      )}
      {split.otherCents > 0 && <p>{formatCurrency(split.otherCents / 100)} da diferença não está discriminado na nota: inclua a linha à mão no rateio.</p>}
      <button
        type="button"
        disabled={!hasAccount || !split.drafts}
        onClick={onApply}
        className="rounded-lg bg-sky-700 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-sky-800 disabled:opacity-40 active:scale-[0.97] transition-all duration-150"
      >
        Lançar com as retenções da nota
      </button>
      {!hasAccount && <p className="text-[11px] text-sky-800/80 dark:text-sky-300/80">Escolha antes a conta do valor bruto ({receipt ? 'a receita' : 'a despesa'}).</p>}
    </div>
  );
}

export function ClassifySheet({
  transaction,
  accounts,
  isSaving,
  onClose,
  onConfirm,
  onSplit,
  onUnreconcile,
  rules,
  lockedMonthLabel,
  loadAudit,
  onAskClient,
  memoPool = [],
  invoiceMatch,
  linkedInvoice,
  regime,
  suggestions,
  floatingContracts,
  investmentAccountIds,
  initialMode,
  onViewInvoice,
}: ClassifySheetProps) {
  const locked = Boolean(lockedMonthLabel);
  const isEditing = transaction.status !== 'PENDING';
  const sourceRule = transaction.matchedRuleId ? rules.find((r) => r.id === transaction.matchedRuleId) : undefined;
  const [confirmUndo, setConfirmUndo] = useState(false);


  useEffect(() => {
    if (!confirmUndo) return;
    const t = setTimeout(() => setConfirmUndo(false), 3500);
    return () => clearTimeout(t);
  }, [confirmUndo]);

  const [mode, setMode] = useState<SheetMode>(
    locked ? 'history' : initialMode ?? (transaction.isSplit ? 'split' : 'single')
  );
  /** Atalho "bruto × líquido" da conta única: o rateio abre já no painel de retenções. */
  const [grossNetFirst, setGrossNetFirst] = useState(false);
  /** O bruto × líquido é de resgate de aplicação (IR e IOF), não de nota. */
  const [redemption, setRedemption] = useState(false);
  const openQuery = transaction.clientQuery?.status === 'OPEN' ? transaction.clientQuery : undefined;
  const [question, setQuestion] = useState(openQuery?.question ?? defaultQuestion(transaction));
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  // Carrega a trilha na primeira vez que a aba Histórico é aberta.
  useEffect(() => {
    if (mode !== 'history' || audit !== null) return;
    let active = true;
    loadAudit()
      .then((entries) => active && setAudit(entries))
      .catch((e: unknown) => active && setAuditError(e instanceof Error ? e.message : 'Falha ao carregar o histórico.'));
    return () => {
      active = false;
    };
  }, [mode, audit, loadAudit]);
  const [drafts, setDrafts] = useState<SplitDraft[]>(() =>
    transaction.isSplit && transaction.splits?.length ? splitsToDrafts(transaction.splits, transaction.amount) : [emptySplitDraft(), emptySplitDraft()]
  );
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as const)), [accounts]);
  const splitSummary = summarizeSplits(transaction.amount, drafts, accountsById);
  const canSaveSplit = splitSummary.isBalanced && splitSummary.isComplete;

  // Pendente com nota casada: a conta já vem sugerida pela nota.
  const [accountId, setAccountId] = useState<string>(
    transaction.accountId ?? (transaction.status === 'PENDING' ? (invoiceMatch?.suggestedAccountId ?? '') : '')
  );
  const [invoiceRejected, setInvoiceRejected] = useState(false);
  const acceptedInvoiceId = invoiceMatch && !invoiceRejected ? invoiceMatch.invoice.id : undefined;
  // IBS/CBS da nota: na compra do regime regular, o crédito sai da despesa pelo rateio.
  const credit = useMemo(
    () => (invoiceMatch ? ibsCbsCredit(invoiceMatch.invoice, invoiceMatch.amount, regime) : null),
    [invoiceMatch, regime]
  );
  const creditDrafts = useMemo(
    () => (credit?.status === 'CREDIT' ? creditSplitDrafts(transaction.amount, accountId, credit, accounts) : null),
    [credit, transaction.amount, accountId, accounts]
  );
  // NFS-e com retenções e o extrato pelo líquido: bruto na conta escolhida, retenções nas contas delas.
  const withheld = invoiceMatch && !invoiceRejected && paidNet(invoiceMatch.invoice, invoiceMatch.amount) ? invoiceMatch.invoice : null;
  const retentionSplit = useMemo(
    () =>
      withheld?.retentions
        ? invoiceRetentionSplit({ transactionAmount: transaction.amount, grossAccountId: accountId, retentions: withheld.retentions, accounts, invoiceLabel: describeInvoice(withheld) })
        : null,
    [withheld, transaction.amount, accountId, accounts]
  );
  // Em edição, só atualiza regra por padrão se o lançamento veio de uma.
  const [learnRule, setLearnRule] = useState(isEditing ? Boolean(sourceRule) : true);
  // Termo sugerido: a descrição como aparece na lista ("Pix recebido - Fulano"), sem CPF/dados bancários;
  // ao editar, o termo da regra de origem. O favorecido sozinho fica disponível como atalho.
  const suggestedTerm = suggestMemoTerm(transaction.memo);
  const payeeTerm = suggestRuleTerm(transaction.memo);
  const [customPattern, setCustomPattern] = useState(sourceRule?.pattern ?? suggestedTerm);
  const [matchType, setMatchType] = useState<RuleMatchType>(
    sourceRule?.matchType && sourceRule.matchType !== 'REGEX' ? sourceRule.matchType : 'CONTAINS'
  );

  const assessment = useMemo(
    () => assessRuleTerm({ pattern: customPattern, matchType }, memoPool),
    [customPattern, matchType, memoPool]
  );
  const [acknowledged, setAcknowledged] = useState(false);
  // Termo genérico só é salvo depois de "Criar mesmo assim".
  const ruleBlocked = learnRule && assessment.level === 'generic' && !acknowledged;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Pagamento de parcela pós-fixada: a parcela-base baixa o parcelamento e o resto é juros (Selic).
  const floatSplit = useMemo(
    () => (accountId && floatingContracts?.length ? floatingPaymentSplit(floatingContracts, accountId, Math.round(transaction.amount * 100)) : null),
    [accountId, floatingContracts, transaction.amount]
  );
  const negative = transaction.amount < 0;
  // Entrada classificada numa conta de aplicação: resgate, com IR e IOF entre o bruto e o líquido.
  const isRedemption =
    !negative && Boolean(accountId) && (investmentAccountIds?.includes(accountId) || accounts.find((a) => a.id === accountId)?.code === INVESTMENT_DEFAULT_CODE);
  // Saída: despesas e custos primeiro; entrada: receitas primeiro.
  const pickerAccounts = useMemo(() => orderAccountsByDirection(accounts, directionOf(transaction.amount)), [accounts, transaction.amount]);

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-stone-900/25 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="classify-title"
        className={`relative w-full ${mode === 'split' ? 'max-w-[640px]' : 'max-w-[440px]'} max-h-[calc(100vh-2rem)] my-auto flex flex-col overflow-hidden transition-[max-width] duration-200 rounded-[28px] bg-[#F9F9F8]/95 dark:bg-stone-900/95 backdrop-blur-2xl border border-line shadow-[0_24px_64px_rgba(0,0,0,0.18)] animate-sheet-in`}
      >
        {/* Cabeçalho (fixo) */}
        <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4">
          <div className="flex-1 min-w-0">
            <h2 id="classify-title" className="text-[17px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {isEditing ? 'Editar classificação' : 'Classificar lançamento'}
            </h2>
            <p className="mt-1 text-[13px] text-stone-500 truncate">{transaction.memo}</p>
            {isEditing && (
              <p className="mt-2 inline-flex items-center gap-1.5 max-w-full text-[12px] text-stone-500">
                <StatusBadge status={transaction.status} />
                <span className="truncate">
                  {transaction.isSplit
                    ? `Rateado em ${transaction.splits?.length ?? 0} contas`
                    : transaction.accountName
                      ? `${transaction.accountCode ?? ''} ${transaction.accountName}`
                      : 'Sem conta'}
                </span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/8 text-stone-500 flex items-center justify-center hover:bg-black/8 active:scale-[0.94] transition-all duration-150"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
        </div>

        {/* Corpo: rola por dentro quando a janela é baixa; cabeçalho e botão de confirmar ficam sempre visíveis */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-2">
          <div className="px-6 pb-4 flex items-baseline justify-between">
            <span className="text-[12px] text-stone-500 dark:text-stone-400 font-mono tabular-nums">{formatDateBR(transaction.date)}</span>
            <span className={`text-[22px] font-semibold tracking-tight font-mono tabular-nums ${negative ? 'text-stone-900 dark:text-stone-100' : 'text-emerald-600 dark:text-emerald-300'}`}>
              {formatCurrency(transaction.amount)}
            </span>
          </div>

          {locked && (
            <div role="status" className="mx-6 mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-stone-900/4 dark:bg-white/6 border border-black/6 text-[12px] text-stone-600 dark:text-stone-300">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                A competência de <b>{lockedMonthLabel}</b> está fechada. Para alterar este lançamento, reabra a competência em
                “Reabrir competência”, logo abaixo do seletor de período (a reabertura fica registrada na auditoria).
              </span>
            </div>
          )}

          {transaction.transferPairId && (
            <div role="status" className="mx-6 mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200/60 dark:border-sky-500/25 text-[12px] text-sky-800 dark:text-sky-300">
              <ArrowLeftRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Transferência entre contas próprias. Reclassificar, ratear ou desfazer este lançamento volta a outra perna para pendente.</span>
            </div>
          )}
          {openQuery && mode !== 'ask' && (
            <div role="status" className="mx-6 mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-500/25 text-[12px] text-amber-800 dark:text-amber-300">
              <MessageCircleQuestion className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Aguardando o cliente: “{openQuery.question}”</span>
            </div>
          )}

          <div className="px-6 pb-4 overflow-x-auto">
            <SegmentedControl
              ariaLabel="Modo de classificação"
              value={mode}
              onChange={setMode}
              options={[
                ...(locked
                  ? []
                  : [
                      { value: 'single' as const, label: 'Conta única' },
                      { value: 'split' as const, label: 'Rateio / desdobrar' },
                      ...(onAskClient ? [{ value: 'ask' as const, label: 'Perguntar ao cliente' }] : []),
                    ]),
                { value: 'history', label: 'Histórico' },
              ]}
            />
          </div>

          {mode === 'history' ? (
            <div className="px-6">
              {auditError ? (
                <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">{auditError}</p>
              ) : audit === null ? (
                <TableSkeleton rows={3} dense label="Carregando histórico…" />
              ) : (
                <AuditTimeline entries={audit} emptyText="Nenhuma alteração registrada para este lançamento." />
              )}
            </div>
          ) : mode === 'ask' ? (
            <div className="px-6 space-y-3">
              <p className="text-[13px] text-stone-600 dark:text-stone-300">
                A pergunta entra na lista de <b>Pendências do cliente</b>, de onde você gera um link para o cliente justificar o
                lançamento por escrito, sem precisar de login.
              </p>
              <label className="block space-y-1.5">
                <span className="block text-[12px] font-medium text-stone-500 px-0.5">Pergunta</span>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={4}
                  maxLength={500}
                  className="w-full px-3.5 py-3 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-line-strong text-[14px] leading-relaxed outline-none focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.12)]"
                />
              </label>
              {openQuery && (
                <p className="text-[12px] text-stone-500 dark:text-stone-400">
                  Perguntado por {openQuery.askedByEmail ?? openQuery.askedByUid} em {formatDateBR(openQuery.askedAt.slice(0, 10))}.
                </p>
              )}
            </div>
          ) : mode === 'split' ? (
            <div className="px-6 space-y-3">
              {invoiceMatch && acceptedInvoiceId && (
                <p className="flex items-start gap-2 rounded-2xl border border-line px-3.5 py-2.5 text-[12px] text-stone-600 dark:text-stone-300">
                  <ReceiptText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                  <span>
                    O rateio fica vinculado à {describeInvoice(invoiceMatch.invoice)}. Se não for esta nota, marque “Não é esta nota” em
                    Conta única.
                  </span>
                </p>
              )}
              <SplitEditor
                transactionAmount={transaction.amount}
                accounts={accounts}
                drafts={drafts}
                onChange={setDrafts}
                defaultAccountId={accountId || undefined}
                startWithGrossNet={grossNetFirst}
                grossNetMode={
                  redemption
                    ? {
                        origins: [{ key: 'redemption', label: 'Resgate de aplicação', hint: 'Sai da aplicação o valor bruto (o do extrato da aplicação).' }],
                        presets: redemptionPresets(regime),
                        note: `O banco recebeu o líquido do resgate. Informe o IR e o IOF do extrato da aplicação: o bruto sai da aplicação${irIsExpense(regime) ? ' e, no Simples, o IR vai para a despesa (não se recupera)' : ' e o IR fica a recuperar (abate o IRPJ)'}.`,
                      }
                    : undefined
                }
              />
            </div>
          ) : (
          <div className="px-6 space-y-5">
            {invoiceMatch && (
              <InvoiceMatchCard
                match={invoiceMatch}
                accounts={accounts}
                accountId={accountId}
                rejected={invoiceRejected}
                onUseSuggestion={setAccountId}
                onRejectedChange={setInvoiceRejected}
                credit={credit}
                onUseCredit={
                  creditDrafts
                    ? () => {
                        setDrafts(creditDrafts);
                        setGrossNetFirst(false);
                        setMode('split');
                      }
                    : undefined
                }
                onViewDetails={onViewInvoice ? () => onViewInvoice(invoiceMatch.invoice) : undefined}
              />
            )}
            {withheld && retentionSplit && (
              <RetentionNotice
                invoice={withheld}
                regime={regime}
                split={retentionSplit}
                hasAccount={Boolean(accountId)}
                onApply={() => {
                  if (!retentionSplit.drafts) return;
                  setDrafts(retentionSplit.drafts);
                  setGrossNetFirst(false);
                  setMode('split');
                }}
              />
            )}
            {!invoiceMatch && linkedInvoice && (
              <LinkedInvoiceNote
                invoice={linkedInvoice}
                onViewDetails={onViewInvoice ? () => onViewInvoice(linkedInvoice) : undefined}
              />
            )}
            {/* Plano de contas */}
            <section className="space-y-2">
              <p className="text-[12px] font-medium text-stone-500 px-1">Conta contábil</p>
              <AccountPicker accounts={pickerAccounts} value={accountId} onChange={setAccountId} suggestions={suggestions} autoFocus />
              {floatSplit && (
                <div role="status" className="rounded-2xl border border-amber-200/70 bg-amber-50/80 dark:bg-amber-950/25 dark:border-amber-800/40 px-3.5 py-3 text-[12px] text-amber-900 dark:text-amber-200 space-y-2">
                  <p>
                    Parcela de {floatSplit.contract.description}: {formatCurrency(floatSplit.principalCents / 100)} de parcela e {formatCurrency(floatSplit.interestCents / 100)} de juros
                    (atualização pela Selic, direto para o resultado).
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafts([
                        { id: newSplitId(), accountId, memo: `Parcela - ${floatSplit.contract.description}`, cents: floatSplit.principalCents },
                        { id: newSplitId(), accountId: floatSplit.contract.interestExpenseAccountId, memo: `Juros (Selic) - ${floatSplit.contract.description}`, cents: floatSplit.interestCents },
                      ]);
                      setGrossNetFirst(false);
                      setMode('split');
                    }}
                    className="rounded-lg bg-amber-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-amber-700 active:scale-[0.97] transition-all duration-150"
                  >
                    Lançar parcela e juros
                  </button>
                </div>
              )}
              {isRedemption && (
                <div role="status" className="rounded-2xl border border-sky-200/70 bg-sky-50/80 dark:bg-sky-950/25 dark:border-sky-800/40 px-3.5 py-3 text-[12px] text-sky-900 dark:text-sky-200 space-y-2">
                  <p>Entrada na conta da aplicação: é resgate. Se houve IR ou IOF, sai da aplicação o bruto e o extrato traz o líquido.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setGrossNetFirst(true);
                      setRedemption(true);
                      setMode('split');
                    }}
                    className="rounded-lg bg-sky-700 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-sky-800 active:scale-[0.97] transition-all duration-150"
                  >
                    Resgate com IR ou IOF: lançar bruto × líquido
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setGrossNetFirst(true);
                  setRedemption(false);
                  setMode('split');
                }}
                className="px-1 text-[12px] font-medium text-accent-ink hover:underline"
              >
                {negative ? 'Pagou o líquido, com imposto retido? Lançar bruto × líquido' : 'Recebeu o líquido, com retenção ou taxa? Lançar bruto × líquido'}
              </button>
            </section>

            {/* Aprendizado */}
            <RuleLearnPanel
              checked={learnRule}
              onChecked={setLearnRule}
              title={isEditing ? 'Atualizar regra de aprendizado' : 'Lembrar essa classificação'}
              subtitle={sourceRule ? `A regra “${sourceRule.pattern}” passará a usar a nova conta` : 'Aplica a lançamentos semelhantes'}
              term={customPattern}
              onTerm={setCustomPattern}
              matchType={matchType}
              onMatchType={setMatchType}
              assessment={assessment}
              acknowledged={acknowledged}
              onAcknowledged={setAcknowledged}
              suggestion={payeeTerm}
              memoSuggestion={suggestedTerm}
              note={
                matchType === 'EXACT' && normalizePattern(customPattern) !== normalizePattern(transaction.memo) ? (
                  <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    Com “É exatamente”, a regra só casa históricos idênticos ao termo — este lançamento não casaria.
                  </p>
                ) : null
              }
            />
          </div>
          )}
        </div>

        {/* Rodapé (fixo) com a ação principal */}
        <div className="shrink-0 px-6 pt-4 pb-5 border-t border-line">
          {mode === 'history' ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full h-12 rounded-2xl bg-black/5 dark:bg-white/8 text-stone-800 dark:text-stone-100 text-[15px] font-medium tracking-tight active:scale-[0.98] transition-all duration-150"
            >
              Fechar
            </button>
          ) : mode === 'ask' ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled={!question.trim() || isSaving}
                onClick={() => void onAskClient?.(question)}
                className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-[15px] font-medium tracking-tight disabled:opacity-40 active:scale-[0.98] transition-all duration-150"
              >
                {isSaving ? 'Salvando…' : openQuery ? 'Atualizar pergunta' : 'Enviar para pendências do cliente'}
              </button>
              {openQuery && (
                <button type="button" disabled={isSaving} onClick={() => void onAskClient?.('')} className="w-full text-[13px] text-stone-500 hover:text-rose-600">
                  Remover pergunta
                </button>
              )}
            </div>
          ) : mode === 'split' ? (
            <>
              {!canSaveSplit && (
                <p className="mb-2 text-center text-[12px] text-stone-500">
                  {!splitSummary.isBalanced
                    ? 'A soma das linhas deve ser igual ao valor do lançamento.'
                    : splitSummary.errors[0]}
                </p>
              )}
              <button
                type="button"
                disabled={!canSaveSplit || isSaving}
                onClick={() => void onSplit(drafts, acceptedInvoiceId)}
                className="w-full h-12 rounded-2xl bg-accent hover:bg-accent-hover text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(181,85,47,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
              >
                {isSaving ? 'Salvando…' : isEditing ? 'Salvar novo rateio' : 'Salvar rateio'}
              </button>
            </>
          ) : (
          <button
            type="button"
            disabled={!accountId || isSaving || ruleBlocked}
            onClick={() => void onConfirm(accountId, learnRule, customPattern, matchType, acceptedInvoiceId)}
            className="w-full h-12 rounded-2xl bg-accent hover:bg-accent-hover text-white text-[15px] font-medium tracking-tight shadow-[0_4px_14px_rgba(181,85,47,0.25)] disabled:opacity-40 disabled:shadow-none active:scale-[0.98] transition-all duration-150"
          >
            {isSaving ? 'Salvando…' : isEditing ? 'Salvar nova classificação' : 'Conciliar'}
          </button>
          )}
          {isEditing && !locked && (mode === 'single' || mode === 'split') && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (confirmUndo) void onUnreconcile();
                  else setConfirmUndo(true);
                }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 ${
                  confirmUndo
                    ? 'bg-rose-600 text-white shadow-[0_2px_10px_rgba(225,29,72,0.3)] animate-pop-in'
                    : 'text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                }`}
              >
                {confirmUndo ? 'Clique para confirmar: voltar para Pendente' : 'Desfazer conciliação'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return <ModalPortal>{dialog}</ModalPortal>;
}
