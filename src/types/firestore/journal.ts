/** Escrituração: DRE, lançamentos manuais e sua sequência, checklist do fechamento do exercício e notas explicativas. */

import type { TaxRegime } from './core';

export interface DRELineItem {
  id: string;
  title: string;
  code?: string;
  level: number;
  isTotal?: boolean;
  value: number;
  children?: DRELineItem[];
}

export interface DREResult {
  period: {
    startDate: string;
    endDate: string;
  };
  clientId: string;
  regime: TaxRegime;
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  costs: number;
  grossProfit: number;
  operatingExpenses: number;
  financialResult: number;
  netIncomeBeforeTaxes: number;
  taxes: number;
  netProfit: number;
  items: DRELineItem[];
}

export type JournalEntryCategory =
  | 'PROVISION'
  | 'DEPRECIATION'
  | 'PAYROLL'
  | 'TAX'
  | 'ADJUSTMENT'
  | 'CLOSING'
  | 'OTHER';

export interface JournalEntryLine {
  id: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  memo?: string;
}

/**
 * Lançamento contábil no livro diário sem movimentação de extrato bancário
 * (coleção `journal_entries`). Respeita estritamente a soma débito === crédito.
 */
export interface JournalEntry {
  id: string;
  orgId?: string;
  clientId: string;
  entryNumber: number;
  date: string; // YYYY-MM-DD
  memo: string;
  category: JournalEntryCategory;
  lines: JournalEntryLine[];
  totalAmount: number;
  documentRef?: string;
  /** Link (http/https) do comprovante guardado na nuvem; ver `parseAttachmentUrl` em src/lib/journal.ts. */
  attachmentUrl?: string;
  /** Lançamento do mês anterior do qual este foi repetido (recorrência mensal). */
  repeatedFromId?: string;
  /**
   * Exercício (YYYY) encerrado por este lançamento: gerado pela rotina de encerramento
   * (src/lib/year-closing.ts), com `category: 'CLOSING'` e data em 31/12. Fica fora da DRE, que
   * mostra o resultado antes do encerramento, e só sai pela reabertura do exercício.
   */
  yearClosing?: string;
  /**
   * Registro de auditoria (YEAR_CLOSE) do encerramento a que o lançamento pertence: todos os
   * lançamentos de um encerramento são gravados com ele numa só operação, e a reabertura grava
   * `${closingAuditId}_reopen` junto com a exclusão de todos.
   */
  closingAuditId?: string;
  /**
   * Competência (YYYY-MM) da depreciação gerada pelo cadastro do imobilizado
   * (src/lib/fixed-assets.ts): um lançamento por mês, atualizado enquanto o mês está aberto.
   */
  depreciationMonth?: string;
  /** Bem baixado por este lançamento (baixa por venda, perda ou sucata). */
  fixedAssetId?: string;
  /** Competência (YYYY-MM) da apropriação das despesas antecipadas (src/lib/prepaid-expenses.ts). */
  prepaidMonth?: string;
  /** Despesa antecipada reconhecida por este lançamento (D ativo / C obrigação, na data da apólice). */
  prepaidId?: string;
  /** Competência (YYYY-MM) dos juros e da reclassificação de empréstimos e financiamentos (src/lib/financing.ts). */
  financingMonth?: string;
  /** Contrato reconhecido por este lançamento (o inicial, na data do contrato). */
  financingId?: string;
  /** Competência (YYYY-MM) do rendimento das aplicações financeiras (src/lib/investments.ts). */
  investmentMonth?: string;
  /** Competência (YYYY-MM) do CMV pelo estoque final informado (src/lib/stock.ts). */
  stockMonth?: string;
  /** Competência (YYYY-MM) da provisão da folha de pagamento (src/lib/payroll.ts). */
  payrollMonth?: string;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
}

/** Item conferido à mão no fechamento (ver `manualItems` em src/lib/closing-checklist.ts). */
export interface ClosingChecklistItem {
  done: boolean;
  /** ISO da marcação. */
  at: string;
  byUid?: string;
  note?: string;
}

export type BookRegistrationMethod = 'ECD' | 'JUNTA' | 'CARTORIO';

/** Comprovação da escrituração: ECD entregue ou livros registrados na Junta Comercial ou no cartório. */
export interface BookRegistration {
  method: BookRegistrationMethod;
  /** YYYY-MM-DD. */
  date?: string;
  /** Recibo da ECD ou número do registro. */
  protocol?: string;
}

/** Checklist do fechamento de um exercício (coleção `closing_checklists`, id `${clientId}_${year}`). */
export interface ClosingChecklist {
  id: string;
  orgId?: string;
  clientId: string;
  year: string;
  items: Record<string, ClosingChecklistItem>;
  books?: BookRegistration;
  updatedAt: string;
  updatedByUid?: string;
}

export interface ExplanatoryNoteBlock {
  id: string;
  title: string;
  text: string;
  enabled: boolean;
}

/**
 * Notas explicativas de um exercício (coleção `explanatory_notes`, id `${clientId}_${year}`):
 * o texto revisado pelo contador, compartilhado entre os aparelhos e usuários do escritório.
 */
export interface ExplanatoryNotes {
  id: string;
  orgId?: string;
  clientId: string;
  year: string;
  notes: ExplanatoryNoteBlock[];
  updatedAt: string;
  updatedByUid?: string;
}

/**
 * Sequência dos lançamentos manuais de um cliente (coleção `journal_counters`, id = clientId).
 * `last` é o último número atribuído; só avança, de um em um, junto com o lançamento novo.
 */
export interface JournalCounter {
  id: string;
  orgId?: string;
  clientId: string;
  last: number;
}
