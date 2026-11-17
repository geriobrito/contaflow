'use client';

import { useMemo, useState } from 'react';
import { Copy, Lightbulb, Plus } from 'lucide-react';
import type { ClassificationRule } from '@/types/firestore';
import { deleteRule, saveRule } from '@/lib/services/data-service';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { SetupProgress } from '@/components/layout/SetupProgress';
import { useRulesData, type RuleListRow } from '@/hooks/regras/useRulesData';
import { canDeleteRule } from '@/lib/lock-guard';
import { conditionFields } from '@/lib/reconciliation';
import type { RuleSuggestion } from '@/lib/rule-suggestions';
import { RULE_SAMPLE_MONTHS } from '@/lib/services/reconciliation-service';
import { describeError } from '@/lib/utils/errors';
import { newRuleId } from '@/lib/utils/id';
import { peekActor } from '@/lib/data/scope';
import { formatCurrency } from '@/lib/utils/formatters';
import { BUTTON, ConfirmButton, PAGE, PageHeader, SearchField, SURFACE } from '@/components/ui/primitives';
import { NewRuleForm } from '@/components/regras/NewRuleForm';
import { RulesTable } from '@/components/regras/RulesTable';
import { CopyRulesSheet } from '@/components/regras/CopyRulesSheet';
import type { RuleEdit } from '@/components/regras/RuleRow';

/** Recortes da lista: o que pede revisão ou limpeza. */
type RuleFilter = 'all' | 'conflict' | 'broad' | 'corrected' | 'unused';

const FILTERS: readonly { value: RuleFilter; label: string; title: string }[] = [
  { value: 'all', label: 'Todas', title: 'Todas as regras' },
  { value: 'conflict', label: 'Com conflito', title: 'Perdem para outra regra que leva o mesmo lançamento a outra conta' },
  { value: 'broad', label: 'Termo amplo', title: 'Termo genérico ou que casa com muitos favorecidos diferentes' },
  { value: 'corrected', label: 'Corrigidas', title: 'O que a regra classificou já foi trocado à mão' },
  { value: 'unused', label: 'Sem uso', title: `Não vale para nenhum pendente nem para os lançamentos dos últimos ${RULE_SAMPLE_MONTHS} meses` },
];

/**
 * Regras de aprendizado. A tela só compõe: os dados vêm de `useRulesData`, e o formulário, a
 * tabela, a linha editável e a cópia entre empresas ficam em src/components/regras/.
 */
export default function RegrasPage() {
  const { user, isAdmin } = useAuth();
  const { currentClient, clients } = useClient();
  const clientId = currentClient?.id;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RuleFilter>('all');
  const [copying, setCopying] = useState(false);
  const { rules, accounts, analytic, accountsById, bankAccounts, rulesById, memos, conflicts, rows, suggestions, isLoading, loadFailure, isDuplicate, applyToPending, dropRule, reload } =
    useRulesData(clientId, search);

  /** Resultado da última criação ou aplicação de regra. */
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [busySuggestion, setBusySuggestion] = useState<string | null>(null);

  const canDelete = (rule: ClassificationRule) => canDeleteRule(rule, user?.uid, isAdmin);

  const inFilter = useMemo(
    (): Record<RuleFilter, (row: RuleListRow) => boolean> => ({
      all: () => true,
      conflict: ({ rule }) => conflicts.has(rule.id),
      broad: ({ assessment }) => assessment.level !== 'ok',
      corrected: ({ rule }) => (rule.overrideCount ?? 0) > 0,
      unused: ({ affected }) => affected === 0,
    }),
    [conflicts]
  );
  // A contagem acompanha a busca: o número da etiqueta é o que ela vai mostrar.
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter(inFilter[f.value]).length])) as Record<RuleFilter, number>, [rows, inFilter]);
  // Filtro que ficou vazio (regra excluída ou corrigida) volta para "Todas".
  const activeFilter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter;
  const visibleRows = useMemo(() => rows.filter(inFilter[activeFilter]), [rows, inFilter, activeFilter]);
  const unusedDeletable = activeFilter === 'unused' ? visibleRows.filter(({ rule }) => canDelete(rule)) : [];

  const handleApply = async (rule: ClassificationRule) => {
    setActionError(null);
    setNotice(null);
    setApplyingId(rule.id);
    try {
      const n = await applyToPending(rule, rules);
      setNotice(`“${rule.pattern}” classificou ${n} lançamento(s) pendente(s).`);
      await reload();
    } catch (e: unknown) {
      setActionError(`Não foi possível aplicar a regra “${rule.pattern}” (${describeError(e)}).`);
    } finally {
      setApplyingId(null);
    }
  };

  /** Chamado pelo formulário: se a gravação falhar, o erro sobe para ele. */
  const handleCreate = async (rule: ClassificationRule) => {
    setNotice(null);
    setActionError(null);
    await saveRule(rule);
    // Regra nova vale também para o que já está no banco, não só para as próximas importações.
    try {
      const n = await applyToPending(rule, [...rules, rule]);
      setNotice(n > 0 ? `Regra criada e aplicada a ${n} lançamento(s) pendente(s).` : 'Regra criada. Nenhum pendente em período aberto casou com ela.');
    } catch (e: unknown) {
      setActionError(`Regra criada, mas não foi possível aplicá-la aos pendentes (${describeError(e)}).`);
    }
    await reload();
  };

  /** Sugestão aceita: vira regra "contém" do favorecido, no sentido em que ele aparece. */
  const handleSuggestion = async (s: RuleSuggestion) => {
    const account = accountsById.get(s.accountId);
    if (!clientId || !account) return;
    setBusySuggestion(s.id);
    const now = new Date().toISOString();
    const actorUid = peekActor()?.uid;
    try {
      await handleCreate({
        id: newRuleId(),
        clientId,
        pattern: s.term.toLowerCase().replace(/\s+/g, ' ').trim(),
        matchType: 'CONTAINS',
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        direction: s.direction,
        ...(actorUid ? { createdByUid: actorUid } : {}),
        createdAt: now,
        updatedAt: now,
      });
    } catch (e: unknown) {
      setActionError(`Não foi possível criar a regra de “${s.label}” (${describeError(e)}).`);
    } finally {
      setBusySuggestion(null);
    }
  };

  /** Propaga ao RuleRow (que mantém o modo de edição aberto) e informa o usuário. */
  const handleSave = async (rule: ClassificationRule, edit: RuleEdit) => {
    setActionError(null);
    try {
      await saveRule({
        ...rule,
        pattern: edit.pattern,
        matchType: edit.matchType,
        ...(edit.account ? { accountId: edit.account.id, accountCode: edit.account.code, accountName: edit.account.name } : {}),
        // Condição retirada é gravada com o valor neutro (a gravação mescla campos).
        ...conditionFields(edit.conditions),
        updatedAt: new Date().toISOString(),
      });
      await reload();
    } catch (e: unknown) {
      setActionError(`Não foi possível atualizar a regra “${rule.pattern}” (${describeError(e)}).`);
      throw e;
    }
  };

  const handleDelete = async (rule: ClassificationRule) => {
    setActionError(null);
    try {
      await deleteRule(rule.id);
      dropRule(rule.id);
    } catch (e: unknown) {
      setActionError(`Não foi possível excluir a regra “${rule.pattern}” (${describeError(e)}).`);
    }
  };

  /** Limpeza: exclui de uma vez as regras sem uso que estão na lista. */
  const handleDeleteUnused = async () => {
    setActionError(null);
    setNotice(null);
    let removed = 0;
    try {
      for (const { rule } of unusedDeletable) {
        await deleteRule(rule.id);
        dropRule(rule.id);
        removed++;
      }
      setNotice(`${removed} regra(s) sem uso excluída(s).`);
    } catch (e: unknown) {
      setActionError(`A limpeza parou depois de ${removed} regra(s) (${describeError(e)}).`);
    }
  };

  const sources = clients.filter((c) => !c.deletingAt && c.id !== clientId);

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Regras de aprendizado"
        description={
          <>
            Termos memorizados que classificam lançamentos automaticamente. Quando duas regras valem para o mesmo lançamento, vence a
            mais restritiva (exato › começa com › contém), depois a que tem mais condições (sentido, conta bancária, valor), o termo mais
            longo e, por fim, a mais recente.{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{rules.length}</span> regra(s) ativa(s)
            {conflicts.size > 0 && <span className="text-amber-700 dark:text-amber-400"> · {conflicts.size} com conflito</span>}.
          </>
        }
        actions={
          clientId && sources.length > 0 ? (
            <button type="button" onClick={() => setCopying(true)} className={BUTTON.secondary}>
              <Copy className="w-4 h-4" strokeWidth={2} />
              Copiar de outra empresa
            </button>
          ) : undefined
        }
      />
      <SetupProgress />

      <NewRuleForm clientId={clientId} analytic={analytic} bankAccounts={bankAccounts} memos={memos} isDuplicate={isDuplicate} onCreate={handleCreate} notice={notice} />

      {suggestions.length > 0 && (
        <section aria-label="Sugestões de regra" className={`${SURFACE} rounded-[22px] p-5 space-y-3`}>
          <div className="flex items-start gap-2.5">
            <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.9} />
            <div>
              <p className="text-[13px] font-medium text-stone-700 dark:text-stone-300">Favorecidos recorrentes sem regra</p>
              <p className="text-[12px] text-stone-500 dark:text-stone-400">
                Conciliados à mão várias vezes na mesma conta nos últimos {RULE_SAMPLE_MONTHS} meses. A regra criada vale só no sentido em que eles aparecem.
              </p>
            </div>
          </div>
          <ul className="divide-y divide-black/4 dark:divide-white/5">
            {suggestions.map((s) => {
              const account = accountsById.get(s.accountId);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
                  <div className="min-w-0 flex-1 basis-[240px]">
                    <p className="truncate text-[13px] font-medium tracking-tight text-stone-900 dark:text-stone-100">{s.label}</p>
                    <p className="text-[12px] text-stone-500 dark:text-stone-400">
                      {s.count} {s.direction === 'IN' ? 'entrada(s)' : 'saída(s)'}
                      {s.outOf > s.count && ` de ${s.outOf}`} · <span className="font-mono tabular-nums">{formatCurrency(Math.abs(s.total))}</span>
                    </p>
                  </div>
                  <p className="min-w-0 flex-1 basis-[240px] truncate text-[13px] text-stone-700 dark:text-stone-300">
                    <span className="font-mono tabular-nums text-[12px] text-stone-500 dark:text-stone-400 mr-1.5">{account?.code}</span>
                    {account?.name}
                  </p>
                  <button
                    type="button"
                    disabled={busySuggestion !== null}
                    onClick={() => void handleSuggestion(s)}
                    aria-label={`Criar regra para ${s.label}`}
                    className={`${BUTTON.secondary} h-8 px-3 text-[12px]`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {busySuggestion === s.id ? 'Criando…' : 'Criar regra'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="space-y-3">
        <SearchField value={search} onChange={setSearch} placeholder="Buscar por termo ou conta" />
        {rules.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filtrar regras" className="flex flex-wrap items-center gap-1.5">
              {FILTERS.filter((f) => f.value === 'all' || counts[f.value] > 0).map((f) => {
                const active = activeFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    title={f.title}
                    aria-pressed={active}
                    onClick={() => setFilter(f.value)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-[12px] font-medium transition-colors active:scale-[0.97] ${
                      active
                        ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                        : 'bg-surface text-stone-600 dark:text-stone-300 border-line-strong hover:bg-surface-2'
                    }`}
                  >
                    {f.label}
                    <span className={`font-mono tabular-nums ${active ? 'opacity-70' : 'text-stone-500 dark:text-stone-400'}`}>{counts[f.value]}</span>
                  </button>
                );
              })}
            </div>
            {unusedDeletable.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-2 text-[12px] text-stone-500 dark:text-stone-400">
                Excluir as {unusedDeletable.length} sem uso
                <ConfirmButton ariaLabel={`Excluir as ${unusedDeletable.length} regras sem uso`} label="Excluir" confirmLabel="Excluir todas" onConfirm={handleDeleteUnused} />
              </span>
            )}
          </div>
        )}
        {actionError && (
          <p role="alert" className="px-1 text-[13px] text-rose-600 dark:text-rose-300 animate-fade-in">
            {actionError}
          </p>
        )}
      </div>

      <RulesTable
        loadFailure={loadFailure}
        isLoading={isLoading}
        rows={visibleRows}
        ruleCount={rules.length}
        search={search}
        filtered={activeFilter !== 'all'}
        memos={memos}
        conflicts={conflicts}
        rulesById={rulesById}
        applyingId={applyingId}
        isDuplicate={isDuplicate}
        analytic={analytic}
        bankAccounts={bankAccounts}
        canDelete={canDelete}
        onApply={handleApply}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      {copying && clientId && (
        <CopyRulesSheet
          sources={sources}
          targetClientId={clientId}
          targetName={currentClient?.tradeName || currentClient?.name || ''}
          targetRules={rules}
          targetAccounts={accounts}
          onClose={() => setCopying(false)}
          onCopied={async (created) => {
            setCopying(false);
            setActionError(null);
            setNotice(`${created.length} regra(s) copiada(s). Use “Aplicar” na linha de cada uma para classificar os pendentes que ela vence.`);
            await reload();
          }}
        />
      )}
    </main>
  );
}
