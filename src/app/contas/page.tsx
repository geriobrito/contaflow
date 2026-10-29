'use client';

import React, { useEffect, useState } from 'react';
import type { BankAccount, ImportBatch } from '@/types/firestore';
import { useClient } from '@/contexts/ClientContext';
import { useContasData } from '@/hooks/contas/useContasData';
import { BankAccountSheet } from '@/components/contas/BankAccountSheet';
import { BankAccountsTable } from '@/components/contas/BankAccountsTable';
import { DeleteBatchSheet } from '@/components/contas/DeleteBatchSheet';
import { ImportHistoryTable } from '@/components/contas/ImportHistoryTable';
import { TextRepairCard } from '@/components/contas/TextRepairCard';
import { PAGE, PageHeader } from '@/components/ui/primitives';

/**
 * Contas e extratos. A tela só compõe: os dados e as gravações vêm de `useContasData`, e cada
 * bloco tem o seu componente em src/components/contas/.
 */
export default function ContasPage() {
  const { currentClient } = useClient();
  const { current, error, busy, lockedMonths, unregistered, textPlan, unlinkedTx, carriedByBank, reload, register, repairText } = useContasData(currentClient?.id);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [deleting, setDeleting] = useState<ImportBatch | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

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
      {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}

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

      <ImportHistoryTable current={current} onDelete={setDeleting} />

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

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 text-white text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in">
          {toast}
        </div>
      )}
    </main>
  );
}
