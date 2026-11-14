'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import type { BankAccount, ChartAccount, FinancingContract } from '@/types/firestore';
import { getAccounts, getLatestTransactionDate, getRepository } from '@/lib/services/data-service';
import { usePeriod } from '@/components/ui/PeriodPicker';
import { parseConciliationLink, upsertBank, type StatusFilter } from '@/lib/reconciliation-list';
import { reportError } from '@/lib/monitoring';

const loadFailure = (what: string, e: unknown): string => {
  reportError(e, { area: 'conciliacao', op: `carregar ${what}` });
  return `Não foi possível carregar ${what} (${e instanceof Error && e.message ? e.message : 'erro desconhecido'}). Recarregue a página para tentar de novo.`;
};

/**
 * Cadastros e período da Conciliação: posiciona o período no mês do lançamento mais recente (ou
 * no pedido pelo link do Painel), e carrega plano de contas, contas bancárias (de novo a cada
 * importação, via `statementsKey`), parcelamentos pós-fixados e contas das aplicações.
 */
export function useConciliationSetup(
  clientId: string | null,
  statementsKey: number,
  /** Filtros pedidos pelo link do Painel (conta e situação). */
  onLink: (link: { bank?: string; filter?: StatusFilter }) => void
) {
  // Falha ao carregar os cadastros da empresa: sem eles a tela pareceria apenas vazia.
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);

  // Período consultado no banco. Ao trocar de cliente, posiciona no mês do lançamento
  // mais recente; até lá o hook não carrega nada (evita buscar o histórico inteiro).
  const period = usePeriod('month');
  const { jumpTo, setMode } = period;
  const [positionedFor, setPositionedFor] = useState<string | null>(null);
  // Lido só na chegada do cliente: trocar a função não refaz a busca.
  const applyLink = useEffectEvent(onLink);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getLatestTransactionDate(clientId)
      .then((latest) => {
        if (!active) return;
        // Links do painel abrem o mês e os filtros pedidos.
        const link = parseConciliationLink(window.location.search);
        if (link.month) {
          setMode('month');
          jumpTo(`${link.month}-01`);
          applyLink({ bank: link.bank, filter: link.filter });
        } else {
          if (link.bank) applyLink({ bank: link.bank });
          if (latest) jumpTo(latest);
        }
        setPositionedFor(clientId);
      })
      .catch((e) => {
        reportError(e, { area: 'conciliacao', op: 'localizar período' });
        if (active) setPositionedFor(clientId);
      });
    return () => {
      active = false;
    };
  }, [clientId, jumpTo, setMode]);
  const range = clientId && positionedFor === clientId ? period.range : null;
  const selectedMonth = period.mode === 'month' ? `${period.year}-${String(period.month).padStart(2, '0')}` : null;

  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getAccounts(clientId)
      .then((list) => active && setAccounts(list))
      .catch((e: unknown) => active && setLoadError({ id: clientId, message: loadFailure('o plano de contas', e) }));
    return () => {
      active = false;
    };
  }, [clientId]);

  // Parcelamentos pós-fixados (Selic): o pagamento acima da parcela-base é sugerido como parcela + juros.
  const [floatingContracts, setFloatingContracts] = useState<{ id: string; list: FinancingContract[] } | null>(null);
  // Contas das aplicações financeiras: a entrada nelas é resgate (bruto × líquido com IR e IOF).
  const [investmentAccounts, setInvestmentAccounts] = useState<{ id: string; list: string[] } | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .getFinancingContracts(clientId)
      .then((r) => active && setFloatingContracts({ id: clientId, list: (r?.contracts ?? []).filter((c) => c.interestMode === 'FLOATING') }))
      .catch((e: unknown) => reportError(e, { area: 'conciliacao', op: 'carregar parcelamentos' }));
    getRepository()
      .getInvestments(clientId)
      .then((r) => active && setInvestmentAccounts({ id: clientId, list: (r?.accounts ?? []).map((a) => a.ledgerAccountId) }))
      .catch((e: unknown) => reportError(e, { area: 'conciliacao', op: 'carregar aplicações' }));
    return () => {
      active = false;
    };
  }, [clientId]);

  // Contas bancárias e cartões (importação, filtro e nomes nas transferências); recarrega após cada importação.
  const [banks, setBanks] = useState<BankAccount[]>([]);
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    getRepository()
      .listBankAccounts(clientId)
      .then((b) => active && setBanks(b))
      .catch((e: unknown) => active && setLoadError({ id: clientId, message: loadFailure('as contas bancárias', e) }));
    return () => {
      active = false;
    };
  }, [clientId, statementsKey]);

  return {
    period,
    range,
    selectedMonth,
    accounts,
    addAccount: (account: ChartAccount) => setAccounts((prev) => [...prev, account]),
    banks,
    updateBank: (updated: BankAccount) => setBanks((prev) => upsertBank(prev, updated)),
    floatingContracts: floatingContracts?.id === clientId ? floatingContracts.list : undefined,
    investmentAccountIds: investmentAccounts?.id === clientId ? investmentAccounts.list : undefined,
    loadError: loadError && loadError.id === clientId ? loadError.message : null,
  };
}
