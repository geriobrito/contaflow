'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ClientCompany } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useOfficeAgenda } from '@/hooks/agenda/useOfficeAgenda';
import { todayISO } from '@/lib/business-days';
import { ObligationsAgenda } from '@/components/agenda/ObligationsAgenda';
import { FeesBoard } from '@/components/agenda/FeesBoard';
import { EmptyState, PAGE, PageHeader, SegmentedControl, SURFACE } from '@/components/ui/primitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

type Tab = 'obrigacoes' | 'honorarios';
const TAB_KEY = 'contaflow_agenda_tab';

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'honorarios' ? 'honorarios' : 'obrigacoes';
  } catch {
    return 'obrigacoes';
  }
}

/** Gestão do escritório: agenda de obrigações de toda a carteira e controle de honorários. */
export default function AgendaPage() {
  const router = useRouter();
  const { clients, selectClient, isLoading } = useClient();
  const { clients: usable, data, error, saveChecks, saveFees, checksOf } = useOfficeAgenda(clients);
  const [tab, setTab] = useState<Tab>('obrigacoes');
  useEffect(() => {
    // Lido depois da montagem: o HTML do servidor é sempre a aba padrão.
    const stored = readTab();
    if (stored !== 'obrigacoes') queueMicrotask(() => setTab(stored));
  }, []);
  const chooseTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* armazenamento indisponível */
    }
  };
  const today = todayISO();
  const open = (client: ClientCompany, href: string) => {
    selectClient(client);
    router.push(href);
  };

  return (
    <main className={PAGE}>
      <PageHeader
        title="Agenda e honorários"
        description="O que vence nesta semana em toda a carteira e o que cada empresa deve de honorários."
        actions={
          <SegmentedControl
            ariaLabel="Seção"
            value={tab}
            onChange={chooseTab}
            options={[
              { value: 'obrigacoes', label: 'Obrigações' },
              { value: 'honorarios', label: 'Honorários' },
            ]}
          />
        }
      />
      {error && (
        <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">
          Não foi possível carregar: {error}
        </p>
      )}
      {!isLoading && usable.length === 0 ? (
        <section className={`${SURFACE} rounded-[22px]`}>
          <EmptyState
            title="Nenhuma empresa cadastrada"
            description="Cadastre as empresas da carteira para montar a agenda e os honorários."
            action={
              <Link href="/clientes" className="text-accent-ink text-[14px] font-medium">
                Cadastrar empresa
              </Link>
            }
          />
        </section>
      ) : !data ? (
        !error && (
          <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
            <TableSkeleton rows={6} />
          </section>
        )
      ) : tab === 'obrigacoes' ? (
        <ObligationsAgenda clients={usable} data={data} today={today} saveChecks={saveChecks} checksOf={checksOf} onOpen={open} />
      ) : (
        <FeesBoard clients={usable} fees={data.fees} today={today} onSave={saveFees} />
      )}
    </main>
  );
}
