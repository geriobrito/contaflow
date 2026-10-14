'use client';

import React, { useState } from 'react';
import type { ClassificationRule, RuleMatchType } from '@/types/firestore';
import { deleteRule, saveRule } from '@/lib/services/data-service';
import { useClient } from '@/contexts/ClientContext';
import { useRulesData } from '@/hooks/regras/useRulesData';
import { describeError } from '@/lib/utils/errors';
import { PAGE, PageHeader, SearchField } from '@/components/ui/primitives';
import { NewRuleForm } from '@/components/regras/NewRuleForm';
import { RulesTable } from '@/components/regras/RulesTable';

/**
 * Regras de aprendizado. A tela só compõe: os dados vêm de `useRulesData`, e o formulário, a
 * tabela e a linha editável ficam em src/components/regras/.
 */
export default function RegrasPage() {
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [search, setSearch] = useState('');
  const { rules, analytic, rulesById, memos, conflicts, rows, isLoading, loadFailure, isDuplicate, applyToPending, dropRule, reload } = useRulesData(clientId, search);

  /** Resultado da última criação ou aplicação de regra. */
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

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

  /** Propaga ao RuleRow (que mantém o modo de edição aberto) e informa o usuário. */
  const handleSave = async (rule: ClassificationRule, pattern: string, matchType: RuleMatchType) => {
    setActionError(null);
    try {
      await saveRule({ ...rule, pattern, matchType, updatedAt: new Date().toISOString() });
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

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.name}
        title="Regras de aprendizado"
        description={
          <>
            Termos memorizados que classificam lançamentos automaticamente. Quando duas regras casam o mesmo histórico, vence a
            mais restritiva (exato › começa com › contém), depois o termo mais longo e, por fim, a mais recente.{' '}
            <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{rules.length}</span> regra(s) ativa(s)
            {conflicts.size > 0 && <span className="text-amber-700 dark:text-amber-400"> · {conflicts.size} com conflito</span>}.
          </>
        }
      />

      <NewRuleForm clientId={clientId} analytic={analytic} memos={memos} isDuplicate={isDuplicate} onCreate={handleCreate} notice={notice} />

      <SearchField value={search} onChange={setSearch} placeholder="Buscar por termo ou conta" />
      {actionError && (
        <p role="alert" className="-mt-4 px-1 text-[13px] text-rose-600 animate-fade-in">
          {actionError}
        </p>
      )}

      <RulesTable
        loadFailure={loadFailure}
        isLoading={isLoading}
        rows={rows}
        ruleCount={rules.length}
        search={search}
        memos={memos}
        conflicts={conflicts}
        rulesById={rulesById}
        applyingId={applyingId}
        isDuplicate={isDuplicate}
        onApply={handleApply}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </main>
  );
}
