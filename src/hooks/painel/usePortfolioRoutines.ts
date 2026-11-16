'use client';

import { useCallback, useRef, useState } from 'react';
import { loadMonthRoutines } from '@/lib/services/month-routines';
import { routineTasks, type PortfolioRow, type PortfolioTask } from '@/lib/portfolio';
import { reportError } from '@/lib/monitoring';

/** Empresas conferidas ao mesmo tempo: cada uma lê os lançamentos manuais da competência. */
const CONCURRENCY = 2;

export interface RoutineCheck {
  /** Tarefas das rotinas por empresa (vazio: nada a lançar ou nada cadastrado). */
  tasks: Record<string, PortfolioTask[]>;
  /** Empresas cuja conferência falhou. */
  failed: number;
  /** Andamento da conferência em curso, ou null. */
  progress: { done: number; total: number } | null;
  /** Já houve uma conferência concluída nesta visita. */
  checked: boolean;
}

/**
 * Rotinas do mês (Bens e Contratos e provisão da folha) de cada empresa da carteira, conferidas
 * só a pedido: a carteira normal usa leituras baratas, e esta lê os lançamentos manuais da
 * competência de foco de cada empresa. Competência já fechada não é conferida.
 */
export function usePortfolioRoutines() {
  const [state, setState] = useState<RoutineCheck>({ tasks: {}, failed: 0, progress: null, checked: false });
  const run = useRef(0);

  const check = useCallback(async (rows: readonly PortfolioRow[]) => {
    const id = ++run.current;
    const queue = rows.filter((r) => r.focus !== 'closed');
    const total = queue.length;
    let done = 0;
    let failed = 0;
    const tasks: Record<string, PortfolioTask[]> = {};
    setState({ tasks: {}, failed: 0, progress: { done: 0, total }, checked: false });
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        try {
          tasks[row.clientId] = routineTasks(await loadMonthRoutines(row.clientId, row.focusMonth), row.focusMonth);
        } catch (e) {
          failed++;
          reportError(e, { area: 'painel', op: 'conferir rotinas da carteira', level: 'warning' });
        }
        done++;
        if (run.current === id) setState({ tasks: { ...tasks }, failed, progress: { done, total }, checked: false });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (run.current === id) setState({ tasks: { ...tasks }, failed, progress: null, checked: true });
  }, []);

  /** Esquece a conferência (ao atualizar a carteira: as linhas mudam). */
  const reset = useCallback(() => {
    run.current++;
    setState({ tasks: {}, failed: 0, progress: null, checked: false });
  }, []);

  return { ...state, check, reset };
}
