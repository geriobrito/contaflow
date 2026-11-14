'use client';

import { useMonthRoutines } from '@/hooks/imobilizado/useMonthRoutines';

/** Rótulo do botão que lança as rotinas pendentes do mês. */
export function routineLabel(pending: readonly string[]): string {
  if (pending.length > 1) return 'Lançar rotinas do mês';
  switch (pending[0]) {
    case 'prepaid':
      return 'Lançar apropriação';
    case 'financing':
      return 'Lançar juros';
    case 'investment':
      return 'Lançar rendimento';
    case 'stock':
      return 'Lançar CMV';
    default:
      return 'Lançar depreciação';
  }
}

/**
 * Aviso das rotinas do mês na barra de fechamento (depreciação, apropriação das despesas
 * antecipadas, juros, rendimento e CMV): enquanto faltarem, a competência não fecha.
 */
export function useMonthRoutineNotice(clientId: string | null, month: string | null, locked: boolean, notify: (message: string) => void) {
  const monthRoutines = useMonthRoutines(clientId ?? undefined, month, locked);
  const routines = monthRoutines.routines;
  if (!routines) return null;
  if (routines.problems.length) {
    return {
      message: monthRoutines.error ?? routines.problems.join(' '),
      actionLabel: routines.pending.length ? (routines.updates ? 'Atualizar lançamentos' : routineLabel(routines.pending)) : null,
      blocking: true,
      links: routines.inputs,
      busy: monthRoutines.busy,
      onPost: () => {
        void monthRoutines.post().then((message) => message && notify(message));
      },
    };
  }
  if (routines.warnings.length) {
    return { message: routines.warnings.join(' '), actionLabel: null, blocking: false, busy: false, onPost: () => undefined, links: routines.inputs };
  }
  return null;
}
