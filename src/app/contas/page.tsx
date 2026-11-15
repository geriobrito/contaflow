'use client';

import { useState } from 'react';
import type { BankAccount, ImportBatch } from '@/types/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { useContasData } from '@/hooks/contas/useContasData';
import { BankAccountSheet } from '@/components/contas/BankAccountSheet';
import { BankAccountsTable } from '@/components/contas/BankAccountsTable';
import { DeleteBatchSheet } from '@/components/contas/DeleteBatchSheet';
import { ImportHistoryTable } from '@/components/contas/ImportHistoryTable';
import { TextRepairCard } from '@/components/contas/TextRepairCard';
import { PAGE, PageHeader } from '@/components/ui/primitives';
import { Toast, useToast } from '@/components/ui/Toast';

/**
 * Contas e extratos. A tela só compõe: os dados e as gravações vêm de `useContasData`, e cada
 * bloco tem o seu componente em src/components/contas/.
 */
export default function ContasPage() {
  const { isAdmin } = useAuth();
  const { currentClient } = useClient();
  const { current, error, busy, lockedMonths, unregistered, textPlan, unlinkedTx, carriedByBank, reload, register, repairText } = useContasData(currentClient?.id);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [deleting, setDeleting] = useState<ImportBatch | null>(null);
  const [toast, setToast] = useToast();


  /** Depois de uma gravação feita num dos painéis: fecha-o, avisa e recarrega. */
  const refresh = async (message: string) => {
    setCreating(false);
    setEditing(null);
    setDeleting(null);
    setToast(message);
    await reload();
  };

  return (
    <main className={PAGE}>
      <PageHeader
        eyebrow={currentClient?.tradeName || currentClient?.name}
        title="Contas e extratos"
        description="Cada conta bancária ou cartão do cliente ligado à sua conta contábil, com saldo inicial para o balanço, e o histórico dos extratos importados."
      />
      {error && <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-300">{error}</p>}

      <BankAccountsTable
        current={current}
        unregistered={unregistered}
        carriedByBank={carriedByBank}
        unlinkedTx={unlinkedTx}
        busy={busy}
        onCreate={() => setCreating(true)}
        onEdit={setEditing}
        onRegister={async (batch) => {
          if (await register(batch)) setToast('Conta bancária cadastrada');
        }}
      />

      {/* Correção de acentuação de importações antigas */}
      {textPlan && textPlan.total > 0 && (
        <TextRepairCard
          plan={textPlan}
          busy={busy}
          onRepair={() =>
            void repairText().then((message) => {
              if (message) setToast(message);
            })
          }
        />
      )}

      <ImportHistoryTable current={current} onDelete={isAdmin ? setDeleting : undefined} />

      {creating && current && currentClient && (
        <BankAccountSheet
          key="new-bank"
          clientId={currentClient.id}
          bank={null}
          data={current}
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}
      {editing && current && currentClient && (
        <BankAccountSheet
          key={editing.id}
          clientId={currentClient.id}
          bank={editing}
          data={current}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {deleting && <DeleteBatchSheet key={deleting.id} batch={deleting} lockedMonths={lockedMonths} onClose={() => setDeleting(null)} onDeleted={refresh} />}

      <Toast toast={toast} />
    </main>
  );
}
