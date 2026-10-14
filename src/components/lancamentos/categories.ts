import type { JournalEntryCategory } from '@/types/firestore';

/** Nome e cor de cada categoria de lançamento manual, nas listas e filtros. */
export const CATEGORY_CONFIG: Record<JournalEntryCategory, { label: string; badge: string }> = {
  CLOSING: {
    label: 'Fechamento Geral',
    badge: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  },
  PAYROLL: {
    label: 'Folha de Pagamento',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  },
  DEPRECIATION: {
    label: 'Depreciação',
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  },
  TAX: {
    label: 'Provisão Tributária',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
  ADJUSTMENT: {
    label: 'Ajuste Patrimonial',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  PROVISION: {
    label: 'Provisão Geral',
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
  OTHER: {
    label: 'Outros',
    badge: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  },
};
