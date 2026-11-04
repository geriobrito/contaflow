import type { ChartAccount, JournalEntry, JournalEntryCategory, JournalEntryLine } from '@/types/firestore';
import { journalEntryProblem, journalTotals, MAX_JOURNAL_LINES, parseAttachmentUrl, type JournalTemplate } from '@/lib/journal';
import { parseMoneyInput } from '@/lib/opening';

/**
 * Formulário do lançamento manual: partidas iniciais, nova partida, valores dos modelos e a
 * montagem do lançamento a gravar, com as mesmas validações dos repositórios e das regras.
 */

/** Lançamento como a tela o envia: sem os campos que o repositório preenche. */
export type JournalEntryInput = Omit<JournalEntry, 'id' | 'entryNumber' | 'createdAt' | 'updatedAt'>;

export const emptyJournalLines = (): JournalEntryLine[] => [
  { id: 'l1', accountId: '', type: 'DEBIT', amount: 0, memo: '' },
  { id: 'l2', accountId: '', type: 'CREDIT', amount: 0, memo: '' },
];

/**
 * Próxima partida: o lado oposto ao da última e, se for crédito, já com o que falta para
 * fechar com os débitos. Null quando o lançamento chegou ao máximo de partidas.
 */
export function nextJournalLine(lines: readonly JournalEntryLine[], id: string): JournalEntryLine | null {
  if (lines.length >= MAX_JOURNAL_LINES) return null;
  const type = lines[lines.length - 1]?.type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
  const { debit, credit } = journalTotals(lines);
  const missing = Math.max(0, Math.round((debit - credit) * 100) / 100);
  return { id, accountId: '', type, amount: type === 'CREDIT' ? missing : 0, memo: '' };
}

/** Valores digitados nos campos do modelo ("1.234,56"); em branco vale zero. */
export function parseTemplateValues(
  template: Pick<JournalTemplate, 'fields'>,
  raw: Readonly<Record<string, string>>
): { values: Record<string, number> } | { problem: string } {
  const values: Record<string, number> = {};
  for (const f of template.fields) {
    const n = parseMoneyInput(raw[f.key] ?? '');
    if (n === null) return { problem: `${f.label}: valor inválido (use números, como 1.234,56).` };
    values[f.key] = n;
  }
  return { values };
}

export interface JournalForm {
  clientId: string;
  date: string;
  category: JournalEntryCategory;
  memo: string;
  documentRef: string;
  attachmentUrl: string;
  lines: readonly JournalEntryLine[];
  /** Autor do lançamento em edição; vazio no novo (o repositório preenche). */
  createdByUid?: string;
}

/**
 * Lançamento a gravar, ou o motivo de não poder gravar. As partidas levam o código e o nome da
 * conta; textos vazios saem do documento.
 */
export function buildJournalEntry(
  form: JournalForm,
  accounts: readonly ChartAccount[],
  lockedMonth?: string | null
): { entry: JournalEntryInput } | { problem: string } {
  if (lockedMonth) return { problem: `A competência ${lockedMonth} está bloqueada para alterações.` };
  if (!form.memo.trim()) return { problem: 'Informe a descrição / histórico do lançamento.' };
  const lines = form.lines.map((l) => ({ ...l, amount: Number(l.amount) }));
  const problem = journalEntryProblem({ date: form.date, lines });
  if (problem) return { problem };
  const attachment = parseAttachmentUrl(form.attachmentUrl);
  if (attachment && 'problem' in attachment) return { problem: `Link do comprovante: ${attachment.problem}` };

  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  return {
    entry: {
      clientId: form.clientId,
      date: form.date,
      memo: form.memo.trim(),
      category: form.category,
      lines: lines.map((l) => {
        const acc = byId.get(l.accountId);
        return {
          id: l.id,
          accountId: l.accountId,
          accountCode: acc?.code,
          accountName: acc?.name,
          type: l.type,
          amount: l.amount,
          memo: l.memo?.trim() || undefined,
        };
      }),
      totalAmount: journalTotals(lines).debit,
      documentRef: form.documentRef.trim() || undefined,
      attachmentUrl: attachment && 'url' in attachment ? attachment.url : undefined,
      createdByUid: form.createdByUid ?? '',
    },
  };
}
