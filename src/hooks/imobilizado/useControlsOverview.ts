'use client';

import { useEffect, useState } from 'react';
import type { ControlsRegisters } from '@/lib/controls-overview';
import { getRepository } from '@/lib/services/data-service';
import { implantationDate } from '@/lib/opening';
import { monthOf } from '@/lib/periods';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

/** Lê os cinco cadastros de Bens e Contratos (um documento cada) e a data de implantação. */
export async function loadControlsRegisters(clientId: string): Promise<ControlsRegisters> {
  const repo = getRepository();
  const [assets, prepaid, financing, investments, stock, openings, banks] = await Promise.all([
    repo.getFixedAssets(clientId),
    repo.getPrepaidExpenses(clientId),
    repo.getFinancingContracts(clientId),
    repo.getInvestments(clientId),
    repo.getStockControl(clientId),
    repo.getOpeningBalances(clientId),
    repo.listBankAccounts(clientId),
  ]);
  const implantation = implantationDate(openings, banks);
  return {
    assets: assets?.assets ?? [],
    prepaid: prepaid?.items ?? [],
    contracts: financing?.contracts ?? [],
    investments: investments?.accounts ?? [],
    stock,
    implantationMonth: implantation ? monthOf(implantation) : null,
  };
}

/** Cadastros de Bens e Contratos da empresa para o Resumo; `registers` é null enquanto carrega. */
export function useControlsOverview(clientId: string | undefined) {
  const [state, setState] = useState<{ clientId: string; registers: ControlsRegisters | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    loadControlsRegisters(clientId)
      .then((registers) => active && setState({ clientId, registers, error: null }))
      .catch((e: unknown) => {
        if (!active) return;
        reportError(e, { area: 'bens-e-contratos', op: 'carregar resumo' });
        setState({ clientId, registers: null, error: describeError(e) });
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const current = state?.clientId === clientId ? state : null;
  return { registers: current?.registers ?? null, error: current?.error ?? null, loading: Boolean(clientId) && !current };
}
