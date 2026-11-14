'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientCompany, FeeRegister, ObligationChecks } from '@/types/firestore';
import { getRepository } from '@/lib/services/data-service';
import { emptyChecks, payrollProfile, type PayrollProfile } from '@/lib/obligations';
import { describeError } from '@/lib/utils/errors';
import { reportError } from '@/lib/monitoring';

export interface OfficeData {
  checks: Map<string, ObligationChecks>;
  fees: Map<string, FeeRegister>;
  profiles: Map<string, PayrollProfile>;
}

/** Empresas lidas ao mesmo tempo para o perfil da folha. */
const CONCURRENCY = 4;

/**
 * Agenda de obrigações e honorários da carteira: uma consulta para cada coleção do escritório
 * (um documento por empresa) e o cadastro da folha de cada empresa (obrigações da folha).
 * Gravações atualizam a tela na hora e voltam atrás se o servidor recusar.
 */
export function useOfficeAgenda(clients: readonly ClientCompany[], enabled = true) {
  const usable = useMemo(() => clients.filter((c) => !c.deletingAt), [clients]);
  const [data, setData] = useState<OfficeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const repo = getRepository();
    (async () => {
      const [checks, fees] = await Promise.all([repo.listObligationChecks(), repo.listFeeRegisters()]);
      const profiles = new Map<string, PayrollProfile>();
      const queue = [...usable];
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) profiles.set(c.id, payrollProfile(await repo.getPayrollRegister(c.id)));
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      return { checks: new Map(checks.map((c) => [c.clientId, c] as const)), fees: new Map(fees.map((f) => [f.clientId, f] as const)), profiles };
    })()
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        reportError(e, { area: 'agenda', op: 'carregar agenda e honorários' });
        if (active) setError(describeError(e));
      });
    return () => {
      active = false;
    };
  }, [usable, enabled, reloads]);

  const saveChecks = useCallback(async (next: ObligationChecks) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    let previous: ObligationChecks | undefined;
    setData((d) => {
      if (!d) return d;
      previous = d.checks.get(next.clientId);
      return { ...d, checks: new Map(d.checks).set(next.clientId, stamped) };
    });
    try {
      await getRepository().saveObligationChecks(stamped);
    } catch (e) {
      setData((d) => {
        if (!d) return d;
        const checks = new Map(d.checks);
        if (previous) checks.set(next.clientId, previous);
        else checks.delete(next.clientId);
        return { ...d, checks };
      });
      throw e;
    }
  }, []);

  const saveFees = useCallback(async (next: FeeRegister) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    let previous: FeeRegister | undefined;
    setData((d) => {
      if (!d) return d;
      previous = d.fees.get(next.clientId);
      return { ...d, fees: new Map(d.fees).set(next.clientId, stamped) };
    });
    try {
      await getRepository().saveFeeRegister(stamped);
    } catch (e) {
      setData((d) => {
        if (!d) return d;
        const fees = new Map(d.fees);
        if (previous) fees.set(next.clientId, previous);
        else fees.delete(next.clientId);
        return { ...d, fees };
      });
      throw e;
    }
  }, []);

  /** Agenda da empresa (vazia se ainda não gravada). */
  const checksOf = useCallback((clientId: string) => data?.checks.get(clientId) ?? emptyChecks(clientId, new Date().toISOString()), [data]);

  return { clients: usable, data, error, saveChecks, saveFees, checksOf, reload: () => setReloads((n) => n + 1) };
}
