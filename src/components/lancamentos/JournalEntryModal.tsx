'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Calculator,
  Lock,
} from 'lucide-react';
import type { ChartAccount, JournalEntry, JournalEntryCategory, JournalEntryLine } from '@/types/firestore';
import { formatCurrency } from '@/lib/utils/formatters';
import { JOURNAL_TEMPLATES, journalEntryProblem, journalTotals, MAX_JOURNAL_LINES, parseAttachmentUrl, templateDraft, type JournalTemplateId } from '@/lib/journal';
import { parseMoneyInput } from '@/lib/opening';
import { BUTTON, INPUT } from '@/components/ui/primitives';

interface JournalEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>, existingId?: string) => Promise<void>;
  initialEntry?: JournalEntry | null;
  accounts: readonly ChartAccount[];
  clientId: string;
  defaultDate?: string;
  isMonthLocked?: (month: string) => boolean;
}

const CATEGORY_LABELS: Record<JournalEntryCategory, string> = {
  CLOSING: 'Fechamento Contábil Geral',
  PAYROLL: 'Provisão de Folha de Pagamento',
  DEPRECIATION: 'Depreciação de Imobilizado',
  TAX: 'Provisão Tributária (DAS / Impostos)',
  ADJUSTMENT: 'Ajuste Patrimonial',
  PROVISION: 'Provisão Geral',
  OTHER: 'Outros Lançamentos',
};

export const JournalEntryModal: React.FC<JournalEntryModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialEntry,
  accounts,
  clientId,
  defaultDate = new Date().toISOString().slice(0, 10),
  isMonthLocked,
}) => {
  const [date, setDate] = useState<string>(initialEntry?.date ?? defaultDate);
  const [category, setCategory] = useState<JournalEntryCategory>(initialEntry?.category ?? 'CLOSING');
  const [memo, setMemo] = useState<string>(initialEntry?.memo ?? '');
  const [documentRef, setDocumentRef] = useState<string>(initialEntry?.documentRef ?? '');
  const [attachmentUrl, setAttachmentUrl] = useState<string>(initialEntry?.attachmentUrl ?? '');
  const [lines, setLines] = useState<JournalEntryLine[]>(() => {
    if (initialEntry && initialEntry.lines.length > 0) {
      return initialEntry.lines;
    }
    return [
      { id: 'l1', accountId: '', type: 'DEBIT', amount: 0, memo: '' },
      { id: 'l2', accountId: '', type: 'CREDIT', amount: 0, memo: '' },
    ];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<JournalTemplateId | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Apenas contas analíticas são selecionáveis
  const analyticAccounts = useMemo(() => {
    return accounts
      .filter((a) => a.nature === 'ANALYTIC')
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [accounts]);

  // Checagem de mês bloqueado
  const month = date.slice(0, 7);
  const locked = Boolean(isMonthLocked && isMonthLocked(month));

  // Balanço das partidas
  const { totalDebit, totalCredit, difference, isBalanced } = useMemo(() => {
    const { debit, credit, difference: diff } = journalTotals(lines);
    return { totalDebit: debit, totalCredit: credit, difference: diff, isBalanced: diff === 0 && debit > 0 };
  }, [lines]);

  // Comprovante: só link http/https (caminho do computador ou nome de arquivo não abre em outro aparelho).
  const attachment = useMemo(() => parseAttachmentUrl(attachmentUrl), [attachmentUrl]);

  if (!isOpen) return null;

  const handleAddLine = () => {
    if (lines.length >= MAX_JOURNAL_LINES) {
      setError(`Um lançamento aceita no máximo ${MAX_JOURNAL_LINES} partidas. Divida-o em dois lançamentos.`);
      return;
    }
    const nextId = `l_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const lastLine = lines[lines.length - 1];
    const newType = lastLine?.type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    const remainingDiff = Math.max(0, totalDebit - totalCredit);
    setLines((prev) => [
      ...prev,
      {
        id: nextId,
        accountId: '',
        type: newType,
        amount: remainingDiff > 0 && newType === 'CREDIT' ? remainingDiff : 0,
        memo: '',
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 2) {
      setError('Um lançamento contábil requer pelo menos duas partidas (débito e crédito).');
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
    setError(null);
  };

  const handleLineChange = (id: string, field: keyof JournalEntryLine, value: unknown) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        return { ...l, [field]: value };
      })
    );
  };

  // Modelos de provisão: os valores do mês viram as partidas nas contas do modelo de plano de contas.
  const template = JOURNAL_TEMPLATES.find((t) => t.id === templateId) ?? null;
  const applyTemplate = () => {
    if (!template) return;
    const values: Record<string, number> = {};
    for (const f of template.fields) {
      const n = parseMoneyInput(templateValues[f.key] ?? '');
      if (n === null) return setTemplateError(`${f.label}: valor inválido (use números, como 1.234,56).`);
      values[f.key] = n;
    }
    const { draft, problem } = templateDraft(template, values, accounts, date);
    if (!draft) return setTemplateError(problem);
    setTemplateError(null);
    setError(null);
    setCategory(draft.category);
    setMemo(draft.memo);
    setDocumentRef(draft.documentRef ?? '');
    setLines(draft.lines);
    setTemplateId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) {
      setError(`A competência ${month} está bloqueada para alterações.`);
      return;
    }
    if (!memo.trim()) {
      setError('Informe a descrição / histórico do lançamento.');
      return;
    }
    // Mesma validação aplicada pelos repositórios e pelas regras do Firestore.
    const problem = journalEntryProblem({ date, lines });
    if (problem) {
      setError(problem);
      return;
    }
    if (attachment && 'problem' in attachment) {
      setError(`Link do comprovante: ${attachment.problem}`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const byId = new Map(accounts.map((a) => [a.id, a] as const));
      await onSave(
        {
          clientId,
          date,
          memo: memo.trim(),
          category,
          lines: lines.map((l) => {
            const acc = byId.get(l.accountId);
            return {
              id: l.id,
              accountId: l.accountId,
              accountCode: acc?.code,
              accountName: acc?.name,
              type: l.type,
              amount: Number(l.amount),
              memo: l.memo?.trim() || undefined,
            };
          }),
          totalAmount: totalDebit,
          documentRef: documentRef.trim() || undefined,
          attachmentUrl: attachment && 'url' in attachment ? attachment.url : undefined,
          createdByUid: initialEntry?.createdByUid ?? '',
        },
        initialEntry?.id
      );
      onClose();
    } catch (err) {
      console.error('Erro ao salvar lançamento manual:', err);
      setError(err instanceof Error ? err.message : 'Falha ao salvar lançamento contábil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="journal-entry-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06] dark:border-white/[0.08] bg-stone-50/50 dark:bg-stone-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent-ink flex items-center justify-center">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 id="journal-entry-modal-title" className="text-[17px] font-semibold text-stone-900 dark:text-stone-100">
                {initialEntry?.id ? `Editar Lançamento #${initialEntry.entryNumber}` : 'Novo Lançamento Contábil Manual'}
              </h2>
              <p className="text-[13px] text-stone-500">
                Partidas dobradas de fechamento, provisões ou ajustes patrimoniais
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar modal"
            className="w-8 h-8 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modelos de provisão mensal */}
        {!initialEntry?.id && (
          <div className="px-6 py-2.5 bg-stone-100/70 dark:bg-stone-800/60 border-b border-black/[0.04] dark:border-white/[0.06] space-y-2.5 text-[12px]">
            <div role="group" aria-label="Modelos de lançamento" className="flex items-center gap-2 overflow-x-auto">
              <span className="font-medium text-stone-500 flex items-center gap-1 shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Modelos:
              </span>
              {JOURNAL_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={templateId === t.id}
                  onClick={() => {
                    setTemplateId(templateId === t.id ? null : t.id);
                    setTemplateError(null);
                  }}
                  className={`px-2.5 py-1 rounded-lg border transition-colors shrink-0 ${
                    templateId === t.id
                      ? 'bg-accent border-accent text-white'
                      : 'bg-white dark:bg-stone-700 border-black/[0.06] dark:border-white/[0.08] text-stone-700 dark:text-stone-200 hover:border-accent/60 hover:text-accent-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {template && (
              <div className="rounded-xl bg-white dark:bg-stone-900 border border-black/[0.06] dark:border-white/[0.08] p-3 space-y-3">
                <p className="text-stone-500">{template.description} Competência pela data do lançamento.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {template.fields.map((f) => (
                    <label key={f.key} className="block space-y-1">
                      <span className="block font-medium text-stone-600 dark:text-stone-300">
                        {f.label}
                        {f.optional && <span className="font-normal text-stone-400"> (opcional)</span>}
                      </span>
                      <input
                        inputMode="decimal"
                        value={templateValues[f.key] ?? ''}
                        onChange={(e) => setTemplateValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder="0,00"
                        className={`${INPUT} h-9 text-right font-mono tabular-nums text-[13px]`}
                      />
                      {f.hint && <span className="block text-[11px] text-stone-400">{f.hint}</span>}
                    </label>
                  ))}
                </div>
                {templateError && <p role="alert" className="text-rose-600">{templateError}</p>}
                <button type="button" onClick={applyTemplate} className={`${BUTTON.secondary} h-8`}>
                  Preencher as partidas
                </button>
              </div>
            )}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
          {locked && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-200 text-[13px] flex items-center gap-2.5">
              <Lock className="w-4 h-4 shrink-0 text-amber-600" />
              <span>
                <strong>Competência bloqueada:</strong> O mês {month} foi fechado e não aceita novos lançamentos ou edições.
              </span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-rose-800 dark:text-rose-200 text-[13px] flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Dados Gerais */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                Data do Lançamento
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={saving || locked}
                  required
                  className={INPUT}
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                Categoria
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as JournalEntryCategory)}
                disabled={saving || locked}
                className={INPUT}
              >
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                Documento / Ref. (Opcional)
              </label>
              <input
                type="text"
                placeholder="Ex: FOLHA-05-2025"
                value={documentRef}
                onChange={(e) => setDocumentRef(e.target.value)}
                disabled={saving || locked}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
              Histórico Contábil Geral (Memo) *
            </label>
            <input
              type="text"
              placeholder="Ex: Provisão mensal de salários e ordenados referente a maio/2025"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={saving || locked}
              required
              className={INPUT}
            />
          </div>

          {/* Partidas Contábeis (Tabela Dinâmica) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-semibold text-stone-900 dark:text-stone-100">
                  Partidas Contábeis (Débito e Crédito)
                </h3>
                <p className="text-[12px] text-stone-500">
                  Todo débito deve corresponder a um crédito de igual valor.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddLine}
                disabled={saving || locked}
                className={`${BUTTON.secondary} !h-8 !text-[12px]`}
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar Partida
              </button>
            </div>

            <div className="border border-black/[0.08] dark:border-white/[0.1] rounded-xl overflow-hidden bg-stone-50/30 dark:bg-stone-900/30">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.08] bg-stone-100/50 dark:bg-stone-800/50 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                      <th className="py-2.5 px-3 w-16 text-center">Tipo</th>
                      <th className="py-2.5 px-3">Conta Contábil (Analítica)</th>
                      <th className="py-2.5 px-3 w-40 text-right">Valor (R$)</th>
                      <th className="py-2.5 px-3">Complemento / Memo</th>
                      <th className="py-2.5 px-3 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                    {lines.map((line, idx) => (
                      <tr key={line.id} className="hover:bg-white dark:hover:bg-stone-800/40 transition-colors">
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              handleLineChange(line.id, 'type', line.type === 'DEBIT' ? 'CREDIT' : 'DEBIT')
                            }
                            disabled={saving || locked}
                            className={`w-9 h-7 rounded-md font-mono text-[11px] font-bold transition-all shadow-sm ${
                              line.type === 'DEBIT'
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-amber-600 text-white hover:bg-amber-700'
                            }`}
                            title={line.type === 'DEBIT' ? 'Débito (Clique para alternar para Crédito)' : 'Crédito (Clique para alternar para Débito)'}
                          >
                            {line.type === 'DEBIT' ? 'D' : 'C'}
                          </button>
                        </td>

                        <td className="py-2 px-3">
                          <select
                            value={line.accountId}
                            onChange={(e) => handleLineChange(line.id, 'accountId', e.target.value)}
                            disabled={saving || locked}
                            required
                            className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] text-[13px] outline-none focus:border-accent/60"
                          >
                            <option value="">Selecione a conta analítica...</option>
                            {analyticAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.code} — {acc.name} ({acc.type})
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="py-2 px-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="0,00"
                            value={line.amount || ''}
                            onChange={(e) =>
                              handleLineChange(line.id, 'amount', parseFloat(e.target.value) || 0)
                            }
                            disabled={saving || locked}
                            required
                            className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] text-[13px] font-mono text-right outline-none focus:border-accent/60"
                          />
                        </td>

                        <td className="py-2 px-3">
                          <input
                            type="text"
                            placeholder="Memo opcional..."
                            value={line.memo ?? ''}
                            onChange={(e) => handleLineChange(line.id, 'memo', e.target.value)}
                            disabled={saving || locked}
                            className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-stone-800 border border-black/[0.08] dark:border-white/[0.1] text-[13px] outline-none focus:border-accent/60"
                          />
                        </td>

                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            disabled={saving || locked || lines.length <= 2}
                            aria-label={`Remover partida #${idx + 1}`}
                            className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Barra de Balanço das Partidas */}
              <div className="px-4 py-3 bg-stone-100/80 dark:bg-stone-800/80 border-t border-black/[0.06] dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-4 text-[13px]">
                <div className="flex items-center gap-6 font-mono">
                  <div>
                    <span className="text-[11px] uppercase font-sans text-stone-500 block">Total Débitos</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {formatCurrency(totalDebit)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] uppercase font-sans text-stone-500 block">Total Créditos</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {formatCurrency(totalCredit)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] uppercase font-sans text-stone-500 block">Diferença</span>
                    <span className={`font-semibold ${difference > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {formatCurrency(difference)}
                    </span>
                  </div>
                </div>

                <div>
                  {isBalanced ? (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 text-[12px] font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Partidas Equilibradas (Σ D = Σ C)
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 text-[12px] font-medium">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      Diferença de {formatCurrency(difference)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Anexo / Link */}
          <div>
            <label htmlFor="journal-attachment" className="block text-[12px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
              Link do comprovante (opcional)
            </label>
            <input
              id="journal-attachment"
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="Link de compartilhamento do documento na nuvem (Drive, OneDrive, Dropbox…)"
              value={attachmentUrl}
              onChange={(e) => setAttachmentUrl(e.target.value)}
              disabled={saving || locked}
              aria-invalid={Boolean(attachment && 'problem' in attachment)}
              className={INPUT}
            />
            {attachment && 'problem' in attachment ? (
              <p className="mt-1.5 text-[12px] text-rose-600">{attachment.problem}</p>
            ) : attachment ? (
              <p className="mt-1.5 text-[12px] text-stone-500">
                Abre em <span className="font-mono">{attachment.host}</span> ·{' '}
                <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">
                  testar o link
                </a>
              </p>
            ) : (
              <p className="mt-1.5 text-[12px] text-stone-400">
                Cole o link de compartilhamento, não o caminho do arquivo no computador: assim o comprovante abre em qualquer aparelho.
              </p>
            )}
          </div>

          {/* Rodapé / Ações */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-black/[0.06] dark:border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={BUTTON.ghost}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || locked || !isBalanced || !memo.trim()}
              className={BUTTON.primary}
            >
              {saving ? 'Gravando...' : initialEntry ? 'Salvar Alterações' : 'Confirmar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
