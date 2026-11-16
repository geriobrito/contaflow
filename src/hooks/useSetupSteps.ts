'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BankAccount, ChartAccount, ClientCompany, OpeningBalances, OrgSettings } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { DATA_WRITTEN_EVENT } from '@/lib/data/cached-repository';
import { setupSteps, type SetupStep } from '@/lib/setup-steps';
import { reportError } from '@/lib/monitoring';

interface Loaded {
  id: string;
  accounts: ChartAccount[];
  banks: BankAccount[];
  openings: OpeningBalances | null;
  rules: number;
  org: OrgSettings | null;
}

/**
 * Passos da implantação da empresa ativa. Lê só cadastros pequenos (plano, bancos e abertura vêm
 * do cache de leitura) e relê a cada gravação dos cadastros, para a faixa acompanhar o que a
 * tela acabou de salvar. Enquanto carrega, ou se a leitura falhar, devolve null: a faixa não
 * aparece.
 */
export function useSetupSteps(client: ClientCompany | null | undefined): SetupStep[] | null {
  const clientId = client?.id;
  const [data, setData] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onWrite = () => setVersion((v) => v + 1);
    window.addEventListener(DATA_WRITTEN_EVENT, onWrite);
    return () => window.removeEventListener(DATA_WRITTEN_EVENT, onWrite);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const repo = getRepository();
    Promise.all([repo.listAccounts(clientId), repo.listBankAccounts(clientId), repo.getOpeningBalances(clientId), repo.listRules(clientId), repo.getOrgSettings()])
      .then(([accounts, banks, openings, rules, org]) => {
        if (active) setData({ id: clientId, accounts, banks, openings, rules: rules.filter((r) => r.clientId === clientId).length, org });
      })
      .catch((e: unknown) => reportError(e, { area: 'cadastros', op: 'situação da implantação', level: 'warning' }));
    return () => {
      active = false;
    };
  }, [clientId, version]);

  return useMemo(() => (client && data?.id === client.id ? setupSteps({ client, ...data }) : null), [client, data]);
}
